/**
 * صور المصادر في الـPWA (أغلفة وصفحات فصول).
 *
 * مع service worker فعّال: `/__img?u=…&r=…` وهو يخدمها من كاش الصور أولًا
 * (sw.js → sourceImage)، فالصورة التي رأيتها مرة تفتح فورًا وبلا اتصال.
 * بلا service worker (أول زيارة قبل التفعيل، أو متصفح يمنعه): رابط الجالب
 * المباشر، وكاش HTTP في المتصفح يحفظها أسبوعًا.
 *
 * الـSW لا يعرف الجالب ولا الإذن إلا مما تكتبه هنا `publishConfig()`.
 */

const CONFIG_CACHE = 'vantara-pwa-config';

export async function publishConfig({ fetchBase, grant }, cachesImpl = globalThis.caches) {
  if (!cachesImpl || !fetchBase || !grant) return false;
  try {
    const cache = await cachesImpl.open(CONFIG_CACHE);
    await cache.put('/__pwa/config', new Response(JSON.stringify({ fetchBase, grant }), { headers: { 'content-type': 'application/json' } }));
    return true;
  } catch {
    return false;
  }
}

export function controlled(nav = globalThis.navigator) {
  return Boolean(nav?.serviceWorker?.controller);
}

/**
 * رابط يضعه `<img src>` مباشرة.
 * @param {string} url رابط الصورة عند المصدر
 * @param {string|null} referer المرجع الذي تشترطه مضيفة الصورة
 * @param {{ mediaUrl: (u: string, r?: string|null) => string }} fetcher
 */
export function imageSrc(url, referer, fetcher, nav = globalThis.navigator) {
  if (!url || !/^https?:\/\//.test(url)) return url ?? '';
  if (controlled(nav)) {
    const params = new URLSearchParams({ u: url });
    if (referer) params.set('r', referer);
    return `/__img?${params}`;
  }
  return fetcher.mediaUrl(url, referer);
}

/** حجم كاش الصور تقريبًا (للإعدادات): عدد الصور، والاستخدام الكلي للموقع. */
export async function imageCacheInfo(cachesImpl = globalThis.caches, nav = globalThis.navigator) {
  let count = 0;
  try {
    count = (await (await cachesImpl.open('vantara-img-v1')).keys()).length;
  } catch {
    // لا كاش بعد
  }
  let usage = null;
  let quota = null;
  try {
    ({ usage = null, quota = null } = (await nav?.storage?.estimate?.()) ?? {});
  } catch {
    // بلا تقدير
  }
  return { count, usage, quota };
}

export async function clearImageCache(cachesImpl = globalThis.caches) {
  try {
    const cache = await cachesImpl.open('vantara-img-v1');
    const keys = await cache.keys();
    await Promise.all(keys.map((k) => cache.delete(k)));
    return keys.length;
  } catch {
    return 0;
  }
}

/** يطلب من المتصفح ألا يمسح بيانات الموقع عند ضيق التخزين (iOS/Chrome). */
export async function requestPersistence(nav = globalThis.navigator) {
  try {
    if (await nav?.storage?.persisted?.()) return true;
    return Boolean(await nav?.storage?.persist?.());
  } catch {
    return false;
  }
}
