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
    /** يقيس وعدًا تحت اسم مرحلة. */
    async time(name, promise) {
      t = now();
      try {
        return await promise;
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
  const fresh = entries.filter((e) => e.from !== 'cache');
  const textless = fresh.filter((e) => e.textless);
  const text = fresh.filter((e) => !e.textless);
  const chapters = new Map();
  for (const e of fresh) {
    if (!e.chapterKey) continue;
    const c = chapters.get(e.chapterKey) ?? { chapterKey: e.chapterKey, pages: 0, first: Infinity, last: 0, work: 0 };
    c.pages += 1;
    c.first = Math.min(c.first, e.at - (e.total ?? 0));
    c.last = Math.max(c.last, e.at);
    c.work += e.total ?? 0;
    chapters.set(e.chapterKey, c);
  }
  return {
    pages: fresh.length,
    cached: entries.length - fresh.length,
    textless: { pages: textless.length, median: median(textless.map((e) => e.total)), stages: stageMeans(textless) },
    text: { pages: text.length, median: median(text.map((e) => e.total)), stages: stageMeans(text) },
    chapters: [...chapters.values()].map((c) => ({ chapterKey: c.chapterKey, pages: c.pages, wallMs: Math.round(c.last - c.first), workMs: c.work })),
  };
}

const sec = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} ث`);

/** تقرير نصي يُنسخ ويُرسل كما هو. */
export function formatReport(entries, benchmarks = []) {
  const s = summarize(entries);
  const lines = [`أداء الترجمة — ${s.pages} صفحة جديدة، ${s.cached} من المحفوظ`];
  // الترجمة المقدّمة مقابل القارئ: ما بقي من كل صفحة بلا عربي، ولماذا
  for (const via of ['reader', 'job']) {
    const mine = entries.filter((e) => e.via === via && e.native?.render);
    if (!mine.length) continue;
    const sum = (k) => mine.reduce((a, e) => a + (e.native.render.counts?.[k] ?? 0), 0);
    lines.push(`${via === 'job' ? 'المقدّمة' : 'القارئ'}: ${mine.length} صفحة · مرسوم ${sum('translated')} · لم يدخل ${sum('noFit')} · لم يظهر ${sum('invisible')} · فقاعة أُبقيت ${sum('bubbleKept')} · لون قُلب ${sum('inkFlipped')}`);
  }
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
  return lines.join('\n');
}

export const totalOf = (perf) => Object.entries(perf?.stages ?? {}).reduce((a, [k, v]) => (k === 'load' ? a : a + v), 0);
