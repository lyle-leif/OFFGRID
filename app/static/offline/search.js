// Guide search on the phone: the same BM25 scoring, synonyms and "not covered" gate as the
// hub (app/services/retrieval.py), using the exact index exported in pack/guides.json, so a
// phone with no hub gives the same guide sections the hub would.

const WORD = /[a-z0-9]+/g;

export function createSearch(pack) {
  const stop = new Set(pack.stopwords);
  const { idf, avgdl, k1, b, synonyms, params } = pack;
  const chunks = pack.chunks.map((c) => ({ ...c, tokens: new Set(Object.keys(c.tf)) }));
  const byId = new Map(chunks.map((c) => [c.chunk_id, c]));

  function stem(w) {
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  }

  function tokenize(text) {
    return (text.toLowerCase().match(WORD) ?? []).filter((w) => !stop.has(w)).map(stem);
  }

  // One group per concept: the word plus its synonyms.
  function expand(tokens) {
    const groups = [];
    const seen = new Set();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      groups.push([t, ...(synonyms[t] ?? [])]);
    }
    return groups;
  }

  function termScore(chunk, t) {
    const f = chunk.tf[t] ?? 0;
    if (!f) return 0;
    return (idf[t] ?? 0) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * chunk.len) / avgdl)));
  }

  function search(query, k) {
    const groups = expand(tokenize(query));
    if (!groups.length) return [];
    const hits = chunks.map((c) => {
      let score = 0;
      for (const g of groups) score += Math.max(...g.map((t) => termScore(c, t)));
      const matched = groups.filter((g) => g.some((t) => c.tokens.has(t))).length;
      return { chunk: c, score, matched };
    });
    hits.sort((x, y) => y.score - x.score); // stable, like Python's sort
    return hits.slice(0, k);
  }

  // Sections strong enough to answer; empty means "not covered".
  function evidence(query) {
    const n = expand(tokenize(query)).length;
    const need = Math.min(n, Math.max(params.min_terms, Math.ceil(0.4 * n)));
    if (need === 0) return [];
    const strongNeed = Math.ceil(n / 2);
    let hits = search(query, params.top_k).filter((h) => h.matched > 0 && (
      (h.score >= params.strong_score && h.matched >= strongNeed) ||
      (h.score >= params.threshold && h.matched >= need)));
    if (hits.length && params.relative) {
      const top = hits[0].score;
      hits = hits.filter((h) => h.score >= params.relative * top);
    }
    return hits;
  }

  return { tokenize, expand, search, evidence, chunks, byId, params };
}
