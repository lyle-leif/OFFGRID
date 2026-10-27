"""Keyword retrieval over Markdown guides.

Each guide is split on `## ` headings; every section is one citable chunk with
id `<file-stem>#<heading-slug>`. Search is BM25 plus a hard evidence gate so
unsupported questions never reach the model.
"""

import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from rank_bm25 import BM25Okapi

STOPWORDS = set(
    """
    a an the and or but if then so of to in on at by for with from as is are was were be been
    being do does did done i me my we our you your he she it its they them their this that these
    those what which who whom when where why how can could should would will shall may might must
    not no yes there here about into over under up down out off than too very just also any some
    all each other such only own same more most much many get got have has had having am
    ang ng sa mga na ay at si ni kay ko mo ka ako ikaw siya kami tayo kayo sila ito iyan iyon
    po ba pa lang din rin naman kung para may wala walang ano anong paano saan kailan bakit
    dapat kailangan gagawin gawin nga yung yun kapag tuwing bang bago ako akin namin natin
    someone somebody anyone think pwede puwede pede ngayon ibig
    """.split()
)

_WORD = re.compile(r"[a-z0-9]+")


def _stem(w: str) -> str:
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def tokenize(text: str) -> list[str]:
    return [_stem(w) for w in _WORD.findall(text.lower()) if w not in STOPWORDS]


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


@dataclass
class Chunk:
    doc: str
    chunk_id: str
    doc_title: str
    title: str
    text: str
    tokens: list[str] = field(repr=False, default_factory=list)
    # Where this section was checked (from its <!-- checked: … --> comment). A section
    # without one is a draft, and the app says so on screen.
    checked_on: str = ""
    source: str = ""
    source_url: str = ""

    @property
    def draft(self) -> bool:
        return not self.checked_on

    def trust(self) -> dict:
        """What the app shows under the section: checked against a source, or a draft."""
        return {"draft": self.draft, "checked_on": self.checked_on, "source": self.source, "source_url": self.source_url}


# Per-section metadata, written right under a `## ` heading, for example
#   <!-- checked: 2026-10-27 | source: PHIVOLCS | url: https://www.phivolcs.dost.gov.ph/ -->
# It is removed from the section text, so it is never searched, shown as text, or given to the AI.
_META = re.compile(r"<!--(.*?)-->", re.DOTALL)


def _parse_section_meta(text: str) -> tuple[dict[str, str], str]:
    meta: dict[str, str] = {}
    for comment in _META.findall(text):
        for part in comment.split("|"):
            if ":" in part:
                k, v = part.split(":", 1)
                meta[k.strip().lower()] = v.strip()
    return meta, _META.sub("", text).strip()


@dataclass
class Hit:
    chunk: Chunk
    score: float
    matched_terms: int


def _parse_front_matter(raw: str) -> tuple[dict[str, str], str]:
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw
    meta = {}
    for line in raw[3:end].strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, raw[end + 4 :]


def load_chunks(guides_dir: Path) -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in sorted(guides_dir.glob("*.md")):
        meta, body = _parse_front_matter(path.read_text(encoding="utf-8"))
        doc_title = meta.get("title", path.stem)
        sections = re.split(r"^## +", body, flags=re.MULTILINE)[1:]
        for section in sections:
            heading, _, text = section.partition("\n")
            section_meta, text = _parse_section_meta(text)
            heading = heading.strip()
            if not text:
                continue
            checked = section_meta.get("checked", "")
            chunk = Chunk(
                doc=path.name,
                chunk_id=f"{path.stem}#{slugify(heading)}",
                doc_title=doc_title,
                title=heading,
                text=text,
                # "checked" only counts with a named source; "status: draft" (or nothing) is a draft.
                checked_on=checked if section_meta.get("source") else "",
                source=section_meta.get("source", "") if checked else "",
                source_url=section_meta.get("url", "") if checked else "",
            )
            # Heading and doc title words count twice: they say what the section is about.
            chunk.tokens = tokenize(f"{doc_title} {heading} {heading} {text}")
            chunks.append(chunk)
    return chunks


# Query-side synonyms: everyday words and Filipino terms that the guides phrase differently.
# Written as plain words; SYNONYMS below is the same map with every word stemmed like the
# index ("lumikas" -> "lumika"), because lookups happen after stemming.
SYNONYM_WORDS: dict[str, list[str]] = {
    # people
    "baby": ["infant"], "sanggol": ["infant", "baby"], "bata": ["child", "children"],
    "kid": ["child", "children"], "child": ["children"], "toddler": ["children", "child"],
    "elderly": ["older", "adult", "person"], "senior": ["older", "adult", "person"],
    "matanda": ["older", "adult", "person"], "lolo": ["older", "adult", "person"], "lola": ["older", "adult", "person"],
    "nanay": ["person"], "tatay": ["person"], "mama": ["person"], "papa": ["person"], "anak": ["child", "person"],
    "kapatid": ["person"], "friend": ["person"], "kaibigan": ["person"], "kasama": ["person"], "neighbor": ["person"],
    "man": ["person"], "woman": ["person"], "lalaki": ["person"], "babae": ["person"], "pwd": ["disability"],
    "disabled": ["disability"], "alaga": ["pet"], "aso": ["pet"], "pusa": ["pet"],
    # hazards
    "bagyo": ["typhoon", "storm"], "storm": ["typhoon"], "hurricane": ["typhoon"],
    "baha": ["flood", "floodwater"], "ligtas": ["safe"], "lumusong": ["walk", "wading"],
    "wade": ["walk", "wading"], "habang": ["during"], "flooding": ["flood"], "flooded": ["flood"],
    "brownout": ["outage", "power"], "blackout": ["outage", "power", "brownout"],
    "coming": ["approaching"], "parating": ["approaching", "typhoon"], "darating": ["approaching"],
    "electricity": ["power", "electrical"], "sintomas": ["symptom"], "symptom": ["sign"],
    "kuryente": ["power", "electrical", "electricity"],
    "evacuate": ["evacuation", "evacuating"], "evacuating": ["evacuate", "evacuation"],
    "evacuation": ["evacuate"], "lumikas": ["evacuate", "evacuation"], "likas": ["evacuate"],
    # earthquakes, tsunamis, Taal Volcano
    "lindol": ["earthquake"], "lumindol": ["earthquake"], "yanig": ["earthquake", "shaking"],
    "pagyanig": ["earthquake", "shaking"], "quake": ["earthquake"], "drill": ["practice"],
    "bulkan": ["volcano"], "volcanic": ["volcano", "eruption"], "pagputok": ["eruption"],
    "erupt": ["eruption"], "abo": ["ash", "ashfall"], "ash": ["ashfall"], "ashfall": ["ash"],
    "senyales": ["sign", "warning"], "palatandaan": ["sign", "warning"], "alon": ["wave"],
    "sabihin": ["mean", "meaning"],
    # supplies
    "gamot": ["medicine"], "medication": ["medicine"], "tubig": ["water"], "inumin": ["drinking", "water"],
    "drink": ["drinking"], "inom": ["drinking", "water"], "uminom": ["drinking", "water"],
    "kandila": ["candle"], "gumamit": ["use"], "gamit": ["use"], "loob": ["inside", "indoor"],
    "bahay": ["house", "home"], "inside": ["indoor"], "indoors": ["indoor"], "house": ["home", "indoor"],
    "arm": ["bone", "injured"], "leg": ["bone", "injured"], "cool": ["heat"], "hot": ["heat"], "init": ["heat"], "mainit": ["heat"],
    "prepare": ["preparing", "prepared"], "maghanda": ["prepare", "preparing"], "handa": ["prepare", "ready"],
    "dog": ["pet"], "cat": ["pet"],
    "pagkain": ["food"], "ilaw": ["flashlight", "light"], "dalhin": ["bring", "pack"], "dala": ["bring", "pack"],
    "bring": ["pack"], "pack": ["bring"], "emergency-bag": ["go-bag"], "fridge": ["refrigerator"],
    "cellphone": ["phone"], "cp": ["phone"], "selpon": ["phone"], "baterya": ["battery"],
    # first aid
    "sugat": ["wound", "cut"], "dugo": ["bleeding", "blood"], "bleed": ["bleeding"],
    "paso": ["burn"], "napaso": ["burn"], "lagnat": ["fever"], "nahimatay": ["unresponsive", "faint"],
    "patigilin": ["stop"], "tigil": ["stop"], "itigil": ["stop"], "bali": ["broken", "fracture"],
    "buto": ["bone"], "fracture": ["broken"],
    "unconscious": ["unresponsive"], "fainted": ["unresponsive", "faint"], "collapsed": ["unresponsive"],
    "breathing": ["breathing", "unresponsive"],
    # hotlines
    "hotline": ["number", "call"], "number": ["hotline"], "call": ["hotline"], "contact": ["hotline", "number"],
    "tawag": ["call", "hotline"], "tumawag": ["call", "hotline"], "numero": ["number", "hotline"],
    "rescue": ["cdrrmo", "rescue"], "rescuer": ["rescue", "cdrrmo"], "ambulance": ["rescue", "911"],
    "ambulansya": ["rescue", "911"], "saklolo": ["rescue", "911"], "drrmo": ["cdrrmo", "pdrrmo"],
    "police": ["pnp"], "pulis": ["police", "pnp"], "fire": ["bfp"], "sunog": ["fire", "bfp"],
    "bumbero": ["fire", "bfp"], "province": ["provincial"], "lalawigan": ["province", "provincial"],
    "electric": ["electric", "power"], "batelec": ["electric", "power"], "weather": ["pagasa"],
}


def _stemmed(words: dict[str, list[str]]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for k, vs in words.items():
        merged = out.setdefault(_stem(k), [])
        merged += [s for s in (_stem(v) for v in vs) if s not in merged]
    return out


SYNONYMS: dict[str, list[str]] = _stemmed(SYNONYM_WORDS)


def expand(tokens: list[str]) -> list[list[str]]:
    """Group each query token with its synonyms. One group = one concept."""
    groups, seen = [], set()
    for t in tokens:
        if t in seen:
            continue
        seen.add(t)
        groups.append([t, *SYNONYMS.get(t, [])])
    return groups


class Retriever:
    def __init__(self, chunks: list[Chunk]):
        if not chunks:
            raise ValueError("no guide chunks found; add Markdown files with ## sections")
        self.chunks = chunks
        self._bm25 = BM25Okapi([c.tokens for c in chunks])
        self._token_sets = [set(c.tokens) for c in chunks]

    def search(self, query: str, k: int) -> list[Hit]:
        groups = expand(tokenize(query))
        if not groups:
            return []
        # Each concept contributes its best-scoring word once, so synonyms widen recall
        # without inflating scores.
        scores = sum(
            np.max([self._bm25.get_scores([t]) for t in g], axis=0) for g in groups
        )
        hits = [
            # matched_terms counts concepts, so "baby" + its synonym "infant" count once.
            Hit(c, float(s), sum(1 for g in groups if ts.intersection(g)))
            for c, s, ts in zip(self.chunks, scores, self._token_sets)
        ]
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:k]

    def evidence(
        self,
        query: str,
        k: int,
        threshold: float,
        min_terms: int,
        strong_score: float,
        relative: float = 0.0,
    ) -> list[Hit]:
        """Hits strong enough to ground an answer. Empty list means 'not covered'.

        `relative` drops weak tag-alongs: a hit must score at least that fraction of the best hit.
        """
        n = len(expand(tokenize(query)))
        # Long questions must match proportionally more of their concepts (at least 40%).
        need = min(n, max(min_terms, math.ceil(0.4 * n)))
        if need == 0:
            return []
        # The strong-score shortcut is for short questions hinging on one rare word
        # ("How do I treat a burn?"); it still has to cover half the question.
        strong_need = math.ceil(n / 2)
        hits = [
            h for h in self.search(query, k)
            if h.matched_terms > 0
            and ((h.score >= strong_score and h.matched_terms >= strong_need)
                 or (h.score >= threshold and h.matched_terms >= need))
        ]
        if hits and relative:
            top = hits[0].score
            hits = [h for h in hits if h.score >= relative * top]
        return hits
