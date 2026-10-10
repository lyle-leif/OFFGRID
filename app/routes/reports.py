"""Situation reports API. Anyone may post and vote; responders (hub PIN) verify or remove."""

import hmac

from fastapi import APIRouter, Header, HTTPException, Request

from app import config
from app.models import NewReport, ReportVote, ResponderLogin
from app.services.reports import CENTER_KINDS, ROAD_KINDS, public
from app.services.routing import CLASS_LABEL, RoutingError

router = APIRouter(prefix="/api/reports")

ROAD_SNAP_M = 60  # a road report must be this close to a road


def _client(request: Request) -> str:
    return request.client.host if request.client else "?"


def _public(request: Request, r: dict) -> dict:
    loc = request.app.state.locations.get(r["location_id"]) if r["location_id"] else None
    return public(r, location_name=loc.name if loc else None)


def _check_pin(request: Request, pin: str | None) -> None:
    state = request.app.state
    ip = _client(request)
    if state.pin_failures.blocked(ip):
        raise HTTPException(429, "Too many wrong PINs. Wait 10 minutes and try again.")
    if not pin or not hmac.compare_digest(pin.encode(), state.responder_pin.encode()):
        state.pin_failures.hit(ip)
        raise HTTPException(403, "Wrong responder PIN.")


def active_public(request: Request) -> list[dict]:
    """Active reports as phones see them, newest first."""
    return [_public(request, r) for r in request.app.state.reports.active()]


@router.get("")
def list_reports(request: Request):
    return active_public(request)


@router.post("")
def add_report(body: NewReport, request: Request):
    state = request.app.state
    old = state.reports.get(body.id)
    if old is not None:  # a phone retrying a report the hub already has
        return _public(request, old)

    b = config.BBOX
    if not (b["min_lat"] <= body.lat <= b["max_lat"] and b["min_lng"] <= body.lng <= b["max_lng"]):
        raise HTTPException(422, "That point is outside the area this app covers.")
    ip = _client(request)
    if state.report_limits["device"].blocked(body.device) or state.report_limits["ip"].blocked(ip):
        raise HTTPException(429, "Too many reports from this phone. Try again later.")

    lat, lng, edge_id, road_name = body.lat, body.lng, None, None
    loc = state.locations.get(body.location_id) if body.location_id else None
    if body.location_id and loc is None:
        raise HTTPException(404, f"Unknown location_id '{body.location_id}'")
    if body.kind in CENTER_KINDS:
        if loc is None or "evacuation_center" not in (loc.type, *loc.also):
            raise HTTPException(422, "Choose an evacuation center for this report.")
        lat, lng = loc.lat, loc.lng
    elif body.kind in ROAD_KINDS and state.router is not None:
        try:
            snap = state.router.snap(body.lat, body.lng, "walk", max_m=ROAD_SNAP_M)
        except RoutingError:
            raise HTTPException(422, "Put the pin on the road itself.") from None
        e = state.router.edges[snap.edge]
        edge_id, road_name = snap.edge, e.name or CLASS_LABEL.get(e.cls, "road")
        lat, lng = snap.point

    r, created = state.reports.add(body.id, body.kind, lat, lng, body.device, body.age_s,
                                   location_id=loc.id if loc else None, edge_id=edge_id, road_name=road_name)
    if created:
        state.report_limits["device"].hit(body.device)
        state.report_limits["ip"].hit(ip)
    return _public(request, r)


@router.post("/{report_id}/vote")
def vote(report_id: str, body: ReportVote, request: Request):
    r = request.app.state.reports.vote(report_id, body.device, body.vote)
    if r is None:
        raise HTTPException(404, "That report no longer exists.")
    return _public(request, r)


@router.post("/responder")
def responder_login(body: ResponderLogin, request: Request):
    """Lets a phone check a PIN before showing responder buttons."""
    _check_pin(request, body.pin)
    return {"ok": True}


@router.post("/{report_id}/verify")
def verify(report_id: str, request: Request, x_responder_pin: str | None = Header(default=None)):
    _check_pin(request, x_responder_pin)
    r = request.app.state.reports.set_flag(report_id, "verified")
    if r is None:
        raise HTTPException(404, "That report no longer exists.")
    return _public(request, r)


@router.delete("/{report_id}")
def remove(report_id: str, request: Request, x_responder_pin: str | None = Header(default=None)):
    _check_pin(request, x_responder_pin)
    if request.app.state.reports.set_flag(report_id, "removed") is None:
        raise HTTPException(404, "That report no longer exists.")
    return {"ok": True}
