// Record real-app motion footage for the showreel: a laptop window and an iPhone-sized window,
// filmed with the DevTools screencast (smooth, ~20-30 fps) while a script drives them, with the
// internet blocked. Follows tools/demo_video/record.mjs. Needs Ollama (the laptop AI shot).
//   node tools/showreel/capture.mjs
// Writes out/footage/<shot>/<n>.jpg and out/footage/footage.json ({ shot: { dev, w, h, frames: [{t, f}], marks } }).

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchEdge, openPage, OUT, ROOT, sleep, waitFor } from "./lib.mjs";

const PORT = 8768;
const DEBUG_PORT = 9352;
const BASE = `http://127.0.0.1:${PORT}`;
const PY = process.env.PYTHON ?? join(ROOT, ".venv", "Scripts", "python.exe");
const LAPTOP = { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const NEAR_BMC = { lat: 13.7672, lng: 121.066 };
const FLOOD_AT = { lat: 13.7565, lng: 121.0583 }; // P. Burgos Street, Batangas City
const FOOT = join(OUT, "footage");

rmSync(FOOT, { recursive: true, force: true });
mkdirSync(FOOT, { recursive: true });
const reportsDir = mkdtempSync(join(tmpdir(), "offgrid-showreel-reports-"));
const serverEnv = { ...process.env, BB_REPORTS_DB: join(reportsDir, "reports.db"), BB_RESPONDER_PIN: "424242" };
const startServer = () => spawn(PY, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(PORT)],
  { stdio: "ignore", env: serverEnv, cwd: ROOT });

// ---- screencast recorder ----
const footage = {};
function recorder(page, dev) {
  let shot = null, n = 0, t0 = 0;
  page.on("Page.screencastFrame", (p) => {
    page.send("Page.screencastFrameAck", { sessionId: p.sessionId });
    if (!shot) return;
    const t = (Date.now() - t0) / 1000;
    const f = `${shot.name}/${String(++n).padStart(5, "0")}.jpg`;
    writeFileSync(join(FOOT, f), Buffer.from(p.data, "base64"));
    shot.frames.push({ t: +t.toFixed(3), f });
  });
  const size = dev === "phone" ? { maxWidth: 780, maxHeight: 1688 } : { maxWidth: 1920, maxHeight: 1080 };
  return {
    async start(name) {
      mkdirSync(join(FOOT, name), { recursive: true });
      shot = footage[name] = { dev, frames: [], marks: {} };
      shot.name = name; n = 0; t0 = Date.now();
      await page.send("Page.bringToFront");
      await page.send("Page.startScreencast", { format: "jpeg", quality: 88, everyNthFrame: 1, ...size });
      return shot;
    },
    mark(key, value = null) { shot.marks[key] = value ?? +((Date.now() - t0) / 1000).toFixed(3); },
    now: () => (Date.now() - t0) / 1000,
    async stop() {
      await page.send("Page.stopScreencast");
      const s = shot; shot = null; delete s.name;
      console.log(`  ${dev}: ${s.frames.length} frames over ${s.frames.at(-1)?.t ?? 0} s`);
      return s;
    },
  };
}

async function type(page, selector, text, cps = 14) {
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus(); true`);
  for (let i = 1; i <= text.length; i++) {
    await page.evaluate(`(() => { const t = document.querySelector(${JSON.stringify(selector)}); t.value = ${JSON.stringify(text)}.slice(0, ${i});
      t.dispatchEvent(new Event('input')); return true; })()`);
    await sleep(1000 / cps);
  }
}
const click = (page, selector) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false; el.click(); return true; })()`);

// ---- run ----
let server = startServer();
const edge = await launchEdge(DEBUG_PORT, { width: 1280, height: 900 });
try {
  await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok, 60000, "OFFGRID server");
  console.log("warming the local AI…");
  await fetch(`${BASE}/api/assistant/ask`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "is it safe to walk through flood water?" }) }).then((r) => r.text());

  const open = async (url, metrics, ua) => {
    const page = await openPage(DEBUG_PORT, url);
    await page.send("Emulation.setDeviceMetricsOverride", metrics);
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    if (ua) {
      await page.send("Emulation.setUserAgentOverride", { userAgent: ua, platform: "iPhone" });
      await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    }
    return page;
  };
  const setup = (theme, extra = "") => `(() => { localStorage.setItem('bb.lang', 'en'); localStorage.setItem('bb.theme', '${theme}'); localStorage.setItem('bb.saver', 'off');
    localStorage.setItem('bb.legend', 'closed'); localStorage.setItem('bb.userPos', JSON.stringify(${JSON.stringify(NEAR_BMC)})); ${extra} return true; })()`;

  // Phone first: it must save its offline copy before the hub goes away.
  const phone = await open(`${BASE}/?debug`, PHONE, IPHONE_UA);
  const P = recorder(phone, "phone");
  await waitFor(() => phone.evaluate("document.readyState === 'complete'"), 30000, "phone page");
  await phone.evaluate(setup("dark", "localStorage.setItem('bb.sheet.start', 'peek');"));
  await phone.send("Page.reload", {});
  console.log("phone: saving its offline copy…");
  await waitFor(() => phone.evaluate(`(document.getElementById('offline-copy')||{}).innerText?.includes('Saved on this phone') ?? false`), 300000, "offline copy");

  const laptop = await open(`${BASE}/?demo&debug`, LAPTOP);
  const L = recorder(laptop, "laptop");
  await waitFor(() => laptop.evaluate("document.readyState === 'complete'"), 30000, "laptop page");
  await laptop.evaluate(setup("dark"));
  await laptop.send("Page.reload", {});
  await waitFor(() => laptop.evaluate("!!(window.__map && window.__map.loaded())"), 60000, "laptop map");
  await sleep(4000);

  // 1. Phone launch: splash -> map -> sheet pulled up.
  console.log("shot phone-launch");
  await phone.send("Page.bringToFront");
  await P.start("phone-launch");
  await phone.send("Page.reload", {});
  await waitFor(() => phone.evaluate("!!(window.__map && window.__map.loaded())"), 60000, "phone map");
  P.mark("mapReady");
  await sleep(2600);
  P.mark("drag1"); await click(phone, "#sheet-handle"); await sleep(1400); // peek -> half
  await click(phone, "#tab-list"); await sleep(1600);
  P.mark("drag2"); await click(phone, "#sheet-handle"); await sleep(1600); // half -> full
  await click(phone, "#sheet-handle"); await sleep(1200);
  await P.stop();

  // 2. Laptop fly-over across Batangas (dark), ending on the city.
  console.log("shot laptop-fly");
  await laptop.evaluate("window.__map.jumpTo({ center: [120.86, 13.86], zoom: 9.4, bearing: 0 }); true");
  await sleep(2500);
  await L.start("laptop-fly");
  await sleep(400);
  await laptop.evaluate("window.__map.flyTo({ center: [121.058, 13.757], zoom: 13.6, bearing: -18, duration: 6500, curve: 1.3, essential: true }); true");
  await sleep(7600);
  await L.stop();

  // 3. Laptop local AI answers a typo'd question.
  console.log("shot laptop-ai");
  await laptop.evaluate("window.__map.jumpTo({ center: [121.02, 13.80], zoom: 10.6, bearing: 0 }); document.getElementById('tab-chat').click(); true");
  await sleep(2500);
  await L.start("laptop-ai");
  await sleep(500);
  L.mark("typeStart");
  await type(laptop, "#question", "is it safe to wlak thru flood water?");
  L.mark("typeEnd");
  const before = await laptop.evaluate("document.querySelectorAll('#messages .msg.bot').length");
  await click(laptop, "#send");
  L.mark("sent");
  await waitFor(async () => (await laptop.evaluate(`document.querySelectorAll('#messages .msg.bot').length > ${before}`)), 20000, "first passage");
  L.mark("firstAnswer");
  await waitFor(async () => (await laptop.evaluate(`!document.getElementById('send').disabled && !!document.querySelector('#messages .msg.bot:last-child')`)), 60000, "AI summary");
  L.mark("answered");
  footage["laptop-ai"].marks.answer = await laptop.evaluate("document.querySelector('#messages .msg.bot:last-child')?.innerText ?? ''");
  await sleep(2500);
  await L.stop();

  // 4. Phone reports a flooded road; the laptop shows it.
  console.log("shot report");
  const view = (padding, zoom = 15.6) => `window.__map.jumpTo({ center: [${FLOOD_AT.lng}, ${FLOOD_AT.lat}], zoom: ${zoom}, padding: ${JSON.stringify(padding)} }); true`;
  await laptop.evaluate(view({ top: 60, right: 430, bottom: 30, left: 30 }, 15.2));
  await phone.evaluate(view({ top: 60, right: 40, bottom: 30, left: 70 }));
  await phone.evaluate(`(() => { const m = window.__map; const p = m.project([${FLOOD_AT.lng}, ${FLOOD_AT.lat}]);
    m.panBy([0, p.y - 230], { duration: 0 }); return true; })()`);
  await sleep(1500);
  await P.start("report-phone");
  await sleep(700);
  await click(phone, "#report-btn"); P.mark("reportBtn");
  await sleep(1300);
  await click(phone, ".report-kind"); P.mark("kind");
  await sleep(1000);
  footage["report-phone"].marks.flag = await phone.evaluate(`(() => { const p = window.__map.project([${FLOOD_AT.lng}, ${FLOOD_AT.lat}]);
    const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y }; })()`);
  await phone.evaluate(`(() => { const m = window.__map; m.fire('click', { lngLat: { lat: ${FLOOD_AT.lat}, lng: ${FLOOD_AT.lng} },
    point: m.project([${FLOOD_AT.lng}, ${FLOOD_AT.lat}]), originalEvent: {} }); return true; })()`);
  P.mark("placed");
  await sleep(2200);
  await P.stop();
  await L.start("report-laptop");
  await sleep(300);
  await waitFor(() => laptop.evaluate("(localStorage.getItem('bb.reports.cache') || '').includes('road_flooded')"), 15000, "report on laptop");
  L.mark("flagSeen");
  footage["report-laptop"].marks.flag = await laptop.evaluate(`(() => { const p = window.__map.project([${FLOOD_AT.lng}, ${FLOOD_AT.lat}]);
    const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y }; })()`);
  await sleep(1500);
  await click(laptop, "#tab-reports"); L.mark("list");
  await sleep(2200);
  await L.stop();

  // 5. Laptop light theme (for the outro's light/dark crossfade).
  console.log("shot laptop-light");
  await laptop.evaluate("window.__map.jumpTo({ center: [121.02, 13.80], zoom: 10.6, bearing: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } }); document.getElementById('tab-chat').click(); true");
  await sleep(1500);
  await L.start("laptop-light");
  await sleep(600);
  await click(laptop, "#theme-toggle"); L.mark("toggled");
  await sleep(3500);
  await L.stop();
  await click(laptop, "#theme-toggle");

  // 6. Hub off: the phone answers in Filipino and routes on its own.
  console.log("shot phone-offline");
  server.kill();
  await waitFor(async () => { try { await fetch(`${BASE}/api/health`); return false; } catch { return true; } }, 15000, "server to stop");
  await phone.evaluate(`window.__map.jumpTo({ center: [${NEAR_BMC.lng}, ${NEAR_BMC.lat}], zoom: 15, padding: { top: 60, right: 40, bottom: 430, left: 70 } }); true`);
  await click(phone, "#tab-chat");
  await sleep(1200);
  await P.start("phone-offline");
  await sleep(500);
  P.mark("typeStart");
  await type(phone, "#question", "saan ang pinakamalapit na ospitl?");
  await click(phone, "#send"); P.mark("sent");
  await waitFor(async () => (await phone.evaluate(`document.querySelectorAll('#messages .msg.bot').length > 0 && !document.getElementById('send').disabled`)), 20000, "phone answer");
  P.mark("answered");
  footage["phone-offline"].marks.answer = await phone.evaluate("document.querySelector('#messages .msg.bot:last-child')?.innerText ?? ''");
  footage["phone-offline"].marks.pill = await phone.evaluate("document.getElementById('status-text')?.textContent ?? ''");
  await sleep(1200);
  await phone.evaluate("document.querySelector('#messages .msg.bot:last-child .place-result')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); true");
  await sleep(900);
  await click(phone, "#messages .msg.bot:last-child .place-result .btn:not(.secondary)"); P.mark("directions");
  await waitFor(async () => (await phone.evaluate("/km|m ·/.test(document.getElementById('route-summary')?.textContent ?? '')")), 15000, "route");
  P.mark("routed");
  await phone.evaluate("document.getElementById('question').blur(); true");
  await sleep(300);
  await click(phone, "#sheet-handle"); await sleep(250);
  await click(phone, "#sheet-handle"); P.mark("sheetDown");
  await sleep(3200);
  footage["phone-offline"].marks.route = await phone.evaluate("document.getElementById('route-summary')?.textContent ?? ''");
  await P.stop();

  writeFileSync(join(FOOT, "footage.json"), JSON.stringify(footage, null, 1));
  for (const [k, s] of Object.entries(footage)) console.log(k, JSON.stringify(Object.fromEntries(Object.entries(s.marks).map(([a, b]) => [a, typeof b === "string" ? b.slice(0, 80) : b]))));
} finally {
  server.kill();
  await edge.close();
  try { rmSync(reportsDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
