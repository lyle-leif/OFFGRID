import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import llm
from app.services.reports import Limiter, ReportStore, public

T0 = 1_800_000_000.0
H = 3600


def rid():
    return str(uuid.uuid4())


@pytest.fixture
def store(reports_db):
    s = ReportStore(reports_db)
    yield s
    s.close()


# ---- store ---------------------------------------------------------------
def test_add_is_idempotent(store):
    r, created = store.add("rep-00001", "power_out", 13.75, 121.05, "dev-aaaa1", now=T0)
    assert created and r["confirms"] == 0
    again, created = store.add("rep-00001", "power_out", 0, 0, "dev-bbbb2", now=T0 + 60)
    assert not created and again == r
    assert len(store.active(T0)) == 1


def test_expiry_by_kind(store):
    store.add("road-0001", "road_flooded", 13.75, 121.05, "dev-aaaa1", now=T0)
    store.add("cntr-0001", "center_full", 13.75, 121.05, "dev-aaaa1", now=T0)
    assert {r["id"] for r in store.active(T0 + 2 * H - 1)} == {"road-0001", "cntr-0001"}
    assert {r["id"] for r in store.active(T0 + 2 * H + 1)} == {"cntr-0001"}
    assert store.active(T0 + 6 * H + 1) == []


def test_age_is_clamped_to_ttl(store):
    r, _ = store.add("old-00001", "road_blocked", 13.75, 121.05, "dev-aaaa1", age_s=30 * H, now=T0)
    assert r["created_at"] == T0 - 2 * H  # never older than its own lifetime
    r, _ = store.add("old-00002", "road_blocked", 13.75, 121.05, "dev-aaaa1", age_s=600, now=T0)
    assert public(r, now=T0)["age_min"] == 10


def test_confirm_extends_life_with_cap(store):
    store.add("road-0001", "road_flooded", 13.75, 121.05, "dev-aaaa1", now=T0)
    r = store.vote("road-0001", "dev-bbbb2", "confirm", now=T0 + 1.5 * H)
    assert r["expires_at"] == T0 + 3.5 * H
    for i in range(10):
        r = store.vote("road-0001", f"dev-cccc{i}", "confirm", now=T0 + 5.5 * H)
    assert r["expires_at"] == T0 + 6 * H  # at most 3 lifetimes after it was made


def test_one_vote_per_device_and_switching(store):
    store.add("rep-00001", "power_out", 13.75, 121.05, "dev-aaaa1", now=T0)
    assert store.vote("rep-00001", "dev-aaaa1", "confirm", now=T0)["confirms"] == 0  # own report
    store.vote("rep-00001", "dev-bbbb2", "confirm", now=T0)
    r = store.vote("rep-00001", "dev-bbbb2", "confirm", now=T0)
    assert (r["confirms"], r["disputes"]) == (1, 0)
    r = store.vote("rep-00001", "dev-bbbb2", "dispute", now=T0)
    assert (r["confirms"], r["disputes"]) == (0, 1)
    assert store.vote("missing-1", "dev-bbbb2", "confirm") is None


def test_trust_labels_and_hiding(store):
    store.add("rep-00001", "power_out", 13.75, 121.05, "dev-aaaa1", now=T0)
    assert public(store.get("rep-00001"), T0)["trust"] == "unverified"
    store.vote("rep-00001", "dev-b0000001", "confirm", now=T0)
    store.vote("rep-00001", "dev-b0000002", "confirm", now=T0)
    assert public(store.get("rep-00001"), T0)["trust"] == "confirmed"
    for i in range(3):
        store.vote("rep-00001", f"dev-d000000{i}", "dispute", now=T0)
    assert store.active(T0)  # 3 disputes vs 2 confirms: still shown
    store.vote("rep-00001", "dev-d0000009", "dispute", now=T0)
    assert store.active(T0) == []  # 4 vs 2: hidden
    store.set_flag("rep-00001", "verified")
    assert public(store.active(T0)[0], T0)["trust"] == "verified"  # a responder's word wins


def test_blocked_edges_and_purge(store):
    store.add("road-0001", "road_blocked", 13.75, 121.05, "dev-aaaa1", now=T0, edge_id=42)
    store.add("pwr-00001", "power_out", 13.75, 121.05, "dev-aaaa1", now=T0)
    assert store.blocked_edges(T0) == {42: "road-0001"}
    assert store.blocked_edges(T0 + 3 * H) == {}
    store.add("new-00001", "power_out", 13.75, 121.05, "dev-aaaa1", now=T0 + 2 * H + 25 * H)
    assert store.get("road-0001") is None and store.get("pwr-00001") is not None


def test_device_ids_are_not_stored(store, reports_db):
    store.add("rep-00001", "power_out", 13.75, 121.05, "dev-secret-123", now=T0)
    assert b"dev-secret-123" not in reports_db.read_bytes()


def test_limiter():
    lim = Limiter(2, 60)
    lim.hit("a", now=0)
    lim.hit("a", now=1)
    assert lim.blocked("a", now=2) and not lim.blocked("b", now=2)
    assert not lim.blocked("a", now=61)


# ---- API -----------------------------------------------------------------
@pytest.fixture
def client(monkeypatch):
    async def no_warm_up():
        return None

    async def fake_health():
        return {"ollama": "ok", "model": "test-model", "model_installed": True, "model_loaded": True}

    monkeypatch.setattr(llm, "warm_up", no_warm_up)
    monkeypatch.setattr(llm, "health", fake_health)
    with TestClient(app) as c:
        yield c


def evac_center(c):
    return next(l for l in c.get("/api/locations").json() if l["type"] == "evacuation_center")


def road_point(c):
    router = c.app.state.router
    e = next(e for e in router.edges if e.name and len(e.inner) >= 1)
    return e.inner[0], e.name


def post(c, **kw):
    body = {"id": rid(), "device": "phone-0001", **kw}
    return c.post("/api/reports", json=body)


def test_post_and_list(client):
    (lat, lng), name = road_point(client)
    r = post(client, kind="road_flooded", lat=lat + 0.0001, lng=lng)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["edge_id"] is not None and body["road_name"]
    assert body["trust"] == "unverified" and body["reports"] == 1 and body["age_min"] == 0
    assert [x["id"] for x in client.get("/api/reports").json()] == [body["id"]]
    assert client.get("/api/health").json()["reports"] == 1


def test_retry_returns_same_report(client):
    body = {"id": rid(), "device": "phone-0001", "kind": "power_out", "lat": 13.76, "lng": 121.06}
    a = client.post("/api/reports", json=body).json()
    b = client.post("/api/reports", json=body).json()
    assert a == b and len(client.get("/api/reports").json()) == 1


def test_queued_report_keeps_its_age(client):
    r = post(client, kind="power_out", lat=13.76, lng=121.06, age_s=1800).json()
    assert r["age_min"] == 30


def test_rejects_bad_reports(client):
    assert post(client, kind="power_out", lat=14.6, lng=121.0).status_code == 422  # Manila
    assert post(client, kind="tsunami", lat=13.76, lng=121.06).status_code == 422
    assert post(client, kind="center_full", lat=13.76, lng=121.06).status_code == 422  # no center
    hosp = next(l for l in client.get("/api/locations").json()
                if l["type"] == "hospital" and "evacuation_center" not in l["also"])
    assert post(client, kind="center_full", lat=13.76, lng=121.06, location_id=hosp["id"]).status_code == 422
    assert post(client, kind="power_out", lat=13.76, lng=121.06, location_id="nope").status_code == 404
    assert client.post("/api/reports", json={"id": "x", "device": "phone-0001", "kind": "power_out",
                                             "lat": 13.76, "lng": 121.06}).status_code == 422


def test_road_report_must_be_on_a_road(client):
    # Out in Balayan Bay, inside the box but far from any road.
    assert post(client, kind="road_blocked", lat=13.78, lng=120.82).status_code == 422


def test_center_report_pins_to_the_center(client):
    ec = evac_center(client)
    r = post(client, kind="center_full", lat=13.76, lng=121.06, location_id=ec["id"]).json()
    assert (r["lat"], r["lng"]) == (round(ec["lat"], 6), round(ec["lng"], 6))
    assert r["location_name"] == ec["name"]


def test_vote_endpoint(client):
    r = post(client, kind="power_out", lat=13.76, lng=121.06).json()
    v = client.post(f"/api/reports/{r['id']}/vote", json={"device": "phone-0002", "vote": "confirm"}).json()
    assert v["confirms"] == 1 and v["reports"] == 2
    assert client.post("/api/reports/nope-0000/vote", json={"device": "phone-0002", "vote": "confirm"}).status_code == 404


def test_rate_limit_per_device(client):
    codes = [post(client, kind="power_out", lat=13.76, lng=121.06).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429
    assert post(client, kind="power_out", lat=13.76, lng=121.06, device="phone-0002").status_code == 200


def test_responder_pin(client):
    pin = client.app.state.responder_pin
    r = post(client, kind="power_out", lat=13.76, lng=121.06).json()
    assert client.post(f"/api/reports/{r['id']}/verify").status_code == 403
    v = client.post(f"/api/reports/{r['id']}/verify", headers={"X-Responder-Pin": pin}).json()
    assert v["trust"] == "verified"
    assert client.post("/api/reports/responder", json={"pin": pin}).json() == {"ok": True}
    assert client.delete(f"/api/reports/{r['id']}", headers={"X-Responder-Pin": pin}).status_code == 200
    assert client.get("/api/reports").json() == []


def test_wrong_pin_lockout(client):
    pin = client.app.state.responder_pin
    for _ in range(5):
        assert client.post("/api/reports/responder", json={"pin": "000000x"}).status_code == 403
    assert client.post("/api/reports/responder", json={"pin": pin}).status_code == 429


# ---- the assistant answers from reports ------------------------------------------
def ask(c, **payload):
    lines = c.post("/api/assistant/ask", json=payload).text.splitlines()
    return [json.loads(x) for x in lines if x.strip()]


def test_assistant_answers_road_question_from_reports(client):
    (lat, lng), name = road_point(client)
    r = post(client, kind="road_flooded", lat=lat, lng=lng).json()
    ev = ask(client, question=f"Is {r['road_name']} flooded?")
    text, done = ev[0]["text"], ev[-1]
    assert done["status"] == "reports" and [x["id"] for x in done["reports"]] == [r["id"]]
    assert f"1 report on {r['road_name']}" in text and "unverified, just now, 1 report" in text
    assert "Never walk or drive through floodwater." in text and "may be wrong" in text


def test_assistant_says_when_there_are_no_reports(client):
    ev = ask(client, question="Is the road flooded?")
    assert ev[-1]["status"] == "reports" and ev[-1]["reports"] == []
    assert ev[0]["text"].startswith("No road reports in the area in the last 2 hours. That does not mean the roads are safe.")


def test_assistant_center_question_uses_selected_place(client):
    ec = evac_center(client)
    post(client, kind="center_full", lat=ec["lat"], lng=ec["lng"], location_id=ec["id"])
    ev = ask(client, question="Is it full?", location_id=ec["id"])
    assert ev[-1]["status"] == "reports" and ev[-1]["location_used"] == ec["id"]
    assert "Evacuation center full: unverified" in ev[0]["text"]


def test_any_reports_near_me_is_not_a_place_search(client):
    ev = ask(client, question="Any reports near me?", from_pos={"lat": 13.7672, "lng": 121.0660})
    assert ev[-1]["status"] == "reports"
    assert ev[0]["text"].startswith("No reports within 3 km of you")


def test_advice_question_still_uses_the_guide(client, monkeypatch):
    async def no_ai(messages):
        raise llm.LLMError("off")
        yield  # pragma: no cover
    monkeypatch.setattr(llm, "chat_stream", no_ai)
    ev = ask(client, question="Is it safe to walk through floodwater?")
    assert ev[0]["type"] == "passages" and ev[-1]["status"] == "grounded"


# ---- directions avoid reported roads --------------------------------------------
def test_route_goes_around_a_reported_road(client):
    loc = next(l for l in client.get("/api/locations").json() if l["id"] == "osm-way-129493352")  # BatStateU
    q = {"from_lat": 13.7672, "from_lng": 121.0660, "to_id": loc["id"], "mode": "drive"}
    before = client.get("/api/route", params=q).json()
    assert before["avoided_reports"] == [] and before["through_reports"] == []
    # Report the longest road segment of that route as blocked.
    router = client.app.state.router
    ei = max(before["edges"], key=lambda e: router.edges[e].length)
    lat, lng = router._point_at(ei, router.edges[ei].length / 2)
    rep = post(client, kind="road_blocked", lat=lat, lng=lng).json()
    assert rep["edge_id"] == ei
    after = client.get("/api/route", params=q).json()
    assert ei not in after["edges"] and after["avoided_reports"] == [rep["id"]]
    assert after["distance_m"] >= before["distance_m"]
    # Turned off: the original route, flagged.
    off = client.get("/api/route", params={**q, "avoid_reports": "false"}).json()
    assert off["edges"] == before["edges"] and off["through_reports"] == [rep["id"]]
    # The assistant's route text says so too.
    ev = ask(client, question="How do I get there?", location_id=loc["id"],
             from_pos={"lat": 13.7672, "lng": 121.0660}, travel_mode="drive")
    assert "goes around 1 road people reported flooded or blocked" in ev[0]["text"]


def test_vote_limit_per_address(client):
    """Made-up phone ids from one address can't dispute a true report away."""
    (lat, lng), _ = road_point(client)
    rid_ = post(client, kind="road_flooded", lat=lat, lng=lng).json()["id"]
    codes = [client.post(f"/api/reports/{rid_}/vote", json={"device": f"fake-phone-{i:04d}", "vote": "dispute"}).status_code
             for i in range(4)]
    assert codes == [200, 429, 429, 429]  # one dispute per address on a report
    assert rid_ in [r["id"] for r in client.get("/api/reports").json()]  # so one place can't hide it (needs 2)
    confirms = [client.post(f"/api/reports/{rid_}/vote", json={"device": f"neighbour-{i:04d}", "vote": "confirm"}).status_code
                for i in range(4)]
    assert confirms == [200, 200, 200, 429]  # neighbours on one Wi-Fi can still back it up


def test_old_hub_database_is_upgraded(tmp_path):
    """A hub database made before Reports v2 (no details/note columns) still opens and lists."""
    import sqlite3

    path = tmp_path / "old.db"
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE reports (id TEXT PRIMARY KEY, kind TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
            location_id TEXT, edge_id INTEGER, road_name TEXT, created_at REAL NOT NULL, expires_at REAL NOT NULL,
            confirms INTEGER NOT NULL DEFAULT 0, disputes INTEGER NOT NULL DEFAULT 0,
            verified INTEGER NOT NULL DEFAULT 0, removed INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE votes (report_id TEXT NOT NULL, device_hash TEXT NOT NULL, vote TEXT NOT NULL,
            PRIMARY KEY (report_id, device_hash));
    """)
    db.execute("INSERT INTO reports VALUES ('old-report-1', 'power_out', 13.76, 121.06, NULL, NULL, NULL, ?, ?, 0, 0, 0, 0)",
               (T0, T0 + 6 * 3600))
    db.commit()
    db.close()
    store = ReportStore(path)
    cols = {row[1] for row in store._db.execute("PRAGMA table_info(reports)")}
    assert {"details", "note", "note_status", "flagged", "on_site", "acc_bucket"} <= cols
    [r] = store.active(T0 + 60)
    p = public(r, T0 + 60)
    assert (p["id"], p["details"], p["note"], p["on_site"]) == ("old-report-1", [], None, False)
    store.close()
