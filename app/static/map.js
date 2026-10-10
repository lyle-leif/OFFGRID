// Offline map: MapLibre + a local PMTiles extract. Every URL resolves to this server.
// Facilities are WebGL layers (hundreds of points stay smooth): small dots when zoomed
// out, map pins with an icon per type from zoom 12. Light and dark map styles; our own
// layers (facilities, situation reports, route, GPS accuracy) are re-added whenever the style changes.
/* global maplibregl, pmtiles */
import { loadPinImage, loadReportImage } from "./icons.js";
import { REPORT_KINDS } from "./report-kinds.js";
import { icon } from "./ui-icons.js";

export const TYPE_STYLE = {
  evacuation_center: { color: "#4cae4f", label: "Evacuation center" },
  hospital: { color: "#e5484d", label: "Hospital" },
  health_center: { color: "#d6336c", label: "Clinic / health center" },
  rescue: { color: "#7048e8", label: "Rescue / DRRM" },
  fire_station: { color: "#f76707", label: "Fire station" },
  police: { color: "#3b82f6", label: "Police" },
  pharmacy: { color: "#0ca5a5", label: "Pharmacy" },
  town_hall: { color: "#475569", label: "Town / city hall" },
  barangay_hall: { color: "#8b95a1", label: "Barangay hall" },
  market: { color: "#c08a16", label: "Market / grocery" },
  drinking_water: { color: "#15aabf", label: "Drinking water" },
  relief_point: { color: "#f59f00", label: "Relief point" },
};

// Types hidden until the user turns them on (many points, less urgent).
export const DEFAULT_OFF = new Set(["barangay_hall", "market"]);

export function typeStyle(type) {
  return TYPE_STYLE[type] ?? { color: "#495057", label: type };
}

const COLOR_EXPR = ["match", ["get", "type"], ...Object.entries(TYPE_STYLE).flatMap(([k, v]) => [k, v.color]), "#495057"];
const PIN_ZOOM = 12; // below this, dots; from here, pins
const PIN_SCALE = 2; // pins are rasterized at 2x for sharp edges
// The pin's tip sits 4px above the bottom of its 56px image (the shadow is below it);
// shift down by that much so the tip, not the image edge, marks the spot.
const PIN_OFFSET = [0, 4];

// Colours of our own layers in each theme.
const THEME = {
  light: { label: "#1d232a", halo: "#ffffff", casing: "#ffffff", route: "#1c7ed6", dotStroke: "#ffffff", disc: "#f8fafc" },
  // Matches the Apple-style dark map: white labels with soft dark halos, white-ringed dots
  // and Apple's bright location blue for the route so both pop on teal land.
  dark: { label: "#ffffff", halo: "#1b2b3a", casing: "#1b2b3a", route: "#3b9bff", dotStroke: "#ffffff", disc: "#f1f5f9" },
};

async function loadStyle(theme) {
  const url = theme === "dark" ? "/map/style-dark.json" : "/map/style.json";
  const style = await (await fetch(url)).json();
  const origin = window.location.origin;
  style.glyphs = origin + style.glyphs;
  style.sprite = origin + style.sprite;
  style.sources.protomaps.url = `pmtiles://${origin}/map/area.pmtiles`;
  return style;
}

// A circle polygon (for the GPS accuracy ring), radius in metres.
function circle(lng, lat, radius, steps = 48) {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_540;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + (radius * Math.cos(a)) / kx, lat + (radius * Math.sin(a)) / ky]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

const EMPTY = { type: "FeatureCollection", features: [] };

// The area covered by the offline map tiles, roads and facilities: all of Batangas.
// Must match BBOX in tools/overpass.py and the --bbox used for area.pmtiles.
const BOUNDS = [[120.55, 13.45], [121.5, 14.2]]; // [[west, south], [east, north]]
// Is this position inside the area the map covers?
export const inBounds = ({ lat, lng }) => lng >= BOUNDS[0][0] && lng <= BOUNDS[1][0] && lat >= BOUNDS[0][1] && lat <= BOUNDS[1][1];

// Web Mercator x/y in "world units" (0..1) for a lng/lat.
const mercX = (lng) => (lng + 180) / 360;
const mercY = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

const lngOf = (x) => x * 360 - 180;
const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

// The lowest zoom at which BOUNDS still *covers* a w×h pixel box, so zooming out stops
// before any area without data (empty or black) can appear.
function coverZoom(w, h) {
  const spanX = mercX(BOUNDS[1][0]) - mercX(BOUNDS[0][0]);
  const spanY = mercY(BOUNDS[0][1]) - mercY(BOUNDS[1][1]);
  // At zoom z the world is 512 * 2^z pixels wide.
  const zx = Math.log2(w / (spanX * 512));
  const zy = Math.log2(h / (spanY * 512));
  return Math.max(zx, zy) + 0.01; // a hair more, so rounding never shows an edge
}

// Apple-style compass: a slim red/grey needle with an N that turns with the map. It only
// appears while the map is rotated; tap (or Enter) to face north again, and it fades away.
class CompassControl {
  onAdd(map) {
    this._map = map;
    const box = document.createElement("div");
    box.className = "maplibregl-ctrl offgrid-compass-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "offgrid-compass";
    btn.setAttribute("aria-label", "Compass: tap to face north");
    btn.title = "Tap to face north (rotate the map with right-drag, Ctrl-drag or two fingers)";
    btn.innerHTML = `
      <svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true">
        <g class="cmp-dial">
          <text x="20" y="10.2" text-anchor="middle" class="cmp-n">N</text>
          <path d="M20 11.6 23.4 20h-6.8z" class="cmp-north"/>
          <path d="M20 28.4 16.6 20h6.8z" class="cmp-south"/>
          <circle cx="20" cy="20" r="1.5" class="cmp-pivot"/>
        </g>
      </svg>`;
    this._dial = btn.querySelector(".cmp-dial");
    btn.addEventListener("click", () => map.easeTo({ bearing: 0, duration: 500 }));
    this._update = () => {
      const bearing = map.getBearing();
      this._dial.setAttribute("transform", `rotate(${-bearing} 20 20)`);
      const rotated = Math.abs(bearing) > 0.5;
      btn.classList.toggle("rotated", rotated);
      // Hidden north-up: keep it out of the tab order and away from screen readers.
      btn.tabIndex = rotated ? 0 : -1;
      btn.setAttribute("aria-hidden", String(!rotated));
    };
    map.on("rotate", this._update);
    this._update();
    box.append(btn);
    this._box = box;
    return box;
  }

  onRemove() {
    this._map.off("rotate", this._update);
    this._box.remove();
  }
}

// "Show my location" button under the zoom buttons (same action as the Use GPS button).
class LocateControl {
  constructor(onLocate) { this._onLocate = onLocate; }
  onAdd() {
    const box = document.createElement("div");
    box.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "offgrid-locate";
    btn.setAttribute("aria-label", "Show my location");
    btn.title = "Show my location (GPS)";
    btn.append(icon("gps", 18));
    btn.addEventListener("click", () => this._onLocate());
    this._btn = btn;
    box.append(btn);
    this._box = box;
    return box;
  }
  onRemove() { this._box.remove(); }
  setBusy(busy) { this._btn?.classList.toggle("busy", busy); }
}

export async function createMap(container, { onSelect, onReport, onLoad, onReady, onUserMove, onManualMove, onLocate, theme = "light" }) {
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  let currentTheme = theme;
  const el = typeof container === "string" ? document.getElementById(container) : container;
  const map = new maplibregl.Map({
    container: el,
    style: await loadStyle(theme),
    bounds: [[120.95, 13.72], [121.18, 13.96]], // start on Batangas City – Lipa
    // Panning stops at the edge of the data; minZoom keeps the data filling the panel.
    maxBounds: BOUNDS,
    minZoom: coverZoom(el.clientWidth || 1, el.clientHeight || 1),
    maxZoom: 19,
    // Sharper map: render at least 2x (supersampled on 1x laptop screens) with
    // anti-aliased edges. Phones keep their own 2-3x.
    pixelRatio: Math.min(3, Math.max(2, window.devicePixelRatio || 1)),
    antialias: true,
    // Rotation on (right-drag / Ctrl-drag, two fingers), tilt off: the view stays flat.
    maxPitch: 0,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: { compact: true },
  });
  // Open the app with ?debug to inspect the map from the browser console (window.__map).
  if (new URLSearchParams(window.location.search).has("debug")) window.__map = map;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  const locateCtl = onLocate ? new LocateControl(onLocate) : null;
  if (locateCtl) map.addControl(locateCtl, "top-right");
  map.addControl(new CompassControl(), "top-right");

  // The panel floats over the map, so camera moves keep their target in the part of the
  // map you can see (app.js sets this from the card width / sheet height).
  let viewPadding = { top: 60, right: 30, bottom: 30, left: 30 };
  // For fitBounds: MapLibre adds the map's own padding (left there by easeTo/flyTo with
  // `padding`) to the padding it is given, and silently does nothing if the sum doesn't fit
  // (a phone's half sheet did that to every route). So give it only what is still missing.
  const padBy = (extra) => {
    const has = map.getPadding();
    return Object.fromEntries(Object.entries(viewPadding).map(([k, v]) => [k, Math.max(0, v + extra - (has[k] ?? 0))]));
  };
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

  // Keep every corner of the view inside the data, even when the map is rotated.
  // MapLibre keeps the *unrotated* w×h box inside maxBounds, so for a rotated view we
  // (1) raise minZoom so the rotated view's bounding box fits the data, and (2) shrink
  // maxBounds by how far the rotated corners reach beyond the unrotated box.
  let constraining = false;
  let lastBoundsKey = "";
  function fitConstraints() {
    if (constraining) return; // setMinZoom/setMaxBounds can fire zoom events themselves
    constraining = true;
    try { applyConstraints(); } finally { constraining = false; }
  }
  function applyConstraints() {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    const b = (map.getBearing() * Math.PI) / 180;
    const cos = Math.abs(Math.cos(b));
    const sin = Math.abs(Math.sin(b));
    const rw = w * cos + h * sin;
    const rh = w * sin + h * cos;
    const minZ = coverZoom(rw, rh);
    if (Math.abs(map.getMinZoom() - minZ) > 1e-3) map.setMinZoom(minZ);
    const world = 512 * 2 ** Math.max(map.getZoom(), minZ);
    const dx = (rw - w) / 2 / world;
    const dy = (rh - h) / 2 / world;
    const bounds = [
      [lngOf(mercX(BOUNDS[0][0]) + dx), latOf(mercY(BOUNDS[0][1]) - dy)],
      [lngOf(mercX(BOUNDS[1][0]) - dx), latOf(mercY(BOUNDS[1][1]) + dy)],
    ];
    const key = bounds.flat().map((v) => v.toFixed(6)).join(",");
    if (key !== lastBoundsKey) {
      lastBoundsKey = key;
      map.setMaxBounds(bounds);
    }
  }
  // Window resizes, phone rotation and panel changes alter the size; rotating and
  // zooming change how far the rotated corners reach. It's a few multiplications, so it
  // runs on every event (not deferred to an animation frame, which a hidden page skips).
  map.on("resize", fitConstraints);
  map.on("rotate", fitConstraints);
  map.on("zoom", fitConstraints);

  // Everything we draw, kept so it can be re-added after a style (theme) change.
  const byId = new Map();
  let locations = null;
  let routeCoords = null;
  let accuracy = null; // { lat, lng, radius }
  let selectedId = "";
  let visibleFilter = null;
  let reports = []; // [{id, kind, lat, lng, fresh}]
  let me = null;
  let pickHandler = null;
  let generation = 0;

  async function addOverlays() {
    const gen = ++generation;
    const c = THEME[currentTheme];
    if (!map.getSource("accuracy")) map.addSource("accuracy", { type: "geojson", data: EMPTY });
    if (!map.getSource("route")) map.addSource("route", { type: "geojson", data: EMPTY });
    if (!map.getLayer("accuracy-fill")) {
      map.addLayer({ id: "accuracy-fill", type: "fill", source: "accuracy", paint: { "fill-color": "#1c7ed6", "fill-opacity": 0.12 } });
      map.addLayer({ id: "accuracy-line", type: "line", source: "accuracy", paint: { "line-color": "#1c7ed6", "line-opacity": 0.4, "line-width": 1 } });
      map.addLayer({
        id: "route-casing", type: "line", source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": c.casing, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 12] },
      });
      map.addLayer({
        id: "route-line", type: "line", source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": c.route, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 7] },
      });
    }
    renderRoute();
    renderAccuracy();

    // One pin image per facility type (with the disc colour of the current theme) and one
    // marker per report kind.
    const types = locations ? [...new Set(locations.map((l) => l.type))] : [];
    const kinds = Object.keys(REPORT_KINDS);
    const [imgs, reportImgs] = await Promise.all([
      Promise.all(types.map((t) => loadPinImage(t, typeStyle(t).color, PIN_SCALE, c.disc))),
      Promise.all(kinds.map((k) => loadReportImage(k, REPORT_KINDS[k].color, PIN_SCALE))),
    ]);
    if (gen !== generation) return; // the theme changed again while images loaded
    types.forEach((t, i) => {
      if (map.hasImage(`pin-${t}`)) map.removeImage(`pin-${t}`);
      map.addImage(`pin-${t}`, imgs[i], { pixelRatio: PIN_SCALE });
    });
    kinds.forEach((k, i) => {
      if (!map.hasImage(`report-${k}`)) map.addImage(`report-${k}`, reportImgs[i], { pixelRatio: PIN_SCALE });
    });

    // Reports sit above facility pins: they are what changed in the last few hours.
    if (!map.getSource("reports")) map.addSource("reports", { type: "geojson", data: reportsGeo() });
    if (!map.getLayer("reports")) {
      map.addLayer({
        id: "reports", type: "symbol", source: "reports",
        layout: {
          "icon-image": ["concat", "report-", ["get", "kind"]],
          "icon-anchor": "bottom",
          "icon-offset": [0, 2],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.55, 14, 0.8, 17, 1],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        // Older than half their lifetime, or not sent to the hub yet: faded.
        paint: { "icon-opacity": ["case", ["get", "fresh"], 1, 0.55] },
      });
    }
    if (!locations) return;
    const below = map.getLayer("reports") ? "reports" : undefined;

    if (!map.getSource("facilities")) {
      map.addSource("facilities", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: locations.map((l) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [l.lng, l.lat] },
            properties: { id: l.id, type: l.type, name: l.name },
          })),
        },
      });
    }
    if (!map.getLayer("facilities")) {
      // Zoomed out: small dots, so 500+ facilities don't turn into a pile of pins.
      map.addLayer({
        id: "facility-dots", type: "circle", source: "facilities", maxzoom: PIN_ZOOM,
        paint: {
          "circle-color": COLOR_EXPR,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.5, PIN_ZOOM, 5.5],
          "circle-stroke-color": c.dotStroke,
          "circle-stroke-width": 1.2,
        },
      }, below);
      // Zoomed in: map pins with an icon per type, named once there's room.
      map.addLayer({
        id: "facilities", type: "symbol", source: "facilities", minzoom: PIN_ZOOM,
        layout: {
          "icon-image": ["concat", "pin-", ["get", "type"]],
          "icon-anchor": "bottom",
          "icon-offset": PIN_OFFSET,
          "icon-size": ["interpolate", ["linear"], ["zoom"], PIN_ZOOM, 0.62, 15, 0.85, 17, 1],
          "icon-allow-overlap": true,
          // Most important types are drawn on top when pins overlap.
          "symbol-sort-key": ["match", ["get", "type"],
            "evacuation_center", 0, "hospital", 1, "rescue", 2, "fire_station", 3, "police", 4, "health_center", 5, 10],
          "symbol-z-order": "source",
          "text-field": ["step", ["zoom"], "", 14.5, ["get", "name"]],
          "text-font": ["Noto Sans Medium"],
          "text-size": 11,
          "text-anchor": "top",
          "text-offset": [0, 0.35],
          "text-max-width": 9,
          "text-optional": true,
        },
        paint: { "text-color": c.label, "text-halo-color": c.halo, "text-halo-width": 1.5 },
      }, below);
      map.addLayer({
        id: "facility-selected", type: "symbol", source: "facilities",
        filter: ["==", ["get", "id"], selectedId],
        layout: {
          "icon-image": ["concat", "pin-", ["get", "type"]],
          "icon-anchor": "bottom",
          "icon-offset": PIN_OFFSET,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 15, 1.15, 17, 1.3],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      }, below);
    }
    if (visibleFilter) applyFilter();
  }

  // Delegated layer listeners live on the map, so they survive style changes.
  for (const layer of ["facility-dots", "facilities", "facility-selected"]) {
    map.on("click", layer, (e) => {
      if (pickHandler) return; // choosing "my location" takes priority
      if (map.getLayer("reports") && map.queryRenderedFeatures(e.point, { layers: ["reports"] }).length) return;
      const id = e.features[0]?.properties.id;
      if (byId.has(id)) onSelect(byId.get(id));
    });
    map.on("mouseenter", layer, () => { if (!pickHandler) map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { if (!pickHandler) map.getCanvas().style.cursor = ""; });
  }
  map.on("click", "reports", (e) => {
    if (pickHandler) return;
    const id = e.features[0]?.properties.id;
    if (id) onReport?.(id);
  });
  map.on("mouseenter", "reports", () => { if (!pickHandler) map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "reports", () => { if (!pickHandler) map.getCanvas().style.cursor = ""; });
  // A drag or wheel by the user (not our own easeTo) pauses GPS follow mode.
  map.on("dragstart", () => onManualMove?.());
  map.on("wheel", () => onManualMove?.());

  map.on("style.load", () => { addOverlays(); });
  const loaded = new Promise((resolve) => map.once("load", resolve));
  loaded.then(() => onLoad?.());
  // Ready to be seen: the first tiles are drawn (the first "idle"), or 1.5 s after load at most.
  loaded.then(() => {
    let done = false;
    const ready = () => { if (!done) { done = true; onReady?.(); } };
    map.once("idle", ready);
    setTimeout(ready, 1500);
  });

  async function setLocations(locs) {
    locations = locs;
    for (const l of locs) byId.set(l.id, l);
    await loaded;
    await addOverlays();
  }

  async function setTheme(theme) {
    if (theme === currentTheme) return;
    currentTheme = theme;
    map.setStyle(await loadStyle(theme), { diff: false }); // style.load re-adds our layers
  }

  function highlight(id) {
    selectedId = id ?? "";
    if (map.getLayer("facility-selected")) map.setFilter("facility-selected", ["==", ["get", "id"], selectedId]);
    const loc = byId.get(id);
    if (loc) map.easeTo({ center: [loc.lng, loc.lat], zoom: Math.max(map.getZoom(), 14), padding: viewPadding });
  }

  function applyFilter() {
    const f = ["in", ["get", "id"], ["literal", [...visibleFilter]]];
    for (const layer of ["facility-dots", "facilities"]) if (map.getLayer(layer)) map.setFilter(layer, f);
  }

  // Show only facilities whose id is in `visibleIds`.
  function filter(visibleIds) {
    visibleFilter = visibleIds;
    applyFilter();
  }

  let meCone = null;

  function setUserPosition(pos) {
    if (!pos) { me?.remove(); me = null; meCone = null; setAccuracy(null); return; }
    if (!me) {
      // The blue dot plus a direction cone. Rotation is aligned to the map, so the cone
      // keeps pointing the real way you face when the map is rotated.
      const el = document.createElement("div");
      el.className = "me";
      meCone = document.createElement("div");
      meCone.className = "me-cone";
      meCone.hidden = true;
      const dot = document.createElement("div");
      dot.className = "me-marker";
      dot.title = "Your position (drag to move)";
      el.append(meCone, dot);
      me = new maplibregl.Marker({ element: el, draggable: true, rotationAlignment: "map", pitchAlignment: "map" })
        .setLngLat([pos.lng, pos.lat]).addTo(map);
      me.on("dragend", () => {
        const p = me.getLngLat();
        setAccuracy(null); // a hand-placed position has no GPS accuracy
        onUserMove?.({ lat: p.lat, lng: p.lng });
      });
    } else {
      me.setLngLat([pos.lng, pos.lat]);
    }
  }

  function renderAccuracy() {
    const src = map.getSource("accuracy");
    if (!src) return;
    src.setData(accuracy ? { type: "FeatureCollection", features: [circle(accuracy.lng, accuracy.lat, accuracy.radius)] } : EMPTY);
  }

  // Which way the user faces, in degrees clockwise from north; null hides the cone.
  function setHeading(deg) {
    if (!me || !meCone) return;
    if (deg == null || Number.isNaN(deg)) {
      meCone.hidden = true;
      return;
    }
    meCone.hidden = false;
    me.setRotation(deg);
  }

  // GPS accuracy ring around the blue dot; null hides it.
  function setAccuracy(acc) {
    accuracy = acc;
    renderAccuracy();
  }

  // Keep the user in view while following GPS.
  function follow(pos) {
    map.easeTo({ center: [pos.lng, pos.lat], zoom: Math.max(map.getZoom(), 16), duration: 800, padding: viewPadding });
  }

  // One-shot "click the map to set a position" mode.
  function pickPosition(callback) {
    if (pickHandler) map.off("click", pickHandler);
    map.getCanvas().style.cursor = "crosshair";
    pickHandler = (e) => {
      map.getCanvas().style.cursor = "";
      pickHandler = null;
      callback({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.once("click", pickHandler);
  }

  function cancelPick() {
    if (pickHandler) map.off("click", pickHandler);
    pickHandler = null;
    map.getCanvas().style.cursor = "";
  }

  function fitTo(locs) {
    if (!locs.length) return;
    const b = new maplibregl.LngLatBounds();
    for (const l of locs) b.extend([l.lng, l.lat]);
    map.fitBounds(b, { padding: padBy(30), maxZoom: 15, duration: 600 });
  }

  function reportsGeo() {
    return {
      type: "FeatureCollection",
      features: reports.map((r) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        properties: { id: r.id, kind: r.kind, fresh: Boolean(r.fresh) },
      })),
    };
  }

  // Situation reports to draw: [{id, kind, lat, lng, fresh}].
  function setReports(list) {
    reports = list ?? [];
    map.getSource("reports")?.setData(reportsGeo());
  }

  function flyTo(lat, lng, zoom = 16, duration = 600) {
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), zoom), duration, padding: viewPadding });
  }

  // After a GPS fix: fly to the user. If the fix is rough, show its whole accuracy circle.
  function zoomTo(pos, accuracy = 0) {
    if (accuracy > 150) {
      const b = new maplibregl.LngLatBounds();
      for (const c of circle(pos.lng, pos.lat, accuracy).geometry.coordinates[0]) b.extend(c);
      map.fitBounds(b, { padding: padBy(20), maxZoom: 16.5, duration: 1000 });
    } else {
      map.flyTo({ center: [pos.lng, pos.lat], zoom: Math.max(map.getZoom(), 16.5), padding: viewPadding, duration: 1200 });
    }
  }

  function setViewPadding(p) { viewPadding = p; }

  function renderRoute() {
    const src = map.getSource("route");
    if (!src) return;
    src.setData(routeCoords?.length
      ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: routeCoords }, properties: {} }] }
      : EMPTY);
  }

  async function showRoute(coords, { fit = true } = {}) {
    routeCoords = coords?.length ? coords : null;
    await loaded; // a route can arrive before the map has finished loading
    renderRoute();
    if (fit && routeCoords) {
      const b = new maplibregl.LngLatBounds();
      for (const c of routeCoords) b.extend(c);
      map.fitBounds(b, { padding: padBy(40), maxZoom: 16, duration: 600 });
    }
  }

  return {
    map, setLocations, setTheme, highlight, filter, setUserPosition, setAccuracy, setHeading, follow,
    pickPosition, cancelPick, fitTo, showRoute, setReports, flyTo, zoomTo, setViewPadding,
    setLocateBusy: (busy) => locateCtl?.setBusy(busy),
  };
}
