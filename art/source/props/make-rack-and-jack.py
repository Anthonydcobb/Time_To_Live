"""Back-office telecom rack (32x32) and the wall jack (16x16, normal + haunted)."""
import sys
from PIL import Image

P = {
    "K": (0x16, 0x17, 0x16),  # outline
    "M": (0x6A, 0x6E, 0x66),  # rack metal
    "m": (0x4A, 0x4E, 0x48),  # metal shadow
    "N": (0x2C, 0x2F, 0x2E),  # router / switch body
    "n": (0x3C, 0x40, 0x3E),  # body highlight
    "A": (0x22, 0x24, 0x23),  # antennas
    "E": (0x4A, 0xD0, 0x6A),  # green LED
    "e": (0xE0, 0xA0, 0x30),  # amber LED
    "p": (0x10, 0x11, 0x10),  # empty ports
    "V": (0x7A, 0x4A, 0xA8),  # purple cable
    "v": (0x56, 0x34, 0x7A),  # purple shadow
    "U": (0x4A, 0x7A, 0xC0),  # blue cable
    "L": (0x8A, 0xC8, 0xE0),  # light-blue console cable
    "g": (0x3E, 0x52, 0x34),  # moss
    "S": (0x50, 0x54, 0x4E),  # bottom shelf
    "J": (0xB8, 0xB0, 0x94),  # jack plate
    "Y": (0xC8, 0xA8, 0x48),  # contacts
    "j": (0x8E, 0x88, 0x70),  # plate shadow
    "d": (0x6A, 0x60, 0x4C),  # grime
    "R": (0x14, 0x10, 0x10),  # roots
    "r": (0x2A, 0x20, 0x22),  # root highlight
}

RACK = """
....A..........A................
....A..........A................
....A..........A................
..KKAKKKKKKKKKKAKKKKKKKKKKKKKK..
..KnnnnnnnnnnnnnnnnnnnnnnnnnnK..
.KMNNNNNNNNNNNNNNNNNNNNNNNNNNMK.
.KMNEeNENNNNNNNNNNNNNNNNNpNpNMK.
.KMNNNNNNNNNNNNNNNNNNNNNNNNNNMK.
.KMKKKKKKKKKKKKKKKKKKKKKKKKKKMK.
.KMm........................mMK.
.KMKKKKKKKKKKKKKKKKKKKKKKKKKKMK.
.KMnnnnnnnnnnnnnnnnnnnnnnnnnnMK.
.KMNEpEpEpEpEpEpEpEpEpEpNNeNNMK.
.KMNpVpUpVpppUpVpppVpUpVNNNNNMKL
.KMNNVNUNVNNNUNVNNNVNUNVNNNNNMKL
.KMKKVKUKVKKKUKVKKKVKUKVKKKKKMKL
.KMm.V.U.V...U.V...V.U.V....mMKL
.KMm.V.U.Vv..U.Vv..V.Uv.V...mMKL
.KMm.Vv.U.V..U..V..Vv.U.V...mMKL
.KMm..V.U..V..U.V...V..UV...mMKL
.KMm..VUU..VV.UUV...VVUU....mMKL
.KMm...UUVVV..UVV....UV.....mMKL
.KMm....U.....V.......V.....mMKL
.KMm........................mMKL
.KMKKKKKKKKKKKKKKKKKKKKKKKKKKMKL
.KMSSSSSSSSSSSSSSSSSSSSSSSSSSMKL
.KMSSgSSSSSSSSSSSSSSSSSSSgSSSMKL
.KMKKKKKKKKKKKKKKKKKKKKKKKKKKMK.
.KMmKNNNNNNNNNNNNNNNNNNNNNNKmMK.
.KMmKNeNNNNNNNNNNNNNNNNNNNNKmMK.
.KMMg......................gMMK.
.KKKK......................KKKK.
"""

# Two-port wall plate. Each port is an RJ45 opening: a dark mouth with gold contacts along the
# top and the latch slot cut into the bottom edge.
JACK = """
................
..KKKKKKKKKKKK..
..KJJJJJJJJJjK..
..KJKKKKKKKKjK..
..KJKYpYpYpKjK..
..KJKppppppKjK..
..KJKKKppKKKjK..
..KJJJKKKKJJjK..
..KJJJJdJJJJjK..
..KJKKKKKKKKjK..
..KJKYpYpYpKjK..
..KJKppppppKjK..
..KJKKKppKKKjK..
..KJJJKKKKJdjK..
..KjjjjjjjjjjK..
..KKKKKKKKKKKK..
"""

# Haunted: the phantom's blue cable is in the bottom port, and roots grow out around it.
JACK_HAUNTED = """
.......R........
.......Rr.......
..KKKKKRKKKKKK..
..KJJJJRJJJJjK..
..KJKKKRRKKKjK..
..KJKYpRpYRKjK..
..KJKppRppRKjK..
..RRKKKRRKKKjK..
..KJRRRRRJJJjK..
..KJKKKKRRRRRR..
..KJKUUUUUUKjK..
..KJKULLLLUKjK..
..RJKUUUUUUKjK..
..KRJJJUUJJdjK..
..KjjjjULjjjjK..
..KKKKKUUKKKKK..
"""
def paint(art, w, h):
    rows = art.strip("\n").split("\n")
    assert len(rows) == h, (len(rows), h)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        assert len(row) == w, (y, len(row), row)
        for x, ch in enumerate(row):
            if ch != ".":
                img.putpixel((x, y), P[ch] + (255,))
    return img

if __name__ == "__main__":
    w = sys.argv[1]
    rack = paint(RACK, 32, 32)
    rack.save(w + "/rack.png")
    jack = Image.new("RGBA", (32, 16), (0, 0, 0, 0))
    jack.paste(paint(JACK, 16, 16), (0, 0))
    jack.paste(paint(JACK_HAUNTED, 16, 16), (16, 0))
    jack.save(w + "/jack.png")
    for name, img in (("rack", rack), ("jack", jack)):
        bg = Image.new("RGBA", img.size, (0x8A, 0x9A, 0x8A, 255))
        bg.alpha_composite(img)
        bg.resize((img.width * 8, img.height * 8), Image.NEAREST).save(f"{w}/{name}-x8.png")
