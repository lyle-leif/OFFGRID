// Split a voice-over buffer into speech runs at its pauses (shared by probe.html and audio.html).
// Returns [[start, end], ...] in seconds; runs closer than `join` seconds are merged.
export function speechRuns(buf, { join = 0.28, floor = 0.04 } = {}) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, hop = Math.round(sr * 0.01);
  const env = [];
  for (let i = 0; i < d.length; i += hop) {
    let s = 0;
    const end = Math.min(i + hop, d.length);
    for (let j = i; j < end; j++) s += d[j] * d[j];
    env.push(Math.sqrt(s / hop));
  }
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  const runs = [];
  let start = -1, last = -1;
  env.forEach((v, i) => {
    if (v <= peak * floor) return;
    if (start < 0) start = i;
    else if (i - last > join * 100) { runs.push([start, last]); start = i; }
    last = i;
  });
  if (start >= 0) runs.push([start, last]);
  return runs.map(([a, b]) => [a / 100, (b + 1) / 100]);
}

// Group runs into lines: counts[i] runs make line i.
export function groupRuns(runs, counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== runs.length) throw new Error(`the take has ${runs.length} speech runs, the timeline expects ${total}`);
  const lines = [];
  let k = 0;
  for (const c of counts) { lines.push([runs[k][0], runs[k + c - 1][1]]); k += c; }
  return lines;
}
