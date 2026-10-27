from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.services.i18n import norm, t
from app.services.routing import RoutingError

router = APIRouter(prefix="/api")

ROUTE_WARNING = t("en", "ans.route_warning")


def plan_route(road_router, start: tuple[float, float], end: tuple[float, float], mode: str, dest_name: str,
               blocked: dict[int, str], lang: str = "en") -> dict:
    """Route that avoids reported roads (`blocked`: edge id -> report id). Plans the normal
    route first; only if it uses a reported road, plans again around them. If there is no
    way around, returns the normal route marked with the reports it goes through."""
    result = road_router.route(start, end, mode, dest_name, lang=lang)
    on_route = [blocked[e] for e in result["edges"] if e in blocked]
    avoided: list[str] = []
    if on_route:
        try:
            result = road_router.route(start, end, mode, dest_name, avoid=frozenset(blocked), lang=lang)
            avoided, on_route = on_route, []
        except RoutingError:
            pass  # no way around: keep the route and say which reports it crosses
    return {**result, "avoided_reports": avoided, "through_reports": on_route}


def compute_route(request: Request, from_lat: float, from_lng: float, to_id: str, mode: str,
                  avoid_reports: bool = True, lang: str = "en") -> dict:
    """Shared by the directions endpoint and the assistant. Raises HTTPException.
    `lang`: the language of the step text, warning and errors."""
    state = request.app.state
    if state.router is None:
        raise HTTPException(503, t(lang, "rerr.no_roads_installed"))
    loc = state.locations.get(to_id)
    if loc is None:
        raise HTTPException(404, t(lang, "rerr.unknown_location", id=to_id))
    blocked = state.reports.blocked_edges()
    try:
        if avoid_reports:
            result = plan_route(state.router, (from_lat, from_lng), (loc.lat, loc.lng), mode, loc.name, blocked, lang)
        else:
            result = state.router.route((from_lat, from_lng), (loc.lat, loc.lng), mode, loc.name, lang=lang)
            result = {**result, "avoided_reports": [],
                      "through_reports": [blocked[e] for e in result["edges"] if e in blocked]}
    except RoutingError as e:
        raise HTTPException(422, e.text(lang)) from e
    return {**result, "to_id": loc.id, "to_name": loc.name, "warning": t(lang, "ans.route_warning")}


@router.get("/route")
def route(
    request: Request,
    from_lat: float = Query(ge=-90, le=90),
    from_lng: float = Query(ge=-180, le=180),
    to_id: str = Query(max_length=64),
    mode: Literal["walk", "drive"] = "walk",
    avoid_reports: bool = True,
    lang: str = Query("en", max_length=8),
):
    return compute_route(request, from_lat, from_lng, to_id, mode, avoid_reports, norm(lang))
