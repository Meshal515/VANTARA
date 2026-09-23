/**
 * هيكل الواجهة — الصفحات والدرج والأوراق.
 *
 * بدأ من نموذج v35 وبقيت هويته: البانر الدائري، الاختصارات الأربعة، شرائط
 * الأعمال، المكتبة، الاستكشاف، الدرج. وتغيّر ما كان يعيق:
 *
 *   - الاتجاه عربي فعلًا: القائمة والرجوع في البداية (يمينًا)، والأفعال في
 *     النهاية. كان النموذج يقلب الترويسة إلى LTR فيضع الرجوع يسارًا.
 *   - صفحة العمل تمرير واحد بترتيب ملف القارئ الذكي، لا تبويبات تخبّئ الفصول.
 *   - الأيقونات كلها من عائلة `icons.js`، والأزرار الأيقونية تحمل اسمها
 *     للقارئ الصوتي وتلميحًا على سطح المكتب.
 *
 * الأفعال مفوَّضة (`data-act` ومعه `data-arg`) إلى `shell.js`، فلا شيفرة داخل
 * السمات تكسرها أول سياسة CSP.
 */
import { glyph, iconButton } from './icons.js';

const bell = (extra = '') =>
  `<button class="icon-btn has-dot" type="button" data-act="navTo" data-arg="notifications" aria-label="الإشعارات" title="الإشعارات"${extra}>` +
  `<span class="notify-dot"></span>${glyph('bell')}</button>`;

/** ترويسة صفحة رئيسية: القائمة في البداية، العنوان، الجرس في النهاية. */
const mainTop = (title) =>
  `<div class="page-top">` +
  `<div class="page-top-right">${iconButton('menu', 'القائمة', { act: 'openDrawer' })}</div>` +
  `<h1>${title}</h1>` +
  `<div class="page-top-left">${bell()}</div>` +
  `</div>`;

/** ترويسة صفحة فرعية: رجوع في البداية. */
const subTop = (title, { id, back = 'goBack', end = '' } = {}) =>
  `<div class="page-top">` +
  `<div class="page-top-right">${iconButton('back', 'رجوع', { act: back })}</div>` +
  `<h1${id ? ` id="${id}"` : ''}>${title}</h1>` +
  `<div class="page-top-left">${end}</div>` +
  `</div>`;

const shortcut = (icon, label, act, arg) =>
  `<button class="shortcut" type="button" data-act="${act}"${arg ? ` data-arg="${arg}"` : ''}>${glyph(icon)}<span>${label}</span></button>`;

const navItem = (page, icon, label) =>
  `<button class="nav" type="button" data-page="${page}" data-act="navTo" data-arg="${page}" aria-label="${label}">` +
  `<span class="nav-pill">${glyph(icon)}</span><span>${label}</span></button>`;

export const SHELL_HTML = `<div class="app">
  <section class="page active" id="home">
    <header class="header">
      <div class="header-start">${iconButton('menu', 'القائمة', { act: 'openDrawer' })}</div>
      <div class="brand-box" aria-hidden="true"><div class="brand">VANTARA</div></div>
      <div class="header-end">${iconButton('search', 'بحث', { act: 'openSearch' })}${bell()}</div>
    </header>

    <section class="hero" id="hero" aria-roledescription="carousel" aria-label="أعمال مختارة">
      <div class="hero-track" id="heroTrack"></div>
      <div class="hero-dots" id="heroDots"></div>
    </section>

    <div class="shortcuts">
      ${shortcut('grid', 'التصنيفات', 'openCategories')}
      ${shortcut('flame', 'الأكثر رواجًا', 'openCollection', 'trending')}
      ${shortcut('star', 'المميزة', 'openCollection', 'popular')}
      ${shortcut('clock', 'المضافة حديثًا', 'openCollection', 'recent')}
    </div>
    <main id="homeSections"></main>
  </section>

  <section class="page" id="detail">
    <div class="detail-glow" aria-hidden="true"><i id="detailGlow"></i></div>
    <div class="detail-top" id="detailTop">
      ${iconButton('back', 'رجوع', { act: 'backFromDetail' })}
      <div class="detail-top-title" id="detailTopTitle"></div>
      <div class="detail-actions">
        ${iconButton('share', 'شارك العمل', { act: 'shareCurrent' })}
        ${iconButton('heart', 'المفضلة', { act: 'toggleFavoriteCurrent', cls: 'icon-btn icon-btn--fav' })}
        ${iconButton('more', 'خيارات', { act: 'openWorkMenu' })}
      </div>
    </div>

    <div class="detail-head">
      <div class="detail-cover" id="detailCover"></div>
      <div class="detail-meta">
        <h1 id="detailTitle">—</h1>
        <div class="detail-sub" id="detailSub"></div>
        <div class="chips" id="detailGenres"></div>
      </div>
    </div>

    <div class="detail-cta">
      <button class="btn btn-primary read-cta" type="button" id="readCta" data-act="readNow" disabled>
        ${glyph('book')}<span id="readCtaLabel">جارٍ جمع الفصول</span><small id="readCtaSub"></small>
      </button>
      <button class="toggle-btn" type="button" id="libraryBtn" data-act="toggleLibraryCurrent" aria-pressed="false" aria-label="أضف إلى مكتبتي" title="أضف إلى مكتبتي">${glyph('library')}</button>
    </div>

    <div class="source-switch" id="sourcesBlock" hidden>
      <div class="source-row" id="sourceRow" role="radiogroup" aria-label="المصدر"></div>
    </div>

    <div class="detail-progress" id="detailProgress">
      <div class="progress-bar"><i id="progressFill"></i></div>
      <div class="progress-row"><span id="progressText"></span><div class="rate" id="rateStars" role="radiogroup" aria-label="تقييمك"></div></div>
    </div>

    <div class="block" id="summaryBlock">
      <p class="summary clamped" id="description" dir="auto"></p>
      <button class="more-toggle" type="button" id="moreToggle" data-act="toggleSummary" hidden>المزيد</button>
    </div>

    <div class="block">
      <div class="block-head">
        <h2>الفصول<span class="count" id="chapterCount"></span></h2>
        ${iconButton('sort', 'عكس الترتيب', { act: 'flipChapterOrder', cls: 'icon-btn' })}
      </div>
      <div id="chapterPanel"></div>
    </div>

    <div class="block">
      <div class="block-head"><h2>معلومات</h2></div>
      <div class="info-grid" id="infoGrid"></div>
    </div>
  </section>

  <section class="page" id="collection">
    ${subTop('عرض الكل', { id: 'collectionTitle' })}
    <div class="page-body"><div class="grid" id="collectionGrid"></div>
    <button class="btn btn-secondary load-more" type="button" id="collectionMore" data-act="loadMoreCollection">تحميل المزيد</button></div>
  </section>

  <section class="page" id="categories">
    ${subTop('التصنيفات')}
    <div class="page-body"><div class="category-grid" id="categoryGrid"></div></div>
  </section>

  <section class="page" id="library">
    ${mainTop('مكتبتي')}
    <div class="page-body">
      <div class="segmented" id="libraryTabs" role="tablist" aria-label="تصفية المكتبة"></div>
      <div class="toolbar" id="libraryToolbar">
        <span class="work-meta" id="libraryCount"></span>
        <select class="select" id="librarySort" data-change="renderLibrary" aria-label="الترتيب">
          <option value="added">آخر إضافة</option><option value="title">الاسم</option>
        </select>
      </div>
      <div class="grid" id="libraryGrid"></div>
    </div>
  </section>

  <section class="page" id="discover">
    ${mainTop('اكتشف')}
    <div class="page-body">
      <form class="search-bar" data-submit="discoverSearch" role="search">
        ${glyph('search')}
        <input class="search-input" id="discoverSearch" type="search" enterkeyhint="search" autocomplete="off" placeholder="ابحث في كل المصادر" data-input="discoverSearch" aria-label="ابحث في كل المصادر">
        ${iconButton('close', 'امسح البحث', { act: 'clearDiscoverSearch', cls: 'icon-btn search-clear' })}
      </form>
      <div class="grid" id="discoverGrid"></div>
      <button class="btn btn-secondary load-more" type="button" id="discoverMore" data-act="loadMoreDiscover">أعمال أكثر</button>
    </div>
  </section>

  <section class="page" id="search">
    ${subTop('البحث')}
    <div class="page-body">
      <form class="search-bar" data-submit="noop" role="search">
        ${glyph('search')}
        <input class="search-input" id="searchInput" type="search" enterkeyhint="search" autocomplete="off" placeholder="اسم العمل بالعربي أو الإنجليزي" data-input="debouncedSearch" aria-label="بحث">
      </form>
      <div class="grid" id="searchGrid"></div>
    </div>
  </section>

  <section class="page" id="settings">
    ${subTop('الإعدادات')}
    <div class="page-body" id="settingsBody"></div>
  </section>

  <section class="page" id="majlis">
    ${mainTop('المجلس')}
    <div class="page-body mj-body" id="majlisBody"></div>
  </section>

  <section class="page" id="profile"><div id="profileBody"></div></section>

  <section class="page" id="notifications">
    ${subTop('الإشعارات', { end: iconButton('check', 'علّمها كلها مقروءة', { act: 'readAllNotifications' }) })}
    <div class="page-body notif-body" id="notificationsBody"></div>
  </section>

  <section class="page" id="utility">
    ${subTop('VANTARA', { id: 'utilityTitle' })}
    <div class="page-body" id="utilityBody"></div>
  </section>

  <nav class="bottom-nav" id="bottomNav" aria-label="التنقّل الرئيسي">
    ${navItem('home', 'home', 'الرئيسية')}
    ${navItem('library', 'library', 'مكتبتي')}
    ${navItem('discover', 'compass', 'اكتشف')}
    ${navItem('majlis', 'users', 'المجلس')}
  </nav>
</div>

<div class="drawer-backdrop" id="drawerBackdrop" data-act="drawerBackdropClick">
  <aside class="drawer" aria-label="القائمة">
    <div class="drawer-head">
      <button class="drawer-me" type="button" id="drawerMe" data-act="drawerNavigate" data-arg="profile"></button>
      ${iconButton('close', 'إغلاق', { act: 'closeDrawer' })}
    </div>
    <div class="drawer-scroll" id="drawerContent"></div>
    <div class="drawer-version" id="drawerVersion">VANTARA</div>
  </aside>
</div>

<div class="sheet-backdrop" id="sheet" data-act="sheetBackdrop"><div class="sheet" role="dialog" aria-modal="true" id="sheetBody"></div></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`;
