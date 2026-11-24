import { adultSource } from './adult-filter.js';
/**
 * سياسة المصادر (قرار المالك، 22 نوفمبر): فانتارا عربي أولًا، والمصادر الأخرى تخدمه ولا تُغرقه.
 *
 * - `arabic`  عربي آمن (SAFE): يبني المكتبة — الرئيسية و«آخر التحديثات» والأقسام والبحث.
 * - `foreign` إنجليزي أو غيره آمن (SAFE): البحث المقصود وحده (بوسم لغته)، ويكمّل فصول الأعمال الموجودة.
 * - `mixed`   مختلط (MIXED في فهرس مستودعه، عربيًا كان أو غيره) أو مجهول التصنيف: لا يبني بطاقة ولا يظهر في
 *             أي قائمة أو بحث. وظيفته الوحيدة إثراء عمل موجود من مصدر آمن، بعد تأكيد صفحة تفاصيله ونظافتها.
 * - `blocked` متخصص في الإباحية: لا يُستعمل أبدًا.
 *
 * الجهاز يعرف تصنيف مصادره من بيانها (`warning`، `lang`). ومصدر لا يعرفه (من جهاز آخر، أو في الخادم) يُحكم عليه
 * من معرّفه وحده، بتشدد: المدمج العربي (`teamx` أو حزمة `extension.ar.` بلا `#` ولا `@`) عربي، وكل ما سواه مختلط.
 */
export const ARABIC = 'arabic';
export const FOREIGN = 'foreign';
export const MIXED = 'mixed';
export const BLOCKED = 'blocked';

const langOfId = (id) => /@([a-z]{2,3}(?:-[a-z0-9]{2,4})?)$/i.exec(id)?.[1]?.toLowerCase()
  ?? /\.extension\.([a-z]{2,3}(?:-[a-z0-9]{2,4})?|all)\./i.exec(id)?.[1]?.toLowerCase() ?? null;

/** تصنيف مصدر من بيانه كما يعطيه المحرك (`{ id, warning, lang, filler, user, nsfw }`). */
export function sourceTier(source) {
  if (!source || !source.id) return MIXED;
  if (adultSource(source)) return BLOCKED;
  const id = String(source.id);
  const warning = String(source.warning ?? '').toUpperCase();
  if (warning === 'MIXED' || source.nsfw === true) return MIXED;
  // مثبّت من مستودع بلا تصنيف معلن: مجهول، فلا يُعرض حتى يُعرف
  if (warning !== 'SAFE' && (source.user || /[#@]/.test(id))) return MIXED;
  const lang = String(source.lang ?? langOfId(id) ?? 'ar').toLowerCase();
  return lang === 'ar' && !source.filler && !id.includes('@') ? ARABIC : FOREIGN;
}

/** حكم بالمعرّف وحده (مصدر جهاز آخر، أو الخادم): المدمج العربي وحده عربي، والباقي مختلط. */
export function tierFromId(sourceId) {
  const id = String(sourceId ?? '');
  if (!id) return MIXED;
  if (adultSource({ id })) return BLOCKED;
  if (/[#@]/.test(id)) return MIXED;
  if (!id.includes('.')) return ARABIC;
  return /\.extension\.ar\./i.test(id) ? ARABIC : MIXED;
}

const tiers = new Map();
/** يحفظ تصنيف مصادر هذا الجهاز من بيان المحرك. */
export function noteSourceTiers(list) {
  for (const source of list ?? []) if (source?.id) tiers.set(String(source.id), sourceTier(source));
}
/** تصنيف مصدر: من بيانه إن عرفه الجهاز، وإلا من معرّفه بتشدد. */
export const knownSourceTier = (sourceId) => tiers.get(String(sourceId ?? '')) ?? null;
export function tierOf(sourceId) {
  return knownSourceTier(sourceId) ?? tierFromId(sourceId);
}
/** يبني المكتبة: الرئيسية و«آخر التحديثات» والأقسام. */
export const buildsLibrary = (sourceId) => tierOf(sourceId) === ARABIC;
/** يظهر في البحث المقصود. */
export const searchable = (sourceId) => { const t = tierOf(sourceId); return t === ARABIC || t === FOREIGN; };
/** إثراء فقط: لا بطاقة ولا قائمة. */
export const enrichOnly = (sourceId) => tierOf(sourceId) === MIXED;

/** للاختبارات. */
export function _resetSourceTiers() { tiers.clear(); }
