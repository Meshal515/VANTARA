/**
 * واجهة VANTARA — الرئيسية، صفحة العمل، المكتبة، الاستكشاف، الدرج.
 *
 * هوية v35 كما هي (البانر الدائري، الاختصارات، الشرائط، الدرج)، ومصدر
 * الحقيقة منّا:
 *
 *   - الأعمال من مصادرنا عبر المحرّك (`works.js`)، مدموجةً عبر المصادر.
 *   - المكتبة والمفضلة و«أقرأ لاحقًا» والتقييم وعين الفصل في حسابك عبر
 *     المزامنة — تظهر على أجهزتك كلها ويراها أصدقاؤك.
 *
 * والشاشات التي لم تُنقل بعد (الإشعارات، ملفي…) تُفتح عبر `deps.go`.
 */

import { SHELL_HTML } from './markup.js';
import { glyph } from './icons.js';
import { available, browse, describe, detail, discoverEditions, editionRows, seriesRefOf, withEditions } from './works.js';
import { chapterKeyOf, isChapterRead, markChapter } from './reading.js';
import { titlesMatch } from '../lib/catalog.js';
import { cachedCover, coverCandidates, forgetCover, nativeCover } from './covers.js';
import { countLabel } from './plural.js';
import { frameIdFromLink } from '../lib/frame.js';
import { createMajlis } from './majlis.js';
import { compactEditions, describesMore, displayTitle, mergeEditions, serverEditions } from './work-ref.js';
import { createProfile } from './profile.js';
import { openShareSheet } from './share.js';
import { openProfileEditor } from './profile-editor.js';

const AR_GENRE = {
  Action: 'أكشن', Adventure: 'مغامرة', Fantasy: 'فانتازيا', Drama: 'دراما', Comedy: 'كوميديا', Romance: 'رومانسي',
  Supernatural: 'قوى خارقة', 'Sci-Fi': 'خيال علمي', Mystery: 'غموض', Thriller: 'إثارة', Horror: 'رعب', Sports: 'رياضة',
  Psychological: 'نفسي', Mecha: 'ميكا', Music: 'موسيقى', 'Slice of Life': 'حياة يومية', Isekai: 'إيسيكاي',
  Historical: 'تاريخي', Superhero: 'أبطال خارقون', Tragedy: 'مأساة', Medical: 'طبي', Philosophical: 'فلسفي',
  Crime: 'جريمة', 'Magical Girls': 'فتيات سحريات', Wuxia: 'ووشيا',
};
const STATUS_AR = { FINISHED: 'مكتمل', RELEASING: 'مستمر', HIATUS: 'متوقف مؤقتًا', CANCELLED: 'ملغي', NOT_YET_RELEASED: 'لم يبدأ' };
/**
 * التصنيفات وأسماؤها في المصادر. كل مصدر يسمّي تصنيفه بطريقته، فتُرسل
 * الصيغ كلها ويطابقها المحرّك بعد التطبيع (`GenreFilterPolicy`).
 * `hue` لون البلاطة: ثابت لكل تصنيف فتُعرف بلونها قبل اسمها.
 */
const GENRES = [
  { ar: 'أكشن', en: 'Action', hue: 8, names: ['أكشن', 'اكشن', 'Action'] },
  { ar: 'مغامرة', en: 'Adventure', hue: 28, names: ['مغامرة', 'مغامرات', 'Adventure'] },
  { ar: 'فانتازيا', en: 'Fantasy', hue: 265, names: ['فانتازيا', 'فنتازيا', 'خيال', 'Fantasy'] },
  { ar: 'رومانسي', en: 'Romance', hue: 335, names: ['رومانسي', 'رومانسية', 'رومانس', 'Romance'] },
  { ar: 'كوميديا', en: 'Comedy', hue: 45, names: ['كوميديا', 'كوميدي', 'Comedy'] },
  { ar: 'دراما', en: 'Drama', hue: 215, names: ['دراما', 'Drama'] },
  { ar: 'غموض', en: 'Mystery', hue: 190, names: ['غموض', 'Mystery'] },
  { ar: 'رعب', en: 'Horror', hue: 355, names: ['رعب', 'Horror'] },
  { ar: 'نفسي', en: 'Psychological', hue: 290, names: ['نفسي', 'نفسية', 'Psychological'] },
  { ar: 'خيال علمي', en: 'Sci-Fi', hue: 175, names: ['خيال علمي', 'Sci-Fi', 'Science Fiction', 'SciFi'] },
  { ar: 'قوى خارقة', en: 'Supernatural', hue: 245, names: ['قوى خارقة', 'خارق للطبيعة', 'خوارق', 'Supernatural'] },
  { ar: 'إثارة', en: 'Thriller', hue: 0, names: ['إثارة', 'اثارة', 'تشويق', 'Thriller'] },
  { ar: 'رياضة', en: 'Sports', hue: 140, names: ['رياضة', 'رياضي', 'Sports', 'Sport'] },
  { ar: 'حياة يومية', en: 'Slice of Life', hue: 95, names: ['حياة يومية', 'شريحة من الحياة', 'Slice of Life'] },
  { ar: 'إيسيكاي', en: 'Isekai', hue: 205, names: ['إيسيكاي', 'ايسيكاي', 'عالم آخر', 'Isekai'] },
  { ar: 'فنون قتالية', en: 'Martial Arts', hue: 18, names: ['فنون قتالية', 'فنون القتال', 'Martial Arts'] },
  { ar: 'تاريخي', en: 'Historical', hue: 38, names: ['تاريخي', 'تاريخ', 'Historical'] },
  { ar: 'مدرسي', en: 'School Life', hue: 225, names: ['مدرسي', 'حياة مدرسية', 'مدرسة', 'School Life', 'School'] },
];

/** كم فصلًا يُرسم أول مرة. عمل بألف فصل لا يرسم ألف صف قبل أن يظهر شيء. */
const CHAPTER_BATCH = 60;

const drawerGroups = [
  ['', [['الرئيسية', 'home', 'home'], ['مكتبتي', 'library', 'library'], ['اكتشف', 'discover', 'compass']]],
  ['الأصدقاء', [['المجلس', 'majlis', 'users'], ['الإشعارات', 'notifications', 'bell'], ['التوصيات', 'recommendations', 'spark']]],
  ['قوائمي', [['المفضلة', 'favorites', 'heart'], ['أقرأ لاحقًا', 'later', 'clock']]],
  ['', [['الإعدادات', 'settings', 'settings'], ['تبديل الحساب', 'switchAccount', 'switchUser']]],
];

const WORKS_KEY = 'vantara.v35.works';
const HISTORY_KEY = 'vantara.v35.history';

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // الحصة ممتلئة: ذاكرة مساعدة لا مصدر حقيقة
  }
}

const clean = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').trim();
// المرجع الداخلي (`ext:…`) لا يصل للشاشة أبدًا، ولو غاب كل اسم آخر
const titleOf = (w) => displayTitle(w?.id, w?.title?.english, w?.title?.romaji, typeof w?.title === 'string' ? w.title : null);
const unique = (arr) => [...new Set(arr.filter(Boolean))];
const uniqueById = (items) => {
  const seen = new Set();
  return items.filter((x) => x && x.id && !seen.has(x.id) && seen.add(x.id));
};
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const genreAr = (g) => AR_GENRE[g] || g;
const initialOf = (text) => [...String(text || '؟').trim()][0]?.toUpperCase() ?? '؟';

/**
 * @param {{ sync: any, mount: (node: Element) => void, go: (route: object) => Promise<void>,
 *           openReader: (route: object) => void, switchAccount: () => void, version: string,
 *           friends?: () => Array<{userId: string, displayName: string, avatarKey: string|null}>,
 *           report?: (input: object) => Promise<unknown> }} deps
 */
export function mountV35(deps, { page = 'home' } = {}) {
  const { sync } = deps;
  const root = el('div', 'v35');
  root.innerHTML = SHELL_HTML;
  deps.mount(root);
  const q = (id) => root.querySelector(`#${id}`);

  const state = {
    home: { trending: [], featured: [], recent: [], popular: [] },
    current: null,
    nextRow: null,
    stack: [],
    catalog: [],
    catalogPage: 0,
    catalogHasNext: true,
    discoverQuery: '',
    collection: { kind: 'catalogue', page: 0, hasNext: true, items: [] },
    searchTimer: null,
    eyeTimer: null,
    heroItems: [],
    heroPhysicalIndex: 1,
    heroTimer: null,
    heroStartX: 0,
    heroDeltaX: 0,
    heroDragging: false,
    libraryFilter: 'all',
    chapterSource: null,
    chapterNewestFirst: true,
    chapterShown: CHAPTER_BATCH,
  };

  // ───────────────────────── الرسائل والأوراق ─────────────────────────

  function toast(msg) {
    const t = q('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._x);
    t._x = setTimeout(() => t.classList.remove('show'), 2200);
  }

  let sheetClose = null;
  /** ورقة سفلية واحدة في وقتٍ واحد. `build` يملأها ويرجع ما يُنادى عند الإغلاق. */
  function openSheet(build) {
    closeSheet();
    const body = q('sheetBody');
    body.innerHTML = '<div class="sheet-handle"></div>';
    sheetClose = build(body) ?? null;
    q('sheet').classList.add('show');
  }
  function closeSheet() {
    if (!q('sheet').classList.contains('show')) return false;
    q('sheet').classList.remove('show');
    sheetClose?.();
    sheetClose = null;
    return true;
  }
  function sheetItem(icon, label, run, { pressed, danger } = {}) {
    const b = el('button', `sheet-item${danger ? ' sheet-item--danger' : ''}`);
    b.type = 'button';
    b.innerHTML = glyph(icon);
    b.append(el('span', null, label));
    if (pressed !== undefined) {
      b.setAttribute('aria-pressed', String(pressed));
      if (pressed) b.insertAdjacentHTML('beforeend', `<span class="trail">${glyph('check', { size: 20 })}</span>`);
    }
    b.onclick = run;
    return b;
  }

  // ───────────────────────── الأعمال المحفوظة ─────────────────────────
  // المزامنة تحفظ عنوان العمل وغلافه؛ ونُسخه (أي مصدر يحمله) تُحفظ هنا ليُفتح
  // العمل من المكتبة بلا بحث جديد.

  const serverWork = (ref) => sync.rows('works', (x) => x.series_ref === ref)[0] ?? null;
  /**
   * يحفظ نسخ العمل في الجهاز، ويخبر الخادم بما لا يعرفه منها: عملٌ فتحتَه
   * يُفتح بعدها على كل جهاز بنفس نسخه، بلا بحث.
   */
  function rememberWork(w) {
    const all = readJson(WORKS_KEY, {});
    const editions = w._work.editions ?? [];
    all[w.id] = { key: w._work.key, title: titleOf(w), thumbnailUrl: w._work.thumbnailUrl, editions };
    writeJson(WORKS_KEY, all);
    const facts = { title: titleOf(w), coverUrl: w._work.thumbnailUrl ?? null, editions };
    if (!editions.length || !describesMore(serverWork(String(w.id)), facts)) return;
    sync.enqueue('work.describe', { seriesRef: String(w.id), ...facts, editions: compactEditions(editions) });
  }
  function workFromRef(ref, fallbackTitle, cover) {
    const saved = readJson(WORKS_KEY, {})[ref];
    const row = serverWork(ref);
    const title = displayTitle(ref, row?.title, saved?.title, fallbackTitle);
    const thumbnailUrl = saved?.thumbnailUrl ?? row?.cover_url ?? cover ?? null;
    // نسخ الجهاز أولًا (تحمل تفاصيل آخر فتح)، ثم ما عرفه غيره عبر الخادم
    const editions = mergeEditions(saved?.editions, serverEditions(row));
    const base = { key: saved?.key ?? ref.replace(/^ext:/, ''), title, thumbnailUrl, editions };
    return {
      id: ref,
      title: { english: title },
      genres: [],
      status: null,
      coverImage: { large: thumbnailUrl, extraLarge: thumbnailUrl },
      bannerImage: thumbnailUrl,
      staff: { edges: [] },
      _work: base,
    };
  }

  const me = () => sync.user?.userId;
  const libraryRows = () => sync.rows('library', (r) => r.user_id === me() && !r.removed);
  const inCollection = (kind, ref) =>
    sync.rows('collections', (r) => r.user_id === me() && r.kind === kind && r.series_ref === ref && r.member).length > 0;
  function libraryEntry(ref) {
    const row = libraryRows().find((r) => r.series_ref === ref);
    const later = inCollection('read_later', ref);
    const favorite = inCollection('favorite', ref);
    if (!row && !later && !favorite) return null;
    return { row, later, favorite, addedAt: row?.added_at ?? 0 };
  }
  function libraryWorks(filter = 'all') {
    const refs = new Set([
      ...libraryRows().map((r) => r.series_ref),
      ...sync.rows('collections', (r) => r.user_id === me() && r.member).map((r) => r.series_ref),
    ]);
    return [...refs]
      .map((ref) => {
        const row = libraryRows().find((r) => r.series_ref === ref);
        const col = sync.rows('collections', (r) => r.user_id === me() && r.series_ref === ref)[0];
        const work = sync.rows('works', (w) => w.series_ref === ref)[0];
        return {
          entry: libraryEntry(ref),
          work: workFromRef(ref, row?.series_title ?? col?.series_title ?? work?.title, row?.cover_url ?? col?.cover_url ?? work?.cover_url),
        };
      })
      .filter(({ entry }) => {
        if (!entry) return false;
        if (filter === 'reading') return Boolean(entry.row);
        if (filter === 'later') return entry.later;
        if (filter === 'favorite') return entry.favorite;
        return true;
      })
      .map(({ work }) => work);
  }
  const descriptorOf = (w) => ({
    seriesRef: String(w.id),
    seriesTitle: titleOf(w),
    coverUrl: w.coverImage?.large ?? null,
    sourceId: w._work?.editions?.[0]?.sourceId ?? null,
  });

  // «آخر المشاهدات»: سجلٌّ واحد في حسابك (`work_views`). المكتبة والرئيسية
  // والملف ومتابعة القراءة تقرأ منه نفسه، فحذف عمل منه يحذفه من كل مكان.
  const viewRows = (userId = me()) =>
    sync.rows('work_views', (r) => r.user_id === userId && !r.removed).sort((a, b) => (b.viewed_at ?? 0) - (a.viewed_at ?? 0));
  function pushHistory(w) {
    sync.enqueue('view.add', { seriesRef: String(w.id), seriesTitle: titleOf(w), coverUrl: w.coverImage?.large ?? null, at: Date.now() });
  }
  function removeView(ref) {
    sync.enqueue('view.remove', { seriesRef: ref });
  }
  const historyWorks = () => viewRows().map((v) => workFromRef(v.series_ref, v.series_title, v.cover_url));
  /** السجل القديم كان في الجهاز: يُنقل مرة إلى الحساب بترتيبه ثم يُترك. */
  function migrateLocalHistory() {
    const flag = `${HISTORY_KEY}.moved.${me()}`;
    if (!me() || localStorage.getItem(flag)) return;
    const local = readJson(HISTORY_KEY, []);
    if (!viewRows().length) {
      const t = Date.now();
      local.slice(0, 60).forEach((h, i) => {
        if (h?.ref) sync.enqueue('view.add', { seriesRef: h.ref, seriesTitle: h.title ?? null, coverUrl: h.cover ?? null, at: t - (i + 1) * 60_000 });
      });
    }
    try {
      localStorage.setItem(flag, '1');
    } catch {
      // يُعاد النقل مرة أخرى فقط، والخادم يدمج المكرر
    }
  }

  // ───────────────────────── الصور والبطاقات ─────────────────────────

  function fallbackArt(container, label) {
    const d = el('div', 'image-fallback');
    d.append(el('span', null, initialOf(label)));
    container.replaceChildren(d);
  }
  /**
   * الصورة بعد تحميلها فقط، ومكانها هيكلٌ لامع حتى ذلك. التسابق محروس
   * بعلامة: البطاقة المعاد استعمالها لا تعرض صورة طلبٍ قديم.
   *
   * الترتيب: الملف المحفوظ على الجهاز (فوري وبلا شبكة)، ثم المحرّك بترويسات
   * المصدر (ويُحفظ)، ثم الرابط مباشرة، لكل غلاف من أغلفة نسخ العمل. والحرف
   * الأول لا يظهر إلا إن فشل كل ذلك.
   */
  async function mountImage(container, work, opts = {}) {
    const token = String(Math.random());
    container.dataset.imageToken = token;
    const tryUrl = (url, timeoutMs) =>
      new Promise((resolve) => {
        const img = new Image();
        let finished = false;
        const done = (ok) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolve(ok ? img : null);
        };
        const timer = setTimeout(() => done(false), timeoutMs);
        img.alt = '';
        img.decoding = 'async';
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = url;
      });
    const show = (img, url) => {
      if (opts.position) img.style.objectPosition = opts.position;
      container.replaceChildren(img);
      return url;
    };
    const candidates = coverCandidates(work);
    // المحفوظ أولًا وبلا هيكل لامع: الغلاف الذي رأيته أمس يظهر كما هو
    for (const { url } of candidates) {
      const local = cachedCover(url);
      if (!local) continue;
      const img = await tryUrl(local, 2500);
      if (container.dataset.imageToken !== token) return null;
      if (img) return show(img, local);
      forgetCover(url);
    }
    container.replaceChildren(el('div', 'skeleton'));
    for (const { url, sourceId } of candidates) {
      const saved = await nativeCover(url, sourceId);
      if (container.dataset.imageToken !== token) return null;
      const img = (saved && (await tryUrl(saved, 6000))) || (await tryUrl(url, 9000));
      if (container.dataset.imageToken !== token) return null;
      if (img) return show(img, img.src);
    }
    if (container.dataset.imageToken === token) fallbackArt(container, titleOf(work));
    return null;
  }

  function card(work, { meta } = {}) {
    const a = el('article', 'work-card');
    a.tabIndex = 0;
    a.setAttribute('role', 'link');
    a.setAttribute('aria-label', titleOf(work));
    const p = el('div', 'poster');
    const t = el('div', 'work-title', titleOf(work));
    t.dir = 'auto';
    const m = el('div', 'work-meta', meta ?? (STATUS_AR[work.status] || ''));
    void mountImage(p, work);
    a.append(p, t, m);
    a.onclick = () => void openWork(work);
    a.onkeydown = (e) => {
      if (e.key === 'Enter') void openWork(work);
    };
    return a;
  }
  const renderStrip = (target, items) => target.replaceChildren(...items.slice(0, 14).map((w) => card(w)));
  const renderGrid = (target, items) => target.replaceChildren(...items.map((w) => card(w)));
  const skeletonCards = (n) =>
    Array.from({ length: n }, () => {
      const x = el('div', 'work-card');
      x.setAttribute('aria-hidden', 'true');
      x.innerHTML = '<div class="poster"><div class="skeleton"></div></div><span class="skeleton-line"></span><span class="skeleton-line"></span>';
      return x;
    });

  /** حالة فارغة: رمز الموقف لا شعار التطبيق، وجملة تقول ما العمل. */
  function emptyState(target, { icon = 'library', title, text, action, error = false }) {
    const box = el('div', `empty${error ? ' empty--error' : ''}`);
    const inner = el('div');
    inner.innerHTML = `<div class="empty-art">${glyph(icon)}</div>`;
    inner.append(el('h3', null, title));
    if (text) inner.append(el('p', null, text));
    if (action) {
      const b = el('button', 'btn btn-secondary', action.label);
      b.type = 'button';
      if (action.icon) b.insertAdjacentHTML('afterbegin', glyph(action.icon));
      b.onclick = action.run;
      inner.append(b);
    }
    box.append(inner);
    target.replaceChildren(box);
  }

  // ───────────────────────── الرئيسية ─────────────────────────

  function sectionBlock(title, kind, items) {
    const s = el('section', 'section');
    const h = el('div', 'section-head');
    h.append(el('h2', null, title));
    if (kind) {
      const b = el('button', 'link');
      b.type = 'button';
      b.innerHTML = `<span>الكل</span>${glyph('chevron')}`;
      b.setAttribute('aria-label', `عرض الكل: ${title}`);
      b.onclick = () => void openCollection(kind);
      h.append(b);
    }
    const strip = el('div', 'card-strip');
    renderStrip(strip, items);
    s.append(h, strip);
    return s;
  }
  function renderHome() {
    const blocks = [];
    const reading = libraryWorks('reading');
    if (reading.length) blocks.push(sectionBlock('أعمال تتابعها', 'libraryReading', reading));
    const history = historyWorks();
    if (history.length) blocks.push(sectionBlock('آخر المشاهدات', 'history', history.slice(0, 20)));
    if (state.home.featured.length) blocks.push(sectionBlock('مقترحة لك', 'featured', state.home.featured));
    if (state.home.trending.length) blocks.push(sectionBlock('الأكثر رواجًا', 'trending', state.home.trending));
    if (state.home.recent.length) blocks.push(sectionBlock('المضافة حديثًا', 'recent', state.home.recent));
    if (state.home.popular.length) blocks.push(sectionBlock('المميزة', 'popular', state.home.popular));
    if (blocks.length) q('homeSections').replaceChildren(...blocks);
  }
  function renderHomeSkeleton() {
    q('homeSections').replaceChildren(
      ...['مقترحة لك', 'الأكثر رواجًا', 'المضافة حديثًا'].map((title) => {
        const s = el('section', 'section');
        s.setAttribute('aria-busy', 'true');
        const h = el('div', 'section-head');
        h.append(el('h2', null, title));
        const strip = el('div', 'card-strip');
        strip.append(...skeletonCards(5));
        s.append(h, strip);
        return s;
      }),
    );
  }
  async function loadHome() {
    if (!available()) {
      renderHeroFallback();
      const box = el('div');
      emptyState(box, { icon: 'layers', title: 'المصادر داخل تطبيق أندرويد', text: 'الكتالوج يُقرأ من مصادرنا العربية بمحرّك التطبيق — افتح VANTARA على الجوال.' });
      renderHome();
      q('homeSections').append(box.firstElementChild);
      return;
    }
    renderHomeSkeleton();
    renderHeroSkeleton();
    try {
      // ثلاث مسارات متوازية تكفي البداية؛ «المميزة» تُكمل بعدها فلا تُحمّل
      // ستة عشر مصدرًا بأربعة طلبات دفعةً واحدة
      const [fe, tr, re] = await Promise.all([
        browse({ kind: 'catalogue', page: 1 }),
        browse({ kind: 'popular', page: 1 }),
        browse({ kind: 'latest', page: 1 }),
      ]);
      state.home.featured = fe.items;
      state.home.trending = tr.items;
      state.home.recent = re.items;
      state.heroItems = uniqueById([...tr.items, ...fe.items]).filter((w) => !!w.coverImage?.large).slice(0, 6);
      renderHero();
      renderHome();
      browse({ kind: 'popular', page: 2 })
        .then((po) => {
          state.home.popular = po.items.filter((w) => !state.home.trending.some((t) => t.id === w.id));
          renderHome();
        })
        .catch(() => {});
    } catch {
      renderHeroFallback();
      const box = el('div');
      emptyState(box, {
        icon: 'offline',
        error: true,
        title: 'تعذّر الوصول إلى المصادر',
        text: 'تحقّق من الاتصال ثم أعد المحاولة.',
        action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void loadHome() },
      });
      q('homeSections').replaceChildren(box.firstElementChild);
    }
  }

  // ── البانر الدائري: حركة v35 كما هي، وتركيبٌ يناسب الأغلفة الطولية ──

  function heroSlide(w) {
    const s = el('div', 'hero-slide');
    s.setAttribute('role', 'group');
    s.setAttribute('aria-label', titleOf(w));
    const back = el('div', 'hero-backdrop');
    const cover = w.coverImage?.large;
    if (cover) back.style.backgroundImage = `url("${cover.replace(/"/g, '%22')}")`;
    const poster = el('div', 'hero-poster');
    void mountImage(poster, w);
    const copy = el('div', 'hero-copy');
    const editions = w._work?.editions ?? [];
    const kicker = [
      (w.genres || []).slice(0, 2).map(genreAr).join(' · '),
      editions.length > 1 ? countLabel(editions.length, 'source') : editions[0]?.label,
    ]
      .filter(Boolean)
      .join(' · ');
    copy.append(el('div', 'hero-kicker', kicker));
    const name = el('h3', 'hero-name', titleOf(w));
    name.dir = 'auto';
    copy.append(name);
    s.append(back, poster, copy);
    s.onclick = () => {
      if (Math.abs(state.heroDeltaX) < 8) void openWork(w);
    };
    return s;
  }
  function renderHero() {
    const items = state.heroItems;
    if (!items.length) return renderHeroFallback();
    const physical = [items[items.length - 1], ...items, items[0]];
    q('heroTrack').replaceChildren(...physical.map(heroSlide));
    q('heroDots').replaceChildren(
      ...items.map((_, i) => {
        const d = el('button', `hero-dot${i === 0 ? ' active' : ''}`);
        d.type = 'button';
        d.setAttribute('aria-label', `العمل ${i + 1} من ${items.length}`);
        d.onclick = (e) => {
          e.stopPropagation();
          heroGoLogical(i);
        };
        return d;
      }),
    );
    state.heroPhysicalIndex = 1;
    heroPosition(false);
    bindHero();
    restartHero();
  }
  function renderHeroSkeleton() {
    q('heroTrack').replaceChildren(el('div', 'skeleton'));
    q('heroDots').replaceChildren();
  }
  function renderHeroFallback() {
    state.heroItems = [];
    const s = el('div', 'hero-slide');
    const copy = el('div', 'hero-copy');
    copy.style.insetInlineStart = '20px';
    copy.append(el('div', 'hero-kicker', 'مانجا · مانهوا · مانها'), el('h3', 'hero-name', 'VANTARA'));
    s.append(copy);
    q('heroTrack').replaceChildren(s);
    q('heroTrack').style.transform = 'none';
    q('heroDots').replaceChildren();
  }
  function logicalIndex() {
    const n = state.heroItems.length;
    if (!n) return 0;
    if (state.heroPhysicalIndex === 0) return n - 1;
    if (state.heroPhysicalIndex === n + 1) return 0;
    return state.heroPhysicalIndex - 1;
  }
  function heroPosition(anim = true) {
    const tr = q('heroTrack');
    tr.style.transition = anim ? 'transform .38s var(--ease-out)' : 'none';
    tr.style.transform = `translateX(${-state.heroPhysicalIndex * 100}%)`;
    const li = logicalIndex();
    root.querySelectorAll('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === li));
    // الالتفاف لا يعتمد على transitionend وحده: صفحةٌ مخفية أو تطبيق في الخلفية
    // لا يطلقه، فكان العدّاد يتجاوز النسخ ويعرض بانرًا فارغًا
    clearTimeout(state.heroWrapTimer);
    if (anim) state.heroWrapTimer = setTimeout(heroWrap, 450);
    else heroWrap();
  }
  /** من النسخة الطرفية إلى الأصل بلا حركة. آمنة مهما تكرّرت. */
  function heroWrap() {
    const n = state.heroItems.length;
    if (!n) return;
    const i = state.heroPhysicalIndex;
    if (i >= 1 && i <= n) return;
    state.heroPhysicalIndex = i <= 0 ? n : 1;
    const tr = q('heroTrack');
    tr.style.transition = 'none';
    tr.style.transform = `translateX(${-state.heroPhysicalIndex * 100}%)`;
    void tr.offsetWidth;
    const li = logicalIndex();
    root.querySelectorAll('.hero-dot').forEach((d, k) => d.classList.toggle('active', k === li));
  }
  function heroNext() {
    if (!state.heroItems.length) return;
    heroWrap();
    state.heroPhysicalIndex += 1;
    heroPosition(true);
  }
  function heroPrev() {
    if (!state.heroItems.length) return;
    heroWrap();
    state.heroPhysicalIndex -= 1;
    heroPosition(true);
  }
  function heroGoLogical(i) {
    state.heroPhysicalIndex = i + 1;
    heroPosition(true);
    restartHero();
  }
  function bindHero() {
    const hero = q('hero');
    if (hero.dataset.bound) return;
    hero.dataset.bound = '1';
    const tr = q('heroTrack');
    tr.addEventListener('transitionend', heroWrap);
    const start = (x) => {
      state.heroDragging = true;
      state.heroStartX = x;
      state.heroDeltaX = 0;
      hero.classList.add('dragging');
      clearInterval(state.heroTimer);
    };
    const move = (x) => {
      if (!state.heroDragging) return;
      state.heroDeltaX = x - state.heroStartX;
      // الشريط يتبع الإصبع: بلا هذا يبدو البانر صورةً ثابتة حتى يُفلت
      tr.style.transform = `translateX(calc(${-state.heroPhysicalIndex * 100}% + ${state.heroDeltaX}px))`;
    };
    const end = () => {
      if (!state.heroDragging) return;
      state.heroDragging = false;
      hero.classList.remove('dragging');
      if (state.heroDeltaX < -42) heroNext();
      else if (state.heroDeltaX > 42) heroPrev();
      else heroPosition(true);
      setTimeout(() => (state.heroDeltaX = 0), 0);
      restartHero();
    };
    hero.addEventListener('touchstart', (e) => start(e.touches[0].clientX), { passive: true });
    hero.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
    hero.addEventListener('touchend', end);
    hero.addEventListener('touchcancel', end);
    hero.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') start(e.clientX);
    });
    hero.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') move(e.clientX);
    });
    hero.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') end();
    });
  }
  function restartHero() {
    clearInterval(state.heroTimer);
    // يلفّ والرئيسية أمامك فقط: لا حركة في صفحة مخفية ولا والتطبيق في الخلفية
    if (state.heroItems.length > 1) state.heroTimer = setInterval(() => currentPage() === 'home' && !document.hidden && heroNext(), 5200);
  }

  // ───────────────────────── صفحة العمل ─────────────────────────

  async function openWork(work, { readNumber = null } = {}) {
    // بطاقةٌ بُنيت قبل وصول وصف العمل من الخادم: يُعاد بناؤها بما عُرف منذ ذلك
    if (!work._work?.editions?.length && String(work.id).startsWith('ext:')) {
      work = workFromRef(String(work.id), titleOf(work), work.coverImage?.large);
    }
    state.current = work;
    state.nextRow = null;
    state.chapterSource = null;
    state.chapterNewestFirst = true;
    state.chapterShown = CHAPTER_BATCH;
    if (work._work?.editions?.length) rememberWork(work);
    pushHistory(work);
    showPage('detail');
    renderDetail(work);
    renderChaptersLoading();
    if (!work._work?.editions?.length) {
      // عملٌ من المكتبة على جهاز آخر: نُسخه لم تُحفظ هنا، فيُبحث عنه بعنوانه
      try {
        const { items } = await browse({ query: titleOf(work) });
        const found = items.find((w) => w.id === work.id) ?? items.find((w) => titlesMatch(titleOf(w), titleOf(work)));
        if (found && state.current === work) {
          // المرجع يبقى مرجعك: مكتبتك وتقدّمك مربوطان به لا بمفتاح النتيجة
          const kept = { ...found, id: work.id, _work: { ...found._work, key: work._work.key } };
          work = kept;
          state.current = kept;
          rememberWork(kept);
        }
      } catch {
        // يبقى العمل بلا نُسخ ويقول ذلك أدناه
      }
    }
    if (state.current !== work) return;
    if (!work._work?.editions?.length) {
      emptyState(q('chapterPanel'), {
        icon: 'search',
        title: 'ما وصلنا للمصادر الحين',
        text: 'نحاول مرة ثانية بعد لحظة، أو المسها الحين.',
        action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void openWork(work, { readNumber }) },
      });
      setReadCta(null);
      return;
    }
    try {
      const full = await detail(work);
      if (state.current !== work) return;
      state.current = full;
      // غلافٌ عرفناه من التفاصيل يُحفظ للبطاقات وللأصدقاء
      if (full._work?.thumbnailUrl && full._work.thumbnailUrl !== work._work?.thumbnailUrl) rememberWork(full);
      renderDetail(full);
      renderSources(full);
      renderChapters(full);
      // من «اقرأ الفصل 110» في المجلس: الفصل نفسه يُفتح حين تصل الفصول
      let wanted = readNumber;
      if (wanted !== null) {
        const row = full._chapters?.find((r) => r.number === wanted);
        if (row) {
          openChapter(full, row);
          wanted = null;
        }
      }
      // ثم باقي المصادر: العمل نفسه عندها قد يبدأ من الفصل الأول
      const expanded = await expandEditions(full);
      if (wanted !== null && state.current === expanded) {
        const row = expanded._chapters?.find((r) => r.number === wanted);
        if (row) openChapter(expanded, row);
        else toast('هالفصل مو متوفر في مصادرنا الحين');
      }
    } catch {
      if (state.current !== work) return;
      emptyState(q('chapterPanel'), {
        icon: 'offline',
        error: true,
        title: 'تعذّر جلب الفصول',
        text: 'المصادر لم تردّ الآن.',
        action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void openWork(work) },
      });
      setReadCta(null);
    }
  }
  /**
   * يسأل المصادر التي لم نعرف أن العمل فيها، ويضم ما يطابقه. الصفحة تبقى
   * صالحة أثناءه: شريحة «نبحث في المصادر» فقط، ثم تتحدّث الفصول والمصادر.
   */
  async function expandEditions(w) {
    if (!available()) return w;
    state.discovering = w;
    renderSources(w);
    try {
      const found = await discoverEditions(w);
      if (state.current !== w) return w;
      const next = await withEditions(w, found);
      if (state.current !== w) return w;
      if (next !== w) {
        state.current = next;
        rememberWork(next);
        renderDetail(next);
        renderChapters(next);
      }
      return next;
    } catch {
      return w;
    } finally {
      if (state.discovering === w) state.discovering = null;
      if (state.current) renderSources(state.current);
    }
  }
  function renderDetail(w) {
    const title = titleOf(w);
    const h1 = q('detailTitle');
    h1.textContent = title;
    h1.dir = 'auto';
    q('detailTopTitle').textContent = title;
    q('detailTopTitle').dir = 'auto';

    const sub = q('detailSub');
    sub.replaceChildren();
    if (w.status && STATUS_AR[w.status]) {
      const s = el('span', 'status-dot', STATUS_AR[w.status]);
      s.dataset.status = w.status;
      sub.append(s);
    }
    if (w._chapters) sub.append(el('span', null, countLabel(w._chapters.length, 'chapter')));
    const editions = w._sources ?? w._work?.editions ?? [];
    if (editions.length > 1) sub.append(el('span', null, countLabel(editions.length, 'source')));
    else if (editions[0]?.label) sub.append(el('span', null, editions[0].label));

    q('detailGenres').replaceChildren(...(w.genres || []).slice(0, 4).map((x) => el('span', 'chip', genreAr(x))));

    const cover = q('detailCover');
    if (cover.dataset.for !== String(w.id)) {
      cover.dataset.for = String(w.id);
      const glow = q('detailGlow');
      glow.classList.remove('ready');
      glow.style.backgroundImage = '';
      void mountImage(cover, w).then((url) => {
        if (!url || state.current?.id !== w.id) return;
        glow.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
        glow.classList.add('ready');
      });
    }

    const text = clean(w.description);
    const d = q('description');
    d.textContent = text || (w.description === undefined ? '' : 'لا توجد نبذة من المصدر.');
    d.classList.add('clamped');
    q('summaryBlock').hidden = w.description === undefined && !text;
    requestAnimationFrame(() => {
      q('moreToggle').hidden = d.scrollHeight <= d.clientHeight + 2;
      q('moreToggle').textContent = 'المزيد';
    });
    refreshLibraryDetail();
    renderRating();
    renderInfo(w);
  }
  function toggleSummary() {
    const d = q('description');
    const clamped = d.classList.toggle('clamped');
    q('moreToggle').textContent = clamped ? 'المزيد' : 'أقل';
  }
  function renderInfo(w) {
    const role = (needle) =>
      unique((w.staff?.edges || []).filter((e) => (e.role || '').toLowerCase().includes(needle)).map((e) => e.node?.name?.full)).join('، ');
    const pairs = [
      ['المؤلف', role('story')],
      ['الرسام', role('art')],
      ['الحالة', STATUS_AR[w.status]],
      ['الفصول', w._chapters ? String(w._chapters.length) : null],
      ['المصادر', (w._sources ?? w._work?.editions ?? []).map((s) => s.label).join('، ')],
      ['التصنيفات', (w.genres || []).map(genreAr).join('، ')],
    ].filter(([, v]) => v);
    const grid = q('infoGrid');
    grid.replaceChildren(
      ...pairs.map(([a, b]) => {
        const d = el('div', 'info-box');
        d.append(el('div', 'info-label', a), el('div', 'info-value', b));
        return d;
      }),
    );
    // خانة وحيدة في شبكة من عمودين تترك نصفها فارغًا
    if (pairs.length % 2) grid.append(el('div', 'info-box'));
    grid.parentElement.hidden = pairs.length === 0;
  }
  function chapterMessage(text) {
    q('chapterPanel').replaceChildren(el('div', 'no-data', text));
  }
  function renderChaptersLoading() {
    q('chapterCount').textContent = '';
    q('sourcesBlock').hidden = true;
    q('detailProgress').hidden = true;
    const list = el('div', 'chapter-list');
    list.setAttribute('aria-busy', 'true');
    for (let i = 0; i < 6; i++) {
      const row = el('div', 'chapter-row');
      row.innerHTML =
        '<div class="chapter-open"><span class="skeleton-line" style="width:40%;margin:0"></span><span class="skeleton-line" style="width:24%"></span></div>';
      list.append(row);
    }
    q('chapterPanel').replaceChildren(list);
    setReadCta(undefined);
  }

  /**
   * زرّ القراءة: «ابدأ» لمن لم يقرأ، «تابع» لمن قرأ، ومعه الفصل الذي سيُفتح.
   * `undefined` = الفصول تُجمع، `null` = لا فصول.
   */
  function setReadCta(next, { started = false } = {}) {
    const btn = q('readCta');
    const label = q('readCtaLabel');
    const sub = q('readCtaSub');
    btn.disabled = !next;
    sub.textContent = '';
    if (next === undefined) label.textContent = 'جارٍ جمع الفصول';
    else if (next === null) label.textContent = 'لا فصول متاحة';
    else {
      label.textContent = started ? 'تابع القراءة' : 'ابدأ القراءة';
      sub.textContent = next.chapter.name || `الفصل ${next.number}`;
      sub.dir = 'auto';
    }
  }

  /**
   * المصدر تحت زرّ القراءة: «القارئ الذكي» أولًا (يدمج أفضل نسخة لكل فصل ولا
   * يفرض مصدرًا بعينه)، ثم مصدران، والباقي في ورقة «كل المصادر».
   *
   * المصدران الظاهران: المختار إن كان أحد المصادر، ثم الأكثر فصولًا.
   */
  function renderSources(w) {
    const sources = [...(w._sources ?? [])].sort((a, b) => b.count - a.count);
    const failed = w._failedSources ?? [];
    q('sourcesBlock').hidden = sources.length + failed.length < 2;
    const pick = (value) => {
      state.chapterSource = value;
      state.chapterShown = CHAPTER_BATCH;
      renderSources(w);
      renderChapters(w);
    };
    const chip = (label, count, value, extra = '') => {
      const b = el('button', `source-chip${extra}`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.chapterSource === value));
      b.setAttribute('aria-pressed', String(state.chapterSource === value));
      b.append(el('span', null, label));
      if (count !== null) b.append(el('b', null, String(count)));
      b.onclick = () => pick(value);
      return b;
    };
    const smart = chip('القارئ الذكي', null, null, ' source-chip--smart');
    smart.insertAdjacentHTML('afterbegin', glyph('spark'));
    const selected = sources.find((x) => x.sourceId === state.chapterSource);
    const shown = selected ? [selected, ...sources.filter((x) => x !== selected)].slice(0, 2) : sources.slice(0, 2);
    const chips = [smart, ...shown.map((x) => chip(x.label, x.count, x.sourceId))];
    const hiddenCount = sources.length - shown.length + failed.length;
    if (hiddenCount > 0 || failed.length) {
      const all = el('button', 'source-chip source-chip--all');
      all.type = 'button';
      all.innerHTML = glyph('layers');
      all.append(el('span', null, 'كل المصادر'), el('b', null, String(sources.length + failed.length)));
      all.setAttribute('aria-label', `كل المصادر المتوفرة لهذا العمل: ${countLabel(sources.length + failed.length, 'source')}`);
      all.onclick = () => openSourcesSheet(w, sources, failed, pick);
      chips.push(all);
    }
    if (state.discovering === w) {
      const busy = el('span', 'source-chip source-chip--busy');
      busy.append(el('i', 'spinner'), el('span', null, 'نبحث في باقي المصادر…'));
      chips.push(busy);
    }
    q('sourceRow').replaceChildren(...chips);
    if (state.discovering === w) q('sourcesBlock').hidden = false;
  }
  function openSourcesSheet(w, sources, failed, pick) {
    openSheet((body) => {
      body.append(el('h3', null, 'المصادر المتوفرة'));
      const note = el('p', null, 'القارئ الذكي يختار لكل فصل أكمل نسخة. اختر مصدرًا لتقرأ فصوله كما هي عنده.');
      note.style.marginBottom = '8px';
      body.append(note);
      const row = (icon, label, count, value) => {
        const b = sheetItem(icon, label, () => {
          closeSheet();
          pick(value);
        }, { pressed: state.chapterSource === value });
        if (count !== null) {
          const c = el('span', 'value', countLabel(count, 'chapter'));
          c.style.cssText = 'margin-inline-start:auto;color:var(--text-3);font-size:var(--fs-meta)';
          b.querySelector('.trail')?.before(c) ?? b.append(c);
        }
        return b;
      };
      body.append(row('spark', 'القارئ الذكي', w._chapters?.length ?? 0, null));
      for (const x of sources) body.append(row('layers', x.label, x.count, x.sourceId));
      for (const f of failed) {
        const b = el('div', 'sheet-item');
        b.innerHTML = glyph('alert');
        b.querySelector('.icon').style.color = 'var(--warning)';
        b.append(el('span', null, f.label));
        const c = el('span', null, 'ما ردّ الآن');
        c.style.cssText = 'margin-inline-start:auto;color:var(--text-3);font-size:var(--fs-meta)';
        b.append(c);
        b.style.opacity = '.7';
        body.append(b);
      }
    });
  }

  function visibleRows(w) {
    const rows = state.chapterSource ? editionRows(w, state.chapterSource) : w._chapters ?? [];
    return state.chapterNewestFirst ? rows : [...rows].reverse();
  }

  function renderChapters(w) {
    const all = w._chapters ?? [];
    if (!all.length) {
      q('chapterCount').textContent = '';
      chapterMessage('المصادر لم تُرجع فصولًا لهذا العمل.');
      setReadCta(null);
      return;
    }
    const ref = String(w.id);
    const read = (r) => isChapterRead(sync, ref, chapterKeyOf(ref, r));
    const readCount = all.filter(read).length;
    // أول فصل غير مقروء من الأقدم، من المصدر المختار (أو الذكي)
    const base = state.chapterSource ? editionRows(w, state.chapterSource) : all;
    const next = [...base].reverse().find((r) => !read(r)) ?? base[0] ?? all[0];
    state.nextRow = next;
    setReadCta(next, { started: readCount > 0 });

    q('detailProgress').hidden = false;
    q('progressFill').style.width = `${Math.round((readCount / all.length) * 100)}%`;
    q('progressText').textContent = readCount ? `قرأت ${readCount} من ${all.length}` : 'لم تبدأ بعد';

    const rows = visibleRows(w);
    q('chapterCount').textContent = String(rows.length);
    const list = el('div', 'chapter-list');
    const fragment = document.createDocumentFragment();
    const nextKey = chapterKeyOf(ref, next);
    for (const r of rows.slice(0, state.chapterShown)) {
      fragment.append(chapterRow(w, r, read(r), chapterKeyOf(ref, r) === nextKey));
    }
    list.append(fragment);
    const parts = [list];
    const rest = rows.length - state.chapterShown;
    if (rest > 0) {
      const more = el('button', 'btn btn-secondary chapter-more', `اعرض ${countLabel(rest, 'chapter')} أخرى`);
      more.type = 'button';
      more.onclick = () => {
        state.chapterShown += 400;
        renderChapters(w);
      };
      parts.push(more);
    }
    q('chapterPanel').replaceChildren(...parts);
  }
  function chapterRow(w, r, isRead, isNext) {
    const ref = String(w.id);
    const row = el('div', `chapter-row${isRead ? ' is-read' : ''}${isNext ? ' is-next' : ''}`);
    const open = el('button', 'chapter-open');
    open.type = 'button';
    const no = el('div', 'chapter-no', r.chapter.name || `الفصل ${r.number}`);
    no.dir = 'auto';
    const note = el(
      'div',
      'chapter-note',
      [dateLabel(r.chapter.dateUpload), r.chapter.scanlator].filter(Boolean).join(' · '),
    );
    open.append(no, note);
    open.onclick = () => openChapter(w, r);
    const eye = el('button', 'chapter-eye');
    eye.type = 'button';
    const paint = (on) => {
      eye.classList.toggle('chapter-eye--read', on);
      eye.setAttribute('aria-pressed', String(on));
      eye.innerHTML = glyph('eye') + (on ? `<span class="chapter-eye__check">${glyph('check')}</span>` : '');
      const label = on ? 'مقروء — المس لإلغاء التعليم' : 'علّمه مقروءًا';
      eye.setAttribute('aria-label', label);
      eye.title = label;
      row.classList.toggle('is-read', on);
    };
    paint(isRead);
    eye.onclick = (e) => {
      e.stopPropagation();
      const on = !isChapterRead(sync, ref, chapterKeyOf(ref, r));
      markChapter(sync, ref, r, on);
      paint(on);
      // التقدّم وزرّ «تابع» يتبعان العين بعد لحظة، لا بعد المزامنة
      clearTimeout(state.eyeTimer);
      state.eyeTimer = setTimeout(() => state.current === w && renderChapters(w), 450);
    };
    row.append(open, eye);
    return row;
  }
  function dateLabel(ms) {
    if (!ms) return '';
    const days = Math.floor((Date.now() - ms) / 86_400_000);
    if (days < 1) return 'اليوم';
    if (days < 2) return 'أمس';
    if (days < 7) return `قبل ${countLabel(days, 'day')}`;
    return new Date(ms).toLocaleDateString('ar', {
      day: 'numeric',
      month: 'short',
      year: days > 330 ? 'numeric' : undefined,
      numberingSystem: 'latn',
    });
  }
  function flipChapterOrder() {
    if (!state.current?._chapters) return;
    state.chapterNewestFirst = !state.chapterNewestFirst;
    toast(state.chapterNewestFirst ? 'الأحدث أولًا' : 'الأقدم أولًا');
    renderChapters(state.current);
  }
  function readNow() {
    if (state.current && state.nextRow) openChapter(state.current, state.nextRow);
  }
  function openChapter(w, row) {
    // المصدر المختار يقرأ فصوله هو؛ الذكي يمرّ على الأفضل لكل فصل
    const rows = state.chapterSource ? editionRows(w, state.chapterSource) : w._chapters;
    deps.openReader({ seriesRef: String(w.id), title: titleOf(w), work: w, rows, row });
  }

  // ── ورقة المعاينة ──
  // من المجلس والملف: لمسة على عملٍ تعرض غلافه ونبذته أولًا، ثم «افتح».
  // لمسةٌ بالغلط وأنت تمرّر لا تنقلك من مكانك.

  function previewWork(work, { chapter = null } = {}) {
    let alive = true;
    openSheet((body) => {
      const box = el('div', 'pv');
      const cover = el('div', 'pv-cover');
      void mountImage(cover, work);
      const copy = el('div', 'pv-copy');
      const title = el('h3', 'pv-title', titleOf(work));
      title.dir = 'auto';
      const meta = el('div', 'pv-meta');
      const desc = el('p', 'pv-desc');
      desc.innerHTML = '<span class="skeleton-line"></span><span class="skeleton-line"></span>';
      copy.append(title, meta, desc);
      box.append(cover, copy);
      body.append(box);

      const actions = el('div', 'sheet-actions pv-actions');
      if (chapter && Number.isFinite(chapter.number)) {
        const read = el('button', 'btn btn-primary');
        read.type = 'button';
        read.innerHTML = glyph('book');
        read.append(el('span', null, `اقرأ ${chapter.label}`));
        read.onclick = () => {
          closeSheet();
          void openWork(work, { readNumber: chapter.number });
        };
        const page = el('button', 'btn btn-secondary', 'صفحة العمل');
        page.type = 'button';
        page.onclick = () => {
          closeSheet();
          void openWork(work);
        };
        actions.append(read, page);
      } else {
        const open = el('button', 'btn btn-primary btn-block');
        open.type = 'button';
        open.innerHTML = glyph('book');
        open.append(el('span', null, 'افتح العمل'));
        open.onclick = () => {
          closeSheet();
          void openWork(work);
        };
        actions.append(open);
      }
      body.append(actions);

      if (!available()) {
        desc.textContent = '';
        return () => (alive = false);
      }
      describe(work)
        .then((full) => {
          if (!alive) return;
          const bits = [STATUS_AR[full.status], (full.genres || []).slice(0, 3).map(genreAr).join(' · '), full._chapterCount ? countLabel(full._chapterCount, 'chapter') : null].filter(Boolean);
          meta.textContent = bits.join(' · ');
          const text = clean(full.description);
          desc.textContent = text || 'لا توجد نبذة من المصدر.';
          desc.dir = 'auto';
          if (full._work?.editions?.length && !work._work?.editions?.length) work = full;
        })
        .catch(() => {
          if (alive) desc.textContent = 'ما قدرنا نجيب النبذة الحين.';
        });
      return () => (alive = false);
    });
  }

  // ── المكتبة والتقييم (في حسابك) ──

  function toggleLibraryCurrent() {
    if (!state.current) return;
    const d = descriptorOf(state.current);
    if (libraryEntry(d.seriesRef)?.row) {
      sync.enqueue('library.remove', { seriesRef: d.seriesRef });
      toast('أزيل من مكتبتك');
    } else {
      sync.enqueue('library.add', d);
      toast('أضيف إلى مكتبتك');
    }
    afterLibraryChange();
  }
  function toggleLaterCurrent() {
    if (!state.current) return;
    const d = descriptorOf(state.current);
    const member = !inCollection('read_later', d.seriesRef);
    sync.enqueue('readLater.set', { ...d, member });
    toast(member ? 'في «أقرأ لاحقًا»' : 'أزيل من «أقرأ لاحقًا»');
    afterLibraryChange();
  }
  function toggleFavoriteCurrent() {
    if (!state.current) return;
    const d = descriptorOf(state.current);
    const member = !inCollection('favorite', d.seriesRef);
    sync.enqueue('favorite.set', { ...d, member });
    toast(member ? 'أضيف إلى المفضلة' : 'أزيل من المفضلة');
    afterLibraryChange();
  }
  /** أفضل 5: قائمة قصيرة مرتبة. حين تمتلئ تختار ما يخرج بدل أن يُرفض الطلب. */
  const TOP_MAX = 5;
  function topRows() {
    return sync
      .rows('collections', (r) => r.user_id === me() && r.kind === 'top' && r.member)
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || a.updated_at - b.updated_at);
  }
  function toggleTopCurrent() {
    if (!state.current) return;
    const d = descriptorOf(state.current);
    const rows = topRows();
    if (inCollection('top', d.seriesRef)) {
      sync.enqueue('top.set', { ...d, member: false });
      toast('أُزيل من أفضل 5');
      return afterLibraryChange();
    }
    if (rows.length < TOP_MAX) {
      sync.enqueue('top.set', { ...d, member: true, position: rows.length + 1 });
      toast(`صار رقم ${rows.length + 1} في أفضل 5`);
      return afterLibraryChange();
    }
    openSheet((body) => {
      body.append(el('h3', null, 'قائمة أفضل 5 مكتملة'));
      body.append(el('p', null, 'اختر العمل اللي يطلع ويأخذ هذا مكانه.'));
      rows.forEach((row, i) => {
        const work = sync.rows('works', (w) => w.series_ref === row.series_ref)[0];
        const item = sheetItem('star', `${i + 1}. ${work?.title || row.series_ref.replace(/^ext:/, '')}`, () => {
          sync.enqueue('top.set', { seriesRef: row.series_ref, member: false });
          sync.enqueue('top.set', { ...d, member: true, position: row.position ?? i + 1 });
          closeSheet();
          toast(`صار رقم ${i + 1} في أفضل 5`);
          afterLibraryChange();
        });
        item.querySelector('span').dir = 'auto';
        body.append(item);
      });
    });
  }
  function afterLibraryChange() {
    refreshLibraryDetail();
    // الطابور يكتب في المرآة مع الدفع؛ onChange يعيد الرسم حين يعود
    setTimeout(refreshLibraryDetail, 700);
  }
  function refreshLibraryDetail() {
    if (!state.current) return;
    const e = libraryEntry(String(state.current.id));
    const btn = q('libraryBtn');
    const inLib = !!e?.row;
    btn.setAttribute('aria-pressed', String(inLib));
    btn.innerHTML = glyph('library', { filled: inLib });
    const label = inLib ? 'في مكتبتي — المس للإزالة' : 'أضف إلى مكتبتي';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    const fav = root.querySelector('.icon-btn--fav');
    fav.setAttribute('aria-pressed', String(!!e?.favorite));
    fav.innerHTML = glyph('heart', { filled: !!e?.favorite });
  }
  function userRating(ref) {
    const row = sync.rows('ratings', (r) => r.user_id === me() && r.series_ref === String(ref))[0];
    return row?.score ? Math.round(row.score / 2) : 0;
  }
  let pendingRating = null;
  /** التقييم نجومٌ في مكانها: لمسة واحدة، بلا نافذة. */
  function renderRating() {
    const box = q('rateStars');
    const current = pendingRating?.ref === state.current?.id ? pendingRating.stars : state.current ? userRating(state.current.id) : 0;
    box.replaceChildren(
      ...[1, 2, 3, 4, 5].map((i) => {
        const b = el('button', i <= current ? 'on' : '');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(i === current));
        b.setAttribute('aria-label', `تقييمك ${i} من 5`);
        b.innerHTML = glyph('star', { filled: i <= current, size: 20 });
        b.onclick = () => {
          if (!state.current) return;
          // الخادم يحفظ من 10؛ النجوم خمس
          sync.enqueue('rating.set', { ...descriptorOf(state.current), score: i * 2 });
          pendingRating = { ref: state.current.id, stars: i };
          toast(`قيّمته ${i} من 5`);
          renderRating();
        };
        return b;
      }),
    );
  }

  // ── قائمة ⋮ في صفحة العمل ──

  function openWorkMenu() {
    if (!state.current) return;
    const w = state.current;
    const e = libraryEntry(String(w.id));
    openSheet((body) => {
      const title = el('h3', null, titleOf(w));
      title.dir = 'auto';
      title.style.marginBottom = '8px';
      body.append(title);
      body.append(
        sheetItem('clock', 'أقرأ لاحقًا', () => {
          closeSheet();
          toggleLaterCurrent();
        }, { pressed: !!e?.later }),
        sheetItem('star', 'ضمن أفضل 5', () => {
          closeSheet();
          toggleTopCurrent();
        }, { pressed: inCollection('top', String(w.id)) }),
      );
      if (deps.report) {
        body.append(
          sheetItem('flag', 'بلّغ عن مشكلة في العمل', () => {
            closeSheet();
            openReport(w);
          }),
        );
      }
    });
  }
  function avatarNode(person, size = 44) {
    if (person.avatarKey) {
      const img = el('img');
      img.src = person.avatarKey;
      img.alt = '';
      img.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;object-fit:cover;flex:none`;
      return img;
    }
    const s = el('span', 'avatar-letter', initialOf(person.displayName));
    s.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;flex:none`;
    return s;
  }
  /** مشاركة العمل (أو فصلٍ منه): الورقة المشتركة مع القارئ في `share.js`. */
  function openShare(w, chapter = null) {
    openShareSheet({
      sync,
      friends: deps.friends?.() ?? [],
      openSheet,
      closeSheet,
      sheetBody: () => q('sheetBody'),
      toast,
      work: { ref: String(w.id), title: titleOf(w), cover: w.coverImage?.large ?? null },
      chapter,
    });
  }
  function everyoneFace(size = 58) {
    const s = el('span', 'avatar-letter share-everyone');
    s.innerHTML = glyph('users', { size: Math.round(size * 0.42) });
    s.style.cssText = `width:${size}px;height:${size}px;border-radius:99px;flex:none`;
    return s;
  }
  const REPORT_CHOICES = [
    ['DUPLICATE_WORK', 'العمل مكرر'],
    ['WRONG_CHAPTER_NUMBER', 'أرقام الفصول خطأ'],
    ['LOW_QUALITY', 'جودة الصور ضعيفة'],
    ['OTHER', 'شيء ثاني'],
  ];
  function openReport(w) {
    openSheet((body) => {
      body.append(el('h3', null, 'وش المشكلة؟'));
      for (const [kind, label] of REPORT_CHOICES) {
        body.append(
          sheetItem('flag', label, async () => {
            closeSheet();
            try {
              await deps.report({ kind, seriesRef: String(w.id), sourceId: w._work?.editions?.[0]?.sourceId ?? null });
              toast('وصل البلاغ، شكرًا');
            } catch {
              toast('ما قدرنا نرسل البلاغ الآن');
            }
          }),
        );
      }
    });
  }

  // ───────────────────────── المكتبة ─────────────────────────

  // ── «آخر المشاهدات»: قائمة لا شبكة — الغلاف، الاسم، آخر فصل ومتى، وحذف ──
  function viewedLabel(at) {
    const days = Math.floor((Date.now() - at) / 86_400_000);
    if (days < 7) return timeAgo(at).replace(/^الآن$/, 'منذ أقل من دقيقة');
    return new Date(at).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' }).replace('، ', ' - ');
  }
  function chapterRatio(userId, ref, number) {
    if (number == null) return null;
    const key = chapterKeyOf(ref, { chapter: { chapterNumber: number, name: '' }, sourceId: '' });
    const row = sync.rows('progress', (r) => r.user_id === userId && r.chapter_key === key)[0];
    return row ? Math.max(0, Math.min(1, Number(row.ratio) || 0)) : null;
  }
  /**
   * @param {HTMLElement} target
   * @param {{ userId?: string, own?: boolean, limit?: number }} [opts]
   */
  function renderHistoryList(target, { userId = me(), own = userId === me(), limit = Infinity } = {}) {
    const rows = viewRows(userId);
    if (!rows.length) {
      emptyState(target, {
        icon: 'history',
        title: own ? 'ما فتحت شي بعد' : 'ما فيه مشاهدات',
        text: own ? 'كل عمل تفتحه يظهر هنا بآخر فصل وصلته، على أجهزتك كلها.' : 'لما يفتح أعمالًا تظهر هنا.',
      });
      return;
    }
    const list = el('div', 'hist-list');
    rows.slice(0, limit).forEach((v, i) => {
      const work = workFromRef(v.series_ref, v.series_title, v.cover_url);
      const item = el('div', 'hist-row');
      const open = el('button', 'hist-open');
      open.type = 'button';
      const cover = el('span', 'hist-cover');
      void mountImage(cover, work);
      const copy = el('span', 'hist-copy');
      const title = el('bdi', 'hist-title', titleOf(work));
      const meta = el('span', 'hist-meta');
      if (v.chapter_label || v.chapter_number != null) {
        const ch = el('span', 'hist-chapter');
        ch.innerHTML = glyph('book', { size: 15 });
        ch.append(el('bdi', null, v.chapter_label || `الفصل ${v.chapter_number}`));
        meta.append(ch, el('span', 'hist-dot', '·'));
      }
      meta.append(el('span', null, viewedLabel(v.viewed_at ?? Date.now())));
      copy.append(title, meta);
      open.append(cover, copy);
      open.onclick = () => void openWork(work);
      item.append(open);
      const side = el('span', 'hist-side');
      // الحلقة لآخر ما فتحت وحده، حين لم تُكمل فصله
      const ratio = i === 0 ? chapterRatio(userId, v.series_ref, v.chapter_number) : null;
      if (ratio !== null && ratio < 0.98) {
        const ring = el('span', 'hist-ring');
        ring.style.setProperty('--p', String(Math.round(ratio * 100)));
        ring.append(el('b', null, `${Math.round(ratio * 100)}%`));
        side.append(ring);
      }
      if (own) {
        const del = el('button', 'hist-del');
        del.type = 'button';
        del.innerHTML = glyph('trash', { size: 20 });
        del.setAttribute('aria-label', `احذف ${titleOf(work)} من السجل`);
        del.onclick = () => {
          item.classList.add('hist-row--gone');
          setTimeout(() => removeView(v.series_ref), 180);
        };
        side.append(del);
      }
      item.append(side);
      list.append(item);
    });
    target.replaceChildren(list);
  }

  function renderLibrary() {
    const tabs = [['all', 'الكل'], ['reading', 'أتابعها'], ['history', 'آخر المشاهدات'], ['later', 'لاحقًا'], ['favorite', 'المفضلة']];
    q('libraryTabs').replaceChildren(
      ...tabs.map(([k, l]) => {
        const b = el('button', `library-tab${k === state.libraryFilter ? ' active' : ''}`, l);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(k === state.libraryFilter));
        const n = k === 'history' ? viewRows().length : libraryWorks(k).length;
        if (n) b.append(el('b', null, String(n)));
        b.onclick = () => {
          state.libraryFilter = k;
          renderLibrary();
        };
        return b;
      }),
    );
    if (state.libraryFilter === 'history') {
      q('libraryToolbar').hidden = true;
      q('libraryGrid').classList.remove('grid');
      renderHistoryList(q('libraryGrid'));
      return;
    }
    q('libraryGrid').classList.add('grid');
    const items = libraryWorks(state.libraryFilter);
    const sort = q('librarySort')?.value || 'added';
    if (sort === 'title') items.sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'ar'));
    else items.sort((a, b) => (libraryEntry(b.id)?.addedAt || 0) - (libraryEntry(a.id)?.addedAt || 0));
    const grid = q('libraryGrid');
    q('libraryToolbar').hidden = items.length < 2;
    q('libraryCount').textContent = countLabel(items.length, 'work');
    if (!items.length) {
      const copy = {
        all: ['مكتبتك فاضية', 'المس رمز المكتبة في صفحة أي عمل، ويظهر هنا على أجهزتك كلها.'],
        reading: ['ما تتابع شي الحين', 'الأعمال اللي تضيفها لمكتبتك تظهر هنا.'],
        later: ['القائمة فاضية', 'من قائمة الخيارات في صفحة العمل اختر «أقرأ لاحقًا».'],
        favorite: ['ما عندك مفضلة', 'القلب في صفحة العمل يضيفه هنا.'],
      }[state.libraryFilter];
      emptyState(grid, {
        icon: { favorite: 'heart', later: 'clock' }[state.libraryFilter] ?? 'library',
        title: copy[0],
        text: copy[1],
        action: state.libraryFilter === 'all' ? { label: 'اكتشف أعمالًا', icon: 'compass', run: () => navTo('discover') } : undefined,
      });
      return;
    }
    renderGrid(grid, items);
  }

  // ───────────────────────── المجموعات والاستكشاف والبحث ─────────────────────────

  const COLLECTIONS = {
    trending: { title: 'الأكثر رواجًا', kind: 'popular' },
    featured: { title: 'مقترحة لك', kind: 'catalogue' },
    recent: { title: 'المضافة حديثًا', kind: 'latest' },
    popular: { title: 'المميزة', kind: 'popular' },
  };
  async function openCollection(kind) {
    if (kind === 'history') {
      state.libraryFilter = 'history';
      navTo('library');
      return;
    }
    if (kind === 'libraryReading') {
      state.libraryFilter = 'reading';
      navTo('library');
      return;
    }
    const c = COLLECTIONS[kind] || COLLECTIONS.trending;
    state.collection = { kind: c.kind, page: 0, hasNext: true, items: [], genre: null };
    q('collectionTitle').textContent = c.title;
    q('collectionGrid').replaceChildren(...skeletonCards(9));
    q('collectionMore').hidden = true;
    showPage('collection');
    await loadMoreCollection();
  }
  async function loadMoreCollection() {
    if (!state.collection.hasNext) return;
    const btn = q('collectionMore');
    btn.disabled = true;
    btn.textContent = 'جارٍ التحميل…';
    try {
      const r = state.collection.genre
        ? await browse({ genre: state.collection.genre.names, page: state.collection.page + 1 })
        : await browse({ kind: state.collection.kind, page: state.collection.page + 1 });
      state.collection.page = r.page;
      state.collection.hasNext = r.hasNextPage;
      state.collection.items = uniqueById([...state.collection.items, ...r.items]);
      if (!state.collection.items.length) {
        emptyState(q('collectionGrid'), {
          icon: 'search',
          title: 'ما فيه نتائج',
          text: state.collection.genre ? `ما لقينا مصدرًا فيه تصنيف «${state.collection.genre.ar}».` : 'المصادر ما رجّعت أعمالًا هنا.',
        });
      } else {
        renderGrid(q('collectionGrid'), state.collection.items);
      }
      btn.hidden = !state.collection.hasNext;
    } catch {
      if (!state.collection.items.length) {
        emptyState(q('collectionGrid'), {
          icon: 'offline',
          error: true,
          title: 'تعذّر التحميل',
          action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void loadMoreCollection() },
        });
      } else toast('تعذّر تحميل المزيد');
    } finally {
      btn.disabled = false;
      btn.textContent = 'تحميل المزيد';
    }
  }
  /** أغلفة من أعمال التصنيف مما حمّلته الرئيسية: البلاطة تُري التصنيف لا تسمّيه فقط. */
  function genreCovers(g, used) {
    const pool = uniqueById([...(state.home.trending || []), ...(state.home.featured || []), ...(state.home.popular || []), ...(state.home.recent || [])]);
    const match = pool.filter((w) => w.coverImage?.large && (w.genres || []).some((x) => x === g.en || x === g.ar));
    // غلاف لم تأخذه بلاطة قبلها أولًا: لا تتشابه البلاطات
    const picked = [...match.filter((w) => !used.has(w.id)), ...match.filter((w) => used.has(w.id))].slice(0, 2);
    for (const w of picked) used.add(w.id);
    return picked;
  }
  function openCategories() {
    showPage('categories');
    const used = new Set();
    q('categoryGrid').replaceChildren(
      ...GENRES.map((g) => {
        const b = el('button', 'category');
        b.type = 'button';
        b.style.setProperty('--hue', String(g.hue));
        b.append(el('strong', null, g.ar));
        const art = el('span', 'category-art');
        for (const w of genreCovers(g, used)) {
          const img = el('img');
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.onerror = () => img.remove();
          img.src = w.coverImage.large;
          art.append(img);
        }
        b.append(art);
        b.onclick = () => void openGenre(g);
        return b;
      }),
    );
  }
  async function openGenre(g) {
    // فلتر التصنيف في كل مصدر، لا البحث بالكلمة: «مغامرة» في العنوان ليست مغامرة
    state.collection = { kind: 'genre', page: 0, hasNext: true, items: [], genre: g };
    q('collectionTitle').textContent = g.ar;
    q('collectionGrid').replaceChildren(...skeletonCards(9));
    q('collectionMore').hidden = true;
    showPage('collection');
    await loadMoreCollection();
  }

  async function loadMoreDiscover() {
    const btn = q('discoverMore');
    if (!available()) {
      emptyState(q('discoverGrid'), { icon: 'layers', title: 'المصادر داخل تطبيق أندرويد', text: 'الاستكشاف يقرأ كتالوج مصادرنا كاملًا من محرّك التطبيق.' });
      btn.hidden = true;
      return;
    }
    if (!state.catalogHasNext) return;
    btn.disabled = true;
    btn.textContent = 'جارٍ التحميل…';
    if (!state.catalog.length) {
      btn.hidden = true;
      q('discoverGrid').replaceChildren(...skeletonCards(12));
    }
    try {
      const r = await browse({ kind: 'catalogue', page: state.catalogPage + 1 });
      state.catalogPage = r.page;
      state.catalogHasNext = r.hasNextPage;
      state.catalog = uniqueById([...state.catalog, ...r.items]);
      if (!state.discoverQuery) renderGrid(q('discoverGrid'), state.catalog);
      btn.hidden = !state.catalogHasNext || !!state.discoverQuery;
    } catch {
      if (!state.catalog.length) {
        emptyState(q('discoverGrid'), {
          icon: 'offline',
          error: true,
          title: 'تعذّر تحميل الكتالوج',
          action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void loadMoreDiscover() },
        });
      } else toast('تعذّر تحميل المزيد');
    } finally {
      btn.disabled = false;
      btn.textContent = 'أعمال أكثر';
    }
  }
  /** البحث في الاستكشاف يسأل كل المصادر، لا ما حُمّل منها في الصفحة فقط. */
  function discoverSearch(term) {
    state.discoverQuery = term.trim();
    root.querySelector('#discover .search-clear').hidden = !state.discoverQuery;
    clearTimeout(state.searchTimer);
    if (!state.discoverQuery) {
      renderGrid(q('discoverGrid'), state.catalog);
      q('discoverMore').hidden = !state.catalogHasNext;
      return;
    }
    q('discoverMore').hidden = true;
    const term0 = state.discoverQuery;
    state.searchTimer = setTimeout(() => void runSearch(term0, q('discoverGrid'), () => state.discoverQuery), 380);
  }
  function clearDiscoverSearch() {
    q('discoverSearch').value = '';
    discoverSearch('');
    q('discoverSearch').focus();
  }
  async function runSearch(term, grid, stillWanted) {
    grid.replaceChildren(...skeletonCards(6));
    try {
      const { items } = await browse({ query: term });
      if (stillWanted() !== term) return 0;
      if (items.length) renderGrid(grid, items);
      else emptyState(grid, { icon: 'search', title: 'لا نتائج', text: 'جرّب اسمًا آخر، أو الاسم بالإنجليزي.' });
      return items.length;
    } catch {
      if (stillWanted() !== term) return 0;
      emptyState(grid, {
        icon: 'offline',
        error: true,
        title: 'تعذّر البحث الآن',
        action: { label: 'أعد المحاولة', icon: 'refresh', run: () => void runSearch(term, grid, stillWanted) },
      });
    }
  }
  // البحث قبل أن تكتب ليس صفحة فارغة: آخر ما بحثت عنه، والتصنيفات، والرائج
  const SEARCHES_KEY = 'vantara.v35.searches';
  const recentSearches = () => readJson(SEARCHES_KEY, []).filter((x) => typeof x === 'string').slice(0, 8);
  function rememberSearch(term) {
    const t = term.trim();
    if (t.length < 2) return;
    writeJson(SEARCHES_KEY, [t, ...recentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8));
  }
  function searchFor(term) {
    q('searchInput').value = term;
    debouncedSearch(term, { now: true });
  }
  function renderSearchIdle() {
    const host = q('searchIdle');
    host.replaceChildren();
    const recent = recentSearches();
    if (recent.length) {
      const head = el('div', 'search-head');
      head.append(el('h2', null, 'آخر ما بحثت عنه'));
      const clear = el('button', 'text-btn', 'امسح');
      clear.type = 'button';
      clear.onclick = () => {
        writeJson(SEARCHES_KEY, []);
        renderSearchIdle();
      };
      head.append(clear);
      const row = el('div', 'search-recent');
      for (const t of recent) {
        const b = el('button', 'search-chip');
        b.type = 'button';
        b.innerHTML = glyph('history', { size: 16 });
        const label = el('bdi', null, t);
        b.append(label);
        b.onclick = () => searchFor(t);
        row.append(b);
      }
      host.append(head, row);
    }
    const genresHead = el('div', 'search-head');
    genresHead.append(el('h2', null, 'تصفّح بالتصنيف'));
    const all = el('button', 'text-btn', 'الكل');
    all.type = 'button';
    all.onclick = () => openCategories();
    genresHead.append(all);
    const genres = el('div', 'search-genres');
    for (const g of GENRES.slice(0, 10)) {
      const b = el('button', 'search-genre', g.ar);
      b.type = 'button';
      b.style.setProperty('--hue', String(g.hue));
      b.onclick = () => void openGenre(g);
      genres.append(b);
    }
    host.append(genresHead, genres);
    const trending = (state.home.trending || []).slice(0, 6);
    if (trending.length) {
      const head = el('div', 'search-head');
      head.append(el('h2', null, 'الرائج الآن'));
      const list = el('div', 'search-trend');
      trending.forEach((w, i) => {
        const b = el('button', 'search-trend-row');
        b.type = 'button';
        const cover = el('span', 'search-trend-cover');
        void mountImage(cover, w);
        const copy = el('span', 'search-trend-copy');
        copy.append(el('bdi', 'search-trend-title', titleOf(w)));
        const meta = (w.genres || []).slice(0, 2).map(genreAr).join(' · ');
        if (meta) copy.append(el('span', 'search-trend-meta', meta));
        b.append(el('span', 'search-trend-rank', String(i + 1)), cover, copy);
        b.onclick = () => void openWork(w);
        list.append(b);
      });
      host.append(head, list);
    }
  }
  function showSearchIdle(idle) {
    q('searchIdle').hidden = !idle;
    q('searchGrid').hidden = idle;
    if (idle) {
      q('searchCount').hidden = true;
      renderSearchIdle();
    }
  }
  function openSearch() {
    showPage('search');
    if (!q('searchInput').value.trim()) showSearchIdle(true);
    setTimeout(() => q('searchInput')?.focus(), 60);
  }
  function clearSearch() {
    q('searchInput').value = '';
    debouncedSearch('');
    q('searchInput').focus();
  }
  let searchTerm = '';
  function debouncedSearch(term, { now = false } = {}) {
    searchTerm = term.trim();
    root.querySelector('#search .search-clear').hidden = !searchTerm;
    clearTimeout(state.searchTimer);
    if (!searchTerm) return showSearchIdle(true);
    state.searchTimer = setTimeout(
      async () => {
        const t = searchTerm;
        showSearchIdle(false);
        q('searchCount').hidden = true;
        const found = await runSearch(t, q('searchGrid'), () => searchTerm);
        if (searchTerm !== t) return;
        if (found) {
          rememberSearch(t);
          // الكلمة معزولة بـbdi: بحثٌ إنجليزي لا يقلب ترتيب السطر العربي
          q('searchCount').replaceChildren(document.createTextNode(`${countLabel(found, 'work')} لـ `), el('bdi', null, t));
          q('searchCount').hidden = false;
        }
      },
      now ? 0 : 330,
    );
  }

  // ───────────────────────── الإشعارات ─────────────────────────
  // سطرٌ واحد لكل إشعار: وجه المرسل، «مشعل أرسل لك فريم»، ومتى. والغلاف في
  // الطرف الآخر يقول عن أي عمل بلا كلام زائد.

  const nameOf = (userId) =>
    sync.rows('profiles', (p) => p.user_id === userId)[0]?.display_name ||
    sync.rows('accounts', (a) => a.user_id === userId)[0]?.username ||
    'صديق';
  const personOf = (userId) => ({
    userId,
    displayName: nameOf(userId),
    avatarKey: sync.rows('profiles', (p) => p.user_id === userId)[0]?.avatar_key ?? null,
  });
  const KIND_ICON = { FRAME: 'camera', RECOMMENDATION: 'spark', COMMENT_REPLY: 'edit', REACTION: 'heart', FRIEND_ACTIVITY: 'activity', SYSTEM: 'info' };

  function notificationCopy(row) {
    const frameId = frameIdFromLink(row.link);
    const frame = frameId ? sync.rows('frames', (f) => f.id === frameId)[0] : null;
    const work = row.series_ref ? sync.rows('works', (x) => x.series_ref === row.series_ref)[0] : null;
    switch (row.kind) {
      case 'FRAME':
        return {
          text: frame?.broadcast ? 'شارك فريمًا مع الجميع' : 'أرسل لك فريم',
          cover: frame?.cover_url ?? null,
          open: () => void deps.go({ name: 'frame', id: frameId }),
        };
      case 'RECOMMENDATION':
        return {
          text: 'رشّح لك',
          title: work?.title ?? row.body ?? null,
          cover: work?.cover_url ?? null,
          open: () => {
            majlis.markSeen('rec', String(row.id).split(':')[0]);
            if (row.series_ref) void openWork(workFromRef(row.series_ref, work?.title ?? row.body, work?.cover_url));
          },
        };
      case 'REACTION':
        if (String(row.link ?? '').startsWith('vantara://majlis/')) {
          const kind = row.link.split('/')[3];
          const noun = { frame: 'فريمك', rec: 'ترشيحك', activity: 'نشاطك' }[kind] ?? 'رسالتك';
          return { text: `تفاعل ${row.body ?? ''} مع ${noun}`, cover: null, open: () => showPage('majlis') };
        }
        return { text: 'تفاعل مع تعليقك', cover: work?.cover_url ?? null };
      case 'COMMENT_REPLY':
        return { text: 'ردّ على تعليقك', cover: work?.cover_url ?? null };
      case 'FRIEND_ACTIVITY':
        return { text: row.body || 'عنده جديد', cover: work?.cover_url ?? null };
      default:
        return { text: row.body || 'تنبيه', cover: null, system: true };
    }
  }
  function timeAgo(ms) {
    const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
    if (minutes < 1) return 'الآن';
    if (minutes < 60) return minutes === 1 ? 'قبل دقيقة' : minutes === 2 ? 'قبل دقيقتين' : `قبل ${minutes} ${minutes <= 10 ? 'دقائق' : 'دقيقة'}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? 'قبل ساعة' : hours === 2 ? 'قبل ساعتين' : `قبل ${hours} ${hours <= 10 ? 'ساعات' : 'ساعة'}`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'أمس';
    if (days < 7) return days === 2 ? 'قبل يومين' : `قبل ${days} أيام`;
    return new Date(ms).toLocaleDateString('ar', { day: 'numeric', month: 'long', numberingSystem: 'latn' });
  }
  function notificationRow(row) {
    const copy = notificationCopy(row);
    // جديدُ هذه الزيارة يبقى مميّزًا حتى تغادر، ولو صار مقروءًا في الخادم
    if (!row.read) (state.notifFresh ??= new Set()).add(row.id);
    const fresh = !row.read || state.notifFresh?.has(row.id);
    const b = el('button', `notif${fresh ? ' notif--unread' : ''}`);
    b.type = 'button';
    const face = el('span', 'notif-face');
    face.append(copy.system ? everyoneFace(44) : avatarNode(personOf(row.actor_id), 44));
    const badge = el('span', `notif-kind notif-kind--${(row.kind || '').toLowerCase()}`);
    badge.innerHTML = glyph(KIND_ICON[row.kind] ?? 'bell', { size: 12 });
    face.append(badge);
    const text = el('span', 'notif-text');
    const line = el('span', 'notif-line');
    // الاسم والعنوان معزولان: عنوان لاتيني لا يبتلع ما بعده في سطر عربي
    if (!copy.system) line.append(el('bdi', 'notif-name', nameOf(row.actor_id)), document.createTextNode(' '));
    line.append(document.createTextNode(copy.text));
    if (copy.title) line.append(document.createTextNode(' '), el('bdi', 'notif-title', copy.title));
    text.append(line, el('time', null, timeAgo(row.created_at ?? Date.now())));
    b.append(face, text);
    if (copy.cover) {
      const c = el('span', 'notif-cover');
      const img = el('img');
      img.src = copy.cover;
      img.alt = '';
      img.onerror = () => c.remove();
      c.append(img);
      b.append(c);
    }
    b.onclick = () => {
      if (!row.read) sync.enqueue('notification.read', { id: row.id });
      copy.open?.();
    };
    return b;
  }
  function renderNotifications() {
    const body = q('notificationsBody');
    const rows = sync
      .rows('notifications', (r) => r.user_id === me())
      .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    root.querySelector('[data-act="readAllNotifications"]').hidden = !rows.some((r) => !r.read);
    if (!rows.length) {
      emptyState(body, { icon: 'bell', title: 'ما فيه إشعارات', text: 'لما يرسل لك صديق فريمًا أو يرشّح لك عملًا، يوصلك هنا.' });
      return;
    }
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const groups = [
      ['اليوم', (t) => t >= startOfDay],
      ['هذا الأسبوع', (t) => t < startOfDay && t >= startOfDay - 6 * 86_400_000],
      ['أقدم', (t) => t < startOfDay - 6 * 86_400_000],
    ];
    const parts = [];
    for (const [label, test] of groups) {
      const inGroup = rows.filter((r) => test(r.created_at ?? 0));
      if (!inGroup.length) continue;
      parts.push(el('div', 'settings-group-label', label));
      const list = el('div', 'notif-list');
      list.append(...inGroup.map(notificationRow));
      parts.push(list);
    }
    body.replaceChildren(...parts);
    // رأيتها في القائمة = قرأتها: النقطة تختفي الآن وعلى كل أجهزتك، والجديد
    // يبقى مميّزًا في هذه الزيارة وحدها لتعرف ما وصل
    clearTimeout(state.notifReadTimer);
    state.notifReadTimer = setTimeout(() => {
      if (currentPage() !== 'notifications') return;
      for (const r of rows) if (!r.read) sync.enqueue('notification.read', { id: r.id });
    }, 900);
  }
  function readAllNotifications() {
    for (const r of sync.rows('notifications', (x) => x.user_id === me() && !x.read)) sync.enqueue('notification.read', { id: r.id });
    toast('علّمتها كلها مقروءة');
    setTimeout(renderNotifications, 400);
  }

  // ───────────────────────── الدرج والتنقّل ─────────────────────────

  const unreadNotifications = () => sync.rows('notifications', (r) => r.user_id === me() && !r.read).length;
  function buildDrawer() {
    const profile = sync.rows('profiles', (p) => p.user_id === me())[0];
    const who = q('drawerMe');
    const name = profile?.display_name || sync.user?.displayName || sync.user?.username || 'حسابي';
    const texts = el('div');
    texts.append(el('strong', null, name), el('small', null, 'ملفّك الشخصي'));
    who.replaceChildren(avatarNode({ avatarKey: profile?.avatar_key, displayName: name }), texts);
    who.insertAdjacentHTML('beforeend', glyph('chevron'));
    who.setAttribute('aria-label', `ملفّك: ${name}`);
    q('drawerVersion').textContent = deps.version ? `VANTARA ${deps.version}` : 'VANTARA';

    const unread = unreadNotifications();
    const here = currentPage();
    q('drawerContent').replaceChildren(
      ...drawerGroups.map(([label, items]) => {
        const g = el('div', 'drawer-group');
        if (label) g.append(el('div', 'drawer-label', label));
        for (const [text, key, ic] of items) {
          const b = el('button', 'drawer-item');
          b.type = 'button';
          b.innerHTML = glyph(ic);
          b.append(el('span', null, text));
          if (key === 'notifications' && unread) b.append(el('span', 'badge', unread > 99 ? '99+' : String(unread)));
          if (key === here) {
            b.classList.add('active');
            b.setAttribute('aria-current', 'page');
          }
          b.onclick = () => drawerNavigate(key);
          g.append(b);
        }
        return g;
      }),
    );
  }
  function openDrawer() {
    buildDrawer();
    q('drawerBackdrop').classList.add('open');
  }
  function closeDrawer() {
    if (!q('drawerBackdrop').classList.contains('open')) return false;
    q('drawerBackdrop').classList.remove('open');
    return true;
  }
  function drawerNavigate(key) {
    closeDrawer();
    if (['home', 'library', 'discover', 'settings', 'majlis'].includes(key)) return navTo(key);
    if (key === 'favorites' || key === 'later') {
      state.libraryFilter = key === 'favorites' ? 'favorite' : 'later';
      return navTo('library');
    }
    if (key === 'switchAccount') return confirmSwitchAccount();
    if (key === 'notifications') return showPage('notifications');
    if (key === 'profile') return openProfile(me());
    // التوصيات والنشاط صارا في المجلس نفسه: لا شاشة قديمة موازية
    if (key === 'recommendations') return openMajlis('recs');
    if (key === 'activity' || key === 'friends') return openMajlis();
  }
  function confirmSwitchAccount() {
    openSheet((body) => {
      body.append(el('h3', null, 'تبديل الحساب؟'));
      body.append(el('p', null, 'ترجع لشاشة «من يتابع؟». قراءتك محفوظة في حسابك.'));
      const row = el('div', 'sheet-actions');
      const cancel = el('button', 'btn btn-secondary', 'إلغاء');
      cancel.type = 'button';
      cancel.onclick = () => closeSheet();
      const ok = el('button', 'btn btn-primary', 'بدّل');
      ok.type = 'button';
      ok.onclick = () => {
        closeSheet();
        deps.switchAccount();
      };
      row.append(cancel, ok);
      body.append(row);
    });
  }

  const MAIN_PAGES = ['home', 'library', 'discover', 'majlis'];
  const currentPage = () => root.querySelector('.page.active')?.id ?? 'home';
  function showPage(id, { push = true } = {}) {
    const from = currentPage();
    if (MAIN_PAGES.includes(id)) state.stack = [];
    else if (push && from !== id) state.stack.push(from);
    root.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === id));
    q('bottomNav').hidden = !MAIN_PAGES.includes(id);
    root.querySelectorAll('.nav').forEach((n) => {
      const on = n.dataset.page === id;
      n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    });
    q('detailTop').classList.remove('scrolled');
    if (id === 'library') renderLibrary();
    if (id === 'discover' && !state.catalog.length) void loadMoreDiscover();
    if (id === 'settings') renderSettings();
    if (id === 'notifications') renderNotifications();
    if (from === 'notifications' && id !== 'notifications') state.notifFresh = null;
    if (id === 'majlis') {
      majlis.show();
      // وصلتَ للمجلس = رأيت التفاعلات على رسائلك فيه
      for (const n of sync.rows('notifications', (x) => x.user_id === me() && !x.read && x.kind === 'REACTION' && String(x.link ?? '').startsWith('vantara://majlis/'))) {
        sync.enqueue('notification.read', { id: n.id });
      }
    } else majlis.hide();
    if (id !== 'profile') profile?.hide();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function navTo(id) {
    showPage(id === 'friends' ? 'majlis' : id);
  }
  function openMajlis(only) {
    showPage('majlis');
    if (only) majlis.show(only);
  }
  /** رجوع داخل الواجهة. يرجع `false` إن لم يبقَ شيء يُرجَع إليه. */
  function goBack() {
    const prev = state.stack.pop();
    if (prev) {
      showPage(prev, { push: false });
      if (prev === 'detail' && state.current?._chapters) renderChapters(state.current);
      return true;
    }
    if (currentPage() !== 'home') {
      showPage('home');
      return true;
    }
    return false;
  }

  // الإعدادات لكل واحد من العيال: ما يفهمه أي أحد فوق، والتقني تحت «النظام»
  // مطويًّا، وما قد يفصل التطبيق عن الخادم في «منطقة الخطر» بتأكيد صريح.
  // الشاشة القديمة تبقى لحالة واحدة: لا حساب بعد (أول إقلاع)، ولا واجهة أصلًا.
  let systemOpen = false;
  function renderSettings() {
    const body = q('settingsBody');
    body.replaceChildren();
    const api = deps.settings;
    const group = (label, rows, { note, cls } = {}) => {
      if (label) body.append(el('div', `settings-group-label${cls ? ` ${cls}-label` : ''}`, label));
      const list = el('div', `settings-list${cls ? ` ${cls}` : ''}`);
      list.append(...rows.filter(Boolean));
      body.append(list);
      if (note) body.append(el('p', 'settings-note', note));
      return list;
    };
    const row = (icon, title, sub, { value, run, tone, danger } = {}) => {
      const d = el(run ? 'button' : 'div', `setting${danger ? ' setting--danger' : ''}`);
      if (run) {
        d.type = 'button';
        d.onclick = run;
      }
      d.innerHTML = glyph(icon);
      const t = el('div');
      t.append(el('strong', null, title));
      if (sub) t.append(el('small', null, sub));
      d.append(t);
      if (value) {
        const v = el('span', `value${tone ? ` value--${tone}` : ''}`, value);
        v.dir = 'auto';
        d.append(v);
      }
      if (run) d.insertAdjacentHTML('beforeend', glyph('chevron', { cls: 'icon chev' }));
      return d;
    };
    const toggle = (icon, title, sub, checked, onChange) => {
      const d = el('label', 'setting');
      d.innerHTML = glyph(icon);
      const t = el('div');
      t.append(el('strong', null, title));
      if (sub) t.append(el('small', null, sub));
      const input = el('input');
      input.type = 'checkbox';
      input.className = 'switch-input';
      input.setAttribute('role', 'switch');
      input.checked = checked;
      input.onchange = () => onChange(input.checked);
      d.append(t, input);
      return d;
    };

    group('حسابك', [
      row('user', 'ملفّك الشخصي', 'اسمك وصورتك والبانر', { run: () => openProfile(me()) }),
      row('switchUser', 'تبديل الحساب', null, { value: sync.user?.username ? `@${sync.user.username}` : null, run: confirmSwitchAccount }),
    ]);

    if (api) {
      const popups = api.popups();
      const on = Object.keys(api.labels).filter((k) => popups.kinds[k] !== false).length;
      group(
        'التنبيهات',
        [
          toggle('bell', 'التنبيهات المنبثقة', 'تطلع فوق الشاشة لما يرسل لك أحد فريم أو ترشيح', popups.enabled, (enabled) => {
            api.setPopups({ ...api.popups(), enabled });
            renderSettings();
          }),
          popups.enabled
            ? row('sliders', 'وش يطلع لك', null, { value: on === Object.keys(api.labels).length ? 'الكل' : `${on} من ${Object.keys(api.labels).length}`, run: openPopupKinds })
            : null,
        ],
        { note: 'الإطفاء يوقف التنبيه المنبثق بس. إشعاراتك تبقى في صفحتها.' },
      );
      group('المساعدة', [row('flag', 'بلّغ عن مشكلة', 'صار شي غلط؟ قل لنا وش صار', { run: () => openProblemSheet() })]);
    }

    group('عن التطبيق', [
      row('layers', 'المصادر', 'مصادر عربية تشتغل على جهازك', { value: 'عربي' }),
      row('info', 'الإصدار', null, { value: deps.version || '—' }),
    ]);

    if (!api) return;
    // ── النظام: مطويّ. من يفتحه يعرف أنه دخل مكانًا تقنيًّا ──
    const toggleSystem = el('button', `system-toggle${systemOpen ? ' open' : ''}`);
    toggleSystem.type = 'button';
    toggleSystem.setAttribute('aria-expanded', String(systemOpen));
    toggleSystem.innerHTML = `${glyph('settings')}<span><strong>النظام</strong><small>للمسؤول فقط: المزامنة والخادم</small></span>${glyph('chevron', { cls: 'icon chev' })}`;
    toggleSystem.onclick = () => {
      systemOpen = !systemOpen;
      renderSettings();
      if (systemOpen) q('settingsBody').querySelector('.system-toggle')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    body.append(toggleSystem);
    if (!systemOpen) return;

    const health = api.health();
    const bad = health.state !== 'ok' && health.state !== 'syncing';
    group('', [
      row('refresh', 'حالة المزامنة', health.lastSyncAt ? `آخر مرة ${api.ago(health.lastSyncAt)}` : null, { value: health.message, tone: bad ? 'warn' : 'ok' }),
      row('send', 'زامن الآن', 'آمن: يرسل ويجيب آخر التغييرات', {
        run: async () => {
          toast('جارٍ المزامنة…');
          await api.syncNow().catch(() => {});
          toast('تمّت المزامنة');
          renderSettings();
        },
      }),
    ]);

    group(
      'منطقة الخطر',
      [
        row('server', 'عنوان الخادم', 'غلط فيه يفصل التطبيق عن حساباتكم', { value: hostOf(api.endpoints().sync), danger: true, run: () => confirmDanger('serverUrl') }),
        row('layers', 'أعد بناء البيانات المحلية', 'يمسح ما على الجهاز ويجيبه من الخادم من جديد', { danger: true, run: () => confirmDanger('rebuild') }),
        health.quarantined
          ? row('alert', 'عمليات رفضها الخادم', null, { value: String(health.quarantined), danger: true, run: () => confirmDanger('retry') })
          : null,
      ],
      { cls: 'danger-zone', note: 'لا تلمس شي هنا إلا إذا طُلب منك. كل خيار يسألك قبل ما يسوي شي.' },
    );
  }

  function openPopupKinds() {
    const api = deps.settings;
    openSheet((body) => {
      body.append(el('h3', null, 'وش يطلع لك'));
      const list = el('div', 'settings-list');
      list.style.marginTop = '12px';
      for (const [kind, label] of Object.entries(api.labels)) {
        const d = el('label', 'setting');
        d.innerHTML = glyph(KIND_ICON[kind] ?? 'bell');
        const t = el('div');
        t.append(el('strong', null, label));
        const input = el('input');
        input.type = 'checkbox';
        input.className = 'switch-input';
        input.setAttribute('role', 'switch');
        input.checked = api.popups().kinds[kind] !== false;
        input.onchange = () => {
          const cur = api.popups();
          api.setPopups({ ...cur, kinds: { ...cur.kinds, [kind]: input.checked } });
        };
        d.append(t, input);
        list.append(d);
      }
      body.append(list);
      return () => renderSettings();
    });
  }

  /** كل ما في منطقة الخطر يمرّ بسؤال واحد واضح قبل أن يفعل شيئًا. */
  function confirmDanger(what) {
    const api = deps.settings;
    const copy = {
      serverUrl: ['تغيّر عنوان الخادم؟', 'لو كتبت عنوانًا غلط ينفصل التطبيق عن حساباتكم ومزامنتكم. غيّره بس إذا طُلب منك.', 'أبغى أغيّره', () => openServerSheet()],
      rebuild: ['تعيد بناء البيانات؟', 'يمسح النسخة اللي على جهازك ويجيب كل شي من الخادم من جديد. تحتاج اتصال، وتاخذ دقيقة.', 'أعد البناء', async () => {
        toast('جارٍ إعادة البناء…');
        await api.resync().catch(() => {});
        toast('خلصت');
        renderSettings();
      }],
      retry: ['تعيد محاولة المرفوض؟', 'يرجع العمليات اللي رفضها الخادم للطابور ويحاول يرسلها مرة ثانية.', 'أعد المحاولة', () => {
        const n = api.retryQuarantined();
        toast(`أُعيدت ${countLabel(n, 'op')} للطابور`);
        renderSettings();
      }],
    }[what];
    const [title, text, label, run] = copy;
    openSheet((body) => {
      body.append(el('h3', null, title), el('p', null, text));
      const actions = el('div', 'sheet-actions');
      const cancel = el('button', 'btn btn-secondary', 'لا، خلّه');
      cancel.type = 'button';
      cancel.onclick = () => closeSheet();
      const go = el('button', 'btn btn-danger', label);
      go.type = 'button';
      go.onclick = () => {
        closeSheet();
        void run();
      };
      actions.append(cancel, go);
      body.append(actions);
    });
  }

  function hostOf(url) {
    if (!url) return 'غير مضبوط';
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }
  function openServerSheet() {
    const api = deps.settings;
    const ep = api.endpoints();
    openSheet((body) => {
      body.append(el('h3', null, 'عناوين الخادم'));
      body.append(el('p', null, 'التطبيق يُعاد تشغيله بعد الحفظ: العناوين تُقرأ عند الإقلاع.'));
      const field = (label, value) => {
        const wrap = el('label', 'field');
        wrap.append(el('span', 'field-label', label));
        const input = el('input', 'field-input');
        input.value = value ?? '';
        input.placeholder = 'https://…';
        input.dir = 'ltr';
        input.inputMode = 'url';
        input.autocomplete = 'off';
        wrap.append(input);
        body.append(wrap);
        return input;
      };
      const syncInput = field('خادم المزامنة (Cloudflare)', ep.sync);
      const apiInput = field('خادم المحتوى', ep.api);
      const save = el('button', 'btn btn-primary btn-block', 'احفظ وأعد التشغيل');
      save.type = 'button';
      const status = el('p', 'settings-note');
      save.onclick = async () => {
        const valid = (v) => !v || /^https:\/\/[^\s]+$/i.test(v);
        const next = { sync: syncInput.value.trim().replace(/\/+$/, ''), api: apiInput.value.trim().replace(/\/+$/, '') };
        if (!next.sync) return void (status.textContent = 'عنوان خادم المزامنة مطلوب.');
        if (!valid(next.sync) || !valid(next.api)) return void (status.textContent = 'العنوان لازم يبدأ بـ https://');
        // لا يُحفظ عنوان لا يردّ: غلطة كتابة واحدة كانت تفصل الجهاز عن حساباته
        save.disabled = true;
        save.textContent = 'نتأكد من الخادم…';
        const reachable = async (url, path, check) => {
          try {
            const r = await fetch(`${url}${path}`, { cache: 'no-store' });
            return r.ok && check(await r.json().catch(() => null));
          } catch {
            return false;
          }
        };
        const syncOk = await reachable(next.sync, '/health', (j) => j?.ok === true);
        // خادم المحتوى قد لا يرسل CORS لهذا المسار: يكفي أنه يردّ أصلًا
        const apiOk = !next.api || (await fetch(`${next.api}/healthz`, { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false));
        if (!syncOk || !apiOk) {
          save.disabled = false;
          save.textContent = 'احفظ وأعد التشغيل';
          status.textContent = !syncOk ? 'خادم المزامنة ما ردّ. ما حفظنا شي، والعنوان القديم باقي.' : 'خادم المحتوى ما ردّ. ما حفظنا شي.';
          return;
        }
        api.setEndpoints(next);
        save.textContent = 'حُفظ. جارٍ إعادة التشغيل…';
        setTimeout(() => window.location.reload(), 400);
      };
      body.append(save, status);
    });
  }

  function openProblemSheet() {
    const api = deps.settings;
    openSheet((body) => {
      body.append(el('h3', null, 'بلّغ عن مشكلة'));
      body.append(el('p', null, 'اختر نوعها واكتب اللي صار إن حبيت.'));
      let kind = api.reportKinds[0]?.[0];
      const chips = el('div', 'report-kinds');
      for (const [value, label] of api.reportKinds) {
        const c = el('button', 'chip-btn', label);
        c.type = 'button';
        c.setAttribute('aria-pressed', String(value === kind));
        c.onclick = () => {
          kind = value;
          chips.querySelectorAll('.chip-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
        };
        chips.append(c);
      }
      const note = el('textarea', 'search-input share-note');
      note.rows = 3;
      note.maxLength = 2000;
      note.placeholder = 'وش صار؟ (اختياري)';
      const send = el('button', 'btn btn-primary btn-block', 'أرسل البلاغ');
      send.type = 'button';
      send.onclick = async () => {
        send.disabled = true;
        send.textContent = 'جارٍ الإرسال…';
        try {
          await api.reportProblem(kind, note.value.trim());
          closeSheet();
          toast('وصل البلاغ، شكرًا');
        } catch (error) {
          send.disabled = false;
          send.textContent = 'أرسل البلاغ';
          toast(error?.status === 0 ? 'تعذّر الإرسال. حاول بعد شوي.' : 'تعذّر الإرسال. خادم المحتوى غير متاح.');
        }
      };
      body.append(chips, note, send);
    });
  }

  function paintNotifyDots() {
    const unread = unreadNotifications();
    root.querySelectorAll('.notify-dot').forEach((d) => (d.hidden = unread === 0));
    root.querySelectorAll('.has-dot').forEach((b) => b.setAttribute('aria-label', unread ? `الإشعارات، ${countLabel(unread, 'new')}` : 'الإشعارات'));
  }

  // ───────────────────────── الأفعال المفوَّضة ─────────────────────────

  const actions = {
    backFromDetail: () => goBack(),
    goBack: () => goBack(),
    closeDrawer,
    drawerBackdropClick: (e) => {
      if (e.target === q('drawerBackdrop')) closeDrawer();
    },
    drawerNavigate: (_e, t) => drawerNavigate(t.dataset.arg),
    sheetBackdrop: (e) => {
      if (e.target === q('sheet')) closeSheet();
    },
    loadMoreCollection: () => void loadMoreCollection(),
    loadMoreDiscover: () => void loadMoreDiscover(),
    clearDiscoverSearch,
    clearSearch,
    navTo: (_e, t) => navTo(t.dataset.arg),
    openCategories,
    openCollection: (_e, t) => void openCollection(t.dataset.arg),
    openDrawer,
    openSearch,
    openUtility: (_e, t) => void deps.go({ name: t.dataset.arg }),
    openWorkMenu,
    shareCurrent: () => state.current && openShare(state.current),
    readNow,
    flipChapterOrder,
    toggleSummary,
    toggleFavoriteCurrent,
    toggleLibraryCurrent,
    readAllNotifications,
  };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    const run = actions[t.dataset.act];
    if (run) run(e, t);
  });
  root.addEventListener('input', (e) => {
    const t = e.target.closest('[data-input]');
    if (t?.dataset.input === 'debouncedSearch') debouncedSearch(t.value);
    if (t?.dataset.input === 'discoverSearch') discoverSearch(t.value);
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    // «بحث» في لوحة المفاتيح يخفيها: النتائج تحتها لا فوقها
    e.target.querySelector('input')?.blur();
  });
  root.addEventListener('change', (e) => {
    if (e.target.closest('[data-change="renderLibrary"]')) renderLibrary();
  });

  // ترويسة صفحة العمل تكتسي خلفية عند التمرير، وعنوان العمل يظهر فيها
  const onScroll = () => {
    if (currentPage() === 'detail') q('detailTop').classList.toggle('scrolled', window.scrollY > 170);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  const onKey = (e) => {
    if (e.key === 'Escape') handleBack();
  };
  document.addEventListener('keydown', onKey);
  const unsubscribe = sync.onChange?.((tables) => {
    if (tables.includes('work_views') || tables.includes('progress')) {
      if (currentPage() === 'library' && state.libraryFilter === 'history') renderLibrary();
      else if (currentPage() === 'home' && tables.includes('work_views')) renderHome();
    }
    if (tables.some((t) => ['library', 'collections'].includes(t))) {
      refreshLibraryDetail();
      if (currentPage() === 'home') renderHome();
      if (currentPage() === 'library') renderLibrary();
    }
    if (tables.includes('ratings')) {
      pendingRating = null;
      renderRating();
    }
    if (tables.includes('chapter_marks') && currentPage() === 'detail' && state.current?._chapters) renderChapters(state.current);
    majlis.onChange(tables, { visible: currentPage() === 'majlis' });
    profile.onChange(tables);
    if (tables.includes('notifications')) {
      paintNotifyDots();
      if (currentPage() === 'notifications') renderNotifications();
    }
  });

  /** زرّ الرجوع (أندرويد وEsc): الورقة ثم الدرج ثم الصفحة السابقة. */
  function handleBack() {
    if (editor?.open) return editor.handleBack();
    return majlis.closeBar() || closeSheet() || closeDrawer() || goBack();
  }

  const majlis = createMajlis({
    sync,
    host: q('majlisBody'),
    presence: () => deps.presence?.() ?? Promise.resolve([]),
    avatarNode,
    mountImage,
    workFromRef,
    openWork: (w) => void openWork(w),
    preview: (w, opts) => previewWork(w, opts),
    openFrame: (id) => void deps.go({ name: 'frame', id }),
    openProfile: (userId) => openProfile(userId),
    openShare: () => navTo('discover'),
    pageImage: available() ? deps.pageImage : null,
  });
  // ما وصل هذا الجهاز قبل فتح الشاشة: المرسل يرى «وصله» الآن لا عند أول مجلس
  setTimeout(() => {
    majlis.acknowledgeDelivered();
    migrateLocalHistory();
  }, 0);

  const profile = createProfile({
    sync,
    host: q('profileBody'),
    presence: () => deps.presence?.() ?? Promise.resolve([]),
    avatarNode,
    mountImage,
    workFromRef,
    openWork: (w) => previewWork(w),
    openSheet,
    back: () => goBack(),
    edit: () => editProfile(),
    libraryWorks,
  });
  let editor = null;
  function editProfile() {
    if (editor?.open) return;
    editor = openProfileEditor({
      sync,
      profile: profile.editable(),
      openSheet,
      closeSheet,
      toast,
      onSaved: (fields) => profile.applyLocal(fields),
      onClose: () => {
        editor = null;
      },
    });
  }
  function openProfile(userId = me()) {
    showPage('profile');
    void profile.show(userId);
  }

  paintNotifyDots();
  void loadHome();
  showPage(page);

  // الرجوع من القارئ أو الأصدقاء يعيد الصفحة كما تُركت، بتمريرها
  let savedScroll = 0;
  return {
    root,
    showPage,
    openWork,
    /** عمل من مرجعه وحده (إشعار، رابط): صفحته في الواجهة لا الشاشة القديمة. */
    openRef: (ref, title, cover) => void openWork(workFromRef(ref, title, cover)),
    openMajlis,
    openProfile,
    handleBack,
    pause() {
      savedScroll = window.scrollY;
      majlis.hide();
      clearInterval(state.heroTimer);
      closeDrawer();
      closeSheet();
    },
    resume(target) {
      const current = currentPage();
      if (target && target !== current && target !== 'detail') {
        showPage(target);
      } else {
        if (current === 'detail' && state.current?._chapters) renderChapters(state.current);
        paintNotifyDots();
        requestAnimationFrame(() => window.scrollTo({ top: savedScroll, behavior: 'instant' }));
      }
      if (state.heroItems.length) restartHero();
      if (currentPage() === 'majlis') majlis.show();
    },
    destroy() {
      majlis.hide();
      clearInterval(state.heroTimer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
      unsubscribe?.();
    },
  };
}

export { seriesRefOf };
