// Take the README screenshots (docs/screenshots/*.png) from the real app: a laptop window and
// an iPhone-sized window in headless Edge, internet blocked, every step really done in the app.
//   node tools/screenshots.mjs
// Needs Ollama running (the laptop shot shows a real, checked AI summary).

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = join("docs", "screenshots");
const PORT = 8766;
const DEBUG_PORT = 9344;
const BASE = `http://127.0.0.1:${PORT}`;
const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PY = process.env.PYTHON ?? ".venv\\Scripts\\python.exe";
const LAPTOP = { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const NEAR_BMC = { lat: 13.7672, lng: 121.066 };
const FLOOD_AT = { lat: 13.7565, lng: 121.0583 }; // P. Burgos Street, Batangas City
const BSU = "osm-way-129493352"; // Batangas State University
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, ok, detail = "") => { checks.push(ok); console.log(`${ok ? "OK " : "XX "} ${name}${detail ? `: ${detail}` : ""}`); };

mkdirSync(OUT, { recursive: true });
const reportsDir = mkdtempSync(join(tmpdir(), "offgrid-shots-reports-"));
const env = { ...process.env, BB_REPORTS_DB: join(reportsDir, "reports.db"), BB_RESPONDER_PIN: "424242" };
const server = spawn(PY, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(PORT)], { stdio: ["ignore", "ignore", "pipe"], env });
let serverLog = "";
server.stderr.on("data", (d) => { serverLog += d; });

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 60000 });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result?.result?.value;
  };
  return { send, evaluate };
}

const profile = mkdtempSync(join(tmpdir(), "offgrid-shots-edge-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "--hide-scrollbars",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "about:blank"], { stdio: "ignore" });

async function open(url, metrics, ua) {
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
}
async function shot(page, name) {
  await page.send("Page.bringToFront");
  await sleep(600);
  const r = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name), Buffer.from(r.result.data, "base64"));
  console.log(`    saved ${name}`);
}
const js = (page, code) => page.evaluate(`(async () => { ${code} })()`);
// Ask the assistant through the real chat box; returns the answer's text.
async function ask(page, question) {
  return js(page, `
    document.getElementById('tab-chat').click();
    const before = document.querySelectorAll('#messages .msg.bot').length;
    const t = document.getElementById('question'); t.value = ${JSON.stringify(question)}; t.dispatchEvent(new Event('input'));
    document.getElementById('ask-form').requestSubmit();
    for (let i = 0; i < 240; i++) {
      await new Promise(r => setTimeout(r, 250));
      const bots = document.querySelectorAll('#messages .msg.bot');
      if (bots.length > before && !document.getElementById('send').disabled) { t.blur(); return bots[bots.length - 1].innerText; }
    }
    return 'TIMEOUT';`);
}
// Phone: move the bottom sheet to "peek", "half" or "full" (the handle's arrow keys).
async function sheetTo(page, want) {
  await js(page, `const h = document.getElementById('sheet-handle');
    const key = (k) => h.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowDown'); key('ArrowDown'); for (let i = 0; i < ${["peek", "half", "full"].indexOf(want)}; i++) key('ArrowUp');
    return true;`);
  await sleep(900);
}
// Scroll the chat so the last question and its answer start at the top.
const showLastQuestion = (page) => js(page, `[...document.querySelectorAll('#messages .msg.user')].pop()?.scrollIntoView({ block: 'start' }); return true;`);
const settings = (theme) => `localStorage.setItem('bb.lang', 'en'); localStorage.setItem('bb.theme', '${theme}'); localStorage.setItem('bb.saver', 'off');
  localStorage.setItem('bb.legend', 'closed'); localStorage.setItem('bb.sheet.start', 'half');
  localStorage.setItem('bb.userPos', JSON.stringify(${JSON.stringify(NEAR_BMC)})); return true;`;

try {
  await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok, 120000, "OFFGRID server").catch((e) => { console.log(serverLog.slice(-2000)); throw e; });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(), 30000, "Edge");
  await fetch(`${BASE}/api/assistant/ask`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "is it safe to walk through flood water?" }) }).then((r) => r.text()); // warm the AI

  // ---- phone: save the offline copy first (needed for the offline shot) ----
  const phone = await open(`${BASE}/?debug`, PHONE, IPHONE_UA);
  await waitFor(() => phone.evaluate("document.readyState === 'complete'"), 30000, "phone page");
  await js(phone, settings("dark"));
  await phone.send("Page.reload", {});
  await waitFor(() => phone.evaluate(`(document.getElementById('offline-copy')||{}).innerText?.includes('Saved on this phone') ?? false`), 300000, "offline copy");
  await phone.send("Page.reload", {});
  await waitFor(() => phone.evaluate("!!(window.__map && window.__map.loaded())"), 60000, "phone map");
  await js(phone, `window.__map.jumpTo({ center: [121.06, 13.77], zoom: 13.6 }); return true;`);
  await sleep(3500);
  await shot(phone, "phone-home.png");

  // ---- laptop: the local AI answers a typo'd question ----
  const laptop = await open(`${BASE}/?debug`, LAPTOP);
  await waitFor(() => laptop.evaluate("document.readyState === 'complete'"), 30000, "laptop page");
  await js(laptop, settings("dark"));
  await laptop.send("Page.reload", {});
  await waitFor(() => laptop.evaluate("!!(window.__map && window.__map.loaded())"), 60000, "laptop map");
  await sleep(3000);
  const aiAnswer = await ask(laptop, "is it safe to wlak thru flood water?");
  check("laptop: AI summary checked against the guide", aiAnswer.includes("checked against the guide"), aiAnswer.split("\n").slice(-3, -2).join(" "));
  await shot(laptop, "laptop-dark.png");

  // ---- phone: a guide answer, nearest hospitals, a route ----
  await phone.send("Page.bringToFront");
  const guide = await ask(phone, "how do i stop bleding");
  check("phone: guide answer to a typo'd question", guide.includes("Bleeding"), guide.split("\n")[1] ?? "");
  await sheetTo(phone, "full");
  await showLastQuestion(phone);
  await shot(phone, "phone-assistant.png");

  const nearest = await ask(phone, "saan ang pinakamalapit na ospital?");
  check("phone: nearest hospitals by road", nearest.includes("by road"), nearest.split(/\r?\n/)[2] ?? "");
  await sheetTo(phone, "full");
  await showLastQuestion(phone);
  await shot(phone, "phone-nearest.png");

  // Directions to a place picked from the Places tab (walking).
  await js(phone, `document.getElementById('tab-list').click();
    const s = document.getElementById('fac-search'); s.value = 'Batangas State University'; s.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));
    [...document.querySelectorAll('#fac-list .fac')].find(b => b.textContent.includes('Batangas State University')).click();
    await new Promise(r => setTimeout(r, 1500));
    document.getElementById('place-route').click(); return true;`);
  await waitFor(() => phone.evaluate("/km|m ·/.test(document.getElementById('route-summary')?.textContent ?? '')"), 30000, "phone route");
  await sheetTo(phone, "half");
  await sleep(2500);
  check("phone: walking route", true, await phone.evaluate("document.getElementById('route-summary').textContent"));
  await shot(phone, "phone-directions.png");

  // ---- reports: another phone reports a flooded road ----
  const rep = await (await fetch(`${BASE}/api/reports`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: crypto.randomUUID(), kind: "road_flooded", lat: FLOOD_AT.lat, lng: FLOOD_AT.lng, device: "readme-other-phone" }) })).json();
  check("report posted", rep.road_name === "P. Burgos Street", rep.road_name);
  await js(phone, `document.getElementById('place-close').click(); document.getElementById('tab-reports').click(); return true;`);
  // The phone picks the report up on its next hub check (every 15 s).
  await waitFor(() => phone.evaluate("!!document.querySelector('#report-list li.report')"), 60000, "phone report list");
  await sheetTo(phone, "half");
  await js(phone, `const m = window.__map; m.jumpTo({ center: [${FLOOD_AT.lng}, ${FLOOD_AT.lat}], zoom: 16 });
    const p = m.project([${FLOOD_AT.lng}, ${FLOOD_AT.lat}]); m.panBy([0, p.y - 220], { duration: 0 }); return true;`);
  await sleep(2500);
  await shot(phone, "phone-reports.png");

  // ---- laptop, light map: a place with a walking route ----
  await laptop.send("Page.bringToFront");
  await js(laptop, `document.getElementById('theme-toggle').click(); return true;`);
  await sleep(3000);
  await js(laptop, `document.getElementById('tab-list').click();
    const s = document.getElementById('fac-search'); s.value = 'Batangas State University'; s.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));
    [...document.querySelectorAll('#fac-list .fac')].find(b => b.textContent.includes('Batangas State University')).click();
    await new Promise(r => setTimeout(r, 1500));
    document.getElementById('place-route').click(); return true;`);
  await waitFor(() => laptop.evaluate("/km|m ·/.test(document.getElementById('route-summary')?.textContent ?? '')"), 30000, "laptop route");
  await sleep(3000);
  check("laptop: light theme route", (await laptop.evaluate("document.documentElement.dataset.theme")) === "light",
    await laptop.evaluate("document.getElementById('route-summary').textContent"));
  await shot(laptop, "laptop-light.png");

  // ---- the launch screen (scripts off, so it stays up for the photo) ----
  const launch = await open("about:blank", PHONE, IPHONE_UA);
  await launch.send("Emulation.setScriptExecutionDisabled", { value: true });
  await launch.send("Page.navigate", { url: `${BASE}/` });
  await waitFor(() => launch.evaluate("!!document.getElementById('splash') && document.readyState === 'complete'"), 30000, "launch screen");
  await sleep(500);
  check("launch screen shows the tern", await launch.evaluate("!!document.querySelector('#splash svg') && document.querySelector('.splash-name').textContent === 'OFFGRID'"));
  await shot(launch, "phone-launch.png");

  // ---- the hub's setup page, as a phone sees it ----
  const setup = await open(`${BASE}/setup`, PHONE, IPHONE_UA);
  // (A new tab is "complete" on its blank page first, so wait for the setup page's own text.)
  const setupOk = await waitFor(() => setup.evaluate("location.pathname === '/setup' && document.readyState === 'complete' && document.body.textContent.includes('Certificate Trust') && document.body.textContent.includes('Download certificate')"), 30000, "setup page").catch(() => false);
  check("setup page has the certificate and iPhone steps", setupOk);
  await shot(setup, "phone-setup.png");

  // ---- hub off: the phone answers on its own ----
  server.kill();
  await waitFor(async () => { try { await fetch(`${BASE}/api/health`); return false; } catch { return true; } }, 15000, "server to stop");
  await phone.send("Page.bringToFront");
  const offline = await ask(phone, "nearest evacuation center");
  const pill = await phone.evaluate("document.getElementById('status-text').textContent");
  check("phone: answers with the hub off", await phone.evaluate("[...document.querySelectorAll('#messages .msg.bot')].pop()?.classList.contains('offline-answer') ?? false"), offline.split(/\r?\n/)[1] ?? "");
  check("phone: pill says it is on its own", pill === "On this phone", pill);
  await js(phone, `document.querySelector('#messages .msg.bot:last-child')?.scrollIntoView({ block: 'start' }); return true;`);
  await shot(phone, "phone-offline.png");
} finally {
  server.kill();
  // Ask Edge itself to quit: on Windows, killing the process we started leaves the real browser
  // running on the debug port, and the next run would connect to that old browser.
  try {
    const v = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    const bws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; });
    bws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await new Promise((r) => setTimeout(r, 500));
  } catch { /* already gone */ }
  edge.kill();
  await sleep(1000);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold files */ }
  try { rmSync(reportsDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
console.log(checks.every(Boolean) ? "\nAll screenshots taken, all checks passed." : "\nSome checks FAILED: look before using the screenshots.");
process.exit(checks.every(Boolean) ? 0 : 1);
