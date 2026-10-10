"""Shared Overpass API client for the import scripts (run while online)."""

import time

import httpx

BBOX = (13.45, 120.55, 14.20, 121.50)  # south, west, north, east: all of Batangas (matches area.pmtiles and BOUNDS in app/static/map.js)
SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
USER_AGENT = "OFFGRID/0.1 (offline emergency map hackathon prototype)"


def bbox_str() -> str:
    return ",".join(str(x) for x in BBOX)


def fetch(query: str, timeout: float = 180) -> dict:
    """Try each server a few times; public Overpass servers are often busy (429/504)."""
    last = None
    for attempt in range(4):
        for url in SERVERS:
            print(f"Querying {url} (attempt {attempt + 1})...")
            try:
                r = httpx.post(url, data={"data": query}, headers={"User-Agent": USER_AGENT}, timeout=timeout)
                if r.status_code == 200 and r.headers.get("content-type", "").startswith("application/json"):
                    return r.json()
                last = f"HTTP {r.status_code}: {r.text[:120]!r}"
            except httpx.HTTPError as e:
                last = repr(e)
            print(f"  failed: {last}")
        time.sleep(15 * (attempt + 1))
    raise SystemExit(f"All Overpass servers failed ({last}). Try again later.")
