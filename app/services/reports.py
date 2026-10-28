"""Local situation reports: "road flooded here", "evacuation center full", ...

Anyone near the hub can post one. Reports carry no personal data: a kind, a pin, a time,
and counts of confirm/dispute votes. Each phone sends a random device id; only a salted
hash of it is stored, and only so that a phone votes once per report. Reports expire on
their own (see config.REPORT_TTL_H) and are deleted a day after that.

Trust labels: "verified" (a responder with the hub PIN checked it), "confirmed" (2+
other people confirmed it) or "unverified". A report with clearly more disputes than
confirms is hidden.

Reports v2: one-tap details, an optional note in the reporter's own words, and whether it
was marked by GPS on site. A note is shown to the public only after a responder approves it,
and is deleted as soon as the report expires. The online reports (cloud/src/reports.js)
follow the same rules; tests/test_cloud.py compares the two.
"""

import hashlib
import json
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from app import config

KIND_LABEL = {
    "road_flooded": "Road flooded",
    "road_blocked": "Road blocked",
    "center_full": "Evacuation center full",
    "center_open": "Evacuation center open",
    "water_available": "Drinking water available",
    "power_out": "Power out",
    "medical_need": "Medical help needed",
    "other": "Something else",
}
ROAD_KINDS = {"road_flooded", "road_blocked"}
CENTER_KINDS = {"center_full", "center_open"}
CONFIRMED_AT = 2  # confirms needed for "confirmed"
HIDE_MARGIN = 2  # hidden when disputes >= confirms + HIDE_MARGIN
MAX_LIFE = 3  # confirms can keep a report alive up to this many TTLs after it was made
KEEP_EXPIRED_S = 24 * 3600

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
    location_id TEXT, edge_id INTEGER, road_name TEXT,
    created_at REAL NOT NULL, expires_at REAL NOT NULL,
    confirms INTEGER NOT NULL DEFAULT 0, disputes INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0, removed INTEGER NOT NULL DEFAULT 0,
    details TEXT, note TEXT, note_status TEXT NOT NULL DEFAULT 'none', flagged INTEGER NOT NULL DEFAULT 0,
    on_site INTEGER NOT NULL DEFAULT 0, acc_bucket INTEGER
);
CREATE TABLE IF NOT EXISTS votes (
    report_id TEXT NOT NULL, device_hash TEXT NOT NULL, vote TEXT NOT NULL,
    PRIMARY KEY (report_id, device_hash)
);
"""
_COLS = ["id", "kind", "lat", "lng", "location_id", "edge_id", "road_name", "created_at", "expires_at",
         "confirms", "disputes", "verified", "removed",
         "details", "note", "note_status", "flagged", "on_site", "acc_bucket"]
# Reports v2 columns, added to hub databases made before them.
_V2_COLUMNS = {"details": "TEXT", "note": "TEXT", "note_status": "TEXT NOT NULL DEFAULT 'none'",
               "flagged": "INTEGER NOT NULL DEFAULT 0", "on_site": "INTEGER NOT NULL DEFAULT 0", "acc_bucket": "INTEGER"}


def ttl_s(kind: str) -> float:
    return config.REPORT_TTL_H[kind] * 3600


def trust(r: dict) -> str:
    if r["verified"]:
        return "verified"
    return "confirmed" if r["confirms"] >= CONFIRMED_AT else "unverified"


def hidden(r: dict) -> bool:
    return bool(r["removed"]) or (not r["verified"] and r["disputes"] >= r["confirms"] + HIDE_MARGIN)


class ReportStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript(_SCHEMA)
            have = {row[1] for row in self._db.execute("PRAGMA table_info(reports)")}
            for col, decl in _V2_COLUMNS.items():
                if col not in have:
                    self._db.execute(f"ALTER TABLE reports ADD COLUMN {col} {decl}")
            row = self._db.execute("SELECT value FROM meta WHERE key='salt'").fetchone()
            if row is None:
                row = (secrets.token_hex(16),)
                self._db.execute("INSERT INTO meta VALUES ('salt', ?)", row)
            self._salt = row[0]

    def close(self) -> None:
        self._db.close()

    def _hash(self, device: str) -> str:
        return hashlib.sha256((self._salt + device).encode()).hexdigest()[:32]

    def _get(self, report_id: str) -> dict | None:
        row = self._db.execute(f"SELECT {','.join(_COLS)} FROM reports WHERE id=?", (report_id,)).fetchone()
        return dict(zip(_COLS, row)) if row else None

    def get(self, report_id: str) -> dict | None:
        with self._lock:
            return self._get(report_id)

    def add(self, report_id: str, kind: str, lat: float, lng: float, device: str, age_s: float = 0,
            now: float | None = None, location_id: str | None = None, edge_id: int | None = None,
            road_name: str | None = None, details: list[str] | None = None, note: str | None = None,
            flagged: bool = False, on_site: bool = False, acc_bucket: int | None = None) -> tuple[dict, bool]:
        """Store a report. Posting the same id again (a phone retrying) changes nothing.
        `age_s` is how long ago the phone made it (by its own clock), for reports queued
        offline; phone clocks may be wrong, so only the elapsed time is trusted."""
        now = time.time() if now is None else now
        ttl = ttl_s(kind)
        created = now - max(0.0, min(age_s, ttl))
        with self._lock:
            old = self._get(report_id)
            if old is not None:
                return old, False
            self._purge(now)
            self._db.execute(
                f"INSERT INTO reports ({','.join(_COLS)}) VALUES ({','.join('?' * len(_COLS))})",
                (report_id, kind, lat, lng, location_id, edge_id, road_name, created, created + ttl, 0, 0, 0, 0,
                 json.dumps(details or []), note, "pending" if note else "none", int(bool(note and flagged)),
                 int(on_site), acc_bucket if on_site else None),
            )
            # The reporter can't confirm or dispute their own report.
            self._db.execute("INSERT INTO votes VALUES (?, ?, 'own')", (report_id, self._hash(device)))
            return self._get(report_id), True

    def vote(self, report_id: str, device: str, vote: str, now: float | None = None) -> dict | None:
        """Confirm or dispute. One vote per device; voting again can switch it. A confirm
        restarts the expiry clock (capped at MAX_LIFE TTLs after the report was made)."""
        assert vote in ("confirm", "dispute")
        now = time.time() if now is None else now
        with self._lock:
            r = self._get(report_id)
            if r is None:
                return None
            h = self._hash(device)
            row = self._db.execute("SELECT vote FROM votes WHERE report_id=? AND device_hash=?",
                                   (report_id, h)).fetchone()
            old = row[0] if row else None
            if old in ("own", vote):
                return r
            col = {"confirm": "confirms", "dispute": "disputes"}
            sets = [f"{col[vote]} = {col[vote]} + 1"]
            if old:
                sets.append(f"{col[old]} = {col[old]} - 1")
            if vote == "confirm":
                ttl = ttl_s(r["kind"])
                expires = max(r["expires_at"], min(now + ttl, r["created_at"] + MAX_LIFE * ttl))
                sets.append(f"expires_at = {expires!r}")
            self._db.execute(f"UPDATE reports SET {', '.join(sets)} WHERE id=?", (report_id,))
            self._db.execute("INSERT OR REPLACE INTO votes VALUES (?, ?, ?)", (report_id, h, vote))
            return self._get(report_id)

    def set_flag(self, report_id: str, flag: str) -> dict | None:
        """flag: 'verified' or 'removed' (responder actions)."""
        assert flag in ("verified", "removed")
        with self._lock:
            self._db.execute(f"UPDATE reports SET {flag} = 1 WHERE id=?", (report_id,))
            return self._get(report_id)

    def set_note(self, report_id: str, status: str) -> dict | None:
        """status: 'approved' (the public may read the note) or 'hidden' (responder actions)."""
        assert status in ("approved", "hidden")
        with self._lock:
            self._db.execute("UPDATE reports SET note_status = ? WHERE id = ? AND note IS NOT NULL", (status, report_id))
            return self._get(report_id)

    def active(self, now: float | None = None) -> list[dict]:
        """Reports still in force and not hidden, newest first."""
        now = time.time() if now is None else now
        with self._lock:
            self._clear_notes(now)
            rows = self._db.execute(
                f"SELECT {','.join(_COLS)} FROM reports WHERE expires_at > ? AND removed = 0 "
                "ORDER BY created_at DESC", (now,)).fetchall()
        return [r for r in (dict(zip(_COLS, row)) for row in rows) if not hidden(r)]

    def blocked_edges(self, now: float | None = None) -> dict[int, str]:
        """Road edge id -> report id, for every active flooded/blocked road report."""
        out: dict[int, str] = {}
        for r in self.active(now):
            if r["kind"] in ROAD_KINDS and r["edge_id"] is not None:
                out.setdefault(r["edge_id"], r["id"])
        return out

    def _clear_notes(self, now: float) -> None:
        """Notes go as soon as their report expires (the report itself is kept a day longer)."""
        self._db.execute("UPDATE reports SET note = NULL WHERE expires_at <= ? AND note IS NOT NULL", (now,))

    def _purge(self, now: float) -> None:
        self._clear_notes(now)
        old = now - KEEP_EXPIRED_S
        self._db.execute("DELETE FROM votes WHERE report_id IN (SELECT id FROM reports WHERE expires_at < ?)", (old,))
        self._db.execute("DELETE FROM reports WHERE expires_at < ?", (old,))


def public(r: dict, now: float | None = None, location_name: str | None = None, responder: bool = False) -> dict:
    """What phones get. Ages, not timestamps, because phone clocks may be wrong. A note is
    included once a responder approved it; responders also see notes still waiting."""
    now = time.time() if now is None else now
    out = {
        "id": r["id"], "kind": r["kind"], "label": KIND_LABEL[r["kind"]],
        "lat": round(r["lat"], 6), "lng": round(r["lng"], 6),
        "location_id": r["location_id"], "location_name": location_name,
        "road_name": r["road_name"], "edge_id": r["edge_id"],
        "age_min": max(0, int((now - r["created_at"]) // 60)),
        "expires_in_min": max(0, int((r["expires_at"] - now) // 60)),
        "ttl_min": int(ttl_s(r["kind"]) // 60),
        "confirms": r["confirms"], "disputes": r["disputes"], "reports": 1 + r["confirms"],
        "trust": trust(r),
        "details": json.loads(r.get("details") or "[]"),
        "on_site": bool(r.get("on_site")),
        "acc_bucket": r.get("acc_bucket"),
        "note": r.get("note") if r.get("note_status") == "approved" or responder else None,
    }
    if responder:
        out["note_status"] = r.get("note_status") or "none"
        out["flagged"] = bool(r.get("flagged"))
    return out


class Limiter:
    """At most `limit` events per key in a sliding `window` (seconds). Memory only."""

    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self._hits: dict[str, deque] = defaultdict(deque)

    def _trim(self, key: str, now: float) -> deque:
        q = self._hits[key]
        while q and q[0] <= now - self.window:
            q.popleft()
        return q

    def blocked(self, key: str, now: float | None = None) -> bool:
        return len(self._trim(key, time.time() if now is None else now)) >= self.limit

    def hit(self, key: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        self._trim(key, now).append(now)
