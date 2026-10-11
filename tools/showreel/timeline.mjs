// The showreel's single source of truth: tempo, shots, voice-over slots, sound-effect cues and
// music sections. The stage (picture), audio.html (sound) and the encoder all read this file,
// so every cut, hit and line lands on the same frame. Times are in seconds.

export const FPS = 60;
export const BPM = 120;
export const BEAT = 60 / BPM; // 0.5 s
export const BAR = BEAT * 4; // 2 s
export const DURATION = 60;
export const W = 1920, H = 1080;

// Shots (every boundary is on a bar).
export const SHOTS = [
  { id: "storm", start: 0, end: 6 }, // signal lost, the cloud breaks up, power cut at 5.5
  { id: "logo", start: 6, end: 10 }, // drop: the tern assembles, OFFGRID wordmark
  { id: "topic", start: 10, end: 18 }, // kinetic type: the topic
  { id: "laptop", start: 18, end: 28 }, // laptop hero: local AI answer
  { id: "phone", start: 28, end: 36 }, // iPhone hero, then the montage
  { id: "hub", start: 36, end: 42 }, // hub network + report footage
  { id: "plug", start: 42, end: 50 }, // laptop dies, phone keeps going, counters
  { id: "outro", start: 50, end: 60 }, // lock-up
];
export const POWER_CUT = 5.5;

// Voice-over: the take (tools/showreel/assets/vo) is split into speech runs at its pauses;
// `runs` says how many runs make each line. `at` is where the line starts in the video.
export const VO = {
  take: "take1",
  runs: [2, 1, 1, 1, 4, 3, 2, 2, 2],
  lines: [
    { id: "storm", at: 0.7, text: "When the storm hits, the cloud is the first thing to go." },
    { id: "built", at: 6.9, text: "Off Grid was built for what comes next." },
    { id: "silent", at: 10.25, text: "Most AI goes silent without the internet." },
    { id: "runs", at: 13.3, text: "This one runs on a laptop in the room, and on the phone in your hand." },
    { id: "ask", at: 18.35, text: "Ask in English, Filipino, or Taglish. Typos and all. It answers from official guides, and code checks every fact before you see it." },
    { id: "phone", at: 28.3, text: "On the phone: an offline map of all Batangas, the nearest hospitals, and turn-by-turn directions." },
    { id: "share", at: 36.6, text: "Neighbors share flooded roads through the hub. No internet needed." },
    { id: "dies", at: 43.0, text: "And when the laptop dies? The phone keeps going." },
    { id: "end", at: 52.6, text: "Off Grid. Ready beyond the grid." },
  ],
};

// Sound effects (files in assets/sfx). gain is linear; rate changes pitch/speed.
export const SFX = [
  // storm
  { s: "rain", at: 0.0, gain: 0.55, loop: 5.5, fadeIn: 0.8 },
  { s: "tick", at: 1.5, gain: 0.5 }, { s: "tick", at: 2.0, gain: 0.5 }, { s: "tick", at: 2.5, gain: 0.5 }, { s: "tick", at: 3.0, gain: 0.55 },
  { s: "glitch", at: 3.5, gain: 0.7 },
  { s: "glitch", at: 4.75, gain: 0.45, rate: 1.3 },
  { s: "power_cut", at: POWER_CUT, gain: 1.0 },
  // logo drop
  { s: "impact", at: 6.0, gain: 1.0 },
  { s: "sub_drop", at: 6.0, gain: 0.8 },
  { s: "whoosh_b", at: 6.0, gain: 0.6 },
  { s: "ping", at: 8.0, gain: 0.35, rate: 0.8 },
  // topic
  { s: "whoosh_a", at: 9.95, gain: 0.6 },
  { s: "tick", at: 10.5, gain: 0.45 }, { s: "tick", at: 11.0, gain: 0.45 }, { s: "tick", at: 11.5, gain: 0.45 },
  { s: "glitch", at: 12.5, gain: 0.5 },
  { s: "whoosh_b", at: 13.3, gain: 0.55 },
  { s: "blips", at: 14.5, gain: 0.4 },
  { s: "riser", at: 16.0, gain: 0.55, dur: 2.0 },
  // laptop
  { s: "whoosh_a", at: 18.0, gain: 0.7 },
  { s: "impact", at: 18.0, gain: 0.5, rate: 1.2 },
  { s: "typing", at: 19.6, gain: 0.5, loop: 2.8 },
  { s: "ping", at: 22.43, gain: 0.5 },
  { s: "ping", at: 23.7, gain: 0.45, rate: 1.12 },
  { s: "tick", at: 24.5, gain: 0.4 }, { s: "tick", at: 25.0, gain: 0.4 }, { s: "tick", at: 25.5, gain: 0.4 },
  { s: "riser", at: 26.0, gain: 0.55, dur: 2.0 },
  // phone
  { s: "whoosh_b", at: 28.05, gain: 0.7 },
  { s: "impact", at: 28.0, gain: 0.45, rate: 1.3 },
  { s: "tick", at: 29.47, gain: 0.4 }, { s: "tick", at: 30.55, gain: 0.4 }, { s: "tick", at: 32.0, gain: 0.4 },
  { s: "whoosh_a", at: 30.4, gain: 0.3, rate: 1.4 }, { s: "whoosh_a", at: 32.0, gain: 0.3, rate: 1.4 },
  ...[33.15, 33.65, 34.15, 34.65, 35.15].map((at, i) => ({ s: i % 2 ? "whoosh_a" : "whoosh_b", at, gain: 0.35, rate: 1.4 })),
  // hub
  { s: "impact", at: 36.0, gain: 0.45, rate: 1.1 },
  { s: "blips", at: 36.95, gain: 0.45 }, { s: "blips", at: 37.4, gain: 0.35, rate: 1.2 },
  { s: "whoosh_a", at: 37.95, gain: 0.5 },
  { s: "tick", at: 38.85, gain: 0.4 },
  { s: "blips", at: 39.87, gain: 0.45, rate: 1.1 },
  { s: "ping", at: 40.32, gain: 0.55 },
  { s: "riser", at: 40.0, gain: 0.5, dur: 2.0 },
  // plug
  { s: "power_down", at: 42.0, gain: 0.9 },
  { s: "power_cut", at: 42.05, gain: 0.5, rate: 0.85 },
  { s: "typing", at: 43.5, gain: 0.28, loop: 2.5 },
  { s: "ping", at: 46.3, gain: 0.4 },
  ...[46.5, 47.0, 47.5, 48.0, 48.6].map((at) => ({ s: "tick", at, gain: 0.45 })),
  { s: "riser", at: 48.0, gain: 0.55, dur: 2.0 },
  // outro
  { s: "whoosh_b", at: 50.0, gain: 0.6 },
  { s: "final_hit", at: 50.0, gain: 1.0 },
  { s: "sub_drop", at: 50.0, gain: 0.7 },
  { s: "whoosh_a", at: 52.0, gain: 0.4, rate: 0.8 },
  { s: "ping", at: 52.45, gain: 0.35, rate: 0.75 },
  { s: "impact", at: 56.0, gain: 0.55, rate: 0.9 },
];

// Music sections (the score in audio.html follows these).
export const MUSIC = {
  key: "D minor",
  chords: ["Dm", "Bb", "F", "C"], // one per bar
  sections: [
    { from: 0, to: POWER_CUT, mode: "drone" },
    { from: POWER_CUT, to: 6, mode: "silence" },
    { from: 6, to: 10, mode: "drop" },
    { from: 10, to: 18, mode: "groove" },
    { from: 18, to: 28, mode: "groove" },
    { from: 28, to: 36, mode: "full" },
    { from: 36, to: 42, mode: "groove" },
    { from: 42, to: 46, mode: "breakdown" },
    { from: 46, to: 50, mode: "build" },
    { from: 50, to: 56, mode: "full" },
    { from: 56, to: 60, mode: "tail" },
  ],
  risers: [16, 26, 40, 48], // 2 s risers ending on the next bar
};

export const shotAt = (t) => SHOTS.find((s) => t >= s.start && t < s.end) ?? SHOTS[SHOTS.length - 1];
