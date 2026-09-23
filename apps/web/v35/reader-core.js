/**
 * منطق القارئ الذكي بلا DOM: ترتيب الفصول، طابور الصور بأولوياته، قرار
 * التحميل المسبق، والإعدادات. كل ما هنا يُختبر بلا متصفح.
 */

import { prefetchBudget } from '../lib/netpolicy.js';

// ───────────────────────── الفصول ─────────────────────────

/**
 * الفصول من الأقدم إلى الأحدث.
 *
 * القائمة تأتي من الأحدث (كما تعرضها صفحة العمل). والفصل بلا رقم يبقى في
 * موضعه النسبي: لا يُرمى في آخر القائمة فيصير «الفصل التالي» لكل شيء.
 */
export function chapterSequence(rows) {
  const list = [...(rows ?? [])];
  const numbered = list.filter((r) => Number.isFinite(r.number) && r.number >= 0);
  if (numbered.length === list.length) return numbered.sort((a, b) => a.number - b.number);
  return list.reverse();
}

const sameChapter = (a, b) =>
  a === b ||
  (Number.isFinite(a?.number) && a.number >= 0 && a.number === b?.number) ||
  (a?.sourceId === b?.sourceId && a?.chapter?.url && a.chapter.url === b?.chapter?.url);

/** السابق والتالي لفصلٍ في التسلسل. */
export function neighbors(sequence, row) {
  const i = sequence.findIndex((r) => sameChapter(r, row));
  if (i < 0) return { index: -1, prev: null, next: null };
  return { index: i, prev: sequence[i - 1] ?? null, next: sequence[i + 1] ?? null };
}

/** اسم الفصل للعرض: اسمه من المصدر، أو رقمه. */
export function chapterLabel(row) {
  if (!row) return '';
  const name = row.chapter?.name?.trim();
  if (name) return name;
  return Number.isFinite(row.number) && row.number >= 0 ? `الفصل ${row.number}` : 'فصل';
}

/** رقم الفصل وحده («113») إن وُجد، وإلا اسمه: نهاية الفصل تعرضه كبيرًا. */
export function chapterShort(row) {
  if (!row) return '';
  if (Number.isFinite(row.number) && row.number >= 0) return String(row.number);
  return chapterLabel(row);
}

// ───────────────────────── التقدّم ─────────────────────────

/** نسبة المقروء من الفصل: أبعد صفحة رُئيت، لا الصفحة الحالية. */
export function readRatio(furthestIndex, pageCount) {
  if (!pageCount) return 0;
  return Math.min(1, Math.max(0, (furthestIndex + 1) / pageCount));
}

/** من أين يبدأ تحميل الفصل التالي: آخر ثلاثين بالمئة من الحالي. */
export const PRELOAD_FROM_RATIO = 0.7;

/**
 * ما يُجهَّز من الفصل التالي حسب الشبكة واختيار المستخدم.
 *
 * `netpolicy` يقرّر الميزانية (Wi-Fi، بيانات جوال، توفير البيانات، دون
 * اتصال)، وهذا يترجمها: قائمة الصفحات رخيصة فتُجلب متى سُمح بالبيانات،
 * والصور على قدر الميزانية.
 */
export function nextChapterPlan({ mode = 'smart', network } = {}) {
  const budget = prefetchBudget({ mode, network });
  if (!budget.metadata) return { pageList: false, images: 0, reason: budget.reason };
  if (!budget.images || budget.chapters === 0) {
    // الوسط: أول صفحات التالي فقط تكفي ليفتح فورًا ويكمل وأنت تقرأ
    const images = budget.reason === 'unknown_network' ? 4 : 0;
    return { pageList: true, images, reason: budget.reason };
  }
  return { pageList: true, images: Infinity, reason: budget.reason };
}

// ───────────────────────── طابور الصور ─────────────────────────

/** الأولويات: كلما صغر الرقم سبق. */
export const PRIORITY = Object.freeze({
  VISIBLE: 0,
  NEAR: 1,
  CHAPTER: 2,
  NEXT_CHAPTER: 3,
});

/**
 * طابور تحميل بأولويات.
 *
 * - الطلب المكرّر لنفس المفتاح يرجع نفس الوعد، ويرفع أولويته إن طُلب أعلى.
 * - الفصل التالي (`NEXT_CHAPTER`) لا يأخذ إلا خانة واحدة، ولا يبدأ ما دام في
 *   الطابور شيءٌ من الفصل الحالي: على شبكة بطيئة لا ينافس ما تقرؤه الآن.
 * - `cancel(pred)` يُسقط ما لم يبدأ بعد (عند مغادرة الفصل مثلًا).
 */
export function createScheduler({ run, concurrency = 3, backgroundSlots = 1 }) {
  const jobs = new Map();
  let active = 0;
  let activeBackground = 0;

  function pump() {
    while (active < concurrency) {
      let best = null;
      for (const job of jobs.values()) {
        if (job.started) continue;
        if (!best || job.priority < best.priority) best = job;
      }
      if (!best) return;
      if (best.priority >= PRIORITY.NEXT_CHAPTER) {
        const foregroundActive = active - activeBackground;
        if (activeBackground >= backgroundSlots || foregroundActive > 0) return;
      }
      start(best);
    }
  }

  function start(job) {
    job.started = true;
    active += 1;
    const background = job.priority >= PRIORITY.NEXT_CHAPTER;
    if (background) activeBackground += 1;
    Promise.resolve()
      .then(() => run(job.key, job.payload))
      .then(job.resolve, (error) => {
        // الفشل لا يُحفظ: إعادة المحاولة تبدأ طلبًا جديدًا
        jobs.delete(job.key);
        job.reject(error);
      })
      .finally(() => {
        active -= 1;
        if (background) activeBackground -= 1;
        job.done = true;
        pump();
      });
  }

  return {
    request(key, payload, priority = PRIORITY.CHAPTER) {
      const existing = jobs.get(key);
      if (existing) {
        if (!existing.started && priority < existing.priority) {
          existing.priority = priority;
          pump();
        }
        return existing.promise;
      }
      const job = { key, payload, priority, started: false, done: false };
      job.promise = new Promise((resolve, reject) => {
        job.resolve = resolve;
        job.reject = reject;
      });
      // وعدٌ لا ينتظره أحد لا يرمي «unhandled»
      job.promise.catch(() => {});
      jobs.set(key, job);
      pump();
      return job.promise;
    },
    /** يرفع أولوية ما لم يبدأ (القارئ مرّر إلى صفحة). */
    bump(key, priority) {
      const job = jobs.get(key);
      if (job && !job.started && priority < job.priority) {
        job.priority = priority;
        pump();
      }
    },
    has: (key) => jobs.has(key),
    isDone: (key) => jobs.get(key)?.done === true,
    cancel(pred) {
      for (const [key, job] of jobs) {
        if (!job.started && pred(key, job)) {
          jobs.delete(key);
          job.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
        }
      }
    },
    /** يُسقط الأقدم المنتهي حين يكبر الكاش. */
    trim(max) {
      if (jobs.size <= max) return;
      for (const [key, job] of jobs) {
        if (jobs.size <= max) break;
        if (job.done) jobs.delete(key);
      }
    },
    get size() {
      return jobs.size;
    },
    get active() {
      return active;
    },
  };
}

// ───────────────────────── الإعدادات ─────────────────────────

export const SETTINGS_KEY = 'vantara.reader.settings';

/**
 * التكبير مقفول افتراضيًا: لمسة مزدوجة أو إصبعان أثناء التمرير يكبّران
 * الصفحة بالخطأ أكثر مما يطلبه أحد عمدًا. ومن أراده يشغّله من الإعدادات.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'vertical',
  fit: 'width',
  gap: 0,
  doubleTapZoom: false,
  pinchZoom: false,
  prefetch: 'smart',
});

const CHOICES = {
  mode: ['vertical', 'paged'],
  fit: ['width', 'height'],
  gap: [0, 8, 24],
  prefetch: ['smart', 'wifi', 'always', 'never'],
};

/** إعدادات محفوظة بعد التحقق: قيمة غريبة تعود للافتراضي لا تكسر القارئ. */
export function normalizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (allowed.includes(raw[key])) out[key] = raw[key];
  }
  for (const key of ['doubleTapZoom', 'pinchZoom']) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  return out;
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    return normalizeSettings(JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch {
    // التخزين ممتلئ أو ممنوع: الإعداد يبقى لهذه الجلسة
  }
}
