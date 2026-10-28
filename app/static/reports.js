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
import { hasWord, MAX_NOTE } from "./offline/notes.js";
import { reportImg } from "./icons.js";
import { icon, iconLabel } from "./ui-icons.js";

const KEYS = { device: "bb.device", outbox: "bb.reports.outbox", cache: "bb.reports.cache", votes: "bb.reports.votes" };
const TIMEOUT_MS = 5000;
const CENTER_PICK_M = 300; // a "center full/open" pin snaps to an evacuation center this close
const ONLINE = Boolean(SITE && CLOUD); // the website with online reports
const NO_REPORTS = SITE && !CLOUD; // the website without them: reports need a hub
const TOKEN_KEY = ONLINE ? "bb.token" : "bb.pin";
const NOTICE_KEY = "bb.note_notice"; // the one-time "who reads notes" notice was shown
const GPS_FIX = { maxAcc: 50, maxAgeMs: 60_000, timeoutMs: 30_000 }; // "Nandito ako": good enough to say "on site"

// The one-tap details per kind and the danger words (pack/report_*.json), loaded once.
let formData = null;
const loadFormData = () => (formData ??= Promise.all(["pack/report_details.json", "pack/report_words.json"]
  .map((f) => fetch(url(f)).then((r) => r.json()))).then(([details, words]) => ({ details, words }))
  .catch(() => ({ details: {}, words: { danger: [] } })));

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

// getFix(options) -> { fix: {lat, lng, acc} } or { error: "off" | "weak" | "outside" }: one GPS fix for "Nandito ako".
export function createReports({ getMapApi, getPos, getSelected, getLocations, pickOnMap, cancelPick, showTab, onChange, snapRoad, getFix }) {
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
        details: o.details ?? [], note: o.note ?? null, on_site: Boolean(o.on_site), acc_bucket: o.on_site ? o.acc_bucket ?? null : null,
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
        // Responders also get the notes still waiting for their approval.
        const res = await fetchJSON("api/reports", pin ? { headers: authHeaders() } : {});
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
  // `extra`: what the form adds (details, note, on_site, acc_bucket).
  function queue(kind, pos, loc = null, road = null, extra = {}) {
    const o = { id: randomId(), kind, lat: loc ? loc.lat : pos.lat, lng: loc ? loc.lng : pos.lng, location_id: loc?.id ?? null, created: Date.now(), ...extra };
    if (road) Object.assign(o, { edge_id: road.edge_id, road_name: road.road_name });
    outbox.push(o);
    saveOutbox();
    if (hubUp) message(t("rep.sending"), false, "sending");
    else message(t(ONLINE ? "rep.saved_outbox_online" : "rep.saved_outbox"));
    render();
    sync().then(() => { if (!outbox.some((x) => x.id === o.id) && $("report-msg").dataset.msg === "sending") message(t("rep.sent")); });
  }

  const isCenter = (l) => l && (l.type === "evacuation_center" || (l.also ?? []).includes("evacuation_center"));

  // Put the report where it was marked: on an evacuation center (center kinds), on the road
  // (road kinds; the online reports have no road network, so this phone snaps it), or as is.
  // Returns false (with a message) when there's nothing suitable there.
  async function place(kind, pos, extra, onSite) {
    if (CENTER_KINDS.has(kind)) {
      const loc = nearestCenter(pos);
      if (!loc) { message(t(onSite ? "rep.no_center_here" : "rep.no_center"), true); return false; }
      queue(kind, pos, loc, null, extra);
    } else if (ROAD_KINDS.has(kind)) {
      const road = await snapRoad?.(pos.lat, pos.lng); // null: no road within 60 m; undefined: no road data here
      if (road === null || (ONLINE && !road)) { message(t(onSite ? "rep.no_road_here" : "apierr.pin_on_road"), true); return false; }
      queue(kind, road ? road.point : pos, null, road ?? null, extra);
    } else {
      queue(kind, pos, null, null, extra);
    }
    return true;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // The report form: one-tap details, "Ano ang nakikita mo?", then where: "Nandito ako" by GPS,
  // or a tap on the map (or the evacuation center that is open on screen).
  async function choose(kind) {
    const box = $("report-kinds");
    const { details, words } = await loadFormData();
    const k = REPORT_KINDS[kind];
    const form = el("div", "report-form");
    form.dataset.kind = kind;
    const head = el("p", "report-form-head");
    head.append(reportImg(kind, k.color, 24), el("span", null, k.label));
    form.append(head);

    const picked = new Set();
    const chipIds = details[kind] ?? [];
    if (chipIds.length) {
      form.append(el("p", "report-form-label", t("rep.form_details")));
      const chips = el("div", "rep-chips");
      for (const id of chipIds) {
        const b = el("button", "rep-chip", t(`detail.${id}`));
        b.type = "button";
        b.dataset.detail = id;
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => {
          if (picked.has(id)) picked.delete(id);
          else if (picked.size < 2) picked.add(id);
          for (const c of chips.children) c.setAttribute("aria-pressed", String(picked.has(c.dataset.detail)));
        });
        chips.append(b);
      }
      form.append(chips);
    }

    const required = kind === "other";
    const label = el("label", "report-form-label", t(required ? "rep.form_note" : "rep.form_note_optional"));
    label.htmlFor = "report-note";
    const note = el("textarea", "report-note");
    Object.assign(note, { id: "report-note", rows: 2, maxLength: MAX_NOTE, placeholder: t("rep.form_note_ph") });
    const count = el("span", "report-note-count", t("rep.chars", { n: 0 }));
    const hint = el("p", "report-form-hint", t("rep.form_note_hint"));
    hint.append(" ", count);
    const notice = el("p", "report-notice", t("rep.note_notice"));
    notice.hidden = true;
    const danger = el("div", "report-danger");
    danger.setAttribute("role", "alert");
    danger.hidden = true;
    const call = el("a", "btn report-danger-call", t("rep.danger_call"));
    call.href = "tel:911";
    danger.append(el("span", null, t("rep.danger")), call);
    note.addEventListener("focus", () => {
      let seen = null;
      try { seen = localStorage.getItem(NOTICE_KEY); } catch { /* no storage */ }
      if (!seen) {
        notice.hidden = false;
        try { localStorage.setItem(NOTICE_KEY, "1"); } catch { /* no storage */ }
      }
    });
    note.addEventListener("input", () => {
      count.textContent = t("rep.chars", { n: note.value.length });
      danger.hidden = !hasWord(note.value, words.danger ?? []); // a warning only: sending is still allowed
    });
    form.append(label, note, hint, notice, danger);

    const extra = (onSite, acc = null) => ({
      details: [...picked], note: note.value.trim() || null, on_site: onSite, acc_bucket: onSite ? (acc <= 20 ? 20 : 50) : null,
    });
    const ready = () => {
      if (required && !note.value.trim()) { message(t("rep.form_note_required"), true); note.focus(); return false; }
      return true;
    };
    const done = () => { box.hidden = true; };

    form.append(el("p", "report-form-label", t("rep.form_where")));
    const where = el("div", "report-where");
    const sel = getSelected();
    if (CENTER_KINDS.has(kind) && isCenter(sel)) {
      // The evacuation center open on screen is the place.
      const send = el("button", "btn", t("rep.send_for", { name: sel.name }));
      send.type = "button";
      send.dataset.where = "selected";
      send.addEventListener("click", () => { if (ready()) { done(); queue(kind, sel, sel, null, extra(false)); } });
      where.append(send);
    }
    if (getFix) {
      const gps = el("button", "btn", t("rep.where_gps"));
      gps.type = "button";
      gps.dataset.where = "gps";
      gps.addEventListener("click", async () => {
        if (!ready()) return;
        message(t("rep.gps_wait"));
        gps.disabled = true;
        const r = await getFix(GPS_FIX);
        gps.disabled = false;
        if (!r.fix) {
          message(t(r.error === "off" ? "rep.gps_off" : r.error === "outside" ? "gps.outside" : "rep.gps_weak"), true);
          return; // the form stays open: "Markahan sa mapa" is right there
        }
        if (await place(kind, r.fix, extra(true, r.fix.acc), true)) done();
      });
      where.append(gps);
    }
    const map = el("button", `btn${getFix ? " secondary" : ""}`, t("rep.where_map"));
    map.type = "button";
    map.dataset.where = "map";
    map.addEventListener("click", () => {
      if (!ready()) return;
      const pickHint = t(CENTER_KINDS.has(kind) ? "rep.hint_center" : ROAD_KINDS.has(kind) ? "rep.hint_road" : "rep.hint_any");
      const data = extra(false);
      done();
      message(pickHint);
      pickOnMap(pickHint, (pos) => place(kind, pos, data, false));
    });
    where.append(map);
    form.append(where);

    const cancel = el("button", "link-btn", t("rep.cancel"));
    cancel.type = "button";
    cancel.addEventListener("click", () => { done(); message(null); cancelPick(); });
    form.append(cancel);
    box.replaceChildren(form);
    box.hidden = false;
    message(null);
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

  async function noteAction(r, action) {
    try {
      const res = await fetchJSON(`api/reports/${encodeURIComponent(r.id)}/note`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ action }),
      });
      if (!res.ok) message(detail(res, t("rep.not_allowed")), true);
      if (res.status === 401 || res.status === 403) setPin(null);
    } catch {
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
      // Reports v2: the one-tap details, how it was placed, and an approved note.
      const chips = (r.details ?? []).map((d) => t(`detail.${d}`));
      const badge = el("div", `rep-badge${r.on_site ? " on-site" : ""}`, [...chips, t(r.on_site ? "rep.on_site" : "rep.marked")].join(" · "));
      info.append(badge);
      if (r.note && !r.pending) {
        const status = r.note_status ?? "approved"; // the public only ever gets approved notes
        const key = status === "pending" ? "rep.note_pending" : status === "hidden" ? "rep.note_hidden" : "rep.said";
        const n = el("div", `rep-note note-${status}`, t(key, { note: r.note }));
        if (r.flagged && status !== "approved") n.append(" ", el("span", "rep-flag", `(${t("rep.flagged")})`));
        info.append(n);
      }
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
          if (r.note && r.note_status !== "approved") actions.append(smallBtn(t("rep.approve_note"), "check", () => noteAction(r, "approve")));
          if (r.note && r.note_status !== "hidden") actions.append(smallBtn(t("rep.hide_note"), "close", () => noteAction(r, "hide")));
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
