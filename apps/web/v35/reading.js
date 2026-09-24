/**
 * عين الفصل — «قرأته» لكل فصل على حدة.
 *
 * تُحفظ في حسابك (`chapter.mark`، آخر كتابة تفوز، لك وحدك) لا علامةً محلية
 * تضيع مع الجهاز. والقارئ يعلّم الفصل وحده عند ٢٠٪ منه: هذا الفصل فقط، لا
 * ما قبله ولا العمل كله. ونسبة العمل تُشتق من الفصول المعلَّمة فعلًا.
 */

import { chapterNumberOf } from '../lib/catalog.js';

export const AUTO_READ_RATIO = 0.2;
const MAX_KEY = 200;

/** علامات لم يرجع بها الخادم بعد: تُعرض فورًا وتفوز على صفٍّ أقدم في المرآة. */
let pending = new Map();
export function _resetPending() {
  pending = new Map();
}

function shortRef(ref) {
  if (ref.length <= 120) return ref;
  // عنوان طويل جدًّا: بصمة ثابتة بدل قصٍّ قد يجمع عملين في مفتاح واحد
  let h = 2166136261;
  for (let i = 0; i < ref.length; i++) h = Math.imul(h ^ ref.charCodeAt(i), 16777619);
  return `${ref.slice(0, 100)}~${(h >>> 0).toString(36)}`;
}

/**
 * رقم الفصل إن عُرف — فالفصل ١٧ من مصدرين علامةٌ واحدة — وإلا مصدره ورابطه.
 */
export function chapterKeyOf(seriesRef, row) {
  const n = chapterNumberOf(row.chapter);
  const suffix = n !== null && n >= 0 ? `n:${n}` : `u:${row.sourceId}:${row.chapter.url}`;
  return `${shortRef(seriesRef)}#${suffix}`.slice(0, MAX_KEY);
}

export function isChapterRead(sync, seriesRef, key) {
  const userId = sync.user?.userId;
  // المزامنة الحقيقية: بحث بالمفتاح (والطبقة المتفائلة فوقه) لا مسح كل العلامات —
  // قائمة ألف فصل كانت تمسح ألف علامة لكل فصل فيها، فتتجمّد الصفحة
  if (typeof sync.row === 'function') return Boolean(sync.row('chapter_marks', `${userId}/${key}`)?.read);
  if (pending.has(key)) return pending.get(key);
  const [mark] = sync.rows('chapter_marks', (r) => r.user_id === userId && r.chapter_key === key);
  return Boolean(mark?.read);
}

/**
 * فصولٌ كثيرة دفعة واحدة («قرأته كله»، «من ← إلى»، الإلغاء): عملية واحدة في
 * الطابور وعبارة واحدة عند الخادم، والصفحة تتحدث فورًا من الطبقة المتفائلة.
 * @returns {number} عدد الفصول التي تغيّرت فعلًا
 */
export function markChapters(sync, seriesRef, rows, read) {
  const keys = [];
  for (const row of rows) {
    const key = chapterKeyOf(seriesRef, row);
    if (isChapterRead(sync, seriesRef, key) !== read) keys.push(key);
  }
  if (!keys.length) return 0;
  for (const key of keys) pending.set(key, read);
  // دفعات من ألفين: سقف الخادم خمسة آلاف، والطابور يبقى خفيفًا
  for (let i = 0; i < keys.length; i += 2000) {
    sync.enqueue('chapter.markMany', { seriesRef, keys: keys.slice(i, i + 2000), read });
  }
  return keys.length;
}

/** يلغي تعليم كل فصول العمل. */
export function clearChapterMarks(sync, seriesRef) {
  const userId = sync.user?.userId;
  const marked = sync.rows('chapter_marks', (r) => r.user_id === userId && r.series_ref === seriesRef && r.read);
  if (!marked.length) return 0;
  for (const r of marked) pending.set(r.chapter_key, false);
  sync.enqueue('chapter.markMany', { seriesRef, read: false, all: true });
  return marked.length;
}

export function markChapter(sync, seriesRef, row, read) {
  const chapterKey = chapterKeyOf(seriesRef, row);
  pending.set(chapterKey, read);
  sync.enqueue('chapter.mark', { seriesRef, chapterKey, read });
}

export function shouldAutoMark({ ratio, alreadyRead }) {
  return !alreadyRead && ratio >= AUTO_READ_RATIO;
}
