"""Detect location questions that are answered from data, not by the language model.

"How far is it?", "nearest hospital", "what's near me", "contact number", "is it open":
these have exact answers in the facility records and the road graph, so the assistant
computes them instead of letting a small model guess.
"""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Intent:
    kind: str  # distance | nearest | nearby | contact | hours
    ftype: str | None = None  # facility type for "nearest"


def _rx(pattern: str) -> re.Pattern:
    return re.compile(pattern, re.IGNORECASE)


# Words for each facility type (English, Filipino, common Taglish). First match wins,
# so more specific phrases come before general ones.
TYPE_WORDS: list[tuple[str, re.Pattern]] = [
    ("evacuation_center", _rx(r"\b(evac\w*|evacuation|silungan|lilikasan|likasan|lumikas|shelter|refuge)\b")),
    ("barangay_hall", _rx(r"\b(barangay hall|brgy\.? hall|barangay office|bulwagan ng barangay)\b")),
    ("town_hall", _rx(r"\b(town hall|city hall|municipal hall|munisipyo|munisipyo|kapitolyo|capitol|mdrrmo office)\b")),
    ("rescue", _rx(r"\b(rescue|rescuer|ambulance|ambulansya|drrm\w*|saklolo)\b")),
    ("hospital", _rx(r"\b(hospital|ospital|emergency room|\ber\b|medical center)\b")),
    ("health_center", _rx(r"\b(clinic|klinika|health ?center|rhu|bhs|doctor|doktor|check-?up|magpatingin)\b")),
    ("pharmacy", _rx(r"\b(pharmacy|pharmacies|botika|drug ?store|drugstore|medicine|gamot|medisina|parmasya)\b")),
    ("police", _rx(r"\b(police|pulis|presinto|pnp|precinct)\b")),
    ("fire_station", _rx(r"\b(fire ?station|fire|bumbero|bfp|sunog)\b")),
    ("market", _rx(r"\b(market|palengke|grocery|groceries|supermarket|tindahan|pagkain|food|rice|bigas|water supply|mabibilhan)\b")),
]

_NEAREST = _rx(
    r"\b(nearest|closest|nearby|pinakamalapit|malapit na|pinaka malapit|the closest)\b"
    r"|\bwhere (is|are|can i|can we|do i|should i)\b|\bsaan\b|\bsaan (may|merong|ang|makakabili|pwede)\b"
    r"|\b(find|look for|hanapin|maghanap)\b"
)
_NEAR_ME = _rx(r"\b(near me|near us|around me|around here|nearby|malapit sa (akin|amin|atin|dito)|dito sa paligid|what'?s near)\b")
_DISTANCE = _rx(
    r"\b(how far|gaano kalayo|kalayo|layo|distance|ilang (km|kilometro|kilometers?|metro|meters?|minuto|minutes?|oras)"
    r"|how long (does it take|will it take|to (walk|drive|get|go))|gaano katagal|how many (km|kilometers|minutes|meters))\b"
)
_CONTACT = _rx(
    r"\b(phone|contact|telephone|tel\.?|cellphone|cp number|numero|number|tawagan|tumawag|call (them|it|this|here))\b"
)
_HOURS = _rx(
    r"\b(open|opening|closing|close|hours|bukas|sarado|anong oras|what time|schedule|oras ng)\b"
)
# The question points at the selected place ("this", "here", "dito") rather than naming something else.
_DEICTIC = _rx(r"\b(this|that|it|here|there|place|dito|diyan|doon|ito|iyan|iyon|lugar|sila|nila)\b")
# Live conditions are never answered from saved data.
_CONDITIONS = _rx(r"\b(flood\w*|baha|safe|ligtas|blocked|passable|madaanan|traffic|landslide|full|puno|available|may (bakante|space)"
                  r"|reports?|balita|updates?)\b")


# ---- questions about current conditions, answered from situation reports ----
_ROAD = _rx(r"\b(road|roads|street|st|avenue|ave|highway|hwy|bridge|tulay|daan|kalsada|kalye|route|daanan|lansangan)\b")
_ROAD_STATE = _rx(
    r"\b(flood\w*|baha|binaha|bumabaha|lubog|blocked|block|closed|sarado|passable|madaanan|landslide|guho|harang"
    r"|open|bukas|clear)\b"
)
_FLOOD_HERE = _rx(
    r"\b(is|are) (it|there|the area|this area|that area) (still )?flood\w*|\b(may|meron|merong) baha\b"
    r"|\bbaha (ba|pa|na|dito|doon|sa)\b|\b(bumabaha|binaha|lubog) (ba|pa|na)\b|\bflooded (now|today|right now|ngayon)\b"
    r"|\bany flood\w*\b|\b(is|are)\b.+\bflood(ed|ing)\b"
)
_EVAC = TYPE_WORDS[0][1]
_CENTER_STATE = _rx(
    r"\b(full|puno|siksikan|space|room|bakante|open|bukas|accepting|tumatanggap|capacity|available|sarado|closed)\b"
)
_POWER = _rx(
    r"\b(is|are) (there|the) (still )?(power|electricity|kuryente|brownout|blackout|power outage)\b"
    r"|\bpower (out|back|outage|interruption)\b|\b(may|wala|walang|meron|merong) (pa |pang )?(kuryente|ilaw)\b"
    r"|\b(brownout|blackout|power outage) (ba|pa|sa|in|at|na|now|ngayon|today)\b|\b(any|still) (brownout|blackout|power outage)s?\b"
)
_WATER = _rx(
    r"\b(where|saan)\b.*\b(drinking water|tubig|water)\b|\b(drinking water|tubig|water) (available|distribution|rasyon|refill)\b"
    r"|\b(may|meron|merong) (malinis na )?tubig\b|\bwater (station|point)s?\b"
)
_WATER_NOT = _rx(r"\b(purif\w*|boil\w*|pakuluan|clean|chlorine|how much|gaano|store|imbak|safe to drink|liters?|litro|pack)\b")
_MEDICAL = _rx(
    r"\b(any|are there|may|meron)\b.*\b(medical|injur\w*|sugatan)\b.*\b(report\w*|need\w*|nangangailangan)\b"
    r"|\bmedical (help )?(needs|requests|reports)\b"
)
_ANY_REPORTS = _rx(
    r"\b(any|latest|new|current|recent) (reports?|updates?|news|situation)\b|\bsituation reports?\b|\bwhat'?s happening\b"
    r"|\bano(ng)? (ang )?(balita|nangyayari|lagay)\b|\breports? (near|around|here|sa|in|on|for)\b|\bmay (report|balita)\b"
)
# "What should I do if the road is flooded?" wants advice from the guides, not reports.
_ADVICE = _rx(
    r"\b(what (should|do|can) (i|we) do|how (do|can|should) (i|we)|paano (ko|kung|mag\w*)|ano(ng)? (ang )?(gagawin|dapat)"
    r"|tips?|is it safe to|safe (ba )?(to|na|bang)|ligtas (ba )?(na|bang|mag\w*)|if|kung"
    r"|who (do|should|can) (i|we) (call|contact)|sino(ng)? (ang )?(tatawagan|tawagan)|hotlines?|numbers?"
    r"|warning signs?|signs? of|symptoms?)\b"
)
REPORT_KIND_ORDER = ["road_flooded", "road_blocked", "center_full", "center_open", "water_available", "power_out",
                     "medical_need"]


def report_query(question: str, place_is_center: bool = False) -> list[str] | None:
    """Report kinds a question asks about ("Is P. Burgos flooded?" -> road kinds), or None."""
    q = question.strip()
    if _ADVICE.search(q):
        return None
    kinds: list[str] = []
    if (_ROAD.search(q) and _ROAD_STATE.search(q)) or _FLOOD_HERE.search(q):
        kinds += ["road_flooded", "road_blocked"]
    # "Is it full?" about a selected center, but "Is the road open?" stays a road question.
    if (_EVAC.search(q) or (place_is_center and not kinds)) and _CENTER_STATE.search(q):
        kinds += ["center_full", "center_open"]
    if _WATER.search(q) and not _WATER_NOT.search(q):
        kinds.append("water_available")
    if _POWER.search(q):
        kinds.append("power_out")
    if _MEDICAL.search(q):
        kinds.append("medical_need")
    if not kinds and _ANY_REPORTS.search(q):
        kinds = list(REPORT_KIND_ORDER)
    return kinds or None


# ---- directions and follow-ups (used by the assistant route) ----
DIRECTIONS = _rx(
    r"\b(how (do|can|should) (i|we) (get|go)|how to (get|go)|get there|go there|directions?|route|"
    r"way to|navigate|paano (pumunta|pupunta|makarating|makapunta)|papunta|daan|saan dadaan|ituro)\b"
)
# "Is this route flooded?" asks about conditions, not directions; let the normal path answer it.
DIR_CONDITIONS = _rx(
    r"\b(flood\w*|baha|safe|ligtas|closed|blocked|sarado|open|bukas|passable|madaanan|traffic|landslide)\b"
)
# A follow-up that borrows the previous question's topic ("what about for elderly?").
FOLLOW_UP = _rx(
    r"^\s*(and|also|how about|what about|what if|paano naman|eh|e |ano naman|at )"
    r"|\b(them|they|those|that|it|this|these|naman|din|rin|ito|iyon|sila)\b"
)


def is_direction_question(q: str) -> bool:
    return bool(DIRECTIONS.search(q)) and not DIR_CONDITIONS.search(q)


def facility_type(q: str) -> str | None:
    for ftype, rx in TYPE_WORDS:
        if rx.search(q):
            return ftype
    return None


def detect(question: str, has_place: bool) -> Intent | None:
    q = question.strip()
    if _CONDITIONS.search(q):
        return None
    ftype = facility_type(q)
    short = len(q.split()) <= 5

    # Contact and hours of the selected place: "Contact number?", "Is it open?", "Bukas ba sila?".
    # Hotline questions that name a service ("Lipa fire station number") stay with the guides.
    if has_place and _CONTACT.search(q) and (_DEICTIC.search(q) or (short and not ftype)):
        return Intent("contact")
    if has_place and _HOURS.search(q) and (_DEICTIC.search(q) or (short and not ftype)):
        return Intent("hours")

    if ftype and (_NEAREST.search(q) or _NEAR_ME.search(q)):
        return Intent("nearest", ftype)
    if _NEAR_ME.search(q):
        return Intent("nearby")
    if _DISTANCE.search(q):
        # "How far is the nearest hospital?" without a selected place means "nearest".
        if ftype and not has_place:
            return Intent("nearest", ftype)
        return Intent("distance")
    if _NEAREST.search(q) and re.search(r"\b(nearest|closest|pinakamalapit)\b", q, re.IGNORECASE):
        return Intent("nearest")  # "Where's the nearest place to go?" -> a few key types
    return None


# Every pattern above: their words are what the spelling fixer (services/normalize.py)
# corrects typos towards.
PATTERNS: list[re.Pattern] = [
    *(rx for _, rx in TYPE_WORDS), _NEAREST, _NEAR_ME, _DISTANCE, _CONTACT, _HOURS, _DEICTIC, _CONDITIONS,
    _ROAD, _ROAD_STATE, _FLOOD_HERE, _CENTER_STATE, _POWER, _WATER, _MEDICAL, _ANY_REPORTS,
    DIRECTIONS, DIR_CONDITIONS, FOLLOW_UP,
]
