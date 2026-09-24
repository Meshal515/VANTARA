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
import { recordPerf, stopwatch } from './translate-perf.js';

/** أطول ضلع يُرسل للخادم: العامل يقصّ أكبر من هذا أصلًا. */
export const MAX_UPLOAD_EDGE = 4096;
/** أعرض من هذا لا يزيد الدقة المفيدة للكشف والقراءة، ويثقل الرفع. */
export const MAX_UPLOAD_WIDTH = 1600;
// لا يُغيَّر اسم الكاش مرة أخرى: تغييره يُخفي كل صفحة مترجمة محفوظة (tl3 → tl4 فعلها مرة).
const CACHE_PREFIX = 'tl4:';
const OLD_CACHE_PREFIX = 'tl3:';
/** بين محاولتي إكمال لنفس الصفحة: تعود للفصل بعد دقيقة فيُكمل الناقص فورًا. */
export const RETRY_INCOMPLETE_MS = 60 * 1000;
/** محاولات إكمال صفحة ناقصة قبل أن تُقبل كما هي. */
const MAX_REPAIRS = 3;
/**
 * إصدار تعليمات Luna للمسار النصي — يطابق `TEXT_PROMPT_VERSION` في
 * `services/sync-worker/src/translate.ts` (اختبار يتحقق). ترجمة محفوظة بإصدار
 * أقدم تُعرض فورًا وتُجدَّد في الخلفية حين تزور صفحتها.
 */
export const TEXT_PROMPT_VERSION = 2;

/** محرّك أقدم من التعليمات الحالية؟ (`model:t1`، `model:t1:fast`؛ 'device' = لا نص، لا يُجدَّد). */
export function staleEngine(engine) {
  const m = /:t(\d+)(?::fast)?$/.exec(String(engine ?? ''));
  return Boolean(m) && Number(m[1]) < TEXT_PROMPT_VERSION;
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

  // ترتيب ثابت لا يتبع سرعتك: من صفحتك للأمام بالترتيب، ثم ما خلفك (الأقرب أولًا)،
  // فلا تُترك صفحة عبرتها بسرعة. الفصل الحالي، ثم التالي، ثم السابق.
  const priority = (job) => {
    const rank = ranks.get(job.chapterKey) ?? 3;
    const d = job.chapterKey === focusKey ? job.index - focusIndex : job.index;
    return rank * 100_000 + (d >= 0 ? d : 50_000 - d);
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
      const waitedMs = Date.now() - job.addedAt;
      Promise.resolve()
        .then(() => job.run({ waitedMs }))
        .then(
          (value) => job.resolve(value),
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
      const existing = jobs.get(key);
      if (existing) {
        // مهمة لم تبدأ من جلسة قارئ سابقة: يأخذها صاحبها الجديد، فلا يرث وعدًا ميتًا
        if (!existing.started) existing.run = run;
        return existing.promise;
      }
      let resolve;
      let reject;
      const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
      });
      jobs.set(key, { key, chapterKey, index, run, resolve, reject, promise, started: false, addedAt: Date.now() });
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
  const clock = stopwatch();
  const hash = await clock.time('hash', pageHashOf(src));
  const local = await clock.time('cacheRead', (async () => (await readKv(CACHE_PREFIX + hash))?.value ?? (await fromOldCache(hash)))());
  // طلبتَ «ذكية» والمحفوظ «سريعة»: يُترجم من جديد. والعكس يأخذ الذكية المحفوظة (أدق وبلا تكلفة)
  const downgraded = meta?.speed !== 'fast' && typeof local?.engine === 'string' && local.engine.endsWith(':fast');
  if (local && typeof local.translated === 'number' && !downgraded) {
    // المحفوظ يُعرض دائمًا. وإن كانت فيه فقاعة ناقصة (أو تُرجم بتعليمات أقدم): يُكمل في
    // الخلفية (مرات محدودة) بلا إعادة الصفحة كلها: التحليل محفوظ على الجهاز، وما ردّت
    // عليه Luna محفوظ في الخادم، فلا يُسأل إلا عن الناقص. لا تعود للإنجليزي أثناءه أبدًا
    const due = (local.incomplete || staleEngine(local.engine)) && (local.tries ?? 0) < MAX_REPAIRS && Date.now() - (local.at ?? 0) > RETRY_INCOMPLETE_MS;
    if (due) void repairInBackground(deps, src, hash, meta, local);
    logPage(deps, meta, hash, clock, { from: 'cache', textless: !local.translated && !(local.regions ?? []).length, regions: (local.regions ?? []).length, translated: local.translated });
    return { ...local, hash, from: 'device' };
  }

  const result = await translateFresh(deps, src, hash, meta, clock);
  if (result.error) {
    logPage(deps, meta, hash, clock, { from: 'error', error: result.error, native: result.native });
    return result;
  }
  const value = { image: result.image, regions: result.regions, translated: result.translated, engine: result.engine, incomplete: Boolean(result.incomplete), at: Date.now(), tries: 0 };
  const written = writeKv(CACHE_PREFIX + hash, value);
  logPage(deps, meta, hash, clock, { from: result.cached ? 'friends' : 'model', textless: Boolean(result.textless), regions: (result.regions ?? []).length, translated: result.translated, native: result.native }, written);
  return { ...value, hash, from: result.cached ? 'friends' : 'model' };
}

/** سطر في سجل الأداء (الانتظار في الطابور وجلب الصورة يأتيان من القارئ أو المهام). */
function logPage(deps, meta, hash, clock, extra, written = null) {
  const record = (cacheWrite) => {
    const stages = { wait: deps.waitMs ?? 0, fetch: deps.fetchMs ?? 0, ...clock.stages, ...(cacheWrite === null ? {} : { cacheWrite }) };
    const total = Object.values(stages).reduce((a, b) => a + (Number(b) || 0), 0);
    recordPerf({ at: Date.now(), chapterKey: meta?.chapterKey ?? null, pageIndex: meta?.pageIndex ?? null, hash, path: deps.imagePath ?? null, speed: meta?.speed ?? 'smart', total, stages, ...extra });
  };
  if (!written) return record(null);
  const t = Date.now();
  void Promise.resolve(written).then(
    () => record(Date.now() - t),
    () => record(Date.now() - t),
  );
}

function translateFresh(deps, src, hash, meta, clock = stopwatch()) {
  const imagePath = deps.imagePath ?? filePathFromSrc(src);
  return nativeTranslationAvailable() && imagePath ? translateOnDevice({ ...deps, imagePath }, hash, meta, clock) : translateViaServer(deps, src, hash, meta);
}

/** إكمال صفحة ناقصة بلا إخفاء الموجود. نجح بأفضل: يُحفظ ويُبلَّغ القارئ (`deps.onRepaired`). */
async function repairInBackground(deps, src, hash, meta, local) {
  const tries = (local.tries ?? 0) + 1;
  // يُعلَّم أولًا فلا تبدأ محاولتان معًا لنفس الصفحة
  await writeKv(CACHE_PREFIX + hash, { ...local, at: Date.now(), tries });
  const clock = stopwatch();
  const result = await translateFresh({ ...deps, waitMs: 0, fetchMs: 0 }, src, hash, meta, clock).catch(() => ({ error: 'offline' }));
  logPage({ ...deps, waitMs: 0, fetchMs: 0 }, meta, hash, clock, { from: 'repair', error: result.error ?? null, translated: result.translated ?? 0, regions: (result.regions ?? []).length, native: result.native });
  if (result.error || !(result.translated >= (local.translated ?? 0))) return;
  const value = { image: result.image, regions: result.regions, translated: result.translated, engine: result.engine, incomplete: Boolean(result.incomplete), at: Date.now(), tries };
  await writeKv(CACHE_PREFIX + hash, value);
  deps.onRepaired?.({ ...value, hash, from: 'model' });
}

async function translateOnDevice(deps, hash, meta, clock) {
  let analysis;
  try {
    analysis = await clock.time('analyze', analyzePage({ path: deps.imagePath, sourceLang: meta.sourceLang ?? 'auto' }));
  } catch (error) {
    return { error: String(error?.message ?? '').includes('models') ? 'models_missing' : 'device_failed' };
  }
  const native = { analyze: analysis.perf ?? null };
  const readable = (analysis.regions ?? []).filter((r) => r.status === 'pending' && r.source);
  const textless = !(analysis.regions ?? []).length;
  if (!readable.length) return { image: null, regions: analysis.regions ?? [], translated: 0, engine: 'device', cached: false, error: null, textless, native };

  const res = await clock.time('luna', deps.sync.translation('/v1/translate/text', {
    method: 'POST',
    body: {
      ...meta,
      pageHash: hash,
      image: { mediaType: 'image/jpeg', data: analysis.thumbnail ?? '', width: analysis.width, height: analysis.height },
      regions: readable.map((r) => ({ id: r.id, source: r.source, kind: r.kind, box: r.box })),
    },
  }));
  if (res.status !== 200) return { error: res.body?.error ?? `http_${res.status}`, native };
  const plan = renderPlan(analysis, res.body);
  const incomplete = unansweredIds(readable, res.body).length > 0;
  if (!plan.length) return { image: null, regions: analysis.regions ?? [], translated: 0, engine: res.body?.engine ?? 'device', cached: Boolean(res.body?.cached), incomplete, error: null, native };
  let rendered;
  try {
    rendered = await clock.time('render', renderPage({ path: deps.imagePath, regions: plan }));
  } catch {
    return { error: 'device_failed', native };
  }
  native.render = rendered.perf ?? null;
  // المرسوم فعلًا كما يقوله الجهاز (عربي لم يدخل أو لم يظهر يبقى أصله): صفحة لم يُرسم
  // فيها شيء تبقى صورتها الأصلية، لا نسخة مبيّضة
  const drawn = Number.isFinite(rendered.translated) ? rendered.translated : plan.length;
  if (!drawn) return { image: null, regions: analysis.regions ?? [], translated: 0, engine: res.body?.engine ?? 'device', cached: Boolean(res.body?.cached), incomplete, error: null, native };
  const convert = globalThis.Capacitor?.convertFileSrc;
  return {
    image: convert ? convert(rendered.path) : rendered.path,
    regions: (analysis.regions ?? []).map((r) => ({ ...r, ...(plan.find((p) => p.id === r.id) ?? {}) })),
    translated: drawn,
    engine: res.body?.engine ?? 'device',
    cached: Boolean(res.body?.cached),
    incomplete,
    error: null,
    native,
  };
}

/**
 * صفحة حُفظت بالاسم القديم (tl3) قبل أن تُعرف «الناقصة». تُعرض فورًا بلا
 * ترجمة جديدة، وتُنقل للاسم الحالي. وإن كان فيها فقاعة مقروءة بلا عربي تُعلَّم
 * ناقصة، فتُكمَل في الخلفية وهي معروضة (والخادم يصلح الناقص مجانًا).
 */
async function fromOldCache(hash) {
  const old = (await readKv(OLD_CACHE_PREFIX + hash))?.value;
  if (!old || typeof old.translated !== 'number') return null;
  const incomplete = (old.regions ?? []).some((r) => r.status === 'pending' && r.source && !(typeof r.arabic === 'string' && r.arabic.trim()));
  const value = { ...old, incomplete, at: incomplete ? 0 : Date.now(), tries: 0 };
  void writeKv(CACHE_PREFIX + hash, value);
  return value;
}

/** المحفوظ لصفحة ببصمتها (للقياس: عربيّها يُعاد رسمه بالطريقين). */
export async function cachedPage(hash) {
  return hash ? ((await readKv(CACHE_PREFIX + hash))?.value ?? null) : null;
}

/** صورة مترجمة محفوظة اختفت من الجهاز (أندرويد ينظّف مجلد الكاش): تُنسى فتُترجم من جديد. */
export async function forgetPage(hash) {
  if (!hash) return;
  await Promise.all([writeKv(CACHE_PREFIX + hash, null), writeKv(OLD_CACHE_PREFIX + hash, null)]);
}

/** فقاعات مقروءة لم تأخذ عربيًا من Luna (المؤثر واللافتة والحقوق بلا عربي جواب صحيح). */
export function unansweredIds(readable, reply) {
  const byId = new Map((reply?.regions ?? []).map((r) => [r.id, r]));
  return readable
    .filter((r) => {
      const hit = byId.get(r.id);
      if (!hit) return true;
      return !(typeof hit.arabic === 'string' && hit.arabic.trim()) && !['sfx', 'credit', 'sign'].includes(hit.kind);
    })
    .map((r) => r.id);
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
  weekly_limit: 'خلّصت حصة الترجمة لهالأسبوع (5000 صفحة و100 فصل) — تتجدد الخميس 5 العصر بتوقيت مكة',
  monthly_budget: 'وصلت الترجمة لسقف الشهر للتطبيق كله — الصفحات المترجمة قبل تشتغل',
  no_credit: 'خلص رصيد الترجمة — الفصول المترجمة قبل تشتغل',
  busy: 'الترجمة مشغولة الحين، نحاول بعد شوي',
  offline: 'ما فيه اتصال — الصفحات المترجمة قبل تشتغل',
  refused: 'هالصفحة ما انترجمت',
};
