/**
 * حالات المصدر في التشخيص، منفصلة لأن علاج كل واحدة مختلف:
 *
 *   SOURCE_TIMEOUT             لم يرد في المهلة (الشبكة أو الموقع بطيء)
 *   SOURCE_ERROR               ردّ بخطأ (حجب، تغيّر الموقع، تبريد بعد أعطال)
 *   SOURCE_RESPONDED_NO_MATCH  ردّ، لكن لا نسخة فيه لهذا العمل بعينه
 *   NO_SERVER_CANDIDATES       وجدنا العمل، ولا سيرفرات في صفحته
 *   RESOLVER_FAILED            سيرفرات موجودة، ولم يُستخرج منها رابط
 *   ZERO_PLAYABLE              روابط استُخرجت، ولم يجتز أيٌّ منها فحص التشغيل
 *   PLAYABLE                   رابط واحد على الأقل يعمل فعلًا
 *
 * «المصدر لم يرد» تُقال فقط لـSOURCE_TIMEOUT: مصدرٌ ردّ ولم نطابق فيه شيئًا
 * ليس مصدرًا صامتًا.
 */

export const STATE = Object.freeze({
  SEARCHING: 'SEARCHING',
  SOURCE_TIMEOUT: 'SOURCE_TIMEOUT',
  SOURCE_ERROR: 'SOURCE_ERROR',
  SOURCE_RESPONDED_NO_MATCH: 'SOURCE_RESPONDED_NO_MATCH',
  MATCHED: 'MATCHED',
  NO_SERVER_CANDIDATES: 'NO_SERVER_CANDIDATES',
  RESOLVER_FAILED: 'RESOLVER_FAILED',
  ZERO_PLAYABLE: 'ZERO_PLAYABLE',
  PLAYABLE: 'PLAYABLE',
});

export const STATE_AR = Object.freeze({
  SEARCHING: 'يبحث…',
  SOURCE_TIMEOUT: 'لم يرد في الوقت',
  SOURCE_ERROR: 'ردّ بخطأ',
  SOURCE_RESPONDED_NO_MATCH: 'ردّ، ولا يوجد فيه هذا العمل',
  MATCHED: 'وجدنا العمل',
  NO_SERVER_CANDIDATES: 'وجدنا العمل بلا سيرفرات',
  RESOLVER_FAILED: 'السيرفرات لم تُخرج رابطًا',
  ZERO_PLAYABLE: 'لا رابط اجتاز فحص التشغيل',
  PLAYABLE: 'يعمل',
});

const TIMEOUT = /timeout|timed out|لم يرد|لم يُحمَّل|لم تُحمَّل|مهلة|deadline/i;

/** خطأ نصي من المحرك (Kotlin أو الـPWA) → مهلة أم خطأ. */
export const errorState = (error) => (TIMEOUT.test(String(error ?? '')) ? STATE.SOURCE_TIMEOUT : STATE.SOURCE_ERROR);

/**
 * حالة بحث مصدر واحد من سجل الـlocator (`found.sources[id]`):
 * {error, skipped, items, matched}.
 */
export function searchState(s) {
  if (!s) return STATE.SEARCHING;
  if (s.matched > 0) return STATE.MATCHED;
  if (s.skipped) return STATE.SOURCE_ERROR;
  if (s.error) return errorState(s.error);
  return STATE.SOURCE_RESPONDED_NO_MATCH;
}

/**
 * حالة التشغيل لمصدر وُجد فيه العمل، من مسارات جلسة التجهيز:
 * route = {state: RESOLVING|READY|UNAVAILABLE|FAILED, probed, sourceId}.
 * `done`: انتهى التجهيز (فلا «يبحث» بعدها).
 */
export function playState(routes = [], { done = true } = {}) {
  if (routes.some((r) => r.state === 'READY' && r.probed === true)) return STATE.PLAYABLE;
  if (!done) return STATE.SEARCHING;
  if (!routes.length) return STATE.NO_SERVER_CANDIDATES;
  if (routes.some((r) => r.state === 'READY')) return STATE.ZERO_PLAYABLE;
  return STATE.RESOLVER_FAILED;
}

/**
 * خلاصة البحث لعمل كامل (لسطر صفحة العمل):
 *   - لا مصدر ردّ: مهلة/خطأ.
 *   - ردّ واحد على الأقل بلا مطابقة: SOURCE_RESPONDED_NO_MATCH.
 */
export function overallSearchState(sources = {}) {
  const states = Object.values(sources).map(searchState);
  if (states.includes(STATE.MATCHED)) return STATE.MATCHED;
  if (states.includes(STATE.SOURCE_RESPONDED_NO_MATCH)) return STATE.SOURCE_RESPONDED_NO_MATCH;
  if (states.includes(STATE.SOURCE_ERROR)) return STATE.SOURCE_ERROR;
  if (states.includes(STATE.SOURCE_TIMEOUT)) return STATE.SOURCE_TIMEOUT;
  return STATE.SEARCHING;
}

/** سبب رفض نسخة (من judgeCopy) بالعربية. */
export const REJECT_AR = Object.freeze({
  kind: 'نوع مختلف (فيلم/مسلسل)',
  collection: 'صفحة تجميع لا عمل واحد',
  title: 'الاسم لا يطابق',
  year: 'سنة عمل آخر',
  'year-unconfirmed': 'اسم أطول بلا سنة تؤكده',
  season: 'موسم آخر',
  ambiguous: 'اسم يحمله عمل أشهر، بلا سنة تميّزه',
  'other-work': 'اسم عمل آخر بعينه',
});
