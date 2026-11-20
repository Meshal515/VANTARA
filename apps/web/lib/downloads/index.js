/**
 * نقطة دخول التنزيلات: مدير واحد للتطبيق، بمحركاته حسب المنصة.
 *
 *   Android APK : المانجا (صفحات في مخزن التطبيق) + الفيديو (خدمة VantaraDownloads الأصلية).
 *   Windows     : المانجا + الفيديو حين يعلن جسر سطح المكتب قدرته (Downloads).
 *   Web / PWA   : المانجا وحدها. لا تنزيل فيديو في المتصفح قبل محرك مصادر مناسب.
 *
 * القدرة تُقرأ من الجسر الموجود فعلًا، لا من اسم المنصة: زر لا يعمل لا يُعرض.
 */

import * as animeEngine from '../anime-engine.js';
import * as mangaEngine from '../extension-engine.js';
import { desktopPlugin, isDesktop, isNative } from '../../pwa/platform.js';
import { createDownloadManager, DEFAULT_PARALLEL } from './manager.js';
import { ACTIVE_STATES, unitLabel } from './model.js';
import { createMangaDriver } from './manga-driver.js';
import { memoryStore, openStore } from './store.js';
import { createVideoDriver } from './video-driver.js';

const SETTINGS_KEY = 'vantara.downloads.settings';

/** الجسر الأصلي لتنزيل الفيديو، أو null حيث لا يوجد. */
export function nativeDownloads(g = globalThis) {
  // جسر بديل لاختبارات الواجهة في المتصفح (Playwright) يحل محل محرك Android؛ لا يوجد في التطبيق
  if (g?.__VANTARA_QA_DOWNLOADS__?.native) return g.__VANTARA_QA_DOWNLOADS__.native;
  if (isNative(g)) return g?.Capacitor?.Plugins?.VantaraDownloads ?? null;
  if (isDesktop(g)) return desktopPlugin('Downloads', g);
  return null;
}

/** ما يدعمه هذا الجهاز: المانجا حيث يعمل محرك المانجا، والفيديو حيث يوجد الجسر الأصلي. */
export function capabilities(g = globalThis) {
  const native = nativeDownloads(g);
  const platform = isNative(g) ? 'android' : isDesktop(g) ? 'windows' : 'web';
  return {
    platform,
    manga: Boolean(g?.indexedDB),
    video: Boolean(native),
    // التورنت يُحفظ كاملًا بمحرك libtorrent في التطبيق (Android)؛ ويندوز لاحقًا بمحركه
    torrent: Boolean(native) && platform === 'android',
  };
}

function readSettings() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(SETTINGS_KEY) ?? 'null');
    return { parallel: raw?.parallel ?? DEFAULT_PARALLEL, wifiOnly: Boolean(raw?.wifiOnly) };
  } catch {
    return { parallel: DEFAULT_PARALLEL, wifiOnly: false };
  }
}

function writeSettings(s) {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* الإعداد يبقى في الذاكرة لهذه الجلسة */
  }
}

/** الشبكة: متصلة؟ ومحدودة (بيانات جوال)؟ المحرك الأصلي أصدق من المتصفح حين يوجد. */
function networkWatch(g = globalThis) {
  let meteredNative = null;
  const native = nativeDownloads(g);
  const listeners = new Set();
  const fire = () => listeners.forEach((fn) => fn());
  const refreshNative = () => native?.network?.().then((n) => {
    const next = typeof n?.metered === 'boolean' ? n.metered : null;
    if (next !== meteredNative) {
      meteredNative = next;
      fire();
    }
  }).catch(() => {});
  void refreshNative();
  native?.addListener?.('network', (n) => {
    meteredNative = typeof n?.metered === 'boolean' ? n.metered : meteredNative;
    fire();
  });
  g.addEventListener?.('online', fire);
  g.addEventListener?.('offline', fire);
  g.navigator?.connection?.addEventListener?.('change', () => {
    void refreshNative();
    fire();
  });
  return {
    online: () => g.navigator?.onLine !== false,
    metered: () => {
      if (meteredNative != null) return meteredNative;
      const c = g.navigator?.connection;
      return c?.type === 'cellular' || c?.saveData === true;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * فصول المانجا تُنزَّل في الواجهة نفسها: بعد الخروج من التطبيق يجمّد Android العملية فيتوقف التنزيل بلا كلمة.
 * ما دام فصل يُنزَّل تُمسك خدمة التنزيل الأمامية (إشعار تقدّم) فتبقى العملية حية، وتُترك حين ينتهي آخرها.
 */
export function keepAliveWhileManga(manager, native = nativeDownloads()) {
  if (typeof native?.keepAlive !== 'function') return () => {};
  let on = false;
  let lastLabel = '';
  let lastAt = 0;
  const send = (o) => {
    try {
      void Promise.resolve(native.keepAlive(o)).catch(() => {});
    } catch {
      /* الإشعار تحسين؛ التنزيل لا يتوقف لأجله */
    }
  };
  const sync = () => {
    const active = manager.list().filter((i) => i.kind === 'manga' && ACTIVE_STATES.has(i.state));
    if (!active.length) {
      if (on) {
        on = false;
        send({ key: 'manga', on: false });
      }
      return;
    }
    // DN2: سطر لكل فصل (حتى 4) بتقدّمه بالصفحات؛ الإشعار الأصلي يقسمها أسطرًا (DownloadNotice)
    const line = (i) => `${i.work?.title ?? ''} — ${unitLabel(i)}${i.pagesTotal ? ` · ${i.pages ?? 0}/${i.pagesTotal}` : ''}`;
    const label = active.slice(0, 4).map(line).join('\n');
    const now = Date.now();
    if (!on || (label !== lastLabel && now - lastAt > 2000)) {
      on = true;
      lastLabel = label;
      lastAt = now;
      send({ key: 'manga', on: true, label });
    }
  };
  return manager.subscribe(sync);
}

let shared = null;

/** المدير المشترك (يُنشأ مرة). يرجع وعدًا بالمدير والمخزن والقدرات. */
export function downloads() {
  shared ??= (async () => {
    const store = (await openStore()) ?? memoryStore();
    const caps = capabilities();
    const manager = createDownloadManager({
      store,
      settings: readSettings(),
      // التوازي و«Wi-Fi فقط» يصلان طابور الجهاز أيضًا (Android)، فيطبّقهما وهو يعمل بلا واجهة
      saveSettings: (next) => {
        writeSettings(next);
        void Promise.resolve(nativeDownloads()?.configure?.({ parallel: next.parallel, wifiOnly: next.wifiOnly })).catch(() => {});
      },
      network: networkWatch(),
      drivers: {
        manga: createMangaDriver({ store, engine: () => (mangaEngine.isAvailable() ? mangaEngine : null) }),
        video: caps.video ? createVideoDriver({ engine: () => globalThis.__VANTARA_QA_DOWNLOADS__?.engine ?? animeEngine, native: () => nativeDownloads(), platform: () => capabilities() }) : null,
      },
    });
    keepAliveWhileManga(manager);
    // التطبيق عاد للواجهة: ما انتظر الشبكة أو خانة يُفحص من جديد
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (globalThis.document.visibilityState === 'visible') manager.pump();
    });
    await manager.ready;
    return { manager, store, caps };
  })();
  return shared;
}
