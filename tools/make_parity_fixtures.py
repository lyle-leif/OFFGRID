"""Record what the hub answers, so the phone engine (app/static/offline/) can be checked
against it. Re-run after changing guides, places, roads or answer logic:
    .venv\\Scripts\\python tools\\make_parity_fixtures.py
Then run the tests (pytest runs the Node parity tests too).
"""

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app import config  # noqa: E402
from app.main import app  # noqa: E402
from app.services import intents, llm, report_answers  # noqa: E402
from app.services.locations import LocationStore  # noqa: E402
from app.services.retrieval import Retriever, load_chunks  # noqa: E402
from app.services.routing import Router  # noqa: E402
from tests.test_intents import CASES, NOT_INTENTS, REPORT_CASES  # noqa: E402
from tests.test_retrieval import COVERED, UNCOVERED  # noqa: E402

OUT = ROOT / "tests" / "fixtures"

NEAR_BMC = {"lat": 13.7672, "lng": 121.0660}
NASUGBU = {"lat": 14.0700, "lng": 120.6330}
BSU = "osm-way-129493352"

ROUTES = [
    ((13.7672, 121.0660), (13.754146, 121.053128), "walk"),
    ((13.7672, 121.0660), (13.754146, 121.053128), "drive"),
    ((13.754146, 121.053128), (13.767024, 121.066773), "walk"),
    ((13.9411, 121.1631), (13.8270, 121.3960), "drive"),
    ((14.0700, 120.6330), (14.0800, 120.6400), "walk"),
    ((13.7672, 121.0660), (13.767024, 121.066773), "drive"),
]

ASKS = [
    {"question": "nearest hospital", "from_pos": NEAR_BMC, "travel_mode": "drive"},
    {"question": "pinakamalapit na evacuation center", "from_pos": NEAR_BMC},
    {"question": "nearest hospital", "from_pos": NASUGBU, "travel_mode": "drive"},
    {"question": "Where's the nearest place to go?", "from_pos": NEAR_BMC},
    {"question": "What's near me?", "from_pos": NEAR_BMC},
    {"question": "How far is it?", "location_id": BSU, "from_pos": NEAR_BMC},
    {"question": "Contact number?", "location_id": BSU},
    {"question": "Is it open?", "location_id": BSU},
    {"question": "How do I get there?", "location_id": BSU, "from_pos": NEAR_BMC, "travel_mode": "drive"},
    {"question": "How do I get there?", "location_id": BSU},
    {"question": "nearest hospital"},
    {"question": "How do I stop bleeding?"},
    {"question": "What number do I call for an emergency in Batangas City?"},
    {"question": "What is the capital of France?"},
    {"question": "What is the capital of France?",
     "previous": {"question": "How do I stop bleeding?", "answer": "Press firmly."}},
    {"question": "para sa matanda?",
     "previous": {"question": "What should I pack in my go-bag?", "answer": "Water and food."}},
    {"question": "what about for elderly people?",
     "previous": {"question": "What should I pack in my go-bag?", "answer": "Water and food."}},
]


# Situation reports as phones receive them (GET /api/reports), fixed so answers are stable.
def _report(rid, kind, label, lat, lng, age, trust="unverified", confirms=0, disputes=0, road=None, loc=None, loc_name=None):
    ttl = {"road_flooded": 120, "road_blocked": 120, "center_full": 360, "center_open": 360,
           "water_available": 360, "power_out": 360, "medical_need": 120}[kind]
    return {"id": rid, "kind": kind, "label": label, "lat": lat, "lng": lng, "location_id": loc, "location_name": loc_name,
            "road_name": road, "edge_id": None, "age_min": age, "expires_in_min": ttl - age, "ttl_min": ttl,
            "confirms": confirms, "disputes": disputes, "reports": 1 + confirms, "trust": trust}


def report_fixtures() -> dict:
    locs = LocationStore(config.LOCATIONS_FILE)
    center = next(l for l in locs.all() if l.type == "evacuation_center" and l.lat < 13.80 and l.lng < 121.10)
    reports = [
        _report("r-power", "power_out", "Power out", 13.7680, 121.0650, 5),
        _report("r-flood", "road_flooded", "Road flooded", 13.7565, 121.0583, 25, road="P. Burgos Street"),
        _report("r-center", "center_full", "Evacuation center full", center.lat, center.lng, 40, trust="verified",
                loc=center.id, loc_name=center.name),
        _report("r-block", "road_blocked", "Road blocked", 13.7600, 121.0590, 70, trust="confirmed", confirms=2,
                disputes=1, road="Rizal Avenue"),
        _report("r-water", "water_available", "Drinking water available", 13.9400, 121.1630, 200),
    ]
    asks = [
        {"question": "Is P. Burgos flooded?"},
        {"question": "Is the road flooded?", "from_pos": NEAR_BMC},
        {"question": "Is the road flooded?"},
        {"question": "baha ba sa Rizal Avenue?"},
        {"question": "Is it full?", "location_id": center.id},
        {"question": "Is the road to Lipa open?", "location_id": center.id},
        {"question": "may kuryente ba?", "from_pos": NEAR_BMC},
        {"question": "Where can I get drinking water?", "from_pos": NEAR_BMC},
        {"question": "Any reports near me?", "from_pos": NEAR_BMC},
        {"question": "Any reports near me?", "from_pos": NASUGBU},
    ]
    cases = []
    for body in asks:
        loc = locs.get(body["location_id"]) if body.get("location_id") else None
        kinds = intents.report_query(body["question"], bool(loc and "evacuation_center" in (loc.type, *loc.also)))
        assert kinds, body
        place = {"id": loc.id, "name": loc.name, "lat": loc.lat, "lng": loc.lng} if loc else None
        pos = (body["from_pos"]["lat"], body["from_pos"]["lng"]) if body.get("from_pos") else None
        text, done = report_answers.answer(body["question"], kinds, reports, place, pos)
        cases.append({"body": body, "kinds": kinds, "text": text, "ids": [r["id"] for r in done["reports"]],
                      "location_used": done["location_used"]})
    return {"reports": reports, "cases": cases}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    (OUT / "intents.json").write_text(json.dumps({
        "cases": [{"q": q, "has_place": hp, "kind": i.kind, "ftype": i.ftype} for q, hp, i in CASES],
        "none": [{"q": q, "has_place": hp} for q, hp in NOT_INTENTS],
        "reports": [{"q": q, "place_is_center": c, "kinds": k} for q, c, k in REPORT_CASES],
    }, indent=1, ensure_ascii=False), encoding="utf-8")

    r = Retriever(load_chunks(config.GUIDES_DIR))
    search = []
    for q in [c[0] for c in COVERED] + UNCOVERED:
        ev = r.evidence(q, config.TOP_K, config.THRESHOLD, config.MIN_TERMS, config.STRONG_SCORE, config.RELATIVE_SCORE)
        top = r.search(q, config.TOP_K)
        search.append({"q": q, "evidence": [h.chunk.chunk_id for h in ev],
                       "top": [[h.chunk.chunk_id, round(h.score, 6), h.matched_terms] for h in top]})

    router = Router.load(config.ROADS_FILE)
    routes = []
    for a, b, mode in ROUTES:
        res = router.route(a, b, mode, "X")
        routes.append({"from": a, "to": b, "mode": mode, "distance_m": res["distance_m"],
                       "duration_min": res["duration_min"], "steps": [s["instruction"] for s in res["steps"]],
                       "step_m": [s["distance_m"] for s in res["steps"]]})
        # The same trip with its longest road segment reported blocked.
        avoid = [max(res["edges"], key=lambda e: router.edges[e].length)]
        try:
            alt = router.route(a, b, mode, "X", avoid=frozenset(avoid))
            routes.append({"from": a, "to": b, "mode": mode, "avoid": avoid, "distance_m": alt["distance_m"],
                           "duration_min": alt["duration_min"], "steps": [s["instruction"] for s in alt["steps"]],
                           "step_m": [s["distance_m"] for s in alt["steps"]], "edges": alt["edges"]})
        except Exception as e:  # no way around: the phone must fail the same way
            routes.append({"from": a, "to": b, "mode": mode, "avoid": avoid, "error": str(e)})

    # How the hub's spelling fixer reads every question in the bank (plus a few edge cases),
    # so the phone's copy (offline/normalize.js) can be checked word for word.
    bank = json.loads((ROOT / "tests" / "question_bank.json").read_text(encoding="utf-8"))
    norm_qs = [q for g in bank["groups"] for q in g["qs"]] + [
        "San Jose evacuation center", "signal no. 2", "were is it", "buto", "HELPPPP", "pinaka-malapit",
        "\u2018nearest\u2019 hospitl", "Para\u00f1aque", "how 2 get there", "ther", "",
    ]
    from app.main import _load_router, app_lexicon  # noqa: E402
    from app.services.locations import LocationStore  # noqa: E402
    from app.services.normalize import Normalizer  # noqa: E402
    normalizer = Normalizer(app_lexicon(load_chunks(config.GUIDES_DIR), LocationStore(config.LOCATIONS_FILE),
                                        _load_router()))
    normalized = [[q, normalizer.normalize(q)] for q in norm_qs]

    asks = []
    async def no_llm(messages):  # the phone never has the AI; compare the data-only paths
        raise llm.LLMError("no AI")
        yield  # pragma: no cover
    llm.chat_stream = no_llm
    config.REPORTS_DB = Path(tempfile.mkdtemp()) / "reports.db"  # never touch the hub's real reports
    with TestClient(app) as client:
        for body in ASKS:
            lines = client.post("/api/assistant/ask", json=body).text.splitlines()
            events = [json.loads(x) for x in lines if x.strip()]
            asks.append({"body": body, "events": events})

    (OUT / "parity.json").write_text(json.dumps({"search": search, "routes": routes, "asks": asks,
                                                 "normalize": normalized,
                                                 "report_answers": report_fixtures()},
                                                ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {OUT / 'intents.json'} and {OUT / 'parity.json'}: "
          f"{len(search)} searches, {len(routes)} routes, {len(asks)} asks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
