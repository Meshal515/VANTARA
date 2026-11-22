/**
 * عنوانا الخادم.
 *
 * VANTARA تتكلم مع طرفين مختلفين، وهذا مقصود:
 *
 *   SYNC — Cloudflare Worker + D1. الطبقة الاجتماعية والتقدم والإحصائيات.
 *          يعمل دائمًا، مجاني، ولا يحتاج جهازًا في البيت.
 *   API  — خادم المحتوى (Uchiyomi). المكتبة والفصول والصفحات والمصادر.
 *          يعمل عندما يكون جهاز البيت مفتوحًا.
 *
 * الفصل يعني أن الأصدقاء والحضور والتعليقات تعمل حتى وخادم المحتوى نائم،
 * وهذا هو الفرق بين تطبيق يبدو حيًّا وتطبيق يبدو معطوبًا.
 *
 * داخل الـAPK لا يوجد أصل مشترك، فالعنوانان مطلقان. ويُعدّلان من الإعدادات بلا
 * إعادة بناء: نطاق Cloudflare Tunnel يتغيّر، وإصدار APK جديد لكل تغيير عنوان
 * ليس خيارًا.
 */

const OVERRIDE_KEY = 'vantara.endpoints';

/**
 * الافتراضي.
 *
 * `__VANTARA_SYNC_URL__` يُستبدل عند بناء الـAPK. في المتصفح على Pages يبقى
 * كما هو، فنرجع إلى نفس الأصل — وهو الصحيح هناك.
 */
const BAKED = {
  sync: '__VANTARA_SYNC_URL__',
  api: '__VANTARA_API_URL__',
  /** من يجيب «هل هناك نسخة أحدث؟». تُنشر مع الواجهة على Pages. */
  updates: '__VANTARA_UPDATES_URL__',
};

/** نسخة هذا البناء. تُستبدل عند بناء APK أو نشر PWA. */
const BAKED_VERSION = '__VANTARA_VERSION__';
/**
 * قناة البناء: تُختم `debug` في مسارات بناء Debug وحدها (android-debug وweb-debug وwindows-debug). Stable وأي بناء لم
 * يُختم = null: ما هو «قيد التطوير» يبقى مقفلًا ما لم يُختم Debug صراحة، فنسيان مسار يقفل لا يفتح.
 */
const BAKED_CHANNEL = '__VANTARA_CHANNEL__';

/**
 * خادم المزامنة الحقيقي، لأي بناء لم يُخبز فيه عنوان (بناء debug، أو APK
 * مرسل مباشرة). VANTARA تطبيق لثلاثة حسابات على خادم واحد: بلا هذا يفتح
 * التطبيق على «اضبط عنوان الخادم»، وهي شاشة لا يفهمها أحد من العيال.
 * ليس سرًّا: عنوان عام، والدخول يحتاج إثبات الجهاز.
 */
const PRODUCTION_SYNC = 'https://vantara-sync.ngm-309.workers.dev';

function unreplaced(value) {
  return !value || value.startsWith('__VANTARA_');
}

function stored() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function trimSlash(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

export function endpoints() {
  const override = stored();
  return {
    sync: trimSlash(override.sync || (unreplaced(BAKED.sync) ? PRODUCTION_SYNC : BAKED.sync)),
    api: trimSlash(override.api || (unreplaced(BAKED.api) ? '' : BAKED.api)),
    updates: trimSlash(override.updates || (unreplaced(BAKED.updates) ? '' : BAKED.updates)),
  };
}

/** نسخة التطبيق العاملة، أو null في بناء محلي لم يُخبز فيه رقم الإصدار. */
export function appVersion() {
  return unreplaced(BAKED_VERSION) ? null : BAKED_VERSION;
}

/** `debug` في بناء Debug، وإلا null. */
export function buildChannel() {
  return unreplaced(BAKED_CHANNEL) ? null : BAKED_CHANNEL;
}

export function setEndpoints(next) {
  const merged = { ...stored(), ...next };
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(merged));
  } catch {
    // تخزين محجوب: الافتراضي يبقى ساريًا لهذه الجلسة
  }
  return endpoints();
}

/** هل ضُبط عنوان المزامنة؟ بدونه لا حسابات ولا أصدقاء. */
export function syncConfigured() {
  return endpoints().sync.length > 0;
}
