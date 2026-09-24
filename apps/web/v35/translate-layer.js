/**
 * الطبقة العربية فوق الصفحة.
 *
 * لا صورة مترجمة: الصفحة الأصلية كما هي، وفوقها صندوقٌ لكل فقاعة بإحداثياتها
 * (نسبًا من الصورة، فتبقى في مكانها مهما تغيّر العرض). الصندوق يُملأ بلون
 * الفقاعة نفسها (يُقرأ من حافة النص في الصورة) فيغطي الكلام الأصلي، والعربي
 * يُرسم فيه RTL بخط التطبيق، وحجمه يُضبط حتى يتّسع. المتصفح يشكّل العربية
 * ويرتّبها (HarfBuzz + ICU) — لا حاجة لرسّام خاص على الجوال.
 *
 * المؤثرات الصوتية وحقوق الفرق لا تُلمس: الرسم يبقى كما رسمه صاحبه.
 */

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** توسعة الصندوق حول النص: العربي يحتاج مساحة، والفقاعة أوسع من نصها. */
const GROW = 0.14;
const MIN_FONT = 7;
const MAX_FONT = 30;

/** لون الفقاعة: وسيط بكسلات إطارٍ رفيع حول النص مباشرة. */
function sampler(img) {
  try {
    const scale = Math.min(1, 480 / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { g, scale, w: canvas.width, h: canvas.height };
  } catch {
    return null;
  }
}

export function ringColor(s, box) {
  if (!s) return [255, 255, 255];
  try {
    const pad = 3;
    const x0 = Math.max(0, Math.floor(box.x * s.scale) - pad);
    const y0 = Math.max(0, Math.floor(box.y * s.scale) - pad);
    const x1 = Math.min(s.w - 1, Math.ceil((box.x + box.w) * s.scale) + pad);
    const y1 = Math.min(s.h - 1, Math.ceil((box.y + box.h) * s.scale) + pad);
    const data = s.g.getImageData(x0, y0, Math.max(1, x1 - x0 + 1), Math.max(1, y1 - y0 + 1)).data;
    const width = x1 - x0 + 1;
    const height = y1 - y0 + 1;
    const r = [];
    const g = [];
    const b = [];
    const take = (x, y) => {
      const i = (y * width + x) * 4;
      r.push(data[i]);
      g.push(data[i + 1]);
      b.push(data[i + 2]);
    };
    for (let x = 0; x < width; x++) {
      take(x, 0);
      take(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      take(0, y);
      take(width - 1, y);
    }
    const median = (a) => a.sort((m, n) => m - n)[a.length >> 1];
    return [median(r), median(g), median(b)];
  } catch {
    // صورة من أصل آخر (canvas ملوّث): أبيض كأغلب الفقاعات
    return [255, 255, 255];
  }
}

const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** أكبر خط يتّسع، بحثًا ثنائيًّا على التخطيط الفعلي. */
function fit(box, text) {
  let lo = MIN_FONT;
  let hi = MAX_FONT;
  const ok = (size) => {
    text.style.fontSize = `${size}px`;
    return text.scrollHeight <= box.clientHeight + 1 && text.scrollWidth <= box.clientWidth + 1;
  };
  if (!box.clientWidth) return;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  // الحجم كنسبة من عرض الصفحة: يبقى صحيحًا حين يتغيّر العرض
  const frameWidth = box.parentElement?.clientWidth || 1;
  text.style.fontSize = `${((lo / frameWidth) * 100).toFixed(3)}cqw`;
}

/**
 * يرسم الترجمة فوق `img` داخل `frame`. آمنة للتكرار: الطبقة القديمة تُستبدل.
 * @param {{ width: number, height: number, regions: Array }} result
 */
export function paintTranslation(frame, img, result) {
  frame.querySelector(':scope > .rd-tl')?.remove();
  if (!result?.regions?.length) return null;
  const W = result.width || img.naturalWidth;
  const H = result.height || img.naturalHeight;
  const s = sampler(img);
  const layer = el('div', 'rd-tl');
  layer.dir = 'rtl';
  layer.lang = 'ar';
  const boxes = [];
  for (const r of result.regions) {
    if (!r.arabic) continue;
    const gx = r.w * GROW;
    const gy = r.h * GROW;
    const x = Math.max(0, r.x - gx);
    const y = Math.max(0, r.y - gy);
    const w = Math.min(W - x, r.w + gx * 2);
    const h = Math.min(H - y, r.h + gy * 2);
    const color = ringColor(s, r);
    const box = el('div', `rd-tl-box rd-tl-${r.kind}`);
    box.style.left = `${(x / W) * 100}%`;
    box.style.top = `${(y / H) * 100}%`;
    box.style.width = `${(w / W) * 100}%`;
    box.style.height = `${(h / H) * 100}%`;
    box.style.background = `rgb(${color.join(',')})`;
    box.style.color = luminance(color) > 0.5 ? '#111' : '#fff';
    const text = el('span', 'rd-tl-text', r.arabic);
    box.append(text);
    layer.append(box);
    boxes.push([box, text]);
  }
  frame.append(layer);
  requestAnimationFrame(() => {
    for (const [box, text] of boxes) fit(box, text);
  });
  return layer;
}
