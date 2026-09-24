/**
 * محرّك الترجمة — جانب الجوال.
 *
 * الصفحة → بصمة من بايتات صورتها الأصلية (نفس الصورة عند صديقك = نفس البصمة =
 * نفس الترجمة، بلا تكلفة ثانية) → الذاكرة المحلية → ذاكرة الخادم → وإلا
 * تُصغَّر وتُقسَّم (الويبتون شرائط طويلة) وتُرسل قطعةً قطعة لـ`/v1/translate/page`.
 * الناتج مناطق نص بإحداثيات الصورة الأصلية، والقارئ يرسمها طبقةً فوقها.
 *
 * والجدولة طابور أولويات حيّ: الفصل الحالي ثم التالي ثم السابق، والصفحات
 * بقربها من موضعك لا بترتيبها. تقترب من صفحة لم تُترجم؟ تعود للمقدّمة.
 *
 * الدوال الخالصة (العتبة، التقسيم، الدمج، الطابور) تُختبر بلا جهاز.
 */

import { readKv, writeKv } from './chapter-store.js';

/** أطول ضلع يقبله النموذج بدقته الكاملة؛ نبقى تحته بهامش. */
export const MAX_EDGE = 2400;
/** عرض كافٍ لقراءة أصغر خط، ولا يزيد التكلفة بلا فائدة. */
export const MAX_WIDTH = 1200;
/** تداخل القطع: فقاعة على خط القطع تبقى كاملة في إحدى القطعتين. */
export const OVERLAP = 420;
const CACHE_PREFIX = 'tl1:';

// ───────────────────────── العتبة: متى تدخل ─────────────────────────

/**
 * أقل عدد صفحات جاهزة لتبدأ القراءة بلا أن تلحق بالترجمة فتتوقف.
 *
 * `N` صفحات الفصل، `R` سرعة قراءتك (صفحة/دقيقة)، `T` سرعة الترجمة الآن.
 * تلحق بها حين `k + T·t = R·t`، والترجمة تنتهي عند `(N − k)/T`؛ لا توقّف ما
 * دام `k ≥ N·(1 − T/R)`. بهامش 20%، وبين 10% و60% من الفصل، وثلاث صفحات على
 * الأقل. `T ≥ R` ← الترجمة أسرع منك: ثلاث صفحات تكفي.
 */
export function entryPages({ total, translatePerMin, readPerMin }) {
  const n = Math.max(0, Math.floor(total));
  if (!n) return 0;
  const floor = Math.min(n, Math.max(3, Math.ceil(n * 0.1)));
  const ceiling = Math.max(floor, Math.ceil(n * 0.6));
  const T = Number(translatePerMin);
  const R = Number(readPerMin);
  if (!(T > 0) || !(R > 0)) return ceiling;
  if (T >= R) return Math.min(n, 3);
  const k = Math.ceil(n * (1 - T / R) * 1.2);
  return Math.min(ceiling, Math.max(floor, k));
}

/** سرعة قراءة المستخدم: من سجلّه إن وُجد، وإلا تقدير محافظ. */
export function readingRate(history = []) {
  const recent = history.filter((h) => h.pages > 0 && h.ms > 0).slice(-10);
  if (!recent.length) return 8;
  const pages = recent.reduce((t, h) => t + h.pages, 0);
  const ms = recent.reduce((t, h) => t + h.ms, 0);
  return Math.max(1, Math.min(60, (pages / ms) * 60_000));
}

// ───────────────────────── التقسيم والدمج ─────────────────────────

/**
 * كيف تُرسل صورة: مقياس التصغير، وقطع رأسية بارتفاعات ≤ MAX_EDGE متداخلة.
 * صفحة مانجا عادية = قطعة واحدة؛ شريط ويبتون 800×12000 = ست قطع تقريبًا.
 */
export function tilePlan(width, height, { maxEdge = MAX_EDGE, maxWidth = MAX_WIDTH, overlap = OVERLAP } = {}) {
  // صفحة طولية: العرض ≤ maxWidth. صفحة عريضة (صفحتان متقابلتان): أطول ضلع ≤ maxEdge
  const scale = width >= height ? Math.min(1, maxEdge / width) : Math.min(1, maxWidth / width);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (h <= maxEdge) return { scale, width: w, height: h, tiles: [{ y: 0, h }] };
  const tiles = [];
  const step = maxEdge - overlap;
  for (let y = 0; ; y += step) {
    const th = Math.min(maxEdge, h - y);
    tiles.push({ y, h: th });
    if (y + th >= h) break;
  }
  return { scale, width: w, height: h, tiles };
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / Math.max(1, a.w * a.h + b.w * b.h - inter);
};

/**
 * نتائج القطع → مناطق بإحداثيات الصورة الأصلية، بلا تكرار في التداخل.
 * منطقة تلمس خط القطع السفلي تُترك إن كانت بعدها قطعة: هناك تظهر كاملة.
 */
export function mergeTiles(plan, results) {
  const out = [];
  plan.tiles.forEach((tile, i) => {
    const regions = results[i]?.regions ?? [];
    const last = i === plan.tiles.length - 1;
    for (const r of regions) {
      if (!last && r.y + r.h >= tile.h - 6) continue;
      if (i > 0 && r.y <= 6 && r.y + r.h < OVERLAP) continue;
      const mapped = {
        ...r,
        x: r.x / plan.scale,
        y: (r.y + tile.y) / plan.scale,
        w: r.w / plan.scale,
        h: r.h / plan.scale,
      };
      if (out.some((o) => iou(o, mapped) > 0.5)) continue;
      out.push(mapped);
    }
  });
  return out;
}

// ───────────────────────── الطابور ─────────────────────────

/**
 * طابور أولويات حيّ. الأولوية = رتبة الفصل (الحالي 0، التالي 1، السابق 2)
 * ثم بُعد الصفحة عن موضعك: ما أمامك أولًا، وما خلفك بوزن أثقل.
 * `focus` يعيد الترتيب فورًا؛ الجاري لا يُقطع.
 */
export function createQueue({ concurrency = 3 } = {}) {
  const jobs = new Map();
  let running = 0;
  let focusKey = null;
  let focusIndex = 0;
  const ranks = new Map();
  const listeners = new Set();
  const done = [];

  const priority = (job) => {
    const rank = ranks.get(job.chapterKey) ?? 3;
    const d = job.chapterKey === focusKey ? job.index - focusIndex : job.index;
    return rank * 100_000 + (d >= 0 ? d : -d * 3);
  };
  const next = () => {
    let best = null;
    for (const job of jobs.values()) if (!job.started && (!best || priority(job) < priority(best))) best = job;
    return best;
  };
  const pump = () => {
    while (running < concurrency) {
      const job = next();
      if (!job) return;
      job.started = true;
      running += 1;
      const t0 = Date.now();
      Promise.resolve()
        .then(job.run)
        .then(
          (value) => {
            done.push({ at: Date.now(), ms: Date.now() - t0 });
            job.resolve(value);
          },
          (error) => job.reject(error),
        )
        .finally(() => {
          running -= 1;
          jobs.delete(job.key);
          for (const fn of listeners) fn(job);
          pump();
        });
    }
  };
  return {
    /** وظيفة واحدة لكل مفتاح؛ الإضافة الثانية ترجع نفس الوعد. */
    add({ key, chapterKey, index, run }) {
      if (jobs.has(key)) return jobs.get(key).promise;
      let resolve;
      let reject;
      const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
      });
      jobs.set(key, { key, chapterKey, index, run, resolve, reject, promise, started: false });
      queueMicrotask(pump);
      return promise;
    },
    focus(chapterKey, index, chapterRanks = null) {
      focusKey = chapterKey;
      focusIndex = index;
      if (chapterRanks) {
        ranks.clear();
        for (const [k, r] of Object.entries(chapterRanks)) ranks.set(k, r);
      }
    },
    /** ترتيب الانتظار الحالي (للاختبار والعرض). */
    order: () => [...jobs.values()].filter((j) => !j.started).sort((a, b) => priority(a) - priority(b)).map((j) => j.key),
    pending: () => jobs.size,
    /** صفحات مترجمة في الدقيقة، من آخر عشر. */
    rate() {
      const recent = done.slice(-10);
      if (recent.length < 2) return 0;
      const span = Math.max(1, recent.at(-1).at - recent[0].at + recent[0].ms);
      return (recent.length / span) * 60_000;
    },
    onDone(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    drop(chapterKey) {
      for (const job of jobs.values()) if (!job.started && job.chapterKey === chapterKey) jobs.delete(job.key);
    },
  };
}

// ───────────────────────── الصورة والشبكة ─────────────────────────

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });

/** بصمة الصفحة من بايتات صورتها كما جاءت من المصدر — لا من إعادة ترميزنا. */
export async function pageHashOf(src) {
  const bytes = await (await fetch(src)).arrayBuffer();
  return sha256Hex(bytes);
}

/** القطعة `i` مصغّرةً كـJPEG base64. */
function encodeTile(img, plan, tile) {
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = tile.h;
  const g = canvas.getContext('2d');
  g.drawImage(img, 0, tile.y / plan.scale, img.naturalWidth, tile.h / plan.scale, 0, 0, plan.width, tile.h);
  return canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
}

/**
 * يترجم صفحة. `meta`: `{ seriesRef, seriesTitle, chapterKey, chapterNumber, pageIndex, sourceLang }`.
 * @returns {Promise<{ regions, width, height, summary, hash } | { error: string }>}
 */
export async function translatePage(sync, src, meta) {
  const hash = await pageHashOf(src);
  const local = (await readKv(CACHE_PREFIX + hash))?.value;
  if (local?.regions) return { ...local, hash, from: 'device' };

  const img = await loadImage(src);
  const plan = tilePlan(img.naturalWidth, img.naturalHeight);
  const results = [];
  for (let i = 0; i < plan.tiles.length; i += 1) {
    // صفحة من قطعة واحدة = بصمتها؛ قطعة من شريط: بصمتها من بصمة الصفحة وموضعها
    const h = plan.tiles.length === 1 ? hash : await sha256Hex(new TextEncoder().encode(`${hash}:${i}:${plan.width}:${plan.tiles[i].y}:${plan.tiles[i].h}`));
    const cached = await sync.translation(`/v1/translate/cached?hashes=${h}`);
    const hit = cached.status === 200 ? cached.body?.pages?.[h] : null;
    if (hit) {
      results.push(hit);
      continue;
    }
    const res = await sync.translation('/v1/translate/page', {
      method: 'POST',
      body: {
        ...meta,
        pageHash: h,
        image: { mediaType: 'image/jpeg', data: encodeTile(img, plan, plan.tiles[i]), width: plan.width, height: plan.tiles[i].h },
      },
    });
    if (res.status !== 200) return { error: res.body?.error ?? `http_${res.status}` };
    results.push(res.body);
  }
  const value = {
    width: img.naturalWidth,
    height: img.naturalHeight,
    regions: mergeTiles(plan, results),
    summary: results.map((r) => r.summary).filter(Boolean).join(' '),
  };
  void writeKv(CACHE_PREFIX + hash, value);
  return { ...value, hash, from: results.every((r) => r.cached) ? 'friends' : 'model' };
}

/** رسالة لسبب الرفض، بكلام الناس. */
export const TRANSLATE_ERRORS = {
  translation_not_configured: 'الترجمة غير مفعّلة على الخادم بعد',
  weekly_limit: 'خلّصت ترجمة هالأسبوع — تتجدد الخميس 5 العصر بتوقيت مكة',
  no_credit: 'خلص رصيد الترجمة — الفصول المترجمة قبل تشتغل',
  busy: 'الترجمة مشغولة الحين، نحاول بعد شوي',
  offline: 'ما فيه اتصال — الصفحات المترجمة قبل تشتغل',
  refused: 'هالصفحة ما انترجمت',
};
