// Contact sheets of the proof frames (render.mjs --every N), for reviewing the cut quickly:
//   node tools/showreel/contact.mjs [from_s] [to_s]   -> out/contact-<from>-<to>.png
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchEdge, OUT, serve, waitFor } from "./lib.mjs";
import { FPS } from "./timeline.mjs";

const from = Number(process.argv[2] ?? 0), to = Number(process.argv[3] ?? 60);
const files = readdirSync(join(OUT, "proof")).filter((f) => f.endsWith(".jpg"))
  .map((f) => ({ f, t: Number(f.slice(0, 5)) / FPS })).filter((x) => x.t >= from && x.t < to);
const COLS = 4, W = 480, H = 270;
const rows = Math.ceil(files.length / COLS);
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${COLS},${W}px);gap:4px;font:600 16px Segoe UI;color:#fff">
${files.map((x) => `<div style="position:relative"><img src="/out/proof/${x.f}" width="${W}" height="${H}" style="display:block"><span style="position:absolute;left:6px;top:4px;background:#000a;padding:1px 6px">${x.t.toFixed(2)}</span></div>`).join("")}</body>`;
writeFileSync(join(OUT, "contact.html"), html);
const PORT = 8804, DEBUG = 9355;
const server = serve(PORT);
const edge = await launchEdge(DEBUG);
try {
  const page = await edge.open("about:blank");
  const width = COLS * (W + 4), height = rows * (H + 4);
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/out/contact.html` });
  await waitFor(() => page.evaluate("[...document.images].every((i) => i.complete)"), 30000, "images");
  const shot = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
  const out = join(OUT, `contact-${from}-${to}.png`);
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(out);
} finally {
  await edge.close();
  server.close();
}
