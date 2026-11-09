/**
 * نظام إعدادات التجربة المركزي: تطبيق واحد بطبقات منفصلة، لا ثلاث نسخ منه.
 *
 *   1. إعدادات المستخدم: ما اختاره ويُحفظ على هذا الجهاز. بنية التجربة هنا بمفتاحها
 *      (`vantara.experience.v1`)، والمظهر (الأنماط والألوان والخلفية) في appearance.js بمفتاحه القديم.
 *   2. التصميم: `experienceView()` يقول أي رئيسية تظهر، وأي نمط بطاقة لكل قسم.
 *   3. التنقل: هل يظهر مبدّل الأقسام.
 *   4. البيانات: لا يكتب هذا الملف فيها شيئًا. توحيد المحتوى عرضٌ فوق المكتبات والتقدم كما هي
 *      (الجداول نفسها، `series_ref` يميّز النوع)، فالرجوع عنه لا يحتاج ترحيلًا ولا يفقد شيئًا.
 *
 * عقد الحالات (قرار المالك، 8 نوفمبر): حالتان فقط.
 *   الاستقلال: كل قسم بشاشته ومكتبته · توحيد المحتوى: تطبيق موحّد واحد بفلتر الأنواع.
 * «توحيد الشاشات» حُذف نهائيًا: قيمته المحفوظة من إصدار سابق تُقرأ استقلالًا، ولا تُكتب بعد اليوم.
 */

import { readAppearance, workStyleOf } from './appearance.js';

const KEY = 'vantara.experience.v1';

export const SECTION_ORDER = Object.freeze(['manga', 'anime', 'cinema']);

export const MODES = Object.freeze({ independent: 'independent', content: 'content' });

/** @typedef {{ unifyContent: boolean }} Structure */

/** @returns {Structure} */
export function defaultStructure() {
  return { unifyContent: false };
}

/**
 * أي قيمة (محفوظة، تالفة، من إصدار آخر) إلى حالة صحيحة.
 * من الإصدار السابق: (شاشات+محتوى) → محتوى، و(شاشات وحدها) → استقلال. تفضيل محتوى محفوظ بلا تفعيل
 * لا يُفعّله: المستخدم لم يكن يراه.
 * @returns {Structure}
 */
export function normalizeStructure(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  // في الإصدار السابق كان المحتوى لا يعمل إلا مع الشاشات؛ (false,true) لم تكن حالة ظاهرة
  const legacy = 'unifyScreens' in v;
  const on = v.unifyContent === true && (!legacy || v.unifyScreens === true);
  return { unifyContent: on };
}

/** @returns {'independent'|'content'} */
export function modeOf(s) {
  return normalizeStructure(s).unifyContent ? MODES.content : MODES.independent;
}

/** القراءة لا تكتب شيئًا: لا ترحيل مدمّر عند الإقلاع. بلا مفتاح: الاستقلال. */
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
    storage?.setItem(KEY, JSON.stringify({ v: 2, ...s }));
  } catch {
    // تخزين محجوب: الاختيار يبقى لهذه الجلسة
  }
  return s;
}

export function setUnifyContent(s, on) {
  return { ...normalizeStructure(s), unifyContent: on === true };
}

/**
 * ما يحتاجه العرض والتنقل، محسوبًا مرة واحدة.
 * @param {Structure} structure
 * @param {object} appearance من readAppearance
 */
export function experienceView(structure = readStructure(), appearance = readAppearance()) {
  const s = normalizeStructure(structure);
  const cardStyle = Object.fromEntries(SECTION_ORDER.map((id) => [id, workStyleOf(id, appearance)]));
  return {
    mode: modeOf(s),
    /** نمط صفحة العمل لكل قسم: لا يتأثر بالتوحيد. */
    cardStyle,
    showSectionSwitch: !s.unifyContent,
    home: s.unifyContent ? 'all' : 'section',
  };
}
