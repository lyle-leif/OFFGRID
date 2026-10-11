// Render the showreel soundtrack (score + ElevenLabs VO + SFX) to out/mix.wav:
//   node tools/showreel/audio.mjs
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { launchEdge, OUT, pipeConsole, serve, waitFor } from "./lib.mjs";
import { DURATION, SHOTS, SFX, VO } from "./timeline.mjs";

const PORT = 8802, DEBUG = 9353;
mkdirSync(OUT, { recursive: true });
const server = serve(PORT);
const edge = await launchEdge(DEBUG);
try {
  const page = await edge.open(`http://127.0.0.1:${PORT}/tool/audio.html`);
  pipeConsole(page, "audio");
  const r = await waitFor(() => page.evaluate("window.__audio"), 240000, "audio render");
  const wav = statSync(join(OUT, "mix.wav")).size;
  console.log(`mix.wav: ${(wav / 1e6).toFixed(1)} MB, ${DURATION} s, peak -1 dBFS (gain ${r.gainDb} dB), RMS ${r.rmsDb} dBFS, ${r.cues} sound cues`);
  console.log("voice-over lines:");
  let ok = true;
  r.placed.forEach((l, i) => {
    const next = r.placed[i + 1];
    const shot = SHOTS.find((s) => l.at >= s.start && l.at < s.end);
    const flags = [];
    if (next && l.end > next.at) { flags.push(`OVERLAPS ${next.id}`); ok = false; }
    if (shot && l.end > shot.end + 0.05) flags.push(`runs ${(l.end - shot.end).toFixed(2)} s past the ${shot.id} cut`);
    if (l.end > 59.5) { flags.push("past 59.5 s"); ok = false; }
    console.log(`  ${l.id.padEnd(7)} ${l.at.toFixed(2)} -> ${l.end.toFixed(2)}  (${shot?.id ?? "?"})  ${VO.lines[i].text.slice(0, 48)}… ${flags.join("; ")}`);
  });
  const cuts = new Set(SHOTS.map((s) => s.start));
  console.log(`sfx on a cut: ${SFX.filter((c) => cuts.has(c.at)).map((c) => `${c.s}@${c.at}`).join(", ")}`);
  console.log("sfx shapes:", JSON.stringify(r.shapes));
  if (!ok) process.exitCode = 1;
} finally {
  await edge.close();
  server.close();
}
