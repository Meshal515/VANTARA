/**
 * قائمة ⋮ في صفحة العمل: ترتيب واحد وأسماء واحدة للأقسام الثلاثة (قرار المالك، 9 نوفمبر).
 * هذا الملف يقرّر «ماذا يظهر وبأي اسم وحالة»، وكل قسم يربط الأفعال بمنطقه هو (المكتبة والجداول واحدة:
 * `library`، `collections` [read_later/favorite/top]، `completions`، `ratings`، `chapter_marks`).
 *
 * الترتيب: أتابعها/في مكتبتي، لاحقًا، علّم الفصول/الحلقات، قرأته/شاهدته سابقًا، أفضل 5، (الترجمة للمانجا)،
 * خيارات أخرى (التقييم، أكملته، الإبلاغ، الحذف).
 * لا «مشاركة» في صفحة العمل؛ «رشّح» للأصدقاء في الشريط العلوي وحده.
 */

/** @typedef {'manga'|'anime'|'series'|'movie'} WorkKind */

/** نوع العمل من قسمه وما عُرف عنه. الفيلم بلا حلقات. */
export function workKind(section, { movie = false } = {}) {
  if (section === 'manga') return 'manga';
  if (movie) return 'movie';
  return section === 'cinema' ? 'series' : 'anime';
}

export const libraryLabel = (saved) => (saved ? 'في مكتبتي' : 'أتابعها');
export const previousLabel = (kind) => (kind === 'manga' ? 'قرأته سابقًا' : 'شاهدته سابقًا');
export const markLabel = (kind) => (kind === 'manga' ? 'علّم الفصول' : 'علّم الحلقات');

/**
 * @param {WorkKind} kind
 * @param {{ library?: boolean, later?: boolean, top?: boolean, previous?: boolean, canMark?: boolean,
 *   translate?: { available: boolean, on: boolean } | null, signedIn?: boolean }} s
 * @returns {{ id: string, icon: string, label: string, pressed: boolean }[]}
 */
export function workMenuEntries(kind, s = {}) {
  const out = [];
  const add = (id, icon, label, pressed = false) => out.push({ id, icon, label, pressed: Boolean(pressed) });
  add('library', s.library ? 'check' : 'plus', libraryLabel(s.library), s.library);
  if (s.signedIn !== false) add('later', s.later ? 'check' : 'clock', 'لاحقًا', s.later);
  // الأفلام لا حلقات لها: لا «علّم الحلقات»، و«شاهدته سابقًا» يعلّم الفيلم نفسه
  if (kind !== 'movie' && s.canMark !== false) add('mark', 'eye', markLabel(kind));
  add('previous', 'history', previousLabel(kind), s.previous);
  if (s.signedIn !== false) add('top', 'flame', s.top ? 'في أفضل 5' : 'أفضل 5', s.top);
  if (kind === 'manga' && s.translate?.available) add('translate', 'translateAr', s.translate.on ? 'الترجمة التلقائية: شغّالة' : 'الترجمة التلقائية', s.translate.on);
  if (s.signedIn !== false) add('options', 'sliders', 'خيارات أخرى');
  return out;
}

/**
 * ورقة «خيارات أخرى»: التقييم الشخصي وأكملته والإبلاغ (والحذف حيث يوجد)، كل واحد بحالته الحالية.
 * @param {{ rating: number, completed: boolean, canReport?: boolean, canDelete?: boolean }} s
 */
export function workOptionEntries(s) {
  const out = [
    { id: 'rate', icon: 'star', label: s.rating ? `تقييمك ${s.rating} من 5 — غيّره` : 'قيّم العمل', pressed: s.rating > 0 },
    { id: 'completed', icon: 'check', label: s.completed ? 'مكتمل — المس للإلغاء' : 'علّمه مكتملًا', pressed: Boolean(s.completed) },
  ];
  if (s.canReport) out.push({ id: 'report', icon: 'flag', label: 'بلّغ عن مشكلة في العمل', pressed: false });
  if (s.canDelete) out.push({ id: 'delete', icon: 'trash', label: 'حذف العمل', pressed: false, danger: true });
  return out;
}
