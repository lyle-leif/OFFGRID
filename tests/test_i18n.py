"""Tagalog / English interface: the string files, and the hub's own sentences in Tagalog.

app/static/lang/<lang>.json is shared by the interface, the phone engine and the hub, so
the two files must have the same keys and the same {placeholders}, and every key the code
asks for must exist. tests/js/parity.test.mjs checks that the phone words answers like the hub.
"""

import json
import re
import typing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import FacilityType, ReportKind
from app.services import i18n, llm
from app.services.i18n import t
from app.services.reports import KIND_LABEL

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "app" / "static"
EN = json.loads((STATIC / "lang" / "en.json").read_text(encoding="utf-8"))
TL = json.loads((STATIC / "lang" / "tl.json").read_text(encoding="utf-8"))
VAR = re.compile(r"\{(\w+)\}")
EMPTY_OK = {("en", "hotlines.lang_note")}  # nothing to say when the interface is English
# Values the code passes that a language may use instead of another: Tagalog doesn't make the
# noun plural ("ospital (6)"), so it uses the singular label.
ALTERNATIVES = {"ans.nearby_line": {"label", "label_one"}}
NEAR_BMC = {"lat": 13.7672, "lng": 121.0660}
BSU = "osm-way-129493352"


def test_same_keys_in_both_languages():
    assert sorted(set(EN) - set(TL)) == []
    assert sorted(set(TL) - set(EN)) == []


def test_same_placeholders_and_nothing_empty():
    for key in EN:
        alt = ALTERNATIVES.get(key, set())
        assert set(VAR.findall(EN[key])) - alt == set(VAR.findall(TL[key])) - alt, key
        assert not alt or set(VAR.findall(TL[key])) & alt, key
        for lang, table in (("en", EN), ("tl", TL)):
            assert table[key].strip() or (lang, key) in EMPTY_OK, f"{lang} {key} is empty"


def test_plurals_come_in_pairs():
    for key in EN:
        if key.endswith("_one"):
            assert key[:-4] + "_other" in EN, key
        if key.endswith("_other"):
            assert key[:-6] + "_one" in EN, key


def _literal_keys() -> set[str]:
    """Keys named as string literals in the code: t("..."), format(lang, "..."), data-i18n="..."."""
    keys = set()
    js_call = re.compile(r"""\b(?:t|format\(\s*\w+\s*,)\s*\(?\s*["']([a-z0-9_]+\.[a-z0-9_.]+)["']""")
    for f in list(STATIC.glob("*.js")) + list((STATIC / "offline").glob("*.js")):
        keys |= set(js_call.findall(f.read_text(encoding="utf-8")))
    keys |= set(re.findall(r'data-i18n(?:-aria|-title|-ph)?="([^"]+)"', (STATIC / "index.html").read_text(encoding="utf-8")))
    py_call = re.compile(r"""\bt\(\s*[\w.]+\s*,\s*["']([a-z0-9_]+\.[a-z0-9_.]+)["']""")
    for f in (ROOT / "app").rglob("*.py"):
        keys |= set(py_call.findall(f.read_text(encoding="utf-8")))
    return keys


def test_every_key_the_code_uses_exists():
    keys = _literal_keys()
    assert len(keys) > 200  # the scan really found them
    plural = {k[:-4] for k in EN if k.endswith("_one")}
    assert sorted(k for k in keys if k not in EN and k not in plural) == []


def test_keys_built_from_data_exist():
    for kind in typing.get_args(ReportKind):
        assert EN[f"kind.{kind}"] == KIND_LABEL[kind]  # the hub's report label, in English
        assert f"kindshort.{kind}" in EN
    for ftype in typing.get_args(FacilityType):
        assert {f"type.{ftype}", f"plabel.{ftype}_one", f"plabel.{ftype}_other"} <= set(EN), ftype
    for trust in ("verified", "confirmed", "unverified"):
        assert f"trustlabel.{trust}" in EN and f"rans.trust.{trust}" in EN
    for d in ("north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"):
        assert f"dir.{d}" in EN
    for road in i18n.ROAD_CLASS.values():
        assert f"road.{road}" in EN
    for m in range(1, 13):
        assert f"month.{m}" in EN


def test_t_falls_back_and_fills():
    assert t("tl", "tab.list") == "Mga lugar"
    assert t("xx", "tab.list") == "Places"  # unknown language: English
    assert t("tl", "no.such.key") == "no.such.key"  # never blank
    assert t("en", "rans.count", n=1) == "1 report" and t("en", "rans.count", n=3) == "3 reports"
    assert t("en", "hotlines.lang_note") == ""  # empty is a real value, not missing
    assert i18n.road_name("tl", "footpath") == TL["road.footpath"]
    assert i18n.road_name("tl", "Rizal Avenue") == "Rizal Avenue"


# ---- the hub's answers in Tagalog ------------------------------------------------
@pytest.fixture
def client(monkeypatch):
    async def no_warm_up():
        return None

    async def no_ai(messages):
        raise llm.LLMError("no AI")
        yield  # pragma: no cover

    monkeypatch.setattr(llm, "warm_up", no_warm_up)
    monkeypatch.setattr(llm, "chat_stream", no_ai)
    with TestClient(app) as c:
        yield c


def ask(client, **body):
    lines = client.post("/api/assistant/ask", json=body).text.splitlines()
    events = [json.loads(x) for x in lines if x.strip()]
    return "".join(e.get("text", "") for e in events if e["type"] == "token"), events[-1]


def test_nearest_place_in_tagalog(client):
    text, done = ask(client, question="nearest hospital", from_pos=NEAR_BMC, lang="tl")
    assert done["status"] == "places"
    assert text.startswith("Pinakamalapit na mga ospital mula sa iyo:")
    en, _ = ask(client, question="nearest hospital", from_pos=NEAR_BMC)
    assert en.startswith("Nearest hospitals from your location:")


def test_not_covered_and_needs_input_in_tagalog(client):
    text, done = ask(client, question="What is the capital of France?", lang="tl")
    assert done["status"] == "uncertain" and text == TL["ans.not_covered"]
    text, done = ask(client, question="nearest hospital", lang="tl")
    assert done["status"] == "needs_input" and text.startswith("Para masagot iyan,")


def test_route_steps_in_tagalog(client):
    q = {"from_lat": NEAR_BMC["lat"], "from_lng": NEAR_BMC["lng"], "to_id": BSU, "mode": "walk"}
    tl = client.get("/api/route", params={**q, "lang": "tl"}).json()
    en = client.get("/api/route", params=q).json()
    assert tl["distance_m"] == en["distance_m"]  # same route, other words
    assert tl["steps"][0]["instruction"].startswith("Tumungo pa-")
    assert tl["steps"][-1]["instruction"] == "Dumating sa Batangas State University"
    assert en["steps"][-1]["instruction"] == "Arrive at Batangas State University"
    assert tl["warning"] == TL["ans.route_warning"]
    text, done = ask(client, question="How do I get there?", location_id=BSU, from_pos=NEAR_BMC, lang="tl")
    assert done["status"] == "route" and text.startswith("Ruta ng paglalakad papunta sa Batangas State University:")


def test_unknown_place_error_in_tagalog(client):
    r = client.get("/api/route", params={"from_lat": 13.76, "from_lng": 121.06, "to_id": "no-such-place", "lang": "tl"})
    assert r.status_code == 404 and r.json()["detail"] == t("tl", "rerr.unknown_location", id="no-such-place")


def test_report_answer_and_errors_in_tagalog(client):
    text, done = ask(client, question="Is the road flooded?", lang="tl")
    assert done["status"] == "reports" and text.startswith("Walang ulat")
    body = {"id": "report-0001", "kind": "power_out", "lat": 10.0, "lng": 100.0, "device": "phone-0001"}
    r = client.post("/api/reports", json=body, headers={"X-Lang": "tl"})
    assert r.status_code == 422 and r.json()["detail"] == TL["apierr.outside"]
    r = client.post("/api/reports", json=body)
    assert r.json()["detail"] == EN["apierr.outside"]


def test_guide_text_stays_as_written(client):
    """Guides are official text: the interface language never changes them."""
    _, done_en = ask(client, question="How do I stop bleeding?")
    _, done_tl = ask(client, question="How do I stop bleeding?", lang="tl")
    assert [s["excerpt"] for s in done_tl["sources"]] == [s["excerpt"] for s in done_en["sources"]]


def test_setup_page_language(client):
    assert "Set up OFFGRID on this phone" in client.get("/setup").text
    tl = client.get("/setup", params={"lang": "tl"}).text
    assert t("tl", "setup.h1") in tl and '<html lang="fil">' in tl
    assert t("tl", "setup.h1") in client.get("/setup", headers={"Accept-Language": "fil-PH,fil;q=0.9,en;q=0.8"}).text
    assert "Set up OFFGRID" in client.get("/setup", headers={"Accept-Language": "en-US,en"}).text
