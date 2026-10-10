"""Draw OFFGRID's home-screen icons (PNG) without any image library or download.

    .venv\\Scripts\\python tools\\make_icons.py

Writes app/static/icons/icon-192.png, icon-512.png and icon-maskable-512.png:
a white map pin with a lightning-bolt cut-out on the orange OFFGRID tile.
"""

import math
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent.parent / "app" / "static" / "icons"
ORANGE = np.array([217, 72, 15])
WHITE = np.array([255, 255, 255])


def png(path: Path, rgba: np.ndarray) -> None:
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[y].astype(np.uint8).tobytes() for y in range(h))
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def in_triangle(x, y, a, b, c):
    def side(p1, p2):
        return (x - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (y - p2[1])
    d1, d2, d3 = side(a, b), side(b, c), side(c, a)
    neg = (d1 < 0) | (d2 < 0) | (d3 < 0)
    pos = (d1 > 0) | (d2 > 0) | (d3 > 0)
    return ~(neg & pos)


def in_polygon(x, y, poly):
    inside = np.zeros_like(x, dtype=bool)
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        crosses = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1)
        inside ^= crosses
    return inside


def draw(size: int, scale: float, rounded: bool) -> np.ndarray:
    ss = 4  # supersampling for smooth edges
    n = size * ss
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    x = (x + 0.5) / n
    y = (y + 0.5) / n
    # Tile: rounded square (normal icon) or full bleed (maskable: the OS crops it).
    if rounded:
        r = 0.22
        qx = np.maximum(np.abs(x - 0.5) - (0.5 - r), 0)
        qy = np.maximum(np.abs(y - 0.5) - (0.5 - r), 0)
        tile = np.hypot(qx, qy) <= r
    else:
        tile = np.ones_like(x, dtype=bool)
    # Pin, scaled around the centre: circle head + triangle to the tip.
    sx = 0.5 + (x - 0.5) / scale
    sy = 0.5 + (y - 0.5) / scale
    cx, cy, rad, tip = 0.5, 0.42, 0.24, 0.86
    d = tip - cy
    th = math.asin(rad / d)
    left = (cx - rad * math.cos(th), cy + rad * math.sin(th))
    right = (cx + rad * math.cos(th), cy + rad * math.sin(th))
    pin = (np.hypot(sx - cx, sy - cy) <= rad) | in_triangle(sx, sy, left, right, (cx, tip))
    bolt = in_polygon(sx, sy, [(0.535, 0.24), (0.43, 0.445), (0.495, 0.445), (0.455, 0.6), (0.575, 0.385), (0.505, 0.385)])
    glyph = pin & ~bolt
    rgb = np.where(glyph[..., None], WHITE, ORANGE).astype(np.float64)
    alpha = tile.astype(np.float64)
    img = np.dstack([rgb, alpha[..., None] * 255])
    # Average each ss×ss block (alpha-weighted colour) to antialias.
    img = img.reshape(size, ss, size, ss, 4)
    a = img[..., 3].mean(axis=(1, 3))
    col = (img[..., :3] * img[..., 3:4]).sum(axis=(1, 3)) / np.maximum(img[..., 3].sum(axis=(1, 3))[..., None], 1e-9)
    return np.dstack([np.clip(col, 0, 255), a]).round()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    png(OUT / "icon-192.png", draw(192, 1.0, rounded=True))
    png(OUT / "icon-512.png", draw(512, 1.0, rounded=True))
    # Maskable: keep the pin inside the central 80% safe zone.
    png(OUT / "icon-maskable-512.png", draw(512, 0.72, rounded=False))
    for f in sorted(OUT.glob("*.png")):
        print(f"{f.name}: {f.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
