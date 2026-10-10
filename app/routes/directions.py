from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.services.routing import RoutingError

router = APIRouter(prefix="/api")

ROUTE_WARNING = (
    "Route uses saved OpenStreetMap road data and steers around roads people reported flooded or blocked, "
    "but reports can be missing or wrong. It does not know about other floods, landslides, closures, or damage. "
    "Follow official instructions and never walk or drive through floodwater."
)


def plan_route(road_router, start: tuple[float, float], end: tuple[float, float], mode: str, dest_name: str,
               blocked: dict[int, str]) -> dict:
    """Route that avoids reported roads (`blocked`: edge id -> report id). Plans the normal
    route first; only if it uses a reported road, plans again around them. If there is no
    way around, returns the normal route marked with the reports it goes through."""
    result = road_router.route(start, end, mode, dest_name)
    on_route = [blocked[e] for e in result["edges"] if e in blocked]
    avoided: list[str] = []
    if on_route:
        try:
            result = road_router.route(start, end, mode, dest_name, avoid=frozenset(blocked))
            avoided, on_route = on_route, []
        except RoutingError:
            pass  # no way around: keep the route and say which reports it crosses
    return {**result, "avoided_reports": avoided, "through_reports": on_route}


def compute_route(request: Request, from_lat: float, from_lng: float, to_id: str, mode: str,
                  avoid_reports: bool = True) -> dict:
    """Shared by the directions endpoint and the assistant. Raises HTTPException."""
    state = request.app.state
    if state.router is None:
        raise HTTPException(503, "Road data is not installed. Run tools/import_roads.py while online.")
    loc = state.locations.get(to_id)
    if loc is None:
        raise HTTPException(404, f"Unknown location_id '{to_id}'")
    blocked = state.reports.blocked_edges()
    try:
        if avoid_reports:
            result = plan_route(state.router, (from_lat, from_lng), (loc.lat, loc.lng), mode, loc.name, blocked)
        else:
            result = state.router.route((from_lat, from_lng), (loc.lat, loc.lng), mode, loc.name)
            result = {**result, "avoided_reports": [],
                      "through_reports": [blocked[e] for e in result["edges"] if e in blocked]}
    except RoutingError as e:
        raise HTTPException(422, str(e)) from e
    return {**result, "to_id": loc.id, "to_name": loc.name, "warning": ROUTE_WARNING}


@router.get("/route")
def route(
    request: Request,
    from_lat: float = Query(ge=-90, le=90),
    from_lng: float = Query(ge=-180, le=180),
    to_id: str = Query(max_length=64),
    mode: Literal["walk", "drive"] = "walk",
    avoid_reports: bool = True,
):
    return compute_route(request, from_lat, from_lng, to_id, mode, avoid_reports)
