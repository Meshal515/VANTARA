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
 * كل حفرة (حرفٌ ممسوح أو كلمة) بما يناسب ما حولها: حولها لونٌ واحد (جلد،
 * سماء، لوحة) = تزحف الألوان من الحافة فتذوب الحفرة بلا أثر؛ حولها نقشٌ
 * (خطوط، تنقيط، شعر) = رقعٌ صغيرة من الجوار تكمل النقش.
 */
function fillHoles(d, w, h, mask) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && mask[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    // تباين الحافة: بكسلاتٌ معروفة تلاصق الحفرة
    const ring = [];
    const inComp = new Set(comp);
    for (const p of comp) {
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q >= 0 && q < mask.length && !mask[q] && !inComp.has(q)) ring.push(q);
      }
    }
    const one = new Uint8Array(w * h);
    for (const p of comp) one[p] = 1;
    let spread = 0;
    if (ring.length) {
      const med = [0, 1, 2].map((c) => ring.map((q) => d[q * 4 + c]).sort((a, b) => a - b)[ring.length >> 1]);
      // نسبة الحافة البعيدة عن لونها الغالب: خطوطٌ قليلة فوق لونٍ واحد نقشٌ أيضًا
      for (const q of ring) if ((Math.abs(d[q * 4] - med[0]) + Math.abs(d[q * 4 + 1] - med[1]) + Math.abs(d[q * 4 + 2] - med[2])) / 3 > 28) spread += 1;
      spread /= ring.length;
    }
    if (spread < 0.15) onionFill(d, w, h, one);
    else inpaintPatches(d, w, h, one);
    for (const p of comp) mask[p] = 0;
  }
}

/** ترميمٌ يزحف من الحافة: كل بكسل يأخذ متوسط جيرانه المعروفين، طبقةً بعد طبقة. */
function onionFill(d, w, h, mask) {
  const known = new Uint8Array(w * h);
  for (let p = 0; p < known.length; p++) known[p] = mask[p] ? 0 : 1;
  for (let layer = 0; layer < 600; layer++) {
    const fill = [];
    for (let p = 0; p < known.length; p++) {
      if (known[p]) continue;
      const x = p % w;
      const y = (p / w) | 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (!known[q]) continue;
          r += d[q * 4];
          g += d[q * 4 + 1];
          b += d[q * 4 + 2];
          n += 1;
        }
      }
      if (n) fill.push(p, r / n, g / n, b / n);
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
}

/**
 * ترميمٌ بالرقع (على طريقة Criminisi، مبسّطة): الحفرة تُملأ من حافتها إلى
 * داخلها، كل مرة رقعة 9×9 حول أوثق نقطة على الحافة، منسوخةٌ من أقرب موضع في
 * الجوار تطابق بكسلاته المعروفة ما حول النقطة. الرقعة صغيرة فلا تتكرر قبعةٌ
 * أو وجه، لكن الخطوط والتنقيط والتدرّج تستمر كأن النص لم يكن.
 * `mask`: 1 = يُملأ. يعدّل `d` في مكانه.
 */
function inpaintPatches(d, w, h, mask) {
  const R = 4;
  const S = 28;
  const known = new Uint8Array(w * h);
  let left = 0;
  for (let p = 0; p < known.length; p++) {
    known[p] = mask[p] ? 0 : 1;
    if (mask[p]) left += 1;
  }
  if (!left) return;
  // مصدرٌ صالح = رقعته كلها معروفة من الأصل (صورة تكاملية للمجهول)
  const holes = new Int32Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += mask[(y - 1) * w + x - 1] ? 1 : 0;
      holes[y * (w + 1) + x] = row + holes[(y - 1) * (w + 1) + x];
    }
  }
  const clean = (cx, cy) => {
    const x0 = cx - R;
    const y0 = cy - R;
    const x1 = cx + R + 1;
    const y1 = cy + R + 1;
    if (x0 < 0 || y0 < 0 || x1 > w || y1 > h) return false;
    return holes[y1 * (w + 1) + x1] - holes[y0 * (w + 1) + x1] - holes[y1 * (w + 1) + x0] + holes[y0 * (w + 1) + x0] === 0;
  };
  let guard = 0;
  while (left > 0 && guard++ < 20000) {
    // أوثق نقطة على الحافة: أكثر رقعتها معروف
    let best = -1;
    let bestKnown = -1;
    for (let p = 0; p < known.length; p++) {
      if (known[p]) continue;
      const x = p % w;
      const y = (p / w) | 0;
      if (!((x > 0 && known[p - 1]) || (x < w - 1 && known[p + 1]) || (y > 0 && known[p - w]) || (y < h - 1 && known[p + w]))) continue;
      let k = 0;
      for (let dy = -R; dy <= R; dy += 2) {
        for (let dx = -R; dx <= R; dx += 2) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && known[ny * w + nx]) k += 1;
        }
      }
      if (k > bestKnown) {
        bestKnown = k;
        best = p;
      }
    }
    if (best < 0) break;
    const tx = best % w;
    const ty = (best / w) | 0;
    // أقرب رقعة تطابق المعروف حولها (بخطوتين، ومقارنة كل بكسلين للسرعة)
    let src = -1;
    let cost = Infinity;
    for (let sy = Math.max(R, ty - S); sy <= Math.min(h - R - 1, ty + S); sy += 2) {
      for (let sx = Math.max(R, tx - S); sx <= Math.min(w - R - 1, tx + S); sx += 2) {
        if (!clean(sx, sy)) continue;
        let c = 0;
        for (let dy = -R; dy <= R && c < cost; dy += 1) {
          const yy = ty + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -R; dx <= R; dx += 1) {
            const xx = tx + dx;
            if (xx < 0 || xx >= w) continue;
            const a = yy * w + xx;
            if (!known[a]) continue;
            const i = a * 4;
            const j = ((sy + dy) * w + sx + dx) * 4;
            c += Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
          }
        }
        // تفضيلٌ خفيف للأقرب: الجار أصدق من البعيد المشابه
        c += (Math.abs(sx - tx) + Math.abs(sy - ty)) * 6;
        if (c < cost) {
          cost = c;
          src = sy * w + sx;
        }
      }
    }
    const sxx = src >= 0 ? src % w : -1;
    const syy = src >= 0 ? (src / w) | 0 : -1;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const xx = tx + dx;
        const yy = ty + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const a = yy * w + xx;
        if (known[a]) continue;
        const i = a * 4;
        if (src >= 0) {
          const j = ((syy + dy) * w + sxx + dx) * 4;
          d[i] = d[j];
          d[i + 1] = d[j + 1];
          d[i + 2] = d[j + 2];
        } else {
          // لا مصدر صالح قريب: متوسط الجيران المعروفين
          let r = 0;
          let gg = 0;
          let b = 0;
          let n = 0;
          for (const q of [a - 1, a + 1, a - w, a + w]) {
            if (q < 0 || q >= known.length || !known[q]) continue;
            r += d[q * 4];
            gg += d[q * 4 + 1];
            b += d[q * 4 + 2];
            n += 1;
          }
          if (!n) continue;
          d[i] = r / n;
          d[i + 1] = gg / n;
          d[i + 2] = b / n;
        }
        known[a] = 1;
        left -= 1;
      }
    }
  }
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
    // نص فوق الرسم: الحروف وحدها ومعها خطّها المحيط، لا الصندوق. نسخ رقعة من
    // مكانٍ آخر كرّر قبعةً ووجهًا على جوال، ومسح الصندوق كله لطّخ الرسم؛ فيُمسح
    // ما هو حرفٌ فعلًا (بحجم حرف وتحيط به خلفية تباينه) ويُرمَّم من جيرانه
    ink.fill(0);
    const Lc = new Float32Array(w * h);
    for (let p = 0, i = 0; p < Lc.length; p++, i += 4) Lc[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const bw = Math.max(2, (box.w * scale) | 0);
    const bh = Math.max(2, (box.h * scale) | 0);
    let pick = null;
    for (const dark of [true, false]) {
      const inBox = findGlyphs(Lc, w, h, dark, Math.max(6, bw * 0.95), Math.max(6, bh * 1.2)).filter(
        (c) => c.cx >= tx0 && c.cx <= tx1 && c.cy >= ty0 && c.cy <= ty1,
      );
      const mass = inBox.reduce((a, c) => a + c.n, 0);
      if (!pick || mass > pick.mass) pick = { list: inBox, mass, dark };
    }
    if (pick?.list.length) {
      const heights = pick.list.map((c) => c.y1 - c.y0 + 1).sort((a, b) => a - b);
      const glyphH = heights[heights.length >> 1] || 6;
      for (const c of pick.list) for (const p of c.px) mask[p] = 1;
      // الخط المحيط بالحرف (أسود حول الأبيض أو العكس) يُمسح معه بكامل سُمكه:
      // النمو يتبع بكسلات لونه المعاكس وحدها، ثم حلقتان للحواف الناعمة
      const outline = Math.max(2, Math.round(glyphH * 0.3));
      const opposite = pick.dark ? (p) => Lc[p] > 0.7 : (p) => Lc[p] < 0.3;
      const grow = (only) => {
        const grown = new Uint8Array(mask);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const p = y * w + x;
            if (mask[p] || (only && !only(p))) continue;
            if (mask[p - 1] || mask[p + 1] || mask[p - w] || mask[p + w]) grown[p] = 1;
          }
        }
        mask = grown;
      };
      for (let pass = 0; pass < outline; pass++) grow(opposite);
      grow(null);
      grow(null);
    }
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

  // ٢أ. فوق الرسم: ترميمٌ برقعٍ صغيرة من الجوار (لا لون متوسط يطمس الخطوط والتنقيط)
  if (onArt) {
    const erasedArt = new Uint8Array(mask);
    fillHoles(d, w, h, mask);
    for (let p = 0; p < erasedArt.length; p++) d[p * 4 + 3] = erasedArt[p] ? 255 : 0;
    g.putImageData(image, 0, 0);
    canvas.className = 'rd-tl-clean';
    canvas.box = crop;
    return canvas;
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

/**
 * الحروف في صورة سطوع `L` (W×H): مكوّنات «حبر» صغيرة تحيط بها خلفية تباينها
 * بوضوح. `dark`: حروف داكنة على فاتح، وإلا فاتحة على داكن. خصلة شعر أو خط
 * لوحة أو حدّ فقاعة أكبر من حرف فتُستبعد بالحجم (`maxW`/`maxH`).
 * يرجع لكل حرف صندوقه ومركزه وعدد بكسلاته، ومعها بكسلاته (`px`).
 */
function findGlyphs(L, W, H, dark, maxW, maxH) {
  const ink = new Uint8Array(W * H);
  for (let p = 0; p < ink.length; p++) ink[p] = dark ? (L[p] < 0.45 ? 1 : 0) : L[p] > 0.75 ? 1 : 0;
  // الخلفية حول الحرف تباينه بوضوح: فاتحة حول الداكن، وأغمق بكثير حول الأبيض
  const bright = (p) => (dark ? L[p] > 0.72 : L[p] < 0.5);
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = [];
  for (let s = 0; s < ink.length; s++) {
    if (!ink[s] || seen[s]) continue;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    const px = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      px.push(p);
      const x = p % W;
      const y = (p / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && ink[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), stack.push(p - 1);
      if (x < W - 1 && ink[p + 1] && !seen[p + 1]) (seen[p + 1] = 1), stack.push(p + 1);
      if (y > 0 && ink[p - W] && !seen[p - W]) (seen[p - W] = 1), stack.push(p - W);
      if (y < H - 1 && ink[p + W] && !seen[p + W]) (seen[p + W] = 1), stack.push(p + W);
    }
    const n = px.length;
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    if (n < 3 || cw > maxW || ch > maxH || (cw < 2 && ch < 2)) continue;
    // حرفٌ تحيط به خلفية تباينه: إطار حول صندوقه، أغلبه كذلك
    let ring = 0;
    let lit = 0;
    const pad = 2;
    for (let x = x0 - pad; x <= x1 + pad; x++) {
      for (const y of [y0 - pad, y1 + pad]) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        ring += 1;
        if (bright(y * W + x)) lit += 1;
      }
    }
    for (let y = y0 - pad; y <= y1 + pad; y++) {
      for (const x of [x0 - pad, x1 + pad]) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        ring += 1;
        if (bright(y * W + x)) lit += 1;
      }
    }
    if (!ring || lit / ring < 0.6) continue;
    out.push({ x0, y0, x1, y1, n, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, px });
  }
  return out;
}

/**
 * صندوق النموذج تقريبي، وقد يزيح فقاعةً كاملة (رأيناه على جوال: أعلى من
 * الفقاعة بطولها، فبُيّض الرسم وبقي الإنجليزي). فلا نثق به أعمى: نبحث حوله
 * عن الحروف نفسها ونضع الصندوق عليها.
 *
 *   1. الحروف = مكوّنات صغيرة داكنة تحيط بها خلفية فاتحة (أو العكس لفقاعة
 *      سوداء). حدّ الفقاعة وخطوط اللوحة والرسم أكبر من حرف أو بلا خلفية فاتحة.
 *   2. ننزلق بالصندوق نفسه في نافذةٍ حوله ونختار الموضع الأكثر حروفًا، مع
 *      تفضيلٍ للقريب — ولا ننتقل إلا إن كان الموضع الجديد أوضح بفرق.
 *   3. الصندوق النهائي = حدود الحروف في ذلك الموضع (أضيق وأدق).
 * `claimed`: صناديق فقاعاتٍ سبقت، فلا تلتقط فقاعتان نفس النص.
 * لا حروف وجدناها؟ يرجع الصندوق كما هو.
 */
export function snapBox(img, box, claimed = []) {
  try {
    const IW = img.naturalWidth;
    const IH = img.naturalHeight;
    const rx = Math.max(40, box.w * 0.9);
    const ry = Math.max(40, box.h * 1.3);
    const ax = Math.max(0, Math.floor(box.x - rx));
    const ay = Math.max(0, Math.floor(box.y - ry));
    const aw = Math.min(IW - ax, Math.ceil(box.w + rx * 2));
    const ah = Math.min(IH - ay, Math.ceil(box.h + ry * 2));
    if (aw < 8 || ah < 8) return box;
    const scale = Math.min(1, 520 / Math.max(aw, ah));
    const W = Math.max(1, Math.round(aw * scale));
    const H = Math.max(1, Math.round(ah * scale));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, ax, ay, aw, ah, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const L = new Float32Array(W * H);
    for (let p = 0, i = 0; p < L.length; p++, i += 4) L[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const bw = Math.max(2, Math.round(box.w * scale));
    const bh = Math.max(2, Math.round(box.h * scale));
    const maxW = Math.max(6, bw * 0.95);
    const maxH = Math.max(6, bh * 1.2);
    const toImage = (x, y) => [ax + x / scale, ay + y / scale];
    const isClaimed = (cx, cy) => {
      const [x, y] = toImage(cx, cy);
      return claimed.some((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    };

    const glyphs = (dark) =>
      findGlyphs(L, W, H, dark, maxW, maxH).filter((c) => !(claimed.length && isClaimed(c.cx, c.cy)));

    // الموضع الأصلي داخل النافذة
    const ox = Math.round((box.x - ax) * scale);
    const oy = Math.round((box.y - ay) * scale);
    const diag = Math.hypot(W, H);
    let best = null;
    for (const dark of [true, false]) {
      const list = glyphs(dark);
      if (!list.length) continue;
      // خريطة كثافة الحروف (بكسلاتها عند مراكزها) + صورة تكاملية للانزلاق السريع
      const grid = new Float32Array((W + 1) * (H + 1));
      for (const c of list) grid[(Math.round(c.cy) + 1) * (W + 1) + Math.round(c.cx) + 1] += c.n;
      for (let y = 1; y <= H; y++) {
        let row = 0;
        for (let x = 1; x <= W; x++) {
          row += grid[y * (W + 1) + x];
          grid[y * (W + 1) + x] = row + grid[(y - 1) * (W + 1) + x];
        }
      }
      const sum = (x, y) => {
        const x0 = Math.max(0, Math.min(W, x));
        const y0 = Math.max(0, Math.min(H, y));
        const x1 = Math.max(0, Math.min(W, x + bw));
        const y1 = Math.max(0, Math.min(H, y + bh));
        return grid[y1 * (W + 1) + x1] - grid[y0 * (W + 1) + x1] - grid[y1 * (W + 1) + x0] + grid[y0 * (W + 1) + x0];
      };
      const here = sum(ox, oy);
      // مرشّحان لكل لون: البقاء مكانه، والموضع الأكثر حروفًا حوله
      let top = { score: here, x: ox, y: oy };
      const step = Math.max(1, Math.round(Math.min(bw, bh) / 16));
      for (let y = -bh + 1; y < H; y += step) {
        for (let x = -bw + 1; x < W; x += step) {
          const s = sum(x, y) * (1 - (0.35 * Math.hypot(x - ox, y - oy)) / diag);
          if (s > top.score) top = { score: s, x, y };
        }
      }
      for (const [px, py, stay] of [[ox, oy, true], [top.x, top.y, false]]) {
        const got = complete(list, px, py);
        if (!got) continue;
        // الحكم بما يُلتقط بعد إكمال الأسطر: البقاء يفوز ما لم يكن الانتقال أوضح بكثير
        const far = Math.hypot(px - ox, py - oy) / diag;
        const value = got.mass * (stay ? 1.6 : 1) * (1 - 0.5 * far);
        if (!best || value > best.value) best = { ...got, value };
      }
    }
    if (!best || best.mass < 8) return box;
    const { x0, y0, x1, y1, glyphH } = best;
    // هامشٌ بعرض حدّ الحرف: النص فوق الرسم محاطٌ بخطٍّ أسود يُمسح معه
    const pad = Math.max(2, glyphH * 0.18);
    const [ix0, iy0] = toImage(x0 - pad, y0 - pad);
    const [ix1, iy1] = toImage(x1 + 1 + pad, y1 + 1 + pad);
    const out = { x: Math.max(0, ix0), y: Math.max(0, iy0) };
    out.w = Math.min(IW - out.x, ix1 - ix0);
    out.h = Math.min(IH - out.y, iy1 - iy0);
    // حروفٌ قليلة في زاوية لا تُصغّر فقاعةً كاملة إلى نقطة
    if (out.w < box.w * 0.25 && out.h < box.h * 0.25) return box;
    return out;

    /**
     * الحروف التي تقع مراكزها في الصندوق عند (px, py)، ثم إكمال السطر: حرفٌ خرج
     * عنه («?!» في آخر الجملة، «E» على الحافة، السطر التالي) يُضم إن لاصق
     * النص بمسافة حرف وكان بحجم حروفه.
     */
    function complete(list, px, py) {
      const gx = bw * 0.12;
      const gy = bh * 0.12;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const inside = new Set();
      for (const c of list) {
        if (c.cx < px - gx || c.cx > px + bw + gx || c.cy < py - gy || c.cy > py + bh + gy) continue;
        inside.add(c);
        x0 = Math.min(x0, c.x0);
        y0 = Math.min(y0, c.y0);
        x1 = Math.max(x1, c.x1);
        y1 = Math.max(y1, c.y1);
      }
      if (!inside.size) return null;
      const heights = [...inside].map((c) => c.y1 - c.y0 + 1).sort((a, b) => a - b);
      const glyphH = heights[heights.length >> 1] || 6;
      for (let pass = 0; pass < 6; pass++) {
        let grew = false;
        // سقف النمو: لا يتجاوز صندوق النموذج بأكثر من نصفه — خصلة شعر أو تفصيلة
        // رسمٍ بحجم حرف قرب النص لا تجرّ الصندوق إلى الرسم
        const lx0 = px - bw * 0.45;
        const ly0 = py - bh * 0.6;
        const lx1 = px + bw * 1.45;
        const ly1 = py + bh * 1.6;
        for (const c of list) {
          const ch = c.y1 - c.y0 + 1;
          if (inside.has(c) || ch > glyphH * 1.6 || ch < glyphH * 0.35) continue;
          if (c.x0 < lx0 || c.y0 < ly0 || c.x1 > lx1 || c.y1 > ly1) continue;
          const gapX = Math.max(0, c.x0 - x1, x0 - c.x1);
          const gapY = Math.max(0, c.y0 - y1, y0 - c.y1);
          if (gapX > glyphH * 0.9 || gapY > glyphH * 1.15) continue;
          inside.add(c);
          x0 = Math.min(x0, c.x0);
          y0 = Math.min(y0, c.y0);
          x1 = Math.max(x1, c.x1);
          y1 = Math.max(y1, c.y1);
          grew = true;
        }
        if (!grew) break;
      }
      let mass = 0;
      for (const c of inside) mass += c.n;
      return { x0, y0, x1, y1, glyphH, mass };
    }
  } catch {
    return box;
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
  // صناديق النموذج بمقاس الصورة المعروضة، ثم تُثبَّت على الحروف نفسها
  const sx = img.naturalWidth / W;
  const sy = img.naturalHeight / H;
  const claimed = [];
  for (const raw of result.regions) {
    if (!raw.arabic) continue;
    const scaled = { x: raw.x * sx, y: raw.y * sy, w: raw.w * sx, h: raw.h * sy };
    const snapped = snapBox(img, scaled, claimed);
    claimed.push(snapped);
    const r = { ...raw, x: snapped.x / sx, y: snapped.y / sy, w: snapped.w / sx, h: snapped.h / sy };
    // نص عمودي (ياباني غالبًا): صندوقه طويل ضيّق، والعربي أفقي. يُعرَّض حول
    // مركزه ليتّسع لكلمة كاملة — الفقاعة العمودية أعرض من عمود حروفها
    const tall = r.h > r.w * 1.8;
    const gx = tall ? Math.max(r.w * GROW, (r.h * 0.55 - r.w) / 2) : r.w * GROW;
    const gy = r.h * GROW;
    const x = Math.max(0, r.x - gx);
    const y = Math.max(0, r.y - gy);
    const w = Math.min(W - x, r.w + gx * 2);
    const h = Math.min(H - y, r.h + gy * 2);
    const { color, flat } = ringStats(s, snapped);
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
        const clean = cleanText(img, snapped, color, { onArt: !inBubble });
        pct({ x: clean.box.x / sx, y: clean.box.y / sy, w: clean.box.w / sx, h: clean.box.h / sy }, clean);
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
