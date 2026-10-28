// Run the online-reports Worker on this computer (no Cloudflare account, nothing to install):
//
//   node cloud/local/server.mjs [--port 8787] [--db cloud/local/reports.db]
//
// The same code as the deployed Worker (cloud/src/worker.js), with the database on Node's
// built-in SQLite. tools/site_check.mjs --cloud uses it; add a responder with
//   node tools/cloud_admin.mjs add "Name" --local cloud/local/reports.db
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import worker from "../src/worker.js";
import { openD1 } from "./d1shim.mjs";

export function startCloud({ port = 8787, db = ":memory:", host = "127.0.0.1" } = {}) {
  const env = { DB: typeof db === "string" ? openD1(db) : db };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    headers.set("CF-Connecting-IP", req.socket.remoteAddress ?? "local");
    const request = new Request(`http://${host}:${port}${req.url}`, {
      method: req.method, headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : body,
    });
    const resp = await worker.fetch(request, env);
    res.writeHead(resp.status, Object.fromEntries(resp.headers));
    res.end(Buffer.from(await resp.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    url: `http://${host}:${port}/`, env,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
  const { url } = await startCloud({ port: Number(arg("--port", 8787)), db: arg("--db", "cloud/local/reports.db") });
  console.log(`OFFGRID online reports running locally at ${url} (Ctrl+C to stop)`);
}
