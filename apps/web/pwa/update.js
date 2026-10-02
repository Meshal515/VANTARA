/**
 * تحديث الـPWA بلا كسر الجلسة.
 *
 *   نسخة جديدة على الخادم ← الـservice worker الجديد ينزّل القشرة كاملة في الخلفية
 *   (ذرّيًا: فشل ملف واحد ⇒ تبقى النسخة الحالية تعمل كما هي).
 *   جهزت ← «تحديث جديد متاح» بزرّ «تحديث». لا شيء يُطبَّق فجأة وأنت تقرأ أو تشاهد.
 *   ضغطت ← العامل الجديد يتفعّل ← إعادة تحميل واحدة ← البيانات تُرحَّل
 *   (lib/migrations.js) قبل أن تُقرأ.
 *   ما ضغطت ← يتفعّل وحده في الإقلاع التالي بعد إغلاق التطبيق.
 *
 * داخل الـAPK لا يُستعمل هذا: للـAPK نظام تحديثه (lib/updater.js).
 */

const CHECK_EVERY_MS = 30 * 60 * 1000;
const UPDATED_KEY = 'vantara.web.updatedAt';

/**
 * @param {ServiceWorkerRegistration} registration
 * @param {{ onReady: (apply: () => void) => void }} deps
 */
export function watchForUpdates(registration, { onReady, nav = globalThis.navigator, doc = globalThis.document } = {}) {
  if (!registration) return () => {};
  let announced = null;

  const announce = (worker) => {
    if (!worker || announced === worker || !nav.serviceWorker?.controller) return;
    announced = worker;
    onReady(() => {
      try {
        globalThis.localStorage?.setItem(UPDATED_KEY, String(Date.now()));
      } catch {
        // التذكير بالجديد تحسين فقط
      }
      worker.postMessage('skip-waiting');
    });
  };

  const track = (worker) => {
    if (!worker) return;
    if (worker.state === 'installed') announce(worker);
    worker.addEventListener('statechange', () => worker.state === 'installed' && announce(worker));
  };

  track(registration.waiting);
  registration.addEventListener('updatefound', () => track(registration.installing));

  const check = () => void registration.update().catch(() => {});
  const timer = setInterval(check, CHECK_EVERY_MS);
  const onVisible = () => doc.visibilityState === 'visible' && check();
  doc.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisible);
  };
}

/** هل هذا أول إقلاع بعد تحديث طبّقه الشخص؟ (لعرض «ما الجديد» مرة). يمسح العلامة. */
export function justUpdated(storage = globalThis.localStorage) {
  try {
    const at = Number(storage?.getItem(UPDATED_KEY));
    if (!at) return false;
    storage.removeItem(UPDATED_KEY);
    return Date.now() - at < 5 * 60 * 1000;
  } catch {
    return false;
  }
}
