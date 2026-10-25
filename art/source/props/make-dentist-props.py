"""Cuts the dentist's props out of Gemini's in-game sprite sheet into dentist-props.png.

The concept (art/concepts/items/dentist-sprites-concept.jpg) draws each prop at roughly
90 px per tile inside a framed box on a dark checker. This crops each box, flood-fills the
checker away from the box edges, shrinks the prop to 32 px per tile (twice the game's usual
16) and stands it on the bottom centre of a 64x96 cell, two tiles wide and three tall.
The game draws this sheet at half the usual scale (SHEET_PX in room-scene.ts), so a tile of
it covers the same ground as a 16 px tile with four times the pixels.

    python art/source/props/make-dentist-props.py
"""

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "art/concepts/items/dentist-sprites-concept.jpg"
OUT = ROOT / "public/assets/sprites/props/dentist-props.png"
PREVIEW = ROOT / "art/previews/props/dentist-props-x4.png"

PX = 32  # pixels per tile on this sheet
CELL = (2 * PX, 3 * PX)

# Frame order, the box on the concept (left, top, right, bottom) and how many tiles wide to draw
# it. Big things can be wider than their footprint in rooms.ts; they overhang it a little.
PROPS = [
    ("chair", (87, 87, 214, 268), 1.6),
    ("lightbox", (360, 87, 470, 268), 1.3),
    ("lightbox-haunted", (619, 87, 729, 268), 1.3),
    ("operatory-pc", (884, 87, 995, 268), 1.3),
    ("panoramic-xray", (1145, 80, 1257, 268), 1.5),
    ("reception-desk", (85, 358, 293, 500), 2),
    ("rack", (476, 323, 585, 500), 1.4),
    ("bench", (762, 358, 968, 500), 2),
    ("restricted-door", (1100, 323, 1255, 500), 1),
    ("packing-bench", (90, 575, 295, 718), 2),
    ("jar-packer", (481, 555, 595, 718), 1.5),
    ("crate", (827, 635, 907, 718), 1.1),
    ("shelf", (1100, 560, 1256, 718), 2),
]


def is_backdrop(rgb: tuple[int, int, int]) -> bool:
    """The checker inside each box: dark, slightly blue grey."""
    r, g, b = rgb
    return max(rgb) <= 70 and -2 <= b - r <= 14 and -3 <= g - r <= 8


def cut(sheet: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """The prop in `box`, with the frame and the checker around it made transparent."""
    inset = 4  # past the box's frame line
    l, t, r, b = box
    crop = sheet.crop((l + inset, t + inset, r - inset, b - inset)).convert("RGBA")
    w, h = crop.size
    px = crop.load()
    seen = set()
    queue = deque((x, y) for x in range(w) for y in (0, h - 1))
    queue.extend((x, y) for y in range(h) for x in (0, w - 1))
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
            continue
        seen.add((x, y))
        if not is_backdrop(px[x, y][:3]):
            continue
        px[x, y] = (0, 0, 0, 0)
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return crop.crop(crop.getbbox())


def main() -> None:
    sheet = Image.open(SRC).convert("RGB")
    out = Image.new("RGBA", (CELL[0] * len(PROPS), CELL[1]))
    for i, (_, box, tiles) in enumerate(PROPS):
        prop = cut(sheet, box)
        scale = min(tiles * PX / prop.width, CELL[1] / prop.height)
        size = (min(CELL[0], max(1, round(prop.width * scale))), max(1, round(prop.height * scale)))
        small = prop.resize(size, Image.LANCZOS)
        # Pixel art has hard edges: no half-see-through fringe.
        alpha = small.getchannel("A").point(lambda a: 255 if a >= 128 else 0)
        small.putalpha(alpha)
        out.paste(small, (i * CELL[0] + (CELL[0] - size[0]) // 2, CELL[1] - size[1]), small)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    out.resize((out.width * 4, out.height * 4), Image.NEAREST).save(PREVIEW)
    print(f"{OUT.relative_to(ROOT)}: {len(PROPS)} frames of {CELL[0]}x{CELL[1]}")


if __name__ == "__main__":
    main()
