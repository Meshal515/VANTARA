/**
 * نظام إعدادات التجربة المركزي: تطبيق واحد بأربع طبقات منفصلة، لا ثلاث نسخ منه.
 *
 *   1. إعدادات المستخدم: ما اختاره ويُحفظ على هذا الجهاز. بنية التجربة هنا بمفتاحها
 *      (`vantara.experience.v1`)، والمظهر (الأنماط والألوان والخلفية) في appearance.js بمفتاحه القديم.
 *   2. التصميم والقوالب: `experienceView()` يقول أي قالب رئيسية يُرسم لكل قسم، وأي نمط بطاقة لكل قسم.
 *      نمط البطاقة (`cardStyle[section]`) مستقل عن قالب الشاشة وعن توحيد المحتوى.
 *   3. التنقل: هل يظهر مبدّل الأقسام، وأي رئيسية تظهر (القسم أو المشتركة).
 *   4. البيانات والمحتوى: لا يكتب هذا الملف فيها شيئًا. توحيد المحتوى عرضٌ فوق المكتبات والتقدم كما هي،
 *      فالرجوع عنه لا يحتاج ترحيلًا ولا يفقد شيئًا.
 *
 * عقد الحالات (قرار المالك): ثلاث حالات صحيحة فقط.
 *   (false,false) الاستقلال الكامل · (true,false) توحيد الشاشات · (true,true) توحيد المحتوى.
 *   (false,true) ممنوعة: توحيد المحتوى لا يُفعَّل قبل توحيد الشاشات، وإيقاف الشاشات يوقفه
 *   ويحفظ تفضيله (`contentPreferred`) فيعود حين تُعاد الشاشات.
 */

import { readAppearance, workStyleOf } from './appearance.js';

const KEY = 'vantara.experience.v1';

export const SECTION_ORDER = Object.freeze(['manga', 'anime', 'cinema']);
/** قوالب الشاشة: تصميم رئيسية أحد الأقسام الثلاثة، ولا رابع. */
export const TEMPLATES = SECTION_ORDER;
export const DEFAULT_TEMPLATE = 'manga';

export const MODES = Object.freeze({ independent: 'independent', screens: 'screens', content: 'content' });

/** @typedef {{ unifyScreens: boolean, unifyContent: boolean, contentPreferred: boolean, template: string }} Structure */

/** @returns {Structure} */
export function defaultStructure() {
  return { unifyScreens: false, unifyContent: false, contentPreferred: false, template: DEFAULT_TEMPLATE };
}

/**
 * أي قيمة (محفوظة، تالفة، من إصدار آخر) إلى حالة صحيحة. الممنوعة (false,true) تصير الاستقلال
 * مع حفظ تفضيل المحتوى، فلا يضيع ما أراده المستخدم ولا تُعرض حالة غير معرّفة.
 * @returns {Structure}
 */
export function normalizeStructure(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const unifyScreens = v.unifyScreens === true;
  const wantsContent = v.unifyContent === true;
  const contentPreferred = v.contentPreferred === true || wantsContent;
  return {
    unifyScreens,
    unifyContent: unifyScreens && wantsContent,
    contentPreferred,
    template: TEMPLATES.includes(v.template) ? v.template : DEFAULT_TEMPLATE,
  };
}

export function isValidStructure(s) {
  return !(s?.unifyContent === true && s?.unifyScreens !== true);
}

/** @returns {'independent'|'screens'|'content'} */
export function modeOf(s) {
  const n = normalizeStructure(s);
  if (n.unifyContent) return MODES.content;
  if (n.unifyScreens) return MODES.screens;
  return MODES.independent;
}

/**
 * يقرأ البنية. بلا مفتاح (كل مستخدم قبل هذا الإصدار): الاستقلال الكامل، وهو ما كان يراه دائمًا.
 * القراءة لا تكتب شيئًا: لا ترحيل مدمّر عند الإقلاع.
 */
export function readStructure(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    return raw == null ? defaultStructure() : normalizeStructure(JSON.parse(raw));
  } catch {
    return defaultStructure();
  }
}

export function writeStructure(next, storage = globalThis.localStorage) {
  const s = normalizeStructure(next);
  try {
    storage?.setItem(KEY, JSON.stringify({ v: 1, ...s }));
  } catch {
    // تخزين محجوب: الاختيار يبقى لهذه الجلسة
  }
  return s;
}

/** تشغيل توحيد الشاشات يعيد تفضيل المحتوى المحفوظ؛ إيقافه يوقف المحتوى ويحفظ تفضيله. */
export function setUnifyScreens(s, on) {
  const n = normalizeStructure(s);
  if (on) return { ...n, unifyScreens: true, unifyContent: n.contentPreferred };
  return { ...n, unifyScreens: false, unifyContent: false };
}

/** توحيد المحتوى لا يُقبل قبل توحيد الشاشات: الطلب يُرجع الحالة كما هي. */
export function setUnifyContent(s, on) {
  const n = normalizeStructure(s);
  if (!n.unifyScreens) return n;
  return { ...n, unifyContent: on === true, contentPreferred: on === true };
}

/** القالب يُحفظ في كل حالة (فيعود كما كان حين يُعاد التوحيد)، ولا يُقبل إلا أحد الثلاثة. */
export function setTemplate(s, template) {
  const n = normalizeStructure(s);
  return TEMPLATES.includes(template) ? { ...n, template } : n;
}

/**
 * ما يحتاجه العرض والتنقل من الطبقات كلها، محسوبًا مرة واحدة.
 * @param {Structure} structure
 * @param {object} appearance من readAppearance
 */
export function experienceView(structure = readStructure(), appearance = readAppearance()) {
  const s = normalizeStructure(structure);
  const mode = modeOf(s);
  const cardStyle = Object.fromEntries(SECTION_ORDER.map((id) => [id, workStyleOf(id, appearance)]));
  return {
    mode,
    /** قالب رئيسية القسم: قالبه هو، أو القالب الموحّد. */
    screenTemplate: (section) => (s.unifyScreens ? s.template : SECTION_ORDER.includes(section) ? section : DEFAULT_TEMPLATE),
    template: s.unifyScreens ? s.template : null,
    /** نمط صفحة العمل لكل قسم: لا يتأثر بالقالب ولا بالمحتوى. */
    cardStyle,
    /** التنقل: المبدّل يختفي في توحيد المحتوى فقط، والرئيسية المشتركة تحل محل رئيسيات الأقسام. */
    showSectionSwitch: !s.unifyContent,
    home: s.unifyContent ? 'all' : 'section',
  };
}
