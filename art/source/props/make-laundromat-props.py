"""Spin Cycle Eternal's props on one sheet: 48x64 cells, each sprite bottom-centred.
Drawn from agy's `art/concepts/items/laundromat-sprites-concept.jpg`.

 0 two dryer stacks 32x32       1 one dryer stack 16x32        2 dryer 4 16x32
 3 washer island, 2x3 32x56     4 washer island, 3x2 48x40     5 folding table with lost & found 16x56
 6 detergent vending 16x32      7 change machine 16x32         8 change kiosk PC 16x32
 9 Gus's service window 16x32  10 booth radio 16x16           11 stool 16x16
12 bench 48x24                 13 printer on a stand 16x24    14 logbook on a lectern 16x24
15 back door 16x16             16 front door 32x16

    python art/source/props/make-laundromat-props.py public/assets/sprites/props/laundromat-props.png
"""
import sys
from PIL import Image

P = {
    "K": (0x16, 0x15, 0x13),
    # yellowed enamel
    "E": (0xB0, 0xAC, 0x9A), "e": (0x8E, 0x8A, 0x7A), "d": (0x6A, 0x66, 0x5A),
    # steel rings, porthole glass
    "S": (0x8A, 0x90, 0x92), "s": (0x5A, 0x60, 0x62),
    "g": (0x1E, 0x26, 0x28), "G": (0x34, 0x44, 0x46), "h": (0x9A, 0xB4, 0xB0),
    # control strips and lights
    "c": (0x3A, 0x3E, 0x3C), "r": (0xC0, 0x40, 0x30), "y": (0xD0, 0xA0, 0x40), "n": (0x5A, 0xD0, 0x7A),
    # wood
    "W": (0x5E, 0x3E, 0x2A), "w": (0x4A, 0x30, 0x1F), "F": (0x40, 0x28, 0x1A), "O": (0x70, 0x4C, 0x34),
    # folding table laminate
    "L": (0x9A, 0x92, 0x7E), "l": (0x7A, 0x72, 0x60),
    # laundry
    "p": (0xA8, 0x6A, 0x7A), "b": (0x4E, 0x6A, 0x9A), "t": (0xB4, 0xA8, 0x8A), "R": (0x9A, 0x3A, 0x3A),
    # cardboard
    "A": (0x9A, 0x7A, 0x52), "a": (0x7A, 0x5E, 0x3E),
    # dark metal
    "M": (0x4C, 0x4E, 0x46), "m": (0x3A, 0x3C, 0x36), "N": (0x6A, 0x6C, 0x62),
    # paper
    "P": (0xD8, 0xD4, 0xC4), "Q": (0x9A, 0x96, 0x8A),
    # CRT
    "C": (0xC2, 0xB4, 0x7A), "Y": (0x9A, 0x8E, 0x5E), "Z": (0x10, 0x14, 0x0F), "V": (0x4A, 0xD0, 0x6A),
    # orange plastic seats, stool vinyl
    "o": (0xB0, 0x6A, 0x32), "u": (0x8A, 0x4E, 0x22), "U": (0x6A, 0x2E, 0x2E),
    # tinted booth glass
    "j": (0x4A, 0x5E, 0x60), "J": (0x7A, 0x92, 0x92),
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

    def stamp(self, x0, y0, art, swap=None):
        for dy, row in enumerate(art.strip("\n").split("\n")):
            for dx, ch in enumerate(row.strip()):
                if ch != ".":
                    self.px(x0 + dx, y0 + dy, (swap or {}).get(ch, ch))

    def image(self):
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        for y, row in enumerate(self.g):
            for x, ch in enumerate(row):
                if ch != ".":
                    img.putpixel((x, y), P[ch] + (255,))
        return img


# A 10x10 porthole: `*` is the glass.
PORTHOLE = """
..SSSSSS..
.S******S.
S*h*****sS
S*h******S
S********S
S********S
S*******sS
Ss******sS
.Ss****sS.
..SSSSSS..
"""


def dryer_unit(a, x0, y0, glass="g", inside=""):
    """One front-loading dryer, 16x15: control strip, porthole, a glimpse of what's tumbling."""
    a.fill(x0 + 1, y0, x0 + 14, y0 + 2, "c")
    a.px(x0 + 3, y0 + 1, "n")
    a.px(x0 + 5, y0 + 1, "y")
    a.fill(x0 + 10, y0 + 1, x0 + 12, y0 + 1, "S")   # coin slot
    a.stamp(x0 + 3, y0 + 4, PORTHOLE, {"*": glass})
    for i, c in enumerate(inside):                   # clothes heaped in the bottom of the drum
        a.px(x0 + 6 + i, y0 + 11 - (i % 2), c)


def dryer_stack(a, x0, haunted=False):
    """Two dryers stacked, as laundromats do. Dryer 4 is the bottom one of its stack."""
    a.box(x0, 0, x0 + 15, 31, "E")
    a.fill(x0 + 14, 1, x0 + 14, 30, "d")
    a.fill(x0 + 1, 15, x0 + 14, 15, "K")
    a.fill(x0 + 1, 16, x0 + 14, 16, "e")
    dryer_unit(a, x0, 1, inside="pbt")
    if haunted:
        # Dead black glass with something just darker standing in it, and an OUT OF ORDER note.
        dryer_unit(a, x0, 16, glass="K")
        a.stamp(x0 + 7, 22, "g.\ngg\ngg\ng.", {})
        a.stamp(x0 + 2, 18, "PPP\nQrQ")
    else:
        dryer_unit(a, x0, 16, inside="bRt")


def dryers_pair():
    a = Art(32, 32)
    dryer_stack(a, 0)
    dryer_stack(a, 16)
    return a


def dryer_single():
    a = Art(16, 32)
    dryer_stack(a, 0)
    return a


def dryer_four():
    a = Art(16, 32)
    dryer_stack(a, 0, haunted=True)
    return a


# A top-loader seen from above: lid with a hinge line, a dial on the backsplash.
WASHER_TOP = """
KKKKKKKKKKKKKKKK
KccccccccccccccK
KcnccSScccyyccK.
KKKKKKKKKKKKKKKK
KEEEEEEEEEEEEEdK
KEeeeeeeeeeeeEdK
KEeSSSSSSSSSeEdK
KEeSeeeeeeeSeEdK
KEeSeeeeeeeSeEdK
KEeSeeeeeeeSeEdK
KEeSeeeeeeeSeEdK
KEeSSSSSSSSSeEdK
KEeeeeeeeeeeeEdK
KEEEEEEEEEEEEEdK
KdddddddddddddKK
KKKKKKKKKKKKKKKK
"""


def washers(cols, rows):
    """An island of top-loaders, seen from above, with the front of the last row showing."""
    a = Art(cols * 16, rows * 16 + 8)
    for r in range(rows):
        for c in range(cols):
            a.stamp(c * 16, r * 16, WASHER_TOP)
    y = rows * 16
    a.box(0, y - 1, cols * 16 - 1, y + 7, "e")
    for c in range(cols):
        a.fill(c * 16 + 2, y + 2, c * 16 + 13, y + 2, "d")
        a.fill(c * 16 + 6, y + 4, c * 16 + 9, y + 5, "S")   # coin box
        a.px(c * 16 + 7, y + 4, "K")
    return a


def folding_table():
    """The long folding table along the wall, the lost & found box at its far end."""
    a = Art(16, 56)
    a.box(0, 0, 15, 47, "L")
    a.fill(1, 46, 14, 46, "l")
    a.fill(14, 1, 14, 45, "l")
    # lost & found: an open carton with sleeves hanging out
    a.box(1, 1, 13, 13, "A")
    a.fill(2, 2, 12, 4, "a")
    a.stamp(3, 3, "pp.bbb\npppbbt.\n.ttt.R", {})
    a.px(13, 6, "b")
    a.px(14, 7, "b")
    # folded stacks somebody never came back for
    a.stamp(3, 20, "KKKKKKKK\nKbbbbbbK\nKbBbbbbK\nKttttttK\nKttttttK\nKKKKKKKK", {"B": "b"})
    a.stamp(4, 32, "KKKKKKK\nKppppKK\nKpppppK\nKKKKKKK")
    a.px(10, 40, "R")
    a.px(11, 40, "R")
    # apron and legs
    a.box(0, 47, 15, 51, "l")
    a.fill(1, 52, 2, 55, "M")
    a.fill(13, 52, 14, 55, "M")
    return a


def detergent():
    """Detergent vending: a dark machine with a glass front of little coloured boxes."""
    a = Art(16, 32)
    a.box(0, 0, 15, 31, "c")
    a.fill(1, 1, 14, 2, "M")
    a.box(1, 3, 12, 20, "j")
    for i, y in enumerate((5, 9, 13, 17)):
        for x in range(3, 11, 3):
            col = "RbynRbyo"[(x // 3 + i) % 8]
            a.fill(x, y, x + 1, y + 2, col)
            a.px(x, y, "P")
    a.fill(14, 4, 14, 20, "m")
    for y in (5, 9, 13, 17):                          # selection buttons
        a.px(13, y, "S")
    a.fill(3, 23, 12, 26, "K")                        # pickup tray
    a.fill(4, 24, 11, 25, "m")
    a.px(13, 23, "y")
    a.fill(1, 29, 14, 30, "m")
    return a


def change_machine():
    """The change machine: red header, bill slot, a dim readout, the coin cup."""
    a = Art(16, 32)
    a.box(0, 0, 15, 31, "N")
    a.fill(1, 1, 14, 4, "R")
    a.stamp(3, 2, "P.P.PP.P", {})
    a.fill(14, 5, 14, 30, "M")
    a.box(3, 7, 12, 11, "Z")
    a.stamp(5, 9, "yy.y", {})
    a.fill(4, 14, 11, 14, "K")                        # bill slot
    a.fill(5, 15, 10, 15, "m")
    a.stamp(4, 17, "PPPP\nQQQQ")                      # $1 $5 sticker
    a.box(4, 23, 11, 28, "m")                         # coin cup
    a.fill(5, 26, 10, 27, "K")
    a.px(6, 27, "S")
    return a


CRT = """
.KKKKKKKKKKKK.
KCCCCCCCCCCCYK
KCKKKKKKKKKKYK
KCKZZZZZZZZKYK
KCKZVVZZZZZKYK
KCKZZZZZZZZKYK
KCKZVVVZZZZKYK
KCKKKKKKKKKKYK
KCCCCCCCCCCCYK
KYYYYYYYYYYYKK
"""


def kiosk():
    """The change kiosk PC: a beige CRT on a wooden pedestal with a keyboard shelf."""
    a = Art(16, 32)
    a.stamp(1, 0, CRT)
    a.box(3, 10, 12, 31, "W")
    a.fill(11, 11, 11, 30, "w")
    a.box(1, 12, 14, 15, "Q")                         # keyboard
    a.stamp(3, 13, "K.K.K.K.K.")
    a.box(5, 19, 10, 23, "w")                         # coin slot plate
    a.fill(7, 21, 8, 21, "K")
    a.fill(4, 28, 11, 30, "F")
    return a


def service_window():
    """Gus's window: a counter ledge under a pane of yellowed glass with a gap to pass money."""
    a = Art(16, 32)
    a.box(0, 0, 15, 15, "N")
    a.fill(1, 1, 14, 11, "j")
    a.fill(2, 2, 3, 6, "J")                           # glare
    a.px(4, 2, "J")
    a.stamp(8, 3, "PPPPP\nPQQQP\nPPPPP")              # PLEASE RING sign taped on
    a.fill(4, 12, 11, 14, "K")                        # the gap
    a.box(0, 14, 15, 18, "O")                         # ledge
    a.fill(1, 15, 14, 15, "W")
    a.px(12, 16, "S")                                 # the bell
    a.px(13, 16, "S")
    a.box(1, 18, 14, 31, "W")
    a.fill(13, 19, 13, 30, "w")
    for y in (22, 27):
        a.fill(2, y, 12, y, "w")
    return a


def radio():
    """Gus's radio on a shelf bracket, the dial lit."""
    a = Art(16, 16)
    a.fill(10, 0, 10, 4, "S")                         # antenna
    a.box(1, 4, 14, 12, "c")
    a.fill(2, 5, 7, 11, "M")
    for y in (6, 8, 10):
        a.fill(2, y, 7, y, "m")
    a.box(9, 6, 13, 8, "y")
    a.px(11, 7, "r")
    a.px(10, 10, "S")
    a.px(12, 10, "S")
    a.fill(0, 13, 15, 14, "W")
    a.fill(0, 15, 15, 15, "w")
    return a


def stool():
    a = Art(16, 16)
    a.stamp(3, 0, """
    ..KKKKKK..
    .KUUUUUUK.
    KUUpUUUUUK
    KUUUUUUUUK
    .KUUUUUUK.
    ..KKKKKK..
    ....KK....
    ....MM....
    ....MM....
    ..KMMMMK..
    .KM.MM.MK.
    .K..MM..K.
    KMK.KK.KMK
    KK......KK
    """, {"p": "R"})
    return a


def bench():
    """Three moulded orange seats on a steel rail, the kind bolted to the floor."""
    a = Art(48, 24)
    for i in range(3):
        x = i * 16
        a.box(x + 1, 0, x + 14, 8, "o")              # seat back
        a.fill(x + 2, 1, x + 13, 1, "P")
        a.fill(x + 2, 1, x + 13, 1, "o")
        a.fill(x + 13, 1, x + 13, 7, "u")
        a.box(x + 1, 9, x + 14, 15, "u")             # seat pan
        a.fill(x + 2, 10, x + 13, 13, "o")
    a.px(20, 11, "Q")                                # someone's receipt
    a.px(21, 11, "P")
    a.fill(0, 16, 47, 17, "M")                       # rail
    for x in (2, 23, 44):
        a.fill(x, 18, x + 1, 23, "m")
    return a


def printer():
    """The networked printer on a little metal stand, a page half out."""
    a = Art(16, 24)
    a.box(1, 2, 14, 11, "Q")
    a.fill(2, 3, 13, 4, "P")
    a.fill(4, 0, 11, 2, "P")                         # page coming out
    a.px(6, 1, "Q")
    a.px(8, 1, "Q")
    a.fill(3, 7, 12, 8, "K")                         # output slot
    a.px(12, 5, "n")
    a.box(2, 11, 13, 23, "M")
    a.fill(3, 15, 12, 15, "m")
    a.fill(3, 19, 12, 19, "m")
    a.box(4, 16, 11, 18, "P")                        # a ream on the shelf
    return a


def lectern():
    """The shift logbook, open on a slanted wooden stand, a red ribbon hanging out."""
    a = Art(16, 24)
    a.box(0, 0, 15, 9, "O")
    a.box(1, 1, 7, 8, "P")
    a.box(8, 1, 14, 8, "P")
    for y in (3, 5, 7):
        a.fill(2, y, 6, y, "Q")
        a.fill(9, y, 13, y, "Q")
    a.fill(7, 1, 8, 8, "K")
    a.fill(8, 8, 8, 12, "R")                         # ribbon
    a.box(3, 9, 12, 23, "W")
    a.fill(11, 10, 11, 22, "w")
    a.fill(1, 21, 14, 23, "F")
    return a


def back_door():
    """EMPLOYEES ONLY: a scuffed wooden door with a steel kick plate and a dead bolt."""
    a = Art(16, 16)
    a.box(0, 0, 15, 15, "m")
    a.box(1, 0, 14, 15, "W")
    a.fill(13, 1, 13, 14, "w")
    a.stamp(3, 2, "PPPPPPPP\nPRRRRRRP\nPPPPPPPP")   # sign
    a.px(11, 8, "y")                                 # knob
    a.px(11, 6, "S")                                 # dead bolt
    a.fill(2, 12, 13, 14, "N")                       # kick plate
    a.px(5, 13, "s")
    return a


def front_door():
    """Spin Cycle's glass double door: steel frame, OPEN 24 HRS in red neon, the shop's decal, a
    crack in one pane that somebody taped over."""
    a = Art(32, 16)
    a.box(0, 0, 31, 15, "M")
    for x0 in (2, 16):
        a.box(x0, 1, x0 + 13, 14, "N")
        a.fill(x0 + 1, 2, x0 + 12, 13, "j")
        a.fill(x0 + 2, 3, x0 + 2, 6, "J")             # glare
        a.fill(x0 + 1, 9, x0 + 12, 9, "S")            # push bar
    a.fill(15, 1, 16, 14, "K")
    a.stamp(4, 3, """
    rrrrrrr
    r.r.r.r
    rrrrrrr
    """)                                             # OPEN 24 HRS neon
    a.stamp(5, 6, "yy.yy")
    a.stamp(19, 3, """
    PPPPPPPP
    PbbbbbbP
    PPPPPPPP
    """)                                             # SPIN CYCLE decal
    a.stamp(22, 9, """
    K...
    .K.K
    ..K.
    """)                                             # the crack
    a.fill(21, 10, 26, 10, "t")                      # tape across it
    return a


FRAMES = [dryers_pair(), dryer_single(), dryer_four(), washers(2, 3), washers(3, 2), folding_table(),
          detergent(), change_machine(), kiosk(), service_window(), radio(), stool(), bench(), printer(),
          lectern(), back_door(), front_door()]


def sheet():
    cols, cw, ch = 8, 48, 64
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
