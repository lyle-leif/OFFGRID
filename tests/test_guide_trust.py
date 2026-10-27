"""Per-section trust metadata in the guides: which official source a section was checked
against (shown on screen), kept out of search and out of what the AI sees."""

from app import config
from app.services.retrieval import load_chunks

GUIDE = """---
title: Test Guide
status: mixed
---

## Checked section
<!-- checked: 2026-10-27 | source: PHIVOLCS | url: https://www.phivolcs.dost.gov.ph/ -->
Drop, cover and hold on until the shaking stops.

## Draft section
<!-- status: draft -->
Keep a whistle in your go-bag.

## No comment section
Store water in clean containers.

## Checked without a source
<!-- checked: 2026-10-27 -->
This must still count as a draft.
"""


def _chunks(tmp_path):
    (tmp_path / "test.md").write_text(GUIDE, encoding="utf-8")
    return {c.title: c for c in load_chunks(tmp_path)}


def test_checked_section_carries_its_source(tmp_path):
    c = _chunks(tmp_path)["Checked section"]
    assert not c.draft
    assert c.trust() == {"draft": False, "checked_on": "2026-10-27", "source": "PHIVOLCS",
                         "source_url": "https://www.phivolcs.dost.gov.ph/"}


def test_sections_without_a_named_source_are_drafts(tmp_path):
    chunks = _chunks(tmp_path)
    for title in ("Draft section", "No comment section", "Checked without a source"):
        assert chunks[title].draft, title
        assert chunks[title].source == ""


def test_metadata_is_not_text_or_searchable(tmp_path):
    for c in _chunks(tmp_path).values():
        assert "<!--" not in c.text and "checked" not in c.text.lower().split()[:1]
        assert "phivolcs" not in c.tokens and "2026" not in " ".join(c.tokens)
    assert _chunks(tmp_path)["Checked section"].text == "Drop, cover and hold on until the shaking stops."


def test_every_real_guide_section_has_a_trust_state():
    """Every section is either checked against a named source or a draft; nothing in between."""
    for c in load_chunks(config.GUIDES_DIR):
        assert "<!--" not in c.text, c.chunk_id
        assert c.draft or (c.checked_on and c.source), c.chunk_id
