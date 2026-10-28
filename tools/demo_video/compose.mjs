// Turn the recorded frames + narration into the demo video (docs/demo_video.mp4).
//   node tools/demo_video/compose.mjs <output folder of record.mjs and narrate.ps1>
// Serves the frames to compose.html in headless Edge, which plays and records the video in
// real time (about a minute) and posts the file back here.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = process.argv[2] ?? join(tmpdir(), "offgrid-video");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PORT = 8799;
const DEBUG_PORT = 9342;
const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TYPES = { ".html": "text/html", ".json": "application/json", ".jpg": "image/jpeg", ".wav": "audio/wav", ".svg": "image/svg+xml", ".js": "text/javascript" };

let saved;
const done = new Promise((r) => { saved = r; });
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === "POST" && url.pathname === "/save") {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      const file = join(ROOT, "docs", `demo_video.${url.searchParams.get("ext") === "mp4" ? "mp4" : "webm"}`);
      writeFileSync(file, Buffer.concat(parts));
      res.end("ok");
      saved({ file, seconds: url.searchParams.get("seconds"), bytes: Buffer.concat(parts).length });
    });
    return;
  }
  let path = null;
  if (url.pathname === "/logo.svg") path = join(ROOT, "app", "static", "icons", "logo.svg");
  else if (url.pathname.startsWith("/out/")) path = join(OUT, normalize(decodeURIComponent(url.pathname.slice(5))));
  else if (url.pathname.startsWith("/tool/")) path = join(HERE, normalize(decodeURIComponent(url.pathname.slice(6))));
  if (!path || !existsSync(path)) { res.statusCode = 404; res.end(); return; }
  res.setHeader("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
  createReadStream(path).pipe(res);
});
server.listen(PORT, "127.0.0.1");

const profile = mkdtempSync(join(tmpdir(), "offgrid-compose-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--autoplay-policy=no-user-gesture-required", "--window-size=1920,1080",
  `http://127.0.0.1:${PORT}/tool/compose.html`], { stdio: "ignore" });

try {
  const result = await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after 4 minutes")), 240000))]);
  console.log(`saved ${result.file}: ${result.seconds} s, ${(result.bytes / 1e6).toFixed(1)} MB`);
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
  server.close();
  await new Promise((r) => setTimeout(r, 800));
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold files */ }
}
