// Interface language. The strings live in lang/<id>.json, shared with the hub
// (app/services/i18n.py) and the phone engine, so all three word things the same way.
// To add a language: a new lang/<id>.json with the same keys, plus an entry in LANGS
// (and in LANGS in app/services/i18n.py).

export const LANGS = [
  { id: "tl", name: "Tagalog", html: "fil" },
  { id: "en", name: "English", html: "en" },
];
const IDS = new Set(LANGS.map((l) => l.id));
const KEY = "bb.lang";
const tables = {};
let current = "en";

export function register(lang, table) {
  tables[lang] = table;
}

// The template for `key`, with "{name}" filled from `vars`. When vars.n is given and the
// language has key_one / key_other, the plural form is picked. Missing in this language:
// English; missing everywhere: the key itself (so a gap is visible, never blank).
export function format(lang, key, vars = {}) {
  const pick = (table) => {
    if (!table) return undefined;
    if (vars.n !== undefined && table[`${key}_one`] !== undefined) return table[vars.n === 1 ? `${key}_one` : `${key}_other`];
    return table[key];
  };
  const tpl = pick(tables[lang]) ?? pick(tables.en) ?? key;
  return tpl.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
}

export const t = (key, vars) => format(current, key, vars);
export const getLang = () => current;

// Saved choice, or null on first run (then the app asks).
export function savedLang() {
  try {
    const v = localStorage.getItem(KEY);
    return IDS.has(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveLang(id) {
  try { localStorage.setItem(KEY, id); } catch { /* no storage */ }
}

// Load the strings for the saved language (plus English for anything missing).
export async function loadLang(id = savedLang() ?? "en") {
  current = IDS.has(id) ? id : "en";
  const need = [...new Set(["en", current])].filter((l) => !tables[l]);
  await Promise.all(need.map(async (l) => register(l, await (await fetch(new URL(`lang/${l}.json`, document.baseURI))).json())));
  document.documentElement.lang = LANGS.find((l) => l.id === current).html;
  return current;
}

// Fill the page's fixed text: data-i18n (text), data-i18n-aria, data-i18n-title, data-i18n-ph.
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-ph]")) el.placeholder = t(el.dataset.i18nPh);
}

// Unnamed roads are stored by their class label ("local road"): show it in this language.
const ROAD_CLASS = { footpath: "footpath", track: "track", "service road": "service_road", "local road": "local_road", road: "road" };
export function roadName(lang, name) {
  return ROAD_CLASS[name] ? format(lang, `road.${ROAD_CLASS[name]}`) : name;
}
