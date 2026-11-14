# لوحة 2×2 لأول شاشة في أربعة مقاسات (للمراجعة بالعين). python3 quad.py OUT A B C D
import sys
from PIL import Image, ImageDraw
out, files = sys.argv[1], sys.argv[2:]
W = 960
tiles = []
for f in files:
    im = Image.open(f).convert('RGB'); k = W / im.width
    tiles.append(im.resize((W, round(im.height * k)), Image.LANCZOS))
H = max(t.height for t in tiles)
canvas = Image.new('RGB', (W * 2 + 8, H * 2 + 8), (255, 255, 255))
for i, t in enumerate(tiles):
    canvas.paste(t, ((i % 2) * (W + 8), (i // 2) * (H + 8)))
canvas.save(out, quality=80)
