// Record the real app for the demo video: a laptop window and an iPhone-sized window driven
// through each scene of tools/demo_video/script.json, with the internet blocked in the browser.
// Saves timed JPEG frames + timeline.json to the output folder; compose.mjs turns them into
// the video. Run from the project root:
//   node tools/demo_video/record.mjs <output folder>
// Needs Ollama running (the laptop scene uses the real local AI).

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2] ?? join(tmpdir(), "offgrid-video");
const PORT = 8765;
const DEBUG_PORT = 9341;
const BASE = `http://127.0.0.1:${PORT}`;
const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PY = process.env.PYTHON ?? ".venv\\Scripts\\python.exe";
const LAPTOP = { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const NEAR_BMC = { lat: 13.7672, lng: 121.066 };
const FLOOD_AT = { lat: 13.7565, lng: 121.0583 }; // on P. Burgos Street, Batangas City
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(join(OUT, "frames"), { recursive: true });
const reportsDir = mkdtempSync(join(tmpdir(), "offgrid-video-reports-"));
const serverEnv = { ...process.env, BB_REPORTS_DB: join(reportsDir, "reports.db"), BB_RESPONDER_PIN: "424242" };
const startServer = () => spawn(PY, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(PORT)],
  { stdio: "ignore", env: serverEnv });

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

// Minimal Chrome DevTools Protocol client (Node's built-in WebSocket).
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression, timeout = 60000) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result?.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

// ---- frames ----
const timeline = { devices: { laptop: LAPTOP, phone: PHONE }, scenes: {} };
let scene = null;
let sceneStart = 0;
let frameNo = 0;
function beginScene(id) {
  scene = { laptop: [], phone: [], taps: [], marks: {} };
  timeline.scenes[id] = scene;
  sceneStart = Date.now();
  console.log(`scene ${id}`);
}
const now = () => (Date.now() - sceneStart) / 1000;
async function snap(dev, page) {
  const t = now();
  const r = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  const file = `frames/${String(++frameNo).padStart(5, "0")}-${dev}.jpg`;
  writeFileSync(join(OUT, file), Buffer.from(r.result.data, "base64"));
  scene[dev].push({ t, f: file });
}
// Keep taking frames while `busy()` holds (at most `ms`), then `tail` ms more.
async function film(dev, page, ms, busy = async () => true, tail = 0) {
  const end = Date.now() + ms;
  while (Date.now() < end && (await busy())) await snap(dev, page);
  const stop = Date.now() + tail;
  while (Date.now() < stop) await snap(dev, page);
}
// Click an element the way a person would, and remember where (the video draws a tap).
async function tap(dev, page, selector) {
  const rect = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
    const r = el.getBoundingClientRect(); el.click(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!rect) throw new Error(`nothing to tap: ${selector}`);
  scene.taps.push({ dev, t: now(), ...rect });
}
async function type(dev, page, selector, text) {
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus(); true`);
  for (let i = 1; i <= text.length; i++) {
    await page.evaluate(`(() => { const t = document.querySelector(${JSON.stringify(selector)}); t.value = ${JSON.stringify(text)}.slice(0, ${i});
      t.dispatchEvent(new Event('input')); })()`);
    if (i % 2 === 0 || i === text.length) await snap(dev, page);
    else await sleep(45);
  }
}

// ---- run ----
let server = startServer();
const profile = mkdtempSync(join(tmpdir(), "offgrid-video-edge-"));
// --host-resolver-rules: every host except this machine fails to resolve = no internet.
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "--hide-scrollbars",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "about:blank"], { stdio: "ignore" });

try {
  await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok, 60000, "OFFGRID server");
  await waitFor(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(), 30000, "Edge");
  // Warm the local AI so the laptop scene shows its normal speed.
  await fetch(`${BASE}/api/assistant/ask`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "is it safe to walk through flood water?" }) }).then((r) => r.text());

  const open = async (url, metrics, ua) => {
    const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", metrics);
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    if (ua) {
      await page.send("Emulation.setUserAgentOverride", { userAgent: ua, platform: "iPhone" });
      await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    }
    return page;
  };
  const setup = (extra = "") => `(() => { localStorage.setItem('bb.theme', 'dark'); localStorage.setItem('bb.saver', 'off');
    localStorage.setItem('bb.legend', 'closed'); localStorage.setItem('bb.userPos', JSON.stringify(${JSON.stringify(NEAR_BMC)})); ${extra} return true; })()`;

  // Phone first: it must save its offline copy (about 46 MB) before the hub goes away.
  const phone = await open(`${BASE}/?debug`, PHONE, IPHONE_UA);
  await waitFor(() => phone.evaluate("document.readyState === 'complete'"), 30000, "phone page");
  await phone.evaluate(setup("localStorage.setItem('bb.sheet', 'half');"));
  await phone.send("Page.reload", {});
  console.log("phone: saving its offline copy…");
  await waitFor(() => phone.evaluate(`(document.getElementById('offline-copy')||{}).innerText?.includes('Saved on this phone') ?? false`), 300000, "offline copy");
  await phone.send("Page.reload", {});
  await waitFor(() => phone.evaluate("!!(window.__map && window.__map.loaded())"), 60000, "phone map");

  const laptop = await open(`${BASE}/?demo&debug`, LAPTOP);
  await waitFor(() => laptop.evaluate("document.readyState === 'complete'"), 30000, "laptop page");
  await laptop.evaluate(setup());
  await laptop.send("Page.reload", {});
  await waitFor(() => laptop.evaluate("!!(window.__map && window.__map.loaded())"), 60000, "laptop map");
  await sleep(4000); // tiles and pins settle; the status pill turns "Offline-ready"
  const front = (page) => page.send("Page.bringToFront");

  // Scene 1: both screens at rest.
  beginScene("intro");
  await front(laptop); await snap("laptop", laptop);
  await front(phone); await snap("phone", phone);

  // Scene 2: the laptop's local AI answers a typo'd question.
  beginScene("local-ai");
  await front(laptop);
  await laptop.evaluate("document.getElementById('tab-chat').click(); true");
  await snap("laptop", laptop);
  await type("laptop", laptop, "#question", "is it safe to wlak thru flood water?");
  const before = await laptop.evaluate("document.querySelectorAll('#messages .msg.bot').length");
  await tap("laptop", laptop, "#send");
  await film("laptop", laptop, 30000, async () => !(await laptop.evaluate(
    `document.querySelectorAll('#messages .msg.bot').length > ${before} && !document.getElementById('send').disabled`)), 2500);
  scene.marks.answeredAt = now();
  scene.marks.answer = await laptop.evaluate("document.querySelector('#messages .msg.bot:last-child')?.innerText ?? ''");

  // Scene 3: the phone reports a flooded road; the laptop shows it.
  beginScene("report");
  const view = (p, padding) => `window.__map.jumpTo({ center: [${FLOOD_AT.lng}, ${FLOOD_AT.lat}], zoom: 15.6, padding: ${JSON.stringify(padding)} }); true`;
  await laptop.evaluate(view({ top: 60, right: 430, bottom: 30, left: 30 }));
  await phone.evaluate(view({ top: 60, right: 40, bottom: 30, left: 70 }));
  // Put the street in the top third of the phone, above the panel.
  await phone.evaluate(`(() => { const m = window.__map; const p = m.project([${FLOOD_AT.lng}, ${FLOOD_AT.lat}]);
    m.panBy([0, p.y - 230], { duration: 0 }); return true; })()`);
  await front(phone);
  await film("phone", phone, 600);
  await tap("phone", phone, "#report-btn");
  await film("phone", phone, 1200);
  await tap("phone", phone, ".report-kind"); // the first kind: Road flooded
  await film("phone", phone, 900);
  const pt = await phone.evaluate(`(() => { const p = window.__map.project([${FLOOD_AT.lng}, ${FLOOD_AT.lat}]);
    const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y }; })()`);
  scene.taps.push({ dev: "phone", t: now(), ...pt });
  await phone.evaluate(`(() => { const m = window.__map; m.fire('click', { lngLat: { lat: ${FLOOD_AT.lat}, lng: ${FLOOD_AT.lng} },
    point: m.project([${FLOOD_AT.lng}, ${FLOOD_AT.lat}]), originalEvent: {} }); return true; })()`);
  await film("phone", phone, 1800);
  await front(laptop);
  await film("laptop", laptop, 8000, async () => !(await laptop.evaluate(
    "(localStorage.getItem('bb.reports.cache') || '').includes('road_flooded')")), 0);
  scene.marks.flagSeenAt = now();
  await film("laptop", laptop, 600);
  scene.marks.reportOnLaptop = await laptop.evaluate("(localStorage.getItem('bb.reports.cache') || '').includes('road_flooded')");
  // Where the flag landed on the laptop screen (the video rings it), then show the list.
  scene.marks.flag = await laptop.evaluate(`(() => { const p = window.__map.project([${FLOOD_AT.lng}, ${FLOOD_AT.lat}]);
    const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y }; })()`);
  await film("laptop", laptop, 1200);
  await tap("laptop", laptop, "#tab-reports");
  await film("laptop", laptop, 1800);

  // Scene 4: the hub goes away; the phone answers and routes on its own.
  beginScene("offline-phone");
  server.kill();
  await waitFor(async () => { try { await fetch(`${BASE}/api/health`); return false; } catch { return true; } }, 15000, "server to stop");
  scene.marks.hubOff = now();
  await front(phone);
  await phone.evaluate(`window.__map.jumpTo({ center: [${NEAR_BMC.lng}, ${NEAR_BMC.lat}], zoom: 15, padding: { top: 60, right: 40, bottom: 430, left: 70 } }); true`);
  await tap("phone", phone, "#tab-chat");
  await film("phone", phone, 500);
  await type("phone", phone, "#question", "saan ang pinakamalapit na ospitl?");
  await tap("phone", phone, "#send");
  const pBefore = 0;
  await film("phone", phone, 15000, async () => !(await phone.evaluate(
    `document.querySelectorAll('#messages .msg.bot').length > ${pBefore} && !document.getElementById('send').disabled`)), 1200);
  scene.marks.answer = await phone.evaluate("document.querySelector('#messages .msg.bot:last-child')?.innerText ?? ''");
  scene.marks.pill = await phone.evaluate("document.getElementById('status-text').textContent");
  await phone.evaluate("document.querySelector('#messages .msg.bot:last-child .place-result')?.scrollIntoView({ block: 'center' }); true");
  await film("phone", phone, 400);
  await tap("phone", phone, "#messages .msg.bot:last-child .place-result .btn:not(.secondary)");
  await film("phone", phone, 15000, async () => !(await phone.evaluate(
    "/km|m ·/.test(document.getElementById('route-summary')?.textContent ?? '')")), 600);
  // The panel is full height after typing: tap its handle (full -> peek -> half) to show the route.
  await phone.evaluate("document.getElementById('question').blur(); true");
  await tap("phone", phone, "#sheet-handle");
  await tap("phone", phone, "#sheet-handle");
  await film("phone", phone, 2600);
  scene.marks.route = await phone.evaluate("document.getElementById('route-summary').textContent");

  beginScene("outro");
  writeFileSync(join(OUT, "timeline.json"), JSON.stringify(timeline, null, 1));
  console.log("marks:", JSON.stringify(Object.fromEntries(Object.entries(timeline.scenes).map(([k, s]) => [k, s.marks])), null, 1));
  console.log(`saved ${frameNo} frames to ${OUT}`);
} finally {
  server.kill();
  edge.kill();
  await sleep(1000);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold files */ }
  try { rmSync(reportsDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
