from fastapi import APIRouter, HTTPException, Request

from app.models import Location

router = APIRouter(prefix="/api/locations")


@router.get("", response_model=list[Location])
def list_locations(request: Request):
    return request.app.state.locations.all()


@router.get("/{location_id}", response_model=Location)
def get_location(location_id: str, request: Request):
    loc = request.app.state.locations.get(location_id)
    if loc is None:
        raise HTTPException(404, f"Unknown location_id '{location_id}'")
    return loc
