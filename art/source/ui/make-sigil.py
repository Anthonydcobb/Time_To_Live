import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB").crop((972, 180, 1246, 520))
w, h = im.size
px = im.load()
res = Image.new("RGBA", (w, h))
o = res.load()
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        # phosphor line art: green well above red and blue; the dark screen behind it goes clear
        a = max(0, min(255, int((g - max(r, b) * 0.55 - 38) * 3.2)))
        o[x, y] = (0xA8, 0xF0, 0xB8, a)
res = res.resize((w * 2 // 2, h * 2 // 2), Image.LANCZOS)
res.save(out)
bg = Image.new("RGBA", res.size, (0x06, 0x10, 0x0A, 255)); bg.alpha_composite(res); bg.save(out.replace(".png", "-preview.png"))
print(res.size)
