import { createMap, DEFAULT_OFF, inBounds, TYPE_STYLE, typeStyle } from "./map.js";
import { createChat } from "./chat.js";
import { createDirections } from "./directions.js";
import { createBrain } from "./offline/brain.js";
import { createReports } from "./reports.js";
import { createSheet } from "./sheet.js";
import { pinImg, reportImg } from "./icons.js";
import { REPORT_KINDS } from "./report-kinds.js";
import { hydrateIcons, icon, iconLabel } from "./ui-icons.js";

hydrateIcons();

const $ = (id) => document.getElementById(id);

// Launch screen (index.html): fade it out once the map has drawn, so the app appears in one
// piece. Never longer than 5 s, whatever happens to the map.
function hideSplash() {
  const el = $("splash");
  if (!el || el.classList.contains("gone")) return;
  el.classList.add("gone");
  setTimeout(() => el.remove(), 400);
}
setTimeout(hideSplash, 5000);

const state = {
  locations: [],
  selected: null,
  userPos: null, // {lat, lng}
  query: "",
  types: new Set(Object.keys(TYPE_STYLE).filter((t) => !DEFAULT_OFF.has(t))),
};
let mapApi = null;

// ---------- theme (light / dark) ----------
// Follows the system setting until the user picks one with the toggle.
function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme, { save = false } = {}) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.replaceChildren(icon(theme === "dark" ? "sun" : "moon", 18));
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
  if (save) { try { localStorage.setItem("bb.theme", theme); } catch { /* no storage */ } }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0f1626" : "#f7f8f4");
  mapApi?.setTheme(theme);
}

{
  let saved = null;
  try { saved = localStorage.getItem("bb.theme"); } catch { /* no storage */ }
  const system = window.matchMedia?.("(prefers-color-scheme: dark)");
  applyTheme(saved === "dark" || saved === "light" ? saved : system?.matches ? "dark" : "light");
  system?.addEventListener?.("change", (e) => {
    let pinned = null;
    try { pinned = localStorage.getItem("bb.theme"); } catch { /* no storage */ }
    if (!pinned) applyTheme(e.matches ? "dark" : "light");
  });
  document.getElementById("theme-toggle")?.addEventListener("click", () =>
    applyTheme(currentTheme() === "dark" ? "light" : "dark", { save: true }));
}

// ---------- small helpers ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// Great-circle distance in km. Straight line only: not a route.
function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtKm(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// ---------- health ----------
// Narrow phones get the short form, so the pill never ends in "…"; the full text is its tooltip.
function setStatusText(full, short) {
  $("status-text").textContent = window.matchMedia("(max-width: 420px)").matches ? short : full;
  $("status").title = full;
}

async function checkHealth() {
  const box = $("status");
  const text = $("status-text");
  const banner = $("banner");
  try {
    const h = await (await fetch("/api/health")).json();
    box.className = "status";
    banner.hidden = true;
    if (h.ollama !== "ok") {
      box.classList.add("bad");
      text.textContent = "AI offline";
      banner.textContent = "The local AI runtime (Ollama) is not running. The map works; start Ollama to ask questions.";
      banner.hidden = false;
    } else if (!h.model_installed) {
      box.classList.add("bad");
      text.textContent = "Model missing";
      banner.textContent = `Model "${h.model}" is not installed. Run: ollama pull ${h.model}`;
      banner.hidden = false;
    } else if (!h.model_loaded) {
      box.classList.add("warn");
      text.textContent = "AI warming up";
    } else {
      box.classList.add("ok");
      text.textContent = "Offline-ready";
    }
    reports.setHubUp(true); // also sends reports waiting in the outbox
  } catch {
    reports.setHubUp(false);
    // No hub: the phone answers on its own from the saved copy.
    box.className = "status warn";
    setStatusText(hasOfflineCopy ? "On this phone (no hub)" : "Hub not reachable", hasOfflineCopy ? "On this phone" : "No hub");
  }
}

// ---------- offline copy on this phone (service worker) ----------
// The whole app, map and data are saved on the phone so it keeps working with no hub.
// A new data pack on the hub changes the worker URL, so phones re-save when they reconnect.
let hasOfflineCopy = Boolean(navigator.serviceWorker?.controller);
let updateWaiting = false; // a newer version is saved; this page shows the old one
function showOfflineCopy(msg) {
  const el = $("offline-copy");
  if (!el) return;
  el.hidden = false;
  el.replaceChildren();
  if (updateWaiting && msg.state !== "error") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "link-btn";
    btn.textContent = "Tap to restart";
    btn.addEventListener("click", () => window.location.reload());
    el.append(icon("check", 14), " Update saved on this phone. ", btn);
  } else if (msg.state === "saving") {
    el.append(icon("signal", 14), ` Saving offline copy… ${Math.round((100 * msg.done) / msg.total)}% (keep this page open)`);
  } else if (msg.state === "saved" || msg.state === "ready") {
    hasOfflineCopy = true;
    el.append(icon("check", 14), " Saved on this phone: works with no hub or internet.");
    appendDates(el);
  } else if (msg.state === "error") {
    el.append(icon("warning", 14), ` ${msg.text}`);
  }
  el.title = el.textContent;
  if (showDiagnostics) el.append(diagnostics());
}

// Tap the line at the bottom for a short readout (version, screen and page sizes, safe
// areas): what a report about a phone needs, without any developer tools.
let showDiagnostics = false;
let hubPack = null; // the pack the hub has (this copy may be older)
function diagnostics() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)";
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const safe = `${parseFloat(cs.paddingTop)}/${parseFloat(cs.paddingBottom)}`;
  probe.remove();
  const root = document.documentElement;
  const worker = navigator.serviceWorker?.controller?.scriptURL;
  const running = worker ? new URL(worker).searchParams.get("v") : "none";
  const span = document.createElement("span");
  span.className = "diag";
  span.textContent = [
    `copy ${running}${hubPack && hubPack !== running ? ` (hub ${hubPack})` : ""}`,
    navigator.standalone === true ? "home-screen app" : "browser",
    `screen ${screen.width}×${screen.height}`, `window ${innerHeight}`, `page ${root.clientHeight}`,
    `app-h ${root.style.getPropertyValue("--app-h") || "none"}`, `safe ${safe}`,
  ].join(" · ");
  return span;
}
$("offline-copy").addEventListener("click", (e) => {
  if (e.target.closest("button")) return; // "Tap to restart"
  showDiagnostics = !showDiagnostics;
  const el = $("offline-copy");
  if (showDiagnostics) el.append(diagnostics());
  else el.querySelector(".diag")?.remove();
});
let packDates = null;
function appendDates(el) {
  if (!packDates) return;
  const d = packDates;
  el.append(` · Data: map ${d.map} · places ${d.places} · roads ${d.roads} · guides ${d.guides}`);
}
async function setUpOfflineCopy() {
  if (!("serviceWorker" in navigator)) {
    showOfflineCopy({ state: "error", text: "This browser can't save an offline copy." });
    return;
  }
  if (!window.isSecureContext) {
    showOfflineCopy({ state: "error", text: "Offline copy needs the secure hub address (https). Open the hub's setup page." });
    return;
  }
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "offline-copy") showOfflineCopy(e.data); });
  // A new version took over this page (it was saved while the app was open): show it.
  // Restart right away unless the user is in the middle of something; then offer a button.
  const hadCopy = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadCopy) return; // the first save: this page is already the current version
    const busy = document.querySelector("#messages .msg.user")
      || (state.selected && directions.isActiveFor(state.selected.id))
      || !$("pos-hint").hidden;
    if (!busy) { window.location.reload(); return; }
    updateWaiting = true;
    showOfflineCopy({ state: "ready" });
  }, { once: true });
  try {
    // Fresh from the hub when reachable, else the saved copy (via the worker).
    const version = await (await fetch("/pack/version.json", { cache: "no-store" })).json();
    packDates = version.dates;
    hubPack = version.pack;
    const reg = await navigator.serviceWorker.register(`/sw.js?v=${version.pack}`);
    if (navigator.serviceWorker.controller && reg.active && !reg.installing && !reg.waiting
        && new URL(reg.active.scriptURL).searchParams.get("v") === version.pack) {
      showOfflineCopy({ state: "ready" });
    }
  } catch (e) {
    console.warn("offline copy not set up", e);
    if (navigator.serviceWorker.controller) showOfflineCopy({ state: "ready" });
  }
}
setUpOfflineCopy();

// The phone's own answer engine (guide search, places, routing) for when the hub is gone.
const brain = createBrain(() => state.locations, () => reports.snapshot());
function setHubState(reachable) {
  if (!reachable) {
    reports.setHubUp(false);
    $("status").className = "status warn";
    setStatusText("On this phone (no hub)", "On this phone");
  }
}

// ---------- the panel: floating card (laptop) or bottom sheet (phone) ----------
// The map always fills the screen and the panel floats over it. Camera moves (fly to a
// place, fit a route) are padded so their target stays in the part of the map you see.
const phoneMQ = window.matchMedia("(max-width: 820px)");
const isPhone = () => phoneMQ.matches;
const layoutEl = document.querySelector(".layout");
const sheet = createSheet({
  el: $("side-panel"),
  container: layoutEl,
  dragAreas: [$("sheet-handle"), $("side-head")],
  onChange: () => updateMapPadding(),
});

function setCollapsed(collapsed, { save = true } = {}) {
  layoutEl.classList.toggle("panel-collapsed", collapsed);
  $("panel-rail").hidden = !collapsed || isPhone();
  if (save) { try { localStorage.setItem("bb.panel", collapsed ? "closed" : "open"); } catch { /* no storage */ } }
  updateMapPadding();
}
const isCollapsed = () => layoutEl.classList.contains("panel-collapsed");

function updateMapPadding() {
  if (!mapApi) return;
  if (isPhone()) {
    const h = layoutEl.clientHeight;
    const visible = { peek: 112, half: h * 0.5, full: h * 0.5 }[sheet.get()];
    mapApi.setViewPadding({ top: 60, right: 50, bottom: visible + 10, left: 60 });
  } else {
    const card = isCollapsed() ? 70 : $("side-panel").offsetWidth + 24;
    mapApi.setViewPadding({ top: 60, right: card, bottom: 30, left: 30 });
  }
}

const panel = {
  // Make sure the panel can be seen (laptop: un-collapse; phone: at least half height).
  open() {
    if (isPhone()) sheet.atLeast("half");
    else if (isCollapsed()) setCollapsed(false, { save: false });
  },
  // Phone: drop the sheet to peek while the user taps the map; returns "put it back".
  peekForPick() {
    if (!isPhone()) return () => {};
    const prev = sheet.get();
    sheet.set("peek");
    return () => { if (sheet.get() === "peek") sheet.set(prev === "peek" ? "half" : prev); };
  },
};

$("panel-collapse").addEventListener("click", () => setCollapsed(true));
for (const b of document.querySelectorAll(".rail-btn")) {
  b.addEventListener("click", () => {
    setCollapsed(false);
    if (b.dataset.tab !== "open") showTab(b.dataset.tab);
  });
}
// Typing on a phone: give the chat the whole sheet so the keyboard doesn't hide it.
$("question").addEventListener("focus", () => { if (isPhone()) sheet.set("full"); });
function applyPanelMode() {
  let saved = null;
  try { saved = localStorage.getItem("bb.panel"); } catch { /* no storage */ }
  setCollapsed(!isPhone() && saved === "closed", { save: false });
  sheet.apply();
}
phoneMQ.addEventListener?.("change", applyPanelMode);
applyPanelMode();

// ---------- tabs ----------
function showTab(name, { reveal = true } = {}) {
  for (const [tab, panel] of [["tab-chat", "panel-chat"], ["tab-list", "panel-list"], ["tab-reports", "panel-reports"], ["tab-hotlines", "panel-hotlines"]]) {
    const on = tab === `tab-${name}`;
    $(tab).setAttribute("aria-selected", String(on));
    $(panel).hidden = !on;
  }
  if (reveal) panel.open();
}
$("tab-chat").addEventListener("click", () => showTab("chat"));
$("tab-list").addEventListener("click", () => showTab("list"));
$("tab-reports").addEventListener("click", () => showTab("reports"));
$("tab-hotlines").addEventListener("click", () => showTab("hotlines"));

// ---------- hotlines ----------
// Phone numbers like 911, 143, 0915-463-5005, (043) 756-0127, (02) 8911-1406.
const PHONE = /(\(0\d{1,2}\)\s?\d{3,4}-\d{4}|09\d{2}-\d{3}-\d{4}|09\d{9}|\b\d{3}-\d{4}\b|\b(?:911|143|117)\b)/g;

function linkifyPhones(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(PHONE)) {
    frag.append(text.slice(last, m.index));
    const a = document.createElement("a");
    a.href = `tel:${m[0].replace(/[^\d+]/g, "")}`;
    a.textContent = m[0];
    frag.append(a);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

async function loadHotlines() {
  try {
    const sections = await (await fetch("/api/hotlines")).json();
    const box = $("hotline-list");
    for (const s of sections) {
      const div = document.createElement("div");
      div.className = "hotline";
      const h = document.createElement("h3");
      h.textContent = s.title;
      const p = document.createElement("p");
      p.append(linkifyPhones(s.text));
      div.append(h, p);
      box.append(div);
    }
  } catch {
    $("hotline-list").textContent = "Could not load hotlines.";
  }
}
loadHotlines();

// ---------- location panel ----------
const FIELD_LABELS = [
  ["address", "Address"],
  ["phone", "Phone"],
  ["opening_hours", "Hours"],
  ["description", "Details"],
  ["coords", "Coordinates"],
  ["source", "Source"],
  ["verified_on", "Verified"],
];

function fieldValue(key, value, loc) {
  if (key === "phone") {
    const wrap = document.createElement("span");
    value.split(/;\s*/).forEach((num, i) => {
      if (i) wrap.append(", ");
      const a = document.createElement("a");
      a.href = `tel:${num.replace(/[^+\d]/g, "")}`;
      a.textContent = num;
      wrap.append(a);
    });
    return wrap;
  }
  if (key === "source" && loc.osm_url) {
    const wrap = document.createElement("span");
    const a = document.createElement("a");
    a.href = loc.osm_url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = value;
    wrap.append(a, " (link needs internet)");
    return wrap;
  }
  return document.createTextNode(value);
}

function renderPlaceDistance() {
  const loc = state.selected;
  const p = $("place-distance");
  if (!loc || !state.userPos) { p.hidden = true; return; }
  p.hidden = false;
  iconLabel(p, "ruler", `${fmtKm(distanceKm(state.userPos, loc))} from your position (straight line, not a route)`, 14);
}

// Live reports about the open place (e.g. "Evacuation center full · unverified · 40 min ago").
function renderPlaceReports() {
  const ul = $("place-reports");
  const lines = state.selected ? reports.forPlace(state.selected.id) : [];
  ul.hidden = !lines.length;
  ul.replaceChildren(...lines.map((t) => {
    const li = document.createElement("li");
    iconLabel(li, "flag", t, 14);
    return li;
  }));
}

function selectPlace(loc) {
  state.selected = loc;
  const t = typeStyle(loc.type);
  // The details live in the side panel: open it if the user had collapsed it.
  panel.open();
  $("place").hidden = false;
  $("place-name").textContent = loc.name;
  $("place-type").textContent = [t.label, ...(loc.also ?? []).map((a) => typeStyle(a).label)].join(" · ");
  $("place-type").style.background = t.color + "22";
  $("place-type").style.color = t.color;
  $("place-sample").hidden = !loc.is_sample;
  $("place-osm").hidden = loc.is_sample || !loc.osm_url;
  $("place-evac-note").hidden = !(loc.type === "evacuation_center" && loc.osm_url);
  const values = { ...loc, coords: `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` };
  const dl = $("place-fields");
  dl.replaceChildren();
  for (const [key, label] of FIELD_LABELS) {
    if (!values[key]) continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.append(fieldValue(key, values[key], loc));
    dl.append(dt, dd);
  }
  renderPlaceDistance();
  renderPlaceReports();
  $("chat-context").hidden = false;
  iconLabel($("chat-context"), "pin", loc.name, 13);
  if (!directions.isActiveFor(loc.id)) directions.clear();
  mapApi?.highlight(loc.id);
  renderList();
  renderChips();
}

function clearPlace() {
  directions.clear();
  state.selected = null;
  $("place").hidden = true;
  $("chat-context").hidden = true;
  mapApi?.highlight(null);
  renderList();
  renderChips();
}
$("place-close").addEventListener("click", clearPlace);
$("place-ask").addEventListener("click", () => {
  showTab("chat");
  $("question").focus();
});
$("place-route").addEventListener("click", () => directions.start());

// ---------- facility list ----------
function matches(loc) {
  // A hospital that is also an evacuation site shows under either filter.
  if (!state.types.has(loc.type) && !(loc.also ?? []).some((t) => state.types.has(t))) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [loc.name, typeStyle(loc.type).label, loc.address, loc.description].filter(Boolean).join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function renderList() {
  const visible = state.locations.filter(matches);
  if (state.userPos) {
    for (const l of visible) l._km = distanceKm(state.userPos, l);
    visible.sort((a, b) => a._km - b._km);
  } else {
    visible.sort((a, b) => a.name.localeCompare(b.name));
  }
  mapApi?.filter(new Set(visible.map((l) => l.id)));
  renderLegend();
  $("fac-count").textContent = String(visible.length);
  $("fac-note").textContent = state.userPos
    ? "Sorted by straight-line distance from your position. Not a route; roads may be longer or blocked."
    : "Set your location on the map to sort by distance.";

  const LIMIT = 100;
  const ul = $("fac-list");
  ul.replaceChildren();
  if (!visible.length) {
    const li = document.createElement("li");
    li.className = "fac-empty";
    li.textContent = "No facilities match.";
    ul.append(li);
    return;
  }
  for (const loc of visible.slice(0, LIMIT)) {
    const t = typeStyle(loc.type);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fac" + (state.selected?.id === loc.id ? " selected" : "");
    const sw = pinImg(loc.type, t.color, 24);
    const info = document.createElement("span");
    const name = document.createElement("div");
    name.className = "fac-name";
    name.textContent = loc.name + (loc.is_sample ? " · sample" : "");
    const meta = document.createElement("div");
    meta.className = "fac-meta";
    meta.textContent = [t.label, loc.address].filter(Boolean).join(" · ");
    info.append(name, meta);
    const dist = document.createElement("span");
    dist.className = "fac-dist";
    dist.textContent = state.userPos ? fmtKm(loc._km) : "";
    btn.append(sw, info, dist);
    btn.addEventListener("click", () => selectPlace(loc));
    li.append(btn);
    ul.append(li);
  }
  if (visible.length > LIMIT) {
    const li = document.createElement("li");
    li.className = "fac-empty";
    li.textContent = `Showing ${LIMIT} of ${visible.length}. Search or filter to narrow the list.`;
    ul.append(li);
  }
}

function buildFilters() {
  const wrap = $("fac-filters");
  const present = new Set(state.locations.map((l) => l.type));
  for (const [type, t] of Object.entries(TYPE_STYLE)) {
    if (!present.has(type)) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "filter";
    b.setAttribute("aria-pressed", String(state.types.has(type)));
    b.append(pinImg(type, t.color, 18), t.label);
    b.addEventListener("click", () => {
      const on = !state.types.has(type);
      on ? state.types.add(type) : state.types.delete(type);
      b.setAttribute("aria-pressed", String(on));
      renderList();
    });
    wrap.append(b);
  }
}
$("fac-search").addEventListener("input", (e) => {
  state.query = e.target.value;
  renderList();
});

// ---------- user position ----------
let lastHeavyRender = 0;

// `fromGps` fixes arrive every second or so while tracking: don't write storage each time,
// re-render the facility list and chips at most every 3 s, and let directions handle the
// route itself (it checks progress instead of recomputing).
function setUserPos(pos, { persist = true, fromGps = false, accuracy = null } = {}) {
  state.userPos = pos;
  mapApi?.setUserPosition(pos);
  mapApi?.setAccuracy(fromGps && pos && accuracy ? { lat: pos.lat, lng: pos.lng, radius: accuracy } : null);
  if (persist && !fromGps) store.set("bb.userPos", pos);
  iconLabel($("set-pos"), "pin", pos ? "Move my location" : "Set my location");
  renderPlaceDistance();
  if (!fromGps || Date.now() - lastHeavyRender > 3000) {
    lastHeavyRender = Date.now();
    renderList();
    renderChips();
  }
  if (!fromGps) directions?.positionChanged();
}

// Let the user click the map to say where they are. `then` runs after they click.
// While the user taps the map, a phone's sheet drops to its peek height; this puts it back.
let restoreSheet = null;
function endPick() {
  $("pos-hint").hidden = true;
  restoreSheet?.();
  restoreSheet = null;
}

function pickMyLocation(then) {
  if (!mapApi) return;
  stopLocate();
  showGpsMsg("");
  $("set-pos").setAttribute("aria-pressed", "true");
  $("pos-hint").textContent = isPhone() ? "Tap the map where you are." : "Click the map where you are.";
  $("pos-hint").hidden = false;
  restoreSheet = panel.peekForPick();
  mapApi.pickPosition((pos) => {
    $("set-pos").setAttribute("aria-pressed", "false");
    endPick();
    setUserPos(pos);
    then?.();
  });
}

// One tap on the map for something else (a report's spot), with its own hint.
function pickOnMap(hint, then) {
  if (!mapApi) return;
  $("set-pos").setAttribute("aria-pressed", "false");
  $("pos-hint").textContent = hint;
  $("pos-hint").hidden = false;
  restoreSheet = panel.peekForPick();
  mapApi.pickPosition((pos) => {
    endPick();
    then(pos);
  });
}

function cancelMapPick() {
  mapApi?.cancelPick();
  $("set-pos").setAttribute("aria-pressed", "false");
  endPick();
}

const directions = createDirections({
  getMapApi: () => mapApi,
  brain,
  getPlaceById: (id) => state.locations.find((l) => l.id === id),
  getPlace: () => state.selected,
  getPos: () => state.userPos,
  setPos: (pos, opts) => setUserPos(pos, opts),
  requestPosition: () => pickMyLocation(),
  onTracking: (on) => (on ? startHeading() : stopHeading()),
  onGpsHeading: (deg) => reportHeading(deg, "gps"),
});

const reports = createReports({
  getMapApi: () => mapApi,
  getPos: () => state.userPos,
  getSelected: () => state.selected,
  getLocations: () => state.locations,
  pickOnMap,
  cancelPick: cancelMapPick,
  showTab,
  onChange: (list) => {
    renderPlaceReports();
    directions.reportsChanged(list);
    $("rail-report-count").textContent = list.length ? String(list.length) : "";
    $("rail-report-count").hidden = !list.length;
  },
});
$("report-btn").addEventListener("click", () => {
  panel.open();
  reports.openChooser();
});

$("set-pos").addEventListener("click", () => {
  const btn = $("set-pos");
  if (btn.getAttribute("aria-pressed") === "true") {
    cancelMapPick();
    return;
  }
  // While a place is open, stay on it (directions update); otherwise show nearby facilities.
  pickMyLocation(() => { if (!state.selected) showTab("list", { reveal: false }); });
});

// "Use GPS" (and the locate button on the map). It watches for up to 90 s: the first fix
// shows right away (even a rough one), better fixes refine it, and it stops at ±30 m. With
// Wi-Fi off a phone has only the satellites, and a first fix can take a minute or more.
const gpsAvailable = "geolocation" in navigator && window.isSecureContext;
const LOCATE_MAX_MS = 90_000;
const LOCATE_GOOD_M = 30;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const touchDevice = window.matchMedia("(pointer: coarse)").matches;
const GPS_TEXT = {
  waiting: touchDevice
    ? "Waiting for a GPS signal… With Wi-Fi off this can take a minute. Step outside or near a window."
    : "Waiting for your location… Laptops often need internet for this.",
  none: touchDevice
    ? "No GPS signal yet. Try again outside, or use “Move my location” and tap where you are."
    : "Location unavailable (laptops often need internet for this). Use “Move my location” instead.",
  denied: isIOS
    ? "Location is off for OFFGRID. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using the App, and turn on Precise Location. Then try again."
    : touchDevice
      ? "Location is blocked for OFFGRID. Allow Location for Chrome in the phone's Settings, and for this site in Chrome (Site settings → Location). Then try again."
      : "Location permission was denied. Use “Move my location” instead.",
  outside: "You seem to be outside the area this map covers (Batangas). Use “Move my location” to set a spot on the map.",
};
function showGpsMsg(text) {
  $("gps-msg").querySelector("span").textContent = text || "";
  $("gps-msg").hidden = !text;
}
$("gps-msg-close").addEventListener("click", () => showGpsMsg(""));

let locating = null; // { watchId, best, gotFix, userMoved, timers }
function stopLocate() {
  if (!locating) return;
  navigator.geolocation.clearWatch(locating.watchId);
  clearTimeout(locating.slowTimer);
  clearTimeout(locating.endTimer);
  locating = null;
  const btn = $("use-gps");
  btn.classList.remove("busy");
  iconLabel(btn, "gps", "Use GPS");
  mapApi?.setLocateBusy(false);
}
function locateMe() {
  if (locating) { stopLocate(); return; } // a second tap stops looking
  showGpsMsg("");
  const btn = $("use-gps");
  btn.classList.add("busy");
  iconLabel(btn, "gps", "Locating…");
  mapApi?.setLocateBusy(true);
  startHeading({ autoStopMs: 60_000 }); // must start inside the tap (iOS asks permission)
  const session = { best: Infinity, gotFix: false, userMoved: false };
  locating = session;
  session.slowTimer = setTimeout(() => {
    if (locating === session && !session.gotFix) showGpsMsg(GPS_TEXT.waiting);
  }, 10_000);
  session.endTimer = setTimeout(() => {
    if (locating !== session) return;
    stopLocate();
    if (!session.gotFix) showGpsMsg(GPS_TEXT.none);
  }, LOCATE_MAX_MS);
  const onFix = (p) => {
    if (locating !== session) return;
    const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
    const accuracy = p.coords.accuracy;
    if (!inBounds(pos)) { stopLocate(); showGpsMsg(GPS_TEXT.outside); return; }
    if (accuracy >= session.best) return; // only better fixes from here on
    const first = !session.gotFix;
    session.gotFix = true;
    session.best = accuracy;
    showGpsMsg("");
    setUserPos(pos);
    mapApi?.setAccuracy({ ...pos, radius: accuracy });
    if (first) {
      if (isPhone()) sheet.set("peek"); // show the map around you
      if (!state.selected) showTab("list", { reveal: false });
    }
    if (first || !session.userMoved) mapApi?.zoomTo(pos, accuracy);
    if (accuracy <= LOCATE_GOOD_M) stopLocate();
  };
  const onError = (err) => {
    if (locating !== session) return;
    if (err.code === err.PERMISSION_DENIED) { stopLocate(); showGpsMsg(GPS_TEXT.denied); }
    // TIMEOUT / POSITION_UNAVAILABLE: keep waiting (the 90 s timer decides); phones often
    // report "unavailable" for a while before the first satellite fix.
  };
  session.watchId = navigator.geolocation.watchPosition(onFix, onError,
    { enableHighAccuracy: true, maximumAge: 30_000, timeout: LOCATE_MAX_MS });
}
if (gpsAvailable) {
  $("use-gps").hidden = false;
  $("use-gps").addEventListener("click", locateMe);
}

// ---------- heading (which way you face) ----------
// Best source first: the device compass (phones), then the GPS course while moving.
// Laptops have neither, so the cone simply stays hidden.
const heading = { value: null, at: 0, source: null, compassAt: 0, listening: false, stopTimer: null };

function reportHeading(deg, source) {
  if (deg == null || Number.isNaN(deg)) return;
  // Prefer a fresh compass reading over the GPS course.
  if (source === "gps" && Date.now() - heading.compassAt < 3000) return;
  if (source === "compass") heading.compassAt = Date.now();
  // Smooth along the shortest way round the circle so the cone doesn't jitter.
  const prev = heading.value;
  const next = prev == null ? deg : (prev + 0.35 * ((((deg - prev) % 360) + 540) % 360 - 180) + 360) % 360;
  heading.value = next;
  heading.at = Date.now();
  heading.source = source;
  mapApi?.setHeading(next);
}

function onOrientation(e) {
  let deg = null;
  if (typeof e.webkitCompassHeading === "number") deg = e.webkitCompassHeading; // iOS
  else if (e.absolute && typeof e.alpha === "number") deg = (360 - e.alpha) % 360; // Android
  if (deg != null) reportHeading(deg, "compass");
}

async function startHeading({ autoStopMs = 0 } = {}) {
  clearTimeout(heading.stopTimer);
  if (autoStopMs) heading.stopTimer = setTimeout(stopHeading, autoStopMs);
  if (heading.listening || !window.isSecureContext) return;
  try {
    // iOS only gives compass data after asking, and only from a user tap.
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      if ((await DeviceOrientationEvent.requestPermission()) !== "granted") return;
    }
  } catch { return; }
  const evt = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
  window.addEventListener(evt, onOrientation);
  heading.listening = evt;
}

function stopHeading() {
  clearTimeout(heading.stopTimer);
  if (heading.listening) window.removeEventListener(heading.listening, onOrientation);
  heading.listening = false;
  heading.value = null;
  mapApi?.setHeading(null);
}

// Hide the cone if no heading arrives for 5 s (standing still, sensor asleep).
setInterval(() => {
  if (heading.value != null && Date.now() - heading.at > 5000) {
    heading.value = null;
    mapApi?.setHeading(null);
  }
}, 1000);

// ---------- legend ----------
function setLegend(open, { save = true } = {}) {
  if (open && isPhone()) sheet.set("peek"); // the legend sits over the map
  $("legend").hidden = !open;
  $("legend-toggle").setAttribute("aria-expanded", String(open));
  $("legend-toggle").classList.toggle("open", open);
  if (save) { try { localStorage.setItem("bb.legend", open ? "open" : "closed"); } catch { /* no storage */ } }
}
$("legend-toggle").addEventListener("click", () => setLegend($("legend").hidden));
{
  let saved = null;
  try { saved = localStorage.getItem("bb.legend"); } catch { /* no storage */ }
  // Closed by default on small screens, where the card would cover much of the map.
  setLegend(saved ? saved === "open" : !window.matchMedia("(max-width: 820px)").matches, { save: false });
}

// ---------- legend (types currently shown) ----------
function renderLegend() {
  const present = new Set(state.locations.map((l) => l.type));
  $("legend").replaceChildren();
  for (const [type, t] of Object.entries(TYPE_STYLE)) {
    if (!present.has(type) || !state.types.has(type)) continue;
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = t.label;
    li.append(pinImg(type, t.color, 30), label);
    $("legend").append(li);
  }
}

// ---------- battery saver ----------
// Skips the AI model entirely: answers come straight from the guide text, which costs
// almost no battery. Turns itself on when the battery is low (≤ 20 % and not charging),
// unless the user has chosen; the user's choice is remembered.
const saver = { on: false, chosen: false };
function setSaver(on, { save = false, auto = false } = {}) {
  saver.on = on;
  const btn = $("battery-saver");
  btn.setAttribute("aria-pressed", String(on));
  btn.classList.toggle("on", on);
  iconLabel(btn, "battery", on ? (auto ? "Battery saver (low battery)" : "Battery saver on") : "Battery saver", 15);
  if (save) {
    saver.chosen = true;
    try { localStorage.setItem("bb.saver", on ? "on" : "off"); } catch { /* no storage */ }
  }
}
{
  let saved = null;
  try { saved = localStorage.getItem("bb.saver"); } catch { /* no storage */ }
  saver.chosen = saved === "on" || saved === "off";
  setSaver(saved === "on");
  $("battery-saver").addEventListener("click", () => setSaver(!saver.on, { save: true }));
  // Battery Status API (Chrome/Edge/Android); not available everywhere, so it's optional.
  navigator.getBattery?.().then((b) => {
    const check = () => {
      if (saver.chosen) return;
      const low = !b.charging && b.level <= 0.2;
      if (low !== saver.on) setSaver(low, { auto: low });
    };
    check();
    b.addEventListener("levelchange", check);
    b.addEventListener("chargingchange", check);
  }).catch(() => { /* no battery info */ });
}

// ---------- chat ----------
const chat = createChat({
  messages: $("messages"),
  form: $("ask-form"),
  input: $("question"),
  send: $("send"),
  count: $("count"),
  empty: $("empty"),
  getLocation: () => state.selected,
  getPosition: () => state.userPos,
  getMode: () => directions.getMode(),
  onRoute: (route) => directions.showFromChat(route),
  getUseAi: () => !saver.on,
  brain,
  onHubState: setHubState,
  onShowPlace: (id) => { const l = byId(id); if (l) selectPlace(l); },
  onRoutePlace: (id) => { const l = byId(id); if (l) { selectPlace(l); directions.start(); } },
  placeIcon: (type) => pinImg(type, typeStyle(type).color, 28),
  reportIcon: (kind) => reportImg(kind, REPORT_KINDS[kind]?.color ?? "#495057", 28),
  onShowReport: (r) => { mapApi?.flyTo(r.lat, r.lng); },
  onContextChange: (has) => { $("new-topic").hidden = !has; },
});
$("new-topic").addEventListener("click", () => chat.reset());
document.querySelectorAll(".suggest").forEach((b) => b.addEventListener("click", () => chat.ask(b.textContent)));

function byId(id) {
  return state.locations.find((l) => l.id === id);
}

// ---------- suggestion chips that follow the context ----------
// What's useful to ask depends on whether a place is selected and a position is set.
function renderChips() {
  const place = state.selected;
  const pos = state.userPos;
  let chips;
  if (place && pos) {
    chips = ["How far is it?", "How do I get there?", "Contact number?", "Is it open?"];
  } else if (place) {
    chips = ["Contact number?", "Is it open?", "Is this an evacuation center?", "How do I get there?"];
  } else if (pos) {
    chips = ["Nearest evacuation center", "Nearest hospital", "Nearest pharmacy", "What's near me?", "Emergency hotlines"];
  } else {
    chips = ["Emergency hotlines", "What should I pack in a go-bag?", "What does signal no. 3 mean?", "How do I stop bleeding?"];
  }
  const box = $("context-chips");
  box.replaceChildren();
  for (const text of chips) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip-q";
    b.textContent = text;
    b.addEventListener("click", () => {
      // Questions that need a position start the "set my location" flow first.
      if (/how do i get there/i.test(text)) { directions.start(); return; }
      chat.ask(text === "Emergency hotlines" ? "What number do I call for an emergency?" : text);
    });
    box.append(b);
  }
}
renderChips();

// ---------- startup ----------
(async () => {
  try {
    state.locations = await (await fetch("/api/locations")).json();
  } catch {
    $("map-error").hidden = false;
    $("map-error").textContent = "Could not load location records from the server.";
  }
  buildFilters();
  renderList();
  try {
    mapApi = await createMap("map", {
      onSelect: selectPlace,
      onReport: (id) => {
        panel.open();
        reports.reveal(id);
      },
      onLocate: gpsAvailable ? locateMe : null,
      onLoad: () => $("map-loading").classList.add("done"),
      onReady: hideSplash,
      onUserMove: (pos) => setUserPos(pos),
      onManualMove: () => { directions.manualMove(); if (locating) locating.userMoved = true; },
      theme: currentTheme(),
    });
    mapApi.setLocations(state.locations);
    updateMapPadding();
    reports.render(); // the saved copy, until the hub answers
    mapApi.map.on("error", (e) => console.warn("map error", e.error?.message ?? e));
    const saved = store.get("bb.userPos");
    if (saved && typeof saved.lat === "number" && typeof saved.lng === "number") setUserPos(saved, { persist: false });
    renderList();
  } catch (err) {
    console.error(err);
    hideSplash();
    $("map-loading").classList.add("done");
    $("map-error").hidden = false;
    $("map-error").textContent = "The offline map failed to load. Location records and the assistant still work.";
  }
})();

checkHealth();
// Every 15 s normally; open the app with ?demo for every 3 s, so in a live demo a report
// posted from a phone shows on this screen almost at once.
setInterval(checkHealth, new URLSearchParams(window.location.search).has("demo") ? 3000 : 15000);
