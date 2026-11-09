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
import { detailMarkup } from './manga-work.js';

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

/**
 * فهرس المانجا: أغلفة صغيرة متراكبة (ما ستجده خلف الباب)، ثم الرقم والاسم وسطر
 * يقول ما فيه، وسهم. يُضغط لأنه يُرى بابًا، لا لأنه داخل صندوق.
 */
const shortcut = (no, label, act, arg) =>
  `<button class="shortcut" type="button" data-act="${act}"${arg ? ` data-arg="${arg}"` : ''} data-index="${arg ?? act}">` +
  `<span class="shortcut-art" aria-hidden="true"></span>` +
  `<span class="shortcut-text">${no ? `<i class="shortcut-no">${no}</i>` : ''}<span class="shortcut-label">${label}</span><small class="shortcut-sub"></small></span>` +
  `${glyph('chevron', { size: 16 })}</button>`;

const navItem = (page, icon, label) =>
  `<button class="nav" type="button" data-page="${page}" data-act="navTo" data-arg="${page}" aria-label="${label}">` +
  `<span class="nav-pill">${glyph(icon)}<span class="nav-label">${label}</span></span></button>`;

/**
 * قسم في المبدّل: طبقة تملأ كبسولتها وتنزلق فوق أزرارها عند الفتح (الحركة في dock.js).
 */
const dockOption = (id, word, label) =>
  `<button class="dock-opt" id="secOpt-${id}" type="button" role="radio" aria-checked="false" aria-hidden="true" tabindex="-1" inert data-act="pickSection" data-arg="${id}" aria-label="${label}">` +
  `<span class="dock-opt-label"><b dir="ltr">${word}</b><small>${label}</small></span></button>`;

export const SHELL_HTML = `<div class="app">
  <section class="page active" id="home">
    <header class="header">
      <div class="header-start">${iconButton('menu', 'القائمة', { act: 'openDrawer' })}</div>
      <div class="brand-box">
        <div class="brand-lockup" id="brandLockup">
          <span class="brand">VANTARA</span>
          <span class="brand-section" id="brandSection" aria-live="polite"><span class="brand-word" id="brandSectionName">MANGA</span></span>
        </div>
      </div>
      <div class="header-end">${iconButton('search', 'بحث', { act: 'openSearch' })}${bell()}</div>
    </header>

    <div class="home-view" id="mangaHome" data-home="manga">
    <section class="mg-hero" id="hero" aria-roledescription="carousel" aria-label="أعمال مختارة">
      <div class="mg-amb" id="heroAmb" aria-hidden="true"></div>
      <div class="mg-stage" id="heroTrack"></div>
      <div class="mg-copy" id="heroCopy" aria-live="polite"></div>
      <div class="hero-dots" id="heroDots"></div>
    </section>

    <section class="mg-browse" aria-labelledby="mgBrowseTitle">
      <div class="section-head"><div class="section-titles"><h2 id="mgBrowseTitle">تصفّح</h2></div></div>
      <nav class="shortcuts" aria-label="فهرس المانجا">
        ${shortcut('', 'آخر التحديثات', 'openCollection', 'recent')}
        ${shortcut('', 'الرائج', 'openCollection', 'trending')}
        ${shortcut('', 'التصنيفات', 'openCategories')}
        ${shortcut('', 'كل الأعمال', 'openCollection', 'catalogue')}
      </nav>
    </section>
    <main id="homeSections"></main>
    </div>
    <div class="home-view anime-home" id="animeHome" data-home="anime" hidden></div>
    <div class="home-view cinema-home" id="cinemaHome" data-home="cinema" hidden></div>
    <div class="home-view all-home" id="allHome" data-home="all" hidden></div>
  </section>

  <section class="page anime-page" id="anime"></section>

  <section class="page anime-collection-page" id="animeCollection"></section>

  <section class="page cinema-page" id="cinema"></section>

  <!-- صفحة العمل: هيكلها من manga-work.js حسب النمط المختار (الصفحة، المعرض، الملف، من حيث وقفت) -->
  <section class="page mw" id="detail" data-look="page">${detailMarkup('page', { glyph, iconButton })}</section>

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
    <div class="page-body anime-only" id="animeLibrary"></div>
    <div class="page-body cinema-only" id="cinemaLibrary"></div>
    <div class="page-body" id="unifiedLibrary"></div>
    <div class="page-body manga-only">
      <div class="segmented library-tabs" id="libraryTabs" role="tablist" aria-label="تصفية المكتبة"></div>
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
    <div class="page-body anime-only" id="animeDiscover"></div>
    <div class="page-body cinema-only" id="cinemaDiscover"></div>
    <div class="page-body manga-only">
      <form class="search-bar" data-submit="discoverSearch" role="search">
        ${glyph('search')}
        <input class="search-input" id="discoverSearch" type="search" enterkeyhint="search" autocomplete="off" placeholder="ابحث في كل المصادر" data-input="discoverSearch" aria-label="ابحث في كل المصادر">
        ${iconButton('close', 'امسح البحث', { act: 'clearDiscoverSearch', cls: 'icon-btn search-clear' }).replace('<button', '<button hidden')}
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
        ${iconButton('close', 'امسح البحث', { act: 'clearSearch', cls: 'icon-btn search-clear' }).replace('<button', '<button hidden')}
      </form>
      <div class="search-idle" id="searchIdle"></div>
      <p class="search-count" id="searchCount" hidden></p>
      <div class="grid" id="searchGrid"></div>
    </div>
  </section>

  <section class="page" id="settings">
    ${subTop('الإعدادات')}
    <div class="page-body settings-body" id="settingsBody"></div>
  </section>

  <section class="page" id="settingsPane">
    ${subTop('الإعدادات', { id: 'settingsPaneTitle' })}
    <div class="page-body settings-body" id="settingsPaneBody"></div>
  </section>

  <section class="page" id="insights">
    ${subTop('إحصائيات المتابعة')}
    <div class="page-body insights-body" id="insightsBody"></div>
  </section>

  <section class="page" id="majlis">
    ${mainTop('الأصدقاء')}
    <div class="social-tabs" id="socialTabs" role="tablist" aria-label="أقسام الأصدقاء"></div>
    <div class="page-body social-friends" id="friendsBody"></div>
    <div class="page-body mj-body" id="majlisBody" hidden></div>
    <div class="page-body notif-body" id="socialNotifs" hidden></div>
  </section>

  <section class="page" id="profile"><div id="profileBody"></div></section>

  <section class="page" id="rafiq">
    <div class="page-top">
      <div class="page-top-right">${iconButton('menu', 'القائمة', { act: 'openDrawer' })}</div>
      <h1>رفيق</h1>
      <div class="page-top-left">${iconButton('history', 'سجل المحادثات', { act: 'rafiqHistory' })}${iconButton('plus', 'محادثة جديدة', { act: 'rafiqNew' })}${iconButton('layers', 'ذاكرة رفيق', { act: 'rafiqMemory' })}</div>
    </div>
    <div id="rafiqBody"></div>
  </section>

  <section class="page" id="notifications">
    ${subTop('الإشعارات', { end: iconButton('check', 'علّمها كلها مقروءة', { act: 'readAllNotifications' }) })}
    <div class="page-body notif-body" id="notificationsBody"></div>
  </section>

  <section class="page" id="utility">
    ${subTop('VANTARA', { id: 'utilityTitle' })}
    <div class="page-body" id="utilityBody"></div>
  </section>

  <div class="dock-scrim" id="dockScrim" data-act="toggleSections" hidden></div>
  <nav class="bottom-nav dock" id="bottomNav" aria-label="التنقّل الرئيسي">
    <div class="dock-group" role="radiogroup" aria-label="أقسام VANTARA" aria-owns="secOpt-manga secOpt-anime secOpt-cinema"></div>
    <div class="dock-cap dock-cap--nav">
      <div class="cap-body"><span class="cap-ind" aria-hidden="true"></span>${navItem('home', 'home', 'الرئيسية')}${navItem('discover', 'compass', 'اكتشف')}</div>
      ${dockOption('manga', 'MANGA', 'مانجا')}
    </div>
    <div class="dock-cap dock-cap--switch">
      <button class="dock-switch" id="sectionSwitch" type="button" data-act="toggleSections" aria-expanded="false" aria-label="بدّل القسم"><span class="dock-sq" data-arg="manga"></span><span class="dock-sq" data-arg="anime"></span><span class="dock-sq" data-arg="cinema"></span></button>
      ${dockOption('anime', 'ANIME', 'أنمي')}
    </div>
    <div class="dock-cap dock-cap--nav">
      <div class="cap-body"><span class="cap-ind" aria-hidden="true"></span>${navItem('library', 'library', 'مكتبتي')}${navItem('majlis', 'users', 'الأصدقاء')}</div>
      ${dockOption('cinema', 'CINEMA', 'سينما')}
    </div>
  </nav>
</div>

<div class="drawer-backdrop" id="drawerBackdrop" data-act="drawerBackdropClick">
  <aside class="drawer" aria-label="القائمة">
    <div class="drawer-brand">
      <button class="rail-logo" type="button" data-act="railLogo" aria-label="VANTARA" title="VANTARA">
        <span class="rail-mark" aria-hidden="true"></span>
        <span class="rail-panel" aria-hidden="true">${glyph('sidebar')}</span>
      </button>
      <div class="drawer-wordmark" aria-hidden="true"><b>VANTARA</b><span class="drawer-brand-word"></span></div>
      ${iconButton('sidebar', 'اطوِ الشريط الجانبي', { act: 'toggleRail', cls: 'icon-btn rail-toggle' })}
    </div>
    <div class="drawer-head">
      <button class="drawer-me" type="button" id="drawerMe" data-act="drawerNavigate" data-arg="profile"></button>
      ${iconButton('close', 'إغلاق', { act: 'closeDrawer' })}
    </div>
    <div class="drawer-scroll" id="drawerContent"></div>
    <div class="drawer-version" id="drawerVersion">VANTARA</div>
  </aside>
</div>

<div class="sheet-backdrop" id="sheet" data-act="sheetBackdrop" hidden inert aria-hidden="true"><div class="sheet" role="dialog" aria-modal="true" id="sheetBody"></div></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`;
