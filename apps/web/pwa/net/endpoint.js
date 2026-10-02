/**
 * عنوان جالب الويب (services/web-fetcher). للـPWA وحدها.
 *
 * ليس سرًّا: الجالب يرفض أي طلب بلا توكن دخول صحيح. ويُعدَّل للتجربة من
 * `localStorage['vantara.fetch.url']` بلا بناء جديد.
 */
export const PRODUCTION_FETCH = 'https://vantara-fetch.ngm-309.workers.dev';
const OVERRIDE_KEY = 'vantara.fetch.url';

export function fetchBase(storage = globalThis.localStorage) {
  try {
    const override = storage?.getItem(OVERRIDE_KEY);
    if (override && /^https?:\/\//.test(override)) return override.replace(/\/+$/, '');
  } catch {
    // تخزين محجوب: الافتراضي
  }
  return PRODUCTION_FETCH;
}
