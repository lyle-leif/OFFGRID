// Film the stage frame by frame (deterministic, no dropped frames):
//   node tools/showreel/render.mjs [--from <frame>] [--to <frame>] [--every <n>]
// Writes out/frames/00000.jpg … (1920x1080 JPEG). --every 30 renders a quick contact sheet.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchEdge, OUT, pipeConsole, serve, waitFor } from "./lib.mjs";
import { DURATION, FPS } from "./timeline.mjs";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : def; };
const TOTAL = Math.round(DURATION * FPS);
const FROM = arg("from", 0), TO = Math.min(arg("to", TOTAL - 1), TOTAL - 1), EVERY = arg("every", 1);
const PORT = 8803, DEBUG = 9354;
const DIR = join(OUT, EVERY > 1 ? "proof" : "frames");
mkdirSync(DIR, { recursive: true });

const server = serve(PORT);
const edge = await launchEdge(DEBUG, { width: 1920, height: 1080 });
try {
  const page = await edge.open("about:blank");
  pipeConsole(page, "stage");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/tool/stage.html` });
  await waitFor(() => page.evaluate("window.__ready === true"), 60000, "stage");
  const t0 = Date.now();
  let n = 0;
  for (let f = FROM; f <= TO; f += EVERY) {
    await page.evaluate(`window.render(${f / FPS}).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`);
    const shot = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 93, optimizeForSpeed: true, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
    if (!shot.result) throw new Error(`frame ${f}: ${JSON.stringify(shot.error)}`);
    writeFileSync(join(DIR, `${String(f).padStart(5, "0")}.jpg`), Buffer.from(shot.result.data, "base64"));
    n++;
    if (n % 120 === 0) {
      const rate = n / ((Date.now() - t0) / 1000);
      console.log(`frame ${f}/${TO} · ${rate.toFixed(1)} fps · ~${Math.round((TO - f) / EVERY / rate)} s left`);
    }
  }
  console.log(`rendered ${n} frames to ${DIR} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} finally {
  await edge.close();
  server.close();
}
