/**
 * المظهر: نمط صفحة العمل ولون كل قسم والخلفية. يُحفظ على هذا الجهاز فقط.
 * بنية التجربة (توحيد الشاشات والمحتوى) في experience.js: مفتاح مستقل لا يمسّ هذا.
 *
 * اللون يغيّر متغيّرات القسم نفسها (--accent وأخواته، وصبغة الخلفية) على جذر التطبيق و<html>
 * معًا، فما يُعلَّق على body (التنبيهات والأوراق) يرث اللون نفسه ولا يرجع لبنفسجي المانجا.
 * بلا اختيار: البنفسجي هو اللون الأساسي لكل الأقسام.
 */

import { trimArtCache } from '../lib/together/art.js';

/** كاشات تُعاد من الشبكة بلا فقد: تُخلى حين يمتلئ التخزين قبل أن يفشل حفظ إعداد. */
const REGENERABLE = ['vantara.anime.found.v2', 'vantara.anime.genre-art.v1', 'vantara.heroPick.v1', 'vantara.cinema.heroPick.v1', 'vantara.unified.genre-art.v1'];

const KEY = 'vantara.appearance.v1';
// Keep unsaved preferences usable during the session if persistent storage refuses a write.
const fallbackByStorage = new WeakMap();
const fallbackWithoutStorage = new Map();
let lastPreferenceSaved = true;

function fallbackFor(storage) {
  if (!storage || (typeof storage !== 'object' && typeof storage !== 'function')) return fallbackWithoutStorage;
  if (!fallbackByStorage.has(storage)) fallbackByStorage.set(storage, new Map());
  return fallbackByStorage.get(storage);
}

export function readPreference(key, storage = globalThis.localStorage) {
  const fallback = fallbackFor(storage);
  if (fallback.has(key)) return fallback.get(key);
  try {
    if (storage && storage === globalThis.localStorage) {
      const value = globalThis.sessionStorage?.getItem(`vantara.unsaved.${key}`);
      if (value !== null && value !== undefined) return value;
    }
  } catch { /* session storage is optional */ }
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

export function writePreference(key, value, storage = globalThis.localStorage) {
  const fallback = fallbackFor(storage);
  try {
    if (!storage) throw new Error('storage unavailable');
    storage.setItem(key, value);
    fallback.delete(key);
    try { if (storage === globalThis.localStorage) globalThis.sessionStorage?.removeItem(`vantara.unsaved.${key}`); } catch {}
    lastPreferenceSaved = true;
  } catch {
    // التخزين ممتلئ غالبًا بكاش الصور: يُخلى (يُعاد جلبه، لا يضيع شيء) ثم محاولة ثانية قبل حل الجلسة
    // على مراحل: صور الأنمي أولًا، ثم بقية الكاشات المُعاد جلبها. بيانات المستخدم (المكتبة والتقدم) لا تُمس.
    const stages = [
      () => trimArtCache(0, storage),
      () => { for (const k of REGENERABLE) { try { storage.removeItem(k); } catch { /* */ } } },
    ];
    for (const free of stages) {
      try {
        if (!storage) break;
        free();
        storage.setItem(key, value);
        fallback.delete(key);
        try { if (storage === globalThis.localStorage) globalThis.sessionStorage?.removeItem(`vantara.unsaved.${key}`); } catch {}
        lastPreferenceSaved = true;
        return true;
      } catch { /* ما زال ممتلئًا: المرحلة التالية */ }
    }
    fallback.set(key, value);
    try { if (storage && storage === globalThis.localStorage) globalThis.sessionStorage?.setItem(`vantara.unsaved.${key}`, value); } catch {}
    lastPreferenceSaved = false;
  }
  return lastPreferenceSaved;
}

export const preferenceSaved = () => lastPreferenceSaved;

/** أنماط صفحة عمل الأنمي. الأول هو الأساسي. */
export const WORK_STYLES = Object.freeze([
  { id: 'core', name: 'المحور', note: 'الغلاف في النص والشعار تحته' },
  { id: 'platform', name: 'المنصة', note: 'الغلاف والتشغيل يرافقانك' },
  { id: 'card', name: 'البطاقة الطائرة', note: 'غلاف مائل وحلقات تُسحب' },
  { id: 'screen', name: 'شاشة السينما', note: 'البنر شاشة والحلقات خط زمني' },
  { id: 'episode', name: 'الحلقة أولًا', note: 'ما ستكمله الآن في الأعلى' },
]);

/**
 * أنماط صفحة عمل المانجا. المعرّفات متفق عليها مع تنفيذ صفحة العمل: لا تُغيَّر.
 * الأول هو الأساسي.
 */
export const MANGA_WORK_STYLES = Object.freeze([
  { id: 'page', name: 'كلاسيكي', note: 'صفحة Stable: الغلاف وبجانبه الاسم، ثم القصة والفصول' },
  { id: 'gallery', name: 'المعرض', note: 'الغلاف في الوسط وتبويبات' },
  { id: 'profile', name: 'الملف', note: 'صورة العمل العريضة وثلاثة أرقام' },
  { id: 'resume', name: 'من حيث وقفت', note: 'الفصل التالي أولًا وشبكة أرقام' },
  { id: 'webtoon', name: 'ويبتوني', note: 'الفن طوليًا، وإيقاع الإصدار، والفصول بالشهور' },
]);

/**
 * أنماط حُذفت وبديلها: من اختار نمطًا محذوفًا يُنقل اختياره لأقرب نمط باقٍ، لا لأساسي القسم.
 * «مباشر» (حُذف 12 نوفمبر) كان مبنيًا على هيكل «المعرض» نفسه برأس أصغر، فبديله «المعرض».
 */
export const RETIRED_STYLES = Object.freeze({ manga: Object.freeze({ direct: 'gallery' }) });
const liveStyles = (style) => {
  const out = { ...style };
  for (const [section, map] of Object.entries(RETIRED_STYLES)) if (map[out[section]]) out[section] = map[out[section]];
  return out;
};

/**
 * أنماط صفحة عمل السينما (قرار المالك، 9 نوفمبر): الأساسي كما هو، واثنان بروح نمطَي الأنمي «شاشة السينما»
 * و«البطاقة الطائرة» بفخامة سينمائية، وواحد جديد خاص بالسينما. المعرّف `current` محفوظ عند المستخدمين: لا يُغيَّر.
 */
export const CINEMA_WORK_STYLES = Object.freeze([
  { id: 'current', name: 'الأساسي', note: 'الخلفية والمعلومات تحتها' },
  { id: 'premiere', name: 'العرض الأول', note: 'الخلفية شاشة كاملة والتشغيل عليها' },
  { id: 'poster', name: 'الملصق', note: 'ملصق العمل في أجواء خلفيته' },
  { id: 'marquee', name: 'الشريط العريض', note: 'البنر كاملًا بلا قص وكريدت العمل' },
  { id: 'series', name: 'المسلسل أولًا', note: 'المواسم بلقطاتها وتقدّم كل موسم قبل القصة' },
]);

const STYLE_SETS = { manga: MANGA_WORK_STYLES, anime: WORK_STYLES, cinema: CINEMA_WORK_STYLES };

/** أنماط صفحة العمل المتاحة لقسم (الأنمي لأي قسم غير معروف، كما كان). */
export const stylesOf = (section) => STYLE_SETS[section] ?? WORK_STYLES;

/** لون علامة VANTARA الافتراضي: البنفسجي، مستقل عن ألوان الأقسام. */
export const BRAND_DEFAULT = '#8f5cff';

/** ألوان هادئة غير فاقعة؛ أولها ألوان الأقسام الثلاثة ثم الأبيض. */
export const ACCENTS = Object.freeze([
  { id: 'manga', name: 'بنفسجي المانجا', hex: '#8f5cff' },
  { id: 'anime', name: 'أزرق الأنمي', hex: '#3b82f6' },
  { id: 'cinema', name: 'أحمر السينما', hex: '#c1121f' },
  { id: 'white', name: 'أبيض', hex: '#e6e6ec' },
  { id: 'silver', name: 'فضي', hex: '#98a1b3' },
  { id: 'gold', name: 'ذهبي', hex: '#c9a227' },
  { id: 'amber', name: 'عنبري', hex: '#d38a1c' },
  { id: 'rust', name: 'برتقالي محروق', hex: '#c2552d' },
  { id: 'coral', name: 'مرجاني', hex: '#d9675e' },
  { id: 'rose', name: 'وردي', hex: '#cf5f95' },
  { id: 'orchid', name: 'أوركيد', hex: '#a956be' },
  { id: 'lavender', name: 'لافندر', hex: '#8a80d6' },
  { id: 'indigo', name: 'نيلي', hex: '#5260d2' },
  { id: 'sky', name: 'سماوي', hex: '#2f97c9' },
  { id: 'teal', name: 'فيروزي', hex: '#169c9a' },
  { id: 'emerald', name: 'زمردي', hex: '#22966a' },
  { id: 'olive', name: 'زيتوني', hex: '#6d963c' },
  { id: 'lime', name: 'ليموني هادئ', hex: '#9fb03c' },
  { id: 'copper', name: 'نحاسي', hex: '#a86b4a' },
  { id: 'slate', name: 'رمادي فحمي', hex: '#6b7385' },
]);

const SECTIONS = ['manga', 'anime', 'cinema'];

function blank() {
  return { style: {}, accent: {}, pureBlack: false };
}

export function readAppearance(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(readPreference(KEY, storage) ?? 'null');
    if (!v || typeof v !== 'object') return blank();
    return {
      style: v.style && typeof v.style === 'object' ? liveStyles(v.style) : {},
      accent: v.accent && typeof v.accent === 'object' ? v.accent : {},
      pureBlack: v.pureBlack === true,
    };
  } catch {
    return blank();
  }
}

export function writeAppearance(next, storage = globalThis.localStorage) {
  writePreference(KEY, JSON.stringify(next), storage);
  return next;
}

/**
 * ترحيل لمرة واحدة عند الإقلاع: اختيار نمط محذوف يُكتب بديله في التخزين، فلا يبقى المعرّف القديم محفوظًا.
 * لا يلمس اللون ولا أي حقل آخر، ولا يكتب شيئًا إن لم يكن هناك ما يُرحَّل.
 * @returns {boolean} هل رُحِّل شيء
 */
export function migrateAppearance(storage = globalThis.localStorage) {
  let raw = null;
  try { raw = JSON.parse(readPreference(KEY, storage) ?? 'null'); } catch { return false; }
  const style = raw && typeof raw === 'object' && raw.style && typeof raw.style === 'object' ? raw.style : null;
  if (!style || !Object.entries(RETIRED_STYLES).some(([section, map]) => map[style[section]])) return false;
  writeAppearance({ ...raw, style: liveStyles(style) }, storage);
  return true;
}

/**
 * يعدّل المحفوظ دون أن يُسقط منه شيئًا: يُقرأ الكائن كما هو (بما فيه حقول لا يعرفها هذا الإصدار)
 * ويُدمج التعديل فوقه. هكذا لا يمحو حفظُ لون جديد اختيارًا قديمًا أو حقلًا من إصدار أحدث.
 * @param {(a: {style: object, accent: object, pureBlack: boolean}) => object} change يعيد الحقول المعدّلة
 */
export function patchAppearance(change, storage = globalThis.localStorage) {
  let raw = {};
  try {
    const v = JSON.parse(readPreference(KEY, storage) ?? 'null');
    if (v && typeof v === 'object' && !Array.isArray(v)) raw = v;
  } catch {
    raw = {};
  }
  const next = { ...raw, ...change(readAppearance(storage)) };
  writeAppearance(next, storage);
  return readAppearance(storage);
}

/** نمط صفحة العمل للقسم؛ قيمة غير معروفة ترجع لأساسي القسم (المانجا: الصفحة، الأنمي: المحور). */
export function workStyleOf(section, a = readAppearance()) {
  const list = stylesOf(section);
  const id = a.style?.[section];
  return list.some((s) => s.id === id) ? id : list[0].id;
}

/** لون علامة VANTARA المختار (hex) أو null = البنفسجي الافتراضي. */
export function brandOf(a = readAppearance()) {
  const id = a.accent?.brand;
  return ACCENTS.find((c) => c.id === id)?.hex ?? null;
}

/** لون القسم المختار (hex) أو null = لون القسم المصمّم. */
/**
 * اللون الذي تلبسه الواجهة الآن لقسم، وهو نفسه لكل ما يُفتح منها (المشغّل الأصلي، القارئ، الأوراق): لون القسم
 * المختار أو البنفسجي الأساسي، ومع توحيد المحتوى لون «الموحد». كان المشغّل يأخذ لون القسم المختار فقط، فإن لم
 * يُختر رجع لأزرقه أو أحمره المصمّم بينما الواجهة بنفسجية (ملاحظة المالك، 9 نوفمبر).
 */
export function liveAccent(section, { unified = false } = {}, a = readAppearance()) {
  return accentOf(unified ? 'unified' : section, a) ?? BRAND_DEFAULT;
}

export function accentOf(section, a = readAppearance()) {
  const id = a.accent?.[section];
  return ACCENTS.find((c) => c.id === id)?.hex ?? null;
}

const VARS = ['--brand', '--on-accent', '--accent', '--accent-press', '--accent-text', '--accent-soft', '--accent-line', 'accent-color', 'caret-color', '--bg', '--bg-raised', '--surface-1', '--surface-2', '--surface-3', '--line', '--line-strong'];

/** نسبة تباين WCAG بين لونين hex. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/**
 * Contrast-aware label/icon color for every user-selectable section accent.
 * Require readable normal text (WCAG AA 4.5:1), not merely the 3:1 large-icon threshold.
 */
export function onAccent(hex) {
  if (contrast(hex, '#ffffff') >= 4.5) return '#ffffff';
  return contrast(hex, '#0b0b0f') >= 4.5 ? '#0b0b0f' : '#000000';
}

/**
 * متغيّرات لون مختار: درجات الزر والنص والخط، وخلفية سوداء فيها لمسة من اللون نفسه كما في
 * الأقسام المصمّمة؛ و«أسود صافي» يجعل الخلفية والأسطح الأولى سوداء تمامًا (شاشات OLED).
 * @returns {Record<string, string>}
 */
export function paletteVars(hex, { pureBlack = false } = {}) {
  const out = {};
  if (hex) {
    out['--accent'] = hex;
    out['--on-accent'] = onAccent(hex);
    out['--accent-press'] = `color-mix(in srgb, ${hex} 82%, #000)`;
    out['--accent-text'] = `color-mix(in srgb, ${hex} 62%, #fff)`;
    out['--accent-soft'] = `color-mix(in srgb, ${hex} 16%, transparent)`;
    out['--accent-line'] = `color-mix(in srgb, ${hex} 42%, transparent)`;
    out['accent-color'] = hex;
    out['caret-color'] = `color-mix(in srgb, ${hex} 62%, #fff)`;
    out['--bg'] = `color-mix(in srgb, ${hex} 4%, #050508)`;
    out['--bg-raised'] = `color-mix(in srgb, ${hex} 5%, #08080c)`;
    out['--surface-1'] = `color-mix(in srgb, ${hex} 6%, #0c0c11)`;
    out['--surface-2'] = `color-mix(in srgb, ${hex} 7%, #131319)`;
    out['--surface-3'] = `color-mix(in srgb, ${hex} 8%, #1b1b23)`;
    out['--line'] = `color-mix(in srgb, ${hex} 10%, rgba(255, 255, 255, 0.06))`;
    out['--line-strong'] = `color-mix(in srgb, ${hex} 16%, rgba(255, 255, 255, 0.12))`;
  }
  if (pureBlack) {
    out['--bg'] = '#000';
    out['--bg-raised'] = '#000';
    out['--surface-1'] = '#0a0a0b';
  }
  return out;
}

/**
 * يلبس العقدتين (جذر التطبيق و<html>) لون القسم المختار، أو يمسح ما كُتب فيرجع اللون
 * المصمّم. يُستدعى عند كل تبديل قسم وعند تغيير الاختيار.
 * @returns {string|null} لون شريط النظام إن تغيّر (أسود صافي) أو null
 */
export function applyAppearance(section, nodes, a = readAppearance()) {
  // «الموحد» لون رابع مستقل؛ البنفسجي هو الأساسي للجميع.
  const hex = accentOf(section, a) ?? BRAND_DEFAULT;
  const vars = SECTIONS.includes(section) || section === 'unified' ? paletteVars(hex, { pureBlack: a.pureBlack }) : {};
  // علامة VANTARA تبقى على اللون الأساسي.
  vars['--brand'] = BRAND_DEFAULT;
  for (const node of nodes) {
    if (!node?.style) continue;
    for (const k of VARS) node.style.removeProperty(k);
    for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
  }
  return a.pureBlack ? '#000000' : null;
}

/**
 * الأوراق والنوافذ تُفتح بنغمة قسم ثابتة (`data-tone="anime"` في ورقة السيرفرات مثلًا) وقاعدتها في CSS
 * تعيد لون القسم المصمّم فوق ما اختاره المستخدم. هذه القواعد تُحقن بعد CSS الأقسام فتلبس كل نغمة
 * اللون المختار لقسمها أو البنفسجي الأساسي والأسود الصافي.
 */
export function toneCss(a = readAppearance(), { unified = false } = {}) {
  return SECTIONS.map((id) => {
    // مع التوحيد كل نغمة بلون الموحد: ورقة سيرفرات الأنمي لا تلبس لونًا غير لون الواجهة
    const vars = paletteVars(liveAccent(id, { unified }, a), { pureBlack: a.pureBlack });
    const body = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
    return body ? `.v35 [data-tone='${id}']{${body}}` : '';
  }).filter(Boolean).join('\n');
}
