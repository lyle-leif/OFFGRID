"""Check an AI summary against the text it was given.

The guide passage is the answer; the AI summary is optional polish. A small model can
still slip in a wrong phone number, a made-up quantity or a place that isn't in the
sources, so before a summary is shown we extract its checkable details and require every
one to appear in the source text (or in the user's own question). Anything unsupported
drops the summary and the user keeps the exact guide text.
"""

import re

CITATION = re.compile(r"\[[a-z0-9-]+#[a-z0-9-]+\]", re.IGNORECASE)
# Numbered/bulleted list markers ("1. ", "2) ") at the start of a line are not facts.
LIST_MARKER = re.compile(r"^\s*\d{1,2}[.)]\s", re.MULTILINE)
# Phone-like: 7+ digits possibly broken up by spaces, dashes, dots or parentheses.
PHONE = re.compile(r"(?<!\w)\+?\(?\d[\d\s().\-]{5,}\d(?!\w)")
NUMBER = re.compile(r"(?<![\w.])\d+(?:[.,:]\d+)?(?![\w])")
# Two or more capitalised words in a row: names of places, offices, hospitals.
# Words joined only by spaces on the same line, so a phrase never runs across ". " or a newline.
NAME = re.compile(r"\b[A-Z][a-zA-Z'’]+(?:[ \t]+(?:(?:of|de|del|ng|sa|and|la|las|los)[ \t]+)?[A-Z][a-zA-Z'’]+)+")
# Capitalised words that start sentences or headings and are not names on their own.
GENERIC = {
    "if", "the", "a", "an", "do", "don't", "never", "call", "pack", "bring", "keep", "use", "go", "stay",
    "move", "turn", "wash", "boil", "check", "wait", "follow", "for", "in", "on", "at", "to", "and", "or",
    "you", "your", "it", "this", "that", "these", "make", "get", "avoid", "listen", "evacuate", "cover",
    "press", "also", "yes", "no", "note", "tip", "first", "then", "next", "finally", "ai", "summary",
}


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def _number_key(s: str) -> str:
    return s.replace(",", ".").rstrip(".")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("’", "'")).strip().lower()


def unsupported_facts(summary: str, sources: list[str]) -> list[str]:
    """Details in `summary` that cannot be found in any of `sources`. Empty means supported."""
    text = LIST_MARKER.sub(" ", CITATION.sub(" ", summary))
    src = "\n".join(sources)
    src_norm = _norm(src)
    src_phone_digits = [_digits(m) for m in PHONE.findall(src)]
    src_numbers = {_number_key(n) for n in NUMBER.findall(src)}
    src_numbers |= {d for d in src_phone_digits}  # a bare "911" or "143" may sit inside a phone list

    problems: list[str] = []

    # Phone numbers: the digits must appear inside a phone number in the sources
    # (the model may drop the area code, so a suffix/substring match is accepted).
    phones = PHONE.findall(text)
    for ph in phones:
        d = _digits(ph)
        if len(d) < 7:
            continue
        if not any(d in s for s in src_phone_digits) and d not in _digits(src):
            problems.append(ph.strip())
    text_wo_phones = PHONE.sub(" ", text)

    # Other numbers (quantities, distances, times, signal levels).
    for n in NUMBER.findall(text_wo_phones):
        key = _number_key(n)
        if key in src_numbers or n in src:
            continue
        problems.append(n)

    # Proper names: every multi-word capitalised phrase must appear in the sources.
    for m in NAME.finditer(text):
        phrase = m.group(0).strip(" .")
        words = [w for w in re.split(r"\s+", phrase) if w]
        # "Batangas Medical Center's" is the same name as "Batangas Medical Center"
        # (only the last word: "Mayor's Action Center" keeps its own apostrophe).
        if words:
            words[-1] = re.sub(r"['’]s?$", "", words[-1])
        is_generic = lambda w: w.lower().strip("'’") in GENERIC  # noqa: E731
        # Trim sentence words at either end ("Pack Water and Food" -> "Water and Food").
        while words and is_generic(words[0]):
            words.pop(0)
        while words and is_generic(words[-1]):
            words.pop()
        if sum(1 for w in words if w[0].isupper()) < 2:
            continue
        candidate = " ".join(words)
        if _norm(candidate) in src_norm:
            continue
        problems.append(candidate)

    # Keep order, drop duplicates.
    seen, out = set(), []
    for p in problems:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out
