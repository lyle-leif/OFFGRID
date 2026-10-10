"""Clean up a question's spelling before anything tries to understand it.

People type fast in an emergency: "neerest hospitl", "hw far", "pano pumunta sa evacuaton".
Everything after this step (location intents, situation-report questions, directions, guide
search) matches exact words, so one typo used to turn a good question into "not covered".

Three steps, all deterministic (no model, no download), and mirrored exactly by the phone
engine (app/static/offline/normalize.js) using the lexicon exported in pack/lexicon.json:
  1. clean: lowercase, straight quotes, "pinaka-malapit" -> "pinakamalapit", "helppp" -> "helpp"
  2. aliases: text-speak and common short forms ("hw" -> "how", "pano" -> "paano", "brgy" -> "barangay")
  3. fuzzy: a word the app doesn't know is replaced by the closest word it does know, within
     1 edit (2 for words of 8+ letters), keeping the first letter. Place and road names, stopwords and
     a list of everyday words are known, so they are never "corrected".
"""

import re
from collections import Counter

# Whole-word replacements: text-speak, short forms and the commonest misspellings that are
# too short or too far for the fuzzy step.
ALIASES = {
    # English
    "hw": "how", "hwo": "how", "wat": "what", "wht": "what", "wut": "what", "whr": "where", "wer": "where",
    "wheres": "where's", "whats": "what's", "r": "are", "u": "you", "ur": "your", "pls": "please",
    "plz": "please", "pleas": "please", "thx": "thanks", "hosp": "hospital", "evac": "evacuation",
    "nearst": "nearest", "neares": "nearest", "nrst": "nearest", "b4": "before",
    "dont": "don't", "cant": "can't", "im": "i'm", "num": "number", "tel": "telephone",
    "info": "information", "meds": "medicine", "med": "medicine", "elec": "electricity",
    # Filipino / Taglish
    "pano": "paano", "panu": "paano", "pnu": "paano", "anu": "ano", "nsan": "nasaan",
    "nasan": "nasaan", "d2": "dito", "dto": "dito", "dun": "doon", "dyan": "diyan",
    "jan": "diyan", "pde": "pwede", "pede": "pwede", "pwde": "pwede", "puede": "pwede", "kc": "kasi",
    "ksi": "kasi", "ung": "yung", "yng": "yung", "brgy": "barangay", "bgy": "barangay", "sna": "sana",
    "nmn": "naman", "lng": "lang", "tlga": "talaga", "mlpit": "malapit", "malpit": "malapit",
    "ospt": "ospital", "hospt": "hospital", "bkas": "bukas", "kuryenteng": "kuryente",
    "gobag": "go bag", "emergencybag": "go bag", "ther": "there", "thier": "their", "wen": "when", "shud": "should", "shld": "should", "shuld": "should",
    "wud": "would", "cud": "could", "becoz": "because", "bcoz": "because", "bcz": "because", "abt": "about",
}
# Multi-word fixes, applied before the per-word steps (whole words only). Numbers and "san"
# are only rewritten in context: "signal no. 2" and "San Jose" must stay as they are.
PHRASES = [
    ("were is", "where is"), ("were are", "where are"), ("were can", "where can"), ("were do", "where do"),
    ("how 2", "how to"), ("how do i got", "how do i get"), ("pinaka malapit", "pinakamalapit"),
    ("san ang", "saan ang"), ("san may", "saan may"), ("san ba", "saan ba"),
]

# Everyday words that are not in the guides but must never be "corrected" into a guide word
# (that could make an off-topic question look like an emergency one).
EXTRA_KNOWN = """
able about above across actually after again against age ago agree air all almost alone along already
always amazing among animal another answer anybody anyone anything anyway apartment apple area arm army
around arrive art ask aunt away awesome back bad bake ball bank bar basketball bath beach bean beautiful
became because become bed beef been beer before begin behind believe best better between big bike bill
bird birthday bit black blue board boat body book born borrow boss both bottle box boy brain bread break
breakfast bridge brother brown build building bus business busy buy cake call came camera camp can capital
car card care carry case cat catch cause cell center chair chance change cheap check cheese chicken
chocolate choose church city class clean clear close coffee cold college color come company computer
cook cool corner cost could country couple course cousin cover crazy create cup cut dad dance dark date
daughter dead deal dear decide deep design desk die different difficult dinner doctor dog dollar door
down dream dress drink drive dry each early earth easy eat egg either else email end engine enjoy enough
enter even evening event ever every everyone everything exam example exercise expensive explain eye face
fact fall family famous fan far farm fast father favorite feel few field fight film final find fine finger
finish first fish fit fix floor fly follow football foreign forest forget form france free fresh friend
from front fruit full fun funny future game garden gas gave girl give glad glass goal gold good got
government grade grand great green ground group grow guess guitar guy hair half hand happen happy hard
hat hate head hear heart heavy hello help her here high hill him his history hit hobby hold holiday home
homework hope horse hot hotel hour house how huge human hungry hurry husband idea important inside
instead interest internet island job join joke juice jump just keep key kid kill kind king kitchen knew
know lady lake land language large last late later laugh law lazy lead learn least leave left leg lend
less lesson letter level library lie life like line list listen little live long look lose lot loud love
low luck lunch machine mad made main make man many map market marry math matter maybe meal mean meat meet
member men message middle might mile milk mind minute miss model mom money month moon more morning most
mother mountain mouse mouth move movie much music must name nation nature near neck need neighbor never
new news next nice night noise none noon north nose note nothing notice now number ocean offer office
often oil okay old once only open order other outside page paint pair paper parent park part party pass
past pay peace pen pencil people perfect perhaps person phone photo piano pick picture piece pink pizza
place plan plane plant play player please pocket point police pool poor popular possible pretty price
prince print problem program promise pull push put queen question quick quiet race radio rain raise read
ready real reason recipe red remember rent rest restaurant rich ride right ring river road rock room
round rule run sad said salt same sand save say school score sea season seat second see seem sell send
sentence serve set shape share she sheep shirt shoe shop short should shout show sick side sign silver
simple sing sister sit size skin sky sleep slow small smell smile snow soap soccer sock soft some son
song soon sorry sound soup south space speak special spell spend sport spring square stand star start
station stay step still stone stop store story street strong student study style subject sugar summer
sun sure surprise sweet swim table take talk tall taste taxi tea teach team teeth tell test thank that
their them then there thing think thirsty though thought through throw ticket time tired title today
together told tomorrow tonight too took tooth top touch tour town toy traffic train travel tree trip
true try turn uncle under understand until upon use useful usual vacation very video village visit voice
wait wake walk wall want war warm wash watch way wear weather website wedding week weekend weight well
west wet whale wheel while white whole why wide wife wild win wind window wine winner winter wish woman
wonder wood word work world worry write wrong yard year yellow yesterday young zoo adobo sinigang lechon
recipe basketball volleyball movie song singer actor president mayor governor election vote won game
score lindol bulkan taal ashfall tsunami pagputok abo landslide guho lupa earthquake volcano eruption
kamusta salamat maganda pangit masarap gutom uhaw pagod antok sakit ulo tiyan ngipin mata tenga ilong
kamay paa likod dibdib bahay kwarto kusina banyo sala labas loob taas baba harap likuran tabi kanan kaliwa
ngayon bukas kahapon mamaya kanina umaga tanghali hapon gabi linggo buwan taon oras minuto segundo
"""

_CLEAN = [
    (re.compile(r"[‘’ʼ]"), "'"),
    (re.compile(r"[“”]"), '"'),
    (re.compile(r"pinaka-"), "pinaka"),
    (re.compile(r"([a-z])\1{2,}"), r"\1\1"),
    (re.compile(r"\s+"), " "),
]
_WORD = re.compile(r"[a-z0-9ñ]+")
_ALPHA = re.compile(r"^[a-z]+$")
_LETTERS = re.compile(r"[a-z]+")
# A known word plus one of these endings is a real word too ("evacuated", "flooding").
_ENDINGS = ("ing", "ed", "es", "s", "d", "ly")


def max_edits(word: str) -> int:
    # Two edits only for long words: "meaning" must not become "meeting".
    return 1 if len(word) < 8 else 2


def distance(a: str, b: str, limit: int) -> int:
    """Optimal-string-alignment edit distance (a swap of two neighbours counts as one
    edit), giving up early once it is certainly above `limit`."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev2: list[int] = []
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        best = cur[0]
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            v = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                v = min(v, prev2[j - 2] + 1)
            cur[j] = v
            best = min(best, v)
        if best > limit:
            return limit + 1
        prev2, prev = prev, cur
    return prev[len(b)]


def keywords(patterns) -> set[str]:
    """Words the question-understanding regexes look for ("nearest", "ospital", "papunta"...)."""
    out = set()
    for p in patterns:
        src = re.sub(r"\\[a-zA-Z]", " ", p.pattern)  # drop \b, \w, \s
        out.update(w for w in _LETTERS.findall(src.lower()) if len(w) >= 4)
    return out


def build_lexicon(chunks, patterns, synonyms, stopwords, place_names) -> dict:
    """Everything the normalizer needs, as plain JSON (the phone gets the same file).

    words: correction targets with a frequency (guide text, regex keywords, synonym words;
           4+ letters, so "buto" is never turned into "but")
    known: words left alone (stopwords, place and road names, everyday words)"""
    freq: Counter = Counter()
    for c in chunks:
        freq.update(w for w in _LETTERS.findall(f"{c.doc_title} {c.title} {c.text}".lower()) if len(w) >= 4)
    for w in keywords(patterns):
        freq[w] += 5  # what the app looks for wins ties
    for k, vs in synonyms.items():
        for w in [k, *vs]:
            if _ALPHA.match(w) and len(w) >= 4:
                freq[w] += 2
    known = set(stopwords) | set(EXTRA_KNOWN.split())
    for name in place_names:
        known.update(w for w in _LETTERS.findall(name.lower()) if len(w) >= 3)
    known -= set(freq)
    return {
        "words": dict(sorted(freq.items())),
        "known": sorted(known),
        "aliases": ALIASES,
        "phrases": PHRASES,
    }


class Normalizer:
    def __init__(self, lexicon: dict):
        self.freq: dict[str, int] = lexicon["words"]
        self.known = set(lexicon["known"]) | set(self.freq)
        self.aliases: dict[str, str] = lexicon["aliases"]
        self.phrases = [(re.compile(r"\b" + re.escape(a) + r"\b"), b) for a, b in lexicon["phrases"]]
        # Correction candidates grouped by first letter (typos rarely change it).
        self._by_first: dict[str, list[str]] = {}
        for w in self.freq:
            self._by_first.setdefault(w[0], []).append(w)
        self._cache: dict[str, str] = {}

    def correct(self, word: str) -> str:
        """The closest known word within max_edits, or the word itself."""
        if word in self._cache:
            return self._cache[word]
        limit = max_edits(word)
        best = None  # (edits, -frequency, word): fewest edits, then most common, then A-Z
        cands = self._by_first.get(word[0], [])
        if len(word) > 1 and word[1] != word[0]:  # first two letters swapped: "ehre" -> "here"
            cands = cands + self._by_first.get(word[1], [])
        for w in cands:
            d = distance(word, w, limit)
            if d <= limit:
                key = (d, -self.freq[w], w)
                if best is None or key < best:
                    best = key
        out = best[2] if best else word
        self._cache[word] = out
        return out

    def word(self, w: str) -> str:
        if w in self.aliases:
            return self.aliases[w]
        if w in self.known or len(w) < 4 or not _ALPHA.match(w):
            return w
        if any(w.endswith(e) and w[: -len(e)] in self.known for e in _ENDINGS):
            return w
        return self.correct(w)

    def normalize(self, text: str) -> str:
        t = text.lower()
        for rx, rep in _CLEAN:
            t = rx.sub(rep, t)
        t = t.strip()
        for rx, rep in self.phrases:
            t = rx.sub(rep, t)
        return _WORD.sub(lambda m: self.word(m.group()), t)
