// Shared helpers for the showreel tools: a tiny static server, headless Edge, and a
// minimal Chrome DevTools Protocol client (the same pattern as tools/demo_video/).
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..");
export const OUT = process.env.SHOWREEL_OUT ?? join(HERE, "out");
export const EDGE = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".woff2": "font/woff2",
};

// Serves /tool/* from tools/showreel, /out/* from the output folder, /repo/* from the project.
// POST /save?name=<file> writes the body into the output folder (or docs/ for the final video).
export function serve(port, { onSave } = {}) {
  const roots = { tool: HERE, out: OUT, repo: ROOT };
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === "POST" && url.pathname === "/save") {
      const parts = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        const name = url.searchParams.get("name");
        const body = Buffer.concat(parts);
        const file = onSave ? onSave(name, body, url.searchParams) : join(OUT, normalize(name));
        if (file) writeFileSync(file, body);
        res.end("ok");
      });
      return;
    }
    const [, top, ...rest] = url.pathname.split("/");
    const base = roots[top];
    const path = base && join(base, normalize(decodeURIComponent(rest.join("/"))));
    if (!path || !path.startsWith(base) || !existsSync(path) || statSync(path).isDirectory()) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", TYPES[extname(path).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    createReadStream(path).pipe(res);
  });
  server.listen(port, "127.0.0.1");
  return server;
}

export async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

// Headless Edge with no internet (every host but this machine fails to resolve).
export async function launchEdge(debugPort, { width = 1920, height = 1080, extra = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "offgrid-showreel-"));
  const proc = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", `--window-size=${width},${height}`, "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", ...extra, "about:blank"], { stdio: "ignore" });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(), 30000, "Edge");
  const close = async () => {
    proc.kill();
    await sleep(800);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold files */ }
  };
  return { proc, close, open: (url) => openPage(debugPort, url) };
}

export async function openPage(debugPort, url) {
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  return page;
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method && listeners.has(msg.method)) for (const fn of listeners.get(msg.method)) fn(msg.params);
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression, timeout = 600000) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text ?? "evaluate failed");
    if (r.error) throw new Error(r.error.message);
    return r.result?.result?.value;
  };
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); };
  return { send, evaluate, on, close: () => ws.close() };
}

// Mirror the page's console into this terminal (useful for long renders).
export function pipeConsole(page, prefix = "page") {
  page.on("Runtime.consoleAPICalled", (p) => console.log(`[${prefix}]`, ...p.args.map((a) => a.value ?? a.description ?? "")));
  page.on("Runtime.exceptionThrown", (p) => console.error(`[${prefix}] error:`, p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
}
