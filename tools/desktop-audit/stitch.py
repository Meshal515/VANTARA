# يخيط لقطات تمرير ورقة داخلية: أول لقطة كاملة للنافذة، ثم من كل لقطة لاحقة الجزء الجديد فقط (أسفلها بمقدار التمرير)
# الاستعمال: python3 stitch.py OUT JSON(box,deltas,dpr) FRAME0 FRAME1 ...
import json, sys
from PIL import Image

out, meta, frames = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3:]
box, deltas, dpr = meta['box'], meta['deltas'], meta['dpr']
first = Image.open(frames[0]).convert('RGB')
W = first.width
bx, by, bw, bh = (round(v * dpr) for v in (box['x'], box['y'], box['w'], box['h']))
extra = sum(round(d * dpr) for d in deltas)
canvas = Image.new('RGB', (W, first.height + extra), first.getpixel((2, max(0, by + bh - 2))))
canvas.paste(first, (0, 0))
# أسفل الورقة في اللقطة الأولى = by+bh؛ الجديد يُلصق ابتداءً منه، وما تحت الورقة (إن وجد) يُنقل للأسفل
below = first.crop((0, by + bh, W, first.height))
y = by + bh
for f, d in zip(frames[1:], deltas):
    img = Image.open(f).convert('RGB')
    n = round(d * dpr)
    part = img.crop((0, img.height - n, img.width, img.height))
    canvas.paste(part, (bx, y))
    y += n
canvas.paste(below, (0, y))
canvas.save(out)
