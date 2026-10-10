"""Retrieval and gate tuning. If you change the guides or config thresholds, rerun these."""

import pytest

from app import config
from app.services.retrieval import Retriever, load_chunks, tokenize


@pytest.fixture(scope="module")
def retriever():
    return Retriever(load_chunks(config.GUIDES_DIR))


def evidence(r, q):
    return r.evidence(
        q, config.TOP_K, config.THRESHOLD, config.MIN_TERMS, config.STRONG_SCORE, config.RELATIVE_SCORE
    )


# (question, a chunk id that must be among the evidence)
COVERED = [
    ("What should I bring for my baby when evacuating?", "go-bag#infants-and-young-children"),
    ("How much water should I pack in my go-bag?", "go-bag#water-and-food"),
    ("Is it safe to walk through floodwater?", "flood-safety#walking-or-driving-through-floodwater"),
    ("How do I treat a burn?", "first-aid-basics#burns"),
    ("Can I run a generator inside the house?", "power-outage#generators-and-carbon-monoxide"),
    ("What does typhoon signal number 3 mean?", "typhoon-prep#understanding-warnings"),
    ("How long does food last in the fridge during a brownout?", "power-outage#food-safety-without-refrigeration"),
    ("What are the symptoms of leptospirosis?", "flood-safety#health-risks-after-floods"),
    ("How do I stop bleeding?", "first-aid-basics#bleeding"),
    ("When should we evacuate before a typhoon?", "typhoon-prep#when-to-evacuate"),
    ("How can I save my phone battery?", "power-outage#saving-phone-battery"),
    ("paano maghanda ng go-bag", "go-bag#what-a-go-bag-is"),
    # synonyms and Filipino words
    ("anong dapat dalhin para sa sanggol", "go-bag#infants-and-young-children"),
    ("What should my kids bring?", "go-bag#infants-and-young-children"),
    ("ano ang gagawin habang may bagyo", "typhoon-prep#during-the-typhoon"),
    ("ligtas bang lumusong sa baha", "flood-safety#walking-or-driving-through-floodwater"),
    ("What do elderly people need to pack?", "go-bag#older-adults-persons-with-disabilities-and-pets"),
    ("paano patigilin ang dugo sa sugat", "first-aid-basics#bleeding"),
    ("napaso ako ng mainit na tubig", "first-aid-basics#burns"),
    # hotlines
    ("What number do I call for an emergency?", "hotlines#national-emergency-hotline-911"),
    ("Batangas City rescue hotline", "hotlines#batangas-city-emergency-hotlines"),
    ("Lipa fire station number", "hotlines#lipa-city-emergency-hotlines"),
    ("PDRRMO Batangas contact number", "hotlines#batangas-province-pdrrmo-and-provincial-offices"),
    ("numero ng pulis sa Lipa", "hotlines#lipa-city-emergency-hotlines"),
    ("Who do I call about a brownout in Lipa?", "hotlines#power-and-water-utilities-in-lipa"),
    ("Red Cross hotline", "hotlines#philippine-red-cross-national-hotline"),
]

UNCOVERED = [
    "Is the bridge on Rizal Street flooded right now?",
    "What is the capital of France?",
    "Who won the basketball game last night?",
    "Is Sample Hospital A open now?",
    "How do I bake a chocolate cake?",
    "earthquake drill procedure",
    "Where can I buy rice cheaply?",
]


def test_weak_tag_along_sources_are_dropped(retriever):
    ids = [h.chunk.chunk_id for h in evidence(retriever, "Is it safe to walk through floodwater?")]
    assert ids[0] == "flood-safety#walking-or-driving-through-floodwater"
    assert "typhoon-prep#after-the-typhoon" not in ids


def test_chunk_ids_are_unique_and_well_formed(retriever):
    ids = [c.chunk_id for c in retriever.chunks]
    assert len(ids) == len(set(ids))
    assert "go-bag#infants-and-young-children" in ids
    assert all("#" in i for i in ids)


def test_tokenize_drops_stopwords_and_plurals():
    assert tokenize("What are the Symptoms of floods?") == ["symptom", "flood"]
    assert tokenize("paano ang mga baterya") == ["baterya"]


@pytest.mark.parametrize("question,expected", COVERED)
def test_covered_questions_find_evidence(retriever, question, expected):
    ids = [h.chunk.chunk_id for h in evidence(retriever, question)]
    assert expected in ids, f"{question!r} -> {ids}"


@pytest.mark.parametrize("question", UNCOVERED)
def test_uncovered_questions_are_gated(retriever, question):
    hits = evidence(retriever, question)
    assert hits == [], f"{question!r} unexpectedly matched {[h.chunk.chunk_id for h in hits]}"
