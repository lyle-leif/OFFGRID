// Draw OFFGRID's home-screen icons (PNG) from the tern logo, with headless Edge.
//   node tools/make_icons.mjs
// Writes app/static/icons/apple-touch-icon.png (180, iPhone), icon-192.png, icon-512.png and
// icon-maskable-512.png (Android masks). The tiles are full-bleed squares with no transparency:
// iPhone and Android round the corners themselves, and iPhone fills transparency with black.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICONS = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "static", "icons");
const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const DEBUG_PORT = 9348;
const BG = "#2b2b2b"; // the logo's disc colour, also the manifest's theme colour

// The tern's paths from logo.svg, without its round background.
const logo = readFileSync(join(ICONS, "logo.svg"), "utf8");
const tern = logo.slice(logo.indexOf(">", logo.indexOf("<svg")) + 1, logo.lastIndexOf("</svg>")).replace(/<circle[^>]*\/>/, "");
// The tern spans x 21–81, y 24–66.6 in the logo's 0–100 box; centre it and size it so it is
// `share` of the tile's width.
const BOX = { x: 21, y: 24, w: 60, h: 42.6 };
function svg(share) {
  const side = BOX.w / share;
  const x = BOX.x + BOX.w / 2 - side / 2, y = BOX.y + BOX.h / 2 - side / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${side} ${side}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`
    + `<rect x="${x}" y="${y}" width="${side}" height="${side}" fill="${BG}"/>${tern}</svg>`;
}
const OUTPUTS = [
  { file: "apple-touch-icon.png", size: 180, share: 0.78 },
  { file: "icon-192.png", size: 192, share: 0.78 },
  { file: "icon-512.png", size: 512, share: 0.78 },
  { file: "icon-maskable-512.png", size: 512, share: 0.6 }, // inside Android's safe zone
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "offgrid-icons-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
try {
  for (let i = 0; ; i++) {
    try { await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(); break; } catch { if (i > 60) throw new Error("Edge did not start"); await sleep(300); }
  }
  const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  for (const { file, size, share } of OUTPUTS) {
    await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const html = `<!doctype html><html><body style="margin:0;background:${BG}">${svg(share)}</body></html>`;
    await send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` });
    await sleep(400);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    writeFileSync(join(ICONS, file), Buffer.from(shot.result.data, "base64"));
    console.log(`wrote ${file} (${size}×${size})`);
  }
  ws.close();
} finally {
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
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold files */ }
}
