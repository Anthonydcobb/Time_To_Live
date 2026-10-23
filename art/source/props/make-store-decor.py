"""Corner store set dressing on one sheet: 32x80 cells, each sprite bottom-centred.

 0 aisle shelf 16x80      1 wall shelf (left wall) 16x80   2 wall shelf (right wall) 16x48
 3 desk with PC1 16x48    4 office chair 16x24             5 file cabinets 16x48
 6 boxes 16x24            7 tall box stack 16x48           8 storage tote 16x24
 9 baskets 16x16         10 baskets, two stacks 32x16     11 broom 16x24
12 trash bins 16x48   13-14 more aisle shelves with different stock   15 front door 32x16
"""
import random
import sys
from PIL import Image

P = {
    "K": (0x16, 0x15, 0x13),
    # shelf metal
    "M": (0x6A, 0x6C, 0x62), "m": (0x4C, 0x4E, 0x46), "n": (0x82, 0x84, 0x78),
    # wood
    "W": (0x5E, 0x3E, 0x2A), "w": (0x4A, 0x30, 0x1F), "h": (0x70, 0x4C, 0x34), "F": (0x40, 0x28, 0x1A),
    # stock colours
    "r": (0xA8, 0x34, 0x3A), "y": (0xC8, 0xA8, 0x48), "b": (0x3E, 0x5E, 0x9A), "g": (0x4A, 0x7A, 0x44),
    "o": (0xC0, 0x6A, 0x32), "p": (0x6E, 0x4A, 0x8A), "c": (0xD8, 0xD0, 0xB8), "e": (0x8A, 0x6A, 0x4A),
    "j": (0x9A, 0xA8, 0x90), "J": (0x2A, 0x2A, 0x26),
    # cardboard
    "A": (0x9A, 0x7A, 0x52), "a": (0x7A, 0x5E, 0x3E), "t": (0xB4, 0xA8, 0x8A),
    # cabinet green
    "G": (0x5A, 0x66, 0x52), "q": (0x46, 0x50, 0x40), "Q": (0x6C, 0x78, 0x62), "H": (0xA8, 0xA8, 0x98),
    # chair purple
    "V": (0x5E, 0x2E, 0x4A), "v": (0x44, 0x20, 0x36), "X": (0x30, 0x30, 0x30),
    # CRT
    "C": (0xC2, 0xB4, 0x7A), "Y": (0x9A, 0x8E, 0x5E), "Z": (0x10, 0x14, 0x0F), "E": (0x4A, 0xD0, 0x6A),
    # plastic, baskets, broom, bins
    "S": (0x6E, 0x72, 0x74), "s": (0x52, 0x56, 0x58), "B": (0x9A, 0x2E, 0x2E), "R": (0x70, 0x20, 0x22),
    "T": (0xB0, 0x8A, 0x4A), "U": (0x7A, 0x7E, 0x7A), "u": (0x5A, 0x5E, 0x5A), "i": (0x3A, 0x3E, 0x3A),
    "P": (0xD8, 0xD4, 0xC4), "l": (0x9A, 0x96, 0x8A),
}

class Art:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.g = [["."] * w for _ in range(h)]

    def fill(self, x0, y0, x1, y1, c):
        for y in range(max(0, y0), min(self.h, y1 + 1)):
            for x in range(max(0, x0), min(self.w, x1 + 1)):
                self.g[y][x] = c

    def box(self, x0, y0, x1, y1, c, outline="K"):
        self.fill(x0, y0, x1, y1, outline)
        self.fill(x0 + 1, y0 + 1, x1 - 1, y1 - 1, c)

    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.g[y][x] = c

    def stamp(self, x0, y0, art):
        for dy, row in enumerate(art.strip("\n").split("\n")):
            for dx, ch in enumerate(row.strip()):
                if ch != ".":
                    self.px(x0 + dx, y0 + dy, ch)

    def image(self):
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        for y, row in enumerate(self.g):
            for x, ch in enumerate(row):
                if ch != ".":
                    img.putpixel((x, y), P[ch] + (255,))
        return img

STOCK = "rybgopce"

def stock_lane(a, x0, x1, y0, y1, rnd):
    """Rows of goods seen from above: cans (2x2 with a rim) and boxes (3x2)."""
    y = y0
    colour = rnd.choice(STOCK)
    while y + 1 <= y1:
        x = x0
        if (y - y0) % 9 == 0:  # same product for three rows, like a real facing
            colour = rnd.choice(STOCK)
        while x + 1 <= x1:
            a.px(x, y, colour)
            a.px(x + 1, y, colour)
            a.px(x, y + 1, colour)
            a.px(x + 1, y + 1, "K" if colour in "c" else colour)
            a.px(x, y, "t" if colour not in "ct" else "l")  # can top glint
            x += 3
        y += 3

def end_cap(a, x0, x1, y0, y1, rnd):
    """The short end of a shelf facing the room: frame, two shelves of goods, price strip."""
    a.box(x0, y0, x1, y1, "M")
    for sy in (y0 + 6, y0 + 12):
        a.fill(x0 + 1, sy, x1 - 1, sy, "n")
        a.fill(x0 + 1, sy + 1, x1 - 1, sy + 1, "m")
        x = x0 + 2
        while x + 1 <= x1 - 2:
            c = rnd.choice(STOCK)
            a.fill(x, sy - 4, x + 1, sy - 1, c)
            a.px(x, sy - 4, "c" if c != "c" else "t")
            x += 3
    a.fill(x0 + 1, y1 - 1, x1 - 1, y1 - 1, "m")

def aisle_shelf(seed=1):
    rnd = random.Random(seed)
    a = Art(16, 80)
    a.box(0, 0, 15, 63, "m")           # top, seen from above
    a.fill(7, 1, 8, 62, "M")           # spine
    a.fill(1, 1, 1, 62, "n")
    a.fill(14, 1, 14, 62, "n")
    stock_lane(a, 2, 6, 2, 61, rnd)
    stock_lane(a, 9, 13, 3, 61, rnd)
    end_cap(a, 0, 15, 62, 79, rnd)
    return a

def wall_shelf(length, right=False, seed=2):
    rnd = random.Random(seed)
    top = length * 16
    a = Art(16, top + 16)
    a.box(0, 0, 15, top - 1, "m")
    a.fill(1, 1, 3, top - 2, "W")      # back panel against the wall
    a.fill(3, 1, 3, top - 2, "w")
    a.fill(14, 1, 14, top - 2, "n")
    stock_lane(a, 5, 13, 2, top - 3, rnd)
    for y in range(4, top - 2, 9):     # a weird jar now and then
        a.stamp(5 + (y % 3) * 3, y, "JJ\njj\njj")
    end_cap(a, 0, 15, top - 2, top + 15, rnd)
    if right:
        a.g = [row[::-1] for row in a.g]
    return a

def desk():
    a = Art(16, 48)
    a.box(0, 16, 15, 47, "W")
    a.fill(1, 17, 14, 17, "h")
    for y in range(20, 40, 6):
        a.px(4, y, "w"); a.px(10, y + 2, "w")
    a.fill(1, 40, 14, 46, "F")
    a.fill(1, 40, 14, 40, "w")
    a.stamp(4, 42, "KKKKKKKK\nKwwwwwwK\nKKKKKKKK")  # drawer
    # CRT on the desk, screen facing the chair side (left) but shown front-on
    a.stamp(1, 2, """
    .KKKKKKKKKKKK.
    KCCCCCCCCCCCYK
    KCKKKKKKKKKKYK
    KCKZZZZZZZZKYK
    KCKZEEZZZZZKYK
    KCKZZZZZZZZKYK
    KCKZEEEZZZZKYK
    KCKKKKKKKKKKYK
    KCCCCCCCCCCCYK
    KYYYYYYYYYYYKK
    ..KCCCCCCCCK..
    .KCCCCCCCCCCK.
    .KYYYYYYYYYYK.
    .KKKKKKKKKKKK.
    """)
    # papers and a desk calendar
    a.stamp(2, 30, "PPPPP\nPlllP\nPPPPP\nPllPP")
    a.stamp(9, 29, "KKKKK\nKrrrK\nKPPPK\nKPlPK\nKKKKK")
    return a

def chair():
    a = Art(16, 24)
    a.stamp(2, 0, """
    ..KKKKKKKK..
    .KVVVVVVVVK.
    .KVvvvvvvVK.
    .KVvvvvvvVK.
    .KVVVVVVVVK.
    ..KKKKKKKK..
    ....KXXK....
    .KKKKKKKKKK.
    KVVVVVVVVVVK
    KVvvvvvvvvVK
    KVVVVVVVVVVK
    .KKKKKKKKKK.
    .....KK.....
    .....XX.....
    ...KXXXXK...
    ..KX.XX.XK..
    ..K..XX..K..
    .KXK.KK.KXK.
    .KK......KK.
    """)
    return a

def files():
    a = Art(16, 48)
    a.box(1, 0, 14, 31, "G")           # two cabinet tops, front to back
    a.fill(2, 1, 13, 1, "Q")
    a.fill(2, 15, 13, 15, "q")
    a.fill(2, 16, 13, 16, "K")
    a.fill(2, 17, 13, 17, "Q")
    a.box(1, 30, 14, 47, "G")          # the front cabinet's drawers
    for y in (32, 37, 42):
        a.box(3, y, 12, y + 4, "q")
        a.stamp(6, y + 1, "KHHK\n.KK.")
    a.px(2, 45, "a"); a.px(13, 35, "a")
    return a

def cardboard(a, x0, y0, x1, y1, top_h=4):
    a.box(x0, y0, x1, y1, "A")
    a.fill(x0 + 1, y0 + 1, x1 - 1, y0 + top_h, "t")
    mid = (x0 + x1) // 2
    a.fill(mid, y0 + 1, mid, y0 + top_h, "a")   # tape
    a.fill(x0 + 1, y0 + top_h + 1, x1 - 1, y0 + top_h + 1, "a")

def boxes_small():
    a = Art(16, 24)
    cardboard(a, 0, 10, 15, 23)
    cardboard(a, 3, 0, 13, 11)
    a.stamp(3, 18, "lll")
    return a

def boxes_tall():
    a = Art(16, 48)
    cardboard(a, 0, 30, 15, 47)
    cardboard(a, 1, 16, 14, 31)
    cardboard(a, 2, 2, 13, 17)
    a.stamp(4, 40, "llll")
    a.stamp(5, 25, "lll")
    return a

def storage():
    a = Art(16, 24)
    a.box(0, 6, 15, 23, "S")
    a.box(0, 4, 15, 9, "U")
    a.fill(1, 5, 14, 5, "S")
    a.fill(1, 12, 14, 12, "s")
    a.fill(1, 18, 14, 18, "s")
    a.stamp(5, 14, "PPPPPP\nPllllP\nPPPPPP")
    return a

def basket_stack(a, x0, colour="B", dark="R"):
    for i, y in enumerate((8, 4, 0)):
        a.box(x0, y + 2, x0 + 13, y + 7, colour)
        for x in range(x0 + 2, x0 + 12, 2):
            a.px(x, y + 4, dark); a.px(x, y + 5, dark)
    a.fill(x0 + 3, 0, x0 + 10, 0, "K")  # handle
    a.px(x0 + 3, 1, "K"); a.px(x0 + 10, 1, "K")

def baskets():
    a = Art(16, 16)
    basket_stack(a, 1)
    return a

def baskets_wide():
    a = Art(32, 16)
    basket_stack(a, 1)
    basket_stack(a, 17, "U", "i")
    return a

def broom():
    a = Art(16, 24)
    for i in range(14):                # handle leaning on the wall
        a.px(10 - i // 4, i, "T")
    a.px(11, 0, "K")
    a.stamp(3, 14, """
    .KKKKK.
    KTTTTTK
    KTeTeTK
    KeTeTeK
    KTeTeTK
    KeeeeeK
    eKeKeKe
    """)
    return a

def bins():
    a = Art(16, 48)
    for y0 in (0, 22):
        a.stamp(1, y0, """
        ..KKKKKKKKK...
        .KUUUUUUUUUK..
        KUuuuuuuuuuUK.
        KUUUUUUUUUUUK.
        .KKKKKKKKKKK..
        .KUUiUUiUUUK..
        .KUUiUUiUUUK..
        .KuUiUUiUUuK..
        .KuUiUUiUUuK..
        .KuUiUUiUUuK..
        .KuuiuuiuuuK..
        .KuuiuuiuuuK..
        .KuuiuuiuuuK..
        .KuuiuuiuuuK..
        .KuuuuuuuuuK..
        .KuuiuuiuuuK..
        .KuuuuuuuuuK..
        .KuuuuuuuuuK..
        .KuuuuuuuuuK..
        .KuuuuuuuuuK..
        ..KKKKKKKKK...
        """)
    a.stamp(3, 1, "PP.\n.Pl")  # something sticking out
    return a

def store_door():
    """Quik-Stop's glass double door in the front wall, seen from inside: OPEN sign, hours sticker."""
    a = Art(32, 16)
    a.box(0, 0, 31, 15, "u")
    for x0 in (2, 16):
        a.box(x0, 1, x0 + 13, 14, "S")
        a.fill(x0 + 1, 2, x0 + 12, 13, "s")
        a.fill(x0 + 2, 3, x0 + 4, 3, "P")      # glare
        a.fill(x0 + 1, 8, x0 + 12, 8, "U")     # push bar
    a.fill(15, 1, 16, 14, "K")
    a.stamp(4, 4, "KKKKKKK\nKrrrrrK\nKrPrPrK\nKrrrrrK\nKKKKKKK")  # red OPEN sign
    a.stamp(19, 10, "PPPP\nPllP")                                   # store hours
    return a


FRAMES = [aisle_shelf(), wall_shelf(4), wall_shelf(2, right=True, seed=5), desk(), chair(), files(),
          boxes_small(), boxes_tall(), storage(), baskets(), baskets_wide(), broom(), bins(),
          aisle_shelf(3), aisle_shelf(4), store_door()]

def sheet():
    cols, cw, ch = 8, 32, 80
    rows = (len(FRAMES) + cols - 1) // cols
    img = Image.new("RGBA", (cols * cw, rows * ch), (0, 0, 0, 0))
    for i, art in enumerate(FRAMES):
        im = art.image()
        cx, cy = (i % cols) * cw, (i // cols) * ch
        img.paste(im, (cx + (cw - im.width) // 2, cy + ch - im.height), im)
    return img

if __name__ == "__main__":
    out = sys.argv[1]
    img = sheet()
    img.save(out)
    bg = Image.new("RGBA", img.size, (0x8A, 0x9A, 0x8A, 255))
    bg.alpha_composite(img)
    bg.resize((img.width * 4, img.height * 4), Image.NEAREST).save(out.replace(".png", "-x4.png"))
