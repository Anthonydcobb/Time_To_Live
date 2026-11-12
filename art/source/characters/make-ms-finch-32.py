"""Draws Ms. Finch's 32 px walk sheet: public/assets/sprites/characters/ms-finch-walk-32.png.

She's drawn from Ant's dialogue concepts (art/concepts/characters/ms-finch-dialogue-*-concept.jpg):
a messy dark bun with a pencil through it and three plastic clips (teal, pink, green), a maroon
cardigan over a charcoal tee, a cream apron with pink flowers, a ring of keys on a cord, dark
slacks and white sneakers. Same layout as the player's 32 px sheet: 32x64 cells, rows down, up,
left, right, five frames each (standing, then four steps).

Everything is built from simple shapes, one material per pixel, then lit from the top left,
given a form shadow on the right, and outlined in a dark shade of whatever it borders, the way
the player-walk concept is drawn. Change a colour or a shape here and rerun:

    python art/source/characters/make-ms-finch-32.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "public/assets/sprites/characters/ms-finch-walk-32.png"
PREVIEW = ROOT / "art/previews/characters/ms-finch-walk-32-x4.png"

W, H = 32, 64

# Materials: base colour, and whether big areas get a form shadow on their right side.
MAT = {
    "skin": ((208, 164, 134), True),
    "blush": ((214, 150, 136), False),
    "hair": ((62, 40, 34), True),
    "hairhi": ((112, 76, 58), False),
    "card": ((106, 42, 56), True),
    "tee": ((60, 58, 66), False),
    "apron": ((192, 180, 148), True),
    "flower": ((178, 96, 104), False),
    "leaf": ((106, 126, 88), False),
    "slacks": ((42, 42, 54), True),
    "shoe": ((188, 184, 176), False),
    "sole": ((120, 116, 112), False),
    "eye": ((34, 26, 30), False),
    "white": ((236, 232, 222), False),
    "brow": ((58, 38, 32), False),
    "mouth": ((150, 70, 72), False),
    "cord": ((44, 40, 46), False),
    "key": ((200, 164, 86), False),
    "pencil": ((206, 162, 74), False),
    "eraser": ((222, 122, 140), False),
    "lead": ((70, 60, 50), False),
    "clip1": ((96, 170, 176), False),
    "clip2": ((222, 120, 150), False),
    "clip3": ((120, 176, 104), False),
    "string": ((200, 188, 154), False),
}
WARM = (255, 244, 220)
COOL = (22, 16, 36)


def mix(c, to, k):
    return tuple(round(a + (b - a) * k) for a, b in zip(c, to))


class Canvas:
    def __init__(self) -> None:
        self.m: dict[tuple[int, int], str] = {}

    def px(self, x: int, y: int, mat: str) -> None:
        if 0 <= x < W and 0 <= y < H:
            self.m[(x, y)] = mat

    def rect(self, x0: int, y0: int, x1: int, y1: int, mat: str) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.px(x, y, mat)

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, mat: str) -> None:
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.px(x, y, mat)

    def line(self, x0: int, y0: int, x1: int, y1: int, mat: str) -> None:
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            self.px(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), mat)

    def recolor(self, mat_from: str, mat_to: str, pred) -> None:
        for (x, y), m in list(self.m.items()):
            if m == mat_from and pred(x, y):
                self.m[(x, y)] = mat_to

    def render(self) -> Image.Image:
        im = Image.new("RGBA", (W, H))
        p = im.load()
        m = self.m
        xs = [x for x, _ in m]
        mid = (min(xs) + max(xs)) / 2 if xs else W / 2
        for (x, y), mat in m.items():
            base, form = MAT[mat]
            c = base
            if form and x > mid + 2:
                c = mix(c, COOL, 0.26)
            up, left = m.get((x, y - 1)), m.get((x - 1, y))
            down, right = m.get((x, y + 1)), m.get((x + 1, y))
            if mat == "skin" and up in ("hair", "tee", "card") or (mat in ("tee", "card", "apron") and m.get((x, y - 1)) == "skin" and m.get((x, y - 2)) == "skin"):
                c = mix(c, COOL, 0.3)
            elif form and (down != mat or right != mat):
                c = mix(c, COOL, 0.16)
            elif form and (up != mat or left != mat):
                c = mix(c, WARM, 0.18)
            p[x, y] = c + (255,)
        # Selective outline: a dark shade of whatever it wraps.
        for y in range(H):
            for x in range(W):
                if (x, y) in m:
                    continue
                for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                    n = m.get((x + dx, y + dy))
                    if n:
                        p[x, y] = mix(MAT[n][0], COOL, 0.82) + (255,)
                        break
        return im


def apron_print(c: Canvas, x0: int, y0: int, x1: int, y1: int, phase: int = 0) -> None:
    """Little pink flowers with a green leaf, scattered in a loose grid over the apron."""
    for y in range(y0 + 1, y1, 4):
        for x in range(x0 + 1 + ((y // 4 + phase) % 2) * 2, x1, 4):
            if c.m.get((x, y)) == "apron":
                c.px(x, y, "flower")
                if c.m.get((x + 1, y + 1)) == "apron":
                    c.px(x + 1, y + 1, "leaf")


def legs_front(c: Canvas, step: int, bob: int) -> None:
    """Facing down or up: a step lifts one foot a pixel or two and the other stays planted."""
    lift = {0: (0, 0), 1: (2, 0), 2: (0, 0), 3: (0, 2), 4: (0, 0)}[step]
    for i, (x0, x1) in enumerate(((11, 15), (17, 21))):
        top = 46 + bob
        bottom = 59 - lift[i]
        c.rect(x0, top, x1, bottom, "slacks")
        c.rect(x0 - (1 if i == 0 else 0), bottom + 1, x1 + (1 if i == 1 else 0), bottom + 3, "shoe")
        c.rect(x0 - (1 if i == 0 else 0), bottom + 3, x1 + (1 if i == 1 else 0), bottom + 3, "sole")


def draw_down(step: int) -> Canvas:
    c = Canvas()
    bob = 1 if step in (2, 4) else 0
    legs_front(c, step, bob)
    swing = {0: 0, 1: 1, 2: 0, 3: -1, 4: 0}[step]
    y = bob
    # Arms in cardigan sleeves, hands below.
    c.rect(6, 28 + y + swing, 9, 43 + y + swing, "card")
    c.rect(6, 44 + y + swing, 9, 46 + y + swing, "skin")
    c.rect(23, 28 + y - swing, 26, 43 + y - swing, "card")
    c.rect(23, 44 + y - swing, 26, 46 + y - swing, "skin")
    # Torso: cardigan, tee at the neck, apron over the front.
    c.rect(9, 29 + y, 23, 47 + y, "card")
    c.ellipse(16, 31 + y, 9, 4.5, "card")
    c.rect(13, 27 + y, 19, 31 + y, "tee")
    c.rect(12, 31 + y, 20, 49 + y, "apron")
    c.rect(11, 36 + y, 21, 49 + y, "apron")
    apron_print(c, 11, 31 + y, 21, 49 + y)
    # Apron straps up to the neck.
    c.line(12, 31 + y, 13, 27 + y, "apron")
    c.line(20, 31 + y, 19, 27 + y, "apron")
    # Keys on a cord.
    c.line(14, 26 + y, 15, 35 + y, "cord")
    c.line(18, 26 + y, 17, 35 + y, "cord")
    c.rect(15, 36 + y, 17, 37 + y, "key")
    c.px(14, 38 + y, "key")
    c.px(16, 39 + y, "key")
    c.px(18, 38 + y, "key")
    # Neck and head.
    c.rect(14, 23 + y, 18, 27 + y, "skin")
    c.ellipse(16, 16 + y, 7.6, 8.4, "skin")
    # Hair: a cap of messy waves, loose strands down the sides, a big bun on top.
    c.ellipse(16, 10 + y, 8.6, 5.2, "hair")
    c.rect(8, 11 + y, 9, 22 + y, "hair")
    c.rect(23, 11 + y, 24, 21 + y, "hair")
    c.px(8, 23 + y, "hair")
    c.px(24, 22 + y, "hair")
    c.rect(10, 13 + y, 12, 13 + y, "hair")
    c.px(10, 14 + y, "hair")
    c.ellipse(17, 5 + y, 4.6, 3.8, "hair")
    for x, yy in ((13, 10), (17, 9), (20, 11), (11, 15), (15, 6), (19, 4)):
        c.px(x, yy + y, "hairhi")
    # Fringe edge: a few strands over the forehead.
    c.px(12, 14 + y, "hair")
    c.px(19, 14 + y, "hair")
    c.px(20, 15 + y, "hair")
    # Pencil through the bun, and three clips on her right (viewer's left).
    c.line(21, 2 + y, 15, 6 + y, "pencil")
    c.px(21, 2 + y, "eraser")
    c.px(22, 1 + y, "eraser")
    c.rect(9, 10 + y, 10, 11 + y, "clip1")
    c.rect(10, 12 + y, 11, 12 + y, "clip2")
    c.rect(11, 9 + y, 12, 9 + y, "clip3")
    # Face: brows, eyes with a catchlight, a smile, a little blush.
    c.rect(11, 16 + y, 13, 16 + y, "brow")
    c.rect(19, 16 + y, 21, 16 + y, "brow")
    c.rect(12, 18 + y, 13, 19 + y, "eye")
    c.rect(19, 18 + y, 20, 19 + y, "eye")
    c.px(12, 18 + y, "white")
    c.px(19, 18 + y, "white")
    c.px(11, 21 + y, "blush")
    c.px(21, 21 + y, "blush")
    c.rect(15, 22 + y, 17, 22 + y, "mouth")
    c.px(14, 21 + y, "mouth")
    c.px(18, 21 + y, "mouth")
    return c


def draw_up(step: int) -> Canvas:
    c = Canvas()
    bob = 1 if step in (2, 4) else 0
    legs_front(c, step, bob)
    swing = {0: 0, 1: -1, 2: 0, 3: 1, 4: 0}[step]
    y = bob
    c.rect(6, 28 + y + swing, 9, 43 + y + swing, "card")
    c.rect(6, 44 + y + swing, 9, 46 + y + swing, "skin")
    c.rect(23, 28 + y - swing, 26, 43 + y - swing, "card")
    c.rect(23, 44 + y - swing, 26, 46 + y - swing, "skin")
    c.rect(9, 29 + y, 23, 48 + y, "card")
    c.ellipse(16, 31 + y, 9, 4.5, "card")
    # Apron strings tied in a bow at the small of her back.
    c.rect(9, 40 + y, 23, 40 + y, "string")
    c.rect(14, 39 + y, 15, 41 + y, "string")
    c.rect(17, 39 + y, 18, 41 + y, "string")
    c.px(15, 42 + y, "string")
    c.px(17, 42 + y, "string")
    c.rect(14, 23 + y, 18, 27 + y, "skin")
    # The back of her head is all hair.
    c.ellipse(16, 15 + y, 8.6, 8.8, "hair")
    c.rect(9, 15 + y, 23, 23 + y, "hair")
    c.px(10, 24 + y, "hair")
    c.px(22, 24 + y, "hair")
    c.ellipse(16, 6 + y, 5.2, 4.4, "hair")
    for x, yy in ((12, 12), (18, 10), (14, 18), (20, 17), (15, 5), (17, 20)):
        c.px(x, yy + y, "hairhi")
    c.line(11, 2 + y, 17, 6 + y, "pencil")
    c.px(11, 2 + y, "eraser")
    c.px(10, 1 + y, "eraser")
    c.rect(22, 10 + y, 23, 11 + y, "clip1")
    c.rect(21, 12 + y, 22, 12 + y, "clip2")
    c.rect(20, 9 + y, 21, 9 + y, "clip3")
    return c


def draw_right(step: int) -> Canvas:
    c = Canvas()
    bob = 1 if step in (2, 4) else 0
    y = bob
    # Legs: front and back, apart on steps 1 and 3, together on the passing frames.
    # Each leg is a slanted line of 4 px wide slacks from the hip to the ankle.
    spread = {0: 0, 1: 4, 2: 1, 3: 4, 4: 1}[step]
    lead = 1 if step in (1, 2) else -1  # which leg is in front
    for side in (-1, 1):
        foot = 15 + side * lead * spread
        lifted = step in (2, 4) and side == -1
        ankle_y = 58 if lifted else 59
        for yy in range(46 + y, ankle_y + 1):
            t = (yy - 46 - y) / max(1, ankle_y - 46 - y)
            x0 = round(15 + (foot - 15) * t)
            c.rect(x0, yy, x0 + 3, yy, "slacks")
        c.rect(foot, ankle_y + 1, foot + 5, ankle_y + 3, "shoe")
        c.rect(foot, ankle_y + 3, foot + 5, ankle_y + 3, "sole")
    # Body in profile: cardigan, apron on the front edge.
    c.rect(11, 29 + y, 20, 47 + y, "card")
    c.ellipse(15.5, 31 + y, 5.5, 4, "card")
    c.rect(18, 30 + y, 21, 49 + y, "apron")
    apron_print(c, 18, 30 + y, 22, 49 + y, phase=1)
    c.line(19, 30 + y, 18, 26 + y, "apron")
    c.line(17, 26 + y, 20, 35 + y, "cord")
    c.rect(20, 35 + y, 21, 37 + y, "key")
    # The near arm swings with the stride.
    arm = {0: 0, 1: -2, 2: 0, 3: 2, 4: 0}[step]
    c.rect(14 + arm, 28 + y, 17 + arm, 43 + y, "card")
    c.rect(14 + arm, 44 + y, 17 + arm, 46 + y, "skin")
    # Neck, head, face to the right.
    c.rect(15, 23 + y, 18, 27 + y, "skin")
    c.ellipse(17, 16 + y, 7, 8.4, "skin")
    c.px(24, 18 + y, "skin")  # nose
    c.px(24, 19 + y, "skin")
    # Hair falls behind; the bun sits at the back of her crown.
    c.ellipse(15, 10 + y, 7.2, 4.8, "hair")
    c.rect(10, 11 + y, 16, 21 + y, "hair")
    c.rect(10, 22 + y, 14, 22 + y, "hair")
    c.rect(17, 12 + y, 17, 15 + y, "hair")
    c.px(10, 23 + y, "hair")
    c.px(13, 23 + y, "hair")
    c.rect(18, 9 + y, 22, 12 + y, "hair")
    c.px(22, 13 + y, "hair")
    c.ellipse(12, 6 + y, 4.8, 4.2, "hair")
    for x, yy in ((11, 9), (15, 8), (12, 16), (10, 5), (18, 10)):
        c.px(x, yy + y, "hairhi")
    c.line(8, 3 + y, 14, 7 + y, "pencil")
    c.px(8, 3 + y, "eraser")
    c.px(7, 2 + y, "eraser")
    c.rect(15, 11 + y, 16, 12 + y, "clip1")
    c.rect(13, 14 + y, 14, 14 + y, "clip2")
    c.rect(17, 9 + y, 18, 9 + y, "clip3")
    c.px(16, 18 + y, "skin")  # ear
    c.px(16, 19 + y, "skin")
    c.rect(20, 16 + y, 22, 16 + y, "brow")
    c.rect(21, 18 + y, 22, 19 + y, "eye")
    c.px(22, 18 + y, "white")
    c.px(20, 21 + y, "blush")
    c.rect(21, 22 + y, 23, 22 + y, "mouth")
    c.px(23, 21 + y, "mouth")
    return c


def mirror(im: Image.Image) -> Image.Image:
    return im.transpose(Image.FLIP_LEFT_RIGHT)


def main() -> None:
    rows = [
        [draw_down(f).render() for f in range(5)],
        [draw_up(f).render() for f in range(5)],
        [mirror(draw_right(f).render()) for f in range(5)],
        [draw_right(f).render() for f in range(5)],
    ]
    sheet = Image.new("RGBA", (W * 5, H * 4))
    for r, row in enumerate(rows):
        for f, im in enumerate(row):
            sheet.alpha_composite(im, (f * W, r * H))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    big = sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST)
    back = Image.new("RGBA", big.size, (40, 38, 44, 255))
    back.alpha_composite(big)
    back.save(PREVIEW)
    print(f"{OUT.relative_to(ROOT)}: 4x5 frames of {W}x{H}")


if __name__ == "__main__":
    main()
