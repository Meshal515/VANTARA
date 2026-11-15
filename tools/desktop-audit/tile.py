# يقطّع لقطة صفحة كاملة إلى شرائح بارتفاع الشاشة (للمراجعة بالعين). python3 tile.py IN OUTPREFIX [W=1200]
import sys
from PIL import Image
src, pre = sys.argv[1], sys.argv[2]; W = int(sys.argv[3]) if len(sys.argv) > 3 else 1200
im = Image.open(src).convert('RGB'); k = W / im.width
im = im.resize((W, round(im.height * k)), Image.LANCZOS)
h = round(W * 768 / 1366); n = 0
for y in range(0, im.height, h):
    im.crop((0, y, W, min(im.height, y + h))).save(f'{pre}-{n}.jpg', quality=82); n += 1
print(pre, n)
