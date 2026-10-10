import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import llm


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


@pytest.fixture
def fake_llm(monkeypatch):
    calls = []

    async def chat_stream(messages):
        calls.append(messages)
        for piece in ["Pack diapers ", "and formula [go-bag#infants-and-young-children]."]:
            yield piece

    monkeypatch.setattr(llm, "chat_stream", chat_stream)
    return calls


def events(resp):
    return [json.loads(line) for line in resp.text.splitlines() if line.strip()]


def test_health(client):
    body = client.get("/api/health").json()
    assert body["backend"] == "ok"
    assert body["locations"] >= 1 and body["guide_chunks"] >= 1


def test_locations_list_and_get(client):
    locs = client.get("/api/locations").json()
    assert len(locs) >= 1
    one = client.get(f"/api/locations/{locs[0]['id']}").json()
    assert one == locs[0]


def test_unknown_location_404(client):
    assert client.get("/api/locations/nope").status_code == 404
    r = client.post("/api/assistant/ask", json={"question": "go bag baby", "location_id": "nope"})
    assert r.status_code == 404


def test_grounded_answer_streams_with_sources(client, fake_llm):
    r = client.post("/api/assistant/ask", json={"question": "What should I bring for my baby when evacuating?"})
    assert r.status_code == 200
    ev = events(r)
    # The exact guide text comes first, then the AI summary, then done.
    assert [e["type"] for e in ev[:-1]] == ["passages", "token", "token"]
    assert any(p["chunk_id"] == "go-bag#infants-and-young-children" for p in ev[0]["passages"])
    done = ev[-1]
    assert done["type"] == "done" and done["status"] == "grounded"
    assert done["summary"] == "verified"
    ids = [s["chunk_id"] for s in done["sources"]]
    assert "go-bag#infants-and-young-children" in ids
    # Sources are exactly the chunks that were sent to the model.
    prompt = fake_llm[0][1]["content"]
    assert all(f"[{i}]" in prompt for i in ids)


def test_uncovered_question_never_calls_model(client, fake_llm):
    r = client.post("/api/assistant/ask", json={"question": "What is the capital of France?"})
    ev = events(r)
    assert ev[-1]["status"] == "uncertain"
    assert fake_llm == []


def test_location_context_is_sent(client, fake_llm):
    evac = next(l for l in client.get("/api/locations").json() if l["type"] == "evacuation_center")
    r = client.post("/api/assistant/ask", json={"question": "What is this place?", "location_id": evac["id"]})
    done = events(r)[-1]
    assert done["location_used"] == evac["id"]
    prompt = fake_llm[0][1]["content"]
    assert evac["name"] in prompt and "not an official government list" in prompt


def test_location_data_is_valid(client):
    locs = client.get("/api/locations").json()
    assert len(locs) > 100
    assert len({l["id"] for l in locs}) == len(locs)
    # Every record sits inside (or right at the edge of) the offline map extract (all of Batangas).
    assert all(13.40 <= l["lat"] <= 14.25 and 120.50 <= l["lng"] <= 121.55 for l in locs)
    assert all(l["source"] for l in locs)
    assert not any(l["is_sample"] for l in locs)


def test_model_down_still_answers_with_guide_text(client, monkeypatch):
    async def broken(messages):
        raise llm.LLMError("Cannot reach the local model runtime. Is Ollama running?")
        yield  # pragma: no cover

    monkeypatch.setattr(llm, "chat_stream", broken)
    ev = events(client.post("/api/assistant/ask", json={"question": "How do I stop bleeding?"}))
    assert ev[0]["type"] == "passages" and ev[0]["passages"][0]["chunk_id"] == "first-aid-basics#bleeding"
    assert ev[-1]["status"] == "grounded" and ev[-1]["summary"] == "unavailable"
    assert "Ollama" in ev[-1]["summary_error"]


def test_model_down_without_guide_text_is_an_error(client, monkeypatch):
    async def broken(messages):
        raise llm.LLMError("Cannot reach the local model runtime. Is Ollama running?")
        yield  # pragma: no cover

    monkeypatch.setattr(llm, "chat_stream", broken)
    evac = next(l for l in client.get("/api/locations").json() if l["type"] == "evacuation_center")
    ev = events(client.post("/api/assistant/ask", json={"question": "Tell me about this place", "location_id": evac["id"]}))
    assert ev[-1]["type"] == "error"


def test_battery_saver_never_calls_the_model(client, fake_llm):
    ev = events(client.post("/api/assistant/ask", json={"question": "How do I stop bleeding?", "use_ai": False}))
    assert ev[0]["type"] == "passages"
    assert ev[-1]["status"] == "grounded" and ev[-1]["summary"] == "skipped"
    assert not any(e["type"] == "token" for e in ev)
    assert fake_llm == []


def test_summary_with_invented_number_is_dropped(client, monkeypatch):
    _fake_stream(monkeypatch, ["Call the Batangas City CDRRMO at (043) 702-9999 [hotlines#batangas-city-emergency-hotlines]."])
    ev = events(client.post("/api/assistant/ask", json={"question": "Batangas City rescue hotline"}))
    assert ev[0]["type"] == "passages"
    assert ev[-1]["summary"] == "dropped" and "(043) 702-9999" in ev[-1]["unsupported"]
    assert ev[-1]["status"] == "grounded"  # the guide text still answers it


def test_summary_with_correct_number_is_verified(client, monkeypatch):
    _fake_stream(monkeypatch, ["Call the Batangas City CDRRMO at (043) 702-3902 [hotlines#batangas-city-emergency-hotlines]."])
    ev = events(client.post("/api/assistant/ask", json={"question": "Batangas City rescue hotline"}))
    assert ev[-1]["summary"] == "verified"


@pytest.mark.parametrize("payload", [{}, {"question": ""}, {"question": "   "}, {"question": "x" * 501}])
def test_validation(client, payload):
    assert client.post("/api/assistant/ask", json=payload).status_code == 422


def test_static_index_served(client):
    r = client.get("/")
    assert r.status_code == 200 and "<html" in r.text.lower()


def _fake_stream(monkeypatch, pieces):
    calls = []

    async def chat_stream(messages):
        calls.append(messages)
        for p in pieces:
            yield p

    monkeypatch.setattr(llm, "chat_stream", chat_stream)
    return calls


@pytest.mark.parametrize("pieces", [
    ["The provided information does not contain ", "the mayor's phone number."],
    ["This is not in the saved information."],
    ["Wala sa impormasyon na naka-save."],
    [],
])
def test_model_refusal_is_labelled_uncertain(client, monkeypatch, pieces):
    _fake_stream(monkeypatch, pieces)
    ev = events(client.post("/api/assistant/ask", json={"question": "How do I stop bleeding?"}))
    assert ev[-1]["status"] == "uncertain" and ev[-1]["sources"] == []


@pytest.mark.parametrize("pieces", [
    ["Press firmly on the wound [first-aid-basics#bleeding]."],
    ["Press firmly on the wound with a clean cloth and keep pressing. If blood soaks through, add more "
     "cloth on top. The guide does not cover stitches, so see a health worker for deep wounds "
     "[first-aid-basics#bleeding]."],
])
def test_real_answers_stay_grounded(client, monkeypatch, pieces):
    _fake_stream(monkeypatch, pieces)
    ev = events(client.post("/api/assistant/ask", json={"question": "How do I stop bleeding?"}))
    assert ev[-1]["status"] == "grounded" and ev[-1]["sources"]


def test_follow_up_uses_previous_turn(client, monkeypatch):
    calls = _fake_stream(monkeypatch, ["Pack extra maintenance medicine."])
    previous = {"question": "What should I put in my go-bag?", "answer": "Water, food, documents [go-bag#water-and-food]."}
    ev = events(client.post("/api/assistant/ask", json={"question": "what about for elderly people?", "previous": previous}))
    assert ev[-1]["status"] == "grounded"
    assert "go-bag#older-adults-persons-with-disabilities-and-pets" in [s["chunk_id"] for s in ev[-1]["sources"]]
    roles = [m["role"] for m in calls[0]]
    assert roles == ["system", "user", "assistant", "user"]
    assert calls[0][2]["content"] == previous["answer"]


def test_unrelated_question_without_previous_is_gated(client, fake_llm):
    ev = events(client.post("/api/assistant/ask", json={"question": "what about for them?"}))
    assert ev[-1]["status"] == "uncertain" and fake_llm == []


def test_invented_citation_does_not_make_refusal_grounded(client, monkeypatch):
    _fake_stream(monkeypatch, ["[mayor#phone-number] is not in the saved information."])
    ev = events(client.post("/api/assistant/ask", json={"question": "What is the phone number of the mayor?"}))
    assert ev[-1]["status"] == "uncertain"


def test_hotlines_endpoint(client):
    sections = client.get("/api/hotlines").json()
    titles = [s["title"] for s in sections]
    assert "National emergency hotline 911" in titles
    assert any("Batangas City" in t for t in titles)
    assert all("Source:" in s["text"] or s["title"] == "Other towns and barangays" for s in sections)


def test_hotline_answers_always_include_911(client, fake_llm):
    ev = events(client.post("/api/assistant/ask", json={"question": "Lipa fire station number"}))
    ids = [s["chunk_id"] for s in ev[-1]["sources"]]
    assert "hotlines#lipa-city-emergency-hotlines" in ids
    assert "hotlines#national-emergency-hotline-911" in ids


BSU = "osm-way-129493352"  # Batangas State University (evacuation center)
NEAR_BMC = {"lat": 13.7672, "lng": 121.0660}


def test_route_endpoint(client):
    r = client.get("/api/route", params={"from_lat": NEAR_BMC["lat"], "from_lng": NEAR_BMC["lng"], "to_id": BSU})
    assert r.status_code == 200
    body = r.json()
    assert body["to_name"] == "Batangas State University"
    assert body["coords"] and body["steps"][-1]["instruction"].startswith("Arrive")
    assert "floods" in body["warning"]


def test_route_errors(client):
    assert client.get("/api/route", params={"from_lat": 13.76, "from_lng": 121.06, "to_id": "nope"}).status_code == 404
    far = client.get("/api/route", params={"from_lat": 10.0, "from_lng": 125.0, "to_id": BSU})
    assert far.status_code == 422
    assert client.get("/api/route", params={"from_lat": 13.76, "from_lng": 121.06, "to_id": BSU, "mode": "fly"}).status_code == 422


def test_direction_question_uses_router_not_llm(client, fake_llm):
    ev = events(client.post("/api/assistant/ask", json={
        "question": "Paano pumunta dito?", "location_id": BSU, "from_pos": NEAR_BMC, "travel_mode": "drive"}))
    done = ev[-1]
    assert done["status"] == "route" and done["route"]["mode"] == "drive"
    assert "Driving route to Batangas State University" in ev[0]["text"]
    assert fake_llm == []


def test_direction_question_without_position_asks_for_it(client, fake_llm):
    ev = events(client.post("/api/assistant/ask", json={"question": "How do I get there?", "location_id": BSU}))
    assert ev[-1]["status"] == "needs_input"
    assert "Set my location" in ev[0]["text"]
    assert fake_llm == []


def test_condition_question_is_not_treated_as_directions(client, fake_llm):
    ev = events(client.post("/api/assistant/ask", json={
        "question": "Is the route there flooded?", "location_id": BSU, "from_pos": NEAR_BMC}))
    assert ev[-1]["status"] != "route"


def ask(client, **payload):
    return events(client.post("/api/assistant/ask", json=payload))


def test_how_far_uses_road_distance(client, fake_llm):
    ev = ask(client, question="How far is it from my current location?", location_id=BSU, from_pos=NEAR_BMC)
    text, done = ev[0]["text"], ev[-1]
    assert done["status"] == "route" and done["route"]["to_id"] == BSU
    assert "on foot" in text and "by car" in text and "Straight-line" in text
    assert fake_llm == []


def test_nearest_hospital_ranked_by_road(client, fake_llm):
    ev = ask(client, question="pinakamalapit na ospital?", from_pos=NEAR_BMC)
    done = ev[-1]
    assert done["status"] == "places" and len(done["places"]) == 3
    locs = {l["id"]: l for l in client.get("/api/locations").json()}
    assert all("hospital" in [locs[p["id"]]["type"], *locs[p["id"]]["also"]] for p in done["places"])
    dists = [p["distance_m"] for p in done["places"]]
    assert dists == sorted(dists)
    # Batangas Medical Center is stored as an evacuation center that is "also" a hospital; it
    # must still be found. (OSM also tags a Red Cross office next door as a hospital.)
    assert "Batangas Medical Center" in [p["name"] for p in done["places"]]
    assert fake_llm == []


def test_nearest_without_type_gives_key_types(client, fake_llm):
    done = ask(client, question="Where's the nearest place to go?", from_pos=NEAR_BMC)[-1]
    assert [p["type"] for p in done["places"]] == ["evacuation_center", "hospital", "police"]


def test_nearby_summary(client, fake_llm):
    ev = ask(client, question="What's near me?", from_pos=NEAR_BMC)
    assert ev[-1]["status"] == "places" and ev[-1]["places"]
    assert "Within 2.0 km" in ev[0]["text"]


def test_contact_and_hours(client, fake_llm):
    ev = ask(client, question="Contact number?", location_id=BSU)
    assert "+63 43 980 0385" in ev[0]["text"] and ev[-1]["status"] == "info"
    no_phone = next(l for l in client.get("/api/locations").json() if not l.get("phone"))
    ev = ask(client, question="Contact number?", location_id=no_phone["id"])
    assert "No phone number is saved" in ev[0]["text"]
    ev = ask(client, question="Is it open?", location_id=BSU)
    assert "cannot" in ev[0]["text"].lower()
    assert fake_llm == []


@pytest.mark.parametrize("payload", [
    {"question": "How far is it?", "location_id": BSU},                 # no position
    {"question": "How far is it?", "from_pos": {"lat": 13.76, "lng": 121.06}},  # no place
    {"question": "nearest hospital"},                                     # no position
])
def test_location_questions_ask_for_missing_input(client, fake_llm, payload):
    ev = ask(client, **payload)
    assert ev[-1]["status"] == "needs_input"
    assert "Set my location" in ev[0]["text"] or "select a place" in ev[0]["text"]
    assert fake_llm == []


def test_unrelated_question_after_a_topic_is_not_covered(client, fake_llm):
    previous = {"question": "How do I stop bleeding?", "answer": "Press firmly on the wound."}
    ev = events(client.post("/api/assistant/ask", json={"question": "What is the capital of France?", "previous": previous}))
    assert ev[-1]["status"] == "uncertain"
    assert not any(e["type"] == "passages" for e in ev)


def test_short_follow_up_still_uses_previous_topic(client, fake_llm):
    previous = {"question": "What should I pack in my go-bag?", "answer": "Water and food."}
    ev = events(client.post("/api/assistant/ask", json={"question": "para sa matanda?", "previous": previous}))
    assert ev[-1]["status"] == "grounded"


def test_setup_page_and_certificate(client):
    page = client.get("/setup")
    assert page.status_code == 200 and "Set up OFFGRID" in page.text
    cert = client.get("/offgrid-ca.crt")
    if cert.status_code == 200:  # only when the hub has been set up (certs/ exists)
        assert cert.headers["content-type"].startswith("application/x-x509-ca-cert")
        assert b"BEGIN CERTIFICATE" in cert.content
        assert ":8443/" in page.text


@pytest.mark.parametrize("reply,summary", [
    # cites a section it was never shown: made up, so hidden
    ("[go-bag#documents] Do not use light sources in flooded areas.", "dropped"),
    # an empty "no information" reply is the AI saying it doesn't know
    ("[No information provided]", "refused"),
    # a real citation of a shown section stays
    ("Not safe. Avoid walking through floodwater. [flood-safety#walking-or-driving-through-floodwater]", "verified"),
])
def test_ai_summary_checks(client, monkeypatch, reply, summary):
    async def chat_stream(messages):
        yield reply

    monkeypatch.setattr(llm, "chat_stream", chat_stream)
    ev = events(client.post("/api/assistant/ask", json={"question": "Is it safe to walk through floodwater?"}))
    assert ev[-1]["summary"] == summary
