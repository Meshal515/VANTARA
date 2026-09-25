/**
 * إعدادات الترجمة — على هذا الجهاز.
 *
 *   enabled  : مغلقة افتراضيًا. مغلقة = لا زرّ ولا أيقونة ترجمة في أي مكان.
 *   mode     : 'auto'   = كل فصل إنجليزي يُترجم حين تدخله.
 *              'manual' = تضغط «ترجم» في القارئ، ويستمر للعمل حتى تخرج من بطاقته.
 *   speed    : 'smart' (افتراضي) = Luna بتفكير: أدق. 'fast' = Luna بلا تفكير: أسرع وأحيانًا تغلط.
 *              القارئ يسألك عند «ترجم»، وهذا ما يكون مختارًا مسبقًا وما يستعمله «تلقائي».
 *
 * الترجمات المكتملة تُحفظ على الجهاز (`lib/translate.js`) فلا تُعاد، والنماذج
 * تُنزَّل مرة (`translation-native.js`). الدوال خالصة قدر الإمكان لتُختبر.
 */

const KEY = 'vantara.translate.settings';
const DEFAULTS = Object.freeze({ enabled: false, mode: 'auto', speed: 'smart' });
const listeners = new Set();

const LOCK_KEY = 'vantara.translate.locked';

/** الترجمة مقفلة لهذا الحساب (قيد التطوير): الخادم يقرر، والجهاز يتذكر آخر ما قاله. */
export function translationLocked(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(LOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTranslationLocked(locked, storage = globalThis.localStorage) {
  if (translationLocked(storage) === locked) return;
  try {
    if (locked) storage?.setItem(LOCK_KEY, '1');
    else storage?.removeItem(LOCK_KEY);
  } catch {
    // الخادم يرفض على كل حال
  }
  const next = readTranslateSettings(storage);
  for (const fn of listeners) fn(next);
}

/** مقفلة = مغلقة في كل مكان (لا زرّ ولا ترجمة مقدّمة)، مهما كان اختيار الجهاز. */
export function readTranslateSettings(storage = globalThis.localStorage) {
  let settings;
  try {
    const raw = storage?.getItem(KEY);
    settings = normalize(raw ? JSON.parse(raw) : null);
  } catch {
    settings = { ...DEFAULTS };
  }
  return translationLocked(storage) ? { ...settings, enabled: false } : settings;
}

export function normalize(value) {
  const v = value && typeof value === 'object' ? value : {};
  return { enabled: v.enabled === true, mode: v.mode === 'manual' ? 'manual' : 'auto', speed: v.speed === 'fast' ? 'fast' : 'smart' };
}

export function writeTranslateSettings(patch, storage = globalThis.localStorage) {
  const next = normalize({ ...readTranslateSettings(storage), ...patch });
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // تفضيل لا حقيقة
  }
  for (const fn of listeners) fn(next);
  return next;
}

export function onTranslateSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const translateEnabled = () => readTranslateSettings().enabled;
export const translateMode = () => readTranslateSettings().mode;
export const translateSpeed = () => readTranslateSettings().speed;
