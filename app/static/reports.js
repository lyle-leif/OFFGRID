// Situation reports on the phone: post ("road flooded here"), see, confirm or dispute.
//
// Reports are shared through the hub, or, on the website, through the online reports
// (a Cloudflare Worker, cloud/; the same /api/reports). A report made while that is out of
// reach waits in an outbox on this phone and is sent when it is back (store-and-forward).
// The last list is kept, so the map and the assistant can still show it offline, marked
// with how long ago it was synced. Online, responders log in with personal accounts.
import { CENTER_KINDS, REPORT_KINDS, ROAD_KINDS, fmtAge, trustLabel } from "./report-kinds.js";
import { getLang, roadName, t } from "./i18n.js";
import { CLOUD, SITE, url } from "./mode.js";
import { reportImg } from "./icons.js";
import { icon, iconLabel } from "./ui-icons.js";

const KEYS = { device: "bb.device", outbox: "bb.reports.outbox", cache: "bb.reports.cache", votes: "bb.reports.votes" };
const TIMEOUT_MS = 5000;
const CENTER_PICK_M = 300; // a "center full/open" pin snaps to an evacuation center this close
const ONLINE = Boolean(SITE && CLOUD); // the website with online reports
const NO_REPORTS = SITE && !CLOUD; // the website without them: reports need a hub
const TOKEN_KEY = ONLINE ? "bb.token" : "bb.pin";

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("").replace(/(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-");
}

// An anonymous id for this phone, so it votes once per report. Never tied to a person.
function deviceId() {
  let id = store.get(KEYS.device);
  if (typeof id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = randomId();
    store.set(KEYS.device, id);
  }
  return id;
}

function meters(a, b) {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return Math.hypot((a.lng - b.lng) * 111_320 * Math.cos(lat), (a.lat - b.lat) * 110_540);
}

// The hub (or the online reports) words its error messages in the app's language (X-Lang).
async function fetchJSON(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = { ...opts.headers, "X-Lang": getLang() };
    const resp = await fetch(ONLINE ? CLOUD + path : url(path), { ...opts, headers, signal: ctrl.signal, cache: "no-store" });
    let body = null;
    try { body = await resp.json(); } catch { /* empty body */ }
    return { ok: resp.ok, status: resp.status, body };
  } finally {
    clearTimeout(timer);
  }
}

const detail = (res, fallback) => (typeof res.body?.detail === "string" ? res.body.detail : fallback);

export function createReports({ getMapApi, getPos, getSelected, getLocations, pickOnMap, cancelPick, showTab, onChange, snapRoad }) {
  const $ = (id) => document.getElementById(id);
  const device = deviceId();
  let outbox = Array.isArray(store.get(KEYS.outbox)) ? store.get(KEYS.outbox) : [];
  let cache = store.get(KEYS.cache);
  if (!cache || !Array.isArray(cache.reports)) cache = { synced_at: 0, reports: [] };
  const votes = store.get(KEYS.votes) ?? {};
  let hubUp = false;
  let syncing = null;
  let pin = null;
  try { pin = sessionStorage.getItem(TOKEN_KEY); } catch { /* no storage */ } // hub PIN, or online session token

  // ---- data ----------------------------------------------------------------
  // Reports still in force, ages counted forward from the last sync, plus this phone's
  // unsent ones. Newest first.
  function current() {
    const passed = cache.synced_at ? Math.max(0, Math.floor((Date.now() - cache.synced_at) / 60000)) : 0;
    const live = cache.reports
      .filter((r) => r.expires_in_min - passed > 0)
      .map((r) => ({ ...r, age_min: r.age_min + passed, expires_in_min: r.expires_in_min - passed }));
    const pending = outbox.map((o) => {
      const k = REPORT_KINDS[o.kind];
      const loc = o.location_id ? getLocations().find((l) => l.id === o.location_id) : null;
      return {
        ...o, pending: true, label: k.label, location_name: loc?.name ?? null, road_name: o.road_name ?? null,
        age_min: Math.max(0, Math.floor((Date.now() - o.created) / 60000)), expires_in_min: k.ttlMin,
        ttl_min: k.ttlMin, confirms: 0, disputes: 0, reports: 1, trust: "unverified",
      };
    }).filter((r) => r.age_min < r.ttl_min);
    return [...pending, ...live].sort((a, b) => a.age_min - b.age_min);
  }

  // For the assistant: the hub's last list, how old that copy is, and unsent reports.
  function snapshot() {
    if (NO_REPORTS) return { reports: [], syncedMinAgo: "site" }; // the website without online reports
    const minAgo = cache.synced_at ? Math.floor((Date.now() - cache.synced_at) / 60000) : undefined; // undefined: never synced
    // Online, the phone always answers itself: say how old the copy is only when offline.
    if (ONLINE) return { reports: current(), syncedMinAgo: hubUp ? null : minAgo, source: "online" };
    return { reports: current(), syncedMinAgo: minAgo };
  }

  function saveOutbox() { store.set(KEYS.outbox, outbox); }

  // ---- talking to the hub --------------------------------------------------
  async function flush() {
    const failed = [];
    for (const o of [...outbox]) {
      const body = {
        id: o.id, kind: o.kind, lat: o.lat, lng: o.lng, location_id: o.location_id ?? null, device,
        age_s: Math.max(0, Math.round((Date.now() - o.created) / 1000)),
        ...(o.edge_id != null ? { edge_id: o.edge_id, road_name: o.road_name } : {}), // snapped on this phone (online)
      };
      let res;
      try {
        res = await fetchJSON("api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      } catch {
        hubUp = false;
        return failed; // hub gone again: keep the rest for later
      }
      if (res.status === 429 || res.status >= 500) return failed;
      outbox = outbox.filter((x) => x.id !== o.id);
      saveOutbox();
      if (!res.ok) failed.push(`${REPORT_KINDS[o.kind].label}: ${detail(res, t("rep.not_accepted"))}`);
    }
    return failed;
  }

  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const failed = outbox.length ? await flush() : [];
        if (failed.length) message(t("rep.not_sent", { list: failed.join("; ") }), true);
        const res = await fetchJSON("api/reports");
        if (res.ok && Array.isArray(res.body)) {
          hubUp = true;
          cache = { synced_at: Date.now(), reports: res.body };
          store.set(KEYS.cache, cache);
        } else if (ONLINE) {
          hubUp = false; // e.g. over the free plan's daily limit: work from the saved copy
        }
      } catch {
        hubUp = false;
      } finally {
        syncing = null;
        render();
      }
      return hubUp;
    })();
    return syncing;
  }

  function setHubUp(up) {
    if (SITE) return; // the website: app.js polls the online reports with sync()
    hubUp = up;
    if (up) sync(); else render();
  }

  // ---- posting ---------------------------------------------------------------
  // `key` names the message, so code can check what is showing without comparing text.
  function message(text, warn = false, key = null) {
    const el = $("report-msg");
    el.hidden = !text;
    el.textContent = text ?? "";
    el.dataset.msg = key ?? "";
    el.classList.toggle("warn", warn);
  }

  function nearestCenter(pos) {
    let best = null;
    for (const l of getLocations()) {
      if (l.type !== "evacuation_center" && !(l.also ?? []).includes("evacuation_center")) continue;
      const d = meters(pos, l);
      if (d <= CENTER_PICK_M && (!best || d < best.d)) best = { loc: l, d };
    }
    return best?.loc ?? null;
  }

  // `road`: { edge_id, road_name } when this phone snapped the report to a road (online).
  function queue(kind, pos, loc = null, road = null) {
    const o = { id: randomId(), kind, lat: loc ? loc.lat : pos.lat, lng: loc ? loc.lng : pos.lng, location_id: loc?.id ?? null, created: Date.now() };
    if (road) Object.assign(o, { edge_id: road.edge_id, road_name: road.road_name });
    outbox.push(o);
    saveOutbox();
    if (hubUp) message(t("rep.sending"), false, "sending");
    else message(t(ONLINE ? "rep.saved_outbox_online" : "rep.saved_outbox"));
    render();
    sync().then(() => { if (!outbox.some((x) => x.id === o.id) && $("report-msg").dataset.msg === "sending") message(t("rep.sent")); });
  }

  function choose(kind) {
    $("report-kinds").hidden = true;
    const sel = getSelected();
    const isCenter = (l) => l && (l.type === "evacuation_center" || (l.also ?? []).includes("evacuation_center"));
    if (CENTER_KINDS.has(kind) && isCenter(sel)) {
      queue(kind, sel, sel);
      return;
    }
    const hint = t(CENTER_KINDS.has(kind) ? "rep.hint_center" : ROAD_KINDS.has(kind) ? "rep.hint_road" : "rep.hint_any");
    message(hint);
    pickOnMap(hint, async (pos) => {
      if (CENTER_KINDS.has(kind)) {
        const loc = nearestCenter(pos);
        if (!loc) { message(t("rep.no_center"), true); return; }
        queue(kind, pos, loc);
      } else if (ONLINE && ROAD_KINDS.has(kind)) {
        // The online reports have no road network: snap to the road here, as the hub would.
        const road = await snapRoad?.(pos.lat, pos.lng);
        if (!road) { message(t("apierr.pin_on_road"), true); return; }
        queue(kind, road.point, null, road);
      } else {
        queue(kind, pos);
      }
    });
  }

  function openChooser() {
    showTab("reports");
    const box = $("report-kinds");
    box.replaceChildren();
    const title = document.createElement("p");
    title.className = "report-kinds-title";
    title.textContent = t("rep.chooser");
    box.append(title);
    for (const [kind, k] of Object.entries(REPORT_KINDS)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "report-kind";
      const span = document.createElement("span");
      span.textContent = k.label;
      b.append(reportImg(kind, k.color, 24), span);
      b.addEventListener("click", () => choose(kind));
      box.append(b);
    }
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "link-btn";
    cancel.textContent = t("rep.cancel");
    cancel.addEventListener("click", () => { box.hidden = true; message(null); cancelPick(); });
    box.append(cancel);
    box.hidden = false;
    message(null);
  }

  // ---- voting and responders -------------------------------------------------
  async function vote(r, v) {
    if (!hubUp) { message(t(ONLINE ? "rep.vote_needs_online" : "rep.vote_needs_hub"), true); return; }
    try {
      const res = await fetchJSON(`api/reports/${encodeURIComponent(r.id)}/vote`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device, vote: v }),
      });
      if (!res.ok) { message(detail(res, t("rep.vote_failed")), true); return; }
      votes[r.id] = v;
      store.set(KEYS.votes, votes);
    } catch {
      hubUp = false;
      message(t(ONLINE ? "rep.offline_now" : "rep.hub_unreachable"), true);
    }
    sync();
  }

  async function responderAction(r, action) {
    try {
      const res = await fetchJSON(`api/reports/${encodeURIComponent(r.id)}${action === "verify" ? "/verify" : ""}`, {
        method: action === "verify" ? "POST" : "DELETE", headers: authHeaders(),
      });
      if (!res.ok) message(detail(res, t("rep.not_allowed")), true);
      if (res.status === 401 || res.status === 403) setPin(null);
    } catch {
      message(t(ONLINE ? "rep.offline_now" : "rep.hub_unreachable"), true);
    }
    sync();
  }

  // Hub: the shared PIN. Online: the session token from logging in with a personal account.
  const authHeaders = () => (ONLINE ? { Authorization: `Bearer ${pin ?? ""}` } : { "X-Responder-Pin": pin ?? "" });

  function setPin(value) {
    if (!value && pin && ONLINE) fetchJSON("api/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
    pin = value;
    try { value ? sessionStorage.setItem(TOKEN_KEY, value) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* no storage */ }
    $("responder-btn").textContent = t(value ? "reports.responder_on" : "reports.responder");
    render();
  }

  $("responder-btn").addEventListener("click", () => {
    if (pin) { setPin(null); return; }
    $("responder-form").hidden = !$("responder-form").hidden;
    if (!$("responder-form").hidden) $(ONLINE ? "responder-name" : "responder-pin").focus();
  });
  $("responder-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = $("responder-pin").value.trim();
    if (ONLINE) {
      try {
        const res = await fetchJSON("api/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: $("responder-name").value.trim(), password: value }),
        });
        if (!res.ok || !res.body?.token) { message(detail(res, t("rep.wrong_pin")), true); return; }
        $("responder-form").hidden = true;
        $("responder-pin").value = "";
        message(t("rep.responder_on_msg"));
        setPin(res.body.token);
      } catch {
        message(t("rep.responder_needs_online"), true);
      }
      return;
    }
    try {
      const res = await fetchJSON("api/reports/responder", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: value }),
      });
      if (!res.ok) { message(detail(res, t("rep.wrong_pin")), true); return; }
      $("responder-form").hidden = true;
      $("responder-pin").value = "";
      message(t("rep.responder_on_msg"));
      setPin(value);
    } catch {
      message(t("rep.responder_needs_hub"), true);
    }
  });

  // ---- rendering ---------------------------------------------------------------
  function where(r) {
    if (r.location_name) return r.location_name;
    if (r.road_name) return t("rep.on_road", { road: roadName(getLang(), r.road_name) });
    const pos = getPos();
    if (pos) {
      const d = meters(pos, r);
      return t("rep.from_you", { d: d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km` });
    }
    return t("rep.at", { lat: r.lat.toFixed(4), lng: r.lng.toFixed(4) });
  }

  function trustLine(r) {
    if (r.pending) return t("rep.not_sent_yet", { age: fmtAge(r.age_min) });
    const parts = [trustLabel(r.trust), fmtAge(r.age_min), t("rep.count", { n: r.reports })];
    if (r.disputes) parts.push(t("rep.disputed", { n: r.disputes }));
    return parts.join(" · ");
  }

  function smallBtn(label, iconName, onClick, pressed = null) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn secondary pr-btn";
    if (iconName) iconLabel(b, iconName, label, 14); else b.textContent = label;
    if (pressed != null) b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function render() {
    const list = current();
    getMapApi()?.setReports(list.map((r) => ({ id: r.id, kind: r.kind, lat: r.lat, lng: r.lng, fresh: !r.pending && r.age_min < r.ttl_min / 2 })));
    $("report-count").textContent = list.length ? String(list.length) : "";

    const syncEl = $("reports-sync");
    syncEl.replaceChildren();
    if (NO_REPORTS) {
      // The website without online reports: reports are shared only through local hubs.
      syncEl.append(icon("warning", 13), ` ${t("reports.site_note")}`);
      $("report-list").replaceChildren();
      onChange?.([]);
      return;
    }
    const msgs = ONLINE ? { up: "rep.online", copy: "rep.copy_from_online", none: "rep.no_online_yet" }
      : { up: "rep.connected", copy: "rep.copy_from", none: "rep.no_hub_yet" };
    if (hubUp) syncEl.append(icon("check", 13), ` ${t(msgs.up)}`);
    else if (cache.synced_at) syncEl.append(icon("warning", 13), ` ${t(msgs.copy, { age: fmtAge(Math.floor((Date.now() - cache.synced_at) / 60000)) })}`);
    else syncEl.append(icon("warning", 13), ` ${t(msgs.none)}`);
    if (outbox.length) syncEl.append(document.createElement("br"), t("rep.waiting", { n: outbox.length }));

    const ul = $("report-list");
    ul.replaceChildren();
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "fac-empty";
      li.textContent = t("rep.none");
      ul.append(li);
    }
    for (const r of list) {
      const k = REPORT_KINDS[r.kind];
      const li = document.createElement("li");
      li.className = "report" + (r.pending ? " pending" : "");
      li.dataset.id = r.id;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "fac";
      const info = document.createElement("span");
      const name = document.createElement("div");
      name.className = "fac-name";
      name.textContent = `${k.label} · ${where(r)}`;
      const meta = document.createElement("div");
      meta.className = `fac-meta trust-${r.pending ? "pending" : r.trust}`;
      meta.textContent = trustLine(r);
      info.append(name, meta);
      row.append(reportImg(r.kind, k.color, 26), info);
      row.addEventListener("click", () => getMapApi()?.flyTo(r.lat, r.lng));
      li.append(row);
      if (!r.pending) {
        const actions = document.createElement("div");
        actions.className = "report-actions";
        actions.append(
          smallBtn(r.confirms ? t("rep.still_true_n", { n: r.confirms }) : t("rep.still_true"), "thumbsUp", () => vote(r, "confirm"), votes[r.id] === "confirm"),
          smallBtn(r.disputes ? t("rep.not_true_n", { n: r.disputes }) : t("rep.not_true"), "thumbsDown", () => vote(r, "dispute"), votes[r.id] === "dispute"),
        );
        if (pin) {
          if (r.trust !== "verified") actions.append(smallBtn(t("rep.verify"), "check", () => responderAction(r, "verify")));
          actions.append(smallBtn(t("rep.remove"), "close", () => responderAction(r, "remove")));
        }
        li.append(actions);
      }
      ul.append(li);
    }
    onChange?.(list);
  }

  // Bring a report into view in the list (from a tap on its map marker).
  function reveal(id) {
    showTab("reports");
    const li = [...document.querySelectorAll("#report-list li.report")].find((x) => x.dataset.id === id);
    if (!li) return;
    li.scrollIntoView({ block: "nearest" });
    li.classList.remove("flash");
    void li.offsetWidth; // restart the highlight animation
    li.classList.add("flash");
  }

  // Short lines for a place's card, e.g. "Evacuation center full · unverified · 40 min ago".
  function forPlace(id) {
    return current().filter((r) => r.location_id === id).map((r) => `${REPORT_KINDS[r.kind].label} · ${trustLine(r)}`);
  }

  $("report-new").addEventListener("click", openChooser);
  if (NO_REPORTS) for (const id of ["report-new", "responder-btn"]) $(id).hidden = true;
  if (ONLINE) {
    // Personal accounts instead of the hub PIN, and reports shared over the internet.
    for (const el of [$("responder-name"), document.querySelector('label[for="responder-name"]')]) el.hidden = false;
    Object.assign($("responder-pin"), { placeholder: t("reports.password_ph"), autocomplete: "current-password", inputMode: "text", maxLength: 100 });
    document.querySelector('label[for="responder-pin"]').textContent = t("reports.password_label");
    document.querySelector('#responder-form button[type="submit"]').textContent = t("reports.login");
    document.querySelector('[data-i18n="reports.note"]').textContent = t("reports.note_online");
  }
  // After the caller has its handle on us (render calls back into it).
  queueMicrotask(() => (pin ? setPin(pin) : render()));

  return { sync, setHubUp, render, reveal, openChooser, snapshot, forPlace, current, isHubUp: () => hubUp };
}
