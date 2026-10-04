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
  return Math.round(s[Math.floor(s.length / 2)]);
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
    add('analyze.', e.native?.analyze?.stages);
    add('render.', e.native?.render?.stages);
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, mean(v)]));
}

/**
 * الملخّص: الصفحات الجديدة (لا المحفوظة) مقسومة: بلا نص / بنص؛ وكل فصل
 * بمجموعه الفعلي من أول صفحة دخلت إلى آخر صفحة جهزت.
 */
export function summarize(entries) {
  // «سرعة الصفحة» = محاولة جديدة ناجحة فقط. قبل هذا كان error وrepair يدخلان
  // وسيط صفحات الحوار، فيبدو العطل الشبكي أو محاولة إصلاح كأنه بطء CTD/LaMa.
  const fresh = entries.filter((e) => !e.error && (e.from === 'model' || e.from === 'friends'));
  const cached = entries.filter((e) => e.from === 'cache');
  const errors = entries.filter((e) => e.from === 'error');
  const repairs = entries.filter((e) => e.from === 'repair');
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
  return {
    pages: fresh.length,
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

/** تقرير نصي يُنسخ ويُرسل كما هو. */
/** سطر لكل إعداد محرك: زمن الحروف والفقاعات، ومطابقة ناتجه للإعداد الحالي. */
export function engineLines(run) {
  if (!run?.engines?.length) return [];
  const lines = [`إعدادات CTD والفقاعات (${run.cores} أنوية، حرارة ${run.thermal}):`];
  for (const e of run.engines) {
    const same = e.glyphDiff === 0 && e.bubblesSame ? 'مطابق' : `مختلف: ${e.glyphDiff} بكسل حروف من ${e.glyphPixels}${e.bubblesSame ? '' : '، فقاعات مختلفة'}`;
    lines.push(`  ${e.name}: حروف ${sec(e.glyphsMs)} · فقاعات ${sec(e.bubblesMs)} · تحميل ${sec(e.loadMs)} · ${same}`);
  }
  return lines;
}

export function formatReport(entries, benchmarks = [], engines = null, cleaning = null) {
  const s = summarize(entries);
  const lines = [`أداء الترجمة — ${s.pages} صفحة جديدة ناجحة، ${s.cached} من المحفوظ، ${s.errors} فشل، ${s.repairs} إصلاح`];
  if (Object.keys(s.errorCodes).length) lines.push(`الأخطاء: ${Object.entries(s.errorCodes).map(([k, v]) => `${k}×${v}`).join(' · ')}`);

  // الدليل الأهم للتبييض: هل قناع المسح غيّر بكسلات فعلًا؟
  const rendered = entries.filter((e) => e.native?.render?.counts);
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
    const mine = entries.filter((e) => e.via === via && e.native?.render);
    if (!mine.length) continue;
    const sum = (k) => mine.reduce((a, e) => a + (e.native.render.counts?.[k] ?? 0), 0);
    lines.push(`${via === 'job' ? 'المقدّمة' : 'القارئ'}: ${mine.length} صفحة · مرسوم ${sum('translated')} · لم يدخل ${sum('noFit')} · لم يظهر ${sum('invisible')} · فقاعة أُبقيت ${sum('bubbleKept')} · لون قُلب ${sum('inkFlipped')}`);
  }
  // المعالج مشغول فعلًا أم الصفحات تنتظر بعضها؟ من آخر صفحة قاسها الجهاز
  const last = [...entries].reverse().find((e) => Number.isFinite(e.native?.render?.busyPct ?? e.native?.analyze?.busyPct));
  if (last) lines.push(`مسار النماذج المحلي كان مشغولًا ${last.native.render?.busyPct ?? last.native.analyze.busyPct}% من الوقت منذ أول صفحة (هذا إشغال بوابة الترجمة، وليس نسبة CPU للنظام)`);
  for (const [label, g] of [['بلا نص', s.textless], ['بنص', s.text]]) {
    lines.push('', `${label}: ${g.pages} صفحة · الوسيط ${sec(g.median)}`);
    for (const [k, v] of Object.entries(g.stages).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) lines.push(`  ${k}: ${sec(v)}`);
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
