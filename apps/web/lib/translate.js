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
import { analyzePage, nativeTranslationAvailable, observeRefinements, releasePageReservation, renderPage, routePage } from './translation-native.js';
import { createTextBatcher } from './translate-batch.js';
import { canAcceptTranslationRepair } from './translation-repair-admission.js';
import { recordPerf, stopwatch } from './translate-perf.js';

/** أطول ضلع يُرسل للخادم: العامل يقصّ أكبر من هذا أصلًا. */
export const MAX_UPLOAD_EDGE = 4096;
/** أعرض من هذا لا يزيد الدقة المفيدة للكشف والقراءة، ويثقل الرفع. */
export const MAX_UPLOAD_WIDTH = 1600;
// لا يُغيَّر اسم الكاش مرة أخرى: تغييره يُخفي كل صفحة مترجمة محفوظة (tl3 → tl4 فعلها مرة).
const CACHE_PREFIX = 'tl4:';
const OLD_CACHE_PREFIX = 'tl3:';
/**
 * فهرس الصفحة المنطقي: كاش البصمة يبقى مصدر الحقيقة، لكن بعض مصادر الصور
 * تعيد ترميز البايتات نفسها أو تغيّر رابطها بين فتحتي الفصل. حينها SHA البايتات
 * يتغير رغم أن الصفحة نفسها، وكان القارئ يرجع للإنجليزي ويعيد 40–100 ثانية عملًا.
 *
 * المفتاح يشمل المصدر + الفصل + رقم الصفحة، فلا تختلط نسختان مختلفتان للعمل.
 * القيمة نفسها لها مهلة طويلة لكن محدودة؛ ملف الصورة المترجمة نفسه سيكشف إن اختفى.
 */
const PAGE_CACHE_PREFIX = 'tl-page-v1:';
export const PAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function pageCacheKey(meta) {
  const index = Number(meta?.pageIndex);
  if (!meta?.seriesRef || !meta?.sourceId || !meta?.chapterKey || !Number.isInteger(index) || index < 0) return null;
  return PAGE_CACHE_PREFIX + [meta.seriesRef, meta.sourceId, meta.chapterKey, index].map((v) => encodeURIComponent(String(v))).join('|');
}

async function readPageCache(hash, meta) {
  const direct = (await readKv(CACHE_PREFIX + hash))?.value ?? (await fromOldCache(hash));
  if (direct && typeof direct.translated === 'number') return { value: direct, cacheKey: pageCacheKey(meta), kind: 'hash' };
  const cacheKey = pageCacheKey(meta);
  if (!cacheKey) return { value: null, cacheKey: null, kind: null };
  const alias = (await readKv(cacheKey))?.value;
  if (!alias || typeof alias.translated !== 'number') return { value: null, cacheKey, kind: null };
  if (Date.now() - Number(alias.at ?? 0) > PAGE_CACHE_TTL_MS) {
    void writeKv(cacheKey, null);
    return { value: null, cacheKey, kind: null };
  }
  return { value: alias, cacheKey, kind: 'page' };
}

function writePageCache(hash, meta, value) {
  const cacheKey = pageCacheKey(meta);
  const stored = { ...value, sourceHash: hash };
  const writes = [writeKv(CACHE_PREFIX + hash, stored)];
  if (cacheKey) writes.push(writeKv(cacheKey, stored));
  return { cacheKey, stored, written: Promise.all(writes) };
}
/** بين محاولتي إكمال لنفس الصفحة: تعود للفصل بعد دقيقة فيُكمل الناقص فورًا. */
export const RETRY_INCOMPLETE_MS = 60 * 1000;
/** محاولات إكمال صفحة ناقصة قبل أن تُقبل كما هي. */
const MAX_REPAIRS = 3;
/**
 * إصدار تعليمات Luna للمسار النصي — يطابق `TEXT_PROMPT_VERSION` في
 * `services/sync-worker/src/translate.ts` (اختبار يتحقق). ترجمة محفوظة بإصدار
 * أقدم تُعرض فورًا وتُجدَّد في الخلفية حين تزور صفحتها.
 */
export const TEXT_PROMPT_VERSION = 4;

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
export function createQueue({ concurrency = 3, prepareConcurrency = 1, maxPrepared = 24, bypassConcurrency = 2 } = {}) {
  const jobs = new Map();
  let running = 0;
  let preparing = 0;
  let bypassRunning = 0;
  let focusedBurstRunning = 0;
  let focusKey = null;
  let focusIndex = 0;
  let lastIndex = null;
  const ranks = new Map();
  const listeners = new Set();
  const isFocused = job => job.chapterKey === focusKey && job.index === focusIndex;
  const isNearForward = job => job.chapterKey === focusKey && job.index >= focusIndex && job.index <= focusIndex + 3;

  // القارئ السريع لا يرمي الصفحة التي عبرها خلف فصل كامل:
  // الحالية + الثلاث التالية، ثم أقرب الصفحات الفائتة خلفك، ثم بقية الحالي.
  const priority = (job) => {
    const rank = ranks.get(job.chapterKey) ?? 3;
    if (job.chapterKey !== focusKey) return rank * 1_000_000 + Math.max(0, job.index);
    const d = job.index - focusIndex;
    if (d === 0) return rank * 1_000_000;
    if (d > 0 && d <= 3) return rank * 1_000_000 + d;
    if (d < 0) return rank * 1_000_000 + 10 + (-d);
    return rank * 1_000_000 + 100 + d;
  };
  const next = (predicate) => {
    let best = null;
    for (const job of jobs.values()) if (!job.started && predicate(job) && (!best || priority(job) < priority(best))) best = job;
    return best;
  };
  const finish = (job) => {
    jobs.delete(job.key);
    for (const fn of listeners) fn(job);
    pump();
  };
  const start = (job, bypass = false, focusedBurst = false) => {
    job.started = true;
    if (bypass) bypassRunning++;
    else if (focusedBurst) { focusedBurstRunning++; job.burst = true; }
    else running++;
    Promise.resolve().then(() => job.run({ waitedMs: Math.max(0,Date.now() - job.addedAt-(job.prepareMs ?? 0)),prepareMs:job.prepareMs ?? 0,
      prepared: job.prepared, interactive: isFocused(job), isInteractive: () => isFocused(job) }))
      .then(job.resolve, job.reject).finally(() => {
        if (bypass) bypassRunning--;
        else if (focusedBurst) focusedBurstRunning--;
        else running--;
        finish(job);
      });
  };
  const pump = () => {
    while (bypassRunning < bypassConcurrency) {
      const job = next(j => j.ready && j.prepared?.bypass);
      if (!job) break;
      start(job,true);
    }
    while (true) {
      const job = next(j => !j.prepare || (j.ready && !j.prepared?.bypass));
      if (!job) break;
      const normalSlot = running < concurrency;
      // الصفحة المرئية تستطيع تجاوز slot واحد فقط. لا نسمح لتمرير سريع
      // بتحويل 8 slots إلى عشرات الأعمال المعلقة في Luna/Native.
      const burstSlot = concurrency > 0 && isFocused(job) && focusedBurstRunning < 1 &&
        running + focusedBurstRunning < concurrency + 1;
      if (!normalSlot && !burstSlot) break;
      start(job, false, !normalSlot);
    }
    const readyCount = () => [...jobs.values()].filter(j => j.ready && !j.started).length;
    while (true) {
      const job = next(j => j.prepare && !j.ready && !j.preparing);
      if (!job) break;
      // لا نحجز أول/آخر الفصل. فقط الحالية والثلاث أمامها لها admission
      // إضافي محدود، حتى لا يتكدس detector أثناء فصل ثقيل.
      const near = isNearForward(job);
      const preparingNear = [...jobs.values()].filter(j => j.preparing && isNearForward(j)).length;
      if ((near ? preparingNear >= 2 || preparing >= prepareConcurrency + 1 : preparing >= prepareConcurrency) ||
          readyCount() + preparing >= maxPrepared + (near ? 1 : 0)) break;
      job.preparing = true; preparing++;
      const preparedAt=Date.now();
      Promise.resolve().then(() => job.prepare()).then(prepared => {
        if (jobs.get(job.key) !== job) return;
        job.prepareMs=Date.now()-preparedAt; job.prepared = prepared; job.ready = true;
        if (prepared?.bypass && bypassRunning < bypassConcurrency) start(job, true);
      }, error => { if (jobs.get(job.key) === job) { job.reject(error); jobs.delete(job.key); } })
        .finally(() => { preparing--; job.preparing = false; pump(); });
    }
  };
  return {
    /** وظيفة واحدة لكل مفتاح؛ الإضافة الثانية ترجع نفس الوعد. */
    add({ key, chapterKey, index, run, prepare }) {
      const existing = jobs.get(key);
      if (existing) {
        // مهمة لم تبدأ من جلسة قارئ سابقة: يأخذها صاحبها الجديد، فلا يرث وعدًا ميتًا
        if (!existing.started) { existing.run = run; if (!existing.preparing && !existing.ready) existing.prepare = prepare; }
        return existing.promise;
      }
      let resolve;
      let reject;
      const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
      });
      jobs.set(key, { key, chapterKey, index, run, prepare, resolve, reject, promise, started: false, addedAt: Date.now() });
      queueMicrotask(pump);
      return promise;
    },
    focus(chapterKey, index, chapterRanks = null, { pageCount = null } = {}) {
      focusKey = chapterKey;
      focusIndex = index;
      lastIndex = Number.isInteger(pageCount) && pageCount > 0 ? pageCount - 1 : null;
      if (chapterRanks) {
        ranks.clear();
        for (const [k, r] of Object.entries(chapterRanks)) ranks.set(k, r);
      }
      // A page can already be waiting when the user scrolls onto it. Re-run
      // admission now so one bounded focused burst can bypass stale slots.
      queueMicrotask(pump);
    },
    /** ترتيب الانتظار الحالي (للاختبار والعرض). */
    order: () => [...jobs.values()].filter((j) => !j.started).sort((a, b) => priority(a) - priority(b)).map((j) => j.key),
    pending: () => jobs.size,
    onDone(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    drop(chapterKey) {
      for (const job of jobs.values()) if (!job.started && job.chapterKey === chapterKey) { jobs.delete(job.key); job.resolve(null); }
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
    regions.push({ id: r.id, arabic: hit.arabic.trim(), kind: hit.kind ?? r.kind, source: hit.source ?? r.source, ...(hit.lettering ? { lettering: hit.lettering } : {}) });
  }
  return regions;
}

/**
 * يترجم صفحة.
 *   `deps`: `{ api, sync, imagePath }` — `api` نداء خادم المحتوى، `sync.translation`
 *   نداء sync-worker، `imagePath` مسار ملف الصفحة على الجهاز (من الإضافة) إن وُجد.
 *   `meta`: `{ seriesRef, seriesTitle, sourceId, chapterKey, chapterNumber, pageIndex, sourceLang }`.
 * @returns {Promise<{ image: string | null, regions, translated, hash, from } | { error: string }>}
 */
/** صفحات القارئ الجارية: الترجمة المقدّمة لا تبدأ صفحة جديدة وهي تعمل (النت للصفحة أمامك). */
let readerBusy = 0;
let readerLastAt = 0;

/** ينتظر حتى يهدأ القارئ (لا صفحة له منذ ثانيتين). تناديه الترجمة المقدّمة قبل كل صفحة. */
export async function readerQuiet({ sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  while (readerBusy > 0 || now() - readerLastAt < 2000) await sleep(500);
}

export function classifyTranslationError(error, online = globalThis.navigator?.onLine) {
  if (online === false) return 'offline';
  const name=String(error?.name ?? '').toLowerCase();
  const message=String(error?.message ?? error ?? '').toLowerCase();
  if (name === 'aborterror' || message.includes('abort') || message.includes('cancel')) return 'aborted';
  if (message === 'image' || message.includes('image fetch') || message.includes('image load')) return 'image_fetch_failed';
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('bridge') || message.includes('capacitor') || message.includes('native')) return 'native_bridge_failed';
  return 'reader_exception';
}

export async function translatePage(deps, src, meta) {
  if (deps.via !== 'reader') return translatePageNow(deps, src, meta);
  readerBusy += 1;
  try {
    return await translatePageNow(deps, src, meta);
  } finally {
    readerBusy -= 1;
    readerLastAt = Date.now();
  }
}

async function translatePageNow(deps, src, meta) {
  const clock = stopwatch();
  // القارئ يمرر convertFileSrc لا imagePath صريحًا. حفظ المسار المشتق هنا يصلح
  // تشخيص «اختبر التبييض» ويجعل سجل الصفحة قادرًا على إعادة تشغيل نماذج أندرويد.
  const imagePath = deps.imagePath ?? filePathFromSrc(src);
  let runDeps = imagePath && deps.imagePath !== imagePath ? { ...deps, imagePath } : deps;
  if(deps.prepareMs) clock.stages.prepare=deps.prepareMs;
  const hash = await clock.time('hash', () => pageHashOf(src));
  if(runDeps.route && runDeps.route.pageHash!==hash) runDeps={...runDeps,route:null};
  const found = await clock.time('cacheRead', () => readPageCache(hash, meta));
  const local = found.value;
  // طلبتَ «ذكية» والمحفوظ «سريعة»: يُترجم من جديد. والعكس يأخذ الذكية المحفوظة (أدق وبلا تكلفة)
  const downgraded = meta?.speed !== 'fast' && typeof local?.engine === 'string' && local.engine.endsWith(':fast');
  if (local && typeof local.translated === 'number' && !downgraded && !(deps.via === 'job' && local.incomplete)) {
    // نتيجة وُجدت ببصمة البايتات تُفهرس أيضًا بعنوان الصفحة الثابت؛ بهذا إعادة فتح
    // الفصل لا تعتمد على أن CDN أعاد البايتات نفسها حرفيًا.
    if (found.kind === 'hash' && found.cacheKey) void writeKv(found.cacheKey, { ...local, sourceHash: hash });
    const due = (local.incomplete || staleEngine(local.engine)) && (local.tries ?? 0) < MAX_REPAIRS && Date.now() - (local.at ?? 0) > RETRY_INCOMPLETE_MS;
    if (due) void repairInBackground(runDeps, src, hash, meta, local);
    logPage(runDeps, meta, hash, clock, {
      from: 'cache',
      cacheKind: found.kind,
      cacheKey: found.cacheKey,
      textless: !local.translated && !(local.regions ?? []).length,
      regions: (local.regions ?? []).length,
      translated: local.translated,
      incomplete: Boolean(local.incomplete),
      engine: local.engine ?? null,
    });
    return { ...local, hash, cacheKey: found.cacheKey, from: 'device', saved: true };
  }

  // الصفحة نفسها من القارئ والترجمة المقدّمة معًا: تُترجم مرة، والثاني ينتظر الأول
  const running = inflight.get(hash);
  if (running) return running;
  const job = translateOnce(runDeps, src, hash, meta, clock);
  inflight.set(hash, job);
  try {
    return await job;
  } finally {
    inflight.delete(hash);
  }
}

/** صفحات تُترجم الآن ببصمتها (للجهاز كله: القارئ والترجمة المقدّمة). */
const inflight = new Map();

const refinementTargets = new Map();
const earlyRefinements = new Map();
const convertedPath = path => globalThis.Capacitor?.convertFileSrc ? globalThis.Capacitor.convertFileSrc(path) : path;
async function acceptRefinement(event) {
  const target = refinementTargets.get(event?.previewPath);
  if (!target) {
    if (event?.previewPath) {
      earlyRefinements.set(event.previewPath,event);
      if (earlyRefinements.size > 32) earlyRefinements.delete(earlyRefinements.keys().next().value);
    }
    return;
  }
  refinementTargets.delete(event.previewPath);
  const current = (await readKv(CACHE_PREFIX + target.hash))?.value;
  if (!current || current.image !== convertedPath(event.previewPath) || current.at !== target.value.at) return;
  const saved = writePageCache(target.hash,target.meta,{...current,image:convertedPath(event.path)});
  if ((await saved.written).every(key => typeof key === 'string')) target.deps.onRepaired?.({...saved.stored,hash:target.hash,cacheKey:saved.cacheKey,from:'device',saved:true});
}

function registerRefinement(deps,hash,meta,result,saved,persisted) {
  if (persisted && result.refinementPath) {
    refinementTargets.set(result.refinementPath,{deps,hash,meta,value:saved.stored});
    if (refinementTargets.size > 32) refinementTargets.delete(refinementTargets.keys().next().value);
    const event=earlyRefinements.get(result.refinementPath);
    if (event) { earlyRefinements.delete(result.refinementPath); void acceptRefinement(event); }
  }
}

async function translateOnce(deps, src, hash, meta, clock) {
  const result = await translateFresh(deps, src, hash, meta, clock);
  if (result.error) {
    logPage(deps, meta, hash, clock, { from: 'error', error: result.error, native: result.native });
    return result;
  }
  const value = { image: result.image, regions: result.regions, translated: result.translated, engine: result.engine, incomplete: Boolean(result.incomplete), at: Date.now(), tries: 0 };
  const saved = writePageCache(hash, meta, value);
  const persisted = (await saved.written).every(key => typeof key === 'string');
  registerRefinement(deps,hash,meta,result,saved,persisted);
  logPage(deps, meta, hash, clock, {
    from: result.cached ? 'friends' : 'model',
    cacheKey: saved.cacheKey,
    textless: Boolean(result.textless),
    regions: (result.regions ?? []).length,
    translated: result.translated,
    incomplete: Boolean(result.incomplete),
    engine: result.engine ?? null,
    native: result.native,
    saved: persisted,
  }, saved.written);
  // Partial output is useful immediately, but it is not "done": start one repair
  // pass now so residual/coverage rescue can complete while the reader is still here.
  if (persisted && result.incomplete && (value.tries ?? 0) < MAX_REPAIRS) {
    queueMicrotask(() => void repairInBackground(deps, src, hash, meta, saved.stored));
  }
  return { ...saved.stored, hash, cacheKey: saved.cacheKey, from: result.cached ? 'friends' : 'model', saved: persisted, stages: { wait: deps.waitMs ?? 0, fetch: deps.fetchMs ?? 0, ...clock.stages }, ...(deps.via === 'job' && !persisted ? { error: 'storage_failed' } : {}) };
}

/** سطر في سجل الأداء (الانتظار في الطابور وجلب الصورة يأتيان من القارئ أو المهام). */
function logPage(deps, meta, hash, clock, extra, written = null) {
  const record = (cacheWrite) => {
    const stages = { wait: deps.waitMs ?? 0, fetch: deps.fetchMs ?? 0, ...clock.stages, ...(cacheWrite === null ? {} : { cacheWrite }) };
    const total = Object.values(stages).reduce((a, b) => a + (Number(b) || 0), 0);
    recordPerf({ at: Date.now(), runId: deps.runId ?? meta?.runId ?? null, via: deps.via ?? null, chapterKey: meta?.chapterKey ?? null, pageIndex: meta?.pageIndex ?? null, hash, path: deps.imagePath ?? null, speed: meta?.speed ?? 'smart', total, stages, ...extra });
  };
  if (!written) return record(null);
  const t = Date.now();
  void Promise.resolve(written).then(
    () => record(Date.now() - t),
    () => record(Date.now() - t),
  );
}

async function translateFresh(deps, src, hash, meta, clock = stopwatch()) {
  const imagePath = deps.imagePath ?? filePathFromSrc(src);
  if (nativeTranslationAvailable() && imagePath) await observeRefinements(acceptRefinement);
  return nativeTranslationAvailable() && imagePath ? translateOnDevice({ ...deps, imagePath }, hash, meta, clock) : translateViaServer(deps, src, hash, meta);
}

/** إكمال صفحة ناقصة بلا إخفاء الموجود. نجح بأفضل: يُحفظ ويُبلَّغ القارئ (`deps.onRepaired`). */
async function repairInBackground(deps, src, hash, meta, local) {
  const tries = (local.tries ?? 0) + 1;
  // يُعلَّم أولًا فلا تبدأ محاولتان معًا لنفس الصفحة
  await writePageCache(hash, meta, { ...local, at: Date.now(), tries }).written;
  const clock = stopwatch();
  const result = await translateFresh({ ...deps, waitMs: 0, fetchMs: 0, via: 'repair' }, src, hash, meta, clock)
    .catch(error => ({ error: classifyTranslationError(error) }));
  logPage({ ...deps, waitMs: 0, fetchMs: 0 }, meta, hash, clock, { from: 'repair', error: result.error ?? null, incomplete: Boolean(result.incomplete), translated: result.translated ?? 0, regions: (result.regions ?? []).length, native: result.native });
  if (!canAcceptTranslationRepair(local, result)) return;
  const value = { image: result.image, regions: result.regions, translated: result.translated, engine: result.engine, incomplete: Boolean(result.incomplete), at: Date.now(), tries };
  const saved = writePageCache(hash, meta, value);
  const persisted=(await saved.written).every(key => typeof key === 'string');
  if (!persisted) return;
  registerRefinement(deps,hash,meta,result,saved,persisted);
  deps.onRepaired?.({ ...saved.stored, hash, cacheKey: saved.cacheKey, from: 'model' });
}

/** الصفحة التي أمام القارئ أولًا على المعالج؛ المقدّمة والإكمال بعدها. */
const interactiveOf = deps => deps.via === 'job' || deps.via === 'repair' ? false : deps.isInteractive?.() ?? deps.interactive ?? true;
const priorityOf = deps => interactiveOf(deps) ? 'high' : 'low';

const textBatchers = new WeakMap();
function textBatcher(sync) {
  if (!textBatchers.has(sync)) textBatchers.set(sync, createTextBatcher((path,body) => sync.translation(path,{method:'POST',body}),{waitMs:200,maxInFlight:6,adaptive:true}));
  return textBatchers.get(sync);
}

export async function prepareTranslation(src, meta) {
  const path=filePathFromSrc(src);
  if (!path || !nativeTranslationAvailable()) return {src};
  const hash=await pageHashOf(src);
  const cached=(await readPageCache(hash,meta)).value;
  if (cached && !cached.incomplete && !staleEngine(cached.engine) && !(meta.speed!=='fast' && cached.engine?.endsWith(':fast'))) return {src,bypass:true};
  const route=await routePage({path,chapterKey:meta.chapterKey,pageIndex:meta.pageIndex});
  return {src,route,bypass:Boolean(route?.textless)};
}

async function translateOnDevice(deps, hash, meta, clock) {
  let analysis;
  try {
    analysis = deps.route?.textless ? {...deps.route,regions:[],thumbnail:''} : await clock.time('analyze', () => analyzePage({ path: deps.imagePath, sourceLang: meta.sourceLang ?? 'auto', priority: priorityOf(deps), chapterKey: meta.chapterKey, pageIndex: meta.pageIndex,routeHash:deps.route?.pageHash }));
  } catch (error) {
    return { error: String(error?.message ?? '').includes('models') ? 'models_missing' : 'device_failed' };
  }
  const native = { analyze: analysis.perf ?? null, ...(deps.route?.perf?{route:deps.route.perf}:{}) };
  const readable = (analysis.regions ?? []).filter((r) => r.status === 'pending' && r.source);
  const coverageUnknown = Number(analysis.coverageUnknown ?? analysis.perf?.counts?.coverageUnknown ?? 0);
  const textless = !(analysis.regions ?? []).length && coverageUnknown === 0;
  if (!readable.length) return { incomplete: !textless || coverageUnknown > 0, image: null, regions: analysis.regions ?? [], translated: 0, engine: 'device', cached: false, error: null, textless, native };

  // analyzePage في القارئ يحجز المسار الثقيل لهذه الصفحة حتى يعود Luna ثم يبدأ
  // Render. إذا لم نصل إلى Render لأي سبب يجب تحرير الحجز في finally.
  let renderCompleted = false;
  try {
    // أولًا بلا صورة: صفحة ترجمتَها قبل (أو صديق) ترجع بلا رفع — على نت ضعيف هذا الفرق كله.
    // الخادم يردّ need_image (أو bad_image الأقدم) لصفحة جديدة، فتُرسل بمصغّرتها
    const bodyFor = data => ({
      ...meta, pageHash: hash,
      image: { mediaType: 'image/jpeg', data, width: analysis.width, height: analysis.height },
      regions: readable.map(r => ({ id: r.id, source: r.source, kind: r.kind, box: r.box })),
    });
    const ask = data => data
      ? textBatcher(deps.sync).enqueueTextPage(bodyFor(data), { interactive: interactiveOf(deps), signal: deps.signal })
      : deps.sync.translation('/v1/translate/text', { method:'POST', body:bodyFor('') });
    let res = await clock.time('cacheProbe', () => ask(''));
    if (res.status === 409 || (res.status === 400 && res.body?.error === 'bad_image')) {
      res = await clock.time('luna', () => ask(analysis.thumbnail ?? ''));
    }
    if (res.status !== 200) return { error: res.body?.error ?? `http_${res.status}`, native };
    const plan = renderPlan(analysis, res.body);
    let incomplete = unansweredIds(readable, res.body).length > 0 || (analysis.regions ?? []).some(r => r.status === 'skipped:unreadable');
    if (!plan.length) return { image: null, regions: analysis.regions ?? [], translated: 0, engine: res.body?.engine ?? 'device', cached: Boolean(res.body?.cached), incomplete, error: null, native };
    let rendered;
    try {
      rendered = await clock.time('render', () => renderPage({ path: deps.imagePath, regions: plan, leave: leftAsIs(res.body), priority: priorityOf(deps), chapterKey: meta.chapterKey, pageIndex: meta.pageIndex }));
      renderCompleted = true;
    } catch {
      return { error: 'device_failed', native };
    }
    native.render = rendered.perf ?? null;
    // المرسوم فعلًا كما يقوله الجهاز (عربي لم يدخل أو لم يظهر يبقى أصله): صفحة لم يُرسم
    // فيها شيء تبقى صورتها الأصلية، لا نسخة مبيّضة
    const drawn = Number.isFinite(rendered.translated) ? rendered.translated : plan.length;
    incomplete ||= drawn < plan.length ||
      Number(rendered.perf?.counts?.residualLatin ?? 0) > 0 ||
      Number(rendered.perf?.counts?.residualUnknown ?? 0) > 0 ||
      Number(rendered.perf?.counts?.residualRescueQueued ?? 0) > 0;
    if (!drawn) return { image: null, regions: analysis.regions ?? [], translated: 0, engine: res.body?.engine ?? 'device', cached: Boolean(res.body?.cached), incomplete, error: null, native };
    const convert = globalThis.Capacitor?.convertFileSrc;
    return {
      image: convert ? convert(rendered.path) : rendered.path,
      refinementPath: rendered.perf?.counts?.refinementPending ? rendered.path : null,
      regions: (analysis.regions ?? []).map((r) => ({ ...r, ...(plan.find((p) => p.id === r.id) ?? {}) })),
      translated: drawn,
      engine: res.body?.engine ?? 'device',
      cached: Boolean(res.body?.cached),
      incomplete,
      error: null,
      native,
    };
  } finally {
    // Render نفسه يستهلك الحجز ذريًا داخل PriorityGate. هذا النداء مهم فقط
    // لمسارات Luna error / no-plan / exception حتى لا تتوقف بقية الصفحات.
    if (!renderCompleted && priorityOf(deps) === 'high') {
      try { await releasePageReservation(meta.chapterKey, meta.pageIndex); } catch { /* APK قديم أو إغلاق الصفحة */ }
    }
  }
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
export async function cachedPage(hash, cacheKey = null) {
  const direct = hash ? (await readKv(CACHE_PREFIX + hash))?.value : null;
  if (direct) return direct;
  return cacheKey ? ((await readKv(cacheKey))?.value ?? null) : null;
}

/** صورة مترجمة محفوظة اختفت من الجهاز: امسح بصمة البايتات وفهرس الصفحة معًا. */
export async function forgetPage(hash, cacheKey = null, sourceHash = null) {
  const writes = [];
  if (hash) writes.push(writeKv(CACHE_PREFIX + hash, null), writeKv(OLD_CACHE_PREFIX + hash, null));
  if (sourceHash && sourceHash !== hash) writes.push(writeKv(CACHE_PREFIX + sourceHash, null), writeKv(OLD_CACHE_PREFIX + sourceHash, null));
  if (cacheKey) writes.push(writeKv(cacheKey, null));
  await Promise.all(writes);
}

/** ما قالت Luna إنه يبقى أصله عمدًا (مؤثر، حقوق، لافتة): ليس نقصًا في فقاعته. */
export function leftAsIs(reply) {
  return (reply?.regions ?? []).filter((r) => ['sfx', 'credit', 'sign'].includes(r.kind)).map((r) => r.id);
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
    if (!error?.status) return { error: classifyTranslationError(error) };
    return { error: error.code ?? `http_${error.status}` };
  }
  const result = resultOf(body);
  if (result.error && !result.translated) return { error: result.error };
  return result;
}

/** رسالة لسبب الرفض، بكلام الناس. */
export const TRANSLATE_ERRORS = {
  translation_locked: 'الترجمة قيد التطوير',
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
  image_fetch_failed: 'صورة الصفحة ما وصلت للمترجم — بنحاولها مرة ثانية',
  aborted: 'توقفت محاولة الترجمة لأن الصفحة تغيّرت — بنعيدها عند الحاجة',
  timeout: 'الترجمة أخذت وقتًا أطول من الحد — بنحاولها مرة ثانية',
  native_bridge_failed: 'اتصال التطبيق بمحرك الترجمة تعثّر لهالصفحة',
  reader_exception: 'حصل خطأ محلي في مسار الصفحة — بنحاولها مرة ثانية',
  refused: 'هالصفحة ما انترجمت',
};
