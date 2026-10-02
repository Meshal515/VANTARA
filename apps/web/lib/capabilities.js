/**
 * القرار الواحد: هل تُعرض هذه الميزة هنا؟
 *
 *   supports('rafiq')          قدرة المنصة (من RELEASE.features)
 *   supports('pwaCinema')      مفتاح ميزة (من RELEASE.flags)، بحسب المنصة والحساب
 *
 * الواجهة تسأل هذا وحده، لا `isPwa` ولا `isAndroid`. ميزة غير مدعومة تُخفى
 * نظيفة (لا زرّ ميت، ولا «غير مدعوم» في كل مكان). منصة جديدة أو ميزة جديدة
 * = سطر في `lib/release.js`، لا تعديل في الشاشات.
 */

import { RELEASE } from './release.js';
import { isNative } from '../pwa/platform.js';

let account = null;

/** الحساب الداخل على هذا الجهاز من جلسة المزامنة المحفوظة (`vantara.user`). */
function storedUsername() {
  try {
    const user = JSON.parse(globalThis.localStorage?.getItem('vantara.user') ?? 'null');
    return user?.username ? String(user.username).toLowerCase() : null;
  } catch {
    return null;
  }
}

/** 'apk' داخل التطبيق الأصلي، و'pwa' في المتصفح. */
export function currentPlatform(g = globalThis) {
  return isNative(g) ? 'apk' : 'pwa';
}

/** الحساب الحالي (اسم المستخدم) لمفاتيح الحسابات. يضبطه app.js بعد الدخول. */
export function setCapabilityAccount(username) {
  account = username ? String(username).toLowerCase() : null;
}

function flagOn(flag, platform, user) {
  if (!flag || flag.enabled === false) return false;
  if (Array.isArray(flag.platforms) && !flag.platforms.includes(platform)) return false;
  if (Array.isArray(flag.accounts) && !(user && flag.accounts.map((a) => a.toLowerCase()).includes(user))) return false;
  return true;
}

/**
 * @param {string} name ميزة أو مفتاح
 * @param {{ platform?: 'apk'|'pwa', account?: string|null, release?: typeof RELEASE }} [opts]
 */
export function supports(name, { platform = currentPlatform(), account: user = account ?? storedUsername(), release = RELEASE } = {}) {
  const feature = release.features[name];
  const flag = release.flags[name];
  if (!feature && !flag) return false;
  if (feature && !feature.includes(platform)) return false;
  if (flag && !flagOn(flag, platform, user ? String(user).toLowerCase() : null)) return false;
  return true;
}

/** كل ما تدعمه المنصة الآن (للتشخيص والإعدادات). */
export function supportedList(opts = {}) {
  const release = opts.release ?? RELEASE;
  return [...new Set([...Object.keys(release.features), ...Object.keys(release.flags)])].filter((n) => supports(n, opts)).sort();
}
