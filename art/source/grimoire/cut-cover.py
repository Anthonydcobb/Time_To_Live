"""
Cuts the grimoire's close-ups from agy's cover concept (art/concepts/grimoire/grimoire-cover-concept.jpg):
the book as you find it, its eyes dark, and the same book for the moment they're all open.

Run from the repo root: python art/source/grimoire/cut-cover.py
Writes public/assets/cards/grimoire-asleep.webp and grimoire-awake.webp.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = Path("art/concepts/grimoire/grimoire-cover-concept.jpg")
OUT = Path("public/assets/cards")
# Inside the concept's ornate frame, clear of the checkerboard and the name plaque.
CROP = (172, 84, 1034, 772)
# The top face of the cover in the concept, where the eyes and the glowing lines are.
COVER = [(370, 95), (1010, 185), (880, 610), (300, 540), (230, 400)]
HEIGHT = 900


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im).astype(np.float32) / 255

    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).polygon(COVER, fill=255)
    mask = np.asarray(mask.filter(ImageFilter.GaussianBlur(18))).astype(np.float32) / 255

    lum = a @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    # The bright bits on the cover: eyeballs and the lines that glow.
    lit = np.clip((lum - 0.32) / 0.3, 0, 1)[..., None] * mask[..., None]

    # Asleep: everything bright on the cover sinks to the leather, and the room is a little darker.
    leather = np.array([0.16, 0.14, 0.13], dtype=np.float32)
    asleep = a * (1 - lit * 0.88) + leather * lit * 0.88 * 0.6
    asleep *= 0.82

    # Awake: the same bright bits, pushed toward a sick green and up.
    green = np.array([0.62, 1.0, 0.72], dtype=np.float32)
    awake = a * (1 - lit * 0.5) + np.minimum(1, a * 1.5) * green * lit * 0.5 * 1.35
    glow = Image.fromarray((np.clip(lit[..., 0], 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))
    awake += (np.asarray(glow).astype(np.float32) / 255)[..., None] * green * 0.35
    awake = awake * 0.92

    OUT.mkdir(parents=True, exist_ok=True)
    for name, arr in (("asleep", asleep), ("awake", awake)):
        out = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).crop(CROP)
        out = out.resize((round(out.width * HEIGHT / out.height), HEIGHT), Image.LANCZOS)
        out.save(OUT / f"grimoire-{name}.webp", quality=88)
        print(OUT / f"grimoire-{name}.webp", out.size)


if __name__ == "__main__":
    main()
