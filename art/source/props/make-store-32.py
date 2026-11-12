"""Redraws Finch's Quick Stop at 32 px per tile, from the 16 px sheets, with art/source/upres32.py.

Each 16 px sheet in public/assets/sprites (store tiles, fridges, counter, rack, wall jack and the
decor sheet) gets a 32 px twin named *-32.png with the same frames in the same places, so the
room in rooms.ts only swaps sheet keys. The twins are a first pass toward the player-walk concept
style: one-pixel outlines, light from the top left, a little grain. Hand-drawn 32 px versions can
replace any of them later without code changes.

    python art/source/props/make-store-32.py
"""

import math
import random
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "art/source"))
from upres32 import preview, upres  # noqa: E402

T = 32
STONE = (78, 77, 62)
GROUT = (40, 39, 34)
DAMP = (64, 86, 60)
GRIME = (52, 46, 38)

SPRITES = ROOT / "public/assets/sprites"
PREVIEWS = ROOT / "art/previews"
SHEETS = [
    ("tiles", "store-tiles", False),
    ("props", "store-fridges", True),
    ("props", "store-counter", True),
    ("props", "store-rack", True),
    ("props", "store-jack", True),
    ("props", "store-decor", True),
]


def mix(c, to, k):
    return tuple(round(a + (b - a) * k) for a, b in zip(c, to))


def slab(frame: int) -> Image.Image:
    """One worn stone floor tile, like the concept's: mottled, grouted on the bottom and right,
    its top and left edges catching the tubes. Frames 2 to 7 carry the store's wear."""
    rng = random.Random(500 + frame)
    tone = rng.uniform(-5, 5)
    phase = [rng.uniform(0, 6.3) for _ in range(4)]
    im = Image.new("RGBA", (T, T))
    px = im.load()
    for y in range(T):
        for x in range(T):
            # Low, lumpy noise so the stone isn't flat, plus a few flecks.
            n = math.sin(x * 0.35 + phase[0]) * math.sin(y * 0.29 + phase[1]) * 4 + math.sin((x + y) * 0.6 + phase[2]) * 2
            c = tuple(max(0, min(255, round(v + tone + n))) for v in STONE)
            if rng.random() < 0.05:
                c = mix(c, (24, 22, 30), 0.25) if rng.random() < 0.7 else mix(c, (255, 244, 220), 0.12)
            if x == T - 1 or y == T - 1:
                c = GROUT
            elif x == 0 or y == 0:
                c = mix(c, (255, 244, 220), 0.1)
            elif x == T - 2 or y == T - 2:
                c = mix(c, (24, 22, 30), 0.18)
            px[x, y] = c + (255,)

    def crack(n: int) -> None:
        x, y = rng.randrange(6, 26), rng.randrange(2, 8)
        for _ in range(n):
            if 1 <= x < T - 2 and 1 <= y < T - 2:
                px[x, y] = mix(px[x, y][:3], GROUT, 0.8) + (255,)
                if 1 <= x + 1 < T - 2:
                    px[x + 1, y] = mix(px[x + 1, y][:3], (255, 244, 220), 0.12) + (255,)
            y += 1
            x += rng.choice((-1, 0, 0, 1))

    def stain(colour, r: float, k: float) -> None:
        cx, cy = rng.randrange(9, 23), rng.randrange(9, 23)
        for y in range(1, T - 2):
            for x in range(1, T - 2):
                d = math.hypot(x - cx, (y - cy) * 1.3) + rng.uniform(-2, 2)
                if d < r:
                    px[x, y] = mix(px[x, y][:3], colour, k * (1 - d / r) + 0.15) + (255,)

    if frame == 2:
        crack(18)
    elif frame == 3:
        crack(10)
        crack(8)
    elif frame == 4:
        stain(DAMP, 9, 0.5)  # damp coming up through the slab
    elif frame == 5:
        stain(GRIME, 7, 0.6)
    elif frame == 6:
        stain((104, 102, 84), 11, 0.35)  # worn pale where everyone walks
    elif frame == 7:
        stain(DAMP, 6, 0.4)
        crack(9)
    return im


def main() -> None:
    for folder, name, grain in SHEETS:
        src = Image.open(SPRITES / folder / f"{name}.png")
        # Tiles repeat across the floor, so no random grain on them: it would show the grid.
        out = upres(src, seed=len(name), grain=grain)
        if name == "store-tiles":
            # The floor row is drawn fresh at 32 px; the walls keep their doubled 16 px art.
            for f in range(8):
                out.paste(slab(f), (f * T, 0))
        out.save(SPRITES / folder / f"{name}-32.png")
        (PREVIEWS / folder).mkdir(parents=True, exist_ok=True)
        preview(out, 3).save(PREVIEWS / folder / f"{name}-32-x3.png")
        print(f"{folder}/{name}-32.png: {out.width}x{out.height}")


if __name__ == "__main__":
    main()
