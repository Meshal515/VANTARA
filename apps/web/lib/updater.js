/**
 * «يوجد تحديث جديد» وزرّ واحد.
 *
 * البيان على آخر إصدار في GitHub (`vantara-update.json`) يبنيه CI من main بعد
 * نجاح الاختبارات، بنفس مفتاح التوقيع دائمًا. فيه:
 *   - `versionName`/`versionCode`: هذا الإصدار.
 *   - `nativeApi`: رقم كود أندرويد الذي بُنيت له الواجهة (`AppUpdatePlugin`).
 *   - `web`: حزمة الواجهة وبصمتها. `apk`: التطبيق كاملًا وبصمته.
 *
 * القرار:
 *   - نفس `nativeApi` وإصدار أحدث ← تحديث الواجهة: ينزل ويُطبَّق ويُعاد
 *     التشغيل في ثوانٍ، بلا مثبّت أندرويد.
 *   - `nativeApi` مختلف ← الـAPK: ينزل ويفتح مثبّت أندرويد (الموافقة منه).
 */

import { appVersion } from './config.js';

export const MANIFEST_URL = 'https://github.com/Meshal515/VANTARA/releases/latest/download/vantara-update.json';
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'vantara.update.checkedAt';

const plugin = () => globalThis.Capacitor?.Plugins?.AppUpdate ?? null;

/** `0.0.12` > `0.0.9`: رقمًا رقمًا. */
export function isNewer(candidate, current) {
  const a = String(candidate ?? '').split('.').map((x) => Number.parseInt(x, 10) || 0);
  const b = String(current ?? '').split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/**
 * القرار وحده، بلا شبكة: ما يلزم لهذا الجهاز من هذا البيان.
 * @returns {null | { kind: 'web' | 'apk', version: string, notes: string, web?: object, apk?: object }}
 */
export function decideUpdate(manifest, { nativeApi, versionCode, webVersion }) {
  if (!manifest || typeof manifest !== 'object') return null;
  const version = String(manifest.versionName ?? '');
  const notes = String(manifest.notes ?? '');
  const sameNative = Number(manifest.nativeApi) === Number(nativeApi);
  if (!sameNative && Number(manifest.versionCode) > Number(versionCode) && manifest.apk?.url && manifest.apk?.sha256) {
    return { kind: 'apk', version, notes, apk: manifest.apk };
  }
  if (sameNative && isNewer(version, webVersion) && manifest.web?.url && manifest.web?.sha256) {
    return { kind: 'web', version, notes, web: manifest.web };
  }
  return null;
}

/** يسأل البيان (مرة كل ثلاث ساعات إلا بـ`force`). null في المتصفح أو بلا جديد. */
export async function findUpdate({ force = false } = {}) {
  const native = plugin();
  if (!native) return null;
  if (!force) {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? '0');
    if (Date.now() - last < CHECK_EVERY_MS) return null;
  }
  try {
    const [info, raw] = await Promise.all([native.info(), native.manifest({ url: MANIFEST_URL })]);
    try {
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    } catch {
      // يُفحص في الإقلاع القادم
    }
    return decideUpdate(JSON.parse(raw.json), { ...info, webVersion: appVersion() });
  } catch {
    return null;
  }
}

/**
 * يطبّق التحديث. `onProgress(0..1)` أثناء التنزيل.
 * @returns {Promise<{ done?: boolean, needsPermission?: boolean }>}
 */
export async function applyUpdate(update, onProgress = () => {}) {
  const native = plugin();
  if (!native || !update) throw new Error('no updater');
  const handle = await native.addListener?.('progress', ({ received, total }) => {
    if (total > 0) onProgress(Math.min(1, received / total));
  });
  try {
    if (update.kind === 'web') {
      const { path } = await native.downloadWeb({ url: update.web.url, sha256: update.web.sha256, version: update.version });
      // المسار حُفظ في الكود الأصلي قبل هذا السطر؛ هذا النداء يعيد التحميل منه
      await globalThis.Capacitor?.Plugins?.WebView?.setServerBasePath({ path });
      return { done: true };
    }
    const out = await native.installApk({ url: update.apk.url, sha256: update.apk.sha256 });
    return out?.needsPermission ? { needsPermission: true } : { done: true };
  } finally {
    await handle?.remove?.();
  }
}
