/**
 * أنماط صفحة عمل المانجا الأربعة (إعدادات ← المظهر)، منقولة من النموذج الذي اعتمده المالك بقيمه:
 *   - page «الصفحة»: الغلاف 128px وبجانبه الاسم والمؤلفون والتقييم، ثم «اقرأ» عريضًا وثلاثة أفعال.
 *   - gallery «المعرض»: الغلاف في الوسط بضوء من ألوانه، الزر بين دائرتين، وتبويبات.
 *   - profile «الملف»: صورة العمل العريضة والغلاف متداخل معها، ثلاثة أرقام، والفصول بنطاقات 50.
 *   - resume «من حيث وقفت»: رقم الفصل التالي كبيرًا، والفصول شبكة أرقام.
 *
 * هنا الهيكل (المعرّفات نفسها في الأربعة: shell.js يملؤها ولا يعرف النمط إلا حيث يختلف المحتوى)
 * وحسابات النطاقات. لا شيء هنا يجلب بيانات أو يغيّر منطق المصادر والقارئ.
 */

/** معرّفات متفق عليها مع إعدادات المظهر؛ الأول هو الأساسي. */
export const MANGA_LOOKS = Object.freeze(['page', 'gallery', 'profile', 'resume']);

/** أي قيمة غير الأربعة (ومنها «core» قبل أن تعرف الإعدادات أنماط المانجا) = «الصفحة». */
export const mangaLook = (id) => (MANGA_LOOKS.includes(id) ? id : 'page');

/**
 * وضع «علّم فصول»: ما يُعلَّم لكل فعل. الصفوف من أي ترتيب؛ المرجع رقم الفصل.
 *   - selected: المحدّد كما هو (فصل أو مجموعة).
 *   - upTo: الفصل المحدّد وكل ما قبله (الأصغر رقمًا)، ومعه كل نسخ الرقم نفسه.
 *   - between: كل ما بين فصلين محدّدين (شاملًا الطرفين)، أيًّا كان ترتيب تحديدهما.
 * @param {object[]} rows كل صفوف العمل
 * @param {object[]} picked الصفوف المحدّدة
 * @returns {object[]}
 */
export function rowsForMark(rows, picked, mode = 'selected') {
  const num = (r) => Number(r?.number);
  if (mode === 'upTo') {
    if (picked.length !== 1 || !Number.isFinite(num(picked[0]))) return [];
    const top = num(picked[0]);
    return rows.filter((r) => Number.isFinite(num(r)) && num(r) <= top);
  }
  if (mode === 'between') {
    const ns = picked.map(num).filter(Number.isFinite);
    if (ns.length !== 2) return [];
    const [a, b] = ns[0] <= ns[1] ? ns : [ns[1], ns[0]];
    return rows.filter((r) => Number.isFinite(num(r)) && num(r) >= a && num(r) <= b);
  }
  return [...picked];
}

/**
 * نطاقات كل 50 فصلًا: 1–50، 51–100… وبقية أقل من 10 تُضم للنطاق قبلها (151–201 لا «201» وحده).
 * فصل «صفر» أو تمهيد يدخل الأول. عمل بنطاق واحد = بلا نطاقات.
 * @param {number[]} numbers أرقام الفصول
 * @returns {[number, number][]} من الأقدم للأحدث
 */
export function chapterGroups(numbers, size = 50) {
  const ints = numbers.filter((n) => Number.isFinite(n) && n >= 0).map((n) => Math.floor(n));
  if (!ints.length) return [];
  const max = Math.max(...ints);
  if (max <= size) return [];
  const groups = [];
  for (let a = 1; a <= max; a += size) groups.push([a, Math.min(max, a + size - 1)]);
  const last = groups.at(-1);
  if (groups.length > 1 && last[1] - last[0] + 1 < 10) {
    groups.pop();
    groups.at(-1)[1] = last[1];
  }
  groups[0][0] = Math.min(groups[0][0], ...ints);
  return groups.length > 1 ? groups : [];
}

/** رقم النطاق الذي فيه الفصل (128.5 مع 128، وما قبل الأول في الأول). */
export function groupIndexOf(groups, n) {
  if (!groups.length || !Number.isFinite(n)) return 0;
  const f = Math.floor(n);
  const at = groups.findIndex(([a, b]) => f >= a && f <= b);
  if (at >= 0) return at;
  return f < groups[0][0] ? 0 : groups.length - 1;
}

/** صفوف النطاق؛ الصف بلا رقم يُعرض في الأول. */
export function rowsInGroup(rows, groups, index) {
  if (!groups.length) return rows;
  return rows.filter((r) => groupIndexOf(groups, Number(r.number)) === index);
}

/** فصلٌ جديد: لم تقرأه، ونُشر في آخر سبعة أيام. */
export const isNewChapter = (row, read, now = Date.now()) =>
  !read && Number(row?.chapter?.dateUpload) > 0 && now - Number(row.chapter.dateUpload) < 7 * 86_400_000;

/**
 * هيكل صفحة العمل للنمط. العناصر بمعرّفاتها في كل الأنماط؛ ما لا يظهر في نمط لا يُبنى فيه
 * (shell.js يملأ ما وجده فقط).
 * @param {string} look
 * @param {{ glyph: Function, iconButton: Function }} icons
 */
export function detailMarkup(look, { glyph, iconButton }) {
  const L = mangaLook(look);
  const bar =
    `<header class="aw-bar mw-bar" id="detailTop">${iconButton('back', 'رجوع', { act: 'backFromDetail' })}` +
    `<div class="aw-bar-title"><span class="aw-bar-text" id="detailTopTitle" dir="auto"></span></div>` +
    `<div class="aw-tools" id="detailTools"></div><div class="aw-menu" id="detailMenu" role="menu" aria-label="المزيد"></div></header>` +
    // ستارة القائمة: تفصل عناوين الدوائر عن الصورة تحتها، ولمستها تغلق القائمة
    '<div class="mw-scrim" id="detailScrim" aria-hidden="true"></div>';
  const amb = (cls = 'mw-amb') => `<div class="${cls}" aria-hidden="true"><img id="detailGlow" alt="" decoding="async"></div>`;
  const cover = '<div class="mw-cover" id="detailCover"></div>';
  const kick = '<div class="mw-kick" id="detailKicker"></div>';
  const title = '<h1 class="mw-title" id="detailTitle" dir="auto" data-copyable>—</h1>';
  const who = '<div class="mw-who" id="detailWho" dir="auto"></div>';
  const stats = '<div class="mw-stats" id="detailStats"></div>';
  const genres = '<div class="mw-chips" id="detailGenres"></div>';
  const cta = (label = 'جارٍ جمع الفصول') =>
    `<button class="mw-cta" type="button" id="readCta" data-act="readNow" disabled><span class="mw-cta-text"><b id="readCtaLabel">${label}</b>` +
    `<small id="readCtaSub" dir="auto"></small></span><span class="mw-go" aria-hidden="true">${glyph('book', { size: 16 })}</span></button>`;
  const quick = (id, act, icon, label) =>
    `<button class="mw-quick-btn" type="button" id="${id}" data-act="${act}" aria-pressed="false">${glyph(icon, { size: 18 })}<span>${label}</span></button>`;
  const quick3 =
    `<div class="mw-quick">${quick('libraryBtn', 'toggleLibraryCurrent', 'library', 'مكتبتي')}` +
    `${quick('laterBtn', 'toggleLaterCurrent', 'clock', 'لاحقًا')}${quick('togetherBtn', 'readTogetherCurrent', 'users', 'مع أصدقائك')}</div>`;
  const square = (id, act, icon, label) =>
    `<button class="mw-square" type="button" id="${id}" data-act="${act}" aria-pressed="false" aria-label="${label}" title="${label}">${glyph(icon)}</button>`;
  const progress = (extra = '') =>
    `<div class="mw-progress" id="detailProgress" hidden><div class="mw-line"><i id="progressFill"></i></div>` +
    `<div class="mw-progress-row"><span id="progressText"></span><span class="mw-faint" id="progressNote"></span></div>${extra}</div>`;
  const insights = '<div class="work-insights" id="detailInsights"></div>';
  const story = (head) =>
    `<section class="mw-story" id="summaryBlock">${head ? '<h2 class="mw-h">القصة</h2>' : ''}` +
    `<p class="mw-desc clamped" id="description" dir="auto"><span class="mw-skel-lines" aria-hidden="true"><i></i><i></i><i></i></span></p><button class="mw-more" type="button" id="moreToggle" data-act="toggleSummary" hidden>المزيد</button></section>`;
  const chead =
    `<div class="mw-shead"><h2 class="mw-h">الفصول<small id="chapterCount"></small></h2>` +
    `<button class="mw-sort" type="button" id="chapterSort" data-act="flipChapterOrder">${glyph('sort', { size: 16 })}<span>الأحدث أولًا</span></button></div>`;
  const sources = '<div class="mw-src" id="sourcesBlock" hidden><div class="mw-src-row" id="sourceRow" role="radiogroup" aria-label="المصدر"></div></div>';
  const ranges = '<div class="mw-ranges" id="chapterRanges" role="tablist" aria-label="نطاق الفصول" hidden></div>';
  const panel = '<div class="mw-panel" id="chapterPanel"></div>';
  // نشاطك ونشاط أصدقائك يصل من الشبكة متأخرًا: مكانه آخر الصفحة مع المعلومات فلا يدفع ما فوقه
  const info = `<section class="mw-info"><h2 class="mw-h">معلومات</h2>${insights}<div class="info-grid" id="infoGrid"></div></section>`;

  if (L === 'gallery') {
    return (
      bar +
      `<div class="mw-stage">${amb()}${cover}<div class="mw-center mw-wrap">${title}${stats}${genres}</div></div>` +
      `<div class="mw-wrap mw-acts"><div class="mw-row">${square('libraryBtn', 'toggleLibraryCurrent', 'library', 'مكتبتي')}${cta()}` +
      `${square('togetherBtn', 'readTogetherCurrent', 'users', 'اقرأ مع أصدقائك')}</div>${progress()}</div>` +
      `<div class="mw-tabbed"><div class="mw-tabs" role="tablist" id="detailTabs">` +
      `<button type="button" role="tab" aria-selected="true" data-tab="chapters">الفصول</button>` +
      `<button type="button" role="tab" aria-selected="false" data-tab="about">عن العمل</button>` +
      `<button type="button" role="tab" aria-selected="false" data-tab="similar" id="similarTab" hidden>مشابهة</button></div>` +
      `<div class="mw-wrap mw-tab" data-panel="chapters">${sources}` +
      `<div class="mw-shead mw-shead--bare"><span class="mw-count" id="chapterCount"></span><button class="mw-sort" type="button" id="chapterSort" data-act="flipChapterOrder">${glyph('sort', { size: 16 })}<span>الأحدث أولًا</span></button></div>` +
      `${panel}</div>` +
      `<div class="mw-wrap mw-tab" data-panel="about" hidden>${story(false)}${info}</div>` +
      `<div class="mw-wrap mw-tab" data-panel="similar" hidden><div class="mw-similar" id="similarGrid"></div></div></div>`
    );
  }
  if (L === 'profile') {
    return (
      bar +
      `<div class="mw-ban" aria-hidden="true"><img id="detailBanner" alt="" decoding="async">${amb('mw-ban-amb')}</div>` +
      `<div class="mw-idrow">${cover}<div class="mw-id">${kick}${title}${who}</div></div>` +
      `<div class="mw-nums" id="detailStats"></div>` +
      `<div class="mw-wrap"><div class="mw-row">${cta()}${square('libraryBtn', 'toggleLibraryCurrent', 'library', 'مكتبتي')}</div>` +
      `${genres}${story(false)}<section class="mw-chapters">${chead}${sources}${ranges}${panel}</section>${info}</div>`
    );
  }
  if (L === 'resume') {
    return (
      bar +
      `<div class="mw-resume">${amb('mw-resume-bg')}<small id="resumeKick">تابع من حيث وقفت</small>` +
      `<div class="mw-big"><b id="resumeNum">—</b><span id="resumeLabel">الفصل التالي</span></div>${progress()}${cta('تابع الآن')}</div>` +
      `<div class="mw-ident">${cover}<div class="mw-id">${title}${stats}</div></div>` +
      `<div class="mw-wrap">${quick3}<section class="mw-chapters">${chead}${sources}${ranges}${panel}</section>` +
      `${story(true)}${genres}${info}</div>`
    );
  }
  return (
    bar +
    `<div class="mw-hero">${amb()}<div class="mw-head">${cover}<div class="mw-id">${kick}${title}${who}${stats}</div></div></div>` +
    `<div class="mw-wrap">${genres}${cta()}${quick3}${progress()}${story(true)}` +
    `<section class="mw-chapters">${chead}${sources}${panel}</section>${info}</div>`
  );
}
