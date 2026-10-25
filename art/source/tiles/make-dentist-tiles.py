"""Makes the dentist's tileset at 32 px per tile: public/assets/sprites/tiles/dentist-tiles.png.

Same layout as office-tiles (8 columns, 3 rows; see FLOOR_FRAMES and friends in rooms.ts), so the
room scene picks wall frames the same way. Row 0 is new: 1970s clinic vinyl, cream and pale mint
squares a half-tile across, flecked, yellowed at the grout, with the usual wear in the rarer frames.
Rows 1 and 2 are the office walls doubled, so the dentist's walls match everyone else's.

    python art/source/tiles/make-dentist-tiles.py
"""

import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OFFICE = ROOT / "public/assets/sprites/tiles/office-tiles.png"
OUT = ROOT / "public/assets/sprites/tiles/dentist-tiles.png"
PREVIEW = ROOT / "art/previews/tiles/dentist-tiles-x4.png"

T = 32
CREAM = (176, 170, 146)
MINT = (146, 164, 150)
GROUT = (112, 108, 90)
FLECKS = [(120, 116, 98), (196, 190, 166), (98, 110, 100)]


def shade(c: tuple[int, int, int], d: int) -> tuple[int, int, int]:
    return tuple(max(0, min(255, v + d)) for v in c)


def vinyl(seed: int) -> Image.Image:
    """Four squares, cream and mint, with flecks, a grout line and a little lamp-fade."""
    rng = random.Random(seed)
    im = Image.new("RGB", (T, T))
    px = im.load()
    for y in range(T):
        for x in range(T):
            square = CREAM if ((x // 16) + (y // 16)) % 2 == 0 else MINT
            c = shade(square, rng.choice((0, 0, 0, -3, 3)))
            if x % 16 == 15 or y % 16 == 15:
                c = GROUT
            elif x % 16 == 0 or y % 16 == 0:
                c = shade(square, 10)  # the bevel catching the light
            px[x, y] = c
    for _ in range(26):
        x, y = rng.randrange(T), rng.randrange(T)
        if x % 16 not in (0, 15) and y % 16 not in (0, 15):
            px[x, y] = rng.choice(FLECKS)
    return im


def scuff(im: Image.Image, rng: random.Random, colour: tuple[int, int, int], n: int) -> None:
    """A dragged mark: a short wobbling line of dots."""
    px = im.load()
    x, y = rng.randrange(4, T - 4), rng.randrange(4, T - 4)
    dx = rng.choice((-1, 1))
    for _ in range(n):
        px[x % T, y % T] = colour
        x += dx
        if rng.random() < 0.4:
            y += rng.choice((-1, 1))


def stain(im: Image.Image, rng: random.Random, colour: tuple[int, int, int], r: int) -> None:
    px = im.load()
    cx, cy = rng.randrange(8, T - 8), rng.randrange(8, T - 8)
    for y in range(T):
        for x in range(T):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 + rng.uniform(-1.5, 1.5)
            if d < r:
                base = px[x, y]
                k = 0.55 if d < r - 2 else 0.3
                px[x, y] = tuple(round(b * (1 - k) + c * k) for b, c in zip(base, colour))


def floors() -> list[Image.Image]:
    out = []
    for frame in range(8):
        rng = random.Random(100 + frame)
        im = vinyl(frame)
        if frame == 2:
            scuff(im, rng, (88, 84, 72), 14)  # chair castor
        elif frame == 3:
            scuff(im, rng, (70, 66, 58), 10)
            scuff(im, rng, (70, 66, 58), 7)  # a crack across the square
        elif frame == 4:
            stain(im, rng, (122, 84, 62), 6)  # something mopped, not quite enough
        elif frame == 5:
            # a lifted corner: one square darker where the glue gave up
            px = im.load()
            for y in range(1, 15):
                for x in range(17, 31):
                    if x - 17 > y:
                        px[x, y] = shade(px[x, y], -22)
        elif frame == 6:
            stain(im, rng, (150, 150, 120), 9)  # old wax, yellowed
        elif frame == 7:
            scuff(im, rng, (96, 92, 80), 20)
            scuff(im, rng, (96, 92, 80), 12)
        out.append(im)
    return out


def main() -> None:
    office = Image.open(OFFICE).convert("RGBA")
    sheet = Image.new("RGBA", (8 * T, 3 * T))
    for i, im in enumerate(floors()):
        sheet.paste(im, (i * T, 0))
    walls = office.crop((0, 16, 128, 48)).resize((256, 64), Image.NEAREST)
    sheet.paste(walls, (0, T), walls)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST).save(PREVIEW)
    print(f"{OUT.relative_to(ROOT)}: 8x3 tiles of {T} px")


if __name__ == "__main__":
    main()
