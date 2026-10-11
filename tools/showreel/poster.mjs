// README poster for the showreel: a rendered frame with a play button and title.
//   node tools/showreel/poster.mjs [frame]   (default 3050, the laptop + phone shot at 50.8 s)
// Needs out/frames from render.mjs. Writes docs/screenshots/showreel-poster.jpg (1280x720).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchEdge, OUT, ROOT, serve, waitFor } from "./lib.mjs";

const FRAME = String(Number(process.argv[2] ?? 3050)).padStart(5, "0");
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1280px;height:720px;position:relative;overflow:hidden;font-family:'Segoe UI Variable Display','Segoe UI',sans-serif">
<img src="/out/frames/${FRAME}.jpg" style="position:absolute;inset:0;width:1280px;height:720px">
<div style="position:absolute;inset:0;background:radial-gradient(520px 340px at 50% 50%, rgba(6,10,19,.55), rgba(6,10,19,0) 70%)"></div>
<div style="position:absolute;left:50%;top:50%;width:132px;height:132px;margin:-90px 0 0 -66px;border-radius:50%;background:#ff7a3d;box-shadow:0 0 0 10px rgba(255,122,61,.28),0 20px 60px rgba(0,0,0,.6);display:grid;place-items:center">
  <svg width="56" height="56" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="#fff"/></svg></div>
<div style="position:absolute;left:0;right:0;top:438px;text-align:center;color:#fff;font-size:40px;font-weight:800;letter-spacing:.06em;text-shadow:0 4px 24px rgba(0,0,0,.8)">WATCH THE 60-SECOND SHOWREEL</div>
<div style="position:absolute;left:0;right:0;top:494px;text-align:center;color:#e2e8f0;font-size:24px;font-weight:600;text-shadow:0 2px 16px rgba(0,0,0,.9)">Real app, recorded with the internet off</div></body>`;
writeFileSync(join(OUT, "poster.html"), html);
const PORT = 8806, DEBUG = 9357;
const server = serve(PORT);
const edge = await launchEdge(DEBUG, { width: 1280, height: 720 });
try {
  const page = await edge.open("about:blank");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/out/poster.html` });
  await waitFor(() => page.evaluate("document.images[0]?.complete && document.images[0].naturalWidth > 0"), 20000, "poster frame");
  await page.evaluate("document.fonts.ready.then(() => true)");
  const shot = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 88, clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 } });
  const file = join(ROOT, "docs", "screenshots", "showreel-poster.jpg");
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log(file);
} finally {
  await edge.close();
  server.close();
}
