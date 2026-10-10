// Answer "is the road flooded?" from situation reports, on the phone. Mirrors
// app/services/report_answers.py; tests/fixtures/parity.json keeps the two in step.
// Offline, the reports are this phone's last copy from the hub, so the answer says how
// old that copy is.
import { meters, pyRound } from "./router.js";

const NEAR_PLACE_M = 500;
const NEAR_YOU_M = 3000;
const MAX_LISTED = 6;
const GROUPS = [
  [["road_flooded", "road_blocked"], "road"],
  [["center_full", "center_open"], "evacuation center"],
  [["water_available"], "drinking water"],
  [["power_out"], "power"],
  [["medical_need"], "medical"],
];
const TTL_H = { road_flooded: 2, road_blocked: 2, center_full: 6, center_open: 6, water_available: 6, power_out: 6, medical_need: 2 };
const TRUST_TEXT = { verified: "verified by a responder", confirmed: "confirmed by others", unverified: "unverified" };
const FOOTER = "Reports come from people nearby and may be wrong. Follow official instructions.";
const ROAD_SUFFIX = /\s+(street|st|road|rd|avenue|ave|highway|hwy|boulevard|blvd|drive|dr|extension|ext)$/;

const fmtM = (m) => (m < 1000 ? `${pyRound(m)} m` : `${(m / 1000).toFixed(1)} km`);

export function fmtOld(minutes) {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min old`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min old` : `${h} h old`;
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

function ago(min) {
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min ago` : `${h} h ago`;
}

/**
 * reports: public report objects, newest first. place: {id, name, lat, lng} or null.
 * pos: [lat, lng] or null. syncedMinAgo: null on the hub; on the phone, how old its copy is
 * (undefined if it never got one). Returns [text, done fields].
 */
export function answerReports(question, kinds, reports, place = null, pos = null, syncedMinAgo = null) {
  const pool = reports.filter((r) => kinds.includes(r.kind));
  let road = null;
  let sel;
  let scope;
  if (place) {
    const here = [place.lat, place.lng];
    sel = pool.filter((r) => r.location_id === place.id || meters([r.lat, r.lng], here) <= NEAR_PLACE_M);
    scope = `near ${place.name}`;
  } else if ((road = namedRoad(question, pool))) {
    sel = pool.filter((r) => r.road_name && roadCore(r.road_name) === roadCore(road));
    scope = `on ${road}`;
  } else if (pos) {
    sel = pool.filter((r) => meters([r.lat, r.lng], pos) <= NEAR_YOU_M);
    scope = "within 3 km of you";
  } else {
    sel = pool;
    scope = "in the area";
  }
  sel = [...sel].sort((a, b) => a.age_min - b.age_min);

  const lines = [];
  if (syncedMinAgo === undefined) lines.push("This phone has not received any reports from the hub yet.");
  else if (syncedMinAgo !== null) lines.push(`(No hub connection. These are the reports this phone saved ${ago(syncedMinAgo)}.)`);
  if (sel.length) {
    lines.push(`${sel.length} report${sel.length > 1 ? "s" : ""} ${scope}:`);
    for (const r of sel.slice(0, MAX_LISTED)) {
      let where = "";
      if (r.road_name && !road) where = ` on ${r.road_name}`;
      else if (r.location_name && !(place && r.location_id === place.id)) where = ` at ${r.location_name}`;
      else if (pos && !place) where = `, ${fmtM(meters([r.lat, r.lng], pos))} from you`;
      const count = `${r.reports} report${r.reports > 1 ? "s" : ""}`;
      const disputed = r.disputes ? `, ${r.disputes} disputed` : "";
      lines.push(`- ${r.label}${where}: ${TRUST_TEXT[r.trust]}, ${fmtOld(r.age_min)}, ${count}${disputed}.`);
    }
    if (sel.length > MAX_LISTED) lines.push(`...and ${sel.length - MAX_LISTED} more in the Reports tab.`);
  } else {
    const names = GROUPS.filter(([group]) => group.some((k) => kinds.includes(k))).map(([, name]) => name);
    const what = names.length === GROUPS.length ? "" : names.join(" or ") + " ";
    const window = Math.max(...kinds.map((k) => TTL_H[k]));
    const roads = kinds.includes("road_flooded") ? " That does not mean the roads are safe." : "";
    lines.push(`No ${what}reports ${scope} in the last ${window} hours.${roads}`);
  }
  lines.push("");
  if (sel.some((r) => r.kind === "road_flooded") || (!sel.length && kinds.includes("road_flooded"))) {
    lines.push("Never walk or drive through floodwater.");
  }
  lines.push(FOOTER);
  return [lines.join("\n"), { status: "reports", reports: sel.slice(0, MAX_LISTED), location_used: place ? place.id : null }];
}
