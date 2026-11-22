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
  const restored = new Set();
  for (const r of tokensOf() ?? []) {
    if (!r?.token) continue;
    if (Number(r.active) === 1) set.add(r.token);
    else restored.add(r.token);
  }
  // DL1: الحذف من هذا الجهاز فعّال فورًا قبل رد الخادم؛ ويُنسى حين يعيده الخادم أو بعد أسبوع
  const now = Date.now();
  for (const [token, at] of Object.entries(readLocal())) if (!restored.has(token) && now - at < LOCAL_TTL_MS) set.add(token);
  return set;
}

const LOCAL_KEY = 'vantara.removed.local.v1';
const LOCAL_TTL_MS = 7 * 86_400_000;
function readLocal() {
  try { return JSON.parse(globalThis.localStorage?.getItem(LOCAL_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function writeLocal(map) {
  try { globalThis.localStorage?.setItem(LOCAL_KEY, JSON.stringify(map)); } catch { /* يبقى الخادم مرجعًا */ }
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
  const local = readLocal();
  for (const k of all) local[workToken(k)] = Date.now();
  writeLocal(local);
  notifyRemoved({ animate: true });
  return true;
}

export function restoreRemovedWork(sync, key) {
  if (!key || typeof sync?.enqueue !== 'function') return false;
  sync.enqueue('work.restore', { key: normalizeWorkKey(key) });
  const local = readLocal();
  delete local[workToken(key)];
  writeLocal(local);
  notifyRemoved();
  return true;
}

// ───── قاعدة واحدة لكل الشاشات (قرار المالك، 16 نوفمبر: «يُشال من كل شيء إلا الأرشيف، فورًا وبسلاسة») ─────
//
// كانت كل شاشة تفلتر المحذوف بنفسها، وثماني على الأقل لا تفلتر (تدقيق #349: DL2–DL10)، فيظهر العمل في الرئيسية
// والتوب والسجل ولا يُفتح («تم حذف العمل»). الآن: كل بطاقة عمل تحمل مفاتيحه (tagWork → data-work)، وحارس واحد
// على جذر التطبيق يخفي كل بطاقة لعمل محذوف في أي شاشة، لحظة رسمها، ولحظة وصول الحذف (من هذا الجهاز أو المزامنة).
// الأرشيف وحده (أي سلف عليه data-archive) لا يمسّه الحارس.

/** يضع مفاتيح العمل على بطاقته (أي شكل: ext:…، anime:…، cinema:…، ومفاتيح المصادر). */
export function tagWork(node, ...keys) {
  const list = [...new Set(keys.flat().map((k) => String(k ?? '').trim()).filter(Boolean))];
  if (node && list.length) node.dataset.work = list.join(' ');
  return node;
}

const gates = new Set();
function notifyRemoved(options = {}) {
  for (const sweep of gates) sweep(options);
}
/** المزامنة غيّرت جدول البصمات (حذف أو إعادة من جهاز آخر): كل الشاشات الظاهرة تُطابَق فورًا. */
export const removedChanged = () => notifyRemoved({ animate: true });

const EXIT_MS = 260;
function hide(node, animate) {
  if (node.dataset.removedHidden) return;
  node.dataset.removedHidden = '1';
  const done = () => { node.hidden = true; node.style.display = 'none'; };
  // خروج ناعم لما على الشاشة فعلًا (يتلاشى وينكمش)، وما خارجها يُخفى فورًا بلا حركة
  const rect = animate && node.isConnected && typeof node.animate === 'function' ? node.getBoundingClientRect?.() : null;
  const onScreen = rect && rect.bottom > 0 && rect.top < (globalThis.innerHeight ?? 0) && rect.width > 0;
  if (!onScreen || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return done();
  const run = node.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.92)' }], { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
  run.onfinish = done;
}
function show(node) {
  if (!node.dataset.removedHidden) return;
  delete node.dataset.removedHidden;
  node.hidden = false;
  node.style.display = '';
  node.getAnimations?.().forEach((a) => a.cancel());
}
function judge(node, animate) {
  if (node.closest?.('[data-archive]')) return;
  const keys = String(node.dataset.work ?? '').split(' ').filter(Boolean);
  if (isRemovedAny(keys)) hide(node, animate);
  else show(node);
}

/**
 * يركّب الحارس على جذر التطبيق. يرجع دالة الإزالة. يعمل على ما يُرسم بعده أيضًا (MutationObserver)، فلا تحتاج
 * أي شاشة أن تتذكر الفلترة.
 */
export function installRemovedGate(root) {
  if (!root?.querySelectorAll) return () => {};
  const sweep = ({ animate = false } = {}) => {
    for (const node of root.querySelectorAll('[data-work]')) judge(node, animate);
  };
  const Observer = globalThis.MutationObserver;
  const observer = Observer ? new Observer((records) => {
    if (!activeTokens().size) return;
    for (const r of records) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.dataset?.work) judge(n, false);
      for (const c of n.querySelectorAll?.('[data-work]') ?? []) judge(c, false);
    }
  }) : null;
  observer?.observe(root, { childList: true, subtree: true });
  gates.add(sweep);
  sweep();
  return () => { observer?.disconnect(); gates.delete(sweep); };
}
