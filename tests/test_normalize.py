import pytest

from app import config
from app.main import _load_router, app_lexicon
from app.services.locations import LocationStore
from app.services.normalize import Normalizer, distance
from app.services.retrieval import load_chunks


@pytest.fixture(scope="module")
def n():
    return Normalizer(app_lexicon(load_chunks(config.GUIDES_DIR), LocationStore(config.LOCATIONS_FILE), _load_router()))


@pytest.mark.parametrize("typed,read", [
    # typos are fixed
    ("neerest hospitl", "nearest hospital"),
    ("nearest pharmcy", "nearest pharmacy"),
    ("how do i stop bleding", "how do i stop bleeding"),
    ("can i use generater inside the house", "can i use generator inside the house"),
    ("neareset polic station", "nearest police station"),
    # text-speak and short forms
    ("hw far is it", "how far is it"),
    ("wat shuld i pack in my gobag", "what should i pack in my go bag"),
    ("pano pumunta dito", "paano pumunta dito"),
    ("saan ang brgy hall", "saan ang barangay hall"),
    ("hospital near me pls", "hospital near me please"),
    # cleaning
    ("HELPPPP", "help"),
    ("pinaka-malapit na ospital", "pinakamalapit na ospital"),
    ("‘nearest’ hospital", "'nearest' hospital"),
    ("  where   is it  ", "where is it"),
    # "were" is only rewritten where it means "where"
    ("were is the evacuation center", "where is the evacuation center"),
    ("we were evacuated", "we were evacuated"),
])
def test_fixes(n, typed, read):
    assert n.normalize(typed) == read


@pytest.mark.parametrize("text", [
    "San Jose evacuation center",  # place names stay
    "baha ba sa p burgos",
    "brownout ba sa lipa",
    "signal no. 2",  # numbers stay
    "recipe for adobo",  # everyday words are not pulled into the guides
    "who won the basketball game",
    "what does signal no. 3 mean",  # "meaning"/"mean" must not become "meeting"
    "bali ang buto",  # never corrected into a short word ("buto" -> "but")
    "ang bata ay may lagnat",
])
def test_leaves_alone(n, text):
    assert n.normalize(text) == text.lower()


def test_distance():
    assert distance("hospitl", "hospital", 2) == 1
    assert distance("ehre", "here", 2) == 1  # neighbours swapped = one edit
    assert distance("abc", "xyz", 1) == 2  # gives up past the limit
    assert distance("same", "same", 1) == 0
