/**
 * الأسماء البديلة لعمل مانجا كما يكتبها مصدره — أساس الهوية الواحدة.
 *
 * نفس العمل يحمل في مصدر اسمه الإنجليزي («Magic Emperor») وفي آخر اسمه العربي
 * («الإمبراطور الشيطاني») أو الروماجي. صفحة العمل في أغلب القوالب تذكر البقية:
 *   Madara        حقل «Alternative / الأسماء الأخرى» في .post-content_item
 *   MangaThemesia .alternative / «Alternative Titles»
 *   إضافات الـAPK (Keiyoushi) تضيفها في آخر الوصف: «Alternative Names: …»
 *
 * هنا القراءة فقط (DOM أو نص)، بلا شبكة. الربط نفسه وحراسته من الدمج الخاطئ في
 * `catalog.js` (canonicalIndex).
 */

const LABEL = /^(?:alternative(?:\s+(?:names?|titles?))?|alt(?:ernate)?\s*(?:names?|titles?)?|other\s+names?|associated\s+names?|aka|الاسم\s+البديل|الأسماء\s+البديلة|الاسماء\s+البديلة|أسماء\s+أخرى|اسماء\s+اخرى|الأسماء\s+الأخرى|الاسماء\s+الاخرى|العنوان\s+البديل|عناوين\s+أخرى|اسم\s+آخر)\s*[:：]?$/i;
const IN_TEXT = /(?:^|\n)\s*(?:alternative(?:\s+(?:names?|titles?))?|alt(?:ernate)?\s+(?:names?|titles?)|other\s+names?|associated\s+names?|الأسماء\s+البديلة|الاسماء\s+البديلة|أسماء\s+أخرى|اسماء\s+اخرى|الأسماء\s+الأخرى|الاسم\s+البديل)\s*[:：]\s*([^\n]+)/gi;
const NONE = /^(?:-+|n\/?a|none|updating|لا يوجد|غير معروف|\?+)$/i;

/** «A, B ; C / D | E، F» ← [A…F] بلا فراغات ولا تكرار ولا كلمات «لا يوجد». */
export function splitNames(raw) {
  const out = [];
  for (const part of String(raw ?? '').split(/\s*[,;؛،|\n]\s*|\s+\/\s+/)) {
    const name = part.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 120 || NONE.test(name)) continue;
    if (!out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/** من الوصف النصي (إضافات الـAPK). */
export function aliasesFromText(description) {
  const out = [];
  for (const m of String(description ?? '').matchAll(IN_TEXT)) out.push(...splitNames(m[1]));
  return [...new Set(out)];
}

/**
 * من صفحة العمل (DOM). `q`/`qa`/`text` من pwa/sources/dom.js (تمرَّر كي تبقى
 * الوحدة بلا اعتماد على محلّل بعينه).
 */
export function aliasesFromDoc(doc, { q, qa, text }) {
  const out = [];
  // Madara: عنوان الحقل في .summary-heading وقيمته في .summary-content
  for (const item of qa(doc, '.post-content_item, .post-content .post-content_item')) {
    const label = text(q(item, '.summary-heading')) ?? '';
    if (LABEL.test(label.trim())) out.push(...splitNames(text(q(item, '.summary-content'))));
  }
  // MangaThemesia وأشباهه
  for (const el of qa(doc, '.alternative, .seriestualt, span.alter, .wd-full .alternative')) out.push(...splitNames(text(el)));
  for (const row of qa(doc, '.wd-full, .imptdt, tr, .infotable tr')) {
    const label = text(q(row, 'b, h2, td:first-child, th')) ?? '';
    if (LABEL.test(label.trim())) {
      const value = (text(q(row, 'span, td:last-child')) || '').trim();
      if (value && value !== label.trim()) out.push(...splitNames(value));
    }
  }
  return [...new Set(out)];
}
