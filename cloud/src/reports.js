// Situation reports in the cloud: the same rules as the hub (app/services/reports.py), on
// Cloudflare D1. tests/test_cloud.py replays the same scenarios on both and compares.
//
// Reports carry no personal data: a kind, a pin, a time, and counts of confirm/dispute votes.
// Phones send a random device id; only a salted hash of it is stored, so a phone votes once.
// Reports v2: one-tap details, an optional note (shown to the public only once a responder
// approves it, deleted as soon as the report expires), and a GPS "on site" badge.

import { DATA } from "./data.js";

export const CONFIRMED_AT = 2; // confirms needed for "confirmed"
export const HIDE_MARGIN = 2; // hidden when disputes >= confirms + HIDE_MARGIN
export const MAX_LIFE = 3; // confirms keep a report alive up to this many TTLs after it was made
export const KEEP_EXPIRED_S = 24 * 3600;
export const ROAD_KINDS = new Set(["road_flooded", "road_blocked"]);
export const CENTER_KINDS = new Set(["center_full", "center_open"]);
const COLS = ["id", "kind", "lat", "lng", "location_id", "edge_id", "road_name", "created_at", "expires_at",
  "confirms", "disputes", "verified", "removed", "details", "note", "note_status", "flagged", "on_site", "acc_bucket"];

export const ttlS = (kind) => DATA.ttl_h[kind] * 3600;
export const trust = (r) => (r.verified ? "verified" : r.confirms >= CONFIRMED_AT ? "confirmed" : "unverified");
export const hidden = (r) => Boolean(r.removed) || (!r.verified && r.disputes >= r.confirms + HIDE_MARGIN);

export async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// db: a D1 database (or tests/js/d1shim.mjs, the same calls on node:sqlite).
export class ReportStore {
  constructor(db) {
    this.db = db;
    this.salt = null;
  }

  async hash(text) {
    if (!this.salt) {
      await this.db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('salt', ?)").bind(randomHex(16)).run();
      this.salt = (await this.db.prepare("SELECT value FROM meta WHERE key = 'salt'").first()).value;
    }
    return (await sha256(this.salt + text)).slice(0, 32);
  }

  async get(id) {
    return this.db.prepare(`SELECT ${COLS.join(",")} FROM reports WHERE id = ?`).bind(id).first();
  }

  // Store a report. Posting the same id again (a phone retrying) changes nothing. `ageS`: how
  // long ago the phone made it (queued offline); only the elapsed time is trusted.
  async add({ id, kind, lat, lng, device, ageS = 0, now, locationId = null, edgeId = null, roadName = null,
    details = [], note = null, flagged = false, onSite = false, accBucket = null }) {
    const old = await this.get(id);
    if (old) return [old, false];
    await this.purge(now);
    const ttl = ttlS(kind);
    const created = now - Math.max(0, Math.min(ageS, ttl));
    const h = await this.hash(device);
    await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO reports (${COLS.join(",")}) VALUES (${COLS.map(() => "?").join(",")})`)
        .bind(id, kind, lat, lng, locationId, edgeId, roadName, created, created + ttl, 0, 0, 0, 0,
          JSON.stringify(details ?? []), note, note ? "pending" : "none", note && flagged ? 1 : 0,
          onSite ? 1 : 0, onSite ? accBucket : null),
      // The reporter can't confirm or dispute their own report.
      this.db.prepare("INSERT OR IGNORE INTO votes (report_id, device_hash, vote) VALUES (?, ?, 'own')").bind(id, h),
    ]);
    return [await this.get(id), true];
  }

  // Confirm or dispute. One vote per device; voting again can switch it. A confirm restarts
  // the expiry clock (capped at MAX_LIFE TTLs after the report was made).
  async vote(id, device, vote, now) {
    const r = await this.get(id);
    if (!r) return null;
    const h = await this.hash(device);
    const old = (await this.db.prepare("SELECT vote FROM votes WHERE report_id = ? AND device_hash = ?").bind(id, h).first())?.vote ?? null;
    if (old === "own" || old === vote) return r;
    const col = { confirm: "confirms", dispute: "disputes" };
    const sets = [`${col[vote]} = ${col[vote]} + 1`];
    if (old) sets.push(`${col[old]} = ${col[old]} - 1`);
    const binds = [];
    if (vote === "confirm") {
      const ttl = ttlS(r.kind);
      sets.push("expires_at = ?");
      binds.push(Math.max(r.expires_at, Math.min(now + ttl, r.created_at + MAX_LIFE * ttl)));
    }
    await this.db.batch([
      this.db.prepare(`UPDATE reports SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id),
      this.db.prepare("INSERT OR REPLACE INTO votes (report_id, device_hash, vote) VALUES (?, ?, ?)").bind(id, h, vote),
    ]);
    return this.get(id);
  }

  // flag: "verified" or "removed" (responder actions).
  async setFlag(id, flag) {
    if (flag !== "verified" && flag !== "removed") throw new Error(flag);
    await this.db.prepare(`UPDATE reports SET ${flag} = 1 WHERE id = ?`).bind(id).run();
    return this.get(id);
  }

  // status: "approved" (the public may read the note) or "hidden" (responder actions).
  async setNote(id, status) {
    if (status !== "approved" && status !== "hidden") throw new Error(status);
    await this.db.prepare("UPDATE reports SET note_status = ? WHERE id = ? AND note IS NOT NULL").bind(status, id).run();
    return this.get(id);
  }

  // Notes go as soon as their report expires (the report itself is kept a day longer).
  clearNotes(now) {
    return this.db.prepare("UPDATE reports SET note = NULL WHERE expires_at <= ? AND note IS NOT NULL").bind(now);
  }

  // Reports still in force and not hidden, newest first.
  async active(now) {
    await this.clearNotes(now).run();
    const { results } = await this.db.prepare(
      `SELECT ${COLS.join(",")} FROM reports WHERE expires_at > ? AND removed = 0 ORDER BY created_at DESC`).bind(now).all();
    return results.filter((r) => !hidden(r));
  }

  async purge(now) {
    const old = now - KEEP_EXPIRED_S;
    await this.db.batch([
      this.clearNotes(now),
      this.db.prepare("DELETE FROM votes WHERE report_id IN (SELECT id FROM reports WHERE expires_at < ?)").bind(old),
      this.db.prepare("DELETE FROM reports WHERE expires_at < ?").bind(old),
    ]);
  }
}

// Python's round(x, 6) (halves to even), so coordinates match the hub's exactly.
function round6(x) {
  const s = x * 1e6;
  const f = Math.floor(s);
  const r = s - f === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(s);
  return r / 1e6;
}

// What phones get: the same shape as public() in app/services/reports.py. Ages, not
// timestamps, because phone clocks may be wrong. A note is included once a responder approved
// it; responders also see notes still waiting.
export function publicReport(r, now, responder = false) {
  const center = r.location_id ? DATA.centers[r.location_id] : null;
  const out = {
    id: r.id, kind: r.kind, label: DATA.kind_label[r.kind],
    lat: round6(r.lat), lng: round6(r.lng),
    location_id: r.location_id, location_name: center ? center[0] : null,
    road_name: r.road_name, edge_id: r.edge_id,
    age_min: Math.max(0, Math.floor((now - r.created_at) / 60)),
    expires_in_min: Math.max(0, Math.floor((r.expires_at - now) / 60)),
    ttl_min: Math.floor(ttlS(r.kind) / 60),
    confirms: r.confirms, disputes: r.disputes, reports: 1 + r.confirms,
    trust: trust(r),
    details: JSON.parse(r.details || "[]"),
    on_site: Boolean(r.on_site),
    acc_bucket: r.acc_bucket ?? null,
    note: r.note_status === "approved" || responder ? r.note ?? null : null,
  };
  if (responder) {
    out.note_status = r.note_status || "none";
    out.flagged = Boolean(r.flagged);
  }
  return out;
}
