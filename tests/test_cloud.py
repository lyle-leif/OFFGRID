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
    return s


def run_hub(tmp_path) -> list[dict]:
    store = ReportStore(tmp_path / "hub.db")
    out = []
    for s in steps():
        if s["op"] == "add":
            r, created = store.add(s["id"], s["kind"], s["lat"], s["lng"], s["device"], s.get("age_s", 0), now=s["now"],
                                   location_id=s.get("location_id"), edge_id=s.get("edge_id"), road_name=s.get("road_name"))
            out.append({"op": "add", "id": r["id"], "created": created})
        elif s["op"] == "vote":
            out.append({"op": "vote", "found": store.vote(s["id"], s["device"], s["vote"], now=s["now"]) is not None})
        elif s["op"] == "flag":
            store.set_flag(s["id"], s["flag"])
        elif s["op"] == "active":
            out.append({"op": "active", "reports": [public(r, now=s["now"]) for r in store.active(now=s["now"])]})
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
    assert shown == [2, 2, 1, 2, 2, 2, 1, 2]


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
