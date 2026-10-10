"""Import the road network for offline routing from OpenStreetMap (Overpass API).

Run while ONLINE, from the project root:
    .venv\\Scripts\\python tools\\import_roads.py
    .venv\\Scripts\\python tools\\import_roads.py --raw data\\raw\\roads-2026-10-09.json.gz   # re-process

Writes data/roads.json.gz: a compact graph where vertices are junctions/dead ends and
each edge keeps its full geometry, length, name, road class, and oneway flag.
Data (c) OpenStreetMap contributors, ODbL.
"""

import argparse
import gzip
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from overpass import bbox_str, fetch  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "roads.json.gz"
RAW_DIR = ROOT / "data" / "raw"

HIGHWAYS = (
    "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|"
    "tertiary|tertiary_link|unclassified|residential|living_street|service|road|track|"
    "pedestrian|footway|path|steps|cycleway|bridleway"
)


def build_query() -> str:
    return f"""[out:json][timeout:180];
way["highway"~"^({HIGHWAYS})$"]["area"!="yes"]({bbox_str()});
out body;
>;
out skel qt;"""


def meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat = math.radians((a[0] + b[0]) / 2)
    dx = (a[1] - b[1]) * 111_320 * math.cos(lat)
    dy = (a[0] - b[0]) * 110_540
    return math.hypot(dx, dy)


def oneway_flag(t: dict) -> int:
    v = t.get("oneway", "")
    if v in ("yes", "1", "true"):
        return 1
    if v == "-1":
        return -1
    if v == "no":
        return 0
    if t.get("junction") in ("roundabout", "circular") or t.get("highway") in ("motorway", "motorway_link"):
        return 1
    return 0


def build_graph(raw: dict) -> dict:
    coords = {e["id"]: (e["lat"], e["lon"]) for e in raw["elements"] if e["type"] == "node"}
    ways = [e for e in raw["elements"] if e["type"] == "way"]

    # A node is a graph vertex if it ends a way or is shared by more than one way.
    uses: dict[int, int] = {}
    for w in ways:
        for i, n in enumerate(w["nodes"]):
            uses[n] = uses.get(n, 0) + (2 if i in (0, len(w["nodes"]) - 1) else 1)
    vertex_ids: dict[int, int] = {}
    nodes: list[list[float]] = []

    def vid(osm_id: int) -> int:
        if osm_id not in vertex_ids:
            vertex_ids[osm_id] = len(nodes)
            lat, lng = coords[osm_id]
            nodes.append([round(lat, 6), round(lng, 6)])
        return vertex_ids[osm_id]

    names: dict[str, int] = {"": 0}
    classes: dict[str, int] = {}
    edges = []
    for w in ways:
        t = w.get("tags", {})
        refs = [n for n in w["nodes"] if n in coords]
        if len(refs) < 2:
            continue
        name = t.get("name") or t.get("ref") or ""
        name_i = names.setdefault(name, len(names))
        cls_i = classes.setdefault(t.get("highway", "road"), len(classes))
        ow = oneway_flag(t)
        start, geom, length = refs[0], [], 0.0
        for prev, cur in zip(refs, refs[1:]):
            length += meters(coords[prev], coords[cur])
            if uses.get(cur, 0) > 1 or cur == refs[-1]:
                edges.append([vid(start), vid(cur), round(length, 1), name_i, cls_i, ow,
                              [c for p in geom for c in (round(p[0], 6), round(p[1], 6))]])
                start, geom, length = cur, [], 0.0
            else:
                geom.append(coords[cur])
    return {
        "nodes": nodes,
        "names": list(names),
        "classes": list(classes),
        "edges": edges,  # [from, to, meters, name_idx, class_idx, oneway(1/-1/0), flat inner coords]
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, help="re-process a saved raw response (.json or .json.gz)")
    args = ap.parse_args()

    if args.raw:
        opener = gzip.open if args.raw.suffix == ".gz" else open
        with opener(args.raw, "rt", encoding="utf-8") as f:
            raw = json.load(f)
    else:
        raw = fetch(build_query(), timeout=300)
        date = raw.get("osm3s", {}).get("timestamp_osm_base", "")[:10] or "unknown"
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        raw_path = RAW_DIR / f"roads-{date}.json.gz"
        with gzip.open(raw_path, "wt", encoding="utf-8") as f:
            json.dump(raw, f)
        print(f"Saved raw response to {raw_path.relative_to(ROOT)}")

    graph = build_graph(raw)
    graph["retrieved"] = raw.get("osm3s", {}).get("timestamp_osm_base", "")[:10]
    with gzip.open(OUT, "wt", encoding="utf-8") as f:
        json.dump(graph, f, separators=(",", ":"))
    km = sum(e[2] for e in graph["edges"]) / 1000
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(graph['nodes'])} junctions, {len(graph['edges'])} segments, "
          f"{km:,.0f} km of road, {OUT.stat().st_size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
