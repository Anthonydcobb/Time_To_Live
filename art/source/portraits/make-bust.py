"""Cut a dialogue bust out of an illustrated concept and fade its edges to transparent.
usage: bust.py <concept.jpg> <out.webp> left top right bottom [soft] (box in concept pixels)"""
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

src, out = sys.argv[1], sys.argv[2]
box = tuple(int(v) for v in sys.argv[3:7])
SOFT = float(sys.argv[7]) if len(sys.argv) > 7 else 1.0  # bigger fades the edges further in
HEIGHT = 560  # 2x the size it's shown at, for sharp high-DPI screens

img = Image.open(src).convert("RGB").crop(box)
w = round(img.width * HEIGHT / img.height)
img = img.resize((w, HEIGHT), Image.LANCZOS)

# Soft oval fade, fully solid over her face and shoulders, gone at the edges.
mask = Image.new("L", img.size, 0)
d = ImageDraw.Draw(mask)
blur = HEIGHT * 0.045 * SOFT
pad = 2.2 * blur  # far enough in that the blurred edge reaches zero at the border
d.ellipse((pad, pad * 0.6, w - pad, HEIGHT * 1.5), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(blur))
# keep the bottom edge solid so she sits on the dialogue box
bottom = Image.new("L", img.size, 0)
ImageDraw.Draw(bottom).rectangle((w * 0.24, HEIGHT * 0.72, w * 0.76, HEIGHT), fill=255)
mask = ImageChops.lighter(mask, bottom.filter(ImageFilter.GaussianBlur(HEIGHT * 0.05)))

img.putalpha(mask)
img.save(out, "WEBP", quality=88, method=6)
bg = Image.new("RGBA", img.size, (0x34, 0x33, 0x2E, 255))
bg.alpha_composite(img)
bg.convert("RGB").save(out.rsplit(".", 1)[0] + "-preview.jpg", quality=85)
print(img.size)
