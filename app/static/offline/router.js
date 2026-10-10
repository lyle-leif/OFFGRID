// Road routing on the phone, with no hub. A port of app/services/routing.py that works on
// the compact typed arrays in pack/roads.bin: snap to the nearest point on a road, A* over
// segment lengths, walk/drive rules, and the same turn-by-turn steps as the hub.
// Routes know nothing about floods, closures or damage.

const FOOT_ONLY = new Set(["footway", "path", "steps", "cycleway", "bridleway", "pedestrian"]);
const WALK_KMH = 4.5;
const DRIVE_KMH = {
  motorway: 60, motorway_link: 40, trunk: 50, trunk_link: 35, primary: 40, primary_link: 30,
  secondary: 35, secondary_link: 25, tertiary: 30, tertiary_link: 25, unclassified: 25,
  residential: 20, living_street: 10, service: 15, road: 20, track: 10,
};
const TURN_PENALTY_S = 6;
const CLASS_LABEL = {
  footway: "footpath", path: "footpath", steps: "footpath", pedestrian: "footpath",
  cycleway: "footpath", bridleway: "footpath", track: "track", service: "service road",
  residential: "local road", unclassified: "local road", living_street: "local road",
};
const SHORT_M = 50;
const BEARING_M = 20;
const CELL = 0.005;
const CELL_M = 500;

export class RoutingError extends Error {}

// Python's round(): halves go to the even neighbour, so numbers match the hub exactly.
export function pyRound(x) {
  const f = Math.floor(x);
  // Only an exact .5 goes to even (1332.5000000000002 still rounds up, as in Python).
  if (x - f === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

export function meters(a, b) {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dx = (a[1] - b[1]) * 111_320 * Math.cos(lat);
  const dy = (a[0] - b[0]) * 110_540;
  return Math.hypot(dx, dy);
}

export function bearing(a, b) {
  const rad = Math.PI / 180;
  const lat1 = a[0] * rad;
  const lat2 = b[0] * rad;
  const dlng = (b[1] - a[1]) * rad;
  const x = Math.sin(dlng) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlng);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export const compass = (deg) => COMPASS[((pyRound(deg / 45) % 8) + 8) % 8];

export function turnWord(delta) {
  const a = Math.abs(delta);
  if (a < 25) return "Continue";
  const side = delta > 0 ? "right" : "left";
  if (a < 60) return `Bear ${side}`;
  if (a < 150) return `Turn ${side}`;
  return "Make a U-turn";
}

function bearingAlong(pts, fromEnd = false) {
  const seq = fromEnd ? [...pts].reverse() : pts;
  const origin = seq[0];
  let far = seq[Math.min(1, seq.length - 1)];
  let acc = 0;
  for (let i = 0; i + 1 < seq.length; i++) {
    acc += meters(seq[i], seq[i + 1]);
    far = seq[i + 1];
    if (acc >= BEARING_M) break;
  }
  return fromEnd ? bearing(far, origin) : bearing(origin, far);
}

// Small binary min-heap of [priority, node], ordered like Python's heapq on (f, node)
// tuples (ties go to the lower node id), so equal-length routes match the hub.
const less = (x, y) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(p, n) {
    const a = this.a;
    a.push([p, n]);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (!less(a[i], a[j])) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

export function createRouter(meta, buffer) {
  const view = (name) => {
    const { offset, length, type } = meta.layout[name];
    const T = { i4: Int32Array, u4: Uint32Array, f4: Float32Array, u2: Uint16Array, u1: Uint8Array, i1: Int8Array }[type];
    return new T(buffer, offset, length);
  };
  const nodeLat = view("nodeLat");
  const nodeLng = view("nodeLng");
  const edgeU = view("edgeU");
  const edgeV = view("edgeV");
  // Segment lengths are stored as whole decimetres so they match the hub's numbers exactly.
  const edgeLenRaw = view("edgeLen");
  const lenScale = meta.edgeLenScale ?? 1;
  const segLen = (e) => edgeLenRaw[e] / lenScale;
  const geomStart = view("geomStart");
  const geomLat = view("geomLat");
  const geomLng = view("geomLng");
  const edgeName = view("edgeName");
  const edgeCls = view("edgeCls");
  const edgeOneway = view("edgeOneway");
  const edgeFlags = view("edgeFlags");
  const N = meta.nodes;
  const E = meta.edges;
  const names = meta.names;
  const classes = meta.classes;

  const node = (i) => [nodeLat[i] / 1e6, nodeLng[i] / 1e6];
  const cls = (e) => classes[edgeCls[e]];
  const name = (e) => names[edgeName[e]];
  const fwdOk = (e, mode) => mode === "walk" || edgeOneway[e] === 0 || edgeOneway[e] === 1;
  const backOk = (e, mode) => mode === "walk" || edgeOneway[e] === 0 || edgeOneway[e] === -1;
  const usable = (e, mode) => (edgeFlags[e] & (mode === "walk" ? 1 : 2)) !== 0;

  function pts(e) {
    const out = [node(edgeU[e])];
    for (let k = geomStart[e]; k < geomStart[e + 1]; k++) out.push([geomLat[k] / 1e6, geomLng[k] / 1e6]);
    out.push(node(edgeV[e]));
    return out;
  }

  // Adjacency per mode in compact arrays (CSR): for node x, entries adjStart[x]..adjStart[x+1].
  const adj = {};
  for (const mode of ["walk", "drive"]) {
    const deg = new Uint32Array(N + 1);
    for (let e = 0; e < E; e++) {
      if (mode === "drive" && FOOT_ONLY.has(cls(e))) continue;
      if (fwdOk(e, mode)) deg[edgeU[e]]++;
      if (backOk(e, mode)) deg[edgeV[e]]++;
    }
    const start = new Uint32Array(N + 1);
    for (let i = 0; i < N; i++) start[i + 1] = start[i] + deg[i];
    const to = new Uint32Array(start[N]);
    const edge = new Uint32Array(start[N]);
    const fwd = new Uint8Array(start[N]);
    const fill = start.slice(0, N);
    for (let e = 0; e < E; e++) {
      if (mode === "drive" && FOOT_ONLY.has(cls(e))) continue;
      if (fwdOk(e, mode)) { const k = fill[edgeU[e]]++; to[k] = edgeV[e]; edge[k] = e; fwd[k] = 1; }
      if (backOk(e, mode)) { const k = fill[edgeV[e]]++; to[k] = edgeU[e]; edge[k] = e; fwd[k] = 0; }
    }
    adj[mode] = { start, to, edge, fwd };
  }

  const cumCache = new Map();
  function cumulative(e) {
    let c = cumCache.get(e);
    if (c) return c;
    const p = pts(e);
    const out = [0];
    let acc = 0;
    for (let i = 0; i + 1 < p.length; i++) { acc += meters(p[i], p[i + 1]); out.push(acc); }
    const total = segLen(e);
    c = acc ? out.map((v) => (v * total) / acc) : out;
    cumCache.set(e, c);
    return c;
  }

  function pointAt(e, m) {
    const p = pts(e);
    const cum = cumulative(e);
    m = Math.max(0, Math.min(m, cum[cum.length - 1]));
    for (let i = 1; i < cum.length; i++) {
      if (cum[i] >= m) {
        const seg = cum[i] - cum[i - 1];
        const t = seg ? (m - cum[i - 1]) / seg : 0;
        return [p[i - 1][0] + t * (p[i][0] - p[i - 1][0]), p[i - 1][1] + t * (p[i][1] - p[i - 1][1])];
      }
    }
    return p[p.length - 1];
  }

  function partial(e, fromM, toM) {
    const p = pts(e);
    const cum = cumulative(e);
    const lo = Math.min(fromM, toM);
    const hi = Math.max(fromM, toM);
    const inner = p.filter((_, i) => lo < cum[i] && cum[i] < hi);
    const piece = [pointAt(e, lo), ...inner, pointAt(e, hi)];
    if (fromM > toM) piece.reverse();
    return { edge: e, pts: piece, length: Math.abs(toM - fromM) };
  }

  // Grid of road segments for snapping, built on first use (keeps startup light on phones).
  let segGrid = null;
  function segmentIndex() {
    if (segGrid) return segGrid;
    segGrid = new Map();
    const key = (i, j) => i * 100000 + j;
    for (let e = 0; e < E; e++) {
      const p = pts(e);
      for (let s = 0; s + 1 < p.length; s++) {
        const [a, b] = [p[s], p[s + 1]];
        for (let i = Math.trunc(Math.min(a[0], b[0]) / CELL); i <= Math.trunc(Math.max(a[0], b[0]) / CELL); i++) {
          for (let j = Math.trunc(Math.min(a[1], b[1]) / CELL); j <= Math.trunc(Math.max(a[1], b[1]) / CELL); j++) {
            const k = key(i, j);
            let list = segGrid.get(k);
            if (!list) { list = []; segGrid.set(k, list); }
            list.push(e, s);
          }
        }
      }
    }
    return segGrid;
  }

  // `avoid`: a Set of edge ids not to use (roads reported flooded or blocked).
  function snap(lat, lng, mode, maxM = 3000, avoid = null) {
    const grid = segmentIndex();
    const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
    const ky = 110_540;
    const ci = Math.trunc(lat / CELL);
    const cj = Math.trunc(lng / CELL);
    let best = null; // [dist, edge, seg, t]
    const seen = new Set();
    for (let ring = 0; ring < Math.trunc(maxM / CELL_M) + 2; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) {
        for (let j = cj - ring; j <= cj + ring; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          const list = grid.get(i * 100000 + j);
          if (!list) continue;
          for (let q = 0; q < list.length; q += 2) {
            const e = list[q];
            const s = list[q + 1];
            if (!usable(e, mode) || avoid?.has(e)) continue;
            const sk = e * 65536 + s;
            if (seen.has(sk)) continue;
            seen.add(sk);
            const p = pts(e);
            const a = p[s];
            const b = p[s + 1];
            const ax = (a[1] - lng) * kx;
            const ay = (a[0] - lat) * ky;
            const dx = (b[1] - lng) * kx - ax;
            const dy = (b[0] - lat) * ky - ay;
            const seg2 = dx * dx + dy * dy;
            const t = seg2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / seg2)) : 0;
            const d = Math.hypot(ax + t * dx, ay + t * dy);
            if (!best || d < best[0]) best = [d, e, s, t];
          }
        }
      }
      if (best && best[0] < ring * CELL_M) break;
    }
    if (!best || best[0] > maxM) throw new RoutingError("No road found near that point in the saved road data.");
    const [d, e, s, t] = best;
    const cum = cumulative(e);
    const along = cum[s] + t * (cum[s + 1] - cum[s]);
    return { edge: e, along, point: pointAt(e, along), off: d };
  }

  // Scratch arrays reused across searches (no per-route allocation of 158k-sized arrays).
  const dist = new Float64Array(N).fill(Infinity);
  const prevNode = new Int32Array(N).fill(-1);
  const prevEdge = new Int32Array(N);
  const prevFwd = new Uint8Array(N);
  const done = new Uint8Array(N);

  function searchLegs(s, g, mode, avoid = null) {
    const es = s.edge;
    const eg = g.edge;
    const lenS = segLen(es);
    const lenG = segLen(eg);
    const starts = new Map();
    if (backOk(es, mode)) starts.set(edgeU[es], [s.along, partial(es, s.along, 0)]);
    if (fwdOk(es, mode)) {
      const leg = partial(es, s.along, lenS);
      const cur = starts.get(edgeV[es]);
      if (!cur || leg.length < cur[0]) starts.set(edgeV[es], [leg.length, leg]);
    }
    const targets = new Map();
    if (fwdOk(eg, mode)) targets.set(edgeU[eg], [g.along, partial(eg, 0, g.along)]);
    if (backOk(eg, mode)) {
      const leg = partial(eg, lenG, g.along);
      const cur = targets.get(edgeV[eg]);
      if (!cur || leg.length < cur[0]) targets.set(edgeV[eg], [leg.length, leg]);
    }

    let best = Infinity;
    let bestEnd = -1;
    if (es === eg && ((g.along >= s.along && fwdOk(es, mode)) || (g.along <= s.along && backOk(es, mode)))) {
      best = Math.abs(g.along - s.along);
    }

    const touched = [];
    const goal = g.point;
    const heap = new Heap();
    for (const [n, [c]] of starts) {
      dist[n] = c;
      touched.push(n);
      heap.push(c + meters(node(n), goal), n);
    }
    const { start, to, edge, fwd } = adj[mode];
    try {
      while (heap.size) {
        const [f, x] = heap.pop();
        if (f >= best) break;
        if (done[x]) continue;
        done[x] = 1;
        const tgt = targets.get(x);
        if (tgt && dist[x] + tgt[0] < best) { best = dist[x] + tgt[0]; bestEnd = x; }
        for (let k = start[x]; k < start[x + 1]; k++) {
          if (avoid?.has(edge[k])) continue;
          const y = to[k];
          const nd = dist[x] + segLen(edge[k]);
          if (nd < dist[y]) {
            if (dist[y] === Infinity) touched.push(y);
            dist[y] = nd;
            prevNode[y] = x;
            prevEdge[y] = edge[k];
            prevFwd[y] = fwd[k];
            heap.push(nd + meters(node(y), goal), y);
          }
        }
      }
      if (best === Infinity) throw new RoutingError("No road connection found between these points in the saved road data.");
      if (bestEnd === -1) return [partial(es, s.along, g.along)];
      const middle = [];
      let x = bestEnd;
      while (prevNode[x] !== -1) {
        const e = prevEdge[x];
        const p = pts(e);
        middle.push({ edge: e, pts: prevFwd[x] ? p : p.reverse(), length: segLen(e) });
        x = prevNode[x];
      }
      return [starts.get(x)[1], ...middle.reverse(), targets.get(bestEnd)[1]];
    } finally {
      for (const n of touched) { dist[n] = Infinity; prevNode[n] = -1; done[n] = 0; }
    }
  }

  function step(text, length, at, road = null) {
    return { instruction: text, distance_m: pyRound(length), lat: Math.round(at[0] * 1e6) / 1e6,
      lng: Math.round(at[1] * 1e6) / 1e6, road };
  }

  function route(startPt, endPt, mode = "walk", destName = "your destination", avoid = null) {
    if (mode !== "walk" && mode !== "drive") throw new RoutingError("Mode must be 'walk' or 'drive'.");
    const s = snap(startPt[0], startPt[1], mode, 3000, avoid);
    const g = snap(endPt[0], endPt[1], mode, 3000, avoid);
    const legs = searchLegs(s, g, mode, avoid).filter((l) => l.length >= 0.5);
    const edges = [...new Set(legs.map((l) => l.edge))].sort((a, b) => a - b);

    let groups = [];
    for (const leg of legs) {
      const label = name(leg.edge) || CLASS_LABEL[cls(leg.edge)] || "road";
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.pts.push(...leg.pts.slice(1));
        last.len += leg.length;
        last.legs.push(leg);
      } else {
        groups.push({ label, named: Boolean(name(leg.edge)), pts: [...leg.pts], len: leg.length, legs: [leg] });
      }
    }
    const merged = [];
    groups.forEach((gr, idx) => {
      const last = merged[merged.length - 1];
      const fold = last && !gr.named && gr.len < SHORT_M && idx !== groups.length - 1;
      if (fold || (last && last.label === gr.label)) {
        last.pts.push(...gr.pts.slice(1));
        last.len += gr.len;
        last.legs.push(...gr.legs);
      } else {
        merged.push(gr);
      }
    });
    groups = merged;

    const steps = [];
    const line = [startPt];
    if (s.off > 25) steps.push(step("Go to the nearest road", s.off, startPt));
    let prevOut = null;
    let turns = 0;
    for (const gr of groups) {
      const bIn = bearingAlong(gr.pts);
      const road = gr.named ? gr.label : `the ${gr.label}`;
      let text;
      if (prevOut === null) {
        text = `Head ${compass(bIn)} on ${road}`;
      } else {
        const word = turnWord(((bIn - prevOut + 540) % 360) - 180);
        if (word !== "Continue") turns++;
        text = word === "Continue" ? `${word} on ${road}` : `${word} onto ${road}`;
      }
      steps.push(step(text, gr.len, gr.pts[0], gr.label));
      prevOut = bearingAlong(gr.pts, true);
      line.push(...gr.pts);
    }
    if (g.off > 25) steps.push(step(`Leave the road to reach ${destName}`, g.off, g.point));
    line.push(endPt);
    steps.push(step(`Arrive at ${destName}`, 0, endPt));

    const roadM = groups.reduce((t, gr) => t + gr.len, 0);
    const total = roadM + s.off + g.off;
    let minutes;
    if (mode === "walk") {
      minutes = (total / 1000 / WALK_KMH) * 60;
    } else {
      minutes = 0;
      for (const gr of groups) for (const leg of gr.legs) minutes += (leg.length / 1000 / (DRIVE_KMH[cls(leg.edge)] ?? 20)) * 60;
      minutes += ((s.off + g.off) / 1000 / WALK_KMH) * 60 + (turns * TURN_PENALTY_S) / 60;
    }
    return {
      mode,
      distance_m: pyRound(total),
      duration_min: Math.max(1, pyRound(minutes)),
      straight_line_m: pyRound(meters(startPt, endPt)),
      coords: line.map((p) => [Math.round(p[1] * 1e6) / 1e6, Math.round(p[0] * 1e6) / 1e6]),
      steps,
      data_date: meta.retrieved,
      edges, // road segments used, to check against reports
    };
  }

  return { route, snap };
}
