/** تحديث PWA يبدأ من الإعدادات فقط، والتطبيق بعد تأكيد المستخدم. */

const UPDATED_KEY = 'vantara.web.updatedAt';
const manualDownloads = new WeakMap();

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
  const worker = registration.installing;
  if (!worker) return 'current';
  // تابع فقط التنزيل الذي طلبه المستخدم، دون الاشتراك في تحديثات لاحقة.
  if (!manualDownloads.has(worker)) {
    const installed = () => {
      if (worker.state !== 'installed') return;
      worker.removeEventListener?.('statechange', installed);
      const ready = manualDownloads.get(worker);
      manualDownloads.delete(worker);
      ready?.(() => applyUpdate(worker));
    };
    manualDownloads.set(worker, onReady);
    worker.addEventListener('statechange', installed);
    installed();
  }
  return 'installing';
}

/** توافق مع الاستدعاءات القديمة: الإقلاع لا يفحص ولا يعرض تحديثات. */
export function watchForUpdates() {
  return () => {};
}

/** النتيجة بعد إعادة التحميل تظهر فقط لتحديث أكده المستخدم. */
export function justUpdated(storage = globalThis.localStorage) {
  try {
    const at = Number(storage?.getItem(UPDATED_KEY));
    if (at) storage.removeItem(UPDATED_KEY);
    return Boolean(at && Date.now() - at >= 0 && Date.now() - at < 5 * 60 * 1000);
  } catch {
    return false;
  }
}
