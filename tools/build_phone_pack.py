"""Build the phone data pack: everything a phone needs to work with no hub and no internet.

Run from the project root after updating any data (guides, facilities, roads, map):
    .venv\\Scripts\\python tools\\build_phone_pack.py

Writes app/static/pack/:
  guides.json     guide sections + the exact search index the hub uses (BM25 weights,
                  synonyms, stopwords, gate thresholds), so phone answers match the hub's
  lexicon.json    the spelling dictionary (app/services/normalize.py), so typos are fixed
                  the same way on the phone
  roads.bin       the road network as compact binary arrays (typed arrays in the browser:
                  ~10x smaller in memory than JSON objects, fine on 2 GB phones)
  roads-meta.json layout of roads.bin, road names, road classes
  version.json    data dates + a pack id; phones re-download when it changes
"""

import gzip
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config  # noqa: E402
from app.services.retrieval import STOPWORDS, SYNONYMS, Retriever, load_chunks  # noqa: E402
from app.services.routing import Router  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "static" / "pack"


def build_guides() -> tuple[dict, str]:
    chunks = load_chunks(config.GUIDES_DIR)
    bm25 = Retriever(chunks)._bm25
    dates = []
    for path in sorted(config.GUIDES_DIR.glob("*.md")):
        for line in path.read_text(encoding="utf-8").splitlines()[:8]:
            if line.startswith("retrieved_on:"):
                dates.append(line.split(":", 1)[1].strip())
    pack = {
        "chunks": [
            {"doc": c.doc, "chunk_id": c.chunk_id, "doc_title": c.doc_title, "title": c.title, "text": c.text,
             **c.trust(), "tf": bm25.doc_freqs[i], "len": bm25.doc_len[i]}
            for i, c in enumerate(chunks)
        ],
        # Exact BM25 weights from the hub's index (rank_bm25), so scores match to the decimal.
        "idf": {t: float(v) for t, v in bm25.idf.items()},
        "avgdl": float(bm25.avgdl),
        "k1": bm25.k1,
        "b": bm25.b,
        "stopwords": sorted(STOPWORDS),
        "synonyms": SYNONYMS,
        "params": {"top_k": config.TOP_K, "threshold": config.THRESHOLD, "min_terms": config.MIN_TERMS,
                   "strong_score": config.STRONG_SCORE, "relative": config.RELATIVE_SCORE},
    }
    return pack, max(dates) if dates else ""


def build_roads() -> tuple[bytes, dict]:
    router = Router.load(config.ROADS_FILE)
    n, e = len(router.nodes), len(router.edges)
    names = sorted({ed.name for ed in router.edges})
    classes = sorted({ed.cls for ed in router.edges})
    name_ix = {s: i for i, s in enumerate(names)}
    cls_ix = {s: i for i, s in enumerate(classes)}

    node_lat = np.array([round(p[0] * 1e6) for p in router.nodes], dtype="<i4")
    node_lng = np.array([round(p[1] * 1e6) for p in router.nodes], dtype="<i4")
    geom_start = np.zeros(e + 1, dtype="<u4")
    g_lat, g_lng = [], []
    for i, ed in enumerate(router.edges):
        geom_start[i] = len(g_lat)
        for lat, lng in ed.inner:
            g_lat.append(round(lat * 1e6))
            g_lng.append(round(lng * 1e6))
    geom_start[e] = len(g_lat)
    walk, drive = router.usable["walk"], router.usable["drive"]
    arrays = [
        ("nodeLat", node_lat), ("nodeLng", node_lng),
        ("edgeU", np.array([ed.u for ed in router.edges], dtype="<u4")),
        ("edgeV", np.array([ed.v for ed in router.edges], dtype="<u4")),
        # Lengths are stored to 0.1 m in the road data: keep them as exact whole decimetres
        # (float32 would turn 37.3 into 37.2999…, and rounded step lengths would drift by 1 m).
        ("edgeLen", np.array([round(ed.length * 10) for ed in router.edges], dtype="<u4")),
        ("geomStart", geom_start),
        ("geomLat", np.array(g_lat, dtype="<i4")), ("geomLng", np.array(g_lng, dtype="<i4")),
        ("edgeName", np.array([name_ix[ed.name] for ed in router.edges], dtype="<u4" if len(names) > 65535 else "<u2")),
        ("edgeCls", np.array([cls_ix[ed.cls] for ed in router.edges], dtype="u1")),
        ("edgeOneway", np.array([ed.oneway for ed in router.edges], dtype="i1")),
        # bit 0: usable for walking, bit 1: usable for driving (main road network only)
        ("edgeFlags", np.array([(i in walk) | ((i in drive) << 1) for i in range(e)], dtype="u1")),
    ]
    layout, blob = {}, bytearray()
    for name, arr in arrays:
        while len(blob) % 4:  # keep every array 4-byte aligned for typed-array views
            blob.append(0)
        layout[name] = {"offset": len(blob), "length": int(arr.size), "type": arr.dtype.str.lstrip("<|")}
        blob += arr.tobytes()
    meta = {"nodes": n, "edges": e, "geom": int(geom_start[e]), "layout": layout, "edgeLenScale": 10, "names": names,
            "classes": classes, "retrieved": router.data_date}
    return bytes(blob), meta


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    guides, guides_date = build_guides()
    (OUT / "guides.json").write_text(json.dumps(guides, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    from app.main import _load_router, app_lexicon  # noqa: E402  (same dictionary as the hub)
    from app.services.locations import LocationStore  # noqa: E402
    lexicon = app_lexicon(load_chunks(config.GUIDES_DIR), LocationStore(config.LOCATIONS_FILE), _load_router())
    (OUT / "lexicon.json").write_text(json.dumps(lexicon, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    roads_bin, roads_meta = build_roads()
    (OUT / "roads.bin").write_bytes(roads_bin)
    (OUT / "roads-meta.json").write_text(json.dumps(roads_meta, ensure_ascii=False, separators=(",", ":")),
                                         encoding="utf-8")

    places = json.loads(config.LOCATIONS_FILE.read_text(encoding="utf-8"))
    places_date = next((p["source"].rsplit("retrieved ", 1)[-1] for p in places if "retrieved " in p.get("source", "")), "")
    map_date = "2026-10-08"  # the Protomaps daily build used for area.pmtiles (see README)
    digest = hashlib.sha256()
    for f in ["guides.json", "lexicon.json", "roads.bin", "roads-meta.json"]:
        digest.update((OUT / f).read_bytes())
    digest.update(config.LOCATIONS_FILE.read_bytes())
    # The app's own code and map styles too, so phones re-save their copy after any app
    # change, not only after a data change.
    static = ROOT / "app" / "static"
    for f in sorted(static.rglob("*")):
        if f.is_file() and f.suffix in {".js", ".css", ".html", ".json", ".webmanifest"} and OUT not in f.parents:
            digest.update(f.relative_to(static).as_posix().encode())
            digest.update(f.read_bytes())
    digest.update((ROOT / "app" / "static" / "map" / "area.pmtiles").stat().st_size.to_bytes(8, "little"))
    version = {
        "pack": digest.hexdigest()[:12],
        "dates": {"map": map_date, "places": places_date, "roads": roads_meta["retrieved"], "guides": guides_date},
    }
    (OUT / "version.json").write_text(json.dumps(version, indent=1), encoding="utf-8")

    sizes = {f.name: f.stat().st_size for f in OUT.iterdir()}
    print(f"Phone pack {version['pack']} written to {OUT.relative_to(ROOT)}:")
    for name, size in sorted(sizes.items()):
        print(f"  {name:16} {size / 1e6:6.2f} MB")
    print(f"  roads: {roads_meta['nodes']} junctions, {roads_meta['edges']} segments, {roads_meta['geom']} shape points")
    print(f"  dates: {version['dates']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
