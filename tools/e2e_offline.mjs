// End-to-end check of OFFGRID's core promise: once a phone has visited the hub, it keeps
// working when the hub disappears.
//
//   node tools/e2e_offline.mjs                 # plain http on localhost
//   node tools/e2e_offline.mjs --https <lan-ip>  # the real phone path: https on the hub's
//                                              # Wi-Fi address with certs/hub.crt (run
//                                              # tools/make_certs.py first); Edge trusts
//                                              # exactly that certificate, like a phone that
//                                              # installed the hub certificate
//
// Starts its own OFFGRID server (port 8765) and a headless Microsoft Edge with a throwaway
// profile, waits for the offline copy to be saved, then STOPS the server and checks the
// app still opens, shows the map, answers questions, finds the nearest hospital, and routes.
// Situation reports: one posted before the hub stops is still shown and answered offline; one
// made offline waits on the phone and reaches the hub when it comes back.
// Nothing touches your normal browsers, or the hub's real reports (a throwaway database).

import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8765;
const DEBUG_PORT = 9339;
const httpsIdx = process.argv.indexOf("--https");
const HTTPS_IP = httpsIdx > 0 ? process.argv[httpsIdx + 1] : null;
const BASE = HTTPS_IP ? `https://${HTTPS_IP}:${PORT}` : `http://127.0.0.1:${PORT}`;
const APP = `${BASE}/?debug`;
// Node itself must trust the hub certificate for its health checks in https mode.
if (HTTPS_IP) process.env.NODE_EXTRA_CA_CERTS ??= "certs/offgrid-ca.crt";
const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PY = process.env.PYTHON ?? ".venv\\Scripts\\python.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reportsDir = mkdtempSync(join(tmpdir(), "offgrid-e2e-reports-"));
process.env.BB_REPORTS_DB = join(reportsDir, "reports.db"); // the server inherits this

function startServer() {
  const args = ["-m", "uvicorn", "app.main:app", "--port", String(PORT)];
  if (HTTPS_IP) args.push("--host", "0.0.0.0", "--ssl-keyfile", "certs/hub.key", "--ssl-certfile", "certs/hub.crt");
  else args.push("--host", "127.0.0.1");
  return spawn(PY, args, { stdio: "ignore" });
}

// SPKI hash of the hub certificate's key: Edge trusts exactly this certificate, nothing else.
function hubSpki() {
  const ossl = '"C:/Program Files/Git/usr/bin/openssl.exe"';
  return execSync(`${ossl} x509 -in certs/hub.crt -pubkey -noout | ${ossl} pkey -pubin -outform der | ${ossl} dgst -sha256 -binary | ${ossl} base64`,
    { shell: "cmd.exe" }).toString().trim();
}

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

// Minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
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

// Ask a question through the real chat UI and return the answer bubble's text.
const ASK = (q) => `(async () => {
  document.getElementById('tab-chat').click();
  const before = document.querySelectorAll('#messages .msg.bot').length;
  const t = document.getElementById('question'); t.value = ${JSON.stringify(q)};
  document.getElementById('ask-form').requestSubmit();
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 250));
    const bots = document.querySelectorAll('#messages .msg.bot');
    if (bots.length > before && !document.getElementById('send').disabled) return bots[bots.length - 1].innerText;
  }
  return 'TIMEOUT';
})()`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const profile = mkdtempSync(join(tmpdir(), "offgrid-e2e-"));
let server = startServer();
const edgeArgs = [`--headless=new`, `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--window-size=1200,800"];
if (HTTPS_IP) edgeArgs.push(`--ignore-certificate-errors-spki-list=${hubSpki()}`);
const edge = spawn(EDGE, [...edgeArgs, "about:blank"], { stdio: "ignore" });

try {
  await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok, 60000, "OFFGRID server");
  const version = await waitFor(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(), 30000, "Edge");
  const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP)}`, { method: "PUT" })).json();
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  // A first visit asks for the language; these checks read the English wording.
  await waitFor(() => page.evaluate("document.readyState === 'complete' && location.origin !== 'null'"), 30000, "first page");
  await page.evaluate("localStorage.setItem('bb.lang', 'en'); location.reload(); true");
  console.log(`Edge ${version.Browser}, ${BASE}, profile ${profile}`);
  check("secure context (needed for offline copy and GPS)", await page.evaluate(`window.isSecureContext`));

  // ---- 1. Visit the hub once: the offline copy is saved ----
  const saved = await waitFor(() => page.evaluate(`(document.getElementById('offline-copy')||{}).innerText||''`)
    .then((t) => (t.includes("Saved on this phone") ? t : (t.includes("Saving") ? null : null))), 240000, "offline copy");
  check("offline copy saved on first visit", Boolean(saved), saved.replace(/\s+/g, " ").slice(0, 120));
  const cached = await page.evaluate(`(async () => { let n = 0, bytes = 0; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) { n++; } } const est = await navigator.storage.estimate(); return { n, mb: Math.round(est.usage / 1e6) }; })()`);
  check("everything stored on the device", cached.n >= 40, `${cached.n} files, ~${cached.mb} MB`);

  // Another phone reports a flooded road; this phone picks it up at its next sync.
  const flood = await (await fetch(`${BASE}/api/reports`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: crypto.randomUUID(), kind: "road_flooded", lat: 13.7565, lng: 121.0583, device: "e2e-other-phone" }),
  })).json();
  const synced = await waitFor(() => page.evaluate(`(localStorage.getItem('bb.reports.cache') || '').includes(${JSON.stringify(flood.id ?? "none")})`),
    40000, "report sync").catch(() => false);
  check("report from another phone reaches this phone", synced, flood.road_name ?? JSON.stringify(flood).slice(0, 80));

  // ---- 2. The hub disappears ----
  server.kill();
  await waitFor(async () => { try { await fetch(`${BASE}/api/health`); return false; } catch { return true; } }, 15000, "server to stop");
  console.log("Hub stopped. Reloading the app with no hub…");
  await page.send("Page.enable");
  await page.send("Page.reload", { ignoreCache: false });
  await sleep(3000);

  const opened = await waitFor(() => page.evaluate(`document.querySelector('h1')?.textContent`), 30000, "app shell");
  check("app opens with no hub", opened === "OFFGRID");
  const mapOk = await waitFor(() => page.evaluate(`window.__map && window.__map.loaded() && window.__map.getSource('facilities') ? true : false`), 60000, "map");
  check("offline map and facility pins load", mapOk);
  const places = await page.evaluate(`document.getElementById('fac-count').textContent`);
  check("facility list available", Number(places) > 100, `${places} shown`);
  const hotlines = await page.evaluate(`document.querySelectorAll('#hotline-list .hotline').length`);
  check("hotlines available", hotlines >= 5, `${hotlines} sections`);

  const guide = await page.evaluate(ASK("How do I stop bleeding?"));
  check("guide answer on the phone", /press(ing)? firmly/i.test(guide) && guide.includes("on this phone"), guide.replace(/\s+/g, " ").slice(0, 110));

  const notCovered = await page.evaluate(ASK("What is the capital of France?"));
  check("still refuses what the guides don't cover", notCovered.includes("can't find this"), "");

  const flooded = await page.evaluate(ASK("Is the road flooded?"));
  check("answers from saved reports with no hub", flooded.includes("No hub connection") && flooded.includes("Road flooded"),
    flooded.replace(/\s+/g, " ").slice(0, 120));

  // A report made with no hub waits on the phone.
  const queued = await page.evaluate(`(async () => {
    document.getElementById('report-new').click();
    [...document.querySelectorAll('.report-kind')].find((b) => b.textContent.includes('Power out')).click();
    const m = window.__map;
    m.fire('click', { lngLat: { lat: 13.758, lng: 121.06 }, point: m.project([121.06, 13.758]), originalEvent: {} });
    await new Promise((r) => setTimeout(r, 500));
    return JSON.parse(localStorage.getItem('bb.reports.outbox') || '[]').length;
  })()`);
  check("report made offline is kept on the phone", queued === 1, `${queued} waiting`);

  // Set a position near Batangas Medical Center, then location questions.
  await page.evaluate(`localStorage.setItem('bb.userPos', JSON.stringify({lat: 13.7672, lng: 121.0660})); true`);
  await page.send("Page.reload", {});
  await sleep(2500);
  await waitFor(() => page.evaluate(`window.__map && window.__map.loaded() ? true : false`), 60000, "map after reload");
  const nearest = await page.evaluate(ASK("pinakamalapit na ospital?"), 120000);
  check("nearest hospital by road, on the phone", nearest.includes("by road") && nearest.includes("Batangas Medical Center"),
    nearest.replace(/\s+/g, " ").slice(0, 130));

  // Directions from the Directions button, computed on the phone.
  const route = await page.evaluate(`(async () => {
    document.getElementById('tab-list').click();
    const s = document.getElementById('fac-search'); s.value = 'Batangas State University'; s.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('#fac-list .fac').click();
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('place-route').click();
    for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 250)); const t = document.getElementById('route-summary').textContent; if (/km|m ·/.test(t) || t === 'No route') return t + ' | ' + document.querySelectorAll('#route-steps li').length + ' steps'; }
    return 'TIMEOUT';
  })()`, 60000);
  check("turn-by-turn directions on the phone", /Walk|Drive/.test(route) && !route.startsWith("No route"), route);

  // The same phone with the Tagalog interface: the phone's own answers are in Tagalog too.
  await page.evaluate("localStorage.setItem('bb.lang', 'tl'); true");
  await page.send("Page.reload", {});
  await sleep(2500);
  await waitFor(() => page.evaluate(`window.__map && window.__map.loaded() ? true : false`), 60000, "map in Tagalog");
  const tl = await page.evaluate(ASK("nearest hospital"), 120000);
  check("Tagalog answer on the phone", tl.includes("Pinakamalapit na") && tl.includes("sa kalsada")
    && (await page.evaluate("document.querySelector('#tab-list .tab-label').textContent")) === "Mga lugar", tl.replace(/\s+/g, " ").slice(0, 110));
  await page.evaluate("localStorage.setItem('bb.lang', 'en'); true");

  // ---- 3. The hub comes back: the waiting report is sent ----
  server = startServer();
  await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok, 60000, "OFFGRID server again");
  const sent = await waitFor(() => page.evaluate(`JSON.parse(localStorage.getItem('bb.reports.outbox') || '[]').length === 0`),
    45000, "outbox to empty").catch(() => false);
  const onHub = (await (await fetch(`${BASE}/api/reports`)).json()).map((r) => r.kind);
  check("waiting report sent when the hub is back", sent && onHub.includes("power_out"), onHub.join(", "));

  page.close();
} catch (e) {
  check("e2e run", false, e.message);
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
  try { rmSync(reportsDir, { recursive: true, force: true }); } catch { /* server may still hold it */ }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
