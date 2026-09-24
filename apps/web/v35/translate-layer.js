/**
 * الطبقة العربية فوق الصفحة.
 *
 * لا صورة مترجمة: الصفحة الأصلية كما هي، وفوقها صندوقٌ لكل فقاعة بإحداثياتها
 * (نسبًا من الصورة، فتبقى في مكانها مهما تغيّر العرض).
 *
 * التبييض كما تفعله فرق الترجمة، لا مستطيلٌ ملصق:
 *   - نص في فقاعة بلونٍ واحد (الغالب): تُمسح بكسلات الحروف وحدها بلون الفقاعة
 *     (قناعٌ للحبر موسَّع بكسلين)، فحافة الفقاعة والرسم حولها كما هما.
 *   - نص فوق الرسم (خلفية متغيرة): لا مسح يشوّه الرسم؛ خلفيةٌ ناعمة الأطراف
 *     بلون المكان تحت العربي.
 * والعربي يُرسم RTL بخط التطبيق، وحجمه يُضبط حتى يتّسع. المتصفح يشكّل العربية
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
export function sampler(img) {
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
  return ringStats(s, box).color;
}

/** لون الحافة ومدى تجانسها: فقاعةٌ بيضاء متجانسة، والرسم خلف النص متغيّر. */
export function ringStats(s, box) {
  if (!s) return { color: [255, 255, 255], spread: 0, flat: 1 };
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
    const median = (a) => [...a].sort((m, n) => m - n)[a.length >> 1];
    const color = [median(r), median(g), median(b)];
    // متوسط البعد عن الوسيط: صغيرٌ = حافة بلون واحد (فقاعة أو صندوق سرد)
    let far = 0;
    let near = 0;
    for (let i = 0; i < r.length; i++) {
      const e = Math.abs(r[i] - color[0]) + Math.abs(g[i] - color[1]) + Math.abs(b[i] - color[2]);
      far += e;
      if (e / 3 <= 14) near += 1;
    }
    // `flat`: كم من الحافة بلون المكان نفسه. فقاعةٌ يقطع حافتَها حرفٌ أو حدٌّ تبقى
    // عالية؛ الرسم (تنقيط، خطوط، ظلال) يخفضها. أمتن من المتوسط أمام صندوقٍ منزاح
    return { color, spread: far / Math.max(1, r.length) / 3, flat: near / Math.max(1, r.length) };
  } catch {
    // صورة من أصل آخر (canvas ملوّث): أبيض كأغلب الفقاعات
    return { color: [255, 255, 255], spread: 0, flat: 1 };
  }
}

/**
 * فقاعة أم رسم؟ قيس على عشر صفحات صعبة، بصناديق دقيقة ومنزاحة ±10%:
 * حافة الفقاعة بلونها في ≥ 88% منها غالبًا، والنص فوق الرسم 70–74%؛ والتداخل
 * الوحيد صندوقٌ منزاحٌ كثيرًا على فقاعة بيضاء (75–79%). فالأبيض والأسود فقاعةٌ
 * دائمًا، ووضع الرسم للحافة الملوّنة غير المتجانسة وحدها.
 */
export function isOnArt({ color, flat }) {
  const white = Math.min(...color) >= 225;
  const black = Math.max(...color) <= 35;
  return !white && !black && flat < 0.8;
}
/** بُعد اللون عن لون الفقاعة الذي يُعدّ حبرًا (حروفًا أو حوافها الناعمة). */
const INK = 42;
const MAX_CLEAN = 700;

/**
 * نصٌّ فوق الرسم: تُغطّى رقعته برقعةٍ من الرسم نفسه، لا بلطخة.
 *
 * نبحث حول الصندوق عن إزاحةٍ تطابق فيها «حافة» الصندوق (شريط بعرض بضعة
 * بكسلات حوله) حافةَ الموضع المُزاح أكثر ما يمكن — فالتنقيط والخطوط
 * والتدرّج تستمر عبر الرقعة كأن النص لم يكن. ثم تُنسخ الرقعة وتُمزج أطرافها.
 * يرجع canvas بشفافية خارج الصندوق، أو null إن لم يوجد موضعٌ صالح.
 */
function patchFromArt(img, box) {
  const band = 6;
  const reachX = Math.max(40, Math.round(box.w * 0.9));
  const reachY = Math.max(40, Math.round(box.h * 2.5));
  const area = { x: Math.max(0, box.x - reachX), y: Math.max(0, box.y - reachY) };
  area.w = Math.min(img.naturalWidth - area.x, box.w + reachX * 2);
  area.h = Math.min(img.naturalHeight - area.y, box.h + reachY * 2);
  const scale = Math.min(1, 900 / Math.max(area.w, area.h));
  const W = Math.max(1, Math.round(area.w * scale));
  const H = Math.max(1, Math.round(area.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, area.x, area.y, area.w, area.h, 0, 0, W, H);
  const image = g.getImageData(0, 0, W, H);
  const d = image.data;
  const bx = Math.round((box.x - area.x) * scale);
  const by = Math.round((box.y - area.y) * scale);
  const bw = Math.max(1, Math.round(box.w * scale));
  const bh = Math.max(1, Math.round(box.h * scale));
  // بكسلات الشريط حول الصندوق (عيّنة كل بكسلين تكفي للمطابقة)
  const ring = [];
  for (let y = by - band; y < by + bh + band; y += 2) {
    for (let x = bx - band; x < bx + bw + band; x += 2) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (x >= bx && x < bx + bw && y >= by && y < by + bh) continue;
      ring.push(x, y);
    }
  }
  if (ring.length < 20) return null;
  let best = null;
  let bestCost = Infinity;
  const step = Math.max(1, Math.round(Math.min(bw, bh) / 12));
  for (let dy = -by + band; dy <= H - (by + bh + band); dy += step) {
    for (let dx = -bx + band; dx <= W - (bx + bw + band); dx += step) {
      // المصدر لا يلمس الصندوق نفسه: رقعةٌ من الرسم لا من النص
      if (Math.abs(dx) < bw + band && Math.abs(dy) < bh + band) continue;
      let cost = 0;
      for (let k = 0; k < ring.length && cost < bestCost; k += 2) {
        const a = (ring[k + 1] * W + ring[k]) * 4;
        const b = ((ring[k + 1] + dy) * W + ring[k] + dx) * 4;
        cost += Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]);
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = { dx, dy };
      }
    }
  }
  if (!best) return null;
  // النسخ مع مزجٍ ناعم عند الأطراف (feather) كي لا تُرى الحدود
  const out = g.createImageData(W, H);
  const o = out.data;
  const feather = 4;
  for (let y = by - feather; y < by + bh + feather; y++) {
    for (let x = bx - feather; x < bx + bw + feather; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const sx = x + best.dx;
      const sy = y + best.dy;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const inside = Math.min(x - (bx - feather), bx + bw + feather - 1 - x, y - (by - feather), by + bh + feather - 1 - y);
      const alpha = Math.max(0, Math.min(1, inside / feather));
      const i = (y * W + x) * 4;
      const j = (sy * W + sx) * 4;
      o[i] = d[j];
      o[i + 1] = d[j + 1];
      o[i + 2] = d[j + 2];
      o[i + 3] = Math.round(alpha * 255);
    }
  }
  g.putImageData(out, 0, 0);
  canvas.className = 'rd-tl-clean';
  canvas.box = area;
  return canvas;
}

/**
 * يمسح حروف النص الأصلي داخل صندوقه، كما تفعل فرق الترجمة:
 *   1. قناع الحبر: كل بكسل بعيدٍ عن لون المكان (حروفًا وحوافها الناعمة)،
 *      موسَّعًا بكسلين.
 *   2. ترميم من الخارج إلى الداخل: كل بكسل ممسوح يأخذ متوسط جيرانه المعروفين،
 *      طبقةً بعد طبقة. في فقاعة بيضاء يصير أبيض؛ فوق تدرّجٍ أو رسمٍ يكمل
 *      ما حوله بدل بقعة بلون واحد.
 * ما ليس حبرًا يبقى شفافًا: الفقاعة وحدودها والرسم لا تُلمس.
 * يرجع canvas يغطي الصندوق مع هامشه، وموضعه بنسب الصورة (`canvas.box`).
 */
export function cleanText(img, box, color, { onArt = false } = {}) {
  if (onArt) {
    const patched = patchFromArt(img, box);
    if (patched) return patched;
  }
  // هامشٌ أعرض من أطراف الحروف: إطاره الخارجي هو ما يبدأ منه الترميم، فيجب أن يكون نظيفًا
  const margin = Math.max(10, Math.round(Math.min(box.w, box.h) * 0.12));
  const crop = {
    x: Math.max(0, box.x - margin),
    y: Math.max(0, box.y - margin),
  };
  crop.w = Math.min(img.naturalWidth - crop.x, box.w + margin * 2);
  crop.h = Math.min(img.naturalHeight - crop.y, box.h + margin * 2);
  const scale = Math.min(1, MAX_CLEAN / Math.max(crop.w, crop.h));
  const w = Math.max(1, Math.round(crop.w * scale));
  const h = Math.max(1, Math.round(crop.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  const image = g.getImageData(0, 0, w, h);
  const d = image.data;

  // ١. قناع الحبر داخل الصندوق وحده؛ الهامش معروفٌ دائمًا (منه يبدأ الترميم)
  // الصندوق من النموذج تقريبي: أطراف الحروف قد تخرج عنه قليلًا، فالكشف يمتد
  // إلى الهامش ويبقى إطار بكسل واحد معروفًا يبدأ منه الترميم
  const ix0 = 1;
  const iy0 = 1;
  const ix1 = w - 1;
  const iy1 = h - 1;
  const ink = new Uint8Array(w * h);
  for (let y = iy0; y < iy1; y++) {
    for (let x = ix0; x < ix1; x++) {
      const i = (y * w + x) * 4;
      const dist = (Math.abs(d[i] - color[0]) + Math.abs(d[i + 1] - color[1]) + Math.abs(d[i + 2] - color[2])) / 3;
      if (dist > INK) ink[y * w + x] = 1;
    }
  }

  // حبرٌ متصلٌ بخارج الصندوق ليس حروفًا: حدّ الفقاعة، خطوط الرسم، ذيل الفقاعة.
  // يبقى كما هو؛ والحروف (جزرٌ داخل الصندوق) وحدها تُمسح
  const keep = new Uint8Array(w * h);
  // الصندوق نفسه داخل القطعة (بلا الهامش)
  const tx0 = Math.round((box.x - crop.x) * scale);
  const ty0 = Math.round((box.y - crop.y) * scale);
  const tx1 = Math.round((box.x - crop.x + box.w) * scale);
  const ty1 = Math.round((box.y - crop.y + box.h) * scale);
  let mask = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const stack = [];
  const edge = (p) => {
    const x = p % w;
    const y = (p / w) | 0;
    return x <= 2 || y <= 2 || x >= w - 3 || y >= h - 3;
  };
  if (onArt) {
    // نص فوق الرسم: لا حدّ فقاعة نحميه، وخطوط الرسم تمرّ بين الحروف فتربطها بالخارج.
    // يُمسح الصندوق كله ويُرمَّم من حوله — رقعةٌ ناعمة لا بقايا حروف
    const bx0 = Math.max(1, Math.round((box.x - crop.x) * scale) - 2);
    const by0 = Math.max(1, Math.round((box.y - crop.y) * scale) - 2);
    const bx1 = Math.min(w - 1, Math.round((box.x - crop.x + box.w) * scale) + 2);
    const by1 = Math.min(h - 1, Math.round((box.y - crop.y + box.h) * scale) + 2);
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) mask[y * w + x] = 1;
    ink.fill(0);
  }
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    const comp = [];
    let touches = false;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      if (!touches && edge(p)) touches = true;
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (ink[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    // متصلٌ بالخارج ومعظمه خارج الصندوق = حدّ فقاعة أو خط رسم: يبقى.
    // متصلٌ بالخارج ومعظمه داخله = حروفٌ مسّها خط: تُمسح
    let inside = 0;
    if (touches) {
      for (const p of comp) {
        const x = p % w;
        const y = (p / w) | 0;
        if (x >= tx0 && x < tx1 && y >= ty0 && y < ty1) inside += 1;
      }
    }
    const border = touches && inside < comp.length * 0.5;
    for (const p of comp) (border ? keep : mask)[p] = 1;
  }
  // توسعة القناع مرتين: حواف الحروف الناعمة لا تبقى ظلالًا — ولا تأكل الحدّ المحفوظ
  for (let pass = 0; pass < 2; pass++) {
    const grown = new Uint8Array(mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (mask[p] || keep[p]) continue;
        if (mask[p - 1] || mask[p + 1] || mask[p - w] || mask[p + w] || mask[p - w - 1] || mask[p - w + 1] || mask[p + w - 1] || mask[p + w + 1]) grown[p] = 1;
      }
    }
    mask = grown;
  }

  // ٢. ترميم «قشرة البصلة»: الحافة المعروفة تزحف إلى الداخل. المصدر هو الخلفية
  // لا خطوط الحبر المحفوظة، فلا يسيل سواد الحدّ إلى داخل الفقاعة
  const erased = new Uint8Array(mask);
  const known = new Uint8Array(w * h);
  for (let p = 0; p < known.length; p++) known[p] = mask[p] ? 0 : 1;
  for (let layer = 0; layer < 400; layer++) {
    const fill = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (known[p]) continue;
        let r = 0;
        let gg = 0;
        let b = 0;
        let n = 0;
        let lr = 0;
        let lg = 0;
        let lb = 0;
        let ln = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (!known[q]) continue;
            if (keep[q]) {
              lr += d[q * 4];
              lg += d[q * 4 + 1];
              lb += d[q * 4 + 2];
              ln += 1;
            } else {
              r += d[q * 4];
              gg += d[q * 4 + 1];
              b += d[q * 4 + 2];
              n += 1;
            }
          }
        }
        if (n) fill.push(p, r / n, gg / n, b / n);
        else if (ln && layer > 40) fill.push(p, lr / ln, lg / ln, lb / ln);
      }
    }
    if (!fill.length) break;
    for (let k = 0; k < fill.length; k += 4) {
      const p = fill[k];
      d[p * 4] = fill[k + 1];
      d[p * 4 + 1] = fill[k + 2];
      d[p * 4 + 2] = fill[k + 3];
      known[p] = 1;
    }
  }
  for (let p = 0; p < erased.length; p++) d[p * 4 + 3] = erased[p] ? 255 : 0;
  g.putImageData(image, 0, 0);
  canvas.className = 'rd-tl-clean';
  canvas.box = crop;
  return canvas;
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
    // نص عمودي (ياباني غالبًا): صندوقه طويل ضيّق، والعربي أفقي. يُعرَّض حول
    // مركزه ليتّسع لكلمة كاملة — الفقاعة العمودية أعرض من عمود حروفها
    const tall = r.h > r.w * 1.8;
    const gx = tall ? Math.max(r.w * GROW, (r.h * 0.55 - r.w) / 2) : r.w * GROW;
    const gy = r.h * GROW;
    const x = Math.max(0, r.x - gx);
    const y = Math.max(0, r.y - gy);
    const w = Math.min(W - x, r.w + gx * 2);
    const h = Math.min(H - y, r.h + gy * 2);
    const { color, flat } = ringStats(s, r);
    const pct = (b, el2) => {
      el2.style.left = `${(b.x / W) * 100}%`;
      el2.style.top = `${(b.y / H) * 100}%`;
      el2.style.width = `${(b.w / W) * 100}%`;
      el2.style.height = `${(b.h / H) * 100}%`;
    };
    // حافةٌ بلون واحد = فقاعة أو صندوق: تُمسح الحروف وحدها ويُحمى الحدّ.
    // حافةٌ متغيّرة = نص فوق الرسم: يُمسح الصندوق كله ويُرمَّم من حوله.
    const inBubble = !isOnArt({ color, flat });
    {
      try {
        const clean = cleanText(img, { x: r.x, y: r.y, w: r.w, h: r.h }, color, { onArt: !inBubble });
        pct(clean.box, clean);
        layer.append(clean);
      } catch {
        // canvas ملوّث: يبقى الأصل تحت العربي، والخلفية الناعمة تكفي
      }
    }
    const box = el('div', `rd-tl-box rd-tl-${r.kind}${inBubble ? ' rd-tl-inbubble' : ' rd-tl-onart'}`);
    pct({ x, y, w, h }, box);
    const rgb = `rgb(${color.join(',')})`;

    box.style.color = luminance(color) > 0.5 ? '#111' : '#fff';
    // هالة بلون المكان: في الفقاعة لا تُرى، وفوق الرسم تجعل العربي مقروءًا
    box.style.setProperty('--tl-halo', `rgb(${color.join(',')})`);
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
