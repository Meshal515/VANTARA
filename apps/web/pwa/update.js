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

import { appVersion } from '../lib/config.js';
import { RELEASE } from '../lib/release.js';

const CHECK_EVERY_MS = 30 * 60 * 1000;
const UPDATED_KEY = 'vantara.web.updatedAt';
const SEEN_BUILD_KEY = 'vantara.web.seenBuild';

function applyUpdate(worker) {
  try {
    globalThis.localStorage?.setItem(UPDATED_KEY, String(Date.now()));
  } catch {
    // لا يمنع التخزين المحجوب تطبيق التحديث.
  }
  worker.postMessage('skip-waiting');
}

/** فحص المستخدم للـPWA: لا يدّعي أن النسخة حديثة عند فشل الشبكة. */
export async function checkForUpdates(registration, { onReady = () => {} } = {}) {
  if (!registration) throw new Error('تعذّر الوصول لنظام تحديث PWA');
  await registration.update();
  if (registration.waiting) {
    const worker = registration.waiting;
    onReady(() => applyUpdate(worker));
    return 'available';
  }
  return registration.installing ? 'installing' : 'current';
}

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
    onReady(() => applyUpdate(worker));
  };

  const track = (worker) => {
    if (!worker) return;
    if (worker.state === 'installed') announce(worker);
    worker.addEventListener('statechange', () => worker.state === 'installed' && announce(worker));
  };

  track(registration.waiting);
  registration.addEventListener('updatefound', () => track(registration.installing));

  const check = () => void registration.update().catch(() => {});
  check();
  const timer = setInterval(check, CHECK_EVERY_MS);
  const onVisible = () => doc.visibilityState === 'visible' && check();
  doc.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisible);
  };
}

/** أول إقلاع ببناء جديد، أو بعد تطبيق التحديث يدويًا: يعرض «ما الجديد» مرة. */
export function justUpdated(storage = globalThis.localStorage, build = appVersion() ?? RELEASE.version, { nav = globalThis.navigator } = {}) {
  try {
    const previous = storage?.getItem(SEEN_BUILD_KEY);
    storage?.setItem(SEEN_BUILD_KEY, build);
    const at = Number(storage?.getItem(UPDATED_KEY));
    if (at) storage.removeItem(UPDATED_KEY);
    // نسخة مثبتة أقدم من seenBuild: اعرض سجل الإصلاح مرة دون اعتبار أول زيارة تحديثًا.
    return Boolean(previous ? previous !== build : nav?.serviceWorker?.controller) || Boolean(at && Date.now() - at < 5 * 60 * 1000);
  } catch {
    return false;
  }
}
