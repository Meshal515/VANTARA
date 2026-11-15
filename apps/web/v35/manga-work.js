/**
 * أنماط صفحة عمل المانجا (إعدادات ← المظهر)، بقرارات المالك:
 *   - page «كلاسيكي»: صفحة Stable كما هي، بلا عمق.
 *   - webtoon «ويبتوني»: الفن طوليًا بنسبته، إيقاع الإصدار، والفصول خط زمني بالشهور.
 *   - gallery «المعرض»: الغلاف في الوسط بضوء من ألوانه، الزر بين دائرتين، وتبويبات.
 *   - profile «الملف»: صورة العمل العريضة والغلاف متداخل معها، ثلاثة أرقام، والفصول بنطاقات 50.
 *   - resume «من حيث وقفت»: رقم الفصل التالي كبيرًا، والفصول شبكة أرقام.
 *
 * هنا الهيكل (المعرّفات نفسها في الأربعة: shell.js يملؤها ولا يعرف النمط إلا حيث يختلف المحتوى)
 * وحسابات النطاقات. لا شيء هنا يجلب بيانات أو يغيّر منطق المصادر والقارئ.
 */

/** معرّفات متفق عليها مع إعدادات المظهر؛ الأول هو الأساسي. */
export const MANGA_LOOKS = Object.freeze(['page', 'gallery', 'profile', 'resume', 'webtoon']);

/** أنماط تبني على هيكل «المعرض» (الغلاف، الزر بين مربعين، وتبويبات) وتختلف بالـCSS وبعض المحتوى. */
export const TABBED_LOOKS = Object.freeze(['gallery', 'webtoon']);

/** أي قيمة غير معروفة (ومنها نمط حُذف، أو «core» قبل أن تعرف الإعدادات أنماط المانجا) = «كلاسيكي». */
export const mangaLook = (id) => (MANGA_LOOKS.includes(id) ? id : 'page');

/** Distinguish a genuine wide banner from a portrait/square metadata image. */
export const isWideMangaArtwork = (width, height) =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width / height >= 1.2;

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
    `<header class="aw-bar mw-bar" id="detailTop" data-motion-fixed>${iconButton('back', 'رجوع', { act: 'backFromDetail' })}` +
    `<div class="aw-bar-title"><span class="aw-bar-text" id="detailTopTitle" dir="auto"></span></div>` +
    `<div class="aw-tools" id="detailTools"></div><div class="aw-menu" id="detailMenu" role="menu" aria-label="المزيد"></div></header>` +
    // ستارة القائمة: تفصل عناوين الدوائر عن الصورة تحتها، ولمستها تغلق القائمة
    '<div class="mw-scrim" id="detailScrim" aria-hidden="true" data-motion-fixed></div>';
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

  if (TABBED_LOOKS.includes(L)) {
    // «ويبتوني» (قرار المالك، 12 نوفمبر): بحث في الفصول برقمه أو اسمه بدل النطاقات
    const find = L !== 'webtoon' ? '' :
      `<label class="mw-find">${glyph('search', { size: 16 })}<input type="search" id="chapterSearch" inputmode="search" enterkeyhint="search" ` +
      `placeholder="ابحث برقم الفصل أو اسمه" aria-label="ابحث في الفصول" autocomplete="off"></label>`;
    // «ويبتوني»: إيقاع الإصدار يُحسب من تواريخ الفصول (shell.js)، ويُخفى إن لم يكفِ ما يُحسب منه. سطر هادئ
    // تحت التصنيفات (قرار المالك، 13 نوفمبر) لا شارة فوق الفن؛ مكانه محجوز من البداية فلا يدفع شيئًا حين يصل
    const beat = L === 'webtoon' ? '<p class="wt-beat" id="releaseBeat" data-off aria-hidden="true"></p>' : '';
    return (
      bar +
      // .mw-lift: طبقة عمق التمرير (depth.js)، منفصلة عن الغلاف الذي يحمل حركة الدخول
      // «ويبتوني» على الكمبيوتر: لوحا كوميكس جانبيان من الفن نفسه (desktop-work.css)؛ مخفيان على الجوال
      `<div class="mw-stage">${amb()}${L === 'webtoon' ? '<div class="wt-panels" aria-hidden="true"><img class="wt-p" data-wt-panel alt="" decoding="async"><img class="wt-p" data-wt-panel alt="" decoding="async"></div>' : ''}` +
      `<div class="mw-lift">${cover}</div><div class="mw-center mw-wrap">${title}${stats}${genres}${beat}</div></div>` +
      `<div class="mw-wrap mw-acts"><div class="mw-row">${square('libraryBtn', 'toggleLibraryCurrent', 'library', 'مكتبتي')}${cta()}` +
      `${square('togetherBtn', 'readTogetherCurrent', 'users', 'اقرأ مع أصدقائك')}</div>${progress()}</div>` +
      `<div class="mw-tabbed"><div class="mw-tabs" role="tablist" id="detailTabs">` +
      `<button type="button" role="tab" aria-selected="true" data-tab="chapters">الفصول</button>` +
      `<button type="button" role="tab" aria-selected="false" data-tab="about">عن العمل</button>` +
      `<button type="button" role="tab" aria-selected="false" data-tab="similar" id="similarTab" hidden>مشابهة</button></div>` +
      `<div class="mw-wrap mw-tab" data-panel="chapters">${sources}${find}` +
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
  // «كلاسيكي» (المعرّف page محفوظ عند المستخدمين): صفحة Stable كما هي (قرار المالك، 12 نوفمبر):
  // الغلاف وبجانبه الاسم والعدد، ثم «ابدأ القراءة» عريضًا وثلاثة أزرار، والمصادر، والتقدم، ثم STORY
  // وCHAPTERS والمعلومات. بلا عمق تمرير. المعرّفات نفسها التي تملؤها القشرة لكل الأنماط.
  const eyebrow = (t) => `<span class="section-eyebrow">${t}</span>`;
  return (
    bar +
    `<div class="detail-glow" aria-hidden="true"><img id="detailGlow" alt="" decoding="async"></div>` +
    `<div class="detail-head" data-reveal><div class="detail-cover" id="detailCover"></div><div class="detail-meta">` +
    `<div class="detail-folio" id="detailFolio" dir="ltr"></div><div class="detail-kicker" id="detailKicker"></div><h1 id="detailTitle" dir="auto" data-copyable>—</h1>` +
    `<div class="detail-sub" id="detailWho" dir="auto"></div><div class="detail-sub" id="detailStats"></div>` +
    `<div class="chips" id="detailGenres"></div></div></div>` +
    `<div class="detail-cta" data-reveal><button class="btn btn-primary read-cta" type="button" id="readCta" data-act="readNow" disabled>` +
    `${glyph('book')}<span id="readCtaLabel">جارٍ جمع الفصول</span><small id="readCtaSub" dir="auto"></small></button></div>` +
    `<div class="detail-quick" data-reveal>` +
    `<button class="quick-btn" type="button" id="libraryBtn" data-act="toggleLibraryCurrent" aria-pressed="false">${glyph('library')}<span>مكتبتي</span></button>` +
    `<button class="quick-btn" type="button" id="laterBtn" data-act="toggleLaterCurrent" aria-pressed="false">${glyph('clock')}<span>لاحقًا</span></button>` +
    `<button class="quick-btn" type="button" id="togetherBtn" data-act="readTogetherCurrent" aria-pressed="false">${glyph('users')}<span>مع أصدقائك</span></button></div>` +
    `<div class="source-switch" id="sourcesBlock" hidden><div class="source-row" id="sourceRow" role="radiogroup" aria-label="المصدر"></div></div>` +
    `<div class="detail-progress" id="detailProgress" hidden><div class="progress-bar"><i id="progressFill"></i></div>` +
    `<div class="progress-row"><span id="progressText"></span><span class="mw-faint" id="progressNote"></span></div></div>` +
    `<div class="block" id="summaryBlock">${eyebrow('STORY')}<p class="summary clamped" id="description" dir="auto"></p>` +
    `<button class="more-toggle" type="button" id="moreToggle" data-act="toggleSummary" hidden>المزيد</button></div>` +
    `<div class="block"><div class="block-head"><div class="section-titles">${eyebrow('CHAPTERS')}<h2>الفصول<span class="count" id="chapterCount"></span></h2></div>` +
    `<button class="icon-btn" type="button" id="chapterSort" data-act="flipChapterOrder" aria-label="عكس الترتيب">${glyph('sort')}</button></div>` +
    `<div id="chapterPanel"></div></div>` +
    `<div class="block">${insights}<div class="block-head"><div class="section-titles">${eyebrow('DETAILS')}<h2>معلومات</h2></div></div>` +
    `<div class="info-grid" id="infoGrid"></div></div>`
  );
}


/**
 * بحث الفصول («ويبتوني»): رقم = الفصول التي يبدأ رقمها به (12 ← 12، 120، 12.5)، وأي نص آخر
 * يُطابق اسم الفصل أو فريق الترجمة. يبحث في كل الصفوف لا في الدفعة المعروضة.
 * @param {object[]} rows
 * @param {string} query
 */
export function matchChapters(rows, query) {
  const q = String(query ?? '').trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!q) return rows;
  if (/^\d+(\.\d*)?$/.test(q)) return rows.filter((r) => Number.isFinite(Number(r?.number)) && String(Number(r.number)).startsWith(q));
  const t = q.toLowerCase();
  return rows.filter((r) => `${r?.chapter?.name ?? ''} ${r?.chapter?.scanlator ?? ''}`.toLowerCase().includes(t));
}

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** «مارس 2026» لتاريخ نشر بالمللي ثانية، أو null بلا تاريخ. */
export function monthOf(ms) {
  const d = new Date(Number(ms));
  return ms && Number.isFinite(d.getTime()) ? `${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}` : null;
}

/**
 * إيقاع الإصدار في «ويبتوني»: وسيط الفاصل بين آخر الفصول المؤرَّخة (بلا تكرار اليوم نفسه، فعدة فصول في
 * يوم واحد إصدار واحد). يكفيه أربعة إصدارات. أسبوعي إن كان الوسيط 6–8 أيام. «القادم» = آخر إصدار + الوسيط،
 * ولا إيقاع أصلًا لعمل آخر إصداره أبعد من فاصلين أو فواصله مبعثرة (رفع دفعات لعمل مكتمل).
 * @param {number[]} dates تواريخ نشر بالمللي ثانية
 * @returns {{days:number, weekly:boolean, next:number|null}|null}
 */
export function releaseBeat(dates, now = Date.now()) {
  const DAY = 86_400_000;
  const days = [...new Set(dates.filter((d) => Number.isFinite(d) && d > 0).map((d) => Math.floor(d / DAY)))].sort((a, b) => b - a).slice(0, 9);
  if (days.length < 4) return null;
  const gaps = days.slice(1).map((d, i) => days[i] - d).sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)];
  if (!(mid >= 1) || mid > 60) return null;
  // إيقاع حقيقي لا رفع دفعات: أغلب الفواصل قريبة من الوسيط. المصادر ترفع الأعمال المكتملة دفعات متباعدة
  // («كل ~13 يومًا» لعمل انتهى)، فلا يُقال «يصدر» لما فواصله مبعثرة
  const steady = gaps.filter((g) => Math.abs(g - mid) <= Math.max(2, mid * 0.35)).length;
  if (steady < Math.ceil(gaps.length * 0.6)) return null;
  // آخر إصدار أبعد من فاصلين (أو شهر ونصف): العمل متوقف أو انتهى، لا إيقاع
  const today = Math.floor(now / DAY);
  if (today - days[0] > Math.min(45, 2 * mid + 1)) return null;
  const next = (days[0] + mid) * DAY;
  return { days: mid, weekly: mid >= 6 && mid <= 8, next: next + mid * DAY < now ? null : next };
}
