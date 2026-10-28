// Answer "is the road flooded?" from situation reports, on the phone. Mirrors
// app/services/report_answers.py; tests/fixtures/parity.json keeps the two in step.
// Offline, the reports are this phone's last copy from the hub, so the answer says how
// old that copy is. Wording: app/static/lang/<lang>.json, shared with the hub.
import { format, roadName } from "../i18n.js";
import { meters, pyRound } from "./router.js";

const NEAR_PLACE_M = 500;
const NEAR_YOU_M = 3000;
const MAX_LISTED = 6;
const GROUPS = [
  [["road_flooded", "road_blocked"], "road"],
  [["center_full", "center_open"], "center"],
  [["water_available"], "water"],
  [["power_out"], "power"],
  [["medical_need"], "medical"],
  [["other"], "other"],
];
const TTL_H = { road_flooded: 2, road_blocked: 2, center_full: 6, center_open: 6, water_available: 6, power_out: 6, medical_need: 2, other: 3 };
const ROAD_SUFFIX = /\s+(street|st|road|rd|avenue|ave|highway|hwy|boulevard|blvd|drive|dr|extension|ext)$/;

const fmtM = (m) => (m < 1000 ? `${pyRound(m)} m` : `${(m / 1000).toFixed(1)} km`);

export function fmtOld(minutes, lang = "en") {
  if (minutes < 1) return format(lang, "rans.old_now");
  if (minutes < 60) return format(lang, "rans.old_min", { m: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? format(lang, "rans.old_hmin", { h, m }) : format(lang, "rans.old_h", { h });
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).join(" ");
export const roadCore = (name) => norm(name).replace(ROAD_SUFFIX, "");

function namedRoad(question, reports) {
  const q = ` ${norm(question)} `;
  for (const r of reports) {
    const core = roadCore(r.road_name ?? "");
    if (core.length >= 4 && q.includes(` ${core} `)) return r.road_name;
  }
  return null;
}

function ago(min, lang) {
  if (min < 1) return format(lang, "age.now");
  if (min < 60) return format(lang, "age.min", { m: min });
  const h = Math.floor(min / 60);
  return min % 60 ? format(lang, "age.hmin", { h, m: min % 60 }) : format(lang, "age.h", { h });
}

/**
 * reports: public report objects, newest first. place: {id, name, lat, lng} or null.
 * pos: [lat, lng] or null. syncedMinAgo: null on the hub; on the phone, how old its copy is
 * (undefined if it never got one). Returns [text, done fields].
 */
// source: "online" when the copy comes from the internet (the website) instead of a hub.
export function answerReports(question, kinds, reports, place = null, pos = null, syncedMinAgo = null, lang = "en", source = null) {
  const t = (key, vars) => format(lang, key, vars);
  const pool = reports.filter((r) => kinds.includes(r.kind));
  let road = null;
  let sel;
  let scope;
  if (place) {
    const here = [place.lat, place.lng];
    sel = pool.filter((r) => r.location_id === place.id || meters([r.lat, r.lng], here) <= NEAR_PLACE_M);
    scope = t("rans.near", { place: place.name });
  } else if ((road = namedRoad(question, pool))) {
    sel = pool.filter((r) => r.road_name && roadCore(r.road_name) === roadCore(road));
    scope = t("rans.on", { road: roadName(lang, road) });
  } else if (pos) {
    sel = pool.filter((r) => meters([r.lat, r.lng], pos) <= NEAR_YOU_M);
    scope = t("rans.within");
  } else {
    sel = pool;
    scope = t("rans.area");
  }
  sel = [...sel].sort((a, b) => a.age_min - b.age_min);

  const lines = [];
  if (syncedMinAgo === "site") lines.push(t("rans.site")); // the website: no hub, so no reports
  else if (syncedMinAgo === undefined) lines.push(t(source === "online" ? "rans.never_synced_online" : "rans.never_synced"));
  else if (syncedMinAgo !== null) lines.push(t(source === "online" ? "rans.synced_online" : "rans.synced", { ago: ago(syncedMinAgo, lang) }));
  if (sel.length) {
    lines.push(t("rans.head", { n: sel.length, scope }));
    for (const r of sel.slice(0, MAX_LISTED)) {
      let where = "";
      if (r.road_name && !road) where = t("rans.where_on", { road: roadName(lang, r.road_name) });
      else if (r.location_name && !(place && r.location_id === place.id)) where = t("rans.where_at", { place: r.location_name });
      else if (pos && !place) where = t("rans.where_from", { d: fmtM(meters([r.lat, r.lng], pos)) });
      const disputed = r.disputes ? t("rans.disputed", { n: r.disputes }) : "";
      // The one-tap details and the GPS badge; a reporter's note is never quoted here.
      const chips = (r.details ?? []).map((d) => t(`detail.${d}`));
      lines.push(t("rans.line", {
        label: t(`kind.${r.kind}`), details: chips.length ? t("rans.details", { list: chips.join(", ") }) : "", where,
        trust: t(`rans.trust.${r.trust}`), onsite: r.on_site ? t("rans.onsite") : "", age: fmtOld(r.age_min, lang),
        count: t("rans.count", { n: r.reports }), disputed,
      }));
    }
    if (sel.length > MAX_LISTED) lines.push(t("rans.more", { n: sel.length - MAX_LISTED }));
  } else {
    const names = GROUPS.filter(([group]) => group.some((k) => kinds.includes(k))).map(([, key]) => t(`rans.group.${key}`));
    const h = Math.max(...kinds.map((k) => TTL_H[k]));
    const roads = kinds.includes("road_flooded") ? t("rans.roads_note") : "";
    lines.push(names.length === GROUPS.length
      ? t("rans.none_all", { scope, h, roads })
      : t("rans.none_kind", { what: names.join(t("ans.or")), scope, h, roads }));
  }
  lines.push("");
  if (sel.some((r) => r.kind === "road_flooded") || (!sel.length && kinds.includes("road_flooded"))) {
    lines.push(t("rans.flood"));
  }
  lines.push(t("rans.footer"));
  return [lines.join("\n"), { status: "reports", reports: sel.slice(0, MAX_LISTED), location_used: place ? place.id : null }];
}
