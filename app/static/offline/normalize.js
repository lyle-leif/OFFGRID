// Spelling clean-up for questions on the phone: the same three steps as the hub
// (app/services/normalize.py), using the dictionary exported in pack/lexicon.json, so a
// typo'd question gets the same answer with or without the hub.
//   1. clean: lowercase, straight quotes, "pinaka-malapit" -> "pinakamalapit", "helppp" -> "helpp"
//   2. aliases: text-speak and short forms ("hw" -> "how", "pano" -> "paano")
//   3. fuzzy: an unknown word becomes the closest known word within 1 edit (2 for words of
//      8+ letters), keeping the first letter; place names and everyday words are left alone.

const CLEAN = [
  [/[‘’ʼ]/g, "'"],
  [/[“”]/g, '"'],
  [/pinaka-/g, "pinaka"],
  [/([a-z])\1{2,}/g, "$1$1"],
  [/\s+/g, " "],
];
const WORD = /[a-z0-9ñ]+/g;
const ALPHA = /^[a-z]+$/;
// A known word plus one of these endings is a real word too ("evacuated", "flooding").
const ENDINGS = ["ing", "ed", "es", "s", "d", "ly"];

export const maxEdits = (word) => (word.length < 8 ? 1 : 2);

// Optimal-string-alignment distance (a swap of neighbours is one edit), with an early exit.
export function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev2 = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      best = Math.min(best, v);
    }
    if (best > limit) return limit + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function createNormalizer(lexicon) {
  const freq = new Map(Object.entries(lexicon.words));
  const known = new Set([...lexicon.known, ...freq.keys()]);
  const aliases = new Map(Object.entries(lexicon.aliases));
  const phrases = lexicon.phrases.map(([a, b]) => [new RegExp(`\\b${escapeRx(a)}\\b`, "g"), b]);
  const byFirst = new Map();
  for (const w of freq.keys()) {
    if (!byFirst.has(w[0])) byFirst.set(w[0], []);
    byFirst.get(w[0]).push(w);
  }
  const cache = new Map();

  // Fewest edits, then the more common word, then A-Z (same order as the hub).
  function correct(word) {
    if (cache.has(word)) return cache.get(word);
    const limit = maxEdits(word);
    let best = null; // [edits, -frequency, word]
    let cands = byFirst.get(word[0]) ?? [];
    if (word.length > 1 && word[1] !== word[0]) cands = cands.concat(byFirst.get(word[1]) ?? []);
    for (const w of cands) {
      const d = distance(word, w, limit);
      if (d > limit) continue;
      const key = [d, -freq.get(w), w];
      if (!best || key[0] < best[0] || (key[0] === best[0] && (key[1] < best[1] || (key[1] === best[1] && key[2] < best[2])))) best = key;
    }
    const out = best ? best[2] : word;
    cache.set(word, out);
    return out;
  }

  function word(w) {
    if (aliases.has(w)) return aliases.get(w);
    if (known.has(w) || w.length < 4 || !ALPHA.test(w)) return w;
    if (ENDINGS.some((e) => w.endsWith(e) && known.has(w.slice(0, -e.length)))) return w;
    return correct(w);
  }

  function normalize(text) {
    let t = text.toLowerCase();
    for (const [rx, rep] of CLEAN) t = t.replace(rx, rep);
    t = t.trim();
    for (const [rx, rep] of phrases) t = t.replace(rx, () => rep);
    return t.replace(WORD, (m) => word(m));
  }

  return { normalize, correct };
}
