"""Redraws a 16 px sprite sheet at 32 px with shading, so old art sits next to the 32 px concept style.

A plain 2x blow-up just gives fat pixels. This doubles the sheet, then does what a pixel artist
would do in a first pass at the higher resolution:

* thins the outline back to one pixel, and colours the inner half of it a dark shade of whatever
  it touches (a "selout"), so shapes read as solid instead of drawn with a marker;
* lights every shape from the top left: a one-pixel highlight along top and left edges and a
  one-pixel shadow along bottom and right edges, so small details read as raised;
* adds a little grain to big flat areas so they stop looking like plastic;
* keeps every colour on a ramp of three shades of a source colour, so the palette stays small.

Use it from the per-sheet scripts (art/source/props/make-store-32.py and friends):

    from upres32 import upres
    upres(Image.open("store-decor.png")).save("store-decor-32.png")
"""

from __future__ import annotations

import random

from PIL import Image

Color = tuple[int, int, int, int]

# How hard the light hits, as a fraction of the way to white or black.
LIGHT = 0.16
SHADE = 0.22
GRAIN = 0.07


def luma(c: Color) -> float:
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def mix(c: Color, to: tuple[int, int, int], k: float) -> Color:
    return (round(c[0] + (to[0] - c[0]) * k), round(c[1] + (to[1] - c[1]) * k), round(c[2] + (to[2] - c[2]) * k), c[3])


def lighter(c: Color, k: float = LIGHT) -> Color:
    # Warm the highlight a touch, like a sodium or tungsten lamp, rather than go grey.
    return mix(c, (255, 244, 220), k)


def darker(c: Color, k: float = SHADE) -> Color:
    # Shadows lean cool and a bit purple, like the concepts, instead of plain black.
    return mix(c, (20, 16, 34), k)


def is_outline(c: Color) -> bool:
    return c[3] > 0 and luma(c) < 34


def upres(src: Image.Image, seed: int = 7, grain: bool = True) -> Image.Image:
    src = src.convert("RGBA")
    w, h = src.size
    s = src.load()

    def at(x: int, y: int) -> Color:
        if 0 <= x < w and 0 <= y < h:
            return s[x, y]
        return (0, 0, 0, 0)

    def same(a: Color, b: Color) -> bool:
        return a[3] > 0 and b[3] > 0 and a[:3] == b[:3]

    out = Image.new("RGBA", (w * 2, h * 2))
    o = out.load()
    rng = random.Random(seed)
    for y in range(h):
        for x in range(w):
            c = s[x, y]
            if c[3] == 0:
                continue
            up, down, left, right = at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)
            if is_outline(c):
                # Each of the four 2x pixels stays outline only if it faces outside (or another
                # outline pixel continues past it); the half facing the shape becomes a selout.
                for dy in (0, 1):
                    for dx in (0, 1):
                        nx = left if dx == 0 else right
                        ny = up if dy == 0 else down
                        inner = [n for n in (nx, ny) if n[3] > 0 and not is_outline(n)]
                        outer = nx[3] == 0 or ny[3] == 0
                        if inner and not outer:
                            o[2 * x + dx, 2 * y + dy] = darker(inner[0], 0.55)
                        else:
                            o[2 * x + dx, 2 * y + dy] = c
                continue
            for dy in (0, 1):
                for dx in (0, 1):
                    p = c
                    edge_top = dy == 0 and not same(c, up)
                    edge_left = dx == 0 and not same(c, left)
                    edge_bottom = dy == 1 and not same(c, down)
                    edge_right = dx == 1 and not same(c, right)
                    if edge_bottom or (edge_right and not edge_top):
                        p = darker(c)
                    elif edge_top or edge_left:
                        p = lighter(c)
                    elif grain and rng.random() < 0.10:
                        p = darker(c, GRAIN) if rng.random() < 0.6 else lighter(c, GRAIN)
                    o[2 * x + dx, 2 * y + dy] = p
    return out


def preview(im: Image.Image, scale: int, bg: tuple[int, int, int] = (40, 38, 44)) -> Image.Image:
    """The sheet blown up on a dark backdrop, for art/previews."""
    big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    back = Image.new("RGBA", big.size, bg + (255,))
    back.alpha_composite(big)
    return back
