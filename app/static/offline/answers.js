// Answers on the phone when the hub can't be reached. Produces the same events the hub
// streams (passages / token / done), so the chat shows them the same way. Everything here
// is exact data — guide text, places, distances, routes — never generated text: the AI
// summary needs the hub. The app's own sentences come from lang/<lang>.json (body.lang),
// the same file the hub uses, so both word them the same way.

import { format } from "../i18n.js";
import { detect, FOLLOW_UP, isDirectionQuestion, reportQuery } from "./intents.js";
import { answerReports } from "./reports.js";
import { meters, pyRound, RoutingError } from "./router.js";

const ROAD_REPORT_KINDS = new Set(["road_flooded", "road_blocked"]);

// Road edge id -> report id for reported flooded/blocked roads (newest report first).
export function blockedEdges(reports) {
  const out = new Map();
  for (const r of reports ?? []) {
    if (ROAD_REPORT_KINDS.has(r.kind) && r.edge_id != null && !r.pending && !out.has(r.edge_id)) out.set(r.edge_id, r.id);
  }
  return out;
}

// Same as plan_route in app/routes/directions.py: the normal route, or if it uses a
// reported road, a route around them; if there is no way around, the normal route marked.
export function planRoute(router, start, end, mode, destName, blocked, lang = "en") {
  let result = router.route(start, end, mode, destName, null, lang);
  let through = result.edges.filter((e) => blocked.has(e)).map((e) => blocked.get(e));
  let avoided = [];
  if (through.length) {
    try {
      result = router.route(start, end, mode, destName, new Set(blocked.keys()), lang);
      avoided = through;
      through = [];
    } catch (e) {
      if (!(e instanceof RoutingError)) throw e;
    }
  }
  return { ...result, avoided_reports: avoided, through_reports: through };
}

// What a route did about reported roads (same wording as the hub).
export function reportLines(r, lang = "en") {
  const out = [];
  const a = r.avoided_reports?.length ?? 0;
  const t = r.through_reports?.length ?? 0;
  if (a) out.push(format(lang, "ans.around", { n: a }));
  if (t) out.push(format(lang, "ans.through", { n: t }));
  return out;
}
const NATIONAL_HOTLINE_ID = "hotlines#national-emergency-hotline-911";
const PASSAGES_SHOWN = 2;

const TYPES = ["evacuation_center", "hospital", "health_center", "rescue", "fire_station", "police", "pharmacy",
  "town_hall", "barangay_hall", "market", "drinking_water", "relief_point"]; // listing order
const KEY_TYPES = ["evacuation_center", "hospital", "police"];
const CANDIDATES = 8;
const MAX_KM = 15;
const NEARBY_M = 2000;

const label = (lang, type, plural = false) => (TYPES.includes(type) ? format(lang, `plabel.${type}`, { n: plural ? 2 : 1 }) : type);
export const fmtM = (m) => (m < 1000 ? `${pyRound(m)} m` : `${(m / 1000).toFixed(1)} km`);

class NeedsInput extends Error {}

function excerpt(text) {
  if (text.length <= 280) return text;
  const cut = text.slice(0, 277);
  return cut.slice(0, cut.lastIndexOf(" ")) + "...";
}

function locationBlock(loc, lang) {
  const fields = {
    name: loc.name,
    type: lang === "en" ? loc.type.replaceAll("_", " ") : label(lang, loc.type),
    address: loc.address,
    description: loc.description,
    coordinates: `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`,
    phone: loc.phone,
    opening_hours: loc.opening_hours,
    website: loc.website,
    source: loc.source,
    verified_on: loc.verified_on,
    note: loc.is_sample ? format(lang, "loc.sample_note") : loc.osm_url ? format(lang, "loc.osm_note") : null,
  };
  return Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${format(lang, `loc.${k}`)}: ${v}`).join("\n");
}

/**
 * ctx: { search, normalize, getRouter: async () => router|null, locations: [...], byId: Map,
 *        reports: { reports: [...], syncedMinAgo } (this phone's copy of the hub's situation reports) }
 * body: { question, location_id, previous, from_pos, travel_mode, lang }
 * Returns the list of events, like the hub's /api/assistant/ask stream.
 */
export async function localAsk(body, ctx) {
  // Fix typos first, exactly as the hub does ("neerest hospitl" -> "nearest hospital").
  if (ctx.normalize) {
    const norm = ctx.normalize;
    body = { ...body, question: norm(body.question), previous: body.previous ? { ...body.previous, question: norm(body.previous.question) } : null };
  }
  const loc = body.location_id ? ctx.byId.get(body.location_id) ?? null : null;
  const pos = body.from_pos ? [body.from_pos.lat, body.from_pos.lng] : null;
  const mode = body.travel_mode === "drive" ? "drive" : "walk";
  const lang = body.lang === "tl" ? "tl" : "en";
  const t = (key, vars) => format(lang, key, vars);
  const routeWarning = t("ans.route_warning");
  const reply = (text, done) => [{ type: "token", text }, { type: "done", sources: [], location_used: null, offline: true, ...done }];

  // `avoid`: steer around roads reported flooded or blocked (directions), as the hub does.
  async function road(start, place, m, avoid = false) {
    const router = await ctx.getRouter();
    if (!router) return null;
    try {
      return avoid
        ? planRoute(router, start, [place.lat, place.lng], m, place.name, blockedEdges(ctx.reports?.reports), lang)
        : router.route(start, [place.lat, place.lng], m, place.name, null, lang);
    } catch (e) {
      if (e instanceof RoutingError) return null;
      throw e;
    }
  }

  function require(needPlace, needPos) {
    const missing = [];
    if (needPlace && !loc) missing.push(t("ans.needs_place"));
    if (needPos && !pos) missing.push(t("ans.needs_position"));
    if (missing.length) throw new NeedsInput(t("ans.to_answer", { missing: missing.join(t("ans.and")) }));
  }

  const toPlace = (l, r, straight) => ({
    id: l.id, name: l.name, type: l.type, distance_m: pyRound(r ? r.distance_m : straight),
    duration_min: r ? r.duration_min : null, by_road: Boolean(r), mode,
  });

  // ---- location questions (exact data) ----
  const intent = detect(body.question, Boolean(loc));
  if (intent) {
    try {
      if (intent.kind === "nearest") {
        require(false, true);
        const types = intent.ftype ? [intent.ftype] : KEY_TYPES;
        const perType = intent.ftype ? 3 : 1;
        const places = [];
        const lines = [];
        for (const ty of types) {
          const cands = ctx.locations
            .filter((l) => l.type === ty || (l.also ?? []).includes(ty))
            .map((l) => [meters(pos, [l.lat, l.lng]), l])
            .sort((a, b) => a[0] - b[0])
            .slice(0, CANDIDATES)
            .filter(([d]) => d <= MAX_KM * 1000);
          if (!cands.length) { lines.push(t("ans.none_within", { label: label(lang, ty), km: MAX_KM })); continue; }
          const ranked = [];
          for (const [d, l] of cands) ranked.push(toPlace(l, await road(pos, l, mode), d));
          ranked.sort((a, b) => a.distance_m - b.distance_m);
          const top = ranked.slice(0, perType);
          places.push(...top);
          const how = t(mode === "walk" ? "ans.how_walk" : "ans.how_drive");
          if (intent.ftype) {
            lines.push(t("ans.nearest_head", { label: label(lang, ty, top.length > 1) }));
            top.forEach((p, i) => lines.push(t("ans.place_line", {
              i: i + 1, name: p.name, dist: p.by_road
                ? t("ans.by_road", { d: fmtM(p.distance_m), min: p.duration_min, how })
                : t("ans.straight_none", { d: fmtM(p.distance_m) }),
            })));
          } else {
            const p = top[0];
            lines.push(t(p.by_road ? "ans.nearest_one_road" : "ans.nearest_one_straight",
              { label: label(lang, ty), name: p.name, d: fmtM(p.distance_m), min: p.duration_min }));
          }
        }
        lines.push("", t("ans.nearest_foot"));
        return reply(lines.join("\n"), { status: "places", places });
      }
      if (intent.kind === "nearby") {
        require(false, true);
        const groups = new Map();
        for (const l of ctx.locations) {
          const d = meters(pos, [l.lat, l.lng]);
          if (d <= NEARBY_M) (groups.get(l.type) ?? groups.set(l.type, []).get(l.type)).push([d, l]);
        }
        if (!groups.size) {
          return reply(t("ans.nearby_none", { d: fmtM(NEARBY_M) }), { status: "places", places: [] });
        }
        const lines = [t("ans.nearby_head", { d: fmtM(NEARBY_M) })];
        const places = [];
        for (const ty of [...groups.keys()].sort((a, b) => (TYPES.indexOf(a) + 1 || 99) - (TYPES.indexOf(b) + 1 || 99))) {
          const items = groups.get(ty).sort((a, b) => a[0] - b[0]);
          const [d, closest] = items[0];
          const n = items.length;
          lines.push(t("ans.nearby_line", { n, label: label(lang, ty, n > 1), label_one: label(lang, ty), name: closest.name, d: fmtM(d) }));
          places.push(toPlace(closest, null, d));
        }
        lines.push("", t("ans.nearby_foot"));
        return reply(lines.join("\n"), { status: "places", places });
      }
      if (intent.kind === "distance") {
        require(true, true);
        const shown = await road(pos, loc, mode, true);
        if (!shown) throw new NeedsInput(t("rerr.no_connection"));
        const other = await road(pos, loc, mode === "walk" ? "drive" : "walk");
        const [walk, drive] = mode === "walk" ? [shown, other] : [other, shown];
        const parts = [];
        if (walk) parts.push(t("ans.on_foot", { d: fmtM(walk.distance_m), min: walk.duration_min }));
        if (drive) parts.push(t("ans.by_car", { d: fmtM(drive.distance_m), min: drive.duration_min }));
        const route = { ...shown, to_id: loc.id, to_name: loc.name, warning: routeWarning };
        return reply(t("ans.distance", {
          name: loc.name, parts: parts.join(t("ans.or")), straight: fmtM(shown.straight_line_m),
          how: t(mode === "walk" ? "ans.how_walking" : "ans.how_driving"), warning: routeWarning,
        }), { status: "route", route, location_used: loc.id });
      }
      if (intent.kind === "contact") {
        require(true, false);
        return reply(loc.phone
          ? t("ans.phone", { name: loc.name, phone: loc.phone })
          : t("ans.no_phone", { name: loc.name }),
        { status: "info", location_used: loc.id, phone: loc.phone ?? null });
      }
      if (intent.kind === "hours") {
        require(true, false);
        const hrs = loc.opening_hours?.trim() === "24/7" ? t("ans.open24") : t("ans.hours_val", { hours: loc.opening_hours });
        return reply(loc.opening_hours
          ? t("ans.hours", { hrs, name: loc.name })
          : t("ans.no_hours", { name: loc.name }),
        { status: "info", location_used: loc.id });
      }
    } catch (e) {
      if (e instanceof NeedsInput) return reply(e.message, { status: "needs_input" });
      throw e;
    }
  }

  // ---- current conditions, from situation reports ----
  const isCenter = Boolean(loc && (loc.type === "evacuation_center" || (loc.also ?? []).includes("evacuation_center")));
  const kinds = reportQuery(body.question, isCenter);
  if (kinds) {
    const snap = ctx.reports ?? { reports: [], syncedMinAgo: null };
    const place = loc ? { id: loc.id, name: loc.name, lat: loc.lat, lng: loc.lng } : null;
    const [text, done] = answerReports(body.question, kinds, snap.reports, place, pos, snap.syncedMinAgo, lang);
    return reply(text, done);
  }

  // ---- directions ----
  if (isDirectionQuestion(body.question)) {
    if (!loc || !pos) {
      const missing = [];
      if (!loc) missing.push(t("ans.dir_missing_place"));
      if (!pos) missing.push(t("ans.needs_position"));
      return reply(t("ans.dir_wrap", { missing: missing.join(t("ans.and")) }), { status: "needs_input" });
    }
    const r = await road(pos, loc, mode, true);
    if (!r) return [{ type: "error", message: t("rerr.no_connection") }];
    const route = { ...r, to_id: loc.id, to_name: loc.name, warning: routeWarning };
    const lines = [t(mode === "walk" ? "ans.route_head_walk" : "ans.route_head_drive",
      { name: loc.name, km: (r.distance_m / 1000).toFixed(1), min: r.duration_min })];
    r.steps.forEach((s, i) => lines.push(t("ans.step_line", {
      i: i + 1, step: s.instruction, dist: s.distance_m ? t("ans.step_dist", { m: s.distance_m }) : "",
    })));
    lines.push("", ...reportLines(r, lang), routeWarning);
    return reply(lines.join("\n"), { status: "route", route, location_used: loc.id });
  }

  // ---- guide sections (exact text) ----
  const { search } = ctx;
  let hits = search.evidence(body.question);
  // Same rule as the hub: borrow the previous topic only for a real follow-up.
  const short = body.question.trim().split(/\s+/).length <= 4;
  if (body.previous && (FOLLOW_UP.test(body.question) || (!hits.length && short))) {
    const seen = new Set(hits.map((h) => h.chunk.chunk_id));
    hits = [...hits, ...search.evidence(`${body.previous.question} ${body.question}`).filter((h) => !seen.has(h.chunk.chunk_id))]
      .slice(0, search.params.top_k);
  }
  if (hits.some((h) => h.chunk.doc === "hotlines.md") && !hits.some((h) => h.chunk.chunk_id === NATIONAL_HOTLINE_ID)) {
    const c = search.byId.get(NATIONAL_HOTLINE_ID);
    if (c) hits.push({ chunk: c, score: 0, matched: 0 });
  }
  // Sources = the sections shown (plus 911 for hotline answers), as on the hub.
  const shown = [...hits.slice(0, PASSAGES_SHOWN), ...hits.slice(PASSAGES_SHOWN).filter((h) => h.chunk.chunk_id === NATIONAL_HOTLINE_ID)];
  const sources = shown.map((h) => ({ doc: h.chunk.doc, chunk_id: h.chunk.chunk_id, title: h.chunk.title, excerpt: excerpt(h.chunk.text) }));
  if (hits.length) {
    const passages = hits.slice(0, PASSAGES_SHOWN).map((h) => ({
      doc: h.chunk.doc, chunk_id: h.chunk.chunk_id, doc_title: h.chunk.doc_title, title: h.chunk.title, text: h.chunk.text,
      draft: h.chunk.draft, checked_on: h.chunk.checked_on, source: h.chunk.source, source_url: h.chunk.source_url,
    }));
    return [
      { type: "passages", passages },
      { type: "done", status: "grounded", sources, location_used: loc?.id ?? null, summary: "offline", offline: true },
    ];
  }
  if (loc) {
    return [{ type: "token", text: locationBlock(loc, lang) },
      { type: "done", status: "grounded", sources: [], location_used: loc.id, summary: "offline", offline: true }];
  }
  return reply(t("ans.not_covered"), { status: "uncertain" });
}
