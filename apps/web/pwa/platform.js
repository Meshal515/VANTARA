/**
 * أين تعمل الواجهة الآن: داخل الـAPK أم في المتصفح (PWA).
 *
 * الـAPK يحقن `window.Capacitor` قبل أول سطر JS، ومعه `isNativePlatform()`.
 * المتصفح لا يحمل Capacitor أصلًا. فالسؤال يُجاب من الجسر نفسه لا من عنوان
 * الصفحة أو وكيل المتصفح، وهما يكذبان (WebView أندرويد يقدّم من localhost).
 *
 * قاعدة VANTARA: **كل ما هو للـPWA يمرّ من هنا، وجوابه داخل الـAPK دائمًا
 * `false`.** فلا سطر ويب يغيّر سلوك التطبيق الأصلي. الحارس في
 * `tools/repository-safety.test.mjs` يمنع استيراد وحدات `pwa/` خارج هذه
 * البوابة.
 */

/** هل الواجهة داخل التطبيق الأصلي (أندرويد/iOS عبر Capacitor)؟ */
export function isNative(g = globalThis) {
  const cap = g?.Capacitor;
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform() === true;
    const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : null;
    return platform === 'android' || platform === 'ios';
  } catch {
    // جسر موجود لكنه رمى: الأسلم أن نعامله كأصلي فلا يُحقن فيه شيء من الويب
    return true;
  }
}

/** هل هذه نسخة المتصفح (PWA)؟ عكس [isNative] تمامًا، ولا حالة ثالثة. */
export const isWeb = (g = globalThis) => !isNative(g);

/**
 * ميزات مخفية من الـPWA بقرار المالك (لا لأنها معطّلة):
 *   - rafiq: مساعد التوصيات.
 *   - translation: ترجمة المانجا (كل أزرارها وإعداداتها).
 * داخل الـAPK كلها ظاهرة كما هي.
 */
export const WEB_HIDDEN = Object.freeze(['rafiq', 'translation']);

export function hiddenOnThisPlatform(feature, g = globalThis) {
  return isWeb(g) && WEB_HIDDEN.includes(feature);
}

/**
 * إضافة الويب البديلة لإضافة Capacitor بالاسم (`ExtensionEngine`، `AnimeEngine`)،
 * أو `null`. داخل الـAPK دائمًا `null`: الإضافة الأصلية وحدها.
 */
export function webPlugin(name, g = globalThis) {
  if (isNative(g)) return null;
  return g?.VantaraWeb?.[name] ?? null;
}
