// Directions: fetch an offline road route, draw it, list the steps, and follow the user.
//
// Moving the blue dot by hand recomputes the route. With GPS tracking, each fix is checked
// against the current route in the browser: on the route we only update progress (next
// turn, remaining distance); we ask the server for a new route only when the user has
// really left it, so GPS jitter doesn't make the route flicker.
//
// Routes steer around roads people reported flooded or blocked (situation reports), unless
// the user turns that off; a new or expired road report recomputes the route.

import { getLang, t } from "./i18n.js";
import { icon, iconLabel } from "./ui-icons.js";

const $ = (id) => document.getElementById(id);

const BAD_ACCURACY_M = 100; // once we've had a better fix, ignore fixes worse than this
const ON_ROUTE_M = 30; // within this (or the GPS accuracy) of the line counts as on route
const ARRIVE_M = 25;
const REFRESH_MS = 60_000; // re-check the route at most this often while on it
const OFF_ROUTE_FIXES = 2; // consecutive off-route fixes before rerouting

function fmtM(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function meters(a, b) {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return Math.hypot((a.lng - b.lng) * 111_320 * Math.cos(lat), (a.lat - b.lat) * 110_540);
}

// Route geometry helpers. coords are [lng, lat] pairs.
function buildLine(coords) {
  const pts = coords.map(([lng, lat]) => ({ lat, lng }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + meters(pts[i - 1], pts[i]));
  return { pts, cum, total: cum[cum.length - 1] };
}

// Closest point on the line to `p`: distance from the line and distance along it.
function project(line, p, fromIdx = 0) {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110_540;
  let best = { dist: Infinity, along: 0, idx: 0 };
  for (let i = Math.max(0, fromIdx); i < line.pts.length - 1; i++) {
    const a = line.pts[i], b = line.pts[i + 1];
    const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
    const dx = (b.lng - a.lng) * kx, dy = (b.lat - a.lat) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.dist) best = { dist: d, along: line.cum[i] + t * (line.cum[i + 1] - line.cum[i]), idx: i };
  }
  return best;
}

export function createDirections({ getMapApi, getPlace, getPos, setPos, requestPosition, onTracking, onGpsHeading, brain, getPlaceById }) {
  let mode = "walk";
  let active = null; // { placeId, name }
  let route = null; // last route from the server
  let line = null; // its geometry, for progress
  let stepAlong = []; // where each step starts along the line
  let watchId = null;
  let follow = true;
  let bestAccuracy = Infinity;
  let lastFix = null;
  let offRouteCount = 0;
  let pending = null;
  let lastRequest = 0;
  let requestSeq = 0;
  let status = ""; // tracking status line text
  let avoidReports = true;
  let roadReportsKey = "";

  try { mode = localStorage.getItem("bb.mode") === "drive" ? "drive" : "walk"; } catch { /* no storage */ }
  try { avoidReports = localStorage.getItem("bb.avoidReports") !== "off"; } catch { /* no storage */ }

  function renderMode() {
    document.querySelectorAll(".mode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  }

  function render(r) {
    route = r;
    line = buildLine(r.coords);
    // Steps are in order along the route, so search forward from the previous one.
    stepAlong = [];
    let from = 0;
    for (const s of r.steps) {
      const pr = project(line, { lat: s.lat, lng: s.lng }, from);
      stepAlong.push(pr.along);
      from = pr.idx;
    }
    iconLabel($("route-summary"), r.mode === "walk" ? "walk" : "car",
      t(r.mode === "walk" ? "route.summary_walk" : "route.summary_drive", { d: fmtM(r.distance_m), min: r.duration_min }));
    const ol = $("route-steps");
    ol.replaceChildren();
    for (const s of r.steps) {
      const li = document.createElement("li");
      li.append(s.instruction);
      if (s.distance_m) {
        const d = document.createElement("span");
        d.className = "dist";
        d.textContent = ` · ${fmtM(s.distance_m)}`;
        li.append(d);
      }
      ol.append(li);
    }
    $("route-next").hidden = true;
    $("route-card").hidden = false;
    renderReports(r);
    renderTracking();
  }

  // What the route did about reported flooded or blocked roads.
  function renderReports(r) {
    const p = $("route-reports");
    const avoided = r?.avoided_reports?.length ?? 0;
    const through = r?.through_reports?.length ?? 0;
    p.replaceChildren();
    p.classList.toggle("warn", through > 0);
    p.hidden = !avoided && !through;
    if (avoided) p.append(icon("check", 14), ` ${t("route.around", { n: avoided })}`);
    if (through) {
      if (avoided) p.append(document.createElement("br"));
      p.append(icon("warning", 14), ` ${t(avoidReports ? "route.no_way" : "route.uses", { n: through })}`);
    }
  }

  function renderTracking() {
    const p = $("route-tracking");
    p.replaceChildren();
    const btn = (text, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "link-btn";
      b.textContent = text;
      b.addEventListener("click", fn);
      return b;
    };
    if (watchId !== null) {
      p.append(icon("signal", 14), ` ${status || t("route.following")} `);
      if (!follow) p.append(btn(t("route.recenter"), () => { follow = true; if (getPos()) getMapApi()?.follow(getPos()); renderTracking(); }), " · ");
      p.append(btn(t("route.stop"), stopTracking));
      return;
    }
    p.append(`${t("route.drag")} `);
    if ("geolocation" in navigator && window.isSecureContext) p.append(btn(t("route.track"), startTracking));
  }

  function showError(msg) {
    route = null;
    line = null;
    $("route-card").hidden = false;
    $("route-next").hidden = true;
    $("route-summary").textContent = t("route.none");
    renderReports(null);
    const ol = $("route-steps");
    ol.replaceChildren();
    const li = document.createElement("li");
    li.className = "route-error";
    li.textContent = msg;
    ol.append(li);
    getMapApi()?.showRoute(null);
  }

  async function fetchRoute({ fit = true } = {}) {
    const pos = getPos();
    if (!active || !pos) return;
    const seq = ++requestSeq; // only the newest request may update the screen
    lastRequest = Date.now();
    const q = new URLSearchParams({ from_lat: pos.lat, from_lng: pos.lng, to_id: active.placeId, mode,
      avoid_reports: String(avoidReports), lang: getLang() });
    try {
      let body;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const resp = await fetch(`/api/route?${q}`, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
        body = await resp.json();
        if (seq !== requestSeq) return;
        if (!resp.ok) throw new Error(typeof body.detail === "string" ? body.detail : t("route.compute_failed"));
      } catch (netErr) {
        // No hub: route on this phone with the saved road network.
        if (!(netErr instanceof TypeError || netErr.name === "AbortError") || !brain) throw netErr;
        const place = getPlaceById?.(active.placeId);
        if (!place) throw netErr;
        body = await brain.route(pos.lat, pos.lng, place, mode, avoidReports, getLang());
        if (seq !== requestSeq) return;
      }
      if (!active || active.placeId !== body.to_id) return; // cleared or changed meanwhile
      active.name = body.to_name;
      offRouteCount = 0;
      getMapApi()?.showRoute(body.coords, { fit });
      render(body);
      if (watchId !== null && lastFix) updateProgress(lastFix);
    } catch (err) {
      if (seq !== requestSeq) return;
      showError(err instanceof TypeError ? t("route.no_hub_data") : err.message);
    }
  }

  // Highlight the current step and show the next turn, from the position on the route.
  function updateProgress(fix) {
    if (!line || !route) return;
    const tolerance = Math.max(ON_ROUTE_M, fix.accuracy ?? 0);
    const dest = line.pts[line.pts.length - 1];
    if (meters(fix, dest) <= Math.max(ARRIVE_M, Math.min(fix.accuracy ?? 0, 60))) {
      arrived();
      return;
    }
    const pr = project(line, fix);
    if (pr.dist > tolerance) {
      offRouteCount += 1;
      status = t("route.off_by", { d: fmtM(pr.dist) });
      renderTracking();
      if (offRouteCount >= OFF_ROUTE_FIXES) {
        status = t("route.off");
        renderTracking();
        fetchRoute({ fit: false });
      }
      return;
    }
    offRouteCount = 0;
    let cur = 0;
    for (let i = 0; i < stepAlong.length; i++) if (stepAlong[i] <= pr.along + 5) cur = i;
    const items = $("route-steps").children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle("done", i < cur);
      items[i].classList.toggle("current", i === cur);
    }
    items[cur]?.scrollIntoView({ block: "nearest" });
    const remaining = Math.max(0, line.total - pr.along);
    const mins = Math.max(1, Math.round((route.duration_min * remaining) / Math.max(line.total, 1)));
    const next = route.steps[cur + 1];
    const banner = $("route-next");
    banner.hidden = false;
    banner.textContent = next
      ? t("route.next", { step: next.instruction, d: fmtM(Math.max(0, stepAlong[cur + 1] - pr.along)), left: fmtM(remaining), min: mins })
      : t("route.left", { left: fmtM(remaining) });
    status = t("route.following_acc", { m: Math.round(fix.accuracy ?? 0) });
    renderTracking();
    if (Date.now() - lastRequest > REFRESH_MS) fetchRoute({ fit: false });
  }

  function arrived() {
    const name = active?.name ?? t("step.dest_default");
    stopTracking();
    const banner = $("route-next");
    banner.hidden = false;
    iconLabel(banner, "check", t("route.arrived", { name }), 16);
    const items = $("route-steps").children;
    for (const li of items) { li.classList.add("done"); li.classList.remove("current"); }
  }

  function onFix(p) {
    const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
    // Once we've had a decent fix, ignore coarse ones (e.g. Wi-Fi guesses of ±500 m).
    if (fix.accuracy > BAD_ACCURACY_M && bestAccuracy <= BAD_ACCURACY_M) return;
    bestAccuracy = Math.min(bestAccuracy, fix.accuracy);
    // Small movements within the GPS error are jitter, not walking.
    if (lastFix && meters(lastFix, fix) < Math.max(10, fix.accuracy / 2)) return;
    lastFix = fix;
    // GPS course over ground (only meaningful while moving) feeds the direction cone.
    if (typeof p.coords.heading === "number" && !Number.isNaN(p.coords.heading) && (p.coords.speed ?? 1) > 0.5) {
      onGpsHeading?.(p.coords.heading);
    }
    setPos({ lat: fix.lat, lng: fix.lng }, { fromGps: true, accuracy: fix.accuracy });
    if (follow) getMapApi()?.follow(fix);
    if (!active) return;
    if (!route) fetchRoute({ fit: false });
    else updateProgress(fix);
  }

  function onGpsError(err) {
    if (err.code !== err.PERMISSION_DENIED) {
      // Timeout or no fix yet: keep watching. Phones without Wi-Fi need a while for the
      // satellites, and the signal may come back outdoors.
      status = t(lastFix ? "route.gps_lost" : "route.gps_wait_wifi");
      renderTracking();
      return;
    }
    stopTracking();
    $("route-tracking").textContent = t(/iPhone|iPad|iPod/.test(navigator.userAgent) ? "route.denied_ios" : "route.denied");
  }

  function startTracking() {
    if (!("geolocation" in navigator)) return;
    onTracking?.(true); // start the compass from this tap (iOS asks for permission)
    follow = true;
    bestAccuracy = Infinity;
    lastFix = null;
    status = t("route.gps_wait");
    watchId = navigator.geolocation.watchPosition(onFix, onGpsError,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    renderTracking();
  }

  function stopTracking() {
    if (watchId !== null) onTracking?.(false);
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    status = "";
    getMapApi()?.setAccuracy(null);
    renderTracking();
  }

  // Start directions to the selected place, asking for a position first if needed.
  function start() {
    const place = getPlace();
    if (!place) return;
    active = { placeId: place.id, name: place.name };
    if (!getPos()) {
      requestPosition(); // the position callback calls positionChanged()
      $("route-card").hidden = false;
      $("route-next").hidden = true;
      $("route-summary").textContent = t("route.set_pos");
      $("route-steps").replaceChildren();
      $("route-tracking").textContent = t("route.click_map");
      return;
    }
    fetchRoute();
  }

  // The user moved the blue dot by hand (or set it on the map): recompute right away.
  function positionChanged() {
    if (!active) return;
    clearTimeout(pending);
    pending = setTimeout(() => fetchRoute({ fit: true }), 0);
  }

  // The user dragged or zoomed the map: stop recentering on them until they ask.
  function manualMove() {
    if (watchId !== null && follow) {
      follow = false;
      renderTracking();
    }
  }

  function clear() {
    active = null;
    route = null;
    line = null;
    requestSeq++; // drop any route still on its way
    clearTimeout(pending);
    stopTracking();
    $("route-card").hidden = true;
    getMapApi()?.showRoute(null);
  }

  // A route that arrived through the chat ("paano pumunta dito?").
  function showFromChat(r) {
    active = { placeId: r.to_id, name: r.to_name };
    mode = r.mode;
    renderMode();
    getMapApi()?.showRoute(r.coords);
    render(r);
  }

  document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => {
    mode = b.dataset.mode;
    try { localStorage.setItem("bb.mode", mode); } catch { /* no storage */ }
    renderMode();
    if (active) fetchRoute();
  }));
  $("route-clear").addEventListener("click", clear);
  renderMode();

  const avoidBox = $("route-avoid");
  avoidBox.checked = avoidReports;
  avoidBox.addEventListener("change", () => {
    avoidReports = avoidBox.checked;
    try { localStorage.setItem("bb.avoidReports", avoidReports ? "on" : "off"); } catch { /* no storage */ }
    if (active) fetchRoute({ fit: false });
  });

  // The list of reports changed (new sync, new post, expiry): if the set of reported roads
  // is different, recompute the route on screen.
  function reportsChanged(list) {
    const key = list.filter((r) => r.edge_id != null && !r.pending && (r.kind === "road_flooded" || r.kind === "road_blocked"))
      .map((r) => r.id).sort().join(",");
    if (key === roadReportsKey) return;
    roadReportsKey = key;
    if (active && getPos()) fetchRoute({ fit: false });
  }

  return {
    start, clear, positionChanged, manualMove, showFromChat, reportsChanged,
    getMode: () => mode, isActiveFor: (id) => active?.placeId === id,
  };
}
