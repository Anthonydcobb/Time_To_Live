"""Gus, the night manager: a 16x32 walk sheet in the same layout as the others.
Rows: down, up, left, right. Each row is stand, step, pass, step, pass.
Drawn from agy's `art/concepts/characters/gus-walk-concept.jpg`: bald on top with a ring of
grey hair, heavy-lidded eyes, a grey mustache, khaki shirt, brown vest, keys on his belt.

    python art/source/characters/make-gus.py public/assets/sprites/characters/gus-walk.png
"""
import sys
from PIL import Image

P = {
    "1": (0x1A, 0x16, 0x1A),
    "k": (0xD8, 0xB0, 0x90), "s": (0xC0, 0x96, 0x76), "S": (0x98, 0x72, 0x58),
    "w": (0xBC, 0xB6, 0xAA), "W": (0x8E, 0x88, 0x7E),
    "m": (0x86, 0x80, 0x74),
    "t": (0xB4, 0xA2, 0x7A), "T": (0x8E, 0x7E, 0x58),
    "v": (0x5E, 0x3E, 0x2A), "V": (0x44, 0x29, 0x1C),
    "p": (0x4E, 0x58, 0x66), "P": (0x3A, 0x42, 0x50),
    "y": (0xD0, 0xA8, 0x40),
    "b": (0x2A, 0x24, 0x20), "o": (0x2A, 0x24, 0x20),
}

DOWN = """
......1111......
....11kkkk11....
...1kkssssss1...
..1wksssssssS1..
..1wwsssssssw1..
..1wsWWssWWsw1..
..1ws11ss11sw1..
..1wsSSssSSsS1..
..1ssssSSsssS1..
..1SsmmmmmmsS1..
...1msSSSSsm1...
....1SssssS1....
....1tTssTt1....
..1ttvvttvvtt1..
..1tvvvttvvvt1..
..1tvvvtTvvvt1..
..1tvvvtTvvvt1..
..1tVvvtTvvVt1..
..1tVvvtTvvVt1..
..1s1vvtTvv1s1..
..1S1bbbbyb1S1..
...1pppppypp1...
...1pppppypp1...
...1ppppppPp1...
...1pppP1pppP1..
...1pppP1pppP1..
...1pppP1pppP1..
...1PPPP1PPPP1..
...1oooo1oooo1..
...11111111111..
"""

UP = """
......1111......
....11kkkk11....
...1kkssssss1...
..1wksssssssS1..
..1wwsssssssw1..
..1wwwsssswww1..
..1wwwwwwwwww1..
..1wWwwwwwwWw1..
..1SwWwwwwWwS1..
..1SWwwwwwwWS1..
...1WWWWWWWW1...
....1SssssS1....
....1tTttTt1....
..1ttvvvvvvtt1..
..1tvvvvvvvvt1..
..1tvvvvvvvvt1..
..1tvvvVvvvvt1..
..1tVvvvvvvVt1..
..1tVvvvvvvVt1..
..1s1vvvvvv1s1..
..1S1bbbbbb1S1..
...1pppppppp1...
...1pppppppp1...
...1ppppppPp1...
...1pppP1pppP1..
...1pppP1pppP1..
...1pppP1pppP1..
...1PPPP1PPPP1..
...1oooo1oooo1..
...11111111111..
"""

LEFT = """
......11111.....
.....1kkkkk1....
....1kssssssS1..
....1sssssswwW1.
...1sWWsssswwwW1
...1s1sssssSwW1.
..1ssSsssssSwW1.
..11sSsssssSwW1.
...1mmmssssSSW1.
...1mmSsssssS1..
....1SsssSS1....
.....1tssT1.....
....1ttvvvvt1...
....1tvvvvvt1...
....1tvvvTvt1...
....1tvvvTvt1...
....1tvvvTvt1...
....1tVvvTvt1...
....1tVvvsvt1...
....1bbbbsbby1..
....1pppppppy1..
....1ppppppP1...
....1pppppPP1...
....1pppPpPP1...
....1ppP1pPP1...
....1ppP1pPP1...
...1oooo1ooo1...
...111111111....
"""

# Which columns are each leg, for lifting a foot on a step.
LEGS = {"down": ((3, 8), (8, 13)), "up": ((3, 8), (8, 13)), "left": ((3, 8), (8, 12))}
FEET_ROWS = 6  # the bottom rows that move with a lifted leg


def grid(text):
    rows = [r.strip() for r in text.strip("\n").split("\n")]
    for r in rows:
        assert len(r) == 16, (len(r), r)
    return [["."] * 16 for _ in range(32 - len(rows))] + [list(r) for r in rows]


def step(g, cols):
    """The leg in `cols` lifted a pixel: its bottom rows move up and the floor row empties."""
    out = [row[:] for row in g]
    x0, x1 = cols
    for x in range(x0, x1 + 1):
        for y in range(32 - FEET_ROWS, 32):
            out[y - 1][x] = g[y][x]
        out[31][x] = "."
    return out


def bob(g):
    """Passing: everything above the knees sinks a pixel."""
    out = [row[:] for row in g]
    knee = 32 - FEET_ROWS
    for y in range(knee, 0, -1):
        out[y] = g[y - 1][:]
    out[0] = ["."] * 16
    # keep the feet planted
    for y in range(knee + 1, 32):
        out[y] = g[y][:]
    return out


def walk(g, legs):
    return [g, step(g, legs[0]), bob(g), step(g, legs[1]), bob(g)]


def image(g):
    img = Image.new("RGBA", (16, 32), (0, 0, 0, 0))
    for y, row in enumerate(g):
        for x, ch in enumerate(row):
            if ch != ".":
                img.putpixel((x, y), P[ch] + (255,))
    return img


def sheet():
    left = grid(LEFT)
    right = [row[::-1] for row in left]
    rows = [walk(grid(DOWN), LEGS["down"]), walk(grid(UP), LEGS["up"]), walk(left, LEGS["left"]),
            walk(right, tuple((15 - b, 15 - a) for a, b in LEGS["left"]))]
    img = Image.new("RGBA", (80, 128), (0, 0, 0, 0))
    for r, frames in enumerate(rows):
        for c, g in enumerate(frames):
            img.paste(image(g), (c * 16, r * 32))
    return img


if __name__ == "__main__":
    out = sys.argv[1]
    img = sheet()
    img.save(out)
    bg = Image.new("RGBA", img.size, (0x8A, 0x9A, 0x8A, 255))
    bg.alpha_composite(img)
    bg.resize((img.width * 6, img.height * 6), Image.NEAREST).save(out.replace(".png", "-x6.png"))
