"""Is everything ready for the live demo? Run 10 minutes before presenting, with the hub on:

    .venv\\Scripts\\python tools\\demo_check.py
    .venv\\Scripts\\python tools\\demo_check.py --clear-reports   # start the demo with no old reports

Checks the hub, the address phones use and its certificate, warms up the local AI by asking
the demo's own questions (so the first live answer isn't slow), and times them.
See docs/demo_runsheet.md for the script.
"""

import argparse
import json
import sqlite3
import ssl
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

from app import config  # noqa: E402
from make_certs import HOTSPOT_IP, local_ips  # noqa: E402

HUB = "http://127.0.0.1:8080"
OPENSSL = "C:/Program Files/Git/usr/bin/openssl.exe"
NEAR_BMC = {"lat": 13.7672, "lng": 121.0660}
# The questions the run-sheet asks, exactly as typed on stage.
SCRIPT = [
    ("laptop, local AI", {"question": "is it safe to wlak thru flood water?", "use_ai": True}),
    ("phone, no hub", {"question": "saan ang pinakamalapit na ospitl?", "from_pos": NEAR_BMC, "use_ai": True}),
]
failures = 0


def line(ok: bool, text: str, fix: str = "") -> None:
    global failures
    failures += not ok
    print(f"{'OK ' if ok else 'XX '} {text}" + (f"\n      -> {fix}" if fix and not ok else ""))


def get_json(url: str, timeout: float = 5, context=None):
    with urllib.request.urlopen(url, timeout=timeout, context=context) as r:
        return json.loads(r.read())


def ask(body: dict) -> dict:
    req = urllib.request.Request(f"{HUB}/api/assistant/ask", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    first = None
    events = []
    with urllib.request.urlopen(req, timeout=180) as r:
        for raw in r:
            if raw.strip():
                events.append(json.loads(raw))
                first = first or time.perf_counter()
    done = events[-1]
    return {"first_s": (first - t0) if first else None, "total_s": time.perf_counter() - t0,
            "status": done.get("status"), "summary": done.get("summary"),
            "passages": [p["title"] for e in events if e.get("type") == "passages" for p in e["passages"]],
            "text": "".join(e.get("text", "") for e in events if e.get("type") == "token")}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clear-reports", action="store_true", help="hide every report on the hub (clean demo)")
    args = ap.parse_args()

    print("OFFGRID demo check\n")
    # 1. hub
    try:
        h = get_json(f"{HUB}/api/health")
        line(True, f"hub running ({h['locations']} places, {h['reports']} reports on the hub)")
    except Exception as e:  # noqa: BLE001
        line(False, f"hub not reachable at {HUB} ({e})", "double-click start_hub.bat and wait for [OK]")
        return 1
    line(h.get("ollama") == "ok", "local AI runtime (Ollama) running", "start Ollama, then run this again")
    line(bool(h.get("model_installed")), f"model {h.get('model')} installed", f"ollama pull {h.get('model')}")

    # 2. the address phones use, and its certificate
    ips = [ip for ip in local_ips() if not ip.startswith("127.")]
    san = subprocess.run([OPENSSL, "x509", "-in", str(ROOT / "certs" / "hub.crt"), "-noout", "-ext", "subjectAltName"],
                         capture_output=True, text=True).stdout
    ctx = ssl.create_default_context(cafile=str(ROOT / "certs" / "offgrid-ca.crt"))
    for ip in ips:
        covered = f"IP Address:{ip}" in san
        try:
            get_json(f"https://{ip}:8443/api/health", context=ctx)
            secure = True
        except Exception:  # noqa: BLE001
            secure = False
        if ip == HOTSPOT_IP and not secure:
            continue  # the laptop's own hotspot isn't on: nothing to check
        line(covered and secure, f"phones: setup http://{ip}:8080/setup  ->  app https://{ip}:8443",
             "close the hub windows and run start_hub.bat again (it renews the certificate for new addresses)")
    if not ips:
        line(False, "no Wi-Fi address", "join the laptop to the demo Wi-Fi (or the iPhone's Personal Hotspot)")

    # 3. phones' offline copy version
    try:
        v = get_json(f"{HUB}/pack/version.json")
        print(f"     phones should show pack {v['pack']} (bottom of the panel: 'Saved on this phone')")
    except Exception:  # noqa: BLE001
        line(False, "pack/version.json missing", ".venv\\Scripts\\python tools\\build_phone_pack.py")

    # 4. reports
    if args.clear_reports:
        with sqlite3.connect(config.REPORTS_DB) as db:
            n = db.execute("UPDATE reports SET removed = 1 WHERE removed = 0").rowcount
        line(True, f"cleared {n} old report(s): the map starts clean")

    # 5. warm up the AI and time the demo's own questions (asked twice: the first may load the model)
    print()
    for label, body in SCRIPT:
        for attempt in (1, 2):
            r = ask(body)
        ok = r["status"] in ("grounded", "places") and (r["summary"] in (None, "verified"))
        timing = f"first words {r['first_s']:.1f} s, whole answer {r['total_s']:.1f} s" if r["first_s"] else ""
        line(ok, f"{label}: \"{body['question']}\" -> {r['status']}"
                 f"{', AI summary ' + r['summary'] if r['summary'] else ''}; {timing}",
             "the AI may be cold or slow: run this once more; on stage, battery saver gives the guide text instantly")
        if r["passages"]:
            print(f"      guide: {' / '.join(r['passages'])}")
        print(f"      answer: {r['text'][:160].strip()}...")

    print(f"\n{'All set.' if not failures else f'{failures} thing(s) to fix above.'}")
    print("Still on you: router internet unplugged, iPhone in Airplane mode with Wi-Fi on, "
          f"laptop browser at {HUB}/?demo")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
