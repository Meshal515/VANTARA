/**
 * عين الفصل — «قرأته» لكل فصل على حدة.
 *
 * تُحفظ في حسابك (`chapter.mark`، آخر كتابة تفوز، لك وحدك) لا علامةً محلية
 * تضيع مع الجهاز. والقارئ يعلّم الفصل وحده بعد قراءة معظم صفحاته: هذا الفصل فقط، لا
 * ما قبله ولا العمل كله. ونسبة العمل تُشتق من الفصول المعلَّمة فعلًا.
 */

import { chapterNumberOf, legacyChapterNumber } from '../lib/catalog.js';
import { refsOf as defaultRefsOf } from '../lib/manga-alias-store.js';

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
  const key = `${shortRef(seriesRef)}#${suffix}`.slice(0, MAX_KEY);
  // RD7: رقم من الاسم تغيّرت قراءته («Vol.3 Ch.25» كان 3 وصار 25): علاماته وتقدّمه القديمة كُتبت بالمفتاح القديم.
  // يُسجَّل فيقرؤه legacyChapterKeys مع الجديد (لا صف يُنقل)، بسقف حتى لا يكبر بلا حد
  const given = Number(row.chapter?.chapterNumber);
  if (!(Number.isFinite(given) && given >= 0)) {
    const old = legacyChapterNumber(row.chapter?.name);
    if (old >= 0 && old !== n) {
      if (renumbered.size >= 20_000) renumbered.clear();
      renumbered.set(key, `${shortRef(seriesRef)}#n:${old}`.slice(0, MAX_KEY));
    }
  }
  return key;
}
const renumbered = new Map();

/**
 * مفتاح الفصل العشري كما حُفظ قبل #323 U-28: الرقم كان يمر بـFloat فيُكتب `n:356.1000061035156`
 * بدل `n:356.1`. علامات الفصول وصفوف التقدم القديمة بهذا المفتاح تُقرأ منه ما لم يُكتب بالجديد.
 */
export function legacyChapterKeys(key) {
  const before = renumbered.get(String(key ?? ''));
  const extra = before ? [before] : [];
  const match = /^(.*#n:)(-?\d+(?:\.\d+)?)$/.exec(String(key ?? ''));
  if (!match) return extra;
  const n = Number(match[2]);
  const widened = Math.fround(n);
  if (Number.isInteger(n) || widened === n) return extra;
  return [`${match[1]}${widened}`.slice(0, MAX_KEY), ...extra];
}

/** صف (تقدم أو علامة) مفتاحه هذا الفصل بالمفتاح الحالي أو القديم. */
export function sameChapterKey(stored, key) {
  return stored === key || (stored != null && legacyChapterKeys(key).includes(stored));
}

/**
 * مفاتيح الفصل نفسه في كل مراجع العمل، المرجع الحالي أولًا (المرحلة 1 من خطة المانجا، RD6).
 *
 * العمل الواحد قد يحمل أكثر من مرجع: `ext:<مفتاح قديم>` كُتبت به العلامات قبل الدمج، و`ext:<مفتاح جديد>`
 * تحمله البطاقة بعده (`refsOf` في manga-alias-store.js). القراءة تتبع كل المراجع، والكتابة تبقى بمرجع
 * البطاقة: لا صف يُنقل ولا يُحذف. **انتقالي:** الهوية الداخلية الثابتة (الحل ب في MANGA_REMEDIATION_PLAN.md)
 * تحلّ محل سجل الدمج المحلي هذا.
 */
export function chapterKeysAcross(seriesRef, key, refsOf = defaultRefsOf) {
  const own = String(key ?? '');
  const prefix = `${shortRef(String(seriesRef ?? ''))}#`;
  if (!own.startsWith(prefix)) return [own];
  const suffix = own.slice(prefix.length);
  const keys = [own];
  for (const ref of refsOf(String(seriesRef))) {
    const other = `${shortRef(String(ref))}#${suffix}`.slice(0, MAX_KEY);
    if (!keys.includes(other)) keys.push(other);
  }
  return keys;
}

function markRowOf(sync, userId, key) {
  // المزامنة الحقيقية: بحث بالمفتاح (والطبقة المتفائلة فوقه) لا مسح كل العلامات —
  // قائمة ألف فصل كانت تمسح ألف علامة لكل فصل فيها، فتتجمّد الصفحة
  if (typeof sync.row === 'function') return sync.row('chapter_marks', `${userId}/${key}`) ?? null;
  return sync.rows('chapter_marks', (r) => r.user_id === userId && r.chapter_key === key)[0] ?? null;
}

/** علامة مفتاح واحد بمفتاحه القديم (ذيل Float، #323 U-28) إن غاب الجديد: `{ read, at }` أو null. */
function markAt(sync, userId, key) {
  for (const k of [key, ...legacyChapterKeys(key)]) {
    const row = markRowOf(sync, userId, k);
    if (row) return { read: Boolean(row.read), at: Number(row.updated_at) || 0 };
  }
  return null;
}

/**
 * هل الفصل مقروء؟ العلامة المعلّقة (لم يرد الخادم) تفوز، ثم **أحدث** علامة في أي مرجع للعمل، والتعادل
 * للمرجع الحالي. عمل بمرجع واحد يبقى كما كان.
 */
export function isChapterRead(sync, seriesRef, key, { refsOf = defaultRefsOf } = {}) {
  const userId = sync.user?.userId;
  const keys = chapterKeysAcross(seriesRef, key, refsOf);
  if (typeof sync.row !== 'function') for (const k of keys) if (pending.has(k)) return pending.get(k);
  let best = null;
  for (const k of keys) {
    const m = markAt(sync, userId, k);
    if (m && (!best || m.at > best.at)) best = m;
  }
  return best ? best.read : false;
}

/** موضع القراءة من الخادم للفصل في كل مراجع العمل: الأبعد يفوز، كقاعدة دمج الخادم (`MAX`). */
export function progressFor(sync, seriesRef, key, { refsOf = defaultRefsOf } = {}) {
  const userId = sync.user?.userId;
  const keys = chapterKeysAcross(seriesRef, key, refsOf);
  const rows = sync.rows('progress', (r) => r.user_id === userId && keys.some((k) => sameChapterKey(r.chapter_key, k)));
  return rows.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0] ?? null;
}

/** الموضع المحفوظ على الجهاز: بمفتاح المرجع الحالي أولًا، ثم مراجع العمل الأخرى. */
export function positionFor(positions, seriesRef, key, { refsOf = defaultRefsOf } = {}) {
  for (const k of chapterKeysAcross(seriesRef, key, refsOf)) if (positions?.[k]) return positions[k];
  return null;
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

/** يلغي تعليم كل فصول العمل، في كل مراجعه (SY3): نية المستخدم العمل كله لا البطاقة الحالية. */
export function clearChapterMarks(sync, seriesRef, { refsOf = defaultRefsOf } = {}) {
  const userId = sync.user?.userId;
  let total = 0;
  for (const ref of refsOf(String(seriesRef))) {
    const marked = sync.rows('chapter_marks', (r) => r.user_id === userId && r.series_ref === ref && r.read);
    if (!marked.length) continue;
    for (const r of marked) pending.set(r.chapter_key, false);
    sync.enqueue('chapter.markMany', { seriesRef: ref, read: false, all: true });
    total += marked.length;
  }
  return total;
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
