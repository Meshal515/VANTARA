/**
 * عين الفصل — «قرأته» لكل فصل على حدة.
 *
 * تُحفظ في حسابك (`chapter.mark`، آخر كتابة تفوز، لك وحدك) لا علامةً محلية
 * تضيع مع الجهاز. والقارئ يعلّم الفصل وحده بعد قراءة معظم صفحاته: هذا الفصل فقط، لا
 * ما قبله ولا العمل كله. ونسبة العمل تُشتق من الفصول المعلَّمة فعلًا.
 */

import { chapterNumberOf } from '../lib/catalog.js';

export const AUTO_READ_RATIO = 0.9;
export const HISTORY_READ_RATIO = 0.2;
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

/**
 * الفصل يُعلَّم مقروءًا حين تصل 20% منه (أبعد صفحة بلغتها)، بلا شرط وقت.
 * كان الشرط 90% من الصفحات كلٌّ بقي «الأوضح» نصف ثانية: في الويبتون المتصل يتجاوز التمرير
 * شرائح كثيرة أسرع من ذلك، فتُعلَّم فصول وتُترك أخرى بلا نمط.
 */
export const MARK_READ_RATIO = 0.2;
/**
 * ومعها وقت قراءة فعلي (#323 U-29): التمرير السريع عبر 39 فصلًا كان يعلّمها كلها مقروءة لأن أبعد
 * صفحة وحدها تكفي. الحد الأدنى 5 ثوانٍ أو ربع ثانية لكل صفحة في الفصل، أيهما أكبر. `readMs` غير
 * المعروف (مستدعٍ قديم) لا يمنع التعليم.
 */
export const MIN_READ_MS = 5000;
export const READ_MS_PER_PAGE = 250;
export function shouldAutoMark({ ratio, alreadyRead, readMs, pages }) {
  if (alreadyRead || !(ratio >= MARK_READ_RATIO)) return false;
  if (readMs == null) return true;
  return readMs >= Math.max(MIN_READ_MS, (Number(pages) || 0) * READ_MS_PER_PAGE);
}

/**
 * أين يكمل «تابع»: الفصل الأبعد الذي تقدّمت فيه، لا آخر صف كُتب فقط (#323 U-21).
 * نظرة سريعة على فصل قديم (قرأت 386 ثم فتحت 337 ثماني ثوانٍ) كانت تقلب «تابع» إلى 337. القديم يأخذ
 * «تابع» فقط إن قرأت منه شيئًا حقيقيًا (نصفه فأكثر)؛ وإلا يبقى الأبعد. فصل مكتمل (≥98%) ← الذي يليه.
 * `ordered` الفصول من الأقدم للأحدث، و`keyOf(row, chapter)` يطابق صف التقدم بفصله.
 */
export const REREAD_RATIO = 0.5;
export function continueChapter(rows, ordered, keyOf) {
  if (!rows?.length || !ordered?.length) return null;
  const placed = [];
  for (const row of rows) {
    const at = ordered.findIndex((c) => keyOf(row, c));
    if (at >= 0) placed.push({ row, at });
  }
  if (!placed.length) return null;
  const latest = placed.reduce((a, b) => ((b.row.updated_at ?? 0) > (a.row.updated_at ?? 0) ? b : a));
  const furthest = placed.reduce((a, b) => (b.at > a.at ? b : a));
  const pick = latest.at >= furthest.at || (latest.row.ratio ?? 0) >= REREAD_RATIO ? latest : furthest;
  if ((pick.row.ratio ?? 0) < 0.98) return ordered[pick.at];
  return ordered[pick.at + 1] ?? ordered[pick.at];
}

/**
 * «ابدأ» بلا تقدم: أقدم فصل مرقّم غير مقروء (#323 U-30). الصفوف بلا رقم تأتي آخر `mergeChapters` أي
 * «الأقدم»، فتُختار فقط إن لم يكن للعمل فصل مرقّم أصلًا. (صف Mangalek «n-a» نفسه كان يُقرأ «الفصل 0»
 * من اسمه، فيُسقطه `mergeChapters` من أصله: `isPlaceholderChapter`.) `base` من الأحدث للأقدم.
 */
export function startChapter(base, isRead) {
  const oldestFirst = [...(base ?? [])].reverse();
  const numbered = oldestFirst.filter((r) => Number(r?.number) >= 0);
  return numbered.find((r) => !isRead(r)) ?? oldestFirst.find((r) => !isRead(r)) ?? numbered[0] ?? base?.[0] ?? null;
}

/**
 * الفصول التي تُعدّ في «قرأت X من Y» وعدد الرأس معًا (#323 U-23): الصحيحة المرقّمة ≥1 فقط، كما
 * يعدّ countMainChapters في catalog.js. عمل بلا أرقام أصلًا يُعدّ بكل صفوفه.
 */
export function mainChapters(rows) {
  const all = rows ?? [];
  const main = all.filter((r) => Number.isInteger(Number(r?.number)) && Number(r.number) >= 1);
  return main.length ? main : all;
}
