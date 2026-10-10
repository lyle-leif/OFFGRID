"""Import real facilities for the map area from OpenStreetMap (Overpass API).

Run while ONLINE, from the project root:
    .venv\\Scripts\\python tools\\import_osm.py            # fetch fresh data
    .venv\\Scripts\\python tools\\import_osm.py --raw data\\raw\\osm-2026-10-09.json   # re-process a saved response

Writes data/locations.json and saves the raw Overpass response in data/raw/ for auditing.
Data (c) OpenStreetMap contributors, ODbL. Community-mapped: not an official government list.
"""

import argparse
import datetime as dt
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from overpass import bbox_str, fetch  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "locations.json"
RAW_DIR = ROOT / "data" / "raw"


def build_query() -> str:
    b = bbox_str()
    return f"""[out:json][timeout:90];
(
 nwr["amenity"~"^(hospital|clinic|doctors|police|fire_station|townhall|pharmacy|drinking_water|marketplace|ambulance_station)$"]({b});
 nwr["healthcare"~"^(hospital|clinic|centre|pharmacy)$"]({b});
 nwr["shop"~"^(supermarket|chemist|grocery)$"]({b});
 nwr["emergency"~"^(ambulance_station|rescue_station|disaster_response|drinking_water)$"]({b});
 nwr["evacuation_center"]({b});
 nwr["emergency_shelter"]({b});
 nwr["social_facility"="shelter"]["social_facility:for"~"disaster|displaced"]({b});
 nwr["office"="government"]["government"~"emergency"]({b});
);
out tags center;"""


def is_evacuation_site(t: dict) -> bool:
    return t.get("evacuation_center") == "yes" or t.get("emergency_shelter") == "yes" or t.get("social_facility") == "shelter"


def classify(t: dict) -> str | None:
    """Map OSM tags to an app facility type. Evacuation sites win (that decides the pin);
    what else the place is (hospital, town hall...) goes into `also` via base_type()."""
    if is_evacuation_site(t):
        return "evacuation_center"
    return base_type(t)


def base_type(t: dict) -> str | None:
    """The facility type ignoring any evacuation tag. Order matters: most specific first."""
    amenity, health, shop, emergency = t.get("amenity"), t.get("healthcare"), t.get("shop"), t.get("emergency")
    if amenity == "hospital" or health == "hospital":
        return "hospital"
    if emergency in ("ambulance_station", "rescue_station", "disaster_response") or amenity == "ambulance_station" \
            or "emergency" in t.get("government", ""):
        return "rescue"
    if amenity in ("clinic", "doctors") or health in ("clinic", "centre"):
        return "health_center"
    if amenity == "pharmacy" or shop == "chemist" or health == "pharmacy":
        return "pharmacy"
    if amenity == "police":
        return "police"
    if amenity == "fire_station":
        return "fire_station"
    if amenity == "townhall":
        # Many barangay halls lack townhall:type, so the name decides too ("Barangay 8 Hall").
        name = (t.get("name") or "").lower()
        barangay = t.get("townhall:type") in ("barangay", "village") or "barangay" in name or "brgy" in name
        return "barangay_hall" if barangay else "town_hall"
    if amenity == "drinking_water" or emergency == "drinking_water":
        return "drinking_water"
    if shop in ("supermarket", "grocery") or amenity == "marketplace":
        return "market"
    return None


def address(t: dict) -> str | None:
    if t.get("addr:full"):
        return t["addr:full"]
    street = " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x)
    parts = [
        street,
        t.get("addr:barangay") or t.get("addr:village") or t.get("addr:place") or t.get("addr:neighbourhood"),
        t.get("addr:city") or t.get("addr:town") or t.get("addr:municipality"),
        t.get("addr:province"),
    ]
    seen, out = set(), []
    for p in parts:
        if p and p.lower() not in seen:
            seen.add(p.lower())
            out.append(p)
    return ", ".join(out) or None


def description(t: dict, kind: str) -> str | None:
    bits = []
    if kind == "evacuation_center":
        what = t.get("amenity") or t.get("leisure") or t.get("building")
        if what and what not in ("yes",):
            bits.append(f"Tagged as an evacuation center in OpenStreetMap ({what.replace('_', ' ')})")
        else:
            bits.append("Tagged as an evacuation center in OpenStreetMap")
    if t.get("operator"):
        bits.append(f"Operator: {t['operator']}")
    if t.get("emergency") == "yes" and kind == "hospital":
        bits.append("Emergency department listed in OpenStreetMap")
    if t.get("beds"):
        bits.append(f"Beds (OSM): {t['beds']}")
    return ". ".join(bits) or None


def name_for(t: dict, kind: str) -> str | None:
    name = t.get("name") or t.get("name:en") or t.get("official_name")
    if name:
        return name
    if kind == "rescue" and t.get("operator"):
        return f"{t['operator']} (ambulance/rescue)"
    return None  # unnamed objects are dropped


def convert(raw: dict, retrieved: str) -> tuple[list[dict], dict]:
    records, skipped = [], {"unnamed": 0, "unclassified": 0, "no_coords": 0}
    for e in raw["elements"]:
        t = e.get("tags", {})
        kind = classify(t)
        if not kind:
            skipped["unclassified"] += 1
            continue
        name = name_for(t, kind)
        if not name:
            skipped["unnamed"] += 1
            continue
        lat = e.get("lat", e.get("center", {}).get("lat"))
        lng = e.get("lon", e.get("center", {}).get("lon"))
        if lat is None or lng is None:
            skipped["no_coords"] += 1
            continue
        rec = {
            "id": f"osm-{e['type']}-{e['id']}",
            "name": name.strip(),
            "type": kind,
            # e.g. a hospital that is also an evacuation site must still come up for "nearest hospital"
            "also": [b] if kind == "evacuation_center" and (b := base_type(t)) else None,
            "address": address(t),
            "description": description(t, kind),
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "phone": t.get("phone") or t.get("contact:phone") or t.get("emergency:phone"),
            "opening_hours": t.get("opening_hours"),
            "website": t.get("website") or t.get("contact:website"),
            "osm_url": f"https://www.openstreetmap.org/{e['type']}/{e['id']}",
            "source": f"OpenStreetMap contributors (ODbL), retrieved {retrieved}",
            "verified_on": None,
            "is_sample": False,
        }
        records.append({k: v for k, v in rec.items() if v is not None or k in ("verified_on",)})
    records.sort(key=lambda r: (r["type"], r["name"].lower(), -len(r)))
    # Same object can come back via two query clauses; keep the first.
    unique = list({r["id"]: r for r in reversed(records)}.values())[::-1]
    # OSM often maps one place twice (a point and a building outline). Merge same type +
    # same name within 300 m, keeping the record with more details (sorted first above).
    kept: list[dict] = []
    for r in unique:
        dup = next((k for k in kept if k["type"] == r["type"] and k["name"].lower() == r["name"].lower()
                    and _meters(k, r) < 300), None)
        if dup:
            skipped["duplicate"] = skipped.get("duplicate", 0) + 1
            for field, value in r.items():
                dup.setdefault(field, value)  # fill gaps from the duplicate
        else:
            kept.append(r)
    return kept, skipped


def _meters(a: dict, b: dict) -> float:
    lat = math.radians((a["lat"] + b["lat"]) / 2)
    dx = (a["lng"] - b["lng"]) * 111_320 * math.cos(lat)
    dy = (a["lat"] - b["lat"]) * 110_540
    return math.hypot(dx, dy)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, help="process a saved Overpass JSON instead of fetching")
    args = ap.parse_args()

    if args.raw:
        raw = json.loads(args.raw.read_text(encoding="utf-8"))
        retrieved = raw.get("osm3s", {}).get("timestamp_osm_base", "")[:10] or "unknown date"
    else:
        raw = fetch(build_query())
        retrieved = raw.get("osm3s", {}).get("timestamp_osm_base", "")[:10] or dt.date.today().isoformat()
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        raw_path = RAW_DIR / f"osm-{retrieved}.json"
        raw_path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
        print(f"Saved raw response to {raw_path.relative_to(ROOT)}")

    records, skipped = convert(raw, retrieved)
    OUT.write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
    counts: dict[str, int] = {}
    for r in records:
        counts[r["type"]] = counts.get(r["type"], 0) + 1
    print(f"Wrote {len(records)} facilities to {OUT.relative_to(ROOT)}")
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {k:18} {v}")
    print(f"Skipped: {skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
