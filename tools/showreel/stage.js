// OFFGRID showreel: every frame of the film as a pure function of time, window.render(t).
// Nothing animates on its own (no CSS animations, no timers), so render.mjs can film any frame
// exactly and the picture lines up with the soundtrack built from the same timeline.mjs.
import { DURATION, FPS, POWER_CUT } from "./timeline.mjs";

const $ = (s) => document.querySelector(s);
const SCRUB = new URLSearchParams(location.search).has("scrub");

// ---------- math ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
const p = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  lin: (x) => x,
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inCubic: (x) => x * x * x,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outBack: (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  outQuint: (x) => 1 - Math.pow(1 - x, 5),
};
const ez = (t, a, b, e = "outExpo") => E[e](p(t, a, b));
// Keyframes: [[t, value], [t, value, ease], ...]; the ease belongs to the segment ending at that key.
function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e = "inOutCubic"] = keys[i], [t0, v0] = keys[i - 1];
    if (t <= t1) return lerp(v0, v1, E[e](t1 === t0 ? 1 : (t - t0) / (t1 - t0)));
  }
  return keys[keys.length - 1][1];
}
const kfo = (t, keys) => { // keyframes of objects
  const out = {};
  for (const k of Object.keys(keys[0][1])) out[k] = kf(t, keys.map(([tt, v, e]) => [tt, v[k], e]));
  return out;
};
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) / 4294967296; };
const show = (el, o) => { el.style.opacity = o; el.style.visibility = o <= 0.001 ? "hidden" : "visible"; };
const css = (el, o) => Object.assign(el.style, o);
function mk(parent, cls, html = "", style = {}) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  el.innerHTML = html;
  Object.assign(el.style, style);
  parent.append(el);
  return el;
}

// ---------- assets ----------
const FOOT = await (await fetch("/out/footage/footage.json", { cache: "no-store" })).json();
function frame(shot, ft) {
  const fr = FOOT[shot].frames;
  if (ft <= fr[0].t) return `/out/footage/${fr[0].f}`;
  let lo = 0, hi = fr.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fr[mid].t <= ft) lo = mid; else hi = mid - 1; }
  return `/out/footage/${fr[lo].f}`;
}
const lastT = (shot) => FOOT[shot].frames[FOOT[shot].frames.length - 1].t;
const shotImg = (name) => `/repo/docs/screenshots/${name}.png`;
let pending = [];
function setSrc(img, src) {
  if (!src || img._src === src) return;
  img._src = src;
  img.src = src;
  pending.push(img.decode().catch(() => {}));
}

// ---------- the tern (from app/static/icons/logo.svg, split into parts that can move) ----------
const TERN = {
  far: [["#f4f6f8", "M24 29C36 30 49 35 59 45C57 49 55 52 53 54C45 47 35 38 24 29Z"], ["#b9c2cb", "M29 32.5C39 38 47 46 53 54C54.6 52.4 55.8 50.6 56.8 48.6C48 42 38.5 36.3 29 32.5Z"]],
  near: [["#f4f6f8", "M61 51C60 42 60 33 62 24C68 27 74 31 76 36C74 42 71 47 68 52Z"], ["#c9d1d9", "M61 51C60 43 60.2 35 62 27.5C63.6 35 64.6 43 65.6 51.5Z"]],
  body: [["#f4f6f8", "M22 64.5C32 62 40 60 47 58C53 54 61 51 68 51C72 51 75 53 76 56C70 59 63 63 55 63.6C47 64.2 40 63 33 63.6C29 64 25 64.5 22 64.5Z"],
    ["#d5dbe1", "M33 63.6C40 63 47 64.2 55 63.6C61 63.2 66 61 70 59C64 61.5 58 62.2 52 62C45 61.8 39 62.4 33 63.6Z"],
    ["#f4f6f8", "M21 66.6C28 64.6 35 63 41 62.2L41.4 63.2C35 64.3 28 65.6 21 66.6Z"]],
  head: [["#111111", "M67.6 52.6C69.8 50.4 73 50.5 75.6 52.9C74.6 54.1 73 54.6 71 54.7C69.9 53.9 68.8 53.2 67.6 52.6Z"], ["#e03131", "M75.2 54.3L81 57.6L75.6 56.3Z"]],
  feet: [["#e03131", "M47.6 63.2L50 65L51.2 63.4Z"]],
};
let ternId = 0;
function makeTern(el, size) {
  const id = `t${++ternId}`;
  const g = (k) => `<g class="${k}">${TERN[k].map(([f, d]) => `<path fill="${f}" d="${d}"/>`).join("")}</g>`;
  el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 100 100">
    <defs><radialGradient id="${id}" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
    <g class="disc"><circle cx="50" cy="50" r="48" fill="#2b2b2b"/><circle cx="50" cy="50" r="48" fill="url(#${id})"/>
      <circle cx="50" cy="50" r="47.6" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="0.6"/></g>
    <g class="bird">${g("far")}${g("near")}${g("body")}${g("head")}${g("feet")}</g></svg>`;
  const q = (c) => el.querySelector(`.${c}`);
  return { el, disc: q("disc"), bird: q("bird"), far: q("far"), near: q("near"), body: q("body"), head: q("head"), feet: q("feet"), size };
}
function tf(g, { x = 0, y = 0, r = 0, s = 1, ox = 50, oy = 50, o = 1 } = {}) {
  g.setAttribute("transform", `translate(${x} ${y}) translate(${ox} ${oy}) rotate(${r}) scale(${s}) translate(${-ox} ${-oy})`);
  g.setAttribute("opacity", clamp(o));
}
function makeWord(el, text, size) {
  el.style.fontSize = `${size}px`;
  el.innerHTML = [...text].map((c) => `<span class="mask"><span class="ch">${c === " " ? "&nbsp;" : c}</span></span>`).join("");
  return [...el.querySelectorAll(".ch")];
}

// ---------- devices ----------
const world = $("#world");
const BATTERY = `<svg width="27" height="13" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="#cbd5e1" opacity="0.6"/><rect x="2.5" y="2.5" width="13" height="8" rx="2" fill="#fff"/><rect x="24.5" y="4" width="2" height="5" rx="1" fill="#cbd5e1" opacity="0.6"/></svg>`;
function makeLaptop() {
  const el = mk(world, "device laptop", `<div class="lid"><div class="cam-dot"></div><div class="screen"><img alt=""><div class="ov"></div><div class="off"></div><div class="crt"></div></div></div><div class="base"></div>`);
  const d = { el, w: 1520, h: 800, img: el.querySelector("img"), ov: el.querySelector(".ov"), off: el.querySelector(".off"), crt: el.querySelector(".crt"), screen: el.querySelector(".screen") };
  return d;
}
function makePhone() {
  const el = mk(world, "device phone", `<div class="btn" style="left:-4px;top:170px;height:36px"></div><div class="btn" style="left:-4px;top:232px;height:66px"></div>
    <div class="btn" style="left:-4px;top:312px;height:66px"></div><div class="btn" style="right:-4px;top:270px;height:104px"></div>
    <div class="screen"><div class="sbar"><span>9:41</span><span class="r">No Service ${BATTERY}</span></div><img alt=""><div class="ov"></div></div><div class="island"></div>`);
  return { el, w: 418, h: 919, img: el.querySelector("img"), ov: el.querySelector(".ov"), screen: el.querySelector(".screen") };
}
function place(d, { x = 960, y = 540, z = 0, rx = 0, ry = 0, rz = 0, s = 1, o = 1, blur = 0 }) {
  d.el.style.transform = `translate3d(${x - d.w / 2}px, ${y - d.h / 2}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})`;
  d.el.style.filter = blur > 0.05 ? `blur(${blur}px)` : "";
  show(d.el, o);
}
const LAP = makeLaptop();
const PH = makePhone();
const CAROUSEL = ["phone-home", "phone-assistant", "phone-nearest", "phone-reports", "phone-offline", "phone-directions"].map((n) => {
  const d = makePhone();
  d.img.src = shotImg(n);
  return d;
});
const CAROUSEL_LABELS = [["Map", "All of Batangas, offline"], ["Assistant", "Answers from official guides"], ["Places", "Nearest hospital, shelter, clinic"],
  ["Reports", "Neighbors flag flooded roads"], ["Hub off", "The phone answers on its own"], ["Directions", "Turn-by-turn, no internet"]];

// highlights on the screens
const aiHL = mk(LAP.ov, "hl", "", { left: "890px", top: "398px", width: "358px", height: "72px" });
const lapPin = mk(LAP.ov, "ringpin", "<i></i><i></i>", { left: "440px", top: "403px" });
const hubOff = mk(LAP.ov, "", `<div style="display:flex;align-items:center;gap:22px;font-size:64px;font-weight:800;letter-spacing:.14em;color:#e2e8f0"><span style="width:26px;height:26px;border-radius:50%;background:#ff6b6b;box-shadow:0 0 24px #ff6b6b"></span>HUB OFF</div>`,
  { position: "absolute", inset: "0", display: "grid", placeItems: "center", zIndex: 3 });
const phPin = mk(PH.ov, "ringpin", "<i></i><i></i>", { left: "210px", top: `${282 + 47}px` });
const pillHL = mk(PH.ov, "hl", "", { left: "220px", top: "54px", width: "108px", height: "40px", borderRadius: "20px" });

// ---------- logo scene ----------
const logoTern = makeTern($("#logoTern"), 330);
const logoChars = makeWord($("#logoWord"), "OFFGRID", 156);
css($("#logoTern"), { left: `${960 - 165}px`, top: "170px" });
css($("#logoWord"), { top: "540px" });
css($("#logoTag"), { top: "740px", fontSize: "46px" });
css($("#logoGlow"), { left: "160px", top: "-240px", width: "1600px", height: "1200px", background: "radial-gradient(closest-side, rgba(255,122,61,0.30), rgba(255,122,61,0.08) 45%, transparent 70%)" });

// ---------- outro ----------
const outroTern = makeTern($("#outroTern"), 300);
const outroChars = makeWord($("#outroWord"), "OFFGRID", 150);
css($("#outroTern"), { left: `${960 - 150}px`, top: "150px" });
css($("#outroWord"), { top: "500px" });
css($("#outroTag"), { top: "700px", fontSize: "46px" });
const outroSub = $("#outroSub");
outroSub.innerHTML = "Offline emergency map &amp; local AI for Batangas, Philippines";
css(outroSub, { top: "800px", fontSize: "30px", color: "#94a3b8" });
const outroBadges = mk($("#outro"), "", ["No internet needed", "Local AI, checked by code", "Phones work without the hub"]
  .map((s, i) => `<span class="badge" style="position:relative;display:inline-flex;align-items:center;gap:12px"><span style="width:10px;height:10px;border-radius:50%;background:${i === 1 ? "#ff7a3d" : "#40c057"}"></span>${s}</span>`).join(""),
  { position: "absolute", left: "0", right: "0", top: "900px", display: "flex", justifyContent: "center", gap: "22px" });
const outroBadgeEls = [...outroBadges.children];

// ---------- storm ----------
const stormMap = $("#stormMap");
setSrc(stormMap, frame("laptop-fly", 0));
const rainCtx = $("#rain").getContext("2d");
const cloudCtx = $("#cloud").getContext("2d");
const R1 = rng(7);
const DROPS = Array.from({ length: 320 }, () => ({ x: R1() * 2400 - 100, y: R1() * 1500, v: 1700 + R1() * 1200, len: 30 + R1() * 70, a: 0.06 + R1() * 0.22, w: 0.8 + R1() * 1.4 }));
const CLOUD_C = { x: 960, y: 400 };
const LOBES = [[-190, 50, 120], [-70, -40, 150], [80, -70, 135], [210, 30, 110], [10, 60, 155], [-260, 95, 70], [290, 95, 70]];
const R2 = rng(11);
const DOTS = [];
for (let gx = -380; gx <= 380; gx += 17) for (let gy = -230; gy <= 140; gy += 17) {
  if (gy > 140) continue;
  if (!LOBES.some(([cx, cy, r]) => (gx - cx) ** 2 + (gy - cy) ** 2 < r * r)) continue;
  const ang = Math.atan2(gy - 20, gx), sp = 160 + R2() * 520;
  DOTS.push({ x: gx, y: gy, vx: Math.cos(ang) * sp + (R2() - 0.5) * 140, vy: Math.sin(ang) * sp * 0.6 - 120 - R2() * 260, d: (gx + 380) / 760 * 0.35 + R2() * 0.25, ph: R2() });
}
const bars = $("#bars"), wifi = $("#wifi");
bars.innerHTML = [0, 1, 2, 3].map((i) => `<rect x="${i * 23}" y="${42 - (12 + i * 10)}" width="16" height="${12 + i * 10}" rx="3" fill="#e2e8f0"/>`).join("");
wifi.innerHTML = `<circle cx="36" cy="44" r="5" fill="#e2e8f0"/>` + [14, 25, 36].map((r) => `<path d="M${36 - r * 0.78} ${44 - r * 0.62} A${r} ${r} 0 0 1 ${36 + r * 0.78} ${44 - r * 0.62}" fill="none" stroke="#e2e8f0" stroke-width="6" stroke-linecap="round"/>`).join("");
const barEls = [...bars.children], wifiEls = [...wifi.children];
const net = $("#net"), noSig = $("#nosignal");

// ---------- topic (kinetic type) ----------
const topic = $("#topic");
function kline(parent, html, { x, y, size, align = "left", cls = "" }) {
  const outer = mk(parent, `kt ${cls}`, `<div class="line-mask"><div class="inner">${html}</div></div>`, { left: `${x}px`, top: `${y}px`, fontSize: `${size}px` });
  if (align === "center") css(outer, { left: "0", right: "0", textAlign: "center" });
  return { outer, inner: outer.querySelector(".inner") };
}
function reveal(k, t, t0, dur = 0.7, dy = 115) {
  const e = ez(t, t0, t0 + dur);
  k.inner.style.transform = `translateY(${(1 - e) * dy}%)`;
  k.inner.style.filter = e < 0.98 ? `blur(${(1 - e) * 8}px)` : "";
  return e;
}
const tl1 = kline(topic, "Most AI", { x: 170, y: 250, size: 150 });
const tl2 = kline(topic, "goes silent", { x: 170, y: 420, size: 150 });
const tl3 = kline(topic, `<span class="muted">without the</span> internet.`, { x: 176, y: 610, size: 96 });
const cloudIcon = mk(topic, "abs", `<svg width="640" height="460" viewBox="0 0 640 460">
  <g id="cloudShape" fill="#0b1220" stroke="#e2e8f0" stroke-width="10">${[[200, 270, 110], [300, 200, 140], [430, 230, 115], [330, 300, 110]].map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join("")}
  <rect x="200" y="260" width="240" height="150"/></g>
  <g fill="#0b1220">${[[200, 270, 105], [300, 200, 135], [430, 230, 110], [330, 300, 105]].map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join("")}<rect x="200" y="265" width="240" height="140"/></g>
  <line x1="88" y1="404" x2="560" y2="404" stroke="#e2e8f0" stroke-width="10" stroke-linecap="round"/>
  <g fill="none" stroke="#94a3b8" stroke-width="12" stroke-linecap="round">${[44, 80].map((r) => `<path d="M${320 - r * 0.8} ${330 - r * 0.6} A${r} ${r} 0 0 1 ${320 + r * 0.8} ${330 - r * 0.6}"/>`).join("")}</g>
  <circle cx="320" cy="335" r="11" fill="#94a3b8"/>
  <line id="cloudSlash" x1="110" y1="80" x2="560" y2="440" stroke="#ff7a3d" stroke-width="18" stroke-linecap="round" stroke-dasharray="580" stroke-dashoffset="580"/></svg>`,
{ left: "1150px", top: "190px" });
const cloudSlash = cloudIcon.querySelector("#cloudSlash");
const tHead = kline(topic, `This one <span class="accent">runs.</span>`, { x: 0, y: 120, size: 112, align: "center" });
const LAPTOP_ICON = `<svg width="300" height="190" viewBox="0 0 300 190" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="40" y="10" width="220" height="140" rx="12" stroke="#e2e8f0" stroke-width="8"/>
  <path d="M10 172h280" stroke="#e2e8f0" stroke-width="10"/><path d="M80 115l40-45 30 30 50-55" stroke="#ff7a3d" stroke-width="8"/><circle cx="200" cy="45" r="7" fill="#ff7a3d" stroke="none"/></svg>`;
const PHONE_ICON = `<svg width="130" height="200" viewBox="0 0 130 200" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="6" width="110" height="188" rx="22" stroke="#e2e8f0" stroke-width="8"/>
  <path d="M50 24h30" stroke="#e2e8f0" stroke-width="7"/><path d="M65 70c-18 0-28 13-28 27 0 20 28 47 28 47s28-27 28-47c0-14-10-27-28-27z" stroke="#ff7a3d" stroke-width="8"/><circle cx="65" cy="97" r="8" fill="#ff7a3d" stroke="none"/></svg>`;
const card1 = mk(topic, "card", `${LAPTOP_ICON}<div class="lbl">on a laptop <b>in the room</b></div>`);
const card2 = mk(topic, "card", `${PHONE_ICON}<div class="lbl">on the phone <b>in your hand</b></div>`);
const st1 = kline(topic, "Genuinely useful", { x: 0, y: 330, size: 140, align: "center" });
const st2 = kline(topic, `when the cloud <span id="dis" class="accent">${[..."disappears."].map((c) => `<span class="w">${c}</span>`).join("")}</span>`, { x: 0, y: 510, size: 140, align: "center" });
const disChars = [...st2.outer.querySelectorAll("#dis .w")];

// ---------- hub diagram ----------
const diagram = $("#diagram");
const HUB = { x: 960, y: 590 };
const NODES = [{ x: 390, y: 330 }, { x: 1530, y: 320 }, { x: 1500, y: 850 }, { x: 420, y: 840 }];
diagram.innerHTML = `<svg width="1920" height="1080" viewBox="0 0 1920 1080">
  <g id="rings" fill="none" stroke="#2f7a6e">${[0, 1, 2, 3].map(() => `<circle cx="${HUB.x}" cy="${HUB.y}" r="100" stroke-width="3"/>`).join("")}</g>
  <g id="links" stroke="#94a3b8" stroke-width="4" stroke-dasharray="4 14" stroke-linecap="round">${NODES.map((n) => `<line x1="${n.x}" y1="${n.y}" x2="${n.x}" y2="${n.y}"/>`).join("")}</g>
  <g id="nodes">${NODES.map((n) => `<g transform="translate(${n.x - 46} ${n.y - 80})"><rect x="4" y="4" width="84" height="152" rx="18" fill="#121b2e" stroke="#e2e8f0" stroke-width="6"/>
    <path d="M36 20h20" stroke="#e2e8f0" stroke-width="5" stroke-linecap="round"/><circle cx="46" cy="80" r="12" fill="#ff7a3d"/></g>`).join("")}</g>
  <g id="hubIcon" transform="translate(${HUB.x - 170} ${HUB.y - 120})"><rect x="40" y="0" width="260" height="170" rx="16" fill="#121b2e" stroke="#e2e8f0" stroke-width="8"/>
    <path d="M0 196h340" stroke="#e2e8f0" stroke-width="12" stroke-linecap="round"/><circle cx="170" cy="85" r="34" fill="none" stroke="#ff7a3d" stroke-width="8"/><circle cx="170" cy="85" r="10" fill="#ff7a3d"/></g>
  <g id="packets">${[0, 1, 2, 3].map(() => `<circle r="13" fill="#ff7a3d"/>`).join("")}</g>
  <g id="noCloud" transform="translate(890 90)"><path d="M30 100h90a34 34 0 0 0 0-68 50 50 0 0 0-95-8 38 38 0 0 0 5 76z" fill="none" stroke="#94a3b8" stroke-width="7"/>
    <line x1="10" y1="10" x2="132" y2="118" stroke="#ff6b6b" stroke-width="9" stroke-linecap="round"/></g>
  <text x="${HUB.x}" y="${HUB.y + 160}" text-anchor="middle" fill="#ff7a3d" font-size="24" font-weight="700" letter-spacing="7">THE HUB</text>
  <text x="${HUB.x}" y="${HUB.y + 210}" text-anchor="middle" fill="#e2e8f0" font-size="36" font-weight="700">Local Wi-Fi · no internet</text></svg>`;
const D = {
  rings: [...diagram.querySelectorAll("#rings circle")], links: [...diagram.querySelectorAll("#links line")],
  nodes: [...diagram.querySelectorAll("#nodes > g")], hub: diagram.querySelector("#hubIcon"), packets: [...diagram.querySelectorAll("#packets circle")],
  noCloud: diagram.querySelector("#noCloud"), texts: [...diagram.querySelectorAll("text")],
};

// ---------- text overlays (device scenes) ----------
const texts = $("#texts");
const chip = (html, dot = "") => mk(texts, "chip", `<span class="dot ${dot}"></span>${html}`);
const typoChip = chip(`<span class="muted" style="font-size:22px;letter-spacing:.12em;text-transform:uppercase">Typo</span><s>wlak thru</s> → <b>walk through</b>`);
const lapChips = [chip("Local AI · Qwen 2.5 3B, on this laptop"), chip("Every fact checked by code", "ok"), chip("English · Filipino · Taglish")];
const phHead = kline(texts, `On the <span class="accent">phone.</span>`, { x: 150, y: 210, size: 120 });
const ICONS = {
  map: `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#ff7a3d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>`,
  hosp: `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#ff7a3d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`,
  route: `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#ff7a3d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/></svg>`,
};
const feats = [["map", "Offline map of all Batangas"], ["hosp", "Nearest hospitals"], ["route", "Turn-by-turn directions"]]
  .map(([ic, s], i) => mk(texts, "feat", `<span class="ic">${ICONS[ic]}</span>${s}`, { top: `${470 + i * 140}px` }));
const carLabel = mk(texts, "label-under", "", { top: "968px" });
const hubChips = [chip("Phone: “road flooded” here"), chip("Laptop map, seconds later", "ok")];
const plugQ = kline(texts, `<span class="muted">And when the laptop dies?</span>`, { x: 150, y: 190, size: 58 });
const plugH1 = kline(texts, "The phone", { x: 150, y: 290, size: 128 });
const plugH2 = kline(texts, `<span class="accent">keeps going.</span>`, { x: 150, y: 430, size: 128 });
const ospChip = chip(`<span class="muted" style="font-size:22px;letter-spacing:.12em;text-transform:uppercase">Typo</span><s>ospitl</s> → <b>ospital</b>`);
const COUNTERS = [
  { to: 46, unit: "MB", cap: "offline copy on the phone", x: 150, y: 640 },
  { to: 0, from: 1024, unit: "bytes", cap: "needed from the cloud", x: 640, y: 640 },
  { to: 1758, unit: "", cap: "places mapped", x: 150, y: 840 },
  { to: 19325, unit: "km", cap: "of road, routable offline", x: 640, y: 840 },
].map((c) => ({ ...c, el: mk(texts, "counter", `<div class="num"><span>0</span><small>${c.unit}</small></div><div class="cap">${c.cap}</div><div class="bar"></div>`, { left: `${c.x}px`, top: `${c.y}px` }) }));
COUNTERS.forEach((c) => { c.num = c.el.querySelector(".num span"); c.bar = c.el.querySelector(".bar"); });
const phoneBadge = mk(texts, "badge", "Built for Android 8 phones with 2 GB of RAM", { left: "150px", top: "1000px" });
const footer = $("#footer");

// glow behind the phone
const glow = $("#glow");
css(glow, { width: "900px", height: "900px", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,122,61,0.35), rgba(255,122,61,0.08) 55%, transparent 75%)" });

// ---------- overlays ----------
const fx = $("#fx").getContext("2d");
const flashEl = $("#flash"), blackEl = $("#black"), shakeEl = $("#shake"), camEl = $("#cam");
const grainCtx = $("#grain").getContext("2d");
const GRAIN = [0, 1, 2, 3].map((k) => {
  const c = new OffscreenCanvas(960, 540), g = c.getContext("2d"), img = g.createImageData(960, 540), r = rng(100 + k);
  for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
});
const HITS = [[6.0, 0.7], [18.0, 0.22], [28.0, 0.2], [33.0, 0.12], [36.0, 0.15], [42.0, 0.15], [50.0, 0.3], [2.35, 0.22], [3.62, 0.35]];
const SHAKES = [[6.0, 1.0], [18.0, 0.45], [28.0, 0.35], [42.0, 0.5], [50.0, 0.8], [56.0, 0.25]];
const SPARKS = (() => { const r = rng(5); return Array.from({ length: 70 }, () => ({ a: r() * Math.PI * 2, v: 300 + r() * 900, s: 1.5 + r() * 3.5, hue: r() })); })();

// Screen position of an element's centre (works through the 3D transforms).
let stageScale = 1;
function centerOf(el) { const r = el.getBoundingClientRect(); return { x: (r.left + r.width / 2) / stageScale, y: (r.top + r.height / 2) / stageScale }; }

// ===================================================================================
function render(t) {
  // ---- storm 0 - 5.5 ----
  const storm = $("#storm");
  if (t < POWER_CUT) {
    show(storm, 1);
    const s = lerp(2.4, 2.15, ez(t, 0, 6, "outCubic"));
    css(stormMap, { width: "1280px", height: "720px", transform: `translate(${960 - 470 * s}px, ${540 - 420 * s}px) scale(${s})` });
    // rain
    rainCtx.clearRect(0, 0, 1920, 1080);
    const rainI = ez(t, 0, 1.2, "outCubic");
    rainCtx.lineCap = "round";
    for (const d of DROPS) {
      const y = ((d.y + d.v * t) % 1500) - 200, x = d.x - 0.24 * y;
      rainCtx.strokeStyle = `rgba(190,210,235,${d.a * rainI})`; rainCtx.lineWidth = d.w;
      rainCtx.beginPath(); rainCtx.moveTo(x, y); rainCtx.lineTo(x + 0.24 * d.len, y - d.len); rainCtx.stroke();
    }
    // the dot cloud: it flickers as the signal drops, then breaks apart
    cloudCtx.clearRect(0, 0, 1920, 1080);
    const lostFrac = clamp((t - 1.4) / 2.2) * 0.75;
    cloudCtx.shadowColor = "rgba(150,190,255,0.9)"; cloudCtx.shadowBlur = 14;
    for (let i = 0; i < DOTS.length; i++) {
      const d = DOTS[i];
      let a = ez(t, 0.1 + d.ph * 0.9, 0.6 + d.ph * 0.9, "outCubic");
      if (hash(i, Math.floor(t * 14)) < lostFrac) a *= 0.15;
      let x = CLOUD_C.x + d.x, y = CLOUD_C.y + d.y + Math.sin(t * 1.3 + d.ph * 6) * 2;
      const st = t - 3.6 - d.d;
      if (st > 0) { x += d.vx * st; y += d.vy * st + 0.5 * 1100 * st * st; a *= 1 - clamp(st / 1.1); }
      if (a <= 0.01) continue;
      cloudCtx.fillStyle = `rgba(225,236,255,${a})`;
      cloudCtx.beginPath(); cloudCtx.arc(x, y, st > 0 ? 3.4 : 3.6, 0, Math.PI * 2); cloudCtx.fill();
    }
    cloudCtx.shadowBlur = 0;
    // status bar dying
    const drops = [3.0, 2.5, 2.0, 1.5];
    barEls.forEach((b, i) => { const k = ez(t, drops[i], drops[i] + 0.25); b.setAttribute("opacity", lerp(1, 0.16, k)); b.setAttribute("transform", `translate(0 ${k * 6})`); });
    const wdrops = [3.0, 2.5, 2.0, 1.5];
    wifiEls.forEach((w, i) => w.setAttribute("opacity", lerp(1, 0.16, ez(t, wdrops[i], wdrops[i] + 0.25))));
    net.textContent = t < 1.5 ? "LTE" : t < 2.5 ? "E" : "No Service";
    net.style.color = t < 3.0 ? "#e2e8f0" : "#ff6b6b";
    const hudIn = ez(t, 0.2, 1.2);
    css($("#hud-left"), { opacity: hudIn, transform: `translateY(${(1 - hudIn) * -20}px)` });
    css($("#hud-right"), { opacity: hudIn, transform: `translateY(${(1 - hudIn) * -20}px)` });
    // NO SIGNAL with an RGB split while it glitches in
    const ns = t >= 3.55 ? 1 : 0;
    const glitching = (t >= 3.55 && t < 4.15) || (t >= 4.75 && t < 4.95);
    const gj = glitching ? (hash(Math.floor(t * 30), 3) - 0.5) * 34 : 0;
    css(noSig, { opacity: ns * (glitching && hash(Math.floor(t * 30), 9) < 0.2 ? 0.3 : 1), transform: `translateX(${gj}px)`,
      textShadow: glitching ? `${gj * 0.6 + 6}px 0 rgba(255,70,70,.85), ${-gj * 0.6 - 6}px 0 rgba(70,200,255,.85)` : "0 0 40px rgba(255,255,255,.25)" });
    // the power cut: a few frames of flicker, then black
    const flick = t > 5.3 ? (hash(Math.floor(t * 40), 1) < 0.5 ? 0.15 : 1) : 1;
    storm.style.filter = t > 5.3 ? `brightness(${flick * 1.6})` : "";
  } else show(storm, 0);

  // ---- shared background ----
  const bgO = t < 6 ? 0 : t > 58.6 ? 1 - ez(t, 58.6, 60, "inOutCubic") : 1;
  show($("#bg"), bgO);
  if (bgO > 0) {
    css($("#bg .b1"), { left: `${1100 + Math.sin(t * 0.31) * 220}px`, top: `${-200 + Math.cos(t * 0.27) * 150}px` });
    css($("#bg .b2"), { left: `${-300 + Math.cos(t * 0.23) * 200}px`, top: `${400 + Math.sin(t * 0.29) * 160}px` });
    css($("#bg .b3"), { left: `${600 + Math.sin(t * 0.19 + 1) * 300}px`, top: `${500 + Math.cos(t * 0.21) * 120}px` });
    $("#dots").style.transform = `translate(${(t * 12) % 40}px, ${(t * 7) % 40}px)`;
  }

  // ---- logo 6 - 10 ----
  const logo = $("#logo");
  if (t >= 6 && t < 10.1) {
    const exit = ez(t, 9.72, 10.05, "inExpo");
    show(logo, 1 - exit * 0.2);
    css(logo, { transform: `translateX(${-exit * 2300}px) scale(${1 + ez(t, 7, 9.7, "outCubic") * 0.04})`, filter: exit > 0.01 ? `blur(${exit * 24}px)` : "" });
    const T = logoTern;
    tf(T.disc, { s: lerp(0.0001, 1, ez(t, 6.0, 6.6, "outBack")), o: ez(t, 6.0, 6.15) });
    const fw = ez(t, 6.08, 6.8), nw = ez(t, 6.16, 6.86), bd = ez(t, 6.12, 6.78), hd = ez(t, 6.62, 6.95, "outBack");
    tf(T.far, { x: (1 - fw) * -60, y: (1 - fw) * -45, r: (1 - fw) * -35, ox: 56, oy: 50, o: fw * 3 });
    tf(T.near, { x: (1 - nw) * 25, y: (1 - nw) * -70, r: (1 - nw) * 40, ox: 63, oy: 51, o: nw * 3 });
    tf(T.body, { x: (1 - bd) * -90, y: (1 - bd) * 12, o: bd * 3 });
    tf(T.head, { s: Math.max(0.0001, hd), ox: 72, oy: 54, o: hd });
    tf(T.feet, { s: Math.max(0.0001, hd), ox: 49, oy: 64, o: hd });
    const flap = Math.sin((t - 6.9) * 2.2) * 2 * ez(t, 6.9, 7.6);
    tf(T.bird, { y: Math.sin((t - 6.8) * 1.6) * 1.2 * ez(t, 6.8, 7.5), r: flap * 0.3 });
    logoChars.forEach((c, i) => { const e = ez(t, 6.5 + i * 0.05, 7.2 + i * 0.05); c.style.transform = `translateY(${(1 - e) * 110}%)`; });
    const tg = ez(t, 7.25, 8.2, "outCubic");
    css($("#logoTag"), { opacity: tg, letterSpacing: `${lerp(0.4, 0.02, tg)}em` });
    const gl = ez(t, 6.0, 6.5) * (0.75 + 0.25 * Math.sin(t * 2));
    show($("#logoGlow"), gl);
  } else show(logo, 0);

  // ---- topic 10 - 18 ----
  if (t >= 9.95 && t < 18.0) {
    show(topic, 1);
    // part 1: "Most AI goes silent without the internet."
    const out1 = ez(t, 12.95, 13.3, "inExpo");
    [tl1, tl2, tl3].forEach((k, i) => {
      reveal(k, t, [10.1, 10.8, 11.5][i], 0.65);
      css(k.outer, { opacity: 1 - out1, transform: `translateY(${-out1 * (80 + i * 30)}px)` });
    });
    const cl = ez(t, 10.2, 11.0, "outCubic");
    const cloudGl = t > 12.75 && t < 13.2 ? (hash(Math.floor(t * 30), 4) < 0.45 ? 0.2 : 1) : 1;
    css(cloudIcon, { opacity: cl * (1 - out1) * cloudGl, clipPath: `inset(0 ${(1 - cl) * 100}% 0 0)`, transform: `translateY(${Math.sin(t * 1.4) * 8}px)` });
    cloudSlash.setAttribute("stroke-dashoffset", 580 * (1 - ez(t, 12.35, 12.7, "outCubic")));
    // part 2: "This one runs on a laptop in the room, and on the phone in your hand."
    const out2 = ez(t, 16.12, 16.45, "inExpo");
    reveal(tHead, t, 13.3, 0.6);
    css(tHead.outer, { opacity: 1 - out2, transform: `translateY(${-out2 * 160}px)` });
    for (const [c, t0, x] of [[card1, 14.35, 560], [card2, 15.75, 1360]]) {
      const e = ez(t, t0, t0 + 0.55, "outBack");
      css(c, { left: `${x - 350}px`, top: "330px", opacity: clamp(e * 2) * (1 - out2), transform: `translateY(${(1 - e) * 240 - out2 * 260}px) rotate(${(1 - e) * (x < 960 ? -6 : 6)}deg) scale(${lerp(0.85, 1, e)})` });
    }
    // part 3: the topic statement; "disappears." dissolves into the cut
    reveal(st1, t, 16.55, 0.6);
    reveal(st2, t, 16.82, 0.6);
    disChars.forEach((c, i) => {
      const d = ez(t, 17.3 + i * 0.045, 17.75 + i * 0.045, "inCubic");
      css(c, { opacity: 1 - d, transform: `translateY(${-d * 70}px) rotate(${d * (hash(i, 2) - 0.5) * 50}deg)`, filter: d > 0.02 ? `blur(${d * 10}px)` : "" });
    });
    css(st1.outer, { opacity: 1 - ez(t, 17.75, 18.0) });
    st2.outer.style.opacity = 1 - ez(t, 17.82, 17.98);
  } else show(topic, 0);

  // ---- devices ----
  renderDevices(t);
  renderTexts(t);
  renderDiagram(t);
  renderOutro(t);

  // ---- footer ----
  // footer: hidden while the camera is pushed into the laptop screen and during the counters
  const win = (a, b) => Math.min(ez(t, a, a + 0.4), 1 - ez(t, b - 0.3, b));
  show(footer, 0.85 * Math.max(0, t < 19.6 ? win(18.4, 19.6) : t < 33.1 ? win(25.0, 33.1) : t < 45.6 ? win(37.9, 45.6) : 0));

  // ---- fx canvas: shockwaves, sparks, the report packet ----
  fx.clearRect(0, 0, 1920, 1080);
  for (const [h, cx, cy] of [[6.0, 960, 335], [50.0, 960, 540]]) {
    const k = t - h;
    if (k < 0 || k > 1.2) continue;
    const e = E.outCubic(k / 1.2);
    fx.strokeStyle = `rgba(255,160,110,${(1 - e) * 0.8})`; fx.lineWidth = 40 * (1 - e) + 1;
    fx.beginPath(); fx.arc(cx, cy, 40 + e * 1300, 0, Math.PI * 2); fx.stroke();
    fx.strokeStyle = `rgba(255,255,255,${(1 - e) * 0.5})`; fx.lineWidth = 6 * (1 - e);
    fx.beginPath(); fx.arc(cx, cy, 20 + e * 900, 0, Math.PI * 2); fx.stroke();
    for (const s of SPARKS) {
      const d = s.v * E.outCubic(Math.min(1, k / 0.9));
      fx.fillStyle = s.hue < 0.6 ? `rgba(255,140,80,${1 - e})` : `rgba(255,255,255,${1 - e})`;
      fx.beginPath(); fx.arc(cx + Math.cos(s.a) * d, cy + Math.sin(s.a) * d, s.s * (1 - e * 0.6), 0, Math.PI * 2); fx.fill();
    }
  }
  if (t >= 39.8 && t <= 40.45) {
    const a = centerOf(phPin), b = centerOf(lapPin);
    const k = ez(t, 39.87, 40.32, "inOutCubic");
    const pt = (u) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) - Math.sin(u * Math.PI) * 220 });
    for (let i = 14; i >= 0; i--) {
      const u = clamp(k - i * 0.022);
      const q = pt(u);
      fx.fillStyle = `rgba(255,122,61,${(1 - i / 15) * (t > 40.32 ? 1 - p(t, 40.32, 40.45) : 1)})`;
      fx.beginPath(); fx.arc(q.x, q.y, 14 - i * 0.6, 0, Math.PI * 2); fx.fill();
    }
  }

  // ---- camera shake, flashes, grain, black ----
  let sx = 0, sy = 0;
  for (const [h, s] of SHAKES) { const k = t - h; if (k >= 0 && k < 0.6) { const a = s * Math.exp(-k * 8) * 16; sx += Math.sin(k * 95) * a; sy += Math.cos(k * 83) * a; } }
  shakeEl.style.transform = `translate(${sx}px, ${sy}px)`;
  let fl = 0;
  for (const [h, s] of HITS) { const k = t - h; if (k >= 0 && k < 0.6) fl = Math.max(fl, s * Math.exp(-k * 9)); }
  flashEl.style.opacity = fl;
  const blk = t >= POWER_CUT && t < 6 ? 1 : t > 58.6 ? ez(t, 58.6, 59.9, "inOutCubic") : 0;
  blackEl.style.opacity = blk;
  const gi = Math.floor(t * FPS) % GRAIN.length;
  grainCtx.drawImage(GRAIN[gi], 0, 0);
}

// ===================================================================================
function renderDevices(t) {
  // camera (2D zoom of the device layer)
  let cam = { s: 1, fx: 960, fy: 540 };
  if (t >= 18 && t < 28) cam = kfo(t, [[19.5, { s: 1, fx: 960, fy: 540 }], [20.6, { s: 1.6, fx: 1330, fy: 760 }, "inOutCubic"], [22.6, { s: 1.62, fx: 1300, fy: 770 }, "lin"],
    [23.5, { s: 1.75, fx: 1280, fy: 510 }, "inOutCubic"], [24.3, { s: 1.75, fx: 1270, fy: 505 }, "lin"], [25.0, { s: 1, fx: 960, fy: 540 }, "inOutCubic"]]);
  else if (t >= 50) cam = { s: lerp(1, 1.06, ez(t, 50, 53, "outCubic")), fx: 960, fy: 540 };
  camEl.style.transform = `translate(${960 - cam.fx * cam.s}px, ${540 - cam.fy * cam.s}px) scale(${cam.s})`;

  // ---- laptop ----
  let L = null;
  if (t >= 17.95 && t < 28.05) {
    L = kfo(t, [[18.0, { x: 1500, y: 760, z: -1800, rx: 24, ry: -58, rz: 8, s: 0.98 }], [19.2, { x: 960, y: 560, z: 0, rx: 7, ry: -9, rz: 0, s: 0.98 }, "outExpo"],
      [24.4, { x: 960, y: 560, z: 0, rx: 6, ry: -6, rz: 0, s: 0.98 }, "lin"], [25.0, { x: 730, y: 555, z: 0, rx: 6, ry: 14, rz: 0, s: 0.82 }, "inOutCubic"],
      [27.65, { x: 715, y: 555, z: 0, rx: 6, ry: 16, rz: 0, s: 0.83 }, "lin"], [28.0, { x: -700, y: 520, z: -400, rx: 6, ry: 60, rz: -4, s: 0.8 }, "inExpo"]]);
    L.o = 1;
    setSrc(LAP.img, frame("laptop-ai", t - 19.1));
  } else if (t >= 37.75 && t < 50) {
    const ent = ez(t, 37.8, 38.4);
    L = { x: 1270, y: 540, z: lerp(-500, 0, ent), rx: 4, ry: -14, rz: 0, s: 0.6, o: ent };
    if (t >= 42.9) Object.assign(L, kfo(t, [[42.9, { x: 1270, z: 0, s: 0.6, ry: -14 }], [43.8, { x: 1720, z: -1100, s: 0.6, ry: -30 }, "inOutCubic"]]), { o: lerp(1, 0, ez(t, 43.1, 43.8)) });
    setSrc(LAP.img, frame("report-laptop", t - 40.0));
  } else if (t >= 49.9) {
    const ent = ez(t, 49.9, 50.8);
    L = { x: lerp(860, 800, ent), y: 520, z: lerp(300, 0, ent), rx: 5, ry: 15, rz: 0, s: 0.78, o: clamp(ent * 3) };
    const fade = ez(t, 51.9, 52.6, "inOutCubic");
    L.o *= lerp(1, 0.12, fade); L.blur = fade * 10; L.s *= lerp(1, 0.94, fade);
    setSrc(LAP.img, t < 50.4 ? frame("laptop-fly", 99) : frame("laptop-light", t - 50.4));
  }
  if (L) place(LAP, L); else show(LAP.el, 0);
  // power cut on the laptop screen (old-TV collapse)
  const crtA = ez(t, 42.0, 42.12, "inCubic"), crtB = ez(t, 42.12, 42.3, "inCubic");
  const dead = t >= 42.0 && t < 50;
  LAP.img.style.transform = dead ? `scale(${1 - crtB}, ${Math.max(0.004, 1 - crtA)})` : "";
  LAP.img.style.filter = dead && t < 42.3 ? `brightness(${1 + crtA * 3})` : "";
  show(LAP.off, dead ? ez(t, 42.25, 42.32) : 0);
  show(LAP.crt, dead && t >= 42.1 && t < 42.34 ? 1 - ez(t, 42.28, 42.34) : 0);
  if (dead) css(LAP.crt, { transform: `scaleX(${1 - crtB})` });
  show(hubOff, dead ? ez(t, 42.3, 42.5) : 0);
  show(aiHL, t >= 23.7 && t < 26.6 ? Math.min(ez(t, 23.7, 24.0), 1 - ez(t, 26.2, 26.6)) : 0);
  aiHL.style.transform = `scale(${lerp(1.15, 1, ez(t, 23.7, 24.1, "outBack"))})`;
  const lapRing = t >= 40.3 && t < 42 ? 1 : 0;
  show(lapPin, lapRing);
  if (lapRing) [...lapPin.children].forEach((r, i) => { const k = ((t - 40.3 + i * 0.5) % 1) ; css(r, { transform: `scale(${0.5 + k * 1.6})`, opacity: 1 - k }); });

  // ---- phone ----
  let P = null;
  if (t >= 27.95 && t < 33.05) {
    P = kfo(t, [[28.0, { x: 2400, y: 600, z: -600, rx: 10, ry: -75, rz: -10, s: 1 }], [28.9, { x: 1350, y: 545, z: 0, rx: 3, ry: -12, rz: 0, s: 1 }, "outExpo"],
      [32.8, { x: 1330, y: 540, z: 0, rx: 2, ry: -6, rz: 0, s: 1.02 }, "lin"], [33.05, { x: 960, y: 540, z: -500, rx: 0, ry: 0, rz: 0, s: 0.8 }, "inExpo"]]);
    P.y += Math.sin(t * 1.5) * 6;
    P.o = 1;
    setSrc(PH.img, t < 30.4 ? frame("phone-launch", t - 28.0) : t < 32.0 ? frame("phone-offline", t - 30.4 + 3.0) : frame("phone-offline", t - 32.0 + 5.3));
  } else if (t >= 37.75 && t < 50) {
    const ent = ez(t, 37.8, 38.4);
    P = { x: 520, y: 560, z: lerp(-500, 0, ent), rx: 3, ry: 12, rz: 0, s: 0.92, o: ent };
    if (t >= 42.8) Object.assign(P, kfo(t, [[42.8, { x: 520, y: 560, ry: 12, s: 0.92 }], [43.7, { x: 1360, y: 545, ry: -9, s: 1.0 }, "inOutCubic"]]));
    if (t >= 43.7) P.y += Math.sin((t - 43.7) * 1.5) * 6;
    setSrc(PH.img, t < 43.0 ? frame("report-phone", t - 37.8 + 1.0) : frame("phone-offline", t - 43.0));
  } else if (t >= 49.9) {
    const ent = ez(t, 49.9, 50.8);
    P = { x: lerp(1460, 1400, ent), y: 570, z: lerp(300, 0, ent), rx: 3, ry: -14, rz: 0, s: 0.92, o: clamp(ent * 3) };
    const fade = ez(t, 51.9, 52.6, "inOutCubic");
    P.o *= lerp(1, 0.12, fade); P.blur = fade * 10; P.s *= lerp(1, 0.94, fade);
    setSrc(PH.img, frame("phone-offline", 99));
  }
  if (P) place(PH, P); else show(PH.el, 0);
  const phRing = t >= 39.6 && t < 41.2 ? 1 : 0;
  show(phPin, phRing);
  if (phRing) [...phPin.children].forEach((r, i) => { const k = ((t - 39.6 + i * 0.5) % 1); css(r, { transform: `scale(${0.4 + k * 1.4})`, opacity: 1 - k }); });
  show(pillHL, t >= 46.3 && t < 47.9 ? Math.min(ez(t, 46.3, 46.55), 1 - ez(t, 47.5, 47.9)) : 0);
  pillHL.style.transform = `scale(${lerp(1.3, 1, ez(t, 46.3, 46.7, "outBack"))})`;
  // glow behind the phone while the hub is off
  const go = t >= 42.4 && t < 50 ? ez(t, 43.0, 43.9) * (0.75 + 0.25 * Math.sin(t * 2.4)) : 0;
  show(glow, go);
  if (go > 0) css(glow, { left: `${(P?.x ?? 1340) - 450}px`, top: `${(P?.y ?? 545) - 450}px` });

  // ---- carousel 33 - 36 ----
  const inCar = t >= 32.95 && t < 36.1;
  const steps = [33.5, 34.0, 34.5, 35.0];
  const c = steps.reduce((a, s) => a + ez(t, s, s + 0.42), 0);
  const enter = ez(t, 33.0, 33.5), exit = ez(t, 35.6, 36.05, "inExpo");
  CAROUSEL.forEach((d, i) => {
    if (!inCar) { show(d.el, 0); return; }
    const k = i - c;
    place(d, {
      x: 960 + k * 470 + (1 - enter) * 1500, y: 520 + exit * 40, z: -Math.abs(k) * 320 - exit * 600,
      ry: clamp(-k * 24, -60, 60), rx: 2, s: (0.94 - 0.14 * Math.min(1.5, Math.abs(k))) * (1 - exit * 0.2), o: clamp(1.9 - Math.abs(k) * 0.55) * (1 - exit),
    });
  });
  const ci = clamp(Math.round(c), 0, CAROUSEL_LABELS.length - 1);
  carLabel.innerHTML = `<small>${CAROUSEL_LABELS[ci][0]}</small>${CAROUSEL_LABELS[ci][1]}`;
  show(carLabel, inCar ? enter * (1 - exit) : 0);
}

// ===================================================================================
function renderTexts(t) {
  // laptop: typo chip + three callouts
  const tyo = t >= 20.7 && t < 23.2 ? Math.min(ez(t, 20.75, 21.2, "outBack"), 1 - ez(t, 22.9, 23.2)) : 0;
  show(typoChip, clamp(tyo));
  css(typoChip, { left: "880px", top: "880px", transform: `translateY(${(1 - tyo) * 40}px) scale(${lerp(0.9, 1, tyo)})` });
  lapChips.forEach((c, i) => {
    const e = t >= 24.4 && t < 28.1 ? ez(t, 24.5 + i * 0.5, 24.95 + i * 0.5, "outBack") : 0;
    const out = ez(t, 27.55, 27.9, "inExpo");
    show(c, clamp(e * 2) * (1 - out));
    css(c, { left: "1370px", top: `${330 + i * 130}px`, transform: `translateX(${(1 - e) * 120 + out * 300}px)` });
  });

  // phone: headline + features
  const pin = t >= 28.0 && t < 33.1;
  const pout = ez(t, 32.75, 33.0, "inExpo");
  show(phHead.outer, pin ? 1 - pout : 0);
  if (pin) reveal(phHead, t, 28.3, 0.6);
  feats.forEach((f, i) => {
    const e = pin ? ez(t, [29.47, 30.55, 32.0][i], [29.47, 30.55, 32.0][i] + 0.5, "outBack") : 0;
    show(f, clamp(e * 2) * (1 - pout));
    css(f, { transform: `translateX(${(1 - e) * -120}px)` });
  });

  // hub split chips
  hubChips.forEach((c, i) => {
    const t0 = [38.7, 40.4][i];
    const e = t >= t0 && t < 42.3 ? ez(t, t0, t0 + 0.45, "outBack") : 0;
    const out = ez(t, 41.9, 42.2);
    show(c, clamp(e * 2) * (1 - out));
    css(c, i === 0 ? { left: "300px", top: "40px", transform: `translateY(${(1 - e) * -40}px)` } : { left: "1040px", top: "190px", transform: `translateY(${(1 - e) * -40}px)` });
  });

  // plug: question, headline, typo chip, counters
  const plug = t >= 42.8 && t < 50.2;
  const plOut = ez(t, 49.7, 50.0, "inExpo");
  show(plugQ.outer, plug ? 1 - plOut : 0); if (plug) reveal(plugQ, t, 43.0, 0.6);
  show(plugH1.outer, plug ? 1 - plOut : 0); if (plug) reveal(plugH1, t, 44.72, 0.6);
  show(plugH2.outer, plug ? 1 - plOut : 0); if (plug) reveal(plugH2, t, 45.0, 0.6);
  const oe = t >= 44.6 && t < 46.6 ? Math.min(ez(t, 44.6, 45.0, "outBack"), 1 - ez(t, 46.2, 46.6)) : 0;
  show(ospChip, clamp(oe));
  css(ospChip, { left: "740px", top: "690px", transform: `translateX(${(1 - oe) * -50}px)` });
  COUNTERS.forEach((c, i) => {
    const t0 = 46.5 + i * 0.5;
    const e = plug ? ez(t, t0, t0 + 0.45, "outBack") : 0;
    show(c.el, clamp(e * 2) * (1 - plOut));
    c.el.style.transform = `translateY(${(1 - e) * 50}px)`;
    const roll = E.outCubic(p(t, t0, t0 + 0.7));
    const v = Math.round(lerp(c.from ?? 0, c.to, roll));
    c.num.textContent = v.toLocaleString("en-US");
    c.bar.style.transform = `scaleX(${ez(t, t0 + 0.1, t0 + 0.8, "outCubic") * 0.6})`;
  });
  const be = plug ? ez(t, 48.6, 49.0, "outBack") : 0;
  show(phoneBadge, clamp(be * 2) * (1 - plOut));
  phoneBadge.style.transform = `translateY(${(1 - be) * 30}px)`;
}

// ===================================================================================
function renderDiagram(t) {
  const on = t >= 35.95 && t < 38.2;
  show(diagram, on ? 1 - ez(t, 37.75, 38.15, "inCubic") : 0);
  if (!on) return;
  const zoom = ez(t, 37.7, 38.15, "inExpo");
  diagram.style.transform = `translate(${HUB.x}px, ${HUB.y}px) scale(${1 + zoom * 1.8}) translate(${-HUB.x}px, ${-HUB.y}px)`;
  const hubIn = ez(t, 36.0, 36.45, "outBack");
  D.hub.setAttribute("transform", `translate(${HUB.x} ${HUB.y}) scale(${Math.max(0.001, hubIn)}) translate(-170 -120)`);
  D.nodes.forEach((n, i) => {
    const e = ez(t, 36.1 + i * 0.08, 36.55 + i * 0.08, "outBack");
    const N = NODES[i];
    n.setAttribute("transform", `translate(${N.x} ${N.y}) scale(${Math.max(0.001, e)}) translate(-46 -80)`);
  });
  D.links.forEach((l, i) => {
    const e = ez(t, 36.3 + i * 0.08, 36.8 + i * 0.08, "outCubic");
    const N = NODES[i];
    l.setAttribute("x1", N.x); l.setAttribute("y1", N.y);
    l.setAttribute("x2", lerp(N.x, HUB.x, e)); l.setAttribute("y2", lerp(N.y, HUB.y, e));
    l.setAttribute("stroke-dashoffset", -t * 40);
  });
  D.rings.forEach((r, i) => {
    const k = ((t - 36.2) * 0.7 + i / 4) % 1;
    r.setAttribute("r", 140 + k * 520);
    r.setAttribute("opacity", t < 36.2 ? 0 : (1 - k) * 0.55);
  });
  D.noCloud.setAttribute("opacity", ez(t, 36.5, 36.9));
  D.texts.forEach((x, i) => x.setAttribute("opacity", ez(t, 36.5 + i * 0.12, 36.9 + i * 0.12)));
  // packets: phone 0 -> hub, then hub -> the other phones
  D.packets.forEach((c, i) => {
    let pos = null;
    if (i === 0) { const k = ez(t, 36.95, 37.4, "inOutCubic"); if (t > 36.95 && t < 37.45) pos = { x: lerp(NODES[0].x, HUB.x, k), y: lerp(NODES[0].y, HUB.y, k) }; }
    else { const k = ez(t, 37.4, 37.85, "inOutCubic"); if (t > 37.4 && t < 37.9) pos = { x: lerp(HUB.x, NODES[i].x, k), y: lerp(HUB.y, NODES[i].y, k) }; }
    c.setAttribute("opacity", pos ? 1 : 0);
    if (pos) { c.setAttribute("cx", pos.x); c.setAttribute("cy", pos.y); }
  });
}

// ===================================================================================
function renderOutro(t) {
  const out = $("#outro");
  if (t < 51.3) { show(out, 0); return; }
  show(out, 1);
  const T = outroTern;
  // the tern flies in on an arc, flapping, and lands as the disc pops in behind it
  const fly = ez(t, 51.4, 52.6, "outCubic");
  const bx = lerp(-700, 0, fly), by = -Math.sin(fly * Math.PI) * 120 + (1 - fly) * 260;
  const flapAmt = 1 - ez(t, 52.35, 52.75);
  const flap = Math.sin((t - 51.4) * Math.PI * 2 * 3.2) * 28 * flapAmt;
  tf(T.bird, { x: bx / 3, y: by / 3, s: lerp(0.55, 1, fly), r: (1 - fly) * -12, o: ez(t, 51.4, 51.6) });
  tf(T.far, { r: flap * 0.8, ox: 56, oy: 50 });
  tf(T.near, { r: -flap, ox: 63, oy: 51 });
  tf(T.body, {}); tf(T.head, {}); tf(T.feet, {});
  tf(T.disc, { s: Math.max(0.0001, ez(t, 52.45, 52.95, "outBack")), o: ez(t, 52.45, 52.55) });
  outroChars.forEach((c, i) => { const e = ez(t, 52.6 + i * 0.05, 53.3 + i * 0.05); c.style.transform = `translateY(${(1 - e) * 110}%)`; });
  const tg = ez(t, 53.6, 54.4, "outCubic");
  css($("#outroTag"), { opacity: tg, letterSpacing: `${lerp(0.4, 0.02, tg)}em` });
  const sb = ez(t, 54.5, 55.2, "outCubic");
  css(outroSub, { opacity: sb, transform: `translateY(${(1 - sb) * 20}px)` });
  outroBadgeEls.forEach((b, i) => { const e = ez(t, 55.0 + i * 0.15, 55.5 + i * 0.15, "outBack"); css(b, { opacity: clamp(e * 2), transform: `translateY(${(1 - e) * 30}px)` }); });
  const sw = p(t, 56.0, 56.9);
  css($("#sweep"), { left: `${lerp(-400, 2200, E.inOutCubic(sw))}px`, top: "-160px", transform: "rotate(18deg)", opacity: sw > 0 && sw < 1 ? 1 : 0 });
}

// ===================================================================================
// Public API: render one frame and wait until its images are decoded.
window.render = async (t) => {
  render(t);
  const jobs = pending; pending = [];
  if (jobs.length) { await Promise.all(jobs); render(t); }
};
await document.fonts.ready;
await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
window.__ready = true;
window.__info = { duration: DURATION, fps: FPS };

if (SCRUB) {
  const fit = () => { stageScale = Math.min(innerWidth / 1920, (innerHeight - 50) / 1080); $("#stage").style.transform = `scale(${stageScale})`; $("#stage").style.transformOrigin = "0 0"; };
  fit(); addEventListener("resize", fit);
  document.body.style.overflow = "hidden";
  const bar = mk(document.body, "", `<button id="play">play</button><input type="range" min="0" max="${DURATION}" step="${1 / FPS}" value="0"><span id="tc">0.00</span>`);
  bar.id = "scrub";
  const range = bar.querySelector("input"), tc = bar.querySelector("#tc"), btn = bar.querySelector("#play");
  const audio = new Audio("/out/mix.wav");
  let playing = false;
  const go = (t) => { range.value = t; tc.textContent = t.toFixed(2); window.render(t); };
  range.oninput = () => { audio.currentTime = +range.value; go(+range.value); };
  btn.onclick = () => { playing = !playing; btn.textContent = playing ? "pause" : "play"; if (playing) { audio.currentTime = +range.value; audio.play(); loop(); } else audio.pause(); };
  const loop = () => { if (!playing) return; go(audio.currentTime); requestAnimationFrame(loop); };
  const q = new URLSearchParams(location.search).get("t");
  go(q ? +q : 0);
  window.seek = go;
}
