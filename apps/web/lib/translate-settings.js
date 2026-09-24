/**
 * إعدادات الترجمة — على هذا الجهاز.
 *
 *   enabled  : مغلقة افتراضيًا. مغلقة = لا زرّ ولا أيقونة ترجمة في أي مكان.
 *   mode     : 'auto'   = كل فصل إنجليزي يُترجم حين تدخله.
 *              'manual' = تضغط «ترجم» في القارئ، ويستمر للعمل حتى تخرج من بطاقته.
 *
 * الترجمات المكتملة تُحفظ على الجهاز (`lib/translate.js`) فلا تُعاد، والنماذج
 * تُنزَّل مرة (`translation-native.js`). الدوال خالصة قدر الإمكان لتُختبر.
 */

const KEY = 'vantara.translate.settings';
const DEFAULTS = Object.freeze({ enabled: false, mode: 'auto' });
const listeners = new Set();

export function readTranslateSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULTS };
  }
}

export function normalize(value) {
  const v = value && typeof value === 'object' ? value : {};
  return { enabled: v.enabled === true, mode: v.mode === 'manual' ? 'manual' : 'auto' };
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
