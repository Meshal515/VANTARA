# مراجعة الصفحة كاملة في أربعة مقاسات جنبًا إلى جنب، شريحة شريحة من الأعلى للأسفل.
# python3 strips.py OUTPREFIX FULL1 FULL2 FULL3 FULL4  → OUTPREFIX-0.jpg ...
import sys
from PIL import Image
pre, files = sys.argv[1], sys.argv[2:]
W, H = 620, 900
ims = []
for f in files:
    im = Image.open(f).convert('RGB'); k = W / im.width
    ims.append(im.resize((W, round(im.height * k)), Image.LANCZOS))
n = max((im.height + H - 1) // H for im in ims)
for i in range(n):
    c = Image.new('RGB', (len(ims) * (W + 10), H), (255, 255, 255))
    for j, im in enumerate(ims):
        if i * H < im.height: c.paste(im.crop((0, i * H, W, min(im.height, (i + 1) * H))), (j * (W + 10), 0))
    c.save(f'{pre}-{i}.jpg', quality=78)
print(n)
