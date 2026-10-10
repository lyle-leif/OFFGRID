// Situation report kinds, shared by the map, the Reports tab and the phone's answer engine.
// Labels and lifetimes must match KIND_LABEL in app/services/reports.py and
// REPORT_TTL_H in app/config.py.
export const REPORT_KINDS = {
  road_flooded: { label: "Road flooded", short: "Flooded road", color: "#1971c2", ttlMin: 120 },
  road_blocked: { label: "Road blocked", short: "Blocked road", color: "#e8590c", ttlMin: 120 },
  center_full: { label: "Evacuation center full", short: "Center full", color: "#c92a2a", ttlMin: 360 },
  center_open: { label: "Evacuation center open", short: "Center open", color: "#2b8a3e", ttlMin: 360 },
  water_available: { label: "Drinking water available", short: "Water", color: "#0c8599", ttlMin: 360 },
  power_out: { label: "Power out", short: "No power", color: "#5f3dc4", ttlMin: 360 },
  medical_need: { label: "Medical help needed", short: "Medical", color: "#d6336c", ttlMin: 120 },
};
export const ROAD_KINDS = new Set(["road_flooded", "road_blocked"]);
export const CENTER_KINDS = new Set(["center_full", "center_open"]);

export const TRUST_LABEL = { verified: "verified by a responder", confirmed: "confirmed", unverified: "unverified" };

export function fmtAge(min) {
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}
