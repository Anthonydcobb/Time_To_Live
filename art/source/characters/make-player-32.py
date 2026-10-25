"""Cuts a 32 px per tile walk sheet for the contractor out of the walk concept.

The concept (art/concepts/characters/player-walk-concept.jpg) is laid out like the game's
sheet: rows down, up, left, right, five frames each (standing, then four steps), on a grey
checker. This flood-fills the checker away around each frame, shrinks every frame by the same
amount so she's about 60 px tall, and stands her on the bottom centre of a 32x64 cell. The
game draws it at half the usual scale (SHEET_PX in room-scene.ts), in rooms whose props are
32 px too.

    python art/source/characters/make-player-32.py
"""

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "art/concepts/characters/player-walk-concept.jpg"
OUT = ROOT / "public/assets/sprites/characters/player-walk-32.png"
PREVIEW = ROOT / "art/previews/characters/player-walk-32-x4.png"

CELL = (32, 64)
TALL = 60  # her height on the sheet, in pixels
# Frame centres on the concept (2752x1536): five columns, four rows; each cell about 370 square.
COLS = [632, 1004, 1376, 1748, 2125]
ROWS = [315, 662, 1006, 1355]
HALF = 185


def is_backdrop(rgb: tuple[int, int, int]) -> bool:
    """A whole checker square: neutral grey near 29 or near 72. Her beanie and trousers are greys in
    between, so they stop the fill."""
    v = max(rgb)
    return v - min(rgb) <= 4 and (22 <= v <= 38 or 63 <= v <= 80)


def is_blur(rgb: tuple[int, int, int]) -> bool:
    """The JPEG smear where two squares meet: any neutral grey between them."""
    v = max(rgb)
    return v - min(rgb) <= 4 and 22 <= v <= 80


def cut(sheet: Image.Image, cx: int, cy: int) -> Image.Image:
    crop = sheet.crop((cx - HALF, cy - HALF, cx + HALF, cy + HALF)).convert("RGBA")
    w, h = crop.size
    px = crop.load()
    # The square seams block a fill of whole-square greys, so alternate: fill the squares, then
    # peel a pixel of seam off anything cleared, until a round clears nothing new. A seam is only a
    # few pixels thick, so the peeling barely touches her outline.
    queue = deque((x, y) for x in range(w) for y in (0, h - 1))
    queue.extend((x, y) for y in range(h) for x in (0, w - 1))
    for _ in range(12):
        while queue:
            x, y = queue.popleft()
            if not (0 <= x < w and 0 <= y < h) or px[x, y][3] == 0 or not is_backdrop(px[x, y][:3]):
                continue
            px[x, y] = (0, 0, 0, 0)
            queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
        seam = [
            (x, y)
            for y in range(h)
            for x in range(w)
            if px[x, y][3]
            and is_blur(px[x, y][:3])
            and any(0 <= x + dx < w and 0 <= y + dy < h and px[x + dx, y + dy][3] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        ]
        if not seam:
            break
        for x, y in seam:
            px[x, y] = (0, 0, 0, 0)
        queue.extend((x + dx, y + dy) for x, y in seam for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    keep_largest(px, w, h)
    return crop


def keep_largest(px, w: int, h: int) -> None:
    """Drops everything but her: the little tick marks the concept has above each frame."""
    label = {}
    sizes = []
    for y in range(h):
        for x in range(w):
            if px[x, y][3] and (x, y) not in label:
                n = len(sizes)
                queue, count = deque([(x, y)]), 0
                label[(x, y)] = n
                while queue:
                    a, b = queue.popleft()
                    count += 1
                    for q in ((a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)):
                        if q not in label and 0 <= q[0] < w and 0 <= q[1] < h and px[q][3]:
                            label[q] = n
                            queue.append(q)
                sizes.append(count)
    if not sizes:
        return
    best = sizes.index(max(sizes))
    for p, n in label.items():
        if n != best:
            px[p] = (0, 0, 0, 0)


def main() -> None:
    sheet = Image.open(SRC).convert("RGB")
    frames = [[cut(sheet, cx, cy) for cx in COLS] for cy in ROWS]
    # One scale for every frame, from the standing frame facing down, so steps don't change her size.
    stand = frames[0][0].getbbox()
    scale = TALL / (stand[3] - stand[1])
    out = Image.new("RGBA", (CELL[0] * len(COLS), CELL[1] * len(ROWS)))
    for row, line in enumerate(frames):
        for col, frame in enumerate(line):
            box = frame.getbbox()
            if not box:
                continue
            fig = frame.crop(box)
            size = (max(1, round(fig.width * scale)), max(1, round(fig.height * scale)))
            small = fig.resize(size, Image.LANCZOS)
            small.putalpha(small.getchannel("A").point(lambda a: 255 if a >= 128 else 0))
            # Feet on the cell's bottom, centred; anything wider than the cell is clipped.
            x = col * CELL[0] + (CELL[0] - size[0]) // 2
            y = (row + 1) * CELL[1] - size[1]
            cell = Image.new("RGBA", CELL)
            cell.paste(small, (x - col * CELL[0], y - row * CELL[1]), small)
            out.paste(cell, (col * CELL[0], row * CELL[1]), cell)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    out.resize((out.width * 4, out.height * 4), Image.NEAREST).save(PREVIEW)
    print(f"{OUT.relative_to(ROOT)}: {len(ROWS)}x{len(COLS)} frames of {CELL[0]}x{CELL[1]}, scale {scale:.3f}")


if __name__ == "__main__":
    main()
