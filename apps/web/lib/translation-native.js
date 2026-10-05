/**
 * الترجمة على الجوال: الجسر إلى الإضافة الأصلية `Translation` (Kotlin + ONNX Runtime).
 *
 * الرؤية (الفقاعات، الحروف، OCR)، والتبييض، والرسم العربي كلها داخل الجهاز؛
 * Luna وحدها عبر sync-worker. النماذج (~400MB) ليست في الـAPK: تُنزَّل مرة
 * حين تفعّل الترجمة أول مرة، وتُحذف أو تُحدَّث من الإعدادات.
 *
 * العقد مع الطبقة الأصلية (`TranslationPlugin.kt`):
 *   models()              → { installed, version, latestVersion, bytes, expectedBytes, files: [{name, bytes, present}] }
 *   downloadModels()      → يبدأ التنزيل؛ أحداث 'modelsProgress' { received, total, file } ثم يعود { installed: true }
 *   cancelDownload()
 *   removeModels()        → { installed: false }
 *   analyzePage({ path, sourceLang, priority })          → { pageHash, width, height, thumbnail, regions: [...], perf }   (كشف + حروف + فقاعات + OCR)
 *   releasePageReservation({ chapterKey, pageIndex })    → يحرر حجز Analyze إن لم يصل Render بعد Luna
 *   renderPage({ path, regions: [{id, arabic}], leave: [id] }) → { path, translated, perf }  (تبييض + عربي؛ ملف WebP بلا فقد باسم جديد)
 *   benchmarkPage({ path, regions }) → { legacy, current, identical }  (القديم مقابل الجديد)
 *   diagnoseCleaning({ path, regions, leave }) → صورة بعد التبييض وقبل العربي + قياس البكسلات
 *   benchmarkEngines({ path }) → { engines: [{ name, loadMs, glyphsMs, bubblesMs, glyphDiff, glyphPixels, bubblesSame, bubbles }], cores, thermal }
 *   jobProgress({ title, text, done, total }) / jobFinished({ title, text }) / jobStop()  (خدمة الترجمة المقدّمة)
 *   notificationPermission() → { granted }
 *
 * على الويب (بلا Capacitor) لا ترجمة على الجهاز: `available()` = false والإعدادات تقول ذلك.
 */

const plugin = () => globalThis.Capacitor?.Plugins?.Translation ?? null;

export const nativeTranslationAvailable = () => Boolean(plugin());

export async function modelsStatus() {
  const p = plugin();
  if (!p) return { available: false, installed: false, version: null, latestVersion: null, bytes: 0, expectedBytes: 0, files: [] };
  const status = await p.models();
  return { available: true, ...status };
}

/**
 * ينزّل النماذج ويبلّغ التقدم. `onProgress({ received, total, file })`.
 * يرجع الحالة النهائية. يرمي عند الفشل (شبكة، مساحة، بصمة مختلفة).
 */
export async function downloadModels(onProgress) {
  const p = plugin();
  if (!p) throw new Error('native_unavailable');
  let handle = null;
  if (onProgress && typeof p.addListener === 'function') {
    handle = await p.addListener('modelsProgress', (e) => onProgress(e));
  }
  try {
    return await p.downloadModels();
  } finally {
    handle?.remove?.();
  }
}

export async function cancelDownload() {
  await plugin()?.cancelDownload?.();
}

export async function removeModels() {
  const p = plugin();
  if (!p) return { installed: false };
  return p.removeModels();
}

/** الهندسة وOCR على الجهاز. `path` مسار ملف الصفحة كما أعطته الإضافة `ExtensionEngine.image`. */
/** Lightweight router has a separate native owner and never waits for Luna/render. */
export async function routePage({path, chapterKey=null, pageIndex=null}) {
  const p=plugin();
  if (!p || typeof p.routePage !== 'function') return null;
  try { return await p.routePage({path,...where(chapterKey,pageIndex)}); }
  catch { return null; } // Older APK: preserve its working analyze path.
}

export async function analyzePage({ path, sourceLang = 'auto', priority = 'high', chapterKey = null, pageIndex = null, routeHash = null }) {
  const p = plugin();
  if (!p) throw new Error('native_unavailable');
  return p.analyzePage({ path, sourceLang, priority, routeHash, ...where(chapterKey, pageIndex) });
}

/**
 * إذا انتهى Analyze لكن Luna فشلت أو لم تُنتج نصًا للرسم، نحرر الحجز الأصلي.
 * APK أقدم لا يملك الدالة: تمر بصمت.
 */
export async function releasePageReservation(chapterKey, pageIndex) {
  const p = plugin();
  if (!p?.releasePageReservation) return;
  await p.releasePageReservation(where(chapterKey, pageIndex));
}

/** التبييض والرسم على الجهاز. يرجع مسار الصورة المترجمة. */
export async function renderPage({ path, regions, leave = [], priority = 'high', chapterKey = null, pageIndex = null }) {
  const p = plugin();
  if (!p) throw new Error('native_unavailable');
  return p.renderPage({ path, regions, leave, priority, ...where(chapterKey, pageIndex) });
}

/** موضع الصفحة في فصلها: الجهاز يقدّم الأقرب لصفحتك في دور المعالج. */
const where = (chapterKey, pageIndex) => (chapterKey && Number.isInteger(pageIndex) ? { chapterKey: String(chapterKey), pageIndex } : {});

/**
 * القارئ على هذه الصفحة الآن: على الجهاز، الصفحة التي أمامك ثم التي بعدها تأخذ
 * المعالج قبل غيرها (والحساب لحظة تسليم الدور). APK أقدم بلا الدالة: لا شيء.
 */
export function focusPage(chapterKey, pageIndex, pageCount = null) {
  const p = plugin();
  if (!p?.focusPage) return;
  void Promise.resolve(p.focusPage({ ...where(chapterKey, pageIndex), ...(Number.isInteger(pageCount) && pageCount > 0 ? { pageCount } : {}) })).catch(() => {});
}

/**
 * القديم مقابل الجديد على هذا الجوال: الصفحة نفسها بالطريقين من الصفر.
 * يرجع `{ legacy, current, identical }` (زمن كل مرحلة، وهل الناتج متطابق بكسلًا).
 * APK أقدم بلا هذه الدالة: null.
 */
/** إعدادات المحرك على هذا الجوال: زمن قناع الحروف والفقاعات ومطابقة ناتجها لكل إعداد. */
export async function benchmarkEngines({ path }) {
  const p = plugin();
  if (!p?.benchmarkEngines) return null;
  return p.benchmarkEngines({ path });
}

export async function benchmarkPage({ path, regions }) {
  const p = plugin();
  if (!p?.benchmarkPage) return null;
  return p.benchmarkPage({ path, regions });
}

/** تشخيص محلي: نفس Cleaner/LaMa الفعليين، لكن الناتج قبل رسم العربي. */
export async function diagnoseCleaning({ path, regions, leave = [], chapterKey = null, pageIndex = null }) {
  const p = plugin();
  if (!p?.diagnoseCleaning) return null;
  return p.diagnoseCleaning({ path, regions, leave, ...where(chapterKey, pageIndex) });
}

/** «٤١٢ ميجابايت» وما شابه، للإعدادات. */
/**
 * خدمة الترجمة المقدّمة: إشعار تقدّم ثابت يُبقي التطبيق حيًّا والشاشة مطفأة.
 * APK أقدم بلا هذه الدوال: تمرّ بصمت، والطابور يعمل ما دام التطبيق مفتوحًا.
 */
async function call(name, args) {
  try {
    await plugin()?.[name]?.(args);
    return true;
  } catch {
    return false;
  }
}
export const jobProgress = (args) => call('jobProgress', args);
export const jobFinished = (args) => call('jobFinished', args);
export const jobStop = () => call('jobStop');

/** أندرويد 13+ يطلب إذن الإشعارات مرة. */
export async function notificationPermission() {
  try {
    return Boolean((await plugin()?.notificationPermission?.())?.granted);
  } catch {
    return false;
  }
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} جيجابايت`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} ميجابايت`;
  if (n >= 1024) return `${Math.round(n / 1024)} كيلوبايت`;
  return `${n} بايت`;
}


const refinementListeners = new WeakMap();
/** One listener per native plugin, shared across pages; older APKs safely omit this event. */
export async function observeRefinements(callback) {
  const p = plugin();
  if (!p?.addListener) return;
  let entry = refinementListeners.get(p);
  if (!entry) {
    entry = { callbacks: new Set(), attached: null };
    refinementListeners.set(p,entry);
    entry.attached = Promise.resolve(p.addListener('refinementReady',event => {
      for (const cb of entry.callbacks) void Promise.resolve(cb(event)).catch(() => {});
    })).catch(() => { refinementListeners.delete(p); });
  }
  entry.callbacks.add(callback);
  await entry.attached;
}
