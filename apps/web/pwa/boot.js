/**
 * إقلاع الـPWA: يركّب جسور الويب مكان إضافات Capacitor الأصلية.
 *
 * داخل الـAPK لا يفعل شيئًا إطلاقًا (أول سطر)، فلا يتغيّر فيه سلوك. وفي
 * المتصفح يضع `globalThis.VantaraWeb` بواجهات خفيفة تستورد الجسر الحقيقي
 * عند أول نداء فقط: الإقلاع لا يدفع ثمن محركات المصادر.
 *
 * `lib/extension-engine.js` و`lib/anime-engine.js` يسألان الجسر الأصلي أولًا،
 * ثم هذا عبر `webPlugin()` في pwa/platform.js.
 */

import { isNative } from './platform.js';

/** واجهة كسولة: كل دالة تنتظر تحميل الوحدة ثم تنادي نظيرتها. */
function lazyPlugin(load, pick) {
  let mod = null;
  const get = async () => pick((mod ??= await load()));
  return new Proxy(
    {},
    {
      get(_, method) {
        if (method === 'then') return undefined; // ليس وعدًا
        return async (...args) => {
          const target = await get();
          const fn = target?.[method];
          if (typeof fn !== 'function') throw new Error(`${String(method)} غير متاح في نسخة الويب`);
          return fn.apply(target, args);
        };
      },
    },
  );
}

export function installWebBridges(g = globalThis) {
  if (isNative(g) || g.VantaraWeb) return g.VantaraWeb ?? null;
  const runtime = () => import('./runtime.js');
  g.VantaraWeb = Object.freeze({
    ExtensionEngine: lazyPlugin(() => import('./bridges/manga.js'), (m) => m.MangaEngine),
    AnimeEngine: lazyPlugin(() => import('./bridges/anime.js'), (m) => m.AnimeEngine),
    AddonFabric: { runtime },
    attachAuth: (auth) => void runtime().then((m) => m.attachAuth(auth)),
  });
  return g.VantaraWeb;
}

installWebBridges();
