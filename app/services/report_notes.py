"""Report notes ("Ano ang nakikita mo?") and details: the checks done by code, never by AI.

An exact copy of app/static/offline/notes.js (the phone and the online reports use that one);
tests/test_report_notes.py checks both give the same result on shared cases.

- clean_note: contact details (phone numbers, emails, links) become "[tinanggal]"; at most 140
  characters; empty -> None.
- has_word: whole-word match against a list from data/report_words.json.
- DETAILS: the one-tap details allowed for each kind (data/report_details.json).
"""

import json
import re
from functools import cache

from app import config

MAX_NOTE = 140
MAX_DETAILS = 2
REMOVED = "[tinanggal]"

_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
_SPACES = re.compile(r"\s+")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", re.ASCII)
_LINK = re.compile(r"(?:https?://|www\.)\S+|\b[A-Za-z0-9-]+\.(?:com|ph|net|org|info|io|me|co)\b(?:/\S*)?",
                   re.ASCII | re.IGNORECASE)
_PHONE = re.compile(r"\+?\d[\d ().-]{5,}\d", re.ASCII)
_NOT_WORD = re.compile(r"[^a-z0-9']+")


def clean_note(text) -> str | None:
    if not isinstance(text, str):
        return None
    s = _SPACES.sub(" ", _CONTROL.sub(" ", text)).strip()
    s = _LINK.sub(REMOVED, _EMAIL.sub(REMOVED, s))
    # Seven or more digits is a phone number; shorter runs are depths, times, house numbers.
    s = _PHONE.sub(lambda m: REMOVED if sum(c.isdigit() for c in m.group(0)) >= 7 else m.group(0), s)
    if len(s) > MAX_NOTE:
        s = s[:MAX_NOTE].strip()
    return s or None


def _words(s: str) -> str:
    return f" {_NOT_WORD.sub(' ', str(s).lower()).strip()} "


def has_word(text: str | None, words: list[str]) -> bool:
    if not text:
        return False
    t = _words(text)
    return any(_words(w).strip() and _words(w) in t for w in words)


@cache
def details_table() -> dict[str, list[str]]:
    data = json.loads((config.DATA_DIR / "report_details.json").read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


@cache
def word_lists() -> dict[str, list[str]]:
    data = json.loads((config.DATA_DIR / "report_words.json").read_text(encoding="utf-8"))
    return {"danger": data["danger"], "flag": data["flag"]}


def valid_details(kind: str, details: list[str]) -> bool:
    allowed = details_table().get(kind, [])
    return len(details) <= MAX_DETAILS and len(set(details)) == len(details) and all(d in allowed for d in details)
