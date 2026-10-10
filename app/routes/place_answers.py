"""Answers to location questions, computed from facility records and the road graph.

Each handler returns the text of the answer plus the final `done` event fields. The
language model is never involved, so distances, names and numbers are always real.
"""

from fastapi import HTTPException, Request

from app.models import AskRequest, Location
from app.routes.directions import ROUTE_WARNING, compute_route
from app.services.intents import Intent
from app.services.routing import RoutingError, meters

LABELS = {
    "evacuation_center": ("evacuation center", "evacuation centers"),
    "hospital": ("hospital", "hospitals"),
    "health_center": ("clinic / health center", "clinics / health centers"),
    "rescue": ("rescue / DRRM station", "rescue / DRRM stations"),
    "fire_station": ("fire station", "fire stations"),
    "police": ("police station", "police stations"),
    "pharmacy": ("pharmacy", "pharmacies"),
    "town_hall": ("town / city hall", "town / city halls"),
    "barangay_hall": ("barangay hall", "barangay halls"),
    "market": ("market / grocery", "markets / groceries"),
    "drinking_water": ("drinking water point", "drinking water points"),
    "relief_point": ("relief point", "relief points"),
}
KEY_TYPES = ["evacuation_center", "hospital", "police"]  # "nearest place to go?" with no type
CANDIDATES = 8  # straight-line candidates that get a full road route
MAX_KM = 15
NEARBY_M = 2000
NEEDS_POSITION = 'set your location with the "Set my location" button on the map'
NEEDS_PLACE = "select a place on the map or in the Facilities list"


class NeedsInput(Exception):
    pass


def fmt_m(m: float) -> str:
    return f"{round(m)} m" if m < 1000 else f"{m / 1000:.1f} km"


def _label(ftype: str, plural: bool = False) -> str:
    return LABELS.get(ftype, (ftype, ftype))[1 if plural else 0]


def _require(body: AskRequest, loc: Location | None, need_place: bool, need_pos: bool) -> None:
    missing = []
    if need_place and not loc:
        missing.append(NEEDS_PLACE)
    if need_pos and not body.from_pos:
        missing.append(NEEDS_POSITION)
    if missing:
        raise NeedsInput("To answer that, " + " and ".join(missing) + ", then ask again.")


def _road(request: Request, start: tuple[float, float], loc: Location, mode: str) -> dict | None:
    router = request.app.state.router
    if router is None:
        return None
    try:
        return router.route(start, (loc.lat, loc.lng), mode, loc.name)
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


def _place_line(i: int, p: dict) -> str:
    how = "walk" if p["mode"] == "walk" else "drive"
    if p["by_road"]:
        dist = f"{fmt_m(p['distance_m'])} by road (about {p['duration_min']} min {how})"
    else:
        dist = f"{fmt_m(p['distance_m'])} in a straight line (no road route found)"
    return f"{i}. {p['name']}: {dist}"


def nearest(request: Request, body: AskRequest, ftype: str | None) -> tuple[str, dict]:
    _require(body, None, need_place=False, need_pos=True)
    start = (body.from_pos.lat, body.from_pos.lng)
    mode = body.travel_mode
    types = [ftype] if ftype else KEY_TYPES
    per_type = 3 if ftype else 1
    places, lines = [], []
    for t in types:
        cands = sorted(
            ((meters(start, (l.lat, l.lng)), l) for l in request.app.state.locations.all()
             if l.type == t or t in l.also),
            key=lambda x: x[0],
        )[:CANDIDATES]
        cands = [(d, l) for d, l in cands if d <= MAX_KM * 1000]
        if not cands:
            lines.append(f"No {_label(t)} is saved within {MAX_KM} km of your location.")
            continue
        ranked = sorted((_place(l, _road(request, start, l, mode), d, mode) for d, l in cands),
                        key=lambda p: p["distance_m"])[:per_type]
        places += ranked
        if ftype:
            lines.append(f"Nearest {_label(t, plural=len(ranked) > 1)} from your location:")
            lines += [_place_line(i, p) for i, p in enumerate(ranked, 1)]
        else:
            p = ranked[0]
            lines.append(f"Nearest {_label(t)}: {p['name']}, {fmt_m(p['distance_m'])}"
                         + (f" by road (about {p['duration_min']} min)" if p["by_road"] else " in a straight line"))
    lines.append("")
    lines.append("Tap a result to see it or get directions. Roads may be flooded or blocked; "
                 "facility details come from OpenStreetMap and are not an official list.")
    return "\n".join(lines), {"status": "places", "places": places}


def nearby(request: Request, body: AskRequest) -> tuple[str, dict]:
    _require(body, None, need_place=False, need_pos=True)
    start = (body.from_pos.lat, body.from_pos.lng)
    groups: dict[str, list[tuple[float, Location]]] = {}
    for l in request.app.state.locations.all():
        d = meters(start, (l.lat, l.lng))
        if d <= NEARBY_M:
            groups.setdefault(l.type, []).append((d, l))
    if not groups:
        return (f"No saved facilities within {fmt_m(NEARBY_M)} of your location (straight line). "
                "Try asking for the nearest hospital or evacuation center."), {"status": "places", "places": []}
    order = list(LABELS)
    lines = [f"Within {fmt_m(NEARBY_M)} of your location (straight-line distance):"]
    places = []
    for t in sorted(groups, key=lambda t: order.index(t) if t in order else 99):
        items = sorted(groups[t], key=lambda x: x[0])
        d, closest = items[0]
        n = len(items)
        lines.append(f"- {n} {_label(t, plural=n > 1)}: closest is {closest.name}, {fmt_m(d)}")
        places.append(_place(closest, None, d, body.travel_mode))
    lines.append("")
    lines.append('Ask for a type (e.g. "nearest hospital") to get road distances and directions.')
    return "\n".join(lines), {"status": "places", "places": places}


def distance(request: Request, body: AskRequest, loc: Location | None) -> tuple[str, dict]:
    _require(body, loc, need_place=True, need_pos=True)
    try:
        shown = compute_route(request, body.from_pos.lat, body.from_pos.lng, loc.id, body.travel_mode)
    except HTTPException as e:
        raise NeedsInput(str(e.detail)) from e
    other_mode = "drive" if body.travel_mode == "walk" else "walk"
    other = _road(request, (body.from_pos.lat, body.from_pos.lng), loc, other_mode)
    walk, drive = (shown, other) if body.travel_mode == "walk" else (other, shown)
    # Walking and driving routes can differ (footpaths, one-way streets), so give each its own distance.
    parts = []
    if walk:
        parts.append(f"{fmt_m(walk['distance_m'])} on foot (about {walk['duration_min']} min)")
    if drive:
        parts.append(f"{fmt_m(drive['distance_m'])} by car (about {drive['duration_min']} min)")
    how = "walking" if body.travel_mode == "walk" else "driving"
    text = (
        f"{loc.name} is {' or '.join(parts)} from your location. "
        f"Straight-line distance: {fmt_m(shown['straight_line_m'])}.\n\n"
        f"The {how} route is shown on the map. {ROUTE_WARNING}"
    )
    return text, {"status": "route", "route": shown, "location_used": loc.id}


def contact(body: AskRequest, loc: Location | None) -> tuple[str, dict]:
    _require(body, loc, need_place=True, need_pos=False)
    if loc.phone:
        text = (f"Phone for {loc.name} (saved from OpenStreetMap, may be outdated): {loc.phone}.\n"
                "For emergencies, call 911.")
    else:
        text = (f"No phone number is saved for {loc.name}. For emergencies, call 911. "
                "Local hotlines (CDRRMO, police, fire) are in the Hotlines tab.")
    return text, {"status": "info", "location_used": loc.id, "phone": loc.phone}


def hours(body: AskRequest, loc: Location | None) -> tuple[str, dict]:
    _require(body, loc, need_place=True, need_pos=False)
    if loc.opening_hours:
        hrs = "open 24 hours" if loc.opening_hours.strip() == "24/7" else f"hours: {loc.opening_hours}"
        text = (f"Saved {hrs} for {loc.name} (from OpenStreetMap). The app cannot confirm whether it is open "
                "right now, especially during a disaster.")
    else:
        text = (f"No opening hours are saved for {loc.name}. The app cannot tell whether it is open right now. "
                "Call ahead if a number is available, or ask your barangay.")
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
