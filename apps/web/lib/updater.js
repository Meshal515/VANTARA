/**
 * التحديث: الواجهة وحدها بصمت، والـAPK بزرّ «تثبيت» واحد.
 *
 * البيان على آخر إصدار مستقر في GitHub (`vantara-update.json`) يبنيه CI من
 * main بعد نجاح الاختبارات، موقّعًا بمفتاح VANTARA الثابت. رابط الإصدار دائم
 * (لا artifact ينتهي). فيه:
 *   - `versionName`/`versionCode`، `changelog`، `minimumSupportedVersionCode`.
 *   - `native`: بصمة الكود الأصلي الذي بُنيت له الواجهة.
 *   - `web` و`apk`: الروابط والبصمات (sha256).
 *
 * القرار:
 *   - نفس البصمة وواجهة أحدث ← تنزل في الخلفية وتُعرض في الإقلاع التالي (أو
 *     عند الرجوع للتطبيق بعد غياب). لا سؤال ولا زر. فشلها = رجوع تلقائي.
 *   - بصمة مختلفة ← الواجهة الجديدة تحتاج كودًا أصليًا جديدًا: «يوجد تحديث
 *     جديد» و«تثبيت». أقدم من `minimumSupportedVersionCode` ← إجباري.
 */

import { appVersion } from './config.js';

export const MANIFEST_URL = 'https://github.com/Meshal515/VANTARA/releases/latest/download/vantara-update.json';
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'vantara.update.checkedAt';
const DISMISS_KEY = 'vantara.update.dismissed';
const DISMISS_FOR_MS = 24 * 60 * 60 * 1000;

const plugin = () => globalThis.Capacitor?.Plugins?.AppUpdate ?? null;

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // تسريع لا حقيقة: الفحص يتكرر فقط
  }
  return null;
}

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
 * القرار وحده، بلا شبكة.
 * @param {object} manifest
 * @param {{ versionCode:number, native:string, webVersion:string|null, staged?:string|null, bad?:string[], official?:boolean }} device
 * @returns {{ web: null | object, apk: null | object }}
 */
export function decideUpdate(manifest, device) {
  const none = { web: null, apk: null };
  if (!manifest || typeof manifest !== 'object' || !manifest.native) return none;
  // بناء محلي (debug): لا بصمة، ولا مفتاح رسمي يثبت فوقه تحديث
  if (!device?.native || device.native === 'dev') return none;
  const version = String(manifest.versionName ?? '');
  const changelog = Array.isArray(manifest.changelog) ? manifest.changelog.map(String).slice(0, 6) : [];
  const required = Number(device.versionCode) < Number(manifest.minimumSupportedVersionCode ?? 0);
  const sameNative = manifest.native === device.native;

  let apk = null;
  const apkNewer = Number(manifest.versionCode) > Number(device.versionCode) && manifest.apk?.url && manifest.apk?.sha256;
  if (apkNewer && (!sameNative || required)) {
    apk = { version, versionCode: Number(manifest.versionCode), changelog, required, ...manifest.apk };
  }

  let web = null;
  if (
    sameNative &&
    manifest.web?.url &&
    manifest.web?.sha256 &&
    isNewer(version, device.webVersion) &&
    !(device.bad ?? []).includes(version) &&
    device.staged !== version
  ) {
    web = { version, ...manifest.web };
  }
  return { web, apk };
}

/** هل رفض المستخدم هذا الإصدار في آخر يوم؟ الإجباري لا يُؤجَّل. */
export function dismissedRecently(update, now = Date.now()) {
  if (!update || update.required) return false;
  try {
    const d = JSON.parse(storage(DISMISS_KEY) ?? 'null');
    return d?.version === update.version && now - Number(d.at) < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}
export const dismiss = (update) => storage(DISMISS_KEY, JSON.stringify({ version: update.version, at: Date.now() }));

export async function deviceInfo() {
  const native = plugin();
  if (!native) return null;
  try {
    return { ...(await native.info()), webVersion: appVersion() };
  } catch {
    return null;
  }
}

/** يسأل البيان (مرة كل ثلاث ساعات إلا بـ`force`). null في المتصفح أو عند الفشل. */
export async function findUpdate({ force = false } = {}) {
  const native = plugin();
  if (!native) return null;
  if (!force && Date.now() - Number(storage(LAST_CHECK_KEY) ?? '0') < CHECK_EVERY_MS) return null;
  try {
    const [device, raw] = await Promise.all([deviceInfo(), native.manifest({ url: MANIFEST_URL })]);
    storage(LAST_CHECK_KEY, String(Date.now()));
    if (!device) return null;
    return { ...decideUpdate(JSON.parse(raw.json), device), device };
  } catch {
    return null;
  }
}

/** الواجهة: تنزل وتُتحقق وتُجهَّز للإقلاع التالي. لا تغيّر ما على الشاشة. */
export async function stageWeb(web) {
  const native = plugin();
  if (!native || !web) return false;
  try {
    await native.downloadWeb({ url: web.url, sha256: web.sha256, version: web.version });
    return true;
  } catch {
    return false;
  }
}

/** الواجهة المجهّزة تُعرض الآن (يعيد تحميل الصفحة). false إن لا شيء جاهز. */
export async function activateStaged() {
  try {
    return Boolean((await plugin()?.activate())?.activated);
  } catch {
    return false;
  }
}

/**
 * الواجهة المعروضة تعمل: تُعتمد نسخةً سليمة، وإلا رجع التطبيق عنها وحده.
 * @returns {Promise<{ confirmed?: boolean, rolledBack?: string }>}
 */
export async function reportHealthy() {
  try {
    return (await plugin()?.healthy({ version: appVersion() ?? '' })) ?? {};
  } catch {
    return {};
  }
}

export async function resetWeb() {
  await plugin()?.reset();
}

/** أسباب رفض الـAPK من الكود الأصلي (`ApkCheck.Verdict`) بكلام مفهوم. */
export const APK_ERRORS = {
  INSTALLED_DIFFERENT_KEY: 'النسخة اللي عندك تجريبية بمفتاح مختلف. احذفها مرة وحدة وثبّت VANTARA الرسمي',
  NOT_OFFICIAL: 'الملف ليس إصدار VANTARA الرسمي، ما ثبّتناه',
  WRONG_PACKAGE: 'الملف ليس VANTARA، ما ثبّتناه',
  NOT_NEWER: 'عندك نفس الإصدار أو أحدث',
  UNREADABLE: 'الملف وصل تالف. جرّب مرة ثانية',
};

/**
 * الـAPK: ينزل ويُتحقق ثم يفتح شاشة تثبيت أندرويد. `onProgress(0..1)`.
 * `onResult('success'|'cancelled'|'failed'|...)` بعد قرار المستخدم في شاشة أندرويد.
 * @returns {Promise<{ started?: boolean, needsPermission?: boolean, error?: string }>}
 */
export async function installApk(apk, { onProgress = () => {}, onResult = () => {} } = {}) {
  const native = plugin();
  if (!native || !apk) return { error: 'no updater' };
  const progress = await native.addListener?.('progress', ({ received, total }) => {
    if (total > 0) onProgress(Math.min(1, received / total));
  });
  const result = await native.addListener?.('installResult', ({ status }) => {
    void result?.remove?.();
    onResult(status);
  });
  try {
    const out = await native.installApk({ url: apk.url, sha256: apk.sha256 });
    if (!out?.started) void result?.remove?.();
    return out?.needsPermission ? { needsPermission: true } : { started: true };
  } catch (error) {
    void result?.remove?.();
    return { error: String(error?.code ?? error?.message ?? error) };
  } finally {
    await progress?.remove?.();
  }
}

export async function canInstall() {
  try {
    return Boolean((await plugin()?.info())?.canInstall);
  } catch {
    return false;
  }
}
