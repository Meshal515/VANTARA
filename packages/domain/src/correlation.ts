/**
 * معرّف الربط — الخيط بين «التطبيق ما اشتغل» وسطرٍ في السجلّ.
 *
 * بوابة B10 نصّها: كل خطأ رئيسي له معرّف، ويمكن ربط بلاغ المستخدم به. وبلا
 * ذلك يبقى التشخيص تخمينًا على الوقت: بلاغٌ عند 3:14 وسجلٌّ فيه مئة سطر في
 * تلك الدقيقة.
 *
 * والقاعدة الوحيدة هنا: **ما يأتي من العميل لا يُصدَّق كما جاء.** المعرّف
 * ينتهي في سجلٍّ يُقرأ وفي عمود يُخزَّن، فنصٌّ بلا حدّ يفتح حقن سطور في
 * السجلّ وتضخيم تخزين بلا مقابل. فيُقبل شكلٌ واحد ضيّق، وما خالفه يُستبدل
 * بمعرَّف جديد بلا اعتراض — الغرض التتبّع لا التحقق من هوية.
 */

/** الشكل المقبول: حروف وأرقام وشرطتان، وطول معقول لمعرّف. */
const SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

export function isCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && SHAPE.test(value);
}

/**
 * معرّف جديد.
 *
 * `randomUUID` حين يوجد — وهو موجود في Workers وNode 22 — وإلا بديلٌ من
 * `getRandomValues`. ولا `Math.random`: المعرّف يُقارن ويُبحث به، وتصادمٌ
 * فيه يربط بلاغًا بخطأ ليس له.
 */
export function newCorrelationId(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else throw new Error('no crypto source for a correlation id');
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * المعرّف الذي يُعتمد لهذا الطلب: ما أرسله العميل إن صحّ شكله، وإلا جديد.
 *
 * قبولُ معرّف العميل مقصود: الواجهة تعرف أي نداء فشل عندها، فحملُ المعرّف
 * معها يربط الشاشة بالسجلّ بلا جولة ثانية.
 */
export function correlationIdFrom(headerValue: unknown): string {
  if (Array.isArray(headerValue)) return correlationIdFrom(headerValue[0]);
  return isCorrelationId(headerValue) ? headerValue : newCorrelationId();
}

/** اسم الترويسة، في مكان واحد حتى لا تتباعد أطرافها. */
export const CORRELATION_HEADER = 'x-correlation-id';
