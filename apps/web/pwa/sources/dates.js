/**
 * تواريخ الفصول كما تكتبها مواقع المصادر، بالعربي والإنجليزي:
 *   «منذ 3 أيام»، «3 days ago»، «اليوم»، «2026-09-14»، «14 سبتمبر، 2026»،
 *   «September 14, 2026»، «14 أيلول 2026».
 * يرجع ملّي ثانية UTC، أو 0 إن لم يُفهم (نفس عقد Keiyoushi).
 */

import { foldDigits } from './dom.js';

const AR_MONTHS = [
  ['يناير', 'كانون الثاني', 'جانفي'],
  ['فبراير', 'شباط', 'فيفري'],
  ['مارس', 'آذار', 'اذار'],
  ['أبريل', 'ابريل', 'إبريل', 'نيسان', 'أفريل'],
  ['مايو', 'أيار', 'ايار', 'ماي'],
  ['يونيو', 'حزيران', 'جوان'],
  ['يوليو', 'تموز', 'جويلية'],
  ['أغسطس', 'اغسطس', 'آب', 'اب', 'أوت'],
  ['سبتمبر', 'أيلول', 'ايلول'],
  ['أكتوبر', 'اكتوبر', 'تشرين الأول', 'تشرين الاول'],
  ['نوفمبر', 'تشرين الثاني'],
  ['ديسمبر', 'كانون الأول', 'كانون الاول'],
];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const UNITS = [
  [/(?<!\p{L})(years?|سنة|سنوات|سنين|عام|أعوام)/u, 365 * 864e5],
  [/(?<!\p{L})(months?|شهر|أشهر|شهور)/u, 30 * 864e5],
  [/(?<!\p{L})(weeks?|أسبوع|أسابيع|اسبوع|اسابيع)/u, 7 * 864e5],
  [/(?<!\p{L})(days?|يوم|أيام|ايام)/u, 864e5],
  [/(?<!\p{L})(hours?|ساعة|ساعات)/u, 36e5],
  [/(?<!\p{L})(minutes?|mins?|دقيقة|دقائق)/u, 6e4],
  [/(?<!\p{L})(seconds?|secs?|ثانية|ثوان|ثواني)/u, 1e3],
];

/** المثنّى: «ساعتين»، «يومين»، «دقيقتين»… = اثنان من الوحدة. */
const DUALS = [
  [/(?<!\p{L})(سنتين|سنتان|عامين|عامان)/u, 365 * 864e5],
  [/(?<!\p{L})(شهرين|شهران)/u, 30 * 864e5],
  [/(?<!\p{L})(أسبوعين|اسبوعين|أسبوعان|اسبوعان)/u, 7 * 864e5],
  [/(?<!\p{L})(يومين|يومان)/u, 864e5],
  [/(?<!\p{L})(ساعتين|ساعتان)/u, 36e5],
  [/(?<!\p{L})(دقيقتين|دقيقتان)/u, 6e4],
  [/(?<!\p{L})(ثانيتين|ثانيتان)/u, 1e3],
];

function monthIndex(word) {
  const w = word.trim().toLowerCase();
  const en = EN_MONTHS.findIndex((m) => w.startsWith(m));
  if (en >= 0) return en;
  return AR_MONTHS.findIndex((names) => names.some((n) => w === n || w.startsWith(n)));
}

export function parseDate(raw, now = Date.now()) {
  const value = foldDigits(String(raw ?? '')).replace(/[،,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return 0;
  const lower = value.toLowerCase();
  const today = new Date(now);
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (/^(today|اليوم)/.test(lower)) return midnight;
  if (/^(yesterday|أمس|امس|يوم واحد)/.test(lower)) return midnight - 864e5;

  // «منذ 3 أيام» / «3 days ago» / «منذ ساعة» / «ساعتين ago» (المثنّى بلا رقم: Madara
  // العربية تكتب أحدث الفصول هكذا، وكانت تُرجع 0 فيصير أحدث فصل بلا تاريخ)
  if (/ago|منذ|قبل/.test(lower)) {
    const dual = DUALS.find(([re]) => re.test(lower));
    if (dual && !/\d/.test(lower)) return now - 2 * dual[1];
    const n = Number(lower.match(/\d+/)?.[0] ?? 1);
    for (const [re, ms] of UNITS) if (re.test(lower)) return now - n * ms;
  }

  // 2026-09-14 أو 2026/09/14
  let m = value.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  // 14/09/2026
  m = value.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  // 14 سبتمبر 2026 / 14 September 2026
  m = value.match(/(\d{1,2})\s+([\p{L} ]+?)\s+(\d{4})/u);
  if (m) {
    const month = monthIndex(m[2]);
    if (month >= 0) return Date.UTC(+m[3], month, +m[1]);
  }
  // September 14 2026
  m = value.match(/([\p{L}]+)\s+(\d{1,2})\s+(\d{4})/u);
  if (m) {
    const month = monthIndex(m[1]);
    if (month >= 0) return Date.UTC(+m[3], month, +m[2]);
  }
  return 0;
}
