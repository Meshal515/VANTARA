# وميض الانتقال: نسبة البكسلات شبه السوداء في كل لقطة متتالية (لقطات homes.cjs)
import sys, glob, json, collections
from PIL import Image
groups = collections.defaultdict(list)
for f in sorted(glob.glob(f'shots/homes/frames/{sys.argv[1]}-*.jpg')):
    im = Image.open(f).convert('L').resize((160, 90))
    px = list(im.getdata()); dark = sum(1 for p in px if p < 14) / len(px)
    groups[f.rsplit('-', 1)[0].split('/')[-1]].append(round(dark * 100))
print(json.dumps(groups))
