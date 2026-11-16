/**
 * «حذف العمل» من التطبيق كله (قرار المالك، 16 نوفمبر 2026).
 *
 * المالك وحده يحذف ويعيد (الخادم يتحقق من شارته). العمل المحذوف:
 *   - يختفي من كل الرئيسيات والقوائم والبحث وآخر التحديثات، في المانجا والأنمي والسينما، عند الجميع.
 *   - لا يُفتح (ولا من رابط أو مكتبة قديمة)؛ يُعاد فقط من أرشيف المالك.
 *   - غير المالك لا يعرف أنه حُذف: يصله فقط جدول بصمات مفاتيح (بلا اسم ولا غلاف)، والأرشيف لا يصله أبدًا.
 *
 * البصمة: تجزئة 64 بت (بذرتان) لمفتاح العمل بعد توحيده. تُحسب في جهاز المالك لأن عمليات الخادم متزامنة.
 */

const PREFIX = 'vantara.removed:';

function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** مفتاح العمل موحّدًا: بلا `ext:` ولا مسافات. */
export const normalizeWorkKey = (key) => String(key ?? '').trim().replace(/^ext:/, '');

/** بصمة مفتاح (28 حرفًا hex). */
export function workToken(key) {
  const k = normalizeWorkKey(key);
  return k ? cyrb53(PREFIX + k, 1) + cyrb53(PREFIX + k, 7) : '';
}

let tokensOf = () => [];
/** مصدر البصمات الفعّالة: صفوف `removed_work_tokens` من المزامنة. */
export function setRemovedSource(rows) {
  tokensOf = typeof rows === 'function' ? rows : () => rows ?? [];
}
// تُبنى من الصفوف في كل مرة (عددها صغير): لا ذاكرة قد تبقي عملًا مُعادًا مخفيًا
function activeTokens() {
  const set = new Set();
  for (const r of tokensOf() ?? []) if (Number(r?.active) === 1 && r.token) set.add(r.token);
  return set;
}

/** هل هذا المفتاح لعمل محذوف من التطبيق؟ */
export function isRemovedKey(key) {
  const set = activeTokens();
  if (!set.size || !key) return false;
  return set.has(workToken(key));
}
/** أي مفتاح من مفاتيح العمل محذوف ⇒ العمل محذوف. */
export const isRemovedAny = (keys) => (keys ?? []).some(isRemovedKey);

/**
 * يحذف العمل من التطبيق كله (المالك). `keys`: كل مفاتيحه المعروفة (المرجع الموحّد ومفاتيح المصادر).
 * @returns {boolean} أُرسل الطلب
 */
export function removeWorkEverywhere(sync, { key, kind, keys = [], title = null, cover = null }) {
  const all = [...new Set([key, ...keys].map(normalizeWorkKey).filter(Boolean))].slice(0, 40);
  if (!all.length || !['anime', 'cinema', 'manga'].includes(kind) || typeof sync?.enqueue !== 'function') return false;
  sync.enqueue('work.remove', { key: all[0], kind, keys: all, tokens: all.map(workToken), title, cover });
  return true;
}

export function restoreRemovedWork(sync, key) {
  if (!key || typeof sync?.enqueue !== 'function') return false;
  sync.enqueue('work.restore', { key: normalizeWorkKey(key) });
  return true;
}
