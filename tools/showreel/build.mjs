// Rebuild docs/showreel.mp4 from the committed assets and the captured footage:
//   node tools/showreel/build.mjs
// Steps: audio.mjs (soundtrack) -> render.mjs (3,600 frames) -> encode.mjs (MP4 + checks).
// Footage comes from capture.mjs (run it first, once; it needs Ollama). The ElevenLabs voice-over
// and sound effects are already in assets/, so a rebuild needs no credits and no internet.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { HERE } from "./lib.mjs";

for (const step of ["audio.mjs", "render.mjs", "encode.mjs"]) {
  console.log(`\n== ${step}`);
  const r = spawnSync(process.execPath, [join(HERE, step)], { stdio: "inherit" });
  if (r.status !== 0) { console.error(`${step} failed`); process.exit(r.status ?? 1); }
}
