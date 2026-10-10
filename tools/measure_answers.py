"""Measure what an answer costs: time per answer with the AI summary vs battery saver.

Run with the server up (start.bat), from the project root:
    .venv\\Scripts\\python tools\\measure_answers.py            # 10 questions, both modes
    .venv\\Scripts\\python tools\\measure_answers.py --rounds 3  # repeat for steadier numbers

If the laptop is on battery, it also reports the battery % used by each mode
(read from Windows; percent steps are coarse, so use --rounds 3 or more for that).
"""

import argparse
import json
import statistics
import subprocess
import sys
import time

import httpx

URL = "http://127.0.0.1:8000/api/assistant/ask"
QUESTIONS = [
    "What should I bring for my baby when evacuating?",
    "How do I stop bleeding?",
    "Is it safe to walk through floodwater?",
    "Can I run a generator inside the house?",
    "What does signal no. 3 mean?",
    "How do I treat a burn?",
    "What number do I call for an emergency in Batangas City?",
    "How long does food last in the fridge during a brownout?",
    "When should we evacuate before a typhoon?",
    "anong dapat dalhin para sa sanggol",
]


def battery() -> tuple[int | None, bool | None]:
    """(percent, on_battery) from Windows, or (None, None) if unknown."""
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json"],
            capture_output=True, text=True, timeout=15,
        ).stdout.strip()
        data = json.loads(out) if out else None
        if isinstance(data, list):
            data = data[0]
        if not data:
            return None, None
        # BatteryStatus 1 = discharging (on battery)
        return int(data["EstimatedChargeRemaining"]), data["BatteryStatus"] == 1
    except Exception:
        return None, None


def ask(client: httpx.Client, q: str, use_ai: bool) -> dict:
    t0 = time.perf_counter()
    first_passage = None
    done = {}
    with client.stream("POST", URL, json={"question": q, "use_ai": use_ai}, timeout=180) as r:
        for line in r.iter_lines():
            if not line:
                continue
            ev = json.loads(line)
            if ev["type"] == "passages" and first_passage is None:
                first_passage = time.perf_counter() - t0
            if ev["type"] in ("done", "error"):
                done = ev
    return {"total": time.perf_counter() - t0, "guide": first_passage, "summary": done.get("summary"),
            "status": done.get("status", done.get("type"))}


def run(rounds: int) -> None:
    with httpx.Client() as client:
        try:
            client.get("http://127.0.0.1:8000/api/health", timeout=5).raise_for_status()
        except httpx.HTTPError:
            sys.exit("The OFFGRID server isn't running. Start it with start.bat first.")
        for use_ai in (False, True):
            label = "AI summary on" if use_ai else "battery saver (no AI)"
            pct0, on_batt = battery()
            results = [ask(client, q, use_ai) for _ in range(rounds) for q in QUESTIONS]
            pct1, _ = battery()
            totals = [r["total"] for r in results]
            guides = [r["guide"] for r in results if r["guide"] is not None]
            outcomes = {}
            for r in results:
                outcomes[r["summary"]] = outcomes.get(r["summary"], 0) + 1
            print(f"\n== {label}: {len(results)} answers")
            print(f"   guide text shown after: median {statistics.median(guides) * 1000:.0f} ms" if guides else "   no guide text")
            print(f"   full answer: median {statistics.median(totals):.1f} s, max {max(totals):.1f} s, "
                  f"total {sum(totals):.0f} s")
            print(f"   summary outcomes: {outcomes}")
            if on_batt and pct0 is not None and pct1 is not None:
                used = pct0 - pct1
                print(f"   battery: {pct0}% -> {pct1}% ({used}% for {len(results)} answers)")
            elif pct0 is not None:
                print("   battery: plugged in, so no drain measured (unplug to measure)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rounds", type=int, default=1)
    run(ap.parse_args().rounds)
