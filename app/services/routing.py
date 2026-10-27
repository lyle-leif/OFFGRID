"""Offline road routing over the OpenStreetMap graph built by tools/import_roads.py.

A* over edge length. Two modes: walk (all ways, both directions) and drive (no
footpaths, respects oneway). Start and end points snap to the nearest point *on a
road* (not the nearest junction), so a GPS fix in the middle of a block routes from
where you actually are. The road data knows nothing about floods, closures, or damage;
callers can pass `avoid` (edge ids of roads people reported flooded or blocked).
"""

import gzip
import heapq
import json
import math
from dataclasses import dataclass
from pathlib import Path

from app.services.i18n import t

FOOT_ONLY = {"footway", "path", "steps", "cycleway", "bridleway", "pedestrian"}
WALK_KMH = 4.5
DRIVE_KMH = {
    "motorway": 60, "motorway_link": 40, "trunk": 50, "trunk_link": 35, "primary": 40, "primary_link": 30,
    "secondary": 35, "secondary_link": 25, "tertiary": 30, "tertiary_link": 25, "unclassified": 25,
    "residential": 20, "living_street": 10, "service": 15, "road": 20, "track": 10,
}
TURN_PENALTY_S = 6  # driving: slowing down and turning at each junction instruction
CLASS_LABEL = {
    "footway": "footpath", "path": "footpath", "steps": "footpath", "pedestrian": "footpath",
    "cycleway": "footpath", "bridleway": "footpath", "track": "track", "service": "service road",
    "residential": "local road", "unclassified": "local road", "living_street": "local road",
}
CLASS_KEY = {"footpath": "footpath", "track": "track", "service road": "service_road", "local road": "local_road",
             "road": "road"}  # class label -> lang key, for the step text
SHORT_M = 50  # unnamed bits shorter than this are folded into the neighbouring step
BEARING_M = 20  # measure turn bearings over this distance, not just the first tiny segment
CELL = 0.005  # grid cell size in degrees (~550 m) for snapping
CELL_M = 500  # a safe lower bound for a cell's size in metres at this latitude


class RoutingError(Exception):
    """Message is safe to show to the user. Raised with a string key ("rerr.no_road") so it
    can be shown in the app's language with .text(lang); str(e) is the English text."""

    def __init__(self, key: str):
        self.key = key
        super().__init__(t("en", key) if key.startswith("rerr.") else key)

    def text(self, lang: str | None) -> str:
        return t(lang, self.key) if self.key.startswith("rerr.") else str(self)


def meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat = math.radians((a[0] + b[0]) / 2)
    dx = (a[1] - b[1]) * 111_320 * math.cos(lat)
    dy = (a[0] - b[0]) * 110_540
    return math.hypot(dx, dy)


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlng = math.radians(b[1] - a[1])
    x = math.sin(dlng) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def compass(deg: float) -> str:
    return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][round(deg / 45) % 8]


def turn_word(delta: float) -> str:
    """delta = new bearing - old bearing, normalised to (-180, 180]. Positive = right."""
    a = abs(delta)
    if a < 25:
        return "Continue"
    side = "right" if delta > 0 else "left"
    if a < 60:
        return f"Bear {side}"
    if a < 150:
        return f"Turn {side}"
    return "Make a U-turn"


def turn_key(delta: float) -> str:
    """The step key for a turn: continue, bear_right, turn_left, uturn..."""
    a = abs(delta)
    if a < 25:
        return "continue"
    side = "right" if delta > 0 else "left"
    if a < 60:
        return f"bear_{side}"
    if a < 150:
        return f"turn_{side}"
    return "uturn"


def bearing_along(pts: list[tuple[float, float]], from_end: bool = False) -> float:
    """Bearing over the first (or last) ~BEARING_M metres of a polyline, so a 1 m kink at a
    junction doesn't decide whether the instruction says left or right."""
    seq = pts[::-1] if from_end else pts
    origin, far, acc = seq[0], seq[min(1, len(seq) - 1)], 0.0
    for a, b in zip(seq, seq[1:]):
        acc += meters(a, b)
        far = b
        if acc >= BEARING_M:
            break
    return bearing(far, origin) if from_end else bearing(origin, far)


@dataclass
class Edge:
    u: int
    v: int
    length: float
    name: str
    cls: str
    oneway: int
    inner: list[tuple[float, float]]


@dataclass
class Snap:
    edge: int  # index into Router.edges
    along: float  # metres from the edge's u end to the snapped point
    point: tuple[float, float]  # the snapped point on the road
    off: float  # metres from the query point to the road


@dataclass
class Leg:
    edge: Edge
    pts: list[tuple[float, float]]
    length: float
    ei: int  # index of `edge` in Router.edges


class Router:
    def __init__(self, graph: dict):
        self.nodes: list[tuple[float, float]] = [tuple(n) for n in graph["nodes"]]
        names, classes = graph["names"], graph["classes"]
        self.edges = [
            Edge(u, v, length, names[ni], classes[ci], ow, list(zip(flat[0::2], flat[1::2])))
            for u, v, length, ni, ci, ow, flat in graph["edges"]
        ]
        self.data_date = graph.get("retrieved", "")
        self.adj: dict[str, list[list[tuple[int, int, bool]]]] = {}
        self.usable: dict[str, set[int]] = {}
        for mode in ("walk", "drive"):
            adj: list[list[tuple[int, int, bool]]] = [[] for _ in self.nodes]
            for i, e in enumerate(self.edges):
                if mode == "drive" and e.cls in FOOT_ONLY:
                    continue
                if self._fwd_ok(e, mode):
                    adj[e.u].append((e.v, i, True))
                if self._back_ok(e, mode):
                    adj[e.v].append((e.u, i, False))
            self.adj[mode] = adj
            main = set(self._main_component(adj))
            # Snap only onto edges of the main road network, never onto isolated fragments.
            self.usable[mode] = {
                i for i, e in enumerate(self.edges)
                if (mode == "walk" or e.cls not in FOOT_ONLY) and e.u in main and e.v in main
            }
        self.seg_grid = self._segment_index()
        self._cum: dict[int, list[float]] = {}

    @classmethod
    def load(cls, path: Path) -> "Router":
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return cls(json.load(f))

    @staticmethod
    def _fwd_ok(e: Edge, mode: str) -> bool:
        return mode == "walk" or e.oneway in (0, 1)

    @staticmethod
    def _back_ok(e: Edge, mode: str) -> bool:
        return mode == "walk" or e.oneway in (0, -1)

    # ---- geometry helpers ---------------------------------------------
    def _pts(self, ei: int) -> list[tuple[float, float]]:
        e = self.edges[ei]
        return [self.nodes[e.u], *e.inner, self.nodes[e.v]]

    def _cumulative(self, ei: int) -> list[float]:
        if ei not in self._cum:
            pts, acc, out = self._pts(ei), 0.0, [0.0]
            for a, b in zip(pts, pts[1:]):
                acc += meters(a, b)
                out.append(acc)
            # Scale to the stored edge length so partial lengths add up exactly.
            total = self.edges[ei].length
            self._cum[ei] = [c * total / acc for c in out] if acc else out
        return self._cum[ei]

    def _point_at(self, ei: int, m: float) -> tuple[float, float]:
        pts, cum = self._pts(ei), self._cumulative(ei)
        m = max(0.0, min(m, cum[-1]))
        for i in range(1, len(cum)):
            if cum[i] >= m:
                seg = cum[i] - cum[i - 1]
                t = (m - cum[i - 1]) / seg if seg else 0.0
                a, b = pts[i - 1], pts[i]
                return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        return pts[-1]

    def _partial(self, ei: int, from_m: float, to_m: float) -> Leg:
        """The piece of edge `ei` between two distances along it, in travel order."""
        pts, cum = self._pts(ei), self._cumulative(ei)
        lo, hi = sorted((from_m, to_m))
        inner = [p for p, c in zip(pts, cum) if lo < c < hi]
        piece = [self._point_at(ei, lo), *inner, self._point_at(ei, hi)]
        if from_m > to_m:
            piece.reverse()
        return Leg(self.edges[ei], piece, abs(to_m - from_m), ei)

    # ---- snapping -------------------------------------------------------
    def _main_component(self, adj) -> list[int]:
        """Vertices of the largest connected piece of road (undirected)."""
        undirected: list[set[int]] = [set() for _ in self.nodes]
        for a, outs in enumerate(adj):
            for b, _, _ in outs:
                undirected[a].add(b)
                undirected[b].add(a)
        seen, best = [False] * len(self.nodes), []
        for s in range(len(self.nodes)):
            if seen[s] or not undirected[s]:
                continue
            comp, stack = [], [s]
            seen[s] = True
            while stack:
                x = stack.pop()
                comp.append(x)
                for y in undirected[x]:
                    if not seen[y]:
                        seen[y] = True
                        stack.append(y)
            if len(comp) > len(best):
                best = comp
        return best

    def _segment_index(self) -> dict[tuple[int, int], list[tuple[int, int]]]:
        """Grid cell -> (edge, segment) pairs whose bounding box touches the cell."""
        grid: dict[tuple[int, int], list[tuple[int, int]]] = {}
        for ei in range(len(self.edges)):
            pts = self._pts(ei)
            for si, (a, b) in enumerate(zip(pts, pts[1:])):
                for i in range(int(min(a[0], b[0]) / CELL), int(max(a[0], b[0]) / CELL) + 1):
                    for j in range(int(min(a[1], b[1]) / CELL), int(max(a[1], b[1]) / CELL) + 1):
                        grid.setdefault((i, j), []).append((ei, si))
        return grid

    def snap(self, lat: float, lng: float, mode: str, max_m: float = 3000, avoid: frozenset[int] = frozenset()) -> Snap:
        """Nearest point on a road usable in `mode` (and not in `avoid`)."""
        usable = self.usable[mode]
        kx, ky = 111_320 * math.cos(math.radians(lat)), 110_540
        ci, cj = int(lat / CELL), int(lng / CELL)
        best: tuple[float, int, int, float] | None = None  # (dist, edge, seg, t)
        seen: set[tuple[int, int]] = set()
        for ring in range(0, int(max_m / CELL_M) + 2):
            for i in range(ci - ring, ci + ring + 1):
                for j in range(cj - ring, cj + ring + 1):
                    if max(abs(i - ci), abs(j - cj)) != ring:
                        continue
                    for ei, si in self.seg_grid.get((i, j), ()):
                        if ei not in usable or ei in avoid or (ei, si) in seen:
                            continue
                        seen.add((ei, si))
                        pts = self._pts(ei)
                        a, b = pts[si], pts[si + 1]
                        ax, ay = (a[1] - lng) * kx, (a[0] - lat) * ky
                        bx, by = (b[1] - lng) * kx, (b[0] - lat) * ky
                        dx, dy = bx - ax, by - ay
                        seg2 = dx * dx + dy * dy
                        t = max(0.0, min(1.0, -(ax * dx + ay * dy) / seg2)) if seg2 else 0.0
                        d = math.hypot(ax + t * dx, ay + t * dy)
                        if best is None or d < best[0]:
                            best = (d, ei, si, t)
            # Segments only found in a further ring are at least `ring` cells away.
            if best is not None and best[0] < ring * CELL_M:
                break
        if best is None or best[0] > max_m:
            raise RoutingError("rerr.no_road")
        d, ei, si, t = best
        cum = self._cumulative(ei)
        along = cum[si] + t * (cum[si + 1] - cum[si])
        return Snap(ei, along, self._point_at(ei, along), d)

    # ---- search ---------------------------------------------------------
    def _search(self, s: Snap, g: Snap, mode: str, avoid: frozenset[int] = frozenset()) -> list[Leg]:
        """A* from a point on one edge to a point on another, via virtual end nodes."""
        es, eg = self.edges[s.edge], self.edges[g.edge]
        # Ways out of the start point: back to es.u, or forward to es.v.
        starts: dict[int, tuple[float, Leg]] = {}
        if self._back_ok(es, mode):
            starts[es.u] = (s.along, self._partial(s.edge, s.along, 0.0))
        if self._fwd_ok(es, mode):
            leg = self._partial(s.edge, s.along, es.length)
            if es.v not in starts or leg.length < starts[es.v][0]:
                starts[es.v] = (leg.length, leg)
        # Ways into the goal point: from eg.u going forward, or from eg.v going back.
        targets: dict[int, tuple[float, Leg]] = {}
        if self._fwd_ok(eg, mode):
            targets[eg.u] = (g.along, self._partial(g.edge, 0.0, g.along))
        if self._back_ok(eg, mode):
            leg = self._partial(g.edge, eg.length, g.along)
            if eg.v not in targets or leg.length < targets[eg.v][0]:
                targets[eg.v] = (leg.length, leg)

        best, best_end = math.inf, None
        if s.edge == g.edge:  # both points on the same road segment
            if (g.along >= s.along and self._fwd_ok(es, mode)) or (g.along <= s.along and self._back_ok(es, mode)):
                best = abs(g.along - s.along)

        goal_pt = g.point
        dist = {n: c for n, (c, _) in starts.items()}
        prev: dict[int, tuple[int, int, bool]] = {}
        heap = [(c + meters(self.nodes[n], goal_pt), n) for n, c in dist.items()]
        heapq.heapify(heap)
        done: set[int] = set()
        adj = self.adj[mode]
        while heap:
            f, x = heapq.heappop(heap)
            if f >= best:
                break
            if x in done:
                continue
            done.add(x)
            if x in targets and dist[x] + targets[x][0] < best:
                best, best_end = dist[x] + targets[x][0], x
            for y, ei, fwd in adj[x]:
                if ei in avoid:
                    continue
                nd = dist[x] + self.edges[ei].length
                if nd < dist.get(y, math.inf):
                    dist[y] = nd
                    prev[y] = (x, ei, fwd)
                    heapq.heappush(heap, (nd + meters(self.nodes[y], goal_pt), y))
        if best == math.inf:
            raise RoutingError("rerr.no_connection")
        if best_end is None:
            return [self._partial(s.edge, s.along, g.along)]

        middle, x = [], best_end
        while x in prev:
            p, ei, fwd = prev[x]
            pts = self._pts(ei)
            middle.append(Leg(self.edges[ei], pts if fwd else pts[::-1], self.edges[ei].length, ei))
            x = p
        return [starts[x][1], *middle[::-1], targets[best_end][1]]

    # ---- public ---------------------------------------------------------
    def route(self, start: tuple[float, float], end: tuple[float, float], mode: str = "walk",
              dest_name: str | None = None, avoid: frozenset[int] = frozenset(), lang: str = "en") -> dict:
        """`avoid`: edge ids the route must not use (reported flooded or blocked). `lang`: the
        language of the step instructions."""
        dest_name = dest_name or t(lang, "step.dest_default")
        if mode not in self.adj:
            raise RoutingError("rerr.mode")
        s = self.snap(*start, mode, avoid=avoid)
        g = self.snap(*end, mode, avoid=avoid)
        legs = [leg for leg in self._search(s, g, mode, avoid) if leg.length >= 0.5]
        edge_ids = sorted({leg.ei for leg in legs})

        # Group consecutive legs on the same road into steps.
        groups: list[dict] = []
        for leg in legs:
            e = leg.edge
            label = e.name or CLASS_LABEL.get(e.cls, "road")
            if groups and groups[-1]["label"] == label:
                groups[-1]["pts"].extend(leg.pts[1:])
                groups[-1]["len"] += leg.length
                groups[-1]["legs"].append(leg)
            else:
                groups.append({"label": label, "named": bool(e.name), "pts": list(leg.pts),
                               "len": leg.length, "legs": [leg]})

        # Fold short unnamed connectors (driveways, a few steps) into the step before them,
        # so directions read "Turn right onto Rizal Avenue", not "onto the service road 22 m".
        merged: list[dict] = []
        for gr in groups:
            fold = merged and not gr["named"] and gr["len"] < SHORT_M and gr is not groups[-1]
            if fold or (merged and merged[-1]["label"] == gr["label"]):
                merged[-1]["pts"].extend(gr["pts"][1:])
                merged[-1]["len"] += gr["len"]
                merged[-1]["legs"].extend(gr["legs"])
            else:
                merged.append(gr)
        groups = merged

        steps, line = [], [start]
        if s.off > 25:
            steps.append(self._step(t(lang, "step.to_road"), s.off, start))
        prev_out, turns = None, 0
        for gr in groups:
            pts = gr["pts"]
            b_in = bearing_along(pts)
            road = gr["label"] if gr["named"] else t(lang, "road.unnamed", label=t(lang, f"road.{CLASS_KEY[gr['label']]}"))
            if prev_out is None:
                text = t(lang, "step.head", dir=t(lang, f"dir.{compass(b_in)}"), road=road)
            else:
                word = turn_key((b_in - prev_out + 540) % 360 - 180)
                turns += word != "continue"
                text = t(lang, f"step.{word}", road=road)
            steps.append(self._step(text, gr["len"], pts[0], gr["label"]))
            prev_out = bearing_along(pts, from_end=True)
            line.extend(pts)
        if g.off > 25:
            steps.append(self._step(t(lang, "step.leave", dest=dest_name), g.off, g.point))
        line.append(end)
        steps.append(self._step(t(lang, "step.arrive", dest=dest_name), 0, end))

        road_m = sum(gr["len"] for gr in groups)
        total = road_m + s.off + g.off
        if mode == "walk":
            minutes = total / 1000 / WALK_KMH * 60
        else:
            minutes = sum(leg.length / 1000 / DRIVE_KMH.get(leg.edge.cls, 20) * 60
                          for gr in groups for leg in gr["legs"])
            minutes += (s.off + g.off) / 1000 / WALK_KMH * 60 + turns * TURN_PENALTY_S / 60
        return {
            "mode": mode,
            "distance_m": round(total),
            "duration_min": max(1, round(minutes)),
            "straight_line_m": round(meters(start, end)),
            "coords": [[round(p[1], 6), round(p[0], 6)] for p in line],  # [lng, lat] for GeoJSON
            "steps": steps,
            "data_date": self.data_date,
            "edges": edge_ids,  # road segments used, to check against reports
        }

    @staticmethod
    def _step(text: str, length: float, at: tuple[float, float], road: str | None = None) -> dict:
        return {"instruction": text, "distance_m": round(length), "lat": round(at[0], 6), "lng": round(at[1], 6),
                "road": road}
