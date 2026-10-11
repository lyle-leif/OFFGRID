// Encode the rendered frames + soundtrack into docs/showreel.mp4, then check the result:
//   node tools/showreel/encode.mjs [--vbr 12000000]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchEdge, pipeConsole, ROOT, serve, waitFor } from "./lib.mjs";
import { DURATION, H, W } from "./timeline.mjs";

const i = process.argv.indexOf("--vbr");
const VBR = i > 0 ? Number(process.argv[i + 1]) : 12e6;
const FILE = join(ROOT, "docs", "showreel.mp4");
const PORT = 8805, DEBUG = 9356;
const server = serve(PORT, { onSave: (name) => (name === "showreel.mp4" ? FILE : null) });
const edge = await launchEdge(DEBUG);
try {
  const page = await edge.open("about:blank");
  pipeConsole(page, "encode");
  await page.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/tool/encode.html?vbr=${VBR}` });
  const r = await waitFor(async () => {
    const err = await page.evaluate("window.__err ?? null");
    if (err) throw new Error(err);
    return page.evaluate("window.__encoded");
  }, 900000, "encoder").catch((e) => { throw e; });
  console.log(`encoded ${r.frames} frames + audio (${r.acodec}) in ${r.encodeSeconds} s -> ${FILE} (${(r.bytes / 1e6).toFixed(1)} MB)`);

  // Check it: play it back in the browser and read its metadata; look for both tracks in the file.
  await page.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/repo/docs/showreel.mp4` });
  const meta = await waitFor(() => page.evaluate(`(() => { const v = document.querySelector('video');
    return v && v.readyState >= 1 ? { w: v.videoWidth, h: v.videoHeight, d: v.duration } : (v?.error ? { error: v.error.code } : null); })()`), 30000, "video metadata");
  const head = readFileSync(FILE).subarray(0, 400000).toString("latin1");
  const tracks = { video: head.includes("avc1"), audio: head.includes("mp4a") || head.includes("Opus") };
  const ok = meta.w === W && meta.h === H && Math.abs(meta.d - DURATION) < 0.15 && tracks.video && tracks.audio;
  console.log(`check: ${meta.w}x${meta.h}, ${meta.d?.toFixed(2)} s, video track ${tracks.video}, audio track ${tracks.audio} -> ${ok ? "OK" : "PROBLEM"}`);
  if (!ok) process.exitCode = 1;
} finally {
  await edge.close();
  server.close();
}
