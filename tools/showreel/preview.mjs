// Serve the showreel stage for previewing in a browser:
//   node tools/showreel/preview.mjs   then open http://127.0.0.1:8800/tool/stage.html?scrub
import { serve } from "./lib.mjs";

const PORT = Number(process.env.PORT ?? 8800);
serve(PORT);
console.log(`showreel preview: http://127.0.0.1:${PORT}/tool/stage.html?scrub`);
