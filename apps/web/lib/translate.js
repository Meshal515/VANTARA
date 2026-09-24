/**
 * محرّك الترجمة — جانب الجوال.
 *
 * الصفحة → بصمة من بايتات صورتها الأصلية (نفس الصورة عند صديقك = نفس البصمة =
 * نفس الترجمة) → الذاكرة المحلية → وإلا:
 *
 *   على الجوال (الإضافة الأصلية `Translation` موجودة والنماذج منزَّلة):
 *     1. `analyzePage` داخل الجهاز: الفقاعات، قناع الحروف، OCR → مناطق بمعرّفات.
 *     2. sync-worker `/v1/translate/text`: Luna تصحّح القراءة وتترجم بالمعرّف
 *        (القاموس وذاكرة الفصل والحدّ الأسبوعي مع الحساب).
 *     3. `renderPage` داخل الجهاز: تبييض آمن + عربي في مكانه → ملف صورة.
 *
 *   على الويب (بلا إضافة): خادم المحتوى `/v1/translate/page` إن كان مضبوطًا،
 *   وإلا «الترجمة على الجوال متاحة في التطبيق».
 *
 * القارئ يبدّل الصورة لا يرسم فوقها: لا هندسة في JavaScript.
 *
 * الجدولة طابور أولويات حيّ: الفصل الحالي ثم التالي ثم السابق، والصفحات
 * بقربها من موضعك لا بترتيبها. تقترب من صفحة لم تُترجم؟ تعود للمقدّمة.
 */

import { readKv, writeKv } from './chapter-store.js';
import { analyzePage, nativeTranslationAvailable, renderPage } from './translation-native.js';

/** أطول ضلع يُرسل للخادم: العامل يقصّ أكبر من هذا أصلًا. */
export const MAX_UPLOAD_EDGE = 4096;
/** أعرض من هذا لا يزيد الدقة المفيدة للكشف والقراءة، ويثقل الرفع. */
export const MAX_UPLOAD_WIDTH = 1600;
const CACHE_PREFIX = 'tl3:';

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

// ───────────────────────── الإرسال (مسار الخادم) ─────────────────────────

/**
 * أبعاد الصورة كما تُرسل: العرض ≤ MAX_UPLOAD_WIDTH وأطول ضلع ≤ MAX_UPLOAD_EDGE،
 * بنسبة ثابتة.
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
 * ما يعود من العامل (خادم) إلى ما يحفظه القارئ: صورة الصفحة المترجمة (data URL)
 * والمناطق وعدد المترجَم. صفحة بلا أي منطقة مترجمة تبقى صورتها الأصلية.
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
 * مسار ملف الصفحة على الجهاز من رابط `convertFileSrc`
 * (`http://localhost/_capacitor_file_/data/…`)، أو null لرابط عادي.
 */
export function filePathFromSrc(src) {
  const m = /_capacitor_file_(\/.*)$/.exec(String(src ?? ''));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * ردّ Luna بالمعرّفات → ما يُرسل للرسم: المناطق التي لها عربي فقط.
 * المؤثرات والحقوق وما لم تردّ عليه Luna تبقى كما هي على الصفحة.
 */
export function renderPlan(analysis, reply) {
  const byId = new Map((reply?.regions ?? []).map((r) => [r.id, r]));
  const regions = [];
  for (const r of analysis?.regions ?? []) {
    const hit = byId.get(r.id);
    if (!hit || typeof hit.arabic !== 'string' || !hit.arabic.trim()) continue;
    if (hit.kind === 'sfx' || hit.kind === 'credit') continue;
    regions.push({ id: r.id, arabic: hit.arabic.trim(), kind: hit.kind ?? r.kind, source: hit.source ?? r.source });
  }
  return regions;
}

/**
 * يترجم صفحة.
 *   `deps`: `{ api, sync, imagePath }` — `api` نداء خادم المحتوى، `sync.translation`
 *   نداء sync-worker، `imagePath` مسار ملف الصفحة على الجهاز (من الإضافة) إن وُجد.
 *   `meta`: `{ seriesRef, seriesTitle, chapterKey, chapterNumber, pageIndex, sourceLang }`.
 * @returns {Promise<{ image: string | null, regions, translated, hash, from } | { error: string }>}
 */
export async function translatePage(deps, src, meta) {
  const hash = await pageHashOf(src);
  const local = (await readKv(CACHE_PREFIX + hash))?.value;
  if (local && typeof local.translated === 'number') return { ...local, hash, from: 'device' };

  const imagePath = deps.imagePath ?? filePathFromSrc(src);
  const result = nativeTranslationAvailable() && imagePath ? await translateOnDevice({ ...deps, imagePath }, hash, meta) : await translateViaServer(deps, src, hash, meta);
  if (result.error) return result;
  const value = { image: result.image, regions: result.regions, translated: result.translated, engine: result.engine };
  void writeKv(CACHE_PREFIX + hash, value);
  return { ...value, hash, from: result.cached ? 'friends' : 'model' };
}

async function translateOnDevice(deps, hash, meta) {
  let analysis;
  try {
    analysis = await analyzePage({ path: deps.imagePath, sourceLang: meta.sourceLang ?? 'auto' });
  } catch (error) {
    return { error: String(error?.message ?? '').includes('models') ? 'models_missing' : 'device_failed' };
  }
  const readable = (analysis.regions ?? []).filter((r) => r.status === 'pending' && r.source);
  if (!readable.length) return { image: null, regions: analysis.regions ?? [], translated: 0, engine: 'device', cached: false, error: null };

  const res = await deps.sync.translation('/v1/translate/text', {
    method: 'POST',
    body: {
      ...meta,
      pageHash: hash,
      image: { mediaType: 'image/jpeg', data: analysis.thumbnail ?? '', width: analysis.width, height: analysis.height },
      regions: readable.map((r) => ({ id: r.id, source: r.source, kind: r.kind, box: r.box })),
    },
  });
  if (res.status !== 200) return { error: res.body?.error ?? `http_${res.status}` };
  const plan = renderPlan(analysis, res.body);
  if (!plan.length) return { image: null, regions: analysis.regions ?? [], translated: 0, engine: res.body?.engine ?? 'device', cached: Boolean(res.body?.cached), error: null };
  let rendered;
  try {
    rendered = await renderPage({ path: deps.imagePath, regions: plan });
  } catch {
    return { error: 'device_failed' };
  }
  const convert = globalThis.Capacitor?.convertFileSrc;
  return {
    image: convert ? convert(rendered.path) : rendered.path,
    regions: (analysis.regions ?? []).map((r) => ({ ...r, ...(plan.find((p) => p.id === r.id) ?? {}) })),
    translated: plan.length,
    engine: res.body?.engine ?? 'device',
    cached: Boolean(res.body?.cached),
    error: null,
  };
}

async function translateViaServer(deps, src, hash, meta) {
  if (typeof deps.api !== 'function') return { error: 'device_only' };
  const img = await loadImage(src);
  const plan = uploadPlan(img.naturalWidth, img.naturalHeight);
  let body;
  try {
    body = await deps.api('/v1/translate/page', {
      method: 'POST',
      body: { ...meta, pageHash: hash, image: { mediaType: 'image/jpeg', data: encodePage(img, plan) } },
    });
  } catch (error) {
    if (!error?.status) return { error: 'offline' };
    return { error: error.code ?? `http_${error.status}` };
  }
  const result = resultOf(body);
  if (result.error && !result.translated) return { error: result.error };
  return result;
}

/** رسالة لسبب الرفض، بكلام الناس. */
export const TRANSLATE_ERRORS = {
  translation_not_configured: 'الترجمة غير مفعّلة على الخادم بعد',
  translation_worker_offline: 'جهاز الترجمة مطفّى الحين — الصفحات المترجمة قبل تشتغل',
  translation_worker: 'الترجمة تعثّرت على الخادم، نحاول بعد شوي',
  models_missing: 'ملفات الترجمة مو منزّلة — حمّلها من الإعدادات > الترجمة',
  device_failed: 'الترجمة تعثّرت على الجهاز لهالصفحة',
  device_only: 'الترجمة على الجوال متاحة في التطبيق فقط',
  weekly_limit: 'خلّصت ترجمة هالأسبوع — تتجدد الخميس 5 العصر بتوقيت مكة',
  no_credit: 'خلص رصيد الترجمة — الفصول المترجمة قبل تشتغل',
  busy: 'الترجمة مشغولة الحين، نحاول بعد شوي',
  offline: 'ما فيه اتصال — الصفحات المترجمة قبل تشتغل',
  refused: 'هالصفحة ما انترجمت',
};
