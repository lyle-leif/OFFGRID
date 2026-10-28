// End-to-end check of the OFFGRID website (GitHub Pages build, tools/build_site.py):
//
//   node tools/site_check.mjs
//
// Builds the site into a temp folder and serves it under /OFFGRID/ (like
// https://lyle-leif.github.io/OFFGRID/) from a small static server with byte ranges and ETags,
// as GitHub Pages does. A headless Microsoft Edge (throwaway profile, internet blocked) installs
// it like a phone: language question, offline copy saved. Then the server STOPS and the app
// must still open and answer (English and Tagalog), find places, route, show hotlines and the
// privacy page. It also checks that the website never calls the hub's /api, that the Reports
// tab explains reports need a hub, and that a new version reaches the phone by itself.
//
//   node tools/site_check.mjs --cloud
//
// Also runs the online-reports Worker (cloud/) on this computer and builds the site with it:
// another phone's flooded road reaches this phone within the 20 s refresh and directions go
// around it; this phone's reports (a road one snapped on the phone) reach the cloud, also
// after a spell offline (outbox); a responder logs in with a personal account, verifies a
// report, and it is in the audit log.

import { spawnSync, spawn } from "node:child_process";
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

import { openD1 } from "../cloud/local/d1shim.mjs";
import { startCloud } from "../cloud/local/server.mjs";
import { hashPassword } from "../cloud/src/auth.js";

const PORT = 8768;
const DEBUG_PORT = 9351;
const BASE = `http://127.0.0.1:${PORT}/OFFGRID/`;
const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PY = process.env.PYTHON ?? ".venv\\Scripts\\python.exe";
const PHONE = { width: 393, height: 852, deviceScaleFactor: 2, mobile: true };
const NEAR_BMC = { lat: 13.7672, lng: 121.066 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLOUD_MODE = process.argv.includes("--cloud");
const CLOUD_PORT = 8787;
const CLOUD_URL = `http://127.0.0.1:${CLOUD_PORT}/`;
const BSU = "osm-way-129493352"; // Batangas State University, the directions target
const FLOOD_AT = { lat: 13.7565, lng: 121.0583 }; // P. Burgos Street, Batangas City

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -  ${String(detail).replace(/\s+/g, " ").slice(0, 140)}` : ""}`);
}
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(400);
  }
}

// ---- build the site ----------------------------------------------------------------
const siteDir = mkdtempSync(join(tmpdir(), "offgrid-site-"));
const built = spawnSync(PY, ["tools/build_site.py", "--out", siteDir, "--cloud", CLOUD_MODE ? CLOUD_URL : ""], { encoding: "utf-8" });
if (built.status !== 0) { console.log(built.stdout, built.stderr); process.exit(1); }
console.log(built.stdout.trim());

// ---- a static server like GitHub Pages (sub-path, ranges, ETags) ----------------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".pbf": "application/x-protobuf" };
const requests = []; // every path asked for, to prove the website never calls a hub
let server = null;
function startServer() {
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, BASE).pathname);
    requests.push(path);
    if (!path.startsWith("/OFFGRID/")) { res.writeHead(404).end(); return; }
    let file = normalize(join(siteDir, path.slice("/OFFGRID/".length)));
    if (!file.startsWith(siteDir)) { res.writeHead(403).end(); return; }
    if (path.endsWith("/")) file = join(file, "index.html");
    let st;
    try { st = statSync(file); } catch { res.writeHead(404).end(); return; }
    if (!st.isFile()) { res.writeHead(404).end(); return; }
    const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
    const headers = { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Accept-Ranges": "bytes", ETag: etag, "Cache-Control": "max-age=600" };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers).end(); return; }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": st.size });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", r));
}
function stopServer() {
  return new Promise((r) => { server.closeAllConnections(); server.close(r); });
}

// ---- the browser (Chrome DevTools Protocol over Node's WebSocket) --------------------
const profile = mkdtempSync(join(tmpdir(), "offgrid-site-edge-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "about:blank"], { stdio: "ignore" });

const errors = [];
async function open(url) {
  const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression, timeout = 120000) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result?.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", PHONE);
  await send("Page.navigate", { url });
  return { send, evaluate, close: () => ws.close() };
}
const js = (page, code) => page.evaluate(`(async () => { ${code} })()`);
const ready = (page) => waitFor(() => page.evaluate("!!(window.__map && window.__map.loaded()) && !document.getElementById('splash')"), 60000, "map");
// Ask through the real chat box; returns the answer's text.
const ask = (page, q) => js(page, `
  document.getElementById('tab-chat').click();
  const before = document.querySelectorAll('#messages .msg.bot').length;
  const t = document.getElementById('question'); t.value = ${JSON.stringify(q)}; t.dispatchEvent(new Event('input'));
  document.getElementById('ask-form').requestSubmit();
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const bots = document.querySelectorAll('#messages .msg.bot');
    if (bots.length > before && !document.getElementById('send').disabled) return bots[bots.length - 1].innerText;
  }
  return 'TIMEOUT';`);

// The online reports, on this computer (the same Worker code, Node's SQLite instead of D1).
const cloudDb = openD1();
let cloud = null;
const startCloudServer = async () => { cloud = await startCloud({ port: CLOUD_PORT, db: cloudDb }); };
const cloudList = async () => (await fetch(`${CLOUD_URL}api/reports`)).json();

// Another phone's report: a flooded road on the way to Batangas State University (the longest
// stretch of the phone engine's own route there), so this phone's directions must go around it.
async function otherPhoneFlood() {
  const { register } = await import("../app/static/i18n.js");
  register("en", JSON.parse(readFileSync("app/static/lang/en.json", "utf-8")));
  const { createRouter } = await import("../app/static/offline/router.js");
  const bin = readFileSync("app/static/pack/roads.bin");
  const router = createRouter(JSON.parse(readFileSync("app/static/pack/roads-meta.json", "utf-8")), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const bsu = JSON.parse(readFileSync("app/static/pack/locations.json", "utf-8")).find((l) => l.id === BSU);
  const r = router.route([NEAR_BMC.lat, NEAR_BMC.lng], [bsu.lat, bsu.lng], "walk", "X");
  const step = r.steps.reduce((a, b) => (b.distance_m > a.distance_m ? b : a));
  const snap = router.snap(step.lat, step.lng, "walk", 60);
  const body = { id: "other-phone-flood-1", device: "other-phone-0001", kind: "road_flooded", lat: snap.point[0], lng: snap.point[1],
    edge_id: snap.edge, road_name: router.roadLabel(snap.edge) };
  return fetch(`${CLOUD_URL}api/reports`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:8768" }, body: JSON.stringify(body) });
}
// Report through the app's own Reports flow: a kind, then a tap on the map.
const reportOnMap = (page, kind, at) => js(page, `
  document.getElementById('tab-reports').click();
  document.getElementById('report-new').click();
  [...document.querySelectorAll('#report-kinds .report-kind')].find((b) => b.textContent.trim() === ${JSON.stringify(kind)}).click();
  const m = window.__map; m.jumpTo({ center: [${at.lng}, ${at.lat}], zoom: 16.5 });
  await new Promise((r) => setTimeout(r, 300));
  m.fire('click', { lngLat: { lat: ${at.lat}, lng: ${at.lng} }, point: m.project([${at.lng}, ${at.lat}]), originalEvent: {} });
  await new Promise((r) => setTimeout(r, 1500));
  return true;`);

try {
  if (CLOUD_MODE) await startCloudServer();
  await startServer();
  await waitFor(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(), 30000, "Edge");
  const page = await open(`${BASE}?debug`);

  // ---- first visit: language question, then the offline copy ----
  await waitFor(() => page.evaluate("!document.getElementById('lang-picker').hidden"), 30000, "language picker").catch(() => {});
  check("first visit asks Tagalog or English", await page.evaluate("document.querySelectorAll('#lang-picker-choices button').length === 2"));
  await js(page, `document.querySelector('#lang-picker-choices button[lang="en"]').click(); return true;`);
  check("the page knows it is the website", await page.evaluate("document.querySelector('meta[name=\"offgrid-mode\"]')?.content === 'site'"));
  const saved = await waitFor(() => page.evaluate("(document.getElementById('offline-copy')||{}).innerText?.includes('Saved on this phone') ? document.getElementById('offline-copy').innerText : ''"), 300000, "offline copy").catch(() => "");
  check("the offline copy is saved on first visit", saved, saved);
  const scope = await page.evaluate("navigator.serviceWorker.getRegistration().then((r) => r?.scope + ' ' + new URL(r.active.scriptURL).search)");
  check("the offline copy belongs to /OFFGRID/ and runs in website mode", /\/OFFGRID\/ .*site=1/.test(scope), scope);
  await ready(page);
  const pillWord = CLOUD_MODE ? "Online" : "Website";
  const pill0 = await waitFor(() => page.evaluate(`document.getElementById('status-text').textContent.startsWith(${JSON.stringify(pillWord)}) && document.getElementById('status-text').textContent`), 30000, "status pill").catch(() => "");
  check(`status pill says ${pillWord}`, pill0, pill0);

  if (CLOUD_MODE) {
    // ---- online reports ----
    const other = await otherPhoneFlood();
    check("another phone's flooded road reaches the online reports", other.ok, other.status);
    const seen = await waitFor(() => page.evaluate("(localStorage.getItem('bb.reports.cache') || '').includes('other-phone-flood-1')"), 30000, "report on this phone").catch(() => false);
    check("it reaches this phone within the 20 s refresh", seen);
    await reportOnMap(page, "Road flooded", FLOOD_AT);
    const mine = await waitFor(async () => (await cloudList()).find((r) => r.kind === "road_flooded" && r.id !== "other-phone-flood-1"), 20000, "road report in the cloud").catch(() => null);
    check("this phone's road report reaches the cloud, snapped to the road on the phone", mine && Number.isInteger(mine.edge_id) && mine.road_name, mine?.road_name);
    await cloud.close();
    await reportOnMap(page, "Power out", { lat: 13.7600, lng: 121.0600 });
    check("offline, a report waits on the phone", await page.evaluate("!!document.querySelector('#report-list li.report.pending')"));
    await startCloudServer();
    const sent = await waitFor(async () => (await cloudList()).some((r) => r.kind === "power_out"), 45000, "outbox sent").catch(() => false);
    check("it is sent when the phone is back online", sent);

    const password = "abcde-fghjk-mnpqr-stuvw";
    await cloudDb.prepare("INSERT INTO accounts (name, salt, pw_hash, created_at) VALUES (?, ?, ?, ?)")
      .bind("Test Responder", "s1", await hashPassword("s1", password), Date.now() / 1000).run();
    const login = await js(page, `
      document.getElementById('tab-reports').click();
      document.getElementById('responder-btn').click();
      document.getElementById('responder-name').value = 'Test Responder';
      document.getElementById('responder-pin').value = ${JSON.stringify(password)};
      document.getElementById('responder-form').requestSubmit();
      for (let i = 0; i < 40 && !sessionStorage.getItem('bb.token'); i++) await new Promise((r) => setTimeout(r, 250));
      await new Promise((r) => setTimeout(r, 500));
      const li = document.querySelector('#report-list li.report[data-id="other-phone-flood-1"]');
      const b = li && [...li.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Verify');
      if (b) b.click();
      return { token: !!sessionStorage.getItem('bb.token'), nameField: !document.getElementById('responder-name').hidden, verify: !!b };`);
    check("a responder logs in with a personal account", login.token && login.nameField, JSON.stringify(login));
    const verified = await waitFor(async () => (await cloudList()).find((r) => r.id === "other-phone-flood-1")?.trust === "verified", 15000, "verified").catch(() => false);
    const audit = (await cloudDb.prepare("SELECT name, action, report_id FROM audit").all()).results;
    check("the responder verifies a report, and it is in the audit log", verified && audit.some((a) => a.action === "verify" && a.report_id === "other-phone-flood-1"),
      audit.map((a) => `${a.name}:${a.action}`).join(", "));
  }

  // ---- the server goes away: everything from the phone ----
  await js(page, `localStorage.setItem('bb.userPos', JSON.stringify(${JSON.stringify(NEAR_BMC)})); localStorage.setItem('bb.sheet.start', 'half'); return true;`);
  await stopServer();
  await page.send("Page.reload", {});
  await sleep(1500);
  await ready(page);
  check("the app opens with no internet", (await page.evaluate("document.querySelector('h1')?.textContent")) === "OFFGRID");
  check("places and the map load", Number(await page.evaluate("document.getElementById('fac-count').textContent")) > 100);
  const hot = await waitFor(() => page.evaluate("document.querySelectorAll('#hotline-list .hotline').length"), 10000, "hotlines").catch(() => 0);
  check("hotlines are there", hot >= 5, `${hot} sections`);
  const near = await ask(page, "nearest hospital");
  check("nearest hospital by road, on the phone", near.includes("by road"), near.split("\n")[1]);
  const guide = await ask(page, "How do I stop bleeding?");
  check("guide answer, with the website note", /press(ing)? firmly/i.test(guide) && guide.includes("need a local OFFGRID hub"), guide.split("\n").pop());
  const flooded = await ask(page, "Is the road flooded?");
  if (CLOUD_MODE) check("report questions answer from the online reports", flooded.includes("Road flooded"), flooded.split("\n")[1]);
  else check("report questions explain the website has no reports", flooded.includes("website version has none"), flooded.split("\n")[1]);
  const route = await js(page, `
    document.getElementById('tab-list').click();
    const s = document.getElementById('fac-search'); s.value = 'Batangas State University'; s.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('#fac-list .fac').click();
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('place-route').click();
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); const t = document.getElementById('route-summary').textContent; if (/km|m ·/.test(t) || t === 'No route') return t; }
    return 'TIMEOUT';`);
  check("directions on the phone", /^(Walk|Drive) /.test(route), route);
  if (CLOUD_MODE) {
    const around = await page.evaluate("document.getElementById('route-reports').innerText");
    check("directions go around the road another phone reported flooded", /Goes around/.test(around), around);
  }
  const reportsTab = await js(page, `document.getElementById('tab-reports').click(); await new Promise((r) => setTimeout(r, 200));
    return { note: document.getElementById('reports-sync').innerText, hidden: ['report-btn', 'report-new', 'responder-btn'].every((id) => document.getElementById(id).hidden) };`);
  if (CLOUD_MODE) check("Reports tab: shared online, report buttons shown", /Online|Offline/.test(reportsTab.note) && !reportsTab.hidden, reportsTab.note);
  else check("Reports tab says reports need a hub; report buttons hidden", reportsTab.note.includes("local OFFGRID hub") && reportsTab.hidden, reportsTab.note);
  const about = await js(page, `document.getElementById('settings-btn').click(); await new Promise((r) => setTimeout(r, 200));
    const a = document.querySelector('.about-links a[href="privacy.html"]');
    return { privacy: !!a, version: document.getElementById('about-version').textContent, note: document.querySelector('[data-i18n="about.redevelopment"]').textContent };`);
  check("Settings shows About: redevelopment note, version and privacy link", about.privacy && about.version.startsWith("Version ") && about.note.includes("redeveloped"), about.version);
  await page.send("Page.navigate", { url: `${BASE}privacy.html` });
  const privacy = await waitFor(() => page.evaluate("document.readyState === 'complete' && document.title"), 15000, "privacy page").catch(() => "");
  check("the privacy page opens offline", privacy.includes("Privacy"), privacy);
  await page.send("Page.navigate", { url: `${BASE}?debug` });
  await ready(page);

  // ---- Tagalog ----
  await js(page, "localStorage.setItem('bb.lang', 'tl'); return true;");
  await page.send("Page.reload", {});
  await sleep(1500);
  await ready(page);
  const tl = await ask(page, "pinakamalapit na ospital");
  check("Tagalog answer on the website", tl.includes("Pinakamalapit na") && (await page.evaluate("document.getElementById('status-text').textContent")).startsWith(pillWord), tl.split("\n")[1]);
  await js(page, "localStorage.setItem('bb.lang', 'en'); return true;");

  // ---- a new version is published: the phone picks it up by itself ----
  const vfile = join(siteDir, "pack", "version.json");
  const version = JSON.parse(readFileSync(vfile, "utf-8"));
  writeFileSync(vfile, JSON.stringify({ ...version, pack: `${version.pack}z` }));
  await startServer();
  await page.send("Page.reload", {});
  const updated = await waitFor(() => page.evaluate(`navigator.serviceWorker.getRegistration().then((r) => r?.active && new URL(r.active.scriptURL).searchParams.get('v') === ${JSON.stringify(version.pack + "z")})`),
    180000, "update").catch(() => false);
  check("a new published version reaches the phone by itself", updated);

  const hub = requests.filter((p) => p.includes("/api/"));
  check("the website never calls a hub (/api)", hub.length === 0, hub.slice(0, 3).join(", "));
  const outside = requests.filter((p) => !p.startsWith("/OFFGRID/"));
  check("everything is loaded from /OFFGRID/ (no root paths)", outside.length === 0, outside.slice(0, 3).join(", "));
  check("no script errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  page.close();
} catch (e) {
  check("site check run", false, e.message);
} finally {
  try { await stopServer(); } catch { /* already stopped */ }
  try { await cloud?.close(); } catch { /* not running */ }
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
  for (const d of [profile, siteDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* Edge may still hold files */ } }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
