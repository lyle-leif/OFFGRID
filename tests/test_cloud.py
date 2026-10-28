"""The online reports (cloud/, a Cloudflare Worker) must follow the hub's rules exactly.

The same steps run on the hub's ReportStore (app/services/reports.py) and on the cloud's
JavaScript (cloud/src/reports.js, on Node's built-in SQLite, the engine D1 uses), and what
phones would see must be identical. Also runs the Worker's own tests (tests/js/cloud.test.mjs)
and checks cloud/src/data.js is in step with the hub's data.
"""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app import config
from app.services.reports import KIND_LABEL, ReportStore, public

ROOT = Path(__file__).resolve().parent.parent
T0 = 1_800_000_000.0
H = 3600
node = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")


def steps() -> list[dict]:
    s = [
        {"op": "add", "id": "rep-road-01", "kind": "road_flooded", "lat": 13.7565, "lng": 121.0583, "device": "phone-a",
         "now": T0, "edge_id": 4242, "road_name": "P. Burgos Street"},
        {"op": "add", "id": "rep-road-01", "kind": "power_out", "lat": 13.7, "lng": 121.0, "device": "phone-b", "now": T0 + 5},
        {"op": "add", "id": "rep-power-1", "kind": "power_out", "lat": 13.7680012345, "lng": 121.06501, "device": "phone-b",
         "now": T0 + 60, "age_s": 30 * 60},
        {"op": "add", "id": "rep-water-1", "kind": "water_available", "lat": 13.94, "lng": 121.163, "device": "phone-c",
         "now": T0 + 120, "age_s": 99 * H},  # queued "too long": clamped to one lifetime
        {"op": "active", "now": T0 + 130},
        {"op": "vote", "id": "rep-road-01", "device": "phone-a", "vote": "confirm", "now": T0 + 600},  # own report
        {"op": "vote", "id": "rep-road-01", "device": "phone-b", "vote": "confirm", "now": T0 + 600},
        {"op": "vote", "id": "rep-road-01", "device": "phone-c", "vote": "confirm", "now": T0 + 3000},
        {"op": "vote", "id": "rep-road-01", "device": "phone-c", "vote": "confirm", "now": T0 + 3100},  # once only
        {"op": "active", "now": T0 + 3200},
        {"op": "vote", "id": "rep-power-1", "device": "phone-d", "vote": "dispute", "now": T0 + 3300},
        {"op": "vote", "id": "rep-power-1", "device": "phone-e", "vote": "dispute", "now": T0 + 3300},
        {"op": "vote", "id": "no-such-id", "device": "phone-e", "vote": "dispute", "now": T0 + 3300},
        {"op": "active", "now": T0 + 3400},  # power report hidden: 2 disputes >= 0 confirms + 2
        {"op": "vote", "id": "rep-power-1", "device": "phone-d", "vote": "confirm", "now": T0 + 3500},  # switch
        {"op": "active", "now": T0 + 3600},
        {"op": "flag", "id": "rep-water-1", "flag": "verified"},
        {"op": "active", "now": T0 + 2 * H + 100},  # the road report lives on thanks to its confirms
    ]
    # Confirms keep a report alive, but never past 3 lifetimes after it was made.
    for i in range(8):
        s.append({"op": "vote", "id": "rep-road-01", "device": f"phone-x{i}", "vote": "confirm", "now": T0 + (i + 1) * H})
    s += [
        {"op": "active", "now": T0 + 5.9 * H},
        {"op": "active", "now": T0 + 6 * H + 1},
        {"op": "flag", "id": "rep-power-1", "flag": "removed"},
        {"op": "add", "id": "rep-late-01", "kind": "medical_need", "lat": 13.8, "lng": 121.1, "device": "phone-f",
         "now": T0 + 40 * H},  # purges reports expired over a day ago
        {"op": "add", "id": "rep-road-01", "kind": "road_blocked", "lat": 13.8, "lng": 121.1, "device": "phone-f",
         "now": T0 + 40 * H + 1},  # the old id is free again after the purge
        {"op": "active", "now": T0 + 40 * H + 2},
    ]
    # Reports v2: details, a note that is public only once approved, the GPS badge, and notes
    # deleted as soon as the report expires.
    s += [
        {"op": "add", "id": "rep-v2-note1", "kind": "road_flooded", "lat": 13.75, "lng": 121.05, "device": "phone-g",
         "now": T0 + 41 * H, "edge_id": 99, "road_name": "Rizal Avenue", "details": ["knee", "no_cars"],
         "note": "Tumataas pa ang tubig", "on_site": True, "acc_bucket": 20},
        {"op": "add", "id": "rep-v2-other", "kind": "other", "lat": 13.76, "lng": 121.06, "device": "phone-h",
         "now": T0 + 41 * H + 10, "note": "Bumagsak na poste, ingat", "flagged": True},
        {"op": "add", "id": "rep-v2-mapped", "kind": "power_out", "lat": 13.77, "lng": 121.07, "device": "phone-i",
         "now": T0 + 41 * H + 20, "details": ["whole_area"], "on_site": False, "acc_bucket": 50},  # badge only with GPS
        {"op": "active", "now": T0 + 41 * H + 30},
        {"op": "active", "now": T0 + 41 * H + 30, "responder": True},
        {"op": "note", "id": "rep-v2-note1", "status": "approved"},
        {"op": "note", "id": "rep-v2-other", "status": "hidden"},
        {"op": "note", "id": "rep-v2-mapped", "status": "approved"},  # no note: nothing changes
        {"op": "active", "now": T0 + 41 * H + 40},
        {"op": "active", "now": T0 + 41 * H + 40, "responder": True},
        {"op": "active", "now": T0 + 43 * H + 41, "responder": True},  # the flood report expired: its note is gone
        {"op": "raw", "id": "rep-v2-note1"},  # stored note of the expired report: deleted
        {"op": "active", "now": T0 + 44 * H, "responder": True},
        {"op": "raw", "id": "rep-v2-other"},  # still in force: note kept
    ]
    return s


def run_hub(tmp_path) -> list[dict]:
    store = ReportStore(tmp_path / "hub.db")
    out = []
    for s in steps():
        if s["op"] == "add":
            r, created = store.add(s["id"], s["kind"], s["lat"], s["lng"], s["device"], s.get("age_s", 0), now=s["now"],
                                   location_id=s.get("location_id"), edge_id=s.get("edge_id"), road_name=s.get("road_name"),
                                   details=s.get("details"), note=s.get("note"), flagged=s.get("flagged", False),
                                   on_site=s.get("on_site", False), acc_bucket=s.get("acc_bucket"))
            out.append({"op": "add", "id": r["id"], "created": created})
        elif s["op"] == "note":
            store.set_note(s["id"], s["status"])
        elif s["op"] == "raw":
            out.append({"op": "raw", "note": store.get(s["id"])["note"]})
        elif s["op"] == "vote":
            out.append({"op": "vote", "found": store.vote(s["id"], s["device"], s["vote"], now=s["now"]) is not None})
        elif s["op"] == "flag":
            store.set_flag(s["id"], s["flag"])
        elif s["op"] == "active":
            out.append({"op": "active", "reports": [public(r, now=s["now"], responder=s.get("responder", False))
                                                    for r in store.active(now=s["now"])]})
    store.close()
    return out


@node
def test_cloud_rules_match_the_hub(tmp_path):
    hub = run_hub(tmp_path)
    js = subprocess.run(["node", "tests/js/cloud_parity.mjs"], cwd=ROOT, input=json.dumps(steps()),
                        capture_output=True, text=True, timeout=120)
    assert js.returncode == 0, js.stderr[-3000:]
    cloud = json.loads(js.stdout)
    assert len(cloud) == len(hub)
    for i, (a, b) in enumerate(zip(hub, cloud)):
        assert a == b, f"step {i}: hub {a} != cloud {b}"
    shown = [len(x["reports"]) for x in hub if x["op"] == "active"]
    # The scenario really exercises the rules: the water report was queued too long and is
    # already expired; the power report hides on 2 disputes and returns when one switches; the
    # road report outlives 2 h on confirms but not its 3-lifetime cap; a day later all is purged.
    assert shown[:8] == [2, 2, 1, 2, 2, 2, 1, 2]
    v2 = [{r["id"]: (r["note"], r.get("note_status"), r["details"], r["on_site"], r["acc_bucket"]) for r in x["reports"]}
          for x in hub if x["op"] == "active"][8:]
    assert v2[0]["rep-v2-note1"] == (None, None, ["knee", "no_cars"], True, 20)  # public: note not approved yet
    assert v2[1]["rep-v2-note1"] == ("Tumataas pa ang tubig", "pending", ["knee", "no_cars"], True, 20)
    assert v2[0]["rep-v2-mapped"][3:] == (False, None)  # marked on the map: no accuracy kept
    assert v2[2]["rep-v2-note1"][0] == "Tumataas pa ang tubig" and v2[2]["rep-v2-other"][0] is None
    assert v2[3]["rep-v2-other"][:2] == ("Bumagsak na poste, ingat", "hidden")
    assert "rep-v2-note1" not in v2[4] and v2[4]["rep-v2-other"][0] is not None  # flood report expired
    assert v2[5]["rep-v2-other"][0] == "Bumagsak na poste, ingat"  # "other" lasts 3 h: still in force
    assert [x["note"] for x in hub if x["op"] == "raw"] == [None, "Bumagsak na poste, ingat"]


@node
def test_worker():
    r = subprocess.run(["node", "--test", "tests/js/cloud.test.mjs"], cwd=ROOT, capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stdout[-4000:] + r.stderr[-2000:]


def test_cloud_data_matches_the_hub():
    """cloud/src/data.js (written by tools/build_phone_pack.py) is in step with the hub."""
    text = (ROOT / "cloud" / "src" / "data.js").read_text(encoding="utf-8")
    data = json.loads(re.search(r"export const DATA = (\{.*\});", text, re.S).group(1))
    assert data["ttl_h"] == config.REPORT_TTL_H and data["kind_label"] == KIND_LABEL and data["bbox"] == config.BBOX
    en = json.loads((ROOT / "app" / "static" / "lang" / "en.json").read_text(encoding="utf-8"))
    assert data["strings"]["en"] == {k: v for k, v in en.items() if k.startswith("apierr.") or k == "rerr.unknown_location"}
    meta = json.loads((ROOT / "app" / "static" / "pack" / "roads-meta.json").read_text(encoding="utf-8"))
    assert data["edges"] == meta["edges"]
    assert len(data["centers"]) > 100


def test_cloud_stays_free():
    toml = (ROOT / "cloud" / "wrangler.toml").read_text(encoding="utf-8")
    assert "workers_dev = true" in toml  # the free *.workers.dev address, no custom domain
    for paid in ("usage_model", "[limits]", "routes", "[[r2_buckets]]", "[[queues", "[ai]"):
        assert paid not in toml, paid
    admin = (ROOT / "tools" / "cloud_admin.mjs").read_text(encoding="utf-8")
    assert "billing" not in admin.lower() and "subscription" not in admin.lower()
