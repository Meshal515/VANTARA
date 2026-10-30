/**
 * الإخفاق الشفاف للإضافات والمصادر (docs/addons/PERSISTENT_PLUGINS.md §3.4، قرار 25).
 *
 * لكل فشل سبب عربي واحد يُعرض كما هو، ويقول بصراحة من أين جاء: من الموقع، أو من الشبكة، أو من
 * VANTARA نفسه. الإلغاء ليس نجاحًا ولا عطلًا: له حالته الخاصة ولا يُحسب على أحد. الأسباب العامة
 * من مصدر الحقيقة الواحد (route-validity.js FAILURES)، فلا تختلف الصياغة بين الشاشات.
 */
import { FAILURES, failureCode, failureText } from './route-validity.js';

export const ORIGIN = Object.freeze({ SITE: 'site', NETWORK: 'network', VANTARA: 'vantara', EXTENSION: 'extension', UNSUPPORTED: 'unsupported', USER: 'user', UNKNOWN: 'unknown' });
const SITE = '(الخلل من الموقع لا من VANTARA)';

/** جملة رد HTTP من موقع المصدر، والرقم فيها (HTTP nnn) لأن شاشات التشخيص تقرؤه. */
export function siteStatusMessage(status) {
  const s = Number(status);
  if (s === 404 || s === 410) return `${FAILURES.REMOVED.text} (HTTP ${s})`;
  if (s === 401) return `${FAILURES.SESSION.text} (HTTP ${s})`;
  if (s === 403) return `موقع المصدر رفض الطلب (HTTP 403) ${SITE}`;
  if (s === 429) return `موقع المصدر يطلب تخفيف الطلبات (HTTP 429) ${SITE}`;
  if (s >= 500 && s <= 599) return `${FAILURES.SITE_DOWN.text} (HTTP ${s})`;
  return `موقع المصدر ردّ بخطأ (HTTP ${s}) ${SITE}`;
}

/**
 * `{ code, text, origin, cancelled }` لأي خطأ من المحرك أو الإضافة أو الجالب.
 * لا يُرجع أبدًا نجاحًا، ولا نصًا فارغًا، ولا رابطًا (قد يحمل الرابط سرًا).
 */
export function describeFailure(error) {
  if (error?.name === 'AbortError' || error?.code === 'aborted' || error?.code === 'ABORTED')
    return { code: 'CANCELLED', text: 'أُلغي الطلب قبل اكتماله', origin: ORIGIN.USER, cancelled: true };
  const code = error?.code;
  const plain = (text, origin, c = code ?? 'FAILED') => ({ code: c, text: String(text).replace(/(?:https?|stremio):\/\/\S+/gi, '[رابط]').slice(0, 240), origin, cancelled: false });
  if (code === 'HOST_COOLING') return plain(error.message, ORIGIN.SITE);
  if (code === 'challenge') return plain(FAILURES.VERIFY.text, ORIGIN.SITE, 'VERIFY');
  if (code === 'host_not_allowed') return plain('نسخة المتصفح لا تفتح هذا الموقع؛ افتحه من التطبيق أو برنامج الويندوز', ORIGIN.VANTARA);
  if (code === 'signed_out' || code === 'unauthorized') return plain('سجّل دخولك لفتح المصادر من نسخة الويب', ORIGIN.VANTARA);
  if (code === 'rate_limited') return plain('جالب VANTARA مشغول الآن؛ أعد المحاولة بعد لحظة', ORIGIN.VANTARA);
  if (code === 'source_unavailable' || code === 'SOURCE_NOT_ADDED') return plain(error.message, ORIGIN.VANTARA);
  if (code === 'network' || code === 'timeout' || error?.name === 'TimeoutError') return plain(FAILURES.NETWORK.text, ORIGIN.NETWORK, 'NETWORK');
  if (code === 'INVALID_RESPONSE' || code === 'bad_json' || /مخالفة للعقد|JSON صالحًا|بيانات غير صالحة/.test(String(error?.message)))
    return plain('الموقع غيّر شكل صفحاته فلم تعد الإضافة تفهمها؛ تحتاج تحديثًا', ORIGIN.SITE, 'CONTRACT');
  // المحرك الأصلي (ExtensionFailure.kt) يصنّف العطل بنفسه ويرسل مالكه وسببه العربي: يُعرض كما هو
  const owner = error?.data?.owner;
  if (['site', 'vantara', 'extension', 'unsupported'].includes(owner) && /[؀-ۿ]/.test(String(error?.message ?? '')))
    return plain(error.message, owner);
  const status = Number(error?.status);
  if (Number.isInteger(status) && status >= 400 && status <= 599) return plain(siteStatusMessage(status), ORIGIN.SITE, `HTTP_${status}`);
  const message = String(error?.message ?? error ?? '');
  const known = failureCode(message);
  if (known) return plain(failureText(message), known === 'NETWORK' ? ORIGIN.NETWORK : ORIGIN.SITE, known);
  // ما لا نعرف مصدره لا يُنسب لأحد تخمينًا
  return plain(/[؀-ۿ]/.test(message) ? message : 'تعذّر إكمال الطلب (سبب غير معروف)', ORIGIN.UNKNOWN);
}
