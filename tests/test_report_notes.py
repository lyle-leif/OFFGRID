"""Report notes: contact details removed, 140 characters, danger and flag words; the same in
Python (the hub) and JavaScript (the phone and the online reports). Plus the hub's API for
Reports v2: details per kind, "Iba pa" needs a note, notes public only once approved."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import llm
from app.services.report_notes import REMOVED, clean_note, details_table, has_word, word_lists

ROOT = Path(__file__).resolve().parent.parent
CASES = [
    "Tumataas pa ang tubig sa kanto",
    "  baha   hanggang tuhod\n\nsa tapat ng palengke  ",
    "Tawagan si Mang Jose 0917-123-4567 para tulong",
    "call +63 917 123 4567 or (043) 723-1234",
    "email me at juan.delacruz@gmail.com",
    "see https://example.com/flood?x=1 and www.facebook.com/brgy",
    "taga barangay.ph ang balita",
    "lalim 2 ft, mga 30 min na, bahay #123",
    "x" * 200,
    "á" * 150 + "!",
    "🌊" * 145,
    "",
    "   ",
    "May naiipit sa loob ng bahay!",
    "trapped sa bubong, di makahinga",
    "Gago ang driver na yan",
    "magaganda ang tulong dito",  # "gaga" inside a word: not flagged
    "Tulong po, nalulunod ang aso",
    "\u0007bell\u0000and tab\tchars",
]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")
def test_notes_are_cleaned_the_same_on_the_hub_and_the_phone():
    words = word_lists()
    py = [[clean_note(c), has_word(c, words["danger"]), has_word(c, words["flag"])] for c in CASES]
    script = (
        "import { cleanNote, hasWord } from './app/static/offline/notes.js';"
        "import { readFileSync } from 'node:fs';"
        "const w = JSON.parse(readFileSync('data/report_words.json', 'utf-8'));"
        "const cases = JSON.parse(readFileSync(0, 'utf-8'));"
        "process.stdout.write(JSON.stringify(cases.map((c) => [cleanNote(c), hasWord(c, w.danger), hasWord(c, w.flag)])));"
    )
    r = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, input=json.dumps(CASES),
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr
    js = json.loads(r.stdout)
    for case, a, b in zip(CASES, py, js):
        assert a == b, f"{case!r}: hub {a} != phone {b}"


def test_what_cleaning_does():
    assert clean_note("Tawagan si Mang Jose 0917-123-4567 para tulong") == f"Tawagan si Mang Jose {REMOVED} para tulong"
    assert REMOVED in clean_note("email me at juan.delacruz@gmail.com")
    assert clean_note("lalim 2 ft, mga 30 min na, bahay #123") == "lalim 2 ft, mga 30 min na, bahay #123"  # short numbers stay
    assert len(clean_note("x" * 200)) == 140
    assert clean_note("   ") is None and clean_note(None) is None
    assert has_word("May naiipit sa loob ng bahay!", word_lists()["danger"])
    assert not has_word("magaganda ang tulong dito", word_lists()["flag"])


def test_every_detail_has_a_label():
    en = json.loads((ROOT / "app" / "static" / "lang" / "en.json").read_text(encoding="utf-8"))
    for kind, ids in details_table().items():
        assert f"kind.{kind}" in en
        for d in ids:
            assert f"detail.{d}" in en, d


# ---- the hub's API ----------------------------------------------------------------------
@pytest.fixture
def client(monkeypatch):
    async def no_warm_up():
        return None

    monkeypatch.setattr(llm, "warm_up", no_warm_up)
    with TestClient(app) as c:
        yield c


def post(c, n, **kw):
    return c.post("/api/reports", json={"id": f"v2-report-{n:04d}", "device": f"phone-v2-{n:04d}", **kw})


def test_details_note_and_approval_on_the_hub(client):
    pin = client.app.state.responder_pin
    assert post(client, 1, kind="power_out", lat=13.76, lng=121.06, details=["knee"]).status_code == 422  # wrong kind
    assert post(client, 2, kind="power_out", lat=13.76, lng=121.06, details=["whole_area", "some_houses", "wires_down"]).status_code == 422
    assert post(client, 3, kind="other", lat=13.76, lng=121.06).status_code == 422  # "Iba pa" needs a note
    assert post(client, 4, kind="other", lat=13.76, lng=121.06, note="  ").status_code == 422
    r = post(client, 5, kind="other", lat=13.76, lng=121.06, note="Bumagsak na poste, tawag 0917 123 4567", on_site=True, acc_bucket=20)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert r.json()["note"] is None and r.json()["on_site"] is True and r.json()["acc_bucket"] == 20  # not approved yet
    pub = {x["id"]: x for x in client.get("/api/reports").json()}
    assert pub[rid]["note"] is None and "note_status" not in pub[rid]
    resp = {x["id"]: x for x in client.get("/api/reports", headers={"X-Responder-Pin": pin}).json()}
    assert resp[rid]["note"] == f"Bumagsak na poste, tawag {REMOVED}" and resp[rid]["note_status"] == "pending"
    assert client.post(f"/api/reports/{rid}/note", json={"action": "approve"}).status_code == 403
    assert client.post(f"/api/reports/{rid}/note", json={"action": "approve"}, headers={"X-Responder-Pin": pin}).status_code == 200
    pub = {x["id"]: x for x in client.get("/api/reports").json()}
    assert pub[rid]["note"] == f"Bumagsak na poste, tawag {REMOVED}"
    client.post(f"/api/reports/{rid}/note", json={"action": "hide"}, headers={"X-Responder-Pin": pin})
    assert {x["id"]: x for x in client.get("/api/reports").json()}[rid]["note"] is None
    flagged = post(client, 6, kind="medical_need", lat=13.76, lng=121.06, details=["injured"], note="gago ang driver")
    resp = {x["id"]: x for x in client.get("/api/reports", headers={"X-Responder-Pin": pin}).json()}
    assert resp[flagged.json()["id"]]["flagged"] is True and resp[flagged.json()["id"]]["details"] == ["injured"]
    assert {x["id"]: x for x in client.get("/api/reports", headers={"X-Responder-Pin": "wrong"}).json()}[rid].get("note_status") is None
