"""Answer "is the road flooded?" from situation reports, with honest trust labels.

Exact data only, never the language model. The phone has a copy of this logic
(app/static/offline/reports.js) for when the hub is gone; tests/fixtures/parity.json
keeps the two in step. Wording: app/static/lang/<lang>.json.
"""

import re

from app.services.i18n import road_name, t
from app.services.routing import meters

NEAR_PLACE_M = 500
NEAR_YOU_M = 3000
MAX_LISTED = 6
GROUPS = [  # (kinds, rans.group.<key>: how a "no reports" line names them)
    (("road_flooded", "road_blocked"), "road"),
    (("center_full", "center_open"), "center"),
    (("water_available",), "water"),
    (("power_out",), "power"),
    (("medical_need",), "medical"),
    (("other",), "other"),
]
TTL_H = {"road_flooded": 2, "road_blocked": 2, "center_full": 6, "center_open": 6, "water_available": 6,
         "power_out": 6, "medical_need": 2, "other": 3}
_ROAD_SUFFIX = re.compile(r"\s+(street|st|road|rd|avenue|ave|highway|hwy|boulevard|blvd|drive|dr|extension|ext)$")


def fmt_m(m: float) -> str:
    return f"{round(m)} m" if m < 1000 else f"{m / 1000:.1f} km"


def fmt_old(minutes: int, lang: str = "en") -> str:
    if minutes < 1:
        return t(lang, "rans.old_now")
    if minutes < 60:
        return t(lang, "rans.old_min", m=minutes)
    h, m = divmod(minutes, 60)
    return t(lang, "rans.old_hmin", h=h, m=m) if m else t(lang, "rans.old_h", h=h)


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
           pos: tuple[float, float] | None = None, lang: str = "en") -> tuple[str, dict]:
    """`reports`: public report dicts, newest first. `place`: {id, name, lat, lng} or None.
    Returns (text, done fields)."""
    pool = [r for r in reports if r["kind"] in kinds]
    road = None
    if place:
        here = (place["lat"], place["lng"])
        sel = [r for r in pool if r["location_id"] == place["id"] or meters((r["lat"], r["lng"]), here) <= NEAR_PLACE_M]
        scope = t(lang, "rans.near", place=place["name"])
    elif road := _named_road(question, pool):
        sel = [r for r in pool if r["road_name"] and road_core(r["road_name"]) == road_core(road)]
        scope = t(lang, "rans.on", road=road_name(lang, road))
    elif pos:
        sel = [r for r in pool if meters((r["lat"], r["lng"]), pos) <= NEAR_YOU_M]
        scope = t(lang, "rans.within")
    else:
        sel, scope = pool, t(lang, "rans.area")
    sel = sorted(sel, key=lambda r: r["age_min"])

    lines = []
    if sel:
        lines.append(t(lang, "rans.head", n=len(sel), scope=scope))
        for r in sel[:MAX_LISTED]:
            where = ""
            if r["road_name"] and not road:
                where = t(lang, "rans.where_on", road=road_name(lang, r["road_name"]))
            elif r["location_name"] and not (place and r["location_id"] == place["id"]):
                where = t(lang, "rans.where_at", place=r["location_name"])
            elif pos and not place:
                where = t(lang, "rans.where_from", d=fmt_m(meters((r["lat"], r["lng"]), pos)))
            disputed = t(lang, "rans.disputed", n=r["disputes"]) if r["disputes"] else ""
            # The one-tap details and the GPS badge; a reporter's note is never quoted here.
            chips = [t(lang, f"detail.{d}") for d in r.get("details") or []]
            details = t(lang, "rans.details", list=", ".join(chips)) if chips else ""
            onsite = t(lang, "rans.onsite") if r.get("on_site") else ""
            lines.append(t(lang, "rans.line", label=t(lang, f"kind.{r['kind']}"), details=details, where=where,
                           trust=t(lang, f"rans.trust.{r['trust']}"), onsite=onsite, age=fmt_old(r["age_min"], lang),
                           count=t(lang, "rans.count", n=r["reports"]), disputed=disputed))
        if len(sel) > MAX_LISTED:
            lines.append(t(lang, "rans.more", n=len(sel) - MAX_LISTED))
    else:
        names = [t(lang, f"rans.group.{key}") for group, key in GROUPS if any(k in kinds for k in group)]
        window = max(TTL_H[k] for k in kinds)
        roads = t(lang, "rans.roads_note") if "road_flooded" in kinds else ""
        if len(names) == len(GROUPS):
            lines.append(t(lang, "rans.none_all", scope=scope, h=window, roads=roads))
        else:
            lines.append(t(lang, "rans.none_kind", what=t(lang, "ans.or").join(names), scope=scope, h=window,
                           roads=roads))
    lines.append("")
    if any(r["kind"] == "road_flooded" for r in sel) or (not sel and "road_flooded" in kinds):
        lines.append(t(lang, "rans.flood"))
    lines.append(t(lang, "rans.footer"))
    return "\n".join(lines), {"status": "reports", "reports": sel[:MAX_LISTED],
                              "location_used": place["id"] if place else None}
