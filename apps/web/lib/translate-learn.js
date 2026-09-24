/**
 * Luna تتعلم من الفصول العربية الموجودة لنفس العمل.
 *
 * عملٌ له مصدر عربي توقّف عند الفصل 33 وتكملة إنجليزية بعده: الفريق العربي
 * ثبّت الأسماء والمصطلحات والأسلوب في الفصول الأولى. قبل أول ترجمة لهذا
 * العمل نختار آخر فصل موجود عند المصدرين، نأخذ صفحات متقابلة منه (إنجليزي
 * وعربي)، ونرسلها لـ`/v1/translate/learn` فتستخرج Luna القاموس والأسلوب.
 * مرة لكل عمل (وتُعاد إن تقدّم المصدر العربي فصولًا)، في الخلفية، ولا توقف القراءة.
 *
 * الدوال الخالصة (اختيار الفصل، محاذاة الصفحات) تُختبر بلا جهاز.
 */

const LEARNED_KEY = 'vantara.translate.learned';
/** أزواج كافية لالتقاط الأسماء والأسلوب بلا إثقال الطلب (12 صورة). */
export const LESSON_PAIRS = 5;
const LESSON_WIDTH = 1000;

export const isArabicRow = (row) => row?.lang === 'ar' || (row?.lang == null && !isEnglishRow(row));
export const isEnglishRow = (row) => row?.lang === 'en';

/**
 * آخر فصل (بالرقم) موجود عند مصدر عربي ومصدر إنجليزي معًا.
 * @returns {{ number: number, arabic: object, english: object } | null}
 */
export function pickLessonChapter(rows = []) {
  const byNumber = new Map();
  for (const row of rows) {
    const n = Number(row?.number);
    if (!Number.isFinite(n) || n < 0) continue;
    const entry = byNumber.get(n) ?? { number: n, arabic: null, english: null };
    if (isEnglishRow(row)) entry.english ??= row;
    else if (isArabicRow(row)) entry.arabic ??= row;
    byNumber.set(n, entry);
  }
  const both = [...byNumber.values()].filter((e) => e.arabic && e.english);
  if (!both.length) return null;
  return both.reduce((a, b) => (b.number > a.number ? b : a));
}

/**
 * محاذاة صفحات بعدد مختلف: `n` أزواج موزّعة على طول الفصل بالنسبة، وتتخطى
 * الغلاف الأول والصفحة الأخيرة (حقوق الفريق غالبًا).
 * @returns {Array<[number, number]>} أزواج (فهرس إنجليزي، فهرس عربي)
 */
export function alignPairs(englishCount, arabicCount, n = LESSON_PAIRS) {
  const en = Math.max(0, Math.floor(englishCount));
  const ar = Math.max(0, Math.floor(arabicCount));
  if (en < 2 || ar < 2) return [];
  const count = Math.min(n, en - 1, ar - 1);
  const out = [];
  for (let k = 0; k < count; k++) {
    const t = (k + 1) / (count + 1);
    const ei = Math.min(en - 2, Math.max(1, Math.round(t * (en - 1))));
    const ai = Math.min(ar - 2, Math.max(1, Math.round(t * (ar - 1))));
    if (!out.some(([e, a]) => e === ei || a === ai)) out.push([ei, ai]);
  }
  return out;
}

export function learnedChapter(ref, storage = globalThis.localStorage) {
  try {
    return JSON.parse(storage?.getItem(LEARNED_KEY) ?? '{}')?.[ref] ?? null;
  } catch {
    return null;
  }
}
export function rememberLearned(ref, number, storage = globalThis.localStorage) {
  try {
    const all = JSON.parse(storage?.getItem(LEARNED_KEY) ?? '{}') ?? {};
    all[ref] = number;
    storage?.setItem(LEARNED_KEY, JSON.stringify(all));
  } catch {
    // تفضيل لا حقيقة
  }
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });

async function encodeForLesson(src) {
  const img = await loadImage(src);
  const scale = Math.min(1, LESSON_WIDTH / img.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return { mediaType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.82).split(',')[1] };
}

/**
 * يشغّل الدرس مرة لهذا العمل إن وُجد فصل مشترك أحدث مما تعلّمناه.
 * `deps`: `{ sync, ref, title, rows, pagesOf(row) → pages[], imageOf(row, index, page) → src }`.
 * @returns {Promise<'learned' | 'cached' | 'skipped' | 'failed'>}
 */
export async function learnOnce(deps) {
  const { sync, ref, title, rows, pagesOf, imageOf } = deps;
  const lesson = pickLessonChapter(rows);
  if (!lesson) return 'skipped';
  const done = learnedChapter(ref);
  if (done !== null && done >= lesson.number) return 'cached';
  try {
    const [enPages, arPages] = await Promise.all([pagesOf(lesson.english), pagesOf(lesson.arabic)]);
    const pairs = [];
    for (const [ei, ai] of alignPairs(enPages.length, arPages.length)) {
      const [english, arabic] = await Promise.all([imageOf(lesson.english, ei, enPages[ei]), imageOf(lesson.arabic, ai, arPages[ai])]);
      pairs.push({ english: await encodeForLesson(english), arabic: await encodeForLesson(arabic), pageIndex: ei });
    }
    if (!pairs.length) return 'skipped';
    const res = await sync.translation('/v1/translate/learn', {
      method: 'POST',
      body: { seriesRef: ref, seriesTitle: title, chapterNumber: lesson.number, pairs },
    });
    if (res.status !== 200) return 'failed';
    rememberLearned(ref, lesson.number);
    return res.body?.cached ? 'cached' : 'learned';
  } catch {
    return 'failed';
  }
}
