// Measure the VO takes and check the browser's encoders:  node tools/showreel/probe.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchEdge, OUT, serve, waitFor } from "./lib.mjs";

const PORT = 8801, DEBUG = 9351;
mkdirSync(OUT, { recursive: true });
const server = serve(PORT);
const edge = await launchEdge(DEBUG);
try {
  const page = await edge.open(`http://127.0.0.1:${PORT}/tool/probe.html`);
  const probe = await waitFor(() => page.evaluate("window.__probe"), 60000, "probe");
  writeFileSync(join(OUT, "probe.json"), JSON.stringify(probe, null, 1));
  console.log(JSON.stringify(probe.enc), JSON.stringify(probe.fonts));
  for (const [k, t] of Object.entries(probe.takes)) {
    console.log(`${k}: ${t.duration.toFixed(2)} s, ${t.segments.length} segments`);
    console.log("  " + t.segments.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join("  "));
  }
} finally {
  await edge.close();
  server.close();
}
