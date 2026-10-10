"""Answer "is the road flooded?" from situation reports, with honest trust labels.

Exact data only, never the language model. The phone has a copy of this logic
(app/static/offline/reports.js) for when the hub is gone; tests/fixtures/parity.json
keeps the two in step.
"""

import re

from app.services.routing import meters

NEAR_PLACE_M = 500
NEAR_YOU_M = 3000
MAX_LISTED = 6
GROUPS = [  # (kinds, how a "no reports" line names them)
    (("road_flooded", "road_blocked"), "road"),
    (("center_full", "center_open"), "evacuation center"),
    (("water_available",), "drinking water"),
    (("power_out",), "power"),
    (("medical_need",), "medical"),
]
TTL_H = {"road_flooded": 2, "road_blocked": 2, "center_full": 6, "center_open": 6, "water_available": 6,
         "power_out": 6, "medical_need": 2}
TRUST_TEXT = {"verified": "verified by a responder", "confirmed": "confirmed by others", "unverified": "unverified"}
FOOTER = "Reports come from people nearby and may be wrong. Follow official instructions."
_ROAD_SUFFIX = re.compile(r"\s+(street|st|road|rd|avenue|ave|highway|hwy|boulevard|blvd|drive|dr|extension|ext)$")


def fmt_m(m: float) -> str:
    return f"{round(m)} m" if m < 1000 else f"{m / 1000:.1f} km"


def fmt_old(minutes: int) -> str:
    if minutes < 1:
        return "just now"
    if minutes < 60:
        return f"{minutes} min old"
    h, m = divmod(minutes, 60)
    return f"{h} h {m} min old" if m else f"{h} h old"


def _norm(s: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s.lower()).split())


def road_core(name: str) -> str:
    """'P. Burgos Street' -> 'p burgos', so a question saying "P. Burgos" finds it."""
    return _ROAD_SUFFIX.sub("", _norm(name))


def _named_road(question: str, reports: list[dict]) -> str | None:
    q = f" {_norm(question)} "
    for r in reports:
        core = road_core(r["road_name"] or "")
        if len(core) >= 4 and f" {core} " in q:
            return r["road_name"]
    return None


def answer(question: str, kinds: list[str], reports: list[dict], place: dict | None = None,
           pos: tuple[float, float] | None = None) -> tuple[str, dict]:
    """`reports`: public report dicts, newest first. `place`: {id, name, lat, lng} or None.
    Returns (text, done fields)."""
    pool = [r for r in reports if r["kind"] in kinds]
    road = None
    if place:
        here = (place["lat"], place["lng"])
        sel = [r for r in pool if r["location_id"] == place["id"] or meters((r["lat"], r["lng"]), here) <= NEAR_PLACE_M]
        scope = f"near {place['name']}"
    elif road := _named_road(question, pool):
        sel = [r for r in pool if r["road_name"] and road_core(r["road_name"]) == road_core(road)]
        scope = f"on {road}"
    elif pos:
        sel = [r for r in pool if meters((r["lat"], r["lng"]), pos) <= NEAR_YOU_M]
        scope = "within 3 km of you"
    else:
        sel, scope = pool, "in the area"
    sel = sorted(sel, key=lambda r: r["age_min"])

    lines = []
    if sel:
        lines.append(f"{len(sel)} report{'s' if len(sel) > 1 else ''} {scope}:")
        for r in sel[:MAX_LISTED]:
            where = ""
            if r["road_name"] and not road:
                where = f" on {r['road_name']}"
            elif r["location_name"] and not (place and r["location_id"] == place["id"]):
                where = f" at {r['location_name']}"
            elif pos and not place:
                where = f", {fmt_m(meters((r['lat'], r['lng']), pos))} from you"
            count = f"{r['reports']} report{'s' if r['reports'] > 1 else ''}"
            disputed = f", {r['disputes']} disputed" if r["disputes"] else ""
            lines.append(f"- {r['label']}{where}: {TRUST_TEXT[r['trust']]}, {fmt_old(r['age_min'])}, {count}{disputed}.")
        if len(sel) > MAX_LISTED:
            lines.append(f"...and {len(sel) - MAX_LISTED} more in the Reports tab.")
    else:
        names = [name for group, name in GROUPS if any(k in kinds for k in group)]
        what = "" if len(names) == len(GROUPS) else " or ".join(names) + " "
        window = max(TTL_H[k] for k in kinds)
        roads = " That does not mean the roads are safe." if "road_flooded" in kinds else ""
        lines.append(f"No {what}reports {scope} in the last {window} hours.{roads}")
    lines.append("")
    if any(r["kind"] == "road_flooded" for r in sel) or (not sel and "road_flooded" in kinds):
        lines.append("Never walk or drive through floodwater.")
    lines.append(FOOTER)
    return "\n".join(lines), {"status": "reports", "reports": sel[:MAX_LISTED],
                              "location_used": place["id"] if place else None}
