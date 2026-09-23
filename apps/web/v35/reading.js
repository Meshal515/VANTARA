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
  if (pending.has(key)) return pending.get(key);
  const userId = sync.user?.userId;
  const [mark] = sync.rows('chapter_marks', (r) => r.user_id === userId && r.chapter_key === key);
  return Boolean(mark?.read);
}

export function markChapter(sync, seriesRef, row, read) {
  const chapterKey = chapterKeyOf(seriesRef, row);
  pending.set(chapterKey, read);
  sync.enqueue('chapter.mark', { seriesRef, chapterKey, read });
}

export function shouldAutoMark({ ratio, alreadyRead }) {
  return !alreadyRead && ratio >= AUTO_READ_RATIO;
}
