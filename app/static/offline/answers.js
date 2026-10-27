// Answers on the phone when the hub can't be reached. Produces the same events the hub
// streams (passages / token / done), so the chat shows them the same way. Everything here
// is exact data — guide text, places, distances, routes — never generated text: the AI
// summary needs the hub.

import { detect, FOLLOW_UP, isDirectionQuestion, reportQuery } from "./intents.js";
import { answerReports } from "./reports.js";
import { meters, pyRound, RoutingError } from "./router.js";

export const NOT_COVERED =
  "I can't find this in the saved emergency information on this device, so I can't answer it " +
  "reliably. For current conditions or anything urgent, follow official announcements and " +
  "local authorities, or call 911.";
export const ROUTE_WARNING =
  "Route uses saved OpenStreetMap road data and steers around roads people reported flooded or blocked, " +
  "but reports can be missing or wrong. It does not know about other floods, landslides, closures, or damage. " +
  "Follow official instructions and never walk or drive through floodwater.";
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
export function planRoute(router, start, end, mode, destName, blocked) {
  let result = router.route(start, end, mode, destName);
  let through = result.edges.filter((e) => blocked.has(e)).map((e) => blocked.get(e));
  let avoided = [];
  if (through.length) {
    try {
      result = router.route(start, end, mode, destName, new Set(blocked.keys()));
      avoided = through;
      through = [];
    } catch (e) {
      if (!(e instanceof RoutingError)) throw e;
    }
  }
  return { ...result, avoided_reports: avoided, through_reports: through };
}

// What a route did about reported roads (same wording as the hub).
export function reportLines(r) {
  const out = [];
  const a = r.avoided_reports?.length ?? 0;
  const t = r.through_reports?.length ?? 0;
  if (a) out.push(`This route goes around ${a} road${a > 1 ? "s" : ""} people reported flooded or blocked.`);
  if (t) out.push(`Warning: this route uses ${t} road${t > 1 ? "s" : ""} people reported flooded or blocked. Check before you go.`);
  return out;
}
const NATIONAL_HOTLINE_ID = "hotlines#national-emergency-hotline-911";
const PASSAGES_SHOWN = 2;

const LABELS = {
  evacuation_center: ["evacuation center", "evacuation centers"],
  hospital: ["hospital", "hospitals"],
  health_center: ["clinic / health center", "clinics / health centers"],
  rescue: ["rescue / DRRM station", "rescue / DRRM stations"],
  fire_station: ["fire station", "fire stations"],
  police: ["police station", "police stations"],
  pharmacy: ["pharmacy", "pharmacies"],
  town_hall: ["town / city hall", "town / city halls"],
  barangay_hall: ["barangay hall", "barangay halls"],
  market: ["market / grocery", "markets / groceries"],
  drinking_water: ["drinking water point", "drinking water points"],
  relief_point: ["relief point", "relief points"],
};
const KEY_TYPES = ["evacuation_center", "hospital", "police"];
const CANDIDATES = 8;
const MAX_KM = 15;
const NEARBY_M = 2000;
const NEEDS_POSITION = 'set your location with the "Set my location" button on the map';
const NEEDS_PLACE = "select a place on the map or in the Facilities list";

const label = (t, plural = false) => (LABELS[t] ?? [t, t])[plural ? 1 : 0];
export const fmtM = (m) => (m < 1000 ? `${pyRound(m)} m` : `${(m / 1000).toFixed(1)} km`);

class NeedsInput extends Error {}

function excerpt(text) {
  if (text.length <= 280) return text;
  const cut = text.slice(0, 277);
  return cut.slice(0, cut.lastIndexOf(" ")) + "...";
}

function locationBlock(loc) {
  const fields = {
    name: loc.name,
    type: loc.type.replaceAll("_", " "),
    address: loc.address,
    description: loc.description,
    coordinates: `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`,
    phone: loc.phone,
    opening_hours: loc.opening_hours,
    website: loc.website,
    source: loc.source,
    verified_on: loc.verified_on,
    note: loc.is_sample ? "SAMPLE record for testing, not a real facility"
      : loc.osm_url ? "Community-mapped record (OpenStreetMap), not an official government list; details may be outdated" : null,
  };
  return Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
}

/**
 * ctx: { search, normalize, getRouter: async () => router|null, locations: [...], byId: Map,
 *        reports: { reports: [...], syncedMinAgo } (this phone's copy of the hub's situation reports) }
 * body: { question, location_id, previous, from_pos, travel_mode }
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
  const reply = (text, done) => [{ type: "token", text }, { type: "done", sources: [], location_used: null, offline: true, ...done }];

  // `avoid`: steer around roads reported flooded or blocked (directions), as the hub does.
  async function road(start, place, m, avoid = false) {
    const router = await ctx.getRouter();
    if (!router) return null;
    try {
      return avoid
        ? planRoute(router, start, [place.lat, place.lng], m, place.name, blockedEdges(ctx.reports?.reports))
        : router.route(start, [place.lat, place.lng], m, place.name);
    } catch (e) {
      if (e instanceof RoutingError) return null;
      throw e;
    }
  }

  function require(needPlace, needPos) {
    const missing = [];
    if (needPlace && !loc) missing.push(NEEDS_PLACE);
    if (needPos && !pos) missing.push(NEEDS_POSITION);
    if (missing.length) throw new NeedsInput(`To answer that, ${missing.join(" and ")}, then ask again.`);
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
        for (const t of types) {
          const cands = ctx.locations
            .filter((l) => l.type === t || (l.also ?? []).includes(t))
            .map((l) => [meters(pos, [l.lat, l.lng]), l])
            .sort((a, b) => a[0] - b[0])
            .slice(0, CANDIDATES)
            .filter(([d]) => d <= MAX_KM * 1000);
          if (!cands.length) { lines.push(`No ${label(t)} is saved within ${MAX_KM} km of your location.`); continue; }
          const ranked = [];
          for (const [d, l] of cands) ranked.push(toPlace(l, await road(pos, l, mode), d));
          ranked.sort((a, b) => a.distance_m - b.distance_m);
          const top = ranked.slice(0, perType);
          places.push(...top);
          const how = mode === "walk" ? "walk" : "drive";
          if (intent.ftype) {
            lines.push(`Nearest ${label(t, top.length > 1)} from your location:`);
            top.forEach((p, i) => lines.push(`${i + 1}. ${p.name}: ` + (p.by_road
              ? `${fmtM(p.distance_m)} by road (about ${p.duration_min} min ${how})`
              : `${fmtM(p.distance_m)} in a straight line (no road route found)`)));
          } else {
            const p = top[0];
            lines.push(`Nearest ${label(t)}: ${p.name}, ${fmtM(p.distance_m)}` +
              (p.by_road ? ` by road (about ${p.duration_min} min)` : " in a straight line"));
          }
        }
        lines.push("", "Tap a result to see it or get directions. Roads may be flooded or blocked; " +
          "facility details come from OpenStreetMap and are not an official list.");
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
          return reply(`No saved facilities within ${fmtM(NEARBY_M)} of your location (straight line). ` +
            "Try asking for the nearest hospital or evacuation center.", { status: "places", places: [] });
        }
        const order = Object.keys(LABELS);
        const lines = [`Within ${fmtM(NEARBY_M)} of your location (straight-line distance):`];
        const places = [];
        for (const t of [...groups.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))) {
          const items = groups.get(t).sort((a, b) => a[0] - b[0]);
          const [d, closest] = items[0];
          lines.push(`- ${items.length} ${label(t, items.length > 1)}: closest is ${closest.name}, ${fmtM(d)}`);
          places.push(toPlace(closest, null, d));
        }
        lines.push("", 'Ask for a type (e.g. "nearest hospital") to get road distances and directions.');
        return reply(lines.join("\n"), { status: "places", places });
      }
      if (intent.kind === "distance") {
        require(true, true);
        const shown = await road(pos, loc, mode, true);
        if (!shown) throw new NeedsInput("No road connection found between these points in the saved road data.");
        const other = await road(pos, loc, mode === "walk" ? "drive" : "walk");
        const [walk, drive] = mode === "walk" ? [shown, other] : [other, shown];
        const parts = [];
        if (walk) parts.push(`${fmtM(walk.distance_m)} on foot (about ${walk.duration_min} min)`);
        if (drive) parts.push(`${fmtM(drive.distance_m)} by car (about ${drive.duration_min} min)`);
        const route = { ...shown, to_id: loc.id, to_name: loc.name, warning: ROUTE_WARNING };
        return reply(`${loc.name} is ${parts.join(" or ")} from your location. ` +
          `Straight-line distance: ${fmtM(shown.straight_line_m)}.\n\n` +
          `The ${mode === "walk" ? "walking" : "driving"} route is shown on the map. ${ROUTE_WARNING}`,
        { status: "route", route, location_used: loc.id });
      }
      if (intent.kind === "contact") {
        require(true, false);
        return reply(loc.phone
          ? `Phone for ${loc.name} (saved from OpenStreetMap, may be outdated): ${loc.phone}.\nFor emergencies, call 911.`
          : `No phone number is saved for ${loc.name}. For emergencies, call 911. Local hotlines (CDRRMO, police, fire) are in the Hotlines tab.`,
        { status: "info", location_used: loc.id, phone: loc.phone ?? null });
      }
      if (intent.kind === "hours") {
        require(true, false);
        const hrs = loc.opening_hours?.trim() === "24/7" ? "open 24 hours" : `hours: ${loc.opening_hours}`;
        return reply(loc.opening_hours
          ? `Saved ${hrs} for ${loc.name} (from OpenStreetMap). The app cannot confirm whether it is open right now, especially during a disaster.`
          : `No opening hours are saved for ${loc.name}. The app cannot tell whether it is open right now. Call ahead if a number is available, or ask your barangay.`,
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
    const [text, done] = answerReports(body.question, kinds, snap.reports, place, pos, snap.syncedMinAgo);
    return reply(text, done);
  }

  // ---- directions ----
  if (isDirectionQuestion(body.question)) {
    if (!loc || !pos) {
      const missing = [];
      if (!loc) missing.push("select the place you want to go to (on the map or in the Facilities list)");
      if (!pos) missing.push('set your location with the "Set my location" button on the map');
      return reply(`To get directions, ${missing.join(" and ")}. Then ask again or press Directions.`, { status: "needs_input" });
    }
    const r = await road(pos, loc, mode, true);
    if (!r) return [{ type: "error", message: "No road connection found between these points in the saved road data." }];
    const route = { ...r, to_id: loc.id, to_name: loc.name, warning: ROUTE_WARNING };
    const lines = [`${mode === "walk" ? "Walking" : "Driving"} route to ${loc.name}: ${(r.distance_m / 1000).toFixed(1)} km, about ${r.duration_min} min.`];
    r.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.instruction}${s.distance_m ? ` (${s.distance_m} m)` : ""}`));
    lines.push("", ...reportLines(r), ROUTE_WARNING);
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
    return [{ type: "token", text: locationBlock(loc) },
      { type: "done", status: "grounded", sources: [], location_used: loc.id, summary: "offline", offline: true }];
  }
  return reply(NOT_COVERED, { status: "uncertain" });
}
