/**
 * فصل مصادر المانجا المدمجة عن التطبيق: من يرى المصادر التي كانت تُشحن داخل التطبيق؟
 *
 * القرار للحساب لا للجهاز (docs/repository-compat/BUNDLED_SOURCE_SEPARATION.md):
 *  - الحساب الموجود قبل الفصل (`accounts.created_at` من الخادم، حقل ثابت لا يُعدَّل) يحتفظ بكل
 *    المصادر التي كان يراها، بالمعرّفات نفسها (`pkg`، `pkg@lang`)، على هذا الجهاز وعلى أي جهاز جديد.
 *  - الحساب الجديد يبدأ بصفر مصادر، ويضيف ما يريد من صفحة الإضافات.
 *  - إضافة المستخدم أو إزالته لمصدر مدمج سابقًا تُحفظ في إعداداته المتزامنة (`settings.data`)
 *    بمفتاح مستقل لكل حزمة، فالدمج على مستوى الحقل في الخادم لا يُضيّع اختيار جهاز آخر.
 *  - لا شيء هنا يحذف: المكتبة والتقدّم والإعدادات لا تُلمس، فالإزالة تُخفي المصدر فقط.
 *  - لا يُستنتج «حساب جديد» من مخزن محلي فارغ: بلا صف الحساب من المزامنة الحالة «غير معروفة»،
 *    وفيها تبقى المصادر المدمجة ظاهرة كما كانت (الفصل لا يُحَسّ): الإخفاء لحساب ثبت أنه جديد فقط.
 *    كان «غير معروف» يخفيها، فأي تأخر في وصول صف الحساب أخفى كل مصادر المانجا عن مستخدم قديم.
 */

/** الحسابات المنشأة قبل هذه اللحظة هي «الحسابات الموجودة». تُؤكَّد عند نشر إصدار الفصل. */
export const BUNDLED_CUTOVER_MS = Date.UTC(2026, 10, 1);

/** بادئة مفاتيح اختيارات الحزم داخل `settings.data` (مفتاح لكل حزمة). */
export const CHOICE_PREFIX = 'srcpkg_';
export const NOT_ADDED = 'SOURCE_NOT_ADDED';

const KEY_RULE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const PKG_RULE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;

/** الحزمة من معرّف المصدر: `pkg`، `pkg@lang` (التكملة)، `pkg#sourceId` (من مستودع). */
export function packageOf(id) {
  return String(id ?? '').split('#')[0].split('@')[0];
}

/** مفتاح الإعداد المتزامن لحزمة، أو null إن لم يصلح مفتاحًا (طوله أو رموزه). */
export function choiceKey(pkg) {
  if (!PKG_RULE.test(String(pkg ?? ''))) return null;
  const key = CHOICE_PREFIX + String(pkg).replace(/\./g, '_');
  return KEY_RULE.test(key) ? key : null;
}

/** كل مصادر المانجا التي شُحنت داخل التطبيق حزم Keiyoushi بهذه البادئة (APK والويب بالمعرّف نفسه). */
const BUNDLED_PREFIX = 'eu.kanade.tachiyomi.extension.';

/**
 * مصدر كان يُشحن داخل التطبيق؟ ما ثبّته المستخدم من مستودع (`user`، `pkg#id`)، ومواقع الويب التي
 * أضافها (`user.<host>`)، وإضافات الويب (`addon|…`) ومصادر الأنمي المثبتة (`user-…`) ليست مدمجة.
 */
export function isBundled(def) {
  if (!def || def.user) return false;
  const id = String(def.id ?? def.sourceId ?? '');
  if (!id.startsWith(BUNDLED_PREFIX) || id.includes('#')) return false;
  return PKG_RULE.test(packageOf(id));
}

/** فوج الحساب من صفّه المتزامن، أو null إن لم يصل الصف بعد. */
export function cohortOf(account) {
  const at = Number(account?.created_at);
  if (!Number.isFinite(at) || at <= 0) return null;
  return at < BUNDLED_CUTOVER_MS ? 'legacy' : 'clean';
}

/** اختيارات الحساب من `settings.data` (نص JSON أو كائن). القيم غير الصالحة تُتجاهل. */
export function choicesOf(settings) {
  let data = settings;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
  const added = new Set(), removed = new Set();
  if (!data || typeof data !== 'object') return { added, removed };
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(CHOICE_PREFIX) || !value || typeof value !== 'object') continue;
    const pkg = String(value.pkg ?? '');
    if (choiceKey(pkg) !== key) continue;
    if (value.on === true) added.add(pkg);
    else if (value.on === false) removed.add(pkg);
  }
  return { added, removed };
}

/**
 * القرار الكامل: `{ state: 'legacy' | 'clean' | 'unknown', added, removed }`.
 * `standalone`: بلا خادم مزامنة ولا حساب (وضع «اقرأ بلا حساب»): لا حساب يثبت أنه جديد، فيبقى كما كان
 * قبل الفصل (المدمجة ظاهرة)، واختياراته محلية.
 */
export function decide({ account = null, settings = null, standalone = false } = {}) {
  const { added, removed } = choicesOf(settings);
  const state = standalone ? 'unknown' : cohortOf(account) ?? 'unknown';
  return { state, added, removed };
}

/** هل يظهر هذا المصدر لهذا الحساب؟ غير المدمج يظهر دائمًا. */
export function visible(def, decision = current) {
  if (!isBundled(def)) return true;
  const pkg = packageOf(def.id ?? def.sourceId);
  if (decision.removed.has(pkg)) return false;
  if (decision.added.has(pkg)) return true;
  // يُخفى عن حساب ثبت أنه أُنشئ بعد الفصل فقط؛ القديم وغير المعروف يبقيان كما كانا
  return decision.state !== 'clean';
}

/** حقول `settings.patch` لإضافة حزمة مدمجة سابقًا أو إزالتها من حساب. */
export function choicePatch(pkg, on, at = Date.now()) {
  const key = choiceKey(pkg);
  if (!key) throw new Error('معرّف الحزمة غير صالح');
  return { [key]: { pkg: String(pkg), on: Boolean(on), at } };
}

/** خطأ «أضف مصدرًا»: يُرمى حين يُطلب مصدر غير مضاف لهذا الحساب. */
export function notAddedError(id) {
  return Object.assign(new Error('هذا المصدر غير مضاف لحسابك. أضفه من صفحة الإضافات.'), { code: NOT_ADDED, sourceId: String(id ?? '') });
}

// ───────────── الحالة الحالية للتطبيق (يضبطها app.js من المزامنة) ─────────────

let current = { state: 'unknown', added: new Set(), removed: new Set() };
const listeners = new Set();
const signature = (d) => `${d.state}|${[...d.added].sort()}|${[...d.removed].sort()}`;

export function entitlement() {
  return current;
}

/** يضبط القرار الحالي، ويُعلم المشتركين فقط إن تغيّر فعلًا. */
export function setEntitlement(next) {
  const value = { state: next?.state ?? 'unknown', added: new Set(next?.added ?? []), removed: new Set(next?.removed ?? []) };
  if (signature(value) === signature(current)) return false;
  current = value;
  for (const fn of listeners) { try { fn(current); } catch { /* مشترك معطوب لا يوقف الباقي */ } }
  return true;
}

export function onEntitlementChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** يرمي «أضف مصدرًا» إن كان المصدر مدمجًا سابقًا وغير مضاف لهذا الحساب. */
export function assertVisible(def) {
  if (!visible(def)) throw notAddedError(def?.id ?? def?.sourceId);
}

/** الحزم المدمجة الظاهرة الآن من قائمة مصادر، لإعلام المحرك الأصلي بما يحمّله مسبقًا. */
export function visiblePackages(list, decision = current) {
  return [...new Set((list ?? []).filter((d) => isBundled(d) && visible(d, decision)).map((d) => packageOf(d.id)))].sort();
}

// ───────────── إضافة/إزالة حزمة من الواجهة ─────────────

const LOCAL_KEY = 'vantara.sourcePackages.local';
let writer = null;

/** app.js يضبط الكاتب: `settings.patch` للحساب، أو تخزين الجهاز في وضع «اقرأ بلا حساب». */
export function setChoiceWriter(fn) {
  writer = typeof fn === 'function' ? fn : null;
}

/** اختيارات وضع «بلا حساب» (لا حساب يُنسب إليه شيء، فتبقى على الجهاز). */
export function readLocalChoices(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(LOCAL_KEY) ?? '{}') ?? {}; } catch { return {}; }
}

export function writeLocalChoices(fields, storage = globalThis.localStorage) {
  const next = { ...readLocalChoices(storage), ...fields };
  storage?.setItem(LOCAL_KEY, JSON.stringify(next));
  return next;
}

/** يضيف حزمة مدمجة سابقًا لحساب المستخدم أو يزيلها منه. لا يحذف مكتبة ولا تقدّمًا. */
export async function choosePackage(pkg, on) {
  if (!writer) throw new Error('الحساب غير جاهز بعد، حاول بعد لحظة');
  await writer(choicePatch(pkg, on));
  // الاختيار يُطبَّق هنا فورًا لا بعد رجوعه من المزامنة: كانت «تثبيت» تبقى ظاهرة بعد الضغط حتى تدور المزامنة
  const added = new Set(current.added), removed = new Set(current.removed);
  if (on) { added.add(String(pkg)); removed.delete(String(pkg)); } else { removed.add(String(pkg)); added.delete(String(pkg)); }
  setEntitlement({ state: current.state, added, removed });
}
