// Situation report kinds, shared by the map, the Reports tab and the phone's answer engine.
// Lifetimes must match REPORT_TTL_H in app/config.py. Labels are in lang/<lang>.json
// (kind.*, kindshort.*); the English ones must match KIND_LABEL in app/services/reports.py.
import { t } from "./i18n.js";

const KINDS = {
  road_flooded: { color: "#1971c2", ttlMin: 120 },
  road_blocked: { color: "#e8590c", ttlMin: 120 },
  center_full: { color: "#c92a2a", ttlMin: 360 },
  center_open: { color: "#2b8a3e", ttlMin: 360 },
  water_available: { color: "#0c8599", ttlMin: 360 },
  power_out: { color: "#5f3dc4", ttlMin: 360 },
  medical_need: { color: "#d6336c", ttlMin: 120 },
  other: { color: "#495057", ttlMin: 180 }, // "Iba pa": the reporter's note says what it is
};
// { color, ttlMin, label, short }: the labels are read in the app's language.
export const REPORT_KINDS = Object.fromEntries(Object.entries(KINDS).map(([kind, k]) => [kind, {
  ...k,
  get label() { return t(`kind.${kind}`); },
  get short() { return t(`kindshort.${kind}`); },
}]));
export const ROAD_KINDS = new Set(["road_flooded", "road_blocked"]);
export const CENTER_KINDS = new Set(["center_full", "center_open"]);

export const trustLabel = (trust) => t(`trustlabel.${trust}`);

export function fmtAge(min) {
  if (min < 1) return t("age.now");
  if (min < 60) return t("age.min", { m: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? t("age.hmin", { h, m }) : t("age.h", { h });
}
