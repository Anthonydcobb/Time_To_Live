"""Cut an inspect card out of a concept: crop to the frame, then make the checkerboard
around the ornate corners transparent by flooding in from the edges.
usage: card.py <concept.jpg> <out.webp> left top right bottom (concept pixels)"""
import sys
from collections import deque
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
box = tuple(int(v) for v in sys.argv[3:7])
WIDTH = 260

img = Image.open(src).convert("RGB").crop(box)
w, h = img.size
px = img.load()

CHECKER = [(37, 38, 42), (65, 66, 71)]

def is_checker(c):
    # only the two flat checker greys (plus the slight blue tint), with room for JPEG noise
    return any(abs(c[0] - k[0]) < 9 and abs(c[1] - k[1]) < 9 and abs(c[2] - k[2]) < 9 for k in CHECKER)

alpha = Image.new("L", img.size, 255)
a = alpha.load()
seen = bytearray(w * h)
q = deque()
for x in range(w):
    q.extend([(x, 0), (x, h - 1)])
for y in range(h):
    q.extend([(0, y), (w - 1, y)])
while q:
    x, y = q.popleft()
    i = y * w + x
    if seen[i]:
        continue
    seen[i] = 1
    if not is_checker(px[x, y]):
        continue
    a[x, y] = 0
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
            q.append((nx, ny))

img.putalpha(alpha)
img = img.resize((WIDTH, round(h * WIDTH / w)), Image.LANCZOS)
img.save(out, "WEBP", quality=86, method=6)
bg = Image.new("RGBA", img.size, (0x34, 0x33, 0x2E, 255))
bg.alpha_composite(img)
bg.convert("RGB").resize((img.width // 2, img.height // 2)).save(out.rsplit(".", 1)[0] + "-preview.jpg", quality=85)
print(img.size)
