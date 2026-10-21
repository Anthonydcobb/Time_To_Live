"""Cuts the four stages of the static outsider out of its concept sheet.

The sheet's checkerboard is painted in, and the figures are drawn in the same dark greys, so
it can't be keyed out cleanly. Instead every flat dark grey goes to black (the checker and the
figure's shadows alike) and a soft oval fade takes the place of an outline. In the game each
stage is a darkness in the static with only its lighter parts showing, which is the point.

    python art/source/apparition/cut-being.py "art/concepts/characters/incomprehensible-being-concept.jpg"
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path("public/assets/apparition")
# Each panel's box on the 2752x1536 sheet, between the title and the captions.
PANELS = [(40, 115, 620, 1405), (625, 115, 1315, 1405), (1315, 115, 2030, 1405), (2030, 115, 2752, 1405)]
HEIGHT = 900


def cut(panel: Image.Image) -> Image.Image:
    a = np.asarray(panel).astype(np.int16)
    grey = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    # The checker's greys, the seams between them and the figure's own flat darks: all to black.
    flat = (sat <= 10) & (grey <= 60)
    out = np.where(flat[..., None], 8, a).astype(np.uint8)
    # A soft oval: solid in the middle, gone well before the edges.
    h, w = grey.shape
    y, x = np.mgrid[0:h, 0:w]
    r = np.sqrt(((x - w / 2) / (w * 0.5)) ** 2 + ((y - h / 2) / (h * 0.5)) ** 2)
    alpha = np.clip((1.0 - r) / 0.45, 0, 1) ** 1.5
    img = Image.fromarray(out, "RGB").convert("RGBA")
    img.putalpha(Image.fromarray((alpha * 255).astype(np.uint8)))
    return img


def main() -> None:
    sheet = Image.open(sys.argv[1]).convert("RGB")
    OUT.mkdir(parents=True, exist_ok=True)
    for i, box in enumerate(PANELS, 1):
        being = cut(sheet.crop(box))
        being = being.resize((round(being.width * HEIGHT / being.height), HEIGHT), Image.LANCZOS)
        being.save(OUT / f"being-{i}.webp", quality=88)
        print(OUT / f"being-{i}.webp", being.size)


if __name__ == "__main__":
    main()
