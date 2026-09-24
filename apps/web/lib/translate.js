/**
 * محرّك الترجمة — جانب الجوال.
 *
 * الصفحة → بصمة من بايتات صورتها الأصلية (نفس الصورة عند صديقك = نفس البصمة =
 * نفس الترجمة) → الذاكرة المحلية → وإلا تُرسل كاملةً إلى خادم المحتوى
 * `/v1/translate/page`، حيث عامل الترجمة على جهاز البيت يكشف الفقاعات ويقرأ
 * النص ويبيّضه ويكتب العربي في مكانه، ويرجع **الصفحة المترجمة صورةً** مع
 * المناطق. القارئ يبدّل الصورة لا يرسم فوقها: لا هندسة على الجوال.
 *
 * الجدولة طابور أولويات حيّ: الفصل الحالي ثم التالي ثم السابق، والصفحات
 * بقربها من موضعك لا بترتيبها. تقترب من صفحة لم تُترجم؟ تعود للمقدّمة.
 *
 * الدوال الخالصة (العتبة، الطابور، تصغير الإرسال) تُختبر بلا جهاز.
 */

import { readKv, writeKv } from './chapter-store.js';

/** أطول ضلع يُرسل: العامل يقصّ أكبر من هذا أصلًا، فلا نرفع ما سيُصغَّر. */
export const MAX_UPLOAD_EDGE = 4096;
/** أعرض من هذا لا يزيد الدقة المفيدة للكشف والقراءة، ويثقل الرفع. */
export const MAX_UPLOAD_WIDTH = 1600;
const CACHE_PREFIX = 'tl2:';

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

// ───────────────────────── الإرسال ─────────────────────────

/**
 * أبعاد الصورة كما تُرسل: العرض ≤ MAX_UPLOAD_WIDTH وأطول ضلع ≤ MAX_UPLOAD_EDGE،
 * بنسبة ثابتة. شريط ويبتون 800×12000 يُرسل كما هو عرضًا ويُقصّ طولًا عند
 * العامل بشرائح، فالطول لا يُصغَّر إلا حين يتجاوز الحدّ.
 */
export function uploadPlan(width, height, { maxWidth = MAX_UPLOAD_WIDTH, maxEdge = MAX_UPLOAD_EDGE } = {}) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const scale = Math.min(1, maxWidth / w, maxEdge / Math.max(w, h));
  return { scale, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
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

/** الصفحة مصغّرةً (إن لزم) كـJPEG base64 بلا بادئة. */
function encodePage(img, plan) {
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  canvas.getContext('2d').drawImage(img, 0, 0, plan.width, plan.height);
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
}

/**
 * ما يعود من العامل إلى ما يحفظه القارئ: صورة الصفحة المترجمة (data URL)
 * والمناطق وعدد المترجَم. صفحة بلا أي منطقة مترجمة (لا نص، أو مؤثرات فقط)
 * تبقى صورتها الأصلية: `image` فارغ يعني «اعرض الأصل».
 */
export function resultOf(body) {
  const translated = Number(body?.translated) || 0;
  return {
    image: translated > 0 && typeof body?.image === 'string' ? body.image : null,
    regions: Array.isArray(body?.regions) ? body.regions : [],
    translated,
    engine: body?.engine ?? null,
    cached: Boolean(body?.cached),
    error: body?.error ?? null,
  };
}

/**
 * يترجم صفحة عبر خادم المحتوى. `api(path, options)` نداء JSON بجلسة.
 * `meta`: `{ seriesRef, seriesTitle, chapterKey, chapterNumber, pageIndex, sourceLang }`.
 * @returns {Promise<{ image: string | null, regions, translated, hash, from } | { error: string }>}
 */
export async function translatePage(api, src, meta) {
  const hash = await pageHashOf(src);
  const local = (await readKv(CACHE_PREFIX + hash))?.value;
  if (local && typeof local.translated === 'number') return { ...local, hash, from: 'device' };

  const img = await loadImage(src);
  const plan = uploadPlan(img.naturalWidth, img.naturalHeight);
  let body;
  try {
    body = await api('/v1/translate/page', {
      method: 'POST',
      body: {
        ...meta,
        pageHash: hash,
        image: { mediaType: 'image/jpeg', data: encodePage(img, plan) },
      },
    });
  } catch (error) {
    if (!error?.status) return { error: 'offline' };
    return { error: error.code ?? `http_${error.status}` };
  }
  const result = resultOf(body);
  // خطأ من Luna (حدّ أسبوعي، رصيد، مفتاح): الصورة عادت بلا ترجمة؛ لا نحفظها كنتيجة
  if (result.error && !result.translated) return { error: result.error };
  const value = { image: result.image, regions: result.regions, translated: result.translated, engine: result.engine };
  void writeKv(CACHE_PREFIX + hash, value);
  return { ...value, hash, from: result.cached ? 'friends' : 'model' };
}

/** رسالة لسبب الرفض، بكلام الناس. */
export const TRANSLATE_ERRORS = {
  translation_not_configured: 'الترجمة غير مفعّلة على الخادم بعد',
  translation_worker_offline: 'جهاز الترجمة مطفّى الحين — الصفحات المترجمة قبل تشتغل',
  translation_worker: 'الترجمة تعثّرت على الخادم، نحاول بعد شوي',
  weekly_limit: 'خلّصت ترجمة هالأسبوع — تتجدد الخميس 5 العصر بتوقيت مكة',
  no_credit: 'خلص رصيد الترجمة — الفصول المترجمة قبل تشتغل',
  busy: 'الترجمة مشغولة الحين، نحاول بعد شوي',
  offline: 'ما فيه اتصال — الصفحات المترجمة قبل تشتغل',
  refused: 'هالصفحة ما انترجمت',
};
