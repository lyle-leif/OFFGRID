"""App settings. Every value can be overridden with an environment variable."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("BB_DATA_DIR", ROOT / "data"))
LOCATIONS_FILE = DATA_DIR / "locations.json"
GUIDES_DIR = DATA_DIR / "guides"
ROADS_FILE = DATA_DIR / "roads.json.gz"
STATIC_DIR = ROOT / "app" / "static"

OLLAMA_URL = os.getenv("BB_OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.getenv("BB_MODEL", "qwen2.5:3b")
KEEP_ALIVE = os.getenv("BB_KEEP_ALIVE", "30m")
NUM_CTX = int(os.getenv("BB_NUM_CTX", "4096"))

# Retrieval: a chunk counts as evidence if it scores at least THRESHOLD *and*
# matches enough query concepts (MIN_TERMS, or 40% of a long question), or if a
# single rare word gives it a score of at least STRONG_SCORE. Tuned in tests/test_retrieval.py.
TOP_K = int(os.getenv("BB_TOP_K", "4"))
THRESHOLD = float(os.getenv("BB_THRESHOLD", "2.4"))
MIN_TERMS = int(os.getenv("BB_MIN_TERMS", "2"))
STRONG_SCORE = float(os.getenv("BB_STRONG_SCORE", "6.0"))
# Drop sources scoring below this fraction of the best match.
RELATIVE_SCORE = float(os.getenv("BB_RELATIVE_SCORE", "0.5"))

MAX_QUESTION_CHARS = 500

# Situation reports (Phase 3). The database lives on the hub only.
REPORTS_DB = Path(os.getenv("BB_REPORTS_DB", DATA_DIR / "reports.db"))
# Hours until a report expires on its own.
REPORT_TTL_H = {
    "road_flooded": 2, "road_blocked": 2, "center_full": 6, "center_open": 6,
    "water_available": 6, "power_out": 6, "medical_need": 2, "other": 3,
}
# Responders enter this on their phone to verify or remove reports. If unset, the hub
# makes up a 6-digit PIN at startup and prints it in its console.
RESPONDER_PIN = os.getenv("BB_RESPONDER_PIN") or None
# The area the app covers; keep in step with BOUNDS in app/static/map.js.
BBOX = {"min_lng": 120.55, "max_lng": 121.50, "min_lat": 13.45, "max_lat": 14.20}
