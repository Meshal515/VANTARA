/**
 * ترجمة الفصول مقدمًا: تختار مصدرًا إنجليزيًا ومن فصل إلى فصل، والجوال يترجم
 * في الخلفية وأنت تقرأ غيره. تفتح الفصل بعدها وهو جاهز بلا انتظار.
 *
 * الطابور محفوظ على الجهاز صفحةً صفحة: انقطع النت، أو قُتل التطبيق، أو أوقفته
 * بيدك، يكمل من الصفحة التي وقف عندها، بلا إعادة ترجمة ولا رصيد إضافي (كل
 * صفحة مترجمة محفوظة ببصمتها أصلًا، على الجهاز وفي الخادم للعائلة كلها).
 *
 * الترجمة نفسها طريق القارئ ذاته (`translatePage`)، فما يُجهَّز هنا يجده القارئ
 * جاهزًا. خدمة أندرويد الأمامية تُبقي التطبيق حيًّا والشاشة مطفأة وتعرض التقدّم.
 */

const JOBS_KEY = 'vantara.translate.jobs';
const PACE_KEY = 'vantara.translate.pace';
/**
 * صفحات تُترجم معًا: الرؤية على الجوال واحدة تلو الأخرى، وLuna (~١٣ ث) تتداخل معها؛
 * أربع تُبقي المعالج مشغولًا بتحليل التالية ما دامت السابقات تنتظر Luna.
 */
export const JOB_CONCURRENCY = 4;
/** أخطاء لا تُحل بالانتظار: توقف الطابور وتنتظرك. */
export const BLOCKING = new Set(['translation_locked', 'models_missing', 'device_only', 'translation_not_configured', 'weekly_limit', 'monthly_budget', 'no_credit']);
/** أخطاء عابرة: تُعاد بعد مهلة. */
const TRANSIENT = new Set(['offline', 'busy', 'upstream', 'unauthorized', 'http_0', 'http_401', 'http_502', 'http_503', 'too_long', 'bad_output', 'device_failed']);
const MAX_PAGE_TRIES = 4;

// ─────────────────────────── النموذج (خالص) ───────────────────────────

/** المصادر الإنجليزية لعمل، بفصولها. الترجمة من الإنجليزي وحده (قراءة الجوال لاتينية). */
export function englishSources(rows = []) {
  const bySource = new Map();
  for (const row of rows) {
    if (row?.lang !== 'en' || !row.sourceId) continue;
    const n = Number(row.number);
    if (!Number.isFinite(n) || n < 0) continue;
    const s = bySource.get(row.sourceId) ?? { sourceId: row.sourceId, label: row.sourceLabel ?? row.label ?? row.sourceId, numbers: new Set() };
    s.numbers.add(n);
    bySource.set(row.sourceId, s);
  }
  return [...bySource.values()]
    .map((s) => {
      const numbers = [...s.numbers].sort((a, b) => a - b);
      return { sourceId: s.sourceId, label: s.label, count: numbers.length, min: numbers[0], max: numbers[numbers.length - 1] };
    })
    .sort((a, b) => b.count - a.count);
}

/** فصول مصدر بين رقمين (شاملًا)، مرتبة، بلا تكرار للرقم نفسه. */
export function pickChapters(rows = [], sourceId, from, to) {
  const lo = Math.min(Number(from), Number(to));
  const hi = Math.max(Number(from), Number(to));
  const byNumber = new Map();
  for (const row of rows) {
    if (row?.sourceId !== sourceId || row.lang !== 'en') continue;
    const n = Number(row.number);
    if (!Number.isFinite(n) || n < lo || n > hi || byNumber.has(n)) continue;
    byNumber.set(n, row);
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

export function createJob({ ref, title, sourceId, sourceLabel, mode = 'quality', rows, keyOf, pageCounts = {}, now = Date.now() }) {
  return {
    id: `${ref}|${sourceId}|${now.toString(36)}`,
    ref,
    title: title ?? ref,
    sourceId,
    sourceLabel: sourceLabel ?? sourceId,
    mode: mode === 'fast' ? 'fast' : 'quality',
    chapters: rows.map((row) => {
      const key = keyOf(row);
      return { key, number: row.number, row, pages: Number.isFinite(pageCounts[key]) ? pageCounts[key] : null, done: [], failed: [] };
    }),
    status: 'running',
    reason: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * التقدّم: المترجَم فعلًا وحده. الصفحة الفاشلة ليست منجزة، والفصل المكتمل هو
 * الذي تُرجمت كل صفحاته؛ والفصل الذي لم تصل صفحاته لا يُحسب مكتملًا.
 */
export function progressOf(job) {
  let done = 0;
  let failed = 0;
  let total = 0;
  let chaptersDone = 0;
  let unknown = 0;
  let unreachable = 0;
  for (const c of job.chapters) {
    if (c.unreachable) {
      unreachable += 1;
      continue;
    }
    if (c.pages === null) {
      unknown += 1;
      continue;
    }
    total += c.pages;
    done += Math.min(c.pages, c.done.length);
    failed += c.failed.filter((i) => !c.done.includes(i)).length;
    if (c.pages > 0 && c.done.length >= c.pages) chaptersDone += 1;
  }
  return { done, failed, total, chaptersDone, chaptersTotal: job.chapters.length, unknown, unreachable, ratio: total ? done / total : 0 };
}

/** نص الانتهاء كما هو: كم فصلًا اكتمل فعلًا، وما لم يكتمل. */
export function finishedText(job) {
  const p = progressOf(job);
  const n = p.chaptersDone;
  const chapters = n === 1 ? 'فصل واحد' : n === 2 ? 'فصلين' : `${n} فصول`;
  if (!p.failed && !p.unreachable) return `تمت ترجمة ${chapters}. افتحها وتقرأ على طول.`;
  const parts = [`اكتمل ${chapters} من ${p.chaptersTotal}`];
  if (p.failed) parts.push(`${p.failed} صفحة ما تُرجمت (يعيدها القارئ حين تصلها)`);
  if (p.unreachable) parts.push(`${p.unreachable === 1 ? 'فصل' : `${p.unreachable} فصول`} ما وصلت صفحاته`);
  return parts.join('، ') + '.';
}

/** العمل التالي: فصل بلا عدد صفحات بعد، أو أول صفحة لم تُنجز في أول فصل ناقص. */
export function nextWork(job, busy = new Set()) {
  for (let c = 0; c < job.chapters.length; c++) {
    const ch = job.chapters[c];
    if (ch.unreachable) continue;
    if (ch.pages === null) return { chapter: c, page: null };
    for (let p = 0; p < ch.pages; p++) {
      if (ch.done.includes(p) || ch.failed.includes(p) || busy.has(`${c}:${p}`)) continue;
      return { chapter: c, page: p };
    }
  }
  return null;
}

export const isFinished = (job) => nextWork(job) === null;

/** الوقت المتوقع بالدقائق من سرعتك الفعلية، أو null قبل أن نعرفها. */
export function estimateMinutes(pages, msPerPage) {
  if (!(msPerPage > 0) || !(pages > 0)) return null;
  return Math.max(1, Math.round((pages * msPerPage) / 60000));
}

// ─────────────────────────── الحفظ ───────────────────────────

export function readJobs(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage?.getItem(JOBS_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function writeJobs(jobs, storage = globalThis.localStorage) {
  try {
    storage?.setItem(JOBS_KEY, JSON.stringify(jobs));
  } catch {
    // مساحة ممتلئة: الطابور يعمل في الذاكرة، وما تُرجم محفوظ ببصمته أصلًا
  }
}

export function readPace(storage = globalThis.localStorage) {
  try {
    return JSON.parse(storage?.getItem(PACE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** متوسط متحرك لزمن الصفحة لكل وضع: التقدير يتعلّم من جوالك أنت. */
export function recordPace(mode, ms, storage = globalThis.localStorage) {
  if (!(ms > 0)) return;
  const pace = readPace(storage);
  const prev = pace[mode];
  pace[mode] = prev > 0 ? Math.round(prev * 0.8 + ms * 0.2) : Math.round(ms);
  try {
    storage?.setItem(PACE_KEY, JSON.stringify(pace));
  } catch {
    // تقدير لا حقيقة
  }
}

// ─────────────────────────── المشغّل ───────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `deps`: `{ sync, engine, keyOf, translatePage, native: { jobProgress, jobFinished, jobStop }, storage?, now? }`
 * يُنشأ مرة في القشرة. `subscribe(fn)` يُخبر الواجهة بكل تغيير.
 */
export function createJobRunner(deps) {
  const { sync, engine, translatePage, native } = deps;
  // الصفحة أمامك في القارئ أولًا على النت أيضًا: لا تبدأ المقدّمة صفحة جديدة وهو يترجم
  const readerQuiet = deps.readerQuiet ?? (async () => {});
  const storage = deps.storage ?? globalThis.localStorage;
  const now = deps.now ?? (() => Date.now());
  let jobs = readJobs(storage);
  let running = false;
  const listeners = new Set();
  const pageLists = new Map();
  const tries = new Map();

  const save = () => {
    writeJobs(jobs, storage);
    for (const fn of listeners) fn(jobs);
  };
  const find = (id) => jobs.find((j) => j.id === id);
  const active = () => jobs.find((j) => j.status === 'running');

  function notify(job) {
    const p = progressOf(job);
    const ch = job.chapters.find((c) => !c.unreachable && (c.pages === null || c.done.length + c.failed.length < c.pages));
    const text = p.total
      ? `${ch ? `فصل ${ch.number} · ` : ''}${p.done}/${p.total} صفحة${p.unknown ? ' (نحسب الباقي)' : ''}`
      : 'نجهّز الفصول…';
    void native.jobProgress({ title: `ترجمة ${job.title}`, text, done: p.done, total: p.total });
  }

  async function pagesOf(job, c) {
    const ch = job.chapters[c];
    const cached = pageLists.get(ch.key);
    if (cached) return cached;
    const list = await engine.pages(ch.row.sourceId, ch.row.chapter);
    if (!list?.length) throw new Error('empty');
    pageLists.set(ch.key, list);
    if (ch.pages !== list.length) {
      ch.pages = list.length;
      ch.done = ch.done.filter((i) => i < list.length);
      ch.failed = ch.failed.filter((i) => i < list.length);
      save();
    }
    return list;
  }

  /** صفحة واحدة. يرجع رمز خطأ حاجز إن وُجد، وإلا null. */
  async function translateOne(job, c, p) {
    const ch = job.chapters[c];
    const started = now();
    const list = await pagesOf(job, c);
    const image = await engine.pageImage(ch.row.sourceId, list[p]);
    const result = await translatePage(
      { sync, imagePath: image.path, fetchMs: now() - started, via: 'job' },
      image.src,
      {
        seriesRef: job.ref,
        seriesTitle: job.title,
        chapterKey: ch.key,
        chapterNumber: Number.isFinite(ch.number) && ch.number >= 0 ? ch.number : null,
        pageIndex: p,
        sourceLang: ch.row.lang ?? 'en',
        ...(job.mode === 'fast' ? { speed: 'fast' } : {}),
      },
    );
    if (result?.error) return result.error;
    if (!ch.done.includes(p)) ch.done.push(p);
    if (result.from !== 'device') recordPace(job.mode, now() - started, storage);
    return null;
  }

  async function loop() {
    if (running) return;
    running = true;
    try {
      for (let job = active(); job; job = active()) {
        notify(job);
        const busy = new Set();
        let blocked = null;
        let transient = false;
        const worker = async () => {
          while (job.status === 'running' && !blocked) {
            const next = nextWork(job, busy);
            if (!next) return;
            // عدد الصفحات أولًا (عامل واحد يكفي؛ الباقون ينتظرون دورهم)
            if (next.page === null) {
              const tag = `${next.chapter}:list`;
              if (busy.has(tag)) {
                await sleep(300);
                continue;
              }
              busy.add(tag);
              try {
                await pagesOf(job, next.chapter);
              } catch {
                // فصل لا تصل صفحاته: يُعدّ منجزًا فاشلًا بدل أن يعلق الطابور
                const ch = job.chapters[next.chapter];
                const n = (tries.get(ch.key) ?? 0) + 1;
                tries.set(ch.key, n);
                if (n >= MAX_PAGE_TRIES) {
                  // لا يُحسب مكتملًا: يُذكر في نص الانتهاء
                  ch.unreachable = true;
                  save();
                } else {
                  transient = true;
                  return;
                }
              } finally {
                busy.delete(tag);
              }
              continue;
            }
            const tag = `${next.chapter}:${next.page}`;
            busy.add(tag);
            await readerQuiet();
            let code = null;
            try {
              code = await translateOne(job, next.chapter, next.page);
            } catch {
              code = 'offline';
            }
            busy.delete(tag);
            if (!code) {
              job.updatedAt = now();
              save();
              notify(job);
              continue;
            }
            if (BLOCKING.has(code)) {
              blocked = code;
              return;
            }
            const n = (tries.get(tag + job.id) ?? 0) + 1;
            tries.set(tag + job.id, n);
            if (TRANSIENT.has(code) && n < MAX_PAGE_TRIES) {
              transient = true;
              return;
            }
            // صفحة ترفضها Luna أو يتعذّر رسمها: تُتخطى، والقارئ يحاولها حين تصلها
            job.chapters[next.chapter].failed.push(next.page);
            save();
          }
        };
        await Promise.all(Array.from({ length: JOB_CONCURRENCY }, worker));

        if (blocked) {
          job.status = 'paused';
          job.reason = blocked;
          save();
          void native.jobFinished({ title: `توقفت ترجمة ${job.title}`, text: BLOCK_TEXT[blocked] ?? 'افتح التطبيق لتكمل' });
          continue;
        }
        if (job.status !== 'running') continue;
        if (isFinished(job)) {
          // الصفحات الفاشلة تُحاول مرة أخيرة قبل الإعلان (عطل عابر طال)
          if (!job.retriedFailed && job.chapters.some((c) => c.failed.length)) {
            job.retriedFailed = true;
            for (const c of job.chapters) c.failed = [];
            for (const key of [...tries.keys()]) if (key.endsWith(job.id)) tries.delete(key);
            save();
            continue;
          }
          job.status = 'done';
          job.reason = null;
          save();
          const p = progressOf(job);
          const complete = !p.failed && !p.unreachable;
          void native.jobFinished({ title: complete ? `جاهزة للقراءة: ${job.title}` : `انتهت ترجمة ${job.title} بنقص`, text: finishedText(job) });
          continue;
        }
        if (transient) await sleep(20_000);
      }
    } finally {
      running = false;
      if (!active()) void native.jobStop();
    }
  }

  return {
    jobs: () => jobs,
    forWork: (ref) => jobs.filter((j) => j.ref === ref && j.status !== 'canceled'),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    add(job) {
      jobs = [...jobs.filter((j) => j.status !== 'canceled'), job];
      save();
      void loop();
      return job;
    },
    pause(id) {
      const job = find(id);
      if (!job || job.status !== 'running') return;
      job.status = 'paused';
      job.reason = null;
      save();
      if (!active()) void native.jobStop();
    },
    resume(id) {
      const job = find(id);
      if (!job || job.status === 'done') return;
      job.status = 'running';
      job.reason = null;
      save();
      void loop();
    },
    cancel(id) {
      const job = find(id);
      if (job) job.status = 'canceled';
      jobs = jobs.filter((j) => j.id !== id);
      save();
      if (!active()) void native.jobStop();
    },
    /** بعد فتح التطبيق: ما كان شغّالًا يكمل من حيث وقف. */
    resumeAll() {
      jobs = readJobs(storage);
      if (active()) void loop();
    },
    clearFinished() {
      jobs = jobs.filter((j) => j.status !== 'done');
      save();
    },
  };
}

export const BLOCK_TEXT = {
  models_missing: 'ملفات الترجمة مو منزّلة. حمّلها من الإعدادات ← الترجمة',
  device_only: 'الترجمة تشتغل في تطبيق أندرويد فقط',
  translation_locked: 'الترجمة قيد التطوير',
  translation_not_configured: 'الترجمة مو مفعّلة على الخادم',
  weekly_limit: 'خلصت حصة الترجمة لهالأسبوع. تتجدد الخميس ٥ العصر، ويكمل من نفس الصفحة',
  monthly_budget: 'وصلت الترجمة لسقف الشهر. يكمل أول الشهر الجاي من نفس الصفحة',
  no_credit: 'خلص رصيد الترجمة',
};
