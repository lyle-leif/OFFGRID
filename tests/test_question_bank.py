"""Every question in tests/question_bank.json (clean, Filipino/Taglish, typos, odd phrasing)
must get the right kind of answer from the hub. The phone engine is checked against the same
bank in tests/js/parity.test.mjs."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app
from app.services import intents, llm

BANK = json.loads((Path(__file__).parent / "question_bank.json").read_text(encoding="utf-8"))
NEAR_BMC = {"lat": 13.7672, "lng": 121.0660}
STATUS_FOR_INTENT = {"nearest": "places", "nearby": "places", "distance": "route", "contact": "info", "hours": "info"}
CASES = [(g, q) for g in BANK["groups"] for q in g["qs"]]


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    async def no_warm_up():
        return None

    async def no_ai(messages):  # guide text only: what we check is which section answers
        raise llm.LLMError("no AI in tests")
        yield  # pragma: no cover

    mp = pytest.MonkeyPatch()
    # Module-wide client: give it its own reports database (the autouse one is per test).
    mp.setattr(config, "REPORTS_DB", tmp_path_factory.mktemp("bank") / "reports.db")
    mp.setattr(llm, "warm_up", no_warm_up)
    mp.setattr(llm, "chat_stream", no_ai)
    with TestClient(app) as c:
        yield c
    mp.undo()


def body_for(group, q):
    ctx = group["ctx"]
    body = {"question": q, "use_ai": True}
    if ctx.get("pos"):
        body["from_pos"] = NEAR_BMC
    if ctx.get("place"):
        body["location_id"] = BANK["places"][ctx["place"]]
    return body


def check(client, group, q) -> str | None:
    """None if the answer is right, else what went wrong."""
    body = body_for(group, q)
    lines = client.post("/api/assistant/ask", json=body).text.splitlines()
    events = [json.loads(x) for x in lines if x.strip()]
    done = events[-1]
    status = done.get("status")
    norm = client.app.state.normalizer.normalize(q)
    exp = group["expect"]
    if "intent" in exp:
        got = intents.detect(norm, has_place="location_id" in body)
        if not got or got.kind != exp["intent"] or (exp.get("ftype") and got.ftype != exp["ftype"]):
            return f"intent {got} (read as {norm!r})"
        if status != STATUS_FOR_INTENT[exp["intent"]]:
            return f"status {status}"
    elif exp.get("route"):
        if status != "route":
            return f"status {status} (read as {norm!r})"
    elif "reports" in exp:
        if status != "reports":
            return f"status {status} (read as {norm!r})"
        kinds = intents.report_query(norm, place_is_center=group["ctx"].get("place") == "bsu")
        if kinds != exp["reports"]:
            return f"report kinds {kinds} (read as {norm!r})"
    elif "chunks" in exp:
        shown = [p["chunk_id"] for e in events if e.get("type") == "passages" for p in e["passages"]]
        ok = any(s == c or (c.endswith("#") and s.startswith(c)) for s in shown for c in exp["chunks"])
        if not ok:
            return f"showed {shown or status} (read as {norm!r})"
    elif exp.get("uncovered"):
        if status != "uncertain":
            shown = [p["chunk_id"] for e in events if e.get("type") == "passages" for p in e["passages"]]
            return f"answered {status} {shown} (read as {norm!r})"
    return None


@pytest.mark.parametrize("group,q", CASES, ids=[f"{g['name']}: {q}" for g, q in CASES])
def test_question_bank(client, group, q):
    problem = check(client, group, q)
    assert problem is None, problem
