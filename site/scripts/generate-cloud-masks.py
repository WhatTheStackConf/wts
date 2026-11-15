# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow"]
# ///
"""Ordered-dither cloud masks for the WTS 2027 countdown sky.

Each mask is an alpha-only PNG at CSS-pixel size. A dot is one Bayer 4x4 cell of CELL css px,
the same print as the shader's screen(v, cell). The site fills the mask with --color-orbit-paper.
Run from site/: uv run scripts/generate-cloud-masks.py src/assets/images/clouds
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16 + 1 / 32


def lattice_noise(rng, w, h, px, py):
    """Value noise on a (w, h) grid, periodic over px x py lattice cells."""
    grid = rng.random((py + 1, px + 1))
    grid[:, -1] = grid[:, 0]
    x = np.linspace(0, px, w, endpoint=False)
    y = np.linspace(0, py, h, endpoint=False)
    xi, yi = np.floor(x).astype(int), np.floor(y).astype(int)
    xf, yf = x - xi, y - yi
    xf, yf = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    a = grid[np.ix_(yi, xi)]
    b = grid[np.ix_(yi, xi + 1)]
    c = grid[np.ix_(yi + 1, xi)]
    d = grid[np.ix_(yi + 1, xi + 1)]
    top = a + (b - a) * xf
    bottom = c + (d - c) * xf
    return top + (bottom - top) * yf[:, None]


def fbm(rng, w, h, px, py, octaves=5):
    total = np.zeros((h, w))
    amp, norm = 0.5, 0.0
    for _ in range(octaves):
        total += amp * lattice_noise(rng, w, h, px, py)
        norm += amp
        px, py, amp = px * 2, py * 2, amp * 0.5
    return total / norm


def sample(grid, x, y, period):
    """Value noise from a lattice at arbitrary (x, y), periodic in x over `period` cells."""
    xi, yi = np.floor(x).astype(int), np.floor(y).astype(int)
    xf, yf = x - xi, y - yi
    xf, yf = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    x0, x1 = xi % period, (xi + 1) % period
    y0, y1 = np.clip(yi, 0, grid.shape[0] - 1), np.clip(yi + 1, 0, grid.shape[0] - 1)
    top = grid[y0, x0] + (grid[y0, x1] - grid[y0, x0]) * xf
    bottom = grid[y1, x0] + (grid[y1, x1] - grid[y1, x0]) * xf
    return top + (bottom - top) * yf


def warped_fbm(rng, x, y, period, octaves=5):
    """fbm at arbitrary coordinates. x is in lattice cells of the first octave and wraps at period."""
    total, amp, norm = np.zeros_like(x), 0.5, 0.0
    for _ in range(octaves):
        grid = rng.random((int(y.max()) + 3, period))
        total += amp * sample(grid, x, y, period)
        norm += amp
        x, y, period, amp = x * 2, y * 2, period * 2, amp * 0.5
    return total / norm


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def dither(density, cell):
    """Ordered dither on cells, then upscale each cell to cell x cell css px."""
    h, w = density.shape
    threshold = np.tile(BAYER, (h // 4 + 1, w // 4 + 1))[:h, :w]
    on = (density > threshold).astype(np.uint8) * 255
    return np.kron(on, np.ones((cell, cell), dtype=np.uint8))


def save(alpha, path):
    rgba = np.zeros((*alpha.shape, 4), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = alpha
    Image.fromarray(rgba, "RGBA").save(path, optimize=True)
    print(path.name, alpha.shape[1], "x", alpha.shape[0], f"{(alpha > 0).mean():.1%} on", path.stat().st_size, "B")


def cirrus(rng, w=1600, h=300, cell=2):
    gw, gh = w // cell, h // cell
    warp = fbm(rng, gw, gh, 4, 2, 3)
    streak = fbm(rng, gw, gh, 6, 14, 5)
    # Shear the field so the wisps lean, then stretch it along x.
    y = np.arange(gh)[:, None] / gh
    field = 0.6 * streak + 0.4 * np.roll(warp, int(gw * 0.07), axis=1)
    wisps = smooth(0.5, 0.72, field + 0.22 * (warp - 0.5))
    envelope = smooth(0.0, 0.25, y) * smooth(1.0, 0.55, y)
    gaps = smooth(0.3, 0.55, fbm(rng, gw, gh, 3, 1, 3))
    return dither(wisps * envelope * gaps, cell)


def bank(rng, w=1600, h=200, cell=2):
    gw, gh = w // cell, h // cell
    x = np.arange(gw) / gw
    rise = np.arange(gh)[::-1, None] / gh  # 0 at the bottom row, 1 at the top row
    tops = fbm(rng, gw, 1, 9, 1, 4)[0]
    domes = np.zeros(gw)
    for cx in rng.random(7):
        width = 0.03 + 0.05 * rng.random()
        dx = np.minimum(np.abs(x - cx), 1 - np.abs(x - cx))
        domes = np.maximum(domes, (0.35 + 0.45 * rng.random()) * np.sqrt(np.clip(1 - (dx / width) ** 2, 0, 1)))
    height = 0.18 + 0.32 * tops + 0.55 * domes
    body = smooth(-0.06, 0.04, height[None, :] - rise)
    texture = fbm(rng, gw, gh, 16, 4, 4)
    # Sunlit tops print solid. The lower body thins toward the haze band.
    light = 0.62 + 0.38 * smooth(0.0, 0.6, rise / np.maximum(height[None, :], 0.05))
    return dither(np.clip(body * light * (0.78 + 0.45 * (texture - 0.5)), 0, 1), cell)


def cumulus(rng, w, h, cell, puffs):
    gw, gh = w // cell, h // cell
    gx = np.arange(gw)[None, :] / gw
    gy = np.arange(gh)[:, None] / gh
    field = np.zeros((gh, gw))
    for cx, cy, r in puffs:
        d = np.hypot((gx - cx) * gw / gh, gy - cy) / r
        field = np.maximum(field, 1 - d)
    edge = fbm(rng, gw, gh, 6, 3, 5)
    flat = smooth(0.92, 0.78, gy)  # a flat base
    # The image edges stay empty, so a puff never shows a straight cut.
    margin = smooth(0.0, 0.08, gx) * smooth(1.0, 0.92, gx) * smooth(0.0, 0.1, gy)
    body = smooth(0.0, 0.22, field + 0.28 * (edge - 0.5)) * flat * margin
    # Light from above: the top prints dense, the underside thins so the sky shows through.
    light = 0.95 - 0.5 * smooth(0.35, 0.9, gy)
    return dither(np.clip(body * light, 0, 1), cell)


def nebula(rng, w, h, cell, period):
    """Large veils with bright filaments. Domain warp bends them. The lower edge fades out."""
    gw, gh = w // cell, h // cell
    x = np.tile(np.arange(gw) / gw * period, (gh, 1))
    y = np.repeat((np.arange(gh) / gh * period * gh / gw)[:, None], gw, axis=1) + 1
    wx = warped_fbm(rng, x, y, period, 4)
    wy = warped_fbm(rng, x, y, period, 4)
    bent_x, bent_y = x + 1.6 * period / 4 * (wx - 0.5), y + 1.6 * (wy - 0.5) + 1
    veil = warped_fbm(rng, bent_x, bent_y, period, 5)
    ridges = 1 - np.abs(2 * warped_fbm(rng, bent_x * 1.7, bent_y * 1.7, round(period * 1.7), 4) - 1)
    rows = np.arange(gh)[:, None] / gh
    fade = smooth(0.0, 0.18, rows) * smooth(1.0, 0.45, rows)
    density = smooth(0.42, 0.72, veil) * (0.45 + 0.55 * smooth(0.6, 0.92, ridges))
    return dither(np.clip(density * fade, 0, 1), cell)


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(2027)
    save(cirrus(rng), out / "sky-cirrus.png")
    save(bank(rng), out / "sky-bank.png")
    save(cumulus(rng, 540, 240, 3, [(0.32, 0.58, 0.26), (0.52, 0.46, 0.32), (0.70, 0.60, 0.22), (0.20, 0.68, 0.15)]), out / "sky-cumulus-a.png")
    save(cumulus(rng, 420, 200, 3, [(0.38, 0.58, 0.28), (0.60, 0.52, 0.26), (0.78, 0.66, 0.16)]), out / "sky-cumulus-b.png")
    save(nebula(rng, 2400, 640, 4, 3), out / "sky-nebula-near.png")
    save(nebula(rng, 1800, 480, 2, 5), out / "sky-nebula-far.png")


if __name__ == "__main__":
    main()
