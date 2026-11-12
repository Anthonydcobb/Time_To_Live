"""Redraws Bob's office at 32 px per tile, from its 16 px sheets, with art/source/upres32.py.

Same idea as make-store-32.py: every sheet gets a *-32.png twin with the same frames in the same
places (office tiles, office props, the walkie), so rooms.ts only swaps sheet keys. The office
also borrows boxes and files from store-decor, which make-store-32.py already made.

    python art/source/props/make-office-32.py
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
# Dim, worn sheet linoleum in big tile-sized squares, the colour of an office that's a bit too old.
LINO = [(70, 72, 60), (66, 68, 57)]
SEAM = (48, 48, 42)
WARM = (255, 244, 220)
COOL = (24, 22, 30)

SPRITES = ROOT / "public/assets/sprites"
PREVIEWS = ROOT / "art/previews"
SHEETS = [
    ("tiles", "office-tiles", False),
    ("props", "office-props", True),
    ("props", "walkie", True),
]


def mix(c, to, k):
    return tuple(round(a + (b - a) * k) for a, b in zip(c, to))


def linoleum(frame: int) -> Image.Image:
    """One floor tile of dim, worn linoleum, faintly mottled, with a faint seam on two sides.
    Frames 2 to 7 keep the old sheet's wear: a crack, scuffs, a water stain, a cable cover, a
    dropped memo and a dark stain."""
    rng = random.Random(900 + frame)
    im = Image.new("RGBA", (T, T))
    px = im.load()
    for y in range(T):
        for x in range(T):
            base = LINO[frame % 2]
            n = math.sin(x * 0.45 + frame) * math.sin(y * 0.38 + frame * 2) * 2.5
            c = tuple(round(v + n) for v in base)
            if rng.random() < 0.04:
                c = mix(c, COOL, 0.2)
            # Faint seams: the sheet was laid in tile-wide strips long ago.
            if x == T - 1 or y == T - 1:
                c = mix(c, SEAM, 0.6)
            elif x == 0 or y == 0:
                c = mix(c, WARM, 0.05)
            px[x, y] = c + (255,)

    def dots(path, colour, k):
        for x, y in path:
            if 0 <= x < T and 0 <= y < T:
                px[x, y] = mix(px[x, y][:3], colour, k) + (255,)

    def walk(n, colour, k):
        x, y = rng.randrange(6, 26), rng.randrange(4, 12)
        path = []
        for _ in range(n):
            path.append((x, y))
            y += 1
            x += rng.choice((-1, 0, 1))
        dots(path, colour, k)

    def blot(colour, r, k):
        cx, cy = rng.randrange(10, 22), rng.randrange(10, 22)
        dots([(x, y) for y in range(T) for x in range(T) if math.hypot(x - cx, (y - cy) * 1.2) + rng.uniform(-2, 2) < r], colour, k)

    if frame in (0, 1):
        blot((84, 84, 70), 9, 0.25)  # worn paler where people walk
    if frame == 2:
        walk(16, COOL, 0.7)  # a crack
    elif frame == 3:
        for _ in range(3):
            walk(5, (60, 58, 52), 0.5)  # chair-castor scuffs
    elif frame == 4:
        blot((70, 96, 104), 8, 0.35)  # a water stain from the ceiling
    elif frame == 5:
        # A grey cable cover taped across the floor, with red tape at the ends.
        for y in range(13, 19):
            for x in range(T):
                c = (110, 110, 112) if y in (14, 15) else (84, 84, 88) if y in (16, 17) else (52, 52, 56)
                px[x, y] = (150, 60, 56, 255) if x in (2, 3, 28, 29) and 14 <= y <= 17 else c + (255,)
    elif frame == 6:
        # A dropped memo.
        for y in range(9, 21):
            for x in range(10, 22):
                px[x, y] = ((214, 208, 186) if (x, y) != (21, 9) else (180, 174, 154)) + (255,)
        for y in (12, 14, 16, 18):
            for x in range(12, 20 - (y == 18) * 3):
                px[x, y] = (150, 146, 132, 255)
        for x in range(10, 22):
            px[x, 21] = mix(px[x, 21][:3], COOL, 0.4) + (255,)
    elif frame == 7:
        blot((44, 36, 30), 7, 0.55)  # coffee, long ago
    return im


def seat_monitors(src: Image.Image, drop: int = 8) -> Image.Image:
    """The tech desks (frame 0, 80x48 cells) had their monitors perched on the back edge, as if
    about to fall off. Lifts the monitors off and sets them down `drop` px onto the desktop."""
    src = src.convert("RGBA")
    px = src.load()
    x0, x1, top, edge = 24, 56, 0, 19  # the desk cell's monitor band; the desk top starts at 16
    desk = {px[x, y] for y in range(20, 26) for x in range(x0, x1)}
    monitor = {}
    for y in range(top, edge):
        for x in range(x0, x1):
            c = px[x, y]
            if c[3] and (y < 16 or c not in desk):
                monitor[(x, y)] = c
                # Above the desk it's just air; on the desk's back edge, put the desk back.
                px[x, y] = (0, 0, 0, 0) if y < 16 else px[x, y + 4]
    for (x, y), c in monitor.items():
        px[x, y + drop] = c
    return src


def main() -> None:
    for folder, name, grain in SHEETS:
        src = Image.open(SPRITES / folder / f"{name}.png")
        if name == "office-props":
            src = seat_monitors(src)
        out = upres(src, seed=len(name), grain=grain)
        if name == "office-tiles":
            # The floor row is drawn fresh at 32 px; the walls keep their doubled 16 px art.
            for f in range(8):
                out.paste(linoleum(f), (f * T, 0))
        out.save(SPRITES / folder / f"{name}-32.png")
        (PREVIEWS / folder).mkdir(parents=True, exist_ok=True)
        preview(out, 3).save(PREVIEWS / folder / f"{name}-32-x3.png")
        print(f"{folder}/{name}-32.png: {out.width}x{out.height}")


if __name__ == "__main__":
    main()
