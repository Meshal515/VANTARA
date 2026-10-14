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

/** ويندوز يعلن منصته من preload المعزول، لا من user-agent أو عنوان الصفحة. */
export function isDesktop(g = globalThis) {
  const bridge = g?.VantaraDesktop;
  return bridge?.platform === 'windows' && typeof bridge.requestResource === 'function' &&
    typeof bridge.startPlayback === 'function' && typeof bridge.onEvent === 'function';
}

export const isWeb = (g = globalThis) => !isNative(g) && !isDesktop(g);

/** جسور desktop المستقلة؛ لا تنشئ Capacitor ولا محركات PWA. */
export function desktopPlugin(name, g = globalThis) {
  return isDesktop(g) ? g?.VantaraDesktopBridges?.[name] ?? null : null;
}

/** المحركات مشتركة، وتُحمّل من بوابة المنصة داخل ويندوز وحده. */
export async function loadDesktopSources(g = globalThis) {
  if (!isDesktop(g)) return null;
  const [registry, engines, hosts, manga, cache] = await Promise.all([
    import('./sources/registry.js'), import('./sources/engines/index.js'),
    import('./sources/hosts.js'), import('./bridges/manga.js'),import('./cache/store.js'),
  ]);
  return {createRegistry:registry.createRegistry,engines:engines.ENGINES,createHostResolver:hosts.createHostResolver,MangaEngine:manga.MangaEngine,createStore:cache.createStore};
}

/**
 * إضافة الويب البديلة لإضافة Capacitor بالاسم (`ExtensionEngine`، `AnimeEngine`)،
 * أو `null`. داخل الـAPK دائمًا `null`: الإضافة الأصلية وحدها.
 */
export function webPlugin(name, g = globalThis) {
  if (isNative(g)) return null;
  if (isDesktop(g)) return null;
  return g?.VantaraWeb?.[name] ?? null;
}
