/**
 * سجل أداء الترجمة على الجوال نفسه: لكل صفحة زمن كل مرحلة من دخولها الطابور
 * إلى ظهور العربي — الانتظار، جلب الصورة، البصمة، الكاش، التحليل على الجهاز
 * (بمراحله: الكشف، الحروف، الفقاعات، OCR، تحميل النماذج…)، Luna والشبكة،
 * الرسم (التخطيط، المسح، LaMa، الترميز، الكتابة) وحفظ النتيجة.
 *
 * آخر 400 صفحة في localStorage. ملخّص للإعدادات وتقرير نصي يُنسخ.
 */

const KEY = 'vantara.translate.perf';
export const PERF_LIMIT = 400;

const safe = (storage) => storage ?? globalThis.localStorage;

export function readPerf(storage) {
  try {
    const list = JSON.parse(safe(storage)?.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordPerf(entry, storage) {
  if (!entry) return;
  const list = readPerf(storage);
  list.push(entry);
  try {
    safe(storage)?.setItem(KEY, JSON.stringify(list.slice(-PERF_LIMIT)));
  } catch {
    // قياس لا حقيقة
  }
}

export function clearPerf(storage) {
  try {
    safe(storage)?.removeItem(KEY);
  } catch {
    // لا شيء
  }
}

/** ساعة إيقاف لمراحل صفحة واحدة. */
export function stopwatch(now = () => (globalThis.performance?.now?.() ?? Date.now())) {
  const stages = {};
  let t = now();
  const start = t;
  return {
    stages,
    /** يسجّل الزمن منذ آخر علامة تحت اسم المرحلة. */
    lap(name) {
      const n = now();
      stages[name] = Math.round((stages[name] ?? 0) + (n - t));
      t = n;
    },
    /**
     * يقيس مرحلة من قبل أن تبدأ فعلًا. قبول دالة مهم: تمرير Promise جاهز كان
     * يبدأ fetch/الجسر قبل ضبط الساعة ويقصّ أول جزء من القياس.
     */
    async time(name, work) {
      t = now();
      try {
        return await (typeof work === 'function' ? work() : work);
      } finally {
        this.lap(name);
      }
    },
    total: () => Math.round(now() - start),
  };
}

const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  // كان يأخذ العنصر الأعلى عند عينتين؛ «وسيط 2 صفحة» كان عمليًا أبطأ صفحة،
  // وهذا بالغ في البطء الذي ظهر في تقرير الجهاز.
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
};

/** متوسط كل مرحلة (JS والأصلية) لمجموعة صفحات. */
function stageMeans(entries) {
  const acc = {};
  const add = (prefix, stages) => {
    for (const [k, v] of Object.entries(stages ?? {})) {
      if (typeof v !== 'number') continue;
      (acc[prefix + k] ??= []).push(v);
    }
  };
  for (const e of entries) {
    add('', e.stages);
    add('route.', e.native?.route?.stages);
    add('analyze.', e.native?.analyze?.stages);
    add('render.', e.native?.render?.stages);
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, mean(v)]));
}

function latestRunEntries(entries) {
  const last=[...entries].reverse().find(e => typeof e?.runId === 'string' && e.runId);
  return last ? entries.filter(e => e.runId === last.runId) : entries;
}

function uniqueFreshPages(entries) {
  const indexed=new Map();
  const loose=[];
  entries.forEach((e,i) => {
    if (!e?.chapterKey || !Number.isInteger(e.pageIndex)) { loose.push(e); return; }
    const key=`${e.chapterKey}#${e.pageIndex}`;
    const previous=indexed.get(key);
    // Never let a later partial retry downgrade an already complete accepted page.
    if (!previous || previous.incomplete || !e.incomplete) indexed.set(key,e);
  });
  return [...loose,...indexed.values()].sort((a,b)=>(a.at ?? 0)-(b.at ?? 0));
}

function overlayAcceptedRepairs(fresh, repairs) {
  const keyed=new Map();
  const loose=[];
  for(const e of fresh) {
    if(e?.chapterKey && Number.isInteger(e.pageIndex)) keyed.set(`${e.chapterKey}#${e.pageIndex}`,e);
    else loose.push(e);
  }
  for(const r of repairs.filter(e => e.accepted && !e.error)) {
    const key=r?.chapterKey && Number.isInteger(r.pageIndex) ? `${r.chapterKey}#${r.pageIndex}` : null;
    if(!key || !keyed.has(key)) continue;
    keyed.set(key,{...keyed.get(key),...r,from:keyed.get(key).from});
  }
  return [...loose,...keyed.values()].sort((a,b)=>(a.at ?? 0)-(b.at ?? 0));
}

/**
 * الملخّص: آخر run فقط، وصفحة منطقية واحدة لكل chapter/pageIndex.
 * Partial ليست نجاحًا؛ المحاولة الكاملة لا تُخفضها محاولة إصلاح لاحقة ناقصة.
 */
export function summarize(entries) {
  const scoped = latestRunEntries(entries);
  // «سرعة الصفحة» = صفحة منطقية جديدة واحدة، لا كل retry لنفس index.
  const initialFresh = uniqueFreshPages(scoped.filter((e) => !e.error && (e.from === 'model' || e.from === 'friends')));
  const cached = uniqueFreshPages(scoped.filter((e) => e.from === 'cache'));
  const errors = uniqueFreshPages(scoped.filter((e) => e.from === 'error'));
  const repairs = uniqueFreshPages(scoped.filter((e) => e.from === 'repair'));
  const fresh = overlayAcceptedRepairs(initialFresh, repairs);
  const textless = fresh.filter((e) => e.textless);
  const text = fresh.filter((e) => !e.textless);
  const chapters = new Map();
  for (const e of fresh) {
    if (!e.chapterKey) continue;
    const ch = chapters.get(e.chapterKey) ?? { chapterKey: e.chapterKey, pages: 0, first: Infinity, last: 0, work: 0 };
    ch.pages += 1;
    ch.first = Math.min(ch.first, e.at - (e.total ?? 0));
    ch.last = Math.max(ch.last, e.at);
    ch.work += e.total ?? 0;
    chapters.set(e.chapterKey, ch);
  }
  const errorCodes = {};
  for (const e of [...errors, ...repairs.filter((x) => x.error)]) {
    const code = e.error || 'unknown';
    errorCodes[code] = (errorCodes[code] ?? 0) + 1;
  }
  const complete=fresh.filter(e => !e.incomplete).length;
  const partial=fresh.length-complete;
  return {
    pages: fresh.length,
    complete,
    partial,
    cached: cached.length,
    errors: errors.length,
    repairs: repairs.length,
    repairErrors: repairs.filter((e) => e.error).length,
    errorCodes,
    textless: { pages: textless.length, median: median(textless.map((e) => e.total)), stages: stageMeans(textless) },
    text: { pages: text.length, median: median(text.map((e) => e.total)), stages: stageMeans(text) },
    chapters: [...chapters.values()].map((ch) => ({ chapterKey: ch.chapterKey, pages: ch.pages, wallMs: Math.round(ch.last - ch.first), workMs: ch.work })),
  };
}

const sec = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} ث`);

/** لا نسمي الصفحة «سريعة» لمجرد أن فيها Region سريع إذا شغلت CTD/BubbleSeg أيضًا. */
export function localRoute(counts = {}) {
  const fast = (counts.fastFlatRegions ?? 0) > 0 || (counts.fastFlatHit ?? 0) > 0;
  const heavy = (counts.heavyRegions ?? 0) > 0 || (counts.glyphTiles ?? 0) > 0 || (counts.bubbleTiles ?? 0) > 0;
  if (fast && heavy) return 'mixed';
  if (fast) return 'fast';
  if (heavy) return 'heavy';
  return 'light';
}

/** تقرير نصي يُنسخ ويُرسل كما هو. */
/** سطر لكل إعداد محرك: زمن الحروف والفقاعات، ومطابقة ناتجه للإعداد الحالي. */
export function engineLines(run) {
  if (!run?.engines?.length) return [];
  const lines = [`إعدادات CTD والفقاعات (${run.cores} أنوية، حرارة ${run.thermal}):`];
  for (const e of run.engines) {
    if (e.error) { lines.push(`  ${e.name}: تعذر القياس (${e.error})؛ المحرك الحالي محفوظ`); continue; }
    const same = e.glyphDiff === 0 && e.bubblesSame ? 'مطابق' : `مختلف: ${e.glyphDiff} بكسل حروف من ${e.glyphPixels}${e.bubblesSame ? '' : '، فقاعات مختلفة'}`;
    lines.push(`  ${e.name}: حروف ${sec(e.glyphsMs)} · فقاعات ${sec(e.bubblesMs)} · تحميل ${sec(e.loadMs)} · ${same}`);
  }
  return lines;
}

export function formatReport(entries, benchmarks = [], engines = null, cleaning = null) {
  const s = summarize(entries);
  const scoped = latestRunEntries(entries);
  const initialFresh = uniqueFreshPages(scoped.filter((e) => !e.error && (e.from === 'model' || e.from === 'friends')));
  const repairs = uniqueFreshPages(scoped.filter((e) => e.from === 'repair'));
  const fresh = overlayAcceptedRepairs(initialFresh, repairs);
  const lines = [`أداء الترجمة — ${s.complete} مكتملة، ${s.partial} جزئية، ${s.cached} من المحفوظ، ${s.errors} فشل، ${s.repairs} إصلاح`];
  if (Object.keys(s.errorCodes).length) lines.push(`الأخطاء: ${Object.entries(s.errorCodes).map(([k, v]) => `${k}×${v}`).join(' · ')}`);
  const modelPages = initialFresh.filter((e) => e.from === 'model' && !e.textless);
  const serverCachedPages = initialFresh.filter((e) => e.from === 'friends' && !e.textless);
  if (serverCachedPages.length && modelPages.length === 0) {
    lines.push(`اللغة في هذه الجولة: ${serverCachedPages.length} صفحة من كاش الخادم؛ لا يوجد نداء Luna جديد في السجل.`);
  } else if (serverCachedPages.length || modelPages.length) {
    lines.push(`اللغة في هذه الجولة: Luna جديد ${modelPages.length} · كاش الخادم ${serverCachedPages.length}.`);
  }

  // الدليل الأهم للتبييض: هل قناع المسح غيّر بكسلات فعلًا؟
  const analyzed = fresh.filter((e) => e.native?.analyze?.counts && !e.textless);
  const fastPages = analyzed.filter((e) => localRoute(e.native.analyze.counts) === 'fast').length;
  const mixedPages = analyzed.filter((e) => localRoute(e.native.analyze.counts) === 'mixed').length;
  const heavyPages = analyzed.filter((e) => localRoute(e.native.analyze.counts) === 'heavy').length;
  if (fastPages || mixedPages || heavyPages) {
    lines.push(`المسار المحلي: سريع بالكامل ${fastPages} صفحة · مختلط ${mixedPages} صفحة · ثقيل بالكامل ${heavyPages} صفحة.`);
  }
  const barrierPages = analyzed.filter((e) => (e.native.analyze.counts?.renderBarrierWait ?? 0) > 0).length;
  if (barrierPages) lines.push(`أولوية العرض: ${barrierPages} صفحة انتظرت Render الجاهز بدل بدء Analyze ثقيل جديد.`);

  const rendered = fresh.filter((e) => e.native?.render?.counts);
  const sumRender = (k) => rendered.reduce((a, e) => a + (e.native.render.counts?.[k] ?? 0), 0);
  const eraseMask = sumRender('eraseMaskPixels');
  const eraseChanged = sumRender('eraseChangedPixels');
  if (eraseMask > 0) {
    const pct = Math.round((eraseChanged / eraseMask) * 100);
    lines.push(`التبييض الفعلي: قناع ${eraseMask} بكسل · تغيّر ${eraseChanged} (${pct}%) · تعبئة ${sumRender('fillChangedPixels')} · LaMa ${sumRender('inpaintChangedPixels')} · no-op ${sumRender('eraseNoOpRegions')}`);
    if (sumRender('inpaint') > 0 && sumRender('inpaintChangedPixels') === 0) lines.push('⚠️ LaMa استُدعي لكن لم يغيّر أي بكسل في السجل.');
    if (sumRender('fill') > 0 && sumRender('fillChangedPixels') === 0) lines.push('⚠️ مسار التعبئة استُدعي لكن لم يغيّر أي بكسل في السجل.');
  }
  // الترجمة المقدّمة مقابل القارئ: ما بقي من كل صفحة بلا عربي، ولماذا
  for (const via of ['reader', 'job']) {
    const mine = fresh.filter((e) => e.via === via && e.native?.render);
    if (!mine.length) continue;
    const sum = (k) => mine.reduce((a, e) => a + (e.native.render.counts?.[k] ?? 0), 0);
    lines.push(`${via === 'job' ? 'المقدّمة' : 'القارئ'}: ${mine.length} صفحة · مرسوم ${sum('translated')} · لم يدخل ${sum('noFit')} · لم يظهر ${sum('invisible')} · فقاعة أُبقيت ${sum('bubbleKept')} · لون قُلب ${sum('inkFlipped')}`);
  }
  // المعالج مشغول فعلًا أم الصفحات تنتظر بعضها؟ من آخر صفحة قاسها الجهاز
  const last = [...scoped].reverse().find((e) => e.native?.render?.laneBusy || e.native?.analyze?.laneBusy || Number.isFinite(e.native?.render?.busyPct ?? e.native?.analyze?.busyPct));
  const lanes = last?.native?.render?.laneBusy ?? last?.native?.analyze?.laneBusy;
  if (lanes) lines.push(`إشغال المسارات: كشف ${lanes.detect}% · تحليل ${lanes.analyze}% · رسم ${lanes.render}% (ليس نسبة CPU للنظام)`);
  else if (last) lines.push(`مسار النماذج المحلي كان مشغولًا ${last.native.render?.busyPct ?? last.native.analyze.busyPct}% من الوقت منذ أول صفحة (هذا إشغال بوابة الترجمة، وليس نسبة CPU للنظام)`);
  for (const [label, g] of [['بلا نص', s.textless], ['بنص', s.text]]) {
    lines.push('', `${label}: ${g.pages} صفحة · الوسيط ${sec(g.median)}`);
    for (const [k, v] of Object.entries(g.stages).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) lines.push(`  ${k}: ${sec(v)}`);
  }
  // آخر الصفحات واحدةً واحدة: الملخّص السابق كان يخفي فرق «الأولى لا تظهر والثانية تظهر».
  // هذا السطر يجعل الدور والعمل والشبكة مرئية لكل صفحة بدل وسيط واحد.
  const recentText = fresh.filter((e) => !e.textless).slice(-12);
  if (recentText.length) {
    lines.push('', 'آخر صفحات الحوار (كل صفحة وحدها):');
    for (const e of recentText) {
      const a = e.native?.analyze?.stages ?? {};
      const ac = e.native?.analyze?.counts ?? {};
      const r = e.native?.render?.stages ?? {};
      const probe = e.native?.route?.stages ?? {};
      const queue = (a.queue ?? 0) + (r.queue ?? 0) + (probe.queue ?? 0);
      const network = e.stages?.luna != null ? `Luna ${sec(e.stages.luna)}` : e.stages?.cacheProbe != null ? `كاش الخادم ${sec(e.stages.cacheProbe)}` : 'بلا نداء لغة';
      const route = ({ fast: 'سريع بالكامل', mixed: 'مختلط', heavy: 'ثقيل بالكامل', light: 'خفيف' })[localRoute(ac)];
      const telemetry = [
        Number.isFinite(ac.detectTiles) ? `detectTiles ${ac.detectTiles}` : null,
        Number.isFinite(ac.heavyRoiCrops) ? `ROI ${ac.heavyRoiCrops}` : null,
        Number.isFinite(ac.glyphTiles) ? `CTDtiles ${ac.glyphTiles}` : null,
        Number.isFinite(ac.bubbleTiles) ? `BubbleTiles ${ac.bubbleTiles}` : null,
        Number.isFinite(e.native?.analyze?.thermal) ? `حرارة ${e.native.analyze.thermal}` : null,
        Number.isFinite(e.native?.analyze?.heapMb) ? `heap ${e.native.analyze.heapMb}MB` : null,
      ].filter(Boolean).join(' · ');
      lines.push(`  صفحة ${Number.isFinite(e.pageIndex) ? e.pageIndex + 1 : '?'}: ${sec(e.total)} · ${e.incomplete ? 'جزئية' : 'مكتملة'} · مسار ${route} · دور ${sec(queue)} · RT-DETR ${sec(a.detect ?? probe.detect)} · Fast ${sec(a.fastFlat)} · CTD ${sec(a.glyphs)} · فقاعات ${sec(a.bubbles)} · OCR ${sec(a.fastOcr ?? a.ocr)} · fullRes ${sec(r.fullRes)} · تبييض ${sec(r.erase)} · ${network} · مرسوم ${e.translated ?? 0}${telemetry ? ` · ${telemetry}` : ''}`);
    }
  }

  if (s.chapters.length) {
    lines.push('', 'الفصول (الزمن الفعلي من أول صفحة لآخرها):');
    for (const c of s.chapters.slice(-10)) lines.push(`  ${c.chapterKey}: ${c.pages} صفحة · ${sec(c.wallMs)}`);
  }
  for (const b of benchmarks) {
    lines.push('', `القديم مقابل الجديد (${b.page}): ${b.identical ? 'الناتج متطابق بكسلًا بكسلًا' : 'الناتج مختلف!'}`);
    const keys = new Set([...Object.keys(b.legacy?.stages ?? {}), ...Object.keys(b.current?.stages ?? {})]);
    for (const k of keys) lines.push(`  ${k}: ${sec(b.legacy?.stages?.[k] ?? 0)} ← ${sec(b.current?.stages?.[k] ?? 0)}`);
    lines.push(`  المجموع: ${sec(totalOf(b.legacy))} ← ${sec(totalOf(b.current))}`);
  }
  const eng = engineLines(engines);
  if (eng.length) lines.push('', ...eng);
  if (cleaning?.perf) {
    const counts = cleaning.perf.counts ?? {};
    const stages = cleaning.perf.stages ?? {};
    const mask = counts.eraseMaskPixels ?? 0;
    const changed = counts.eraseChangedPixels ?? 0;
    lines.push('', `اختبار التبييض المحلي: ${cleaning.cleanedRegions ?? 0} منطقة · قناع ${mask} · تغيّر ${changed} · fill ${counts.fillChangedPixels ?? 0} · LaMa ${counts.inpaintChangedPixels ?? 0} · no-op ${counts.eraseNoOpRegions ?? 0} · SHA النماذج: مجتاز`);
    for (const k of ['detect', 'glyphs', 'bubbles', 'ocr', 'plan', 'lamaLockWait', 'load:lama', 'erase', 'encode', 'write']) {
      if (typeof stages[k] === 'number') lines.push(`  probe.${k}: ${sec(stages[k])}`);
    }
  }
  return lines.join('\n');
}

export const totalOf = (perf) => Object.entries(perf?.stages ?? {}).reduce((a, [k, v]) => (k === 'load' ? a : a + v), 0);

/** Complete chapter evidence: accepted output persisted, never just analysis or summed overlapping work. */
export function chapterBenchmark({ startedAt, endedAt, expectedPages, pageResults = [], device = null, environment = {}, quality = null, profile = null }) {
  const count = Number.isInteger(expectedPages) && expectedPages > 0 ? expectedPages : 0;
  const pages = new Map();
  for (const page of pageResults) {
    if (!Number.isInteger(page?.pageIndex) || page.pageIndex < 0 || page.pageIndex >= count) continue;
    const previous = pages.get(page.pageIndex);
    // A retry failure must not erase already accepted, saved output.
    if (!previous || !(previous.accepted && previous.saved && !previous.error)) pages.set(page.pageIndex, page);
  }
  const accepted = [...pages.values()].filter(p => p.accepted === true && p.saved === true && !p.error && typeof p.hash === 'string' && /^[a-f0-9]{64}$/.test(p.hash));
  const completed = accepted.length;
  const wallMs = Number.isFinite(endedAt - startedAt) ? Math.round(endedAt - startedAt) : null;
  const cachePages = accepted.filter(p => ['cache', 'device', 'friends'].includes(p.from)).length;
  const timingValid = Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt && accepted.every(p => ['model', 'textless'].includes(p.from) && Number.isFinite(p.at) && p.at >= startedAt && p.at <= endedAt);
  const proven = timingValid && device?.physical === true && Boolean(device.model) && environment.evidence === 'device' && ['warm', 'cold'].includes(environment.models) && environment.translationCache === 'fresh' && Boolean(environment.images);
  const stages = {};
  const values = {};
  for (const p of accepted) for (const [name, ms] of Object.entries(p.stages ?? {})) {
    if (Number.isFinite(ms) && ms >= 0) (values[name] ??= []).push(ms);
  }
  const percentile = (xs, q) => xs[Math.max(0, Math.ceil(xs.length * q) - 1)];
  for (const [name, xs] of Object.entries(values)) {
    xs.sort((a, b) => a - b);
    stages[name] = { p50: percentile(xs, 0.5), p95: percentile(xs, 0.95) };
  }
  const budgets = { light: 30000, mixed: 120000, heavy: 300000 };
  const budgetMs = profile === null ? 100000 : Object.hasOwn(budgets, profile) ? budgets[profile] : null;
  const timingTarget = !count || completed !== count ? 'incomplete' : cachePages === count ? 'cache-only' : !proven || cachePages > 0 || !budgetMs ? 'UNVERIFIED' : (profile === null || profile === 'mixed') && count !== 100 ? 'not-target-chapter' : wallMs <= budgetMs ? 'met' : 'not-met';
  const checks = [
    ['detectionRecall', value => value >= .99 && value <= 1],
    ['untranslatedEnglishRate', value => value >= 0 && value <= .01],
    ...['mixedArabicEnglish', 'noOpWhitening', 'outsideMaskCorruptions'].map(name => [name, value => value === 0]),
  ];
  const annotations = new Map((Array.isArray(quality?.pages) ? quality.pages : []).filter(p => p && Number.isInteger(p.pageIndex) && typeof p.hash === 'string').map(p => [p.pageIndex, p]));
  const qualityProven = quality?.evidence === 'annotated-corpus' && annotations.size === count && quality.pages.length === count &&
    typeof quality.buildSha === 'string' && /^[a-f0-9]{40}$/.test(quality.buildSha) && quality.runId === environment.runId && Boolean(environment.runId) && quality.buildSha === environment.buildSha &&
    accepted.every(p => {const a=annotations.get(p.pageIndex);return a?.hash === p.hash && /^[a-f0-9]{64}$/.test(p.outputHash ?? '') && a.outputHash === p.outputHash;}) && checks.every(([name]) => Number.isFinite(quality[name]));
  const failures = qualityProven ? checks.filter(([name, check]) => !check(quality[name])).map(([name]) => name) : [];
  const qualityStatus = !qualityProven ? 'UNVERIFIED' : failures.length ? 'failed' : 'passed';
  const target = timingTarget !== 'met' ? timingTarget : qualityStatus === 'passed' ? 'met' : qualityStatus === 'failed' ? 'quality-failed' : 'UNVERIFIED';
  return { expectedPages: count, completed, failed: count - completed, wallMs, cachePages, stages, target, timingTarget, budgetMs: budgetMs ?? null, profile, qualityStatus, qualityFailures: failures, device, environment };
}
