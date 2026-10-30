/**
 * المظهر: نمط صفحة العمل، ولون كل قسم، والخلفية. يُحفظ على هذا الجهاز فقط.
 *
 * اللون يغيّر متغيّرات القسم نفسها (--accent وأخواته، وصبغة الخلفية) على جذر التطبيق و<html>
 * معًا، فما يُعلَّق على body (التنبيهات والأوراق) يرث اللون نفسه ولا يرجع لبنفسجي المانجا.
 * بلا اختيار: لا شيء يُكتب، وتبقى ألوان الأقسام المصمّمة في CSS كما هي.
 */

const KEY = 'vantara.appearance.v1';

/** أنماط صفحة عمل الأنمي. الأول هو الأساسي. */
export const WORK_STYLES = Object.freeze([
  { id: 'core', name: 'المحور', note: 'الغلاف في النص والشعار تحته' },
  { id: 'platform', name: 'المنصة', note: 'الغلاف والتشغيل يرافقانك' },
  { id: 'card', name: 'البطاقة الطائرة', note: 'غلاف مائل وحلقات تُسحب' },
  { id: 'screen', name: 'شاشة السينما', note: 'البنر شاشة والحلقات خط زمني' },
  { id: 'episode', name: 'الحلقة أولًا', note: 'ما ستكمله الآن في الأعلى' },
]);

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
    const v = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (!v || typeof v !== 'object') return blank();
    return {
      style: v.style && typeof v.style === 'object' ? v.style : {},
      accent: v.accent && typeof v.accent === 'object' ? v.accent : {},
      pureBlack: v.pureBlack === true,
    };
  } catch {
    return blank();
  }
}

export function writeAppearance(next, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // تخزين محجوب: الاختيار يبقى لهذه الجلسة
  }
  return next;
}

/** نمط صفحة العمل للقسم؛ قيمة غير معروفة ترجع للأساسي. */
export function workStyleOf(section, a = readAppearance()) {
  const id = a.style?.[section];
  return WORK_STYLES.some((s) => s.id === id) ? id : 'core';
}

/** لون القسم المختار (hex) أو null = لون القسم المصمّم. */
export function accentOf(section, a = readAppearance()) {
  const id = a.accent?.[section];
  return ACCENTS.find((c) => c.id === id)?.hex ?? null;
}

const VARS = ['--on-accent', '--accent', '--accent-press', '--accent-text', '--accent-soft', '--accent-line', 'accent-color', 'caret-color', '--bg', '--bg-raised', '--surface-1', '--surface-2', '--surface-3', '--line', '--line-strong'];

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
 * لون النص فوق اللون المختار: الأبيض كما في تصميم الأقسام ما دام مقروءًا عليه (تباين 3 فأكثر، معيار
 * عناصر الواجهة والنص الكبير)، والأسود للألوان الفاتحة فقط (الأبيض والذهبي والعنبري والليموني).
 */
export function onAccent(hex) {
  return contrast(hex, '#ffffff') >= 3 ? '#ffffff' : '#0b0b0f';
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
  const vars = SECTIONS.includes(section) ? paletteVars(accentOf(section, a), { pureBlack: a.pureBlack }) : {};
  for (const node of nodes) {
    if (!node?.style) continue;
    for (const k of VARS) node.style.removeProperty(k);
    for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
  }
  return a.pureBlack ? '#000000' : null;
}
