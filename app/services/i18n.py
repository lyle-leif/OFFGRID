"""Interface language for the text the hub writes itself (place answers, report answers,
route steps, errors). Reads the same app/static/lang/<id>.json files as the phone, so the
hub and the phone word things the same way (tests/js/parity.test.mjs checks it).

To add a language: a new lang/<id>.json with the same keys, plus an entry in LANGS here
and in app/static/i18n.js.
"""

import json
import re
from functools import cache
from pathlib import Path

from fastapi import Request

LANG_DIR = Path(__file__).resolve().parent.parent / "static" / "lang"
LANGS = ("tl", "en")
_VAR = re.compile(r"\{(\w+)\}")
ROAD_CLASS = {"footpath": "footpath", "track": "track", "service road": "service_road", "local road": "local_road",
              "road": "road"}


@cache
def table(lang: str) -> dict[str, str]:
    return json.loads((LANG_DIR / f"{lang}.json").read_text(encoding="utf-8"))


def norm(lang: str | None) -> str:
    return lang if lang in LANGS else "en"


def t(lang: str | None, key: str, **vars) -> str:
    """The template for `key` with "{name}" filled from vars. With n= and a key_one/key_other
    pair, the plural form is picked. Missing: English, then the key itself."""
    def pick(tab: dict) -> str | None:
        if "n" in vars and f"{key}_one" in tab:
            return tab[f"{key}_one" if vars["n"] == 1 else f"{key}_other"]
        return tab.get(key)

    tpl = pick(table(norm(lang)))
    if tpl is None:
        tpl = pick(table("en"))
    if tpl is None:
        tpl = key
    return _VAR.sub(lambda m: str(vars[m.group(1)]) if m.group(1) in vars else m.group(0), tpl)


def road_name(lang: str | None, name: str) -> str:
    """Unnamed roads are stored by class label ("local road"): show it in this language."""
    return t(lang, f"road.{ROAD_CLASS[name]}") if name in ROAD_CLASS else name


def request_lang(request: Request) -> str:
    """The app sends its language as X-Lang (or ?lang=) on API calls."""
    return norm(request.headers.get("x-lang") or request.query_params.get("lang"))
