import json
from pathlib import Path

from app.models import Location


class LocationStore:
    """Loads and validates locations.json once. Bad data fails startup loudly."""

    def __init__(self, path: Path):
        raw = json.loads(path.read_text(encoding="utf-8"))
        records = [Location.model_validate(r) for r in raw]
        self._by_id = {r.id: r for r in records}
        if len(self._by_id) != len(records):
            raise ValueError(f"duplicate location ids in {path}")

    def all(self) -> list[Location]:
        return list(self._by_id.values())

    def get(self, location_id: str) -> Location | None:
        return self._by_id.get(location_id)
