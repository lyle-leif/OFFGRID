"""Answers to location questions, computed from facility records and the road graph.

Each handler returns the text of the answer plus the final `done` event fields. The
language model is never involved, so distances, names and numbers are always real.
The wording comes from app/static/lang/<lang>.json (body.lang), shared with the phone.
"""

from fastapi import HTTPException, Request

from app.models import AskRequest, Location
from app.routes.directions import compute_route
from app.services.i18n import t
from app.services.intents import Intent
from app.services.routing import RoutingError, meters

TYPES = ["evacuation_center", "hospital", "health_center", "rescue", "fire_station", "police", "pharmacy",
         "town_hall", "barangay_hall", "market", "drinking_water", "relief_point"]  # listing order
KEY_TYPES = ["evacuation_center", "hospital", "police"]  # "nearest place to go?" with no type
CANDIDATES = 8  # straight-line candidates that get a full road route
MAX_KM = 15
NEARBY_M = 2000


class NeedsInput(Exception):
    pass


def fmt_m(m: float) -> str:
    return f"{round(m)} m" if m < 1000 else f"{m / 1000:.1f} km"


def _label(lang: str, ftype: str, plural: bool = False) -> str:
    if ftype not in TYPES:
        return ftype
    return t(lang, f"plabel.{ftype}", n=2 if plural else 1)


def _require(body: AskRequest, loc: Location | None, need_place: bool, need_pos: bool) -> None:
    lang = body.lang
    missing = []
    if need_place and not loc:
        missing.append(t(lang, "ans.needs_place"))
    if need_pos and not body.from_pos:
        missing.append(t(lang, "ans.needs_position"))
    if missing:
        raise NeedsInput(t(lang, "ans.to_answer", missing=t(lang, "ans.and").join(missing)))


def _road(request: Request, start: tuple[float, float], loc: Location, mode: str, lang: str) -> dict | None:
    router = request.app.state.router
    if router is None:
        return None
    try:
        return router.route(start, (loc.lat, loc.lng), mode, loc.name, lang=lang)
    except RoutingError:
        return None


def _place(loc: Location, route: dict | None, straight: float, mode: str) -> dict:
    return {
        "id": loc.id,
        "name": loc.name,
        "type": loc.type,
        "distance_m": round(route["distance_m"] if route else straight),
        "duration_min": route["duration_min"] if route else None,
        "by_road": route is not None,
        "mode": mode,
    }


def _place_line(lang: str, i: int, p: dict) -> str:
    if p["by_road"]:
        how = t(lang, "ans.how_walk" if p["mode"] == "walk" else "ans.how_drive")
        dist = t(lang, "ans.by_road", d=fmt_m(p["distance_m"]), min=p["duration_min"], how=how)
    else:
        dist = t(lang, "ans.straight_none", d=fmt_m(p["distance_m"]))
    return t(lang, "ans.place_line", i=i, name=p["name"], dist=dist)


def nearest(request: Request, body: AskRequest, ftype: str | None) -> tuple[str, dict]:
    _require(body, None, need_place=False, need_pos=True)
    lang = body.lang
    start = (body.from_pos.lat, body.from_pos.lng)
    mode = body.travel_mode
    types = [ftype] if ftype else KEY_TYPES
    per_type = 3 if ftype else 1
    places, lines = [], []
    for ty in types:
        cands = sorted(
            ((meters(start, (l.lat, l.lng)), l) for l in request.app.state.locations.all()
             if l.type == ty or ty in l.also),
            key=lambda x: x[0],
        )[:CANDIDATES]
        cands = [(d, l) for d, l in cands if d <= MAX_KM * 1000]
        if not cands:
            lines.append(t(lang, "ans.none_within", label=_label(lang, ty), km=MAX_KM))
            continue
        ranked = sorted((_place(l, _road(request, start, l, mode, lang), d, mode) for d, l in cands),
                        key=lambda p: p["distance_m"])[:per_type]
        places += ranked
        if ftype:
            lines.append(t(lang, "ans.nearest_head", label=_label(lang, ty, plural=len(ranked) > 1)))
            lines += [_place_line(lang, i, p) for i, p in enumerate(ranked, 1)]
        else:
            p = ranked[0]
            key = "ans.nearest_one_road" if p["by_road"] else "ans.nearest_one_straight"
            lines.append(t(lang, key, label=_label(lang, ty), name=p["name"], d=fmt_m(p["distance_m"]),
                           min=p["duration_min"]))
    lines.append("")
    lines.append(t(lang, "ans.nearest_foot"))
    return "\n".join(lines), {"status": "places", "places": places}


def nearby(request: Request, body: AskRequest) -> tuple[str, dict]:
    _require(body, None, need_place=False, need_pos=True)
    lang = body.lang
    start = (body.from_pos.lat, body.from_pos.lng)
    groups: dict[str, list[tuple[float, Location]]] = {}
    for l in request.app.state.locations.all():
        d = meters(start, (l.lat, l.lng))
        if d <= NEARBY_M:
            groups.setdefault(l.type, []).append((d, l))
    if not groups:
        return t(lang, "ans.nearby_none", d=fmt_m(NEARBY_M)), {"status": "places", "places": []}
    lines = [t(lang, "ans.nearby_head", d=fmt_m(NEARBY_M))]
    places = []
    for ty in sorted(groups, key=lambda x: TYPES.index(x) if x in TYPES else 99):
        items = sorted(groups[ty], key=lambda x: x[0])
        d, closest = items[0]
        n = len(items)
        lines.append(t(lang, "ans.nearby_line", n=n, label=_label(lang, ty, plural=n > 1), label_one=_label(lang, ty),
                       name=closest.name, d=fmt_m(d)))
        places.append(_place(closest, None, d, body.travel_mode))
    lines.append("")
    lines.append(t(lang, "ans.nearby_foot"))
    return "\n".join(lines), {"status": "places", "places": places}


def distance(request: Request, body: AskRequest, loc: Location | None) -> tuple[str, dict]:
    _require(body, loc, need_place=True, need_pos=True)
    lang = body.lang
    try:
        shown = compute_route(request, body.from_pos.lat, body.from_pos.lng, loc.id, body.travel_mode, lang=lang)
    except HTTPException as e:
        raise NeedsInput(str(e.detail)) from e
    other_mode = "drive" if body.travel_mode == "walk" else "walk"
    other = _road(request, (body.from_pos.lat, body.from_pos.lng), loc, other_mode, lang)
    walk, drive = (shown, other) if body.travel_mode == "walk" else (other, shown)
    # Walking and driving routes can differ (footpaths, one-way streets), so give each its own distance.
    parts = []
    if walk:
        parts.append(t(lang, "ans.on_foot", d=fmt_m(walk["distance_m"]), min=walk["duration_min"]))
    if drive:
        parts.append(t(lang, "ans.by_car", d=fmt_m(drive["distance_m"]), min=drive["duration_min"]))
    how = t(lang, "ans.how_walking" if body.travel_mode == "walk" else "ans.how_driving")
    text = t(lang, "ans.distance", name=loc.name, parts=t(lang, "ans.or").join(parts),
             straight=fmt_m(shown["straight_line_m"]), how=how, warning=t(lang, "ans.route_warning"))
    return text, {"status": "route", "route": shown, "location_used": loc.id}


def contact(body: AskRequest, loc: Location | None) -> tuple[str, dict]:
    _require(body, loc, need_place=True, need_pos=False)
    lang = body.lang
    if loc.phone:
        text = t(lang, "ans.phone", name=loc.name, phone=loc.phone)
    else:
        text = t(lang, "ans.no_phone", name=loc.name)
    return text, {"status": "info", "location_used": loc.id, "phone": loc.phone}


def hours(body: AskRequest, loc: Location | None) -> tuple[str, dict]:
    _require(body, loc, need_place=True, need_pos=False)
    lang = body.lang
    if loc.opening_hours:
        hrs = t(lang, "ans.open24") if loc.opening_hours.strip() == "24/7" else t(lang, "ans.hours_val",
                                                                                  hours=loc.opening_hours)
        text = t(lang, "ans.hours", hrs=hrs, name=loc.name)
    else:
        text = t(lang, "ans.no_hours", name=loc.name)
    return text, {"status": "info", "location_used": loc.id}


def answer(intent: Intent, request: Request, body: AskRequest, loc: Location | None) -> tuple[str, dict]:
    """Returns (text, done-event fields). Raises NeedsInput when a place or position is missing."""
    if intent.kind == "nearest":
        return nearest(request, body, intent.ftype)
    if intent.kind == "nearby":
        return nearby(request, body)
    if intent.kind == "distance":
        return distance(request, body, loc)
    if intent.kind == "contact":
        return contact(body, loc)
    if intent.kind == "hours":
        return hours(body, loc)
    raise ValueError(intent.kind)
