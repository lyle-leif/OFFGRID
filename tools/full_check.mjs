// Full-app check: drives the real app the way a person would, on an iPhone-sized screen and a
// laptop, and prints PASS/FAIL per check. Run from the project root (Ollama optional):
//   node tools/full_check.mjs
// - Its own server (port 8767, throwaway reports database, PIN 424242), internet blocked.
// - Real taps at each control's centre (touch start/end, or mouse on the laptop). Before every tap it
//   checks that the control is on screen and not covered (elementFromPoint), so a hidden or
//   overlapped button fails instead of being "clicked" by script.
// - Fake GPS: navigator.geolocation is replaced by a scripted stub (slow, rough-then-fine,
//   denied, no signal, outside the map) so every path of "Use GPS" can be checked.
// - Hub off, the phone's outbox, the update path and console errors are checked too.
// - Language: the first-run picker, Settings, and the app in Tagalog (with and without the hub).

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8767;
const DEBUG_PORT = 9350;
const BASE = `http://127.0.0.1:${PORT}`;
const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PY = process.env.PYTHON ?? ".venv\\Scripts\\python.exe";
const PHONE = { width: 393, height: 852, deviceScaleFactor: 2, mobile: true };
const LAPTOP = { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false };
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const HOME = { lat: 13.7672, lng: 121.066 }; // near Batangas Medical Center
const FLOOD_AT = { lat: 13.7565, lng: 121.0583 }; // P. Burgos Street, Batangas City
const MANILA = { lat: 14.5995, lng: 120.9842 }; // outside the map
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -  ${String(detail).replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
  return !!ok;
}

// ---- the server ----------------------------------------------------------------
const reportsDir = mkdtempSync(join(tmpdir(), "offgrid-full-reports-"));
let server = null;
async function startServer() {
  server = spawn(PY, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(PORT)], {
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, BB_REPORTS_DB: join(reportsDir, "reports.db"), BB_RESPONDER_PIN: "424242" },
  });
  await waitUntil(async () => (await fetch(`${BASE}/api/health`)).ok, 120000, "server");
}
async function stopServer() {
  server?.kill();
  await waitUntil(async () => { try { await fetch(`${BASE}/api/health`); return false; } catch { return true; } }, 15000, "server to stop");
}
async function waitUntil(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

// ---- the browser ---------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "offgrid-full-edge-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "about:blank"], { stdio: "ignore" });

// Scripted GPS, installed before the app's own code runs.
const FAKE_GPS = `(() => {
  const watchers = new Map();
  let next = 1;
  let plan = [];
  window.__gps = { set(steps) { plan = steps; }, active: () => watchers.size };
  const E = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
  function run(ok, err, once) {
    const id = next++;
    const timers = plan.map((s) => setTimeout(() => {
      if (!watchers.has(id)) return;
      if (s.error) err?.({ code: s.error, message: "fake", ...E });
      else ok({ coords: { latitude: s.lat, longitude: s.lng, accuracy: s.acc, heading: null, speed: null, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() });
      if (once) watchers.delete(id);
    }, s.after));
    watchers.set(id, timers);
    return id;
  }
  const geo = {
    getCurrentPosition: (ok, err) => { run(ok, err, true); },
    watchPosition: (ok, err) => run(ok, err, false),
    clearWatch: (id) => { (watchers.get(id) || []).forEach(clearTimeout); watchers.delete(id); },
  };
  Object.defineProperty(Navigator.prototype, "geolocation", { get: () => geo, configurable: true });
})();`;

const consoleErrors = [];
async function open(url, metrics, { phone = false } = {}) {
  const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const tag = phone ? "phone" : "laptop";
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(`${tag}: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(`${tag}: console.error ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
    }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result?.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", metrics);
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  if (phone) {
    await send("Emulation.setUserAgentOverride", { userAgent: IPHONE_UA, platform: "iPhone" });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_GPS });
  await send("Page.navigate", { url });
  return { send, evaluate, phone, close: () => ws.close() };
}
const js = (page, code) => page.evaluate(`(async () => { ${code} })()`);
const waitFor = (page, expr, ms, what) => waitUntil(() => page.evaluate(expr), ms, what);

// Where is this control, and can a finger reach it? Returns { x, y } or { problem }.
async function reach(page, selector) {
  return page.evaluate(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => {
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    });
    const el = els[0];
    if (!el) return { problem: "not found or not visible" };
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { problem: "off screen at " + Math.round(x) + "," + Math.round(y) };
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === el || el.contains(hit))) {
      const who = hit ? (hit.id ? "#" + hit.id : hit.className || hit.tagName) : "nothing";
      return { problem: "covered by " + who };
    }
    return { x, y };
  })()`);
}
// Tap (phone) or click (laptop) a control like a person would.
async function tap(page, selector, name = selector) {
  const at = await reach(page, selector);
  if (at.problem) return check(`can tap ${name}`, false, at.problem);
  await pointAt(page, at.x, at.y);
  return true;
}
async function pointAt(page, x, y) {
  if (page.phone) {
    // A finger: touch down and up. (Input.synthesizeTapGesture gives no click or focus in
    // headless Edge, so it can't stand in for a real tap.)
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(60);
    await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  await sleep(250);
}
// Tap the map at a place (projected to the screen).
async function tapMapAt(page, pos) {
  const p = await page.evaluate(`(() => { const m = window.__map; const r = m.getContainer().getBoundingClientRect();
    const pt = m.project([${pos.lng}, ${pos.lat}]); return { x: r.left + pt.x, y: r.top + pt.y }; })()`);
  await pointAt(page, p.x, p.y);
}
async function typeInto(page, selector, text) {
  if (!(await tap(page, selector))) return false;
  await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ""; el.dispatchEvent(new Event("input")); return true; })()`);
  await page.send("Input.insertText", { text });
  await sleep(150);
  return true;
}
// Drag with one finger (phone) from a control's centre by dy pixels over `ms`.
async function drag(page, selector, dy, ms) {
  const at = await reach(page, selector);
  if (at.problem) return check(`can drag ${selector}`, false, at.problem);
  const steps = 8;
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y }] });
  for (let i = 1; i <= steps; i++) {
    await sleep(ms / steps);
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: at.x, y: at.y + (dy * i) / steps }] });
  }
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(500);
  return true;
}
// Ask through the chat box; returns the answer's text.
async function ask(page, question) {
  const before = await page.evaluate("document.querySelectorAll('#messages .msg.bot').length");
  // Like a person: go to the Assistant tab first if the chat box isn't showing.
  if ((await reach(page, "#question")).problem) await tap(page, "#tab-chat", "Assistant tab");
  if (!(await typeInto(page, "#question", question))) return "";
  if (!(await tap(page, "#send", "send button"))) return "";
  await waitFor(page, `document.querySelectorAll('#messages .msg.bot').length > ${before} && !document.getElementById('send').disabled`, 90000, `answer to "${question}"`);
  await sleep(300);
  await page.evaluate("document.activeElement?.blur(), true");
  return page.evaluate("[...document.querySelectorAll('#messages .msg.bot')].pop().innerText");
}
const sheetState = (page) => page.evaluate(`(() => { const s = document.getElementById('side-panel'); const h = s.getBoundingClientRect().height;
  const H = document.querySelector('.layout').clientHeight; return s.classList.contains('peek') ? 'peek' : h > H * 0.75 ? 'full' : 'half'; })()`);
async function sheetTo(page, want) {
  await js(page, `const h = document.getElementById('sheet-handle');
    const key = (k) => h.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowDown'); key('ArrowDown'); for (let i = 0; i < ${["peek", "half", "full"].indexOf(want)}; i++) key('ArrowUp'); return true;`);
  await sleep(600);
}
const userPos = (page) => page.evaluate("JSON.parse(localStorage.getItem('bb.userPos') || 'null')");
const ringRadius = (page) => page.evaluate(`(() => { const d = window.__map.getSource('accuracy')?.serialize?.().data;
  const ring = d?.features?.[0]?.geometry?.coordinates?.[0]; if (!ring) return 0;
  const [lng, lat] = ring[0]; const c = d.features[0]; let sx = 0, sy = 0; for (const p of ring) { sx += p[0]; sy += p[1]; }
  const cx = sx / ring.length, cy = sy / ring.length; const kx = 111320 * Math.cos(cy * Math.PI / 180);
  return Math.round(Math.hypot((lng - cx) * kx, (lat - cy) * 110540)); })()`);
const gpsBusy = (page) => page.evaluate("document.getElementById('use-gps').classList.contains('busy')");
const gpsMsg = (page) => page.evaluate("document.getElementById('gps-msg').hidden ? '' : document.getElementById('gps-msg').innerText");
const near = (a, b, m = 30) => a && b && Math.hypot((a.lng - b.lng) * 108000, (a.lat - b.lat) * 110540) < m;

// =================================================================================
try {
  await startServer();
  await waitUntil(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(), 30000, "Edge");

  // ---------------- phone: launch ----------------
  const phone = await open(`${BASE}/?debug`, PHONE, { phone: true });
  await waitFor(phone, "document.readyState !== 'loading' && !!document.getElementById('splash')", 30000, "splash");
  check("phone: launch screen shows first", await phone.evaluate("!document.getElementById('splash').classList.contains('gone')"));
  // First run: the app asks for the language before anything else (the checks below read English).
  await waitFor(phone, "!document.getElementById('lang-picker').hidden", 15000, "language picker").catch(() => {});
  check("phone: first run asks Tagalog or English", await phone.evaluate(
    "!document.getElementById('lang-picker').hidden && document.querySelectorAll('#lang-picker-choices button').length === 2"));
  await tap(phone, '#lang-picker-choices button[lang="en"]', "English");
  check("phone: the language choice is kept", (await phone.evaluate("localStorage.getItem('bb.lang')")) === "en"
    && (await phone.evaluate("document.getElementById('lang-picker').hidden")));
  await waitFor(phone, "!document.getElementById('splash')", 15000, "splash to clear").catch(() => {});
  check("phone: launch screen clears once the map is drawn", await phone.evaluate("!document.getElementById('splash')"));
  check("phone: panel starts lowered (peek)", (await sheetState(phone)) === "peek");
  // The map's own stylesheet must be the real file, saved with the app (once it was a one-line
  // link to the internet, and with no internet the map went blank and its buttons fell apart).
  const css = await phone.evaluate(`(() => { const s = [...document.styleSheets].find((x) => (x.href || '').includes('maplibre-gl.css'));
    let rules = 0; try { rules = s.cssRules.length; } catch { /* unreadable */ } return { rules, imports: [...(s?.cssRules ?? [])].filter((r) => r.type === 3).length }; })()`);
  check("phone: map stylesheet is the real file (no internet needed)", css.rules > 100 && css.imports === 0, JSON.stringify(css));
  check("phone: page fits the screen (nothing spills below)", await phone.evaluate("document.scrollingElement.scrollHeight <= innerHeight + 1"),
    await phone.evaluate("document.scrollingElement.scrollHeight + ' / ' + innerHeight"));
  check("phone: map controls are styled", await phone.evaluate("getComputedStyle(document.querySelector('.maplibregl-ctrl-top-right')).position === 'absolute'"));
  await js(phone, `localStorage.setItem('bb.userPos', JSON.stringify(${JSON.stringify(HOME)})); localStorage.setItem('bb.saver', 'off'); return true;`);
  // The offline copy (needed later for the hub-off checks).
  await waitFor(phone, "(document.getElementById('offline-copy')||{}).textContent?.includes('Saved on this phone')", 300000, "offline copy");
  check("phone: offline copy saved", true);
  await phone.send("Page.reload", {});
  await waitFor(phone, "!!(window.__map && window.__map.loaded()) && !document.getElementById('splash')", 60000, "phone map");
  await sleep(1000);

  // ---------------- phone: the bottom sheet by touch ----------------
  await drag(phone, "#sheet-handle", -320, 500);
  const afterUp = await sheetState(phone);
  check("phone: dragging the handle up raises the panel", afterUp === "half" || afterUp === "full", afterUp);
  await drag(phone, "#sheet-handle", -500, 120);
  check("phone: flicking up opens it fully", (await sheetState(phone)) === "full", await sheetState(phone));
  await drag(phone, "#sheet-handle", 700, 120);
  check("phone: flicking down lowers it", (await sheetState(phone)) !== "full", await sheetState(phone));
  for (const h of ["half", "full"]) {
    await sheetTo(phone, h);
    await tap(phone, "#tab-chat", "Assistant tab");
    const fits = await phone.evaluate(`(() => { const q = document.getElementById('question').getBoundingClientRect();
      const s = document.getElementById('side-panel').getBoundingClientRect(); return q.height > 0 && q.bottom <= s.bottom + 1 && q.bottom <= innerHeight; })()`);
    check(`phone: chat box fully visible with the panel ${h}`, fits);
  }
  await sheetTo(phone, "half");
  await tap(phone, "#question", "chat box");
  check("phone: typing opens the panel fully (keyboard room)", (await sheetState(phone)) === "full");
  await phone.evaluate("document.activeElement?.blur(), true");

  // ---------------- phone: assistant ----------------
  const guide = await ask(phone, "how do i stop bleding");
  check("phone: typo'd guide question answered", guide.includes("Bleeding"), guide.split("\n")[1]);
  const fil = await ask(phone, "saan ang pinakamalapit na ospital?");
  check("phone: Filipino nearest hospital, by road", fil.includes("by road"), fil.split("\n")[1]);
  // Follow-up about a place: pick the nearest one (its Show button), then ask how to get there.
  await sheetTo(phone, "full");
  await js(phone, `const b = [...document.querySelectorAll('#messages .msg.bot')].pop().querySelector('.place-result .btn.secondary'); if (b) b.id = 'show-btn'; return !!b;`);
  await tap(phone, "#show-btn", "Show (first nearest result)");
  await js(phone, "document.getElementById('show-btn')?.removeAttribute('id'); return true;");
  await sleep(800);
  await tap(phone, "#tab-chat", "Assistant tab");
  const follow = await ask(phone, "how do I get there?");
  check("phone: follow-up gives directions to the chosen place", /Walking route|Driving route/i.test(follow), follow.split("\n")[0]);
  await sheetTo(phone, "full");
  if (await phone.evaluate("!document.getElementById('place').hidden")) await tap(phone, "#place-close", "close place");
  await tap(phone, "#tab-chat", "Assistant tab");
  const nope = await ask(phone, "how do I bake a chocolate cake?");
  check("phone: says when the guides don't cover it", /can't find this in the saved/i.test(nope), nope.split("\n")[0]);
  await sheetTo(phone, "full");
  if (await tap(phone, "#new-topic", "New topic")) {
    check("phone: New topic starts a fresh topic", await phone.evaluate(
      "!!document.querySelector('#messages .topic-break') && document.getElementById('new-topic').hidden"));
  }
  await tap(phone, "#battery-saver", "Battery saver");
  check("phone: battery saver turns on", (await phone.evaluate("document.getElementById('battery-saver').getAttribute('aria-pressed')")) === "true");
  const saver = await ask(phone, "is it safe to walk through floodwater?");
  check("phone: battery saver answers without the AI", saver.includes("Flood") && !saver.includes("AI summary"), saver.split("\n")[1]);
  await sheetTo(phone, "full");
  await tap(phone, "#battery-saver", "Battery saver");

  // ---------------- phone: map buttons ----------------
  await sheetTo(phone, "peek");
  const z0 = await phone.evaluate("window.__map.getZoom()");
  await tap(phone, ".maplibregl-ctrl-zoom-in", "zoom in");
  await sleep(700);
  check("phone: zoom in", (await phone.evaluate("window.__map.getZoom()")) > z0 + 0.5);
  await tap(phone, ".maplibregl-ctrl-zoom-out", "zoom out");
  await sleep(700);
  // Legend with the longest list: switch on barangay halls and markets first (Places chips).
  const chip = async (label) => {
    await js(phone, `const b = [...document.querySelectorAll('#fac-filters button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (b) b.id = 'chip-btn'; return !!b;`);
    await tap(phone, "#chip-btn", `chip ${label}`);
    await js(phone, "document.getElementById('chip-btn')?.removeAttribute('id'); return true;");
  };
  await tap(phone, "#tab-list", "Places tab");
  await sheetTo(phone, "full");
  await chip("Barangay hall");
  await chip("Market / grocery");
  await sheetTo(phone, "peek");
  await tap(phone, "#legend-toggle", "Legend");
  check("phone: legend opens", await phone.evaluate("!document.getElementById('legend').hidden"));
  const legendFit = await phone.evaluate(`(() => { const box = document.getElementById('legend'); const b = box.getBoundingClientRect();
    const out = [...box.querySelectorAll('li')].filter((li) => { const r = li.getBoundingClientRect(); return r.left < b.left - 0.5 || r.right > b.right + 0.5; })
      .map((li) => li.textContent);
    const spill = [...box.querySelectorAll('li span')].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent);
    return { items: box.querySelectorAll('li').length, out, spill, scroll: box.scrollWidth <= box.clientWidth, inScreen: b.right <= innerWidth }; })()`);
  check("phone: legend text stays inside its box", legendFit.items >= 10 && !legendFit.out.length && !legendFit.spill.length && legendFit.scroll && legendFit.inScreen,
    JSON.stringify(legendFit));
  await tap(phone, "#legend-toggle", "Legend");
  check("phone: legend closes", await phone.evaluate("document.getElementById('legend').hidden"));
  await tap(phone, "#tab-list", "Places tab");
  await sheetTo(phone, "full");
  await chip("Barangay hall");
  await chip("Market / grocery");
  await sheetTo(phone, "peek");
  await js(phone, "window.__map.setBearing(60); return true;");
  await sleep(500);
  if (await tap(phone, ".offgrid-compass", "compass")) {
    await sleep(900);
    check("phone: compass turns the map back to north", Math.abs(await phone.evaluate("window.__map.getBearing()")) < 1);
  }
  const theme0 = await phone.evaluate("document.documentElement.dataset.theme");
  await tap(phone, "#theme-toggle", "theme toggle");
  await sleep(1500);
  check("phone: theme toggle switches light/dark", (await phone.evaluate("document.documentElement.dataset.theme")) !== theme0);
  await tap(phone, "#theme-toggle", "theme toggle");
  await sleep(1500);
  // Move my location: tap the button, then the map.
  await js(phone, `window.__map.jumpTo({ center: [${HOME.lng}, ${HOME.lat}], zoom: 15 }); return true;`);
  await sleep(600);
  await tap(phone, "#set-pos", "Move my location");
  check("phone: Move my location asks for a tap", await phone.evaluate("!document.getElementById('pos-hint').hidden"));
  const spot = { lat: HOME.lat + 0.002, lng: HOME.lng + 0.002 };
  await tapMapAt(phone, spot);
  await sleep(500);
  check("phone: tapping the map sets your position", near(await userPos(phone), spot, 40), JSON.stringify(await userPos(phone)));

  // ---------------- phone: GPS (fake satellites) ----------------
  const fixA = { lat: 13.7601, lng: 121.0612 };
  await js(phone, `window.__gps.set([{ after: 500, lat: ${fixA.lat}, lng: ${fixA.lng}, acc: 1500 }, { after: 2500, lat: ${fixA.lat}, lng: ${fixA.lng}, acc: 12 }]); return true;`);
  await tap(phone, "#use-gps", "Use GPS");
  await sleep(1300);
  check("phone GPS: a rough first fix shows right away", near(await userPos(phone), fixA) && (await ringRadius(phone)) > 1000, `ring ${await ringRadius(phone)} m`);
  check("phone GPS: keeps looking for a better fix", await gpsBusy(phone));
  await sleep(2200);
  check("phone GPS: refines to the good fix and stops", (await ringRadius(phone)) < 50 && !(await gpsBusy(phone)), `ring ${await ringRadius(phone)} m`);
  check("phone GPS: the blue dot is on the map", await phone.evaluate("!!document.querySelector('.me-marker')"));

  const fixB = { lat: 13.7550, lng: 121.0500 };
  await js(phone, `window.__gps.set([{ after: 25000, lat: ${fixB.lat}, lng: ${fixB.lng}, acc: 20 }]); return true;`);
  await tap(phone, "#use-gps", "Use GPS");
  await sleep(11500);
  check("phone GPS (Wi-Fi off, slow): explains the wait", (await gpsMsg(phone)).includes("Waiting for a GPS signal"), await gpsMsg(phone));
  check("phone GPS (slow): still looking", await gpsBusy(phone));
  await sleep(14500);
  check("phone GPS (slow): the late fix still lands", near(await userPos(phone), fixB) && !(await gpsBusy(phone)) && !(await gpsMsg(phone)));

  await js(phone, "window.__gps.set([{ after: 300, error: 1 }]); return true;");
  await tap(phone, "#use-gps", "Use GPS");
  await sleep(800);
  check("phone GPS (permission off): says how to turn it on", (await gpsMsg(phone)).includes("Location Services") && !(await gpsBusy(phone)), await gpsMsg(phone));
  await tap(phone, "#gps-msg-close", "message close");
  check("phone GPS: the message can be closed", !(await gpsMsg(phone)));

  const before = await userPos(phone);
  await js(phone, `window.__gps.set([{ after: 300, lat: ${MANILA.lat}, lng: ${MANILA.lng}, acc: 10 }]); return true;`);
  await tap(phone, "#use-gps", "Use GPS");
  await sleep(800);
  check("phone GPS (outside Batangas): explains, keeps the old position",
    (await gpsMsg(phone)).includes("outside the area") && near(await userPos(phone), before, 1), await gpsMsg(phone));
  await tap(phone, "#gps-msg-close", "message close");

  await js(phone, `window.__gps.set([{ after: 400, lat: ${fixA.lat}, lng: ${fixA.lng}, acc: 8 }]); return true;`);
  await tap(phone, ".offgrid-locate", "map locate button");
  await sleep(1000);
  check("phone GPS: the map's locate button works too", near(await userPos(phone), fixA) && !(await gpsBusy(phone)));

  await js(phone, "window.__gps.set([{ after: 2000, error: 2 }, { after: 5000, error: 3 }]); return true;");
  await tap(phone, "#use-gps", "Use GPS");
  await tap(phone, "#use-gps", "Use GPS (again, to stop)");
  check("phone GPS: a second tap stops looking", !(await gpsBusy(phone)));
  await tap(phone, "#use-gps", "Use GPS");
  console.log("      (waiting 90 s: no GPS signal at all)");
  await sleep(91500);
  check("phone GPS (no signal for 90 s): gives up with advice", (await gpsMsg(phone)).includes("No GPS signal") && !(await gpsBusy(phone)), await gpsMsg(phone));
  await tap(phone, "#gps-msg-close", "message close");
  await js(phone, `localStorage.setItem('bb.userPos', JSON.stringify(${JSON.stringify(HOME)})); return true;`);
  await phone.send("Page.reload", {});
  await waitFor(phone, "!!(window.__map && window.__map.loaded()) && !document.getElementById('splash')", 60000, "phone map");

  // ---------------- phone: places and directions ----------------
  await tap(phone, "#tab-list", "Places tab");
  await sheetTo(phone, "full");
  await typeInto(phone, "#fac-search", "Batangas State University");
  await sleep(400);
  check("phone: place search finds it", await phone.evaluate("[...document.querySelectorAll('#fac-list .fac')].some(b => b.textContent.includes('Batangas State University'))"));
  await typeInto(phone, "#fac-search", "");
  const count0 = await phone.evaluate("document.getElementById('fac-count').textContent");
  await tap(phone, "#fac-filters button", "a filter chip");
  await sleep(400);
  check("phone: filter chips change the list", (await phone.evaluate("document.getElementById('fac-count').textContent")) !== count0,
    `${count0} → ${await phone.evaluate("document.getElementById('fac-count').textContent")}`);
  await tap(phone, "#fac-filters button", "a filter chip");
  await typeInto(phone, "#fac-search", "Batangas State University");
  await sleep(400);
  await tap(phone, "#fac-list .fac", "the place");
  await sleep(1500);
  check("phone: opening a place shows its details", (await phone.evaluate("document.getElementById('place-name').textContent")).includes("Batangas State University"));
  await sheetTo(phone, "half");
  await tap(phone, "#place-route", "Directions");
  await waitFor(phone, "/km|m ·/.test(document.getElementById('route-summary')?.textContent ?? '')", 30000, "route");
  await sleep(1500);
  const fitted = await phone.evaluate(`(() => { const d = window.__map.getSource('route').serialize().data; const c = d.features[0].geometry.coordinates;
    const b = window.__map.getBounds(); return b.contains(c[0]) && b.contains(c[c.length - 1]); })()`);
  check("phone: walking route drawn and fitted on screen", fitted, await phone.evaluate("document.getElementById('route-summary').textContent"));
  await tap(phone, "[data-mode='drive']", "Drive");
  await waitFor(phone, "/Drive/.test(document.getElementById('route-summary').textContent)", 30000, "drive route");
  check("phone: driving route", true, await phone.evaluate("document.getElementById('route-summary').textContent"));
  await tap(phone, "[data-mode='walk']", "Walk");
  await waitFor(phone, "/Walk/.test(document.getElementById('route-summary').textContent)", 30000, "walk route");
  // Track with GPS along the route, then arrive.
  const route = await phone.evaluate("window.__map.getSource('route').serialize().data.features[0].geometry.coordinates");
  const mid = route[Math.floor(route.length / 2)], end = route[route.length - 1];
  await js(phone, `window.__gps.set([{ after: 500, lat: ${route[0][1]}, lng: ${route[0][0]}, acc: 8 },
    { after: 2500, lat: ${mid[1]}, lng: ${mid[0]}, acc: 8 }, { after: 4500, lat: ${end[1]}, lng: ${end[0]}, acc: 8 }]); return true;`);
  await sheetTo(phone, "full");
  const trackBtn = await phone.evaluate("(() => { const b = [...document.querySelectorAll('#route-card button')].find(x => x.textContent.includes('Track with GPS')); if (b) b.id = 'track-btn'; return !!b; })()");
  if (check("phone: Track with GPS offered", trackBtn)) {
    await tap(phone, "#track-btn", "Track with GPS");
    await sleep(3200);
    check("phone: tracking follows the GPS", /Following GPS|Next|left/i.test(await phone.evaluate("document.getElementById('route-card').innerText")));
    await sleep(3000);
    check("phone: arrival detected", (await phone.evaluate("document.getElementById('route-card').innerText")).includes("arrived"));
  }
  await sheetTo(phone, "full");
  await tap(phone, "#route-clear", "Clear route");
  check("phone: Clear route removes it", await phone.evaluate("!(window.__map.getSource('route').serialize().data.features||[]).length"));
  await tap(phone, "#place-close", "close place");

  // ---------------- phone: reports ----------------
  await js(phone, `window.__map.jumpTo({ center: [${FLOOD_AT.lng}, ${FLOOD_AT.lat}], zoom: 16.5 }); return true;`);
  const bsu = await phone.evaluate("(async () => (await (await fetch('/api/locations')).json()).find(l => l.id === 'osm-way-129493352'))()");
  const kinds = await phone.evaluate("(async () => Object.keys((await import('/report-kinds.js')).REPORT_KINDS))()");
  const offsets = { road_flooded: FLOOD_AT, road_blocked: { lat: FLOOD_AT.lat + 0.0006, lng: FLOOD_AT.lng }, water_available: { lat: FLOOD_AT.lat - 0.0008, lng: FLOOD_AT.lng + 0.0008 },
    power_out: { lat: FLOOD_AT.lat + 0.0008, lng: FLOOD_AT.lng - 0.0008 }, medical_need: { lat: FLOOD_AT.lat - 0.0005, lng: FLOOD_AT.lng - 0.0006 },
    center_full: bsu, center_open: bsu };
  for (const kind of kinds) {
    const at = offsets[kind];
    await js(phone, `window.__map.jumpTo({ center: [${at.lng}, ${at.lat}], zoom: 16.5 }); return true;`);
    await sleep(500);
    const n0 = await phone.evaluate("document.querySelectorAll('#report-list li.report:not(.pending)').length");
    await sheetTo(phone, "peek"); // a person lowers the panel to reach the map buttons
    await tap(phone, "#report-btn", "Report");
    const label = await phone.evaluate(`(async () => (await import('/report-kinds.js')).REPORT_KINDS[${JSON.stringify(kind)}].label)()`);
    await js(phone, `const b = [...document.querySelectorAll('#report-kinds .report-kind')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (b) b.id = 'kind-btn'; return !!b;`);
    await tap(phone, "#kind-btn", `kind "${label}"`);
    await js(phone, "document.getElementById('kind-btn')?.removeAttribute('id'); return true;");
    await sleep(400);
    // Re-centre (the sheet moved), then tap the spot.
    await js(phone, `window.__map.jumpTo({ center: [${at.lng}, ${at.lat}] }); return true;`);
    await sleep(400);
    await tapMapAt(phone, at);
    const ok = await waitUntil(() => phone.evaluate(`document.querySelectorAll('#report-list li.report:not(.pending)').length > ${n0}`), 15000, "report").catch(() => false);
    check(`phone: report "${label}" posted`, ok, await phone.evaluate("document.getElementById('report-msg').textContent"));
  }
  // Someone else's report: confirm it.
  const other = await (await fetch(`${BASE}/api/reports`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: crypto.randomUUID(), kind: "road_blocked", lat: 13.7579, lng: 121.0601, device: "full-check-other-phone" }) })).json();
  await waitFor(phone, `!!document.querySelector('#report-list li.report[data-id="${other.id}"]')`, 40000, "other phone's report");
  await sheetTo(phone, "full");
  await tap(phone, "#tab-reports", "Reports tab");
  await js(phone, `const li = document.querySelector('#report-list li.report[data-id="${other.id}"]'); const b = [...li.querySelectorAll('button')].find(x => x.textContent.includes('Still true')); b.id = 'confirm-btn'; return true;`);
  await tap(phone, "#confirm-btn", "Still true");
  await waitFor(phone, `(document.querySelector('#report-list li.report[data-id="${other.id}"]')?.innerText ?? '').includes('Still true (1)')`, 15000, "confirm").catch(() => {});
  check("phone: confirming a report counts", (await phone.evaluate(`document.querySelector('#report-list li.report[data-id="${other.id}"]').innerText`)).includes("Still true (1)"));
  // Responder: wrong PIN, then the right one; verify and remove.
  await tap(phone, "#responder-btn", "I'm a responder");
  await typeInto(phone, "#responder-pin", "000000");
  await tap(phone, "#responder-form button[type=submit]", "Unlock");
  await sleep(800);
  check("phone: a wrong responder PIN is refused", /wrong|pin/i.test(await phone.evaluate("document.getElementById('report-msg').textContent")), await phone.evaluate("document.getElementById('report-msg').textContent"));
  await typeInto(phone, "#responder-pin", "424242");
  await tap(phone, "#responder-form button[type=submit]", "Unlock");
  await sleep(800);
  check("phone: the right PIN turns on responder mode", (await phone.evaluate("document.getElementById('responder-btn').textContent")).includes("Responder mode on"));
  await js(phone, `const li = document.querySelector('#report-list li.report[data-id="${other.id}"]'); [...li.querySelectorAll('button')].find(x => x.textContent.trim() === 'Verify').id = 'verify-btn'; return true;`);
  await tap(phone, "#verify-btn", "Verify");
  await waitFor(phone, `(document.querySelector('#report-list li.report[data-id="${other.id}"]')?.innerText ?? '').includes('verified by a responder')`, 15000, "verify").catch(() => {});
  check("phone: responder verifies a report", (await phone.evaluate(`document.querySelector('#report-list li.report[data-id="${other.id}"]')?.innerText ?? ''`)).includes("verified by a responder"));
  await js(phone, `const li = document.querySelector('#report-list li.report[data-id="${other.id}"]'); [...li.querySelectorAll('button')].find(x => x.textContent.trim() === 'Remove').id = 'remove-btn'; return true;`);
  await tap(phone, "#remove-btn", "Remove");
  await waitFor(phone, `!document.querySelector('#report-list li.report[data-id="${other.id}"]')`, 15000, "remove").catch(() => {});
  check("phone: responder removes a report", await phone.evaluate(`!document.querySelector('#report-list li.report[data-id="${other.id}"]')`));
  await tap(phone, "#responder-btn", "responder off");

  // ---------------- phone: hotlines ----------------
  await tap(phone, "#tab-hotlines", "Hotlines tab");
  await sleep(500);
  const tel = await reach(phone, "#hotline-list a[href^='tel:']");
  check("phone: hotline numbers are tappable call links", !tel.problem && (await phone.evaluate("document.querySelectorAll(\"#hotline-list a[href^='tel:']\").length")) > 5, tel.problem);

  // ---------------- phone: hub off ----------------
  await stopServer();
  // Open the app again with no hub (from the phone's saved copy), back at home.
  await js(phone, `localStorage.setItem('bb.userPos', JSON.stringify(${JSON.stringify(HOME)})); return true;`);
  await phone.send("Page.reload", {});
  await waitFor(phone, "!!(window.__map && window.__map.loaded()) && !document.getElementById('splash')", 60000, "app with no hub");
  check("phone, hub off: the app opens from the saved copy", true);
  await sheetTo(phone, "half");
  const off = await ask(phone, "nearest evacuation center");
  check("phone, hub off: answers from the saved copy", off.includes("by road") && (await phone.evaluate("[...document.querySelectorAll('#messages .msg.bot')].pop().classList.contains('offline-answer')")), off.split("\n")[1]);
  check("phone, hub off: the pill says On this phone", (await phone.evaluate("document.getElementById('status-text').textContent")) === "On this phone");
  // Guide answers on the phone show whether each section was checked against an official source.
  await ask(phone, "what should i do during an earthquake");
  const trust = await phone.evaluate(`(() => { const t = [...document.querySelectorAll('#messages .msg.bot')].pop().querySelector('.passage .trust');
    return t ? t.textContent.trim() : ''; })()`);
  check("phone, hub off: guide sections show their official source", /Checked against DOST-PHIVOLCS/.test(trust), trust);
  await js(phone, `window.__map.jumpTo({ center: [${FLOOD_AT.lng}, ${FLOOD_AT.lat}], zoom: 16.5 }); return true;`);
  await sheetTo(phone, "peek");
  await tap(phone, "#report-btn", "Report");
  await js(phone, `[...document.querySelectorAll('#report-kinds .report-kind')].find(x => x.textContent.trim() === 'Power out').id = 'kind-btn'; return true;`);
  await tap(phone, "#kind-btn", "kind Power out");
  await js(phone, "document.getElementById('kind-btn')?.removeAttribute('id'); return true;");
  await js(phone, `window.__map.jumpTo({ center: [${FLOOD_AT.lng}, ${FLOOD_AT.lat}] }); return true;`);
  await sleep(400);
  await tapMapAt(phone, { lat: FLOOD_AT.lat + 0.0012, lng: FLOOD_AT.lng + 0.0012 });
  await sleep(800);
  check("phone, hub off: a report waits on the phone", await phone.evaluate("!!document.querySelector('#report-list li.report.pending')"));
  await tap(phone, "#tab-list", "Places tab");
  await typeInto(phone, "#fac-search", "Batangas State University");
  await sleep(400);
  await tap(phone, "#fac-list .fac", "the place");
  await sleep(1200);
  await sheetTo(phone, "half");
  await tap(phone, "#place-route", "Directions");
  const offRoute = await waitUntil(() => phone.evaluate("/km|m ·/.test(document.getElementById('route-summary')?.textContent ?? '')"), 40000, "offline route").catch(() => false);
  check("phone, hub off: directions computed on the phone", offRoute, await phone.evaluate("document.getElementById('route-summary')?.textContent ?? ''"));
  await startServer();
  const sent = await waitUntil(() => phone.evaluate("!document.querySelector('#report-list li.report.pending')"), 45000, "outbox sent").catch(() => false);
  check("phone: the waiting report is sent when the hub is back", sent);

  // ---------------- phone: Tagalog, chosen in Settings ----------------
  const RAW_KEY = /^(app|tab|chat|chip|route|rep|reports|status|pos|gps|place|list|ans|rans|step|kind|type|sum|label|err|settings|saver)\.[a-z0-9_.]+$/;
  const rawKeys = (page) => page.evaluate(`[...document.querySelectorAll('body *')].filter((e) => !e.children.length && ${RAW_KEY}.test(e.textContent.trim()))
    .map((e) => e.textContent.trim()).concat([...document.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap((e) => [e.getAttribute('aria-label'), e.title, e.placeholder])
    .filter((v) => v && ${RAW_KEY}.test(v)))`);
  const langTheme = await phone.evaluate("document.documentElement.dataset.theme");
  await js(phone, `localStorage.setItem('bb.userPos', JSON.stringify(${JSON.stringify(HOME)})); return true;`);
  await phone.send("Page.reload", {}); // nothing in progress, so changing the language asks nothing
  await waitFor(phone, "!!(window.__map && window.__map.loaded()) && !document.getElementById('splash')", 60000, "phone map");
  await tap(phone, "#settings-btn", "Settings");
  await sleep(400);
  check("phone: Settings opens with the language choice", await phone.evaluate("!document.getElementById('settings').hidden && document.querySelectorAll('#settings-langs input').length === 2"));
  await tap(phone, '.lang-option[lang="fil"]', "Tagalog in Settings");
  await waitFor(phone, "document.documentElement.lang === 'fil' && !!(window.__map && window.__map.loaded()) && !document.getElementById('splash')", 60000, "app in Tagalog").catch(() => {});
  check("phone: the app restarts in Tagalog", (await phone.evaluate("document.querySelector('#tab-list .tab-label').textContent")) === "Mga lugar"
    && (await phone.evaluate("document.getElementById('question').placeholder")).startsWith("Magtanong"));
  const raw = await rawKeys(phone);
  check("phone, Tagalog: no untranslated keys on screen", raw.length === 0, raw.slice(0, 5).join(", "));
  check("phone, Tagalog: page fits the screen", await phone.evaluate("document.scrollingElement.scrollWidth <= innerWidth && document.scrollingElement.scrollHeight <= innerHeight + 1"));
  const pill = await phone.evaluate("(() => { const s = document.getElementById('status-text'); return s.scrollWidth <= s.clientWidth + 1; })()");
  check("phone, Tagalog: the status pill is not cut off", pill, await phone.evaluate("document.getElementById('status-text').textContent"));
  for (const sel of ["#settings-btn", "#theme-toggle", "#tab-chat", "#tab-list", "#tab-reports", "#tab-hotlines"]) {
    const at = await reach(phone, sel);
    if (at.problem) check(`phone, Tagalog: ${sel} can be tapped`, false, at.problem);
  }
  await sheetTo(phone, "half");
  const tlNear = await ask(phone, "pinakamalapit na evacuation center");
  check("phone, Tagalog: nearest evacuation center answered in Tagalog", tlNear.includes("Pinakamalapit na") && tlNear.includes("sa kalsada"), tlNear.split("\n")[1]);
  await stopServer();
  await phone.send("Page.reload", {});
  await waitFor(phone, "!!(window.__map && window.__map.loaded()) && !document.getElementById('splash')", 60000, "Tagalog app with no hub");
  await sheetTo(phone, "half");
  const tlOff = await ask(phone, "nearest hospital");
  check("phone, Tagalog, hub off: the phone answers in Tagalog", tlOff.includes("Pinakamalapit na mga ospital")
    && (await phone.evaluate("document.getElementById('status-text').textContent")) === "Sa telepono", tlOff.split("\n")[1]);
  await startServer();
  await phone.send("Page.reload", {});
  await waitFor(phone, "!!(window.__map && window.__map.loaded()) && !document.getElementById('splash')", 60000, "phone map");
  await tap(phone, "#settings-btn", "Settings");
  await sleep(400);
  await tap(phone, '.lang-option[lang="en"]', "English in Settings");
  await waitFor(phone, "document.documentElement.lang === 'en' && !!(window.__map && window.__map.loaded()) && !document.getElementById('splash')", 60000, "app in English").catch(() => {});
  check("phone: back to English, position and theme kept", (await phone.evaluate("document.querySelector('#tab-list .tab-label').textContent")) === "Places"
    && near(await userPos(phone), HOME, 2) && (await phone.evaluate("document.documentElement.dataset.theme")) === langTheme);

  // ---------------- phone: an update reaches the phone ----------------
  const vfile = join("app", "static", "pack", "version.json");
  const original = readFileSync(vfile, "utf8");
  const oldPack = JSON.parse(original).pack;
  try {
    writeFileSync(vfile, original.replace(`"pack": "${oldPack}"`, `"pack": "${oldPack}z"`));
    await phone.send("Page.reload", {});
    const updated = await waitUntil(() => phone.evaluate(`(async () => { const r = await navigator.serviceWorker.getRegistration();
      return r?.active && new URL(r.active.scriptURL).searchParams.get('v') === ${JSON.stringify(oldPack + "z")} && navigator.serviceWorker.controller?.scriptURL === r.active.scriptURL; })()`), 180000, "update").catch(() => false);
    check("phone: a new version on the hub reaches the phone by itself", updated);
  } finally {
    writeFileSync(vfile, original);
  }
  phone.close();

  // ---------------- laptop ----------------
  const laptop = await open(`${BASE}/?debug`, LAPTOP);
  await waitFor(laptop, "!!(window.__map && window.__map.loaded()) && !document.getElementById('splash')", 60000, "laptop map");
  await js(laptop, `localStorage.setItem('bb.userPos', JSON.stringify(${JSON.stringify(HOME)})); return true;`);
  await laptop.send("Page.reload", {});
  await waitFor(laptop, "!!(window.__map && window.__map.loaded()) && !document.getElementById('splash')", 60000, "laptop map");
  await sleep(800);
  await tap(laptop, "#panel-collapse", "collapse panel");
  await sleep(500);
  check("laptop: panel collapses to the rail", await laptop.evaluate("document.querySelector('.layout').classList.contains('panel-collapsed') && !document.getElementById('panel-rail').hidden"));
  await tap(laptop, "#panel-rail button", "rail");
  await sleep(500);
  check("laptop: the rail opens the panel again", await laptop.evaluate("!document.querySelector('.layout').classList.contains('panel-collapsed')"));
  const lap = await ask(laptop, "what should I pack in a go bag?");
  check("laptop: guide answer", /go.?bag/i.test(lap), lap.split("\n")[1]);
  await tap(laptop, "#tab-list", "Places tab");
  await typeInto(laptop, "#fac-search", "Batangas State University");
  await sleep(400);
  await tap(laptop, "#fac-list .fac", "the place");
  await sleep(800);
  await tap(laptop, "#place-route", "Directions");
  const lapRoute = await waitUntil(() => laptop.evaluate("/km|m ·/.test(document.getElementById('route-summary')?.textContent ?? '')"), 30000, "laptop route").catch(() => false);
  check("laptop: directions", lapRoute);
  const t0 = await laptop.evaluate("document.documentElement.dataset.theme");
  await tap(laptop, "#theme-toggle", "theme toggle");
  await sleep(1500);
  check("laptop: theme toggle", (await laptop.evaluate("document.documentElement.dataset.theme")) !== t0);
  laptop.close();

  check("no script errors in the console", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} catch (e) {
  check("run finished", false, e.message);
} finally {
  server?.kill();
  edge.kill();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold files */ }
  try { rmSync(reportsDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks FAILED` : `\nAll ${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
