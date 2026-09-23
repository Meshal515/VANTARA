/**
 * واجهة VANTARA بتصميم v35 — نفس الصفحات والأصناف والحركة.
 *
 * منطق العرض منقولٌ من ملف v35 كما هو (البانر الدائري، الشرائط، صفحة العمل،
 * المكتبة، الاستكشاف، الدرج). ما تغيّر هو مصدر الحقيقة وحده:
 *
 *   - الأعمال من مصادرنا الست عشرة عبر المحرّك (`works.js`)، لا AniList.
 *   - المكتبة والمفضلة و«أقرأ لاحقًا» والتقييم في حسابك عبر المزامنة، لا
 *     في localStorage — فتظهر على أجهزتك كلها ويراها أصدقاؤك.
 *
 * والشاشات التي لم تُنقل بعد (الأصدقاء، الإشعارات، ملفي…) تُفتح من هنا عبر
 * `deps.go` كما كانت.
 */

import { SHELL_HTML } from './markup.js';
import { available, browse, detail, seriesRefOf } from './works.js';
import { chapterKeyOf, isChapterRead, markChapter } from './reading.js';

const LOGO = '/icons/icon-512.png';
const AR_GENRE = { Action: 'أكشن', Adventure: 'مغامرة', Fantasy: 'فانتازيا', Drama: 'دراما', Comedy: 'كوميديا', Romance: 'رومانسي', Supernatural: 'قوى خارقة', 'Sci-Fi': 'خيال علمي', Mystery: 'غموض', Thriller: 'إثارة', Horror: 'رعب', Sports: 'رياضة', Psychological: 'نفسي', Mecha: 'ميكا', Music: 'موسيقى' };
const STATUS_AR = { FINISHED: 'مكتمل', RELEASING: 'مستمر', HIATUS: 'متوقف مؤقتًا', CANCELLED: 'ملغي', NOT_YET_RELEASED: 'لم يبدأ' };
const GENRES = ['أكشن', 'مغامرة', 'كوميديا', 'دراما', 'فانتازيا', 'رعب', 'غموض', 'نفسي', 'رومانسي', 'خيال علمي', 'رياضة', 'قوى خارقة', 'إثارة'];

const drawerGroups = [
  ['الأساسي', [['الرئيسية', 'home', 'home'], ['مكتبتي', 'library', 'bookmark'], ['استكشف', 'discover', 'compass']]],
  ['الاجتماعي', [['الأصدقاء', 'friends', 'users'], ['النشاط', 'activity', 'activity'], ['الإشعارات', 'notifications', 'bell'], ['التوصيات', 'recommendations', 'spark']]],
  ['مكتبتي', [['المفضلة', 'favorites', 'heart'], ['أقرأ لاحقًا', 'later', 'clock']]],
  ['الحساب', [['ملفي', 'profile', 'user'], ['تغيير الحساب', 'switchAccount', 'switch']]],
  ['النظام', [['الإعدادات', 'settings', 'settings'], ['إعدادات الخادم', 'server', 'settings']]],
];
const SVG_ICONS = {
  home: '<path d="m12 3 8 7v10a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1V10Z"/>',
  bookmark: '<path d="M6 3.5h12v17L12 17l-6 3.5Z"/>',
  compass: '<circle cx="12" cy="12" r="8"/><path d="m14.7 9.3-1.6 3.8-3.8 1.6 1.6-3.8Z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.8 19c.5-3.3 2.2-5 5.2-5s4.7 1.7 5.2 5"/><path d="M16 6a3 3 0 0 1 0 5.8M16.5 14c2.2.4 3.5 2 3.8 4.5"/>',
  activity: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  bell: '<path d="M6 10a6 6 0 0 1 12 0c0 4.5 2 5.5 2 5.5H4S6 14.5 6 10Z"/><path d="M9.5 19a2.8 2.8 0 0 0 5 0"/>',
  spark: '<path d="m12 3 2.2 4.7L19 10l-4.8 2.3L12 17l-2.2-4.7L5 10l4.8-2.3Z"/>',
  heart: '<path d="M20.6 5.1a5.1 5.1 0 0 0-7.2 0L12 6.5l-1.4-1.4a5.1 5.1 0 0 0-7.2 7.2L12 20.7l8.6-8.4a5.1 5.1 0 0 0 0-7.2Z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="3.3"/><path d="M5.8 20c.5-4 2.6-6 6.2-6s5.7 2 6.2 6"/>',
  switch: '<path d="M6 7h12l-2.5-2.5M18 7l-2.5 2.5M18 17H6l2.5 2.5M6 17l2.5-2.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 14.7a1.7 1.7 0 0 0 .4 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.4A1.7 1.7 0 0 0 14 20.6V21h-4v-.4A1.7 1.7 0 0 0 9 19a1.7 1.7 0 0 0-1.9.4l-.1.1-2.8-2.8.1-.1a1.7 1.7 0 0 0 .4-1.9A1.7 1.7 0 0 0 3.1 14H3v-4h.1A1.7 1.7 0 0 0 4.7 9a1.7 1.7 0 0 0-.4-1.9l-.1-.1L7 4.2l.1.1A1.7 1.7 0 0 0 9 4.7 1.7 1.7 0 0 0 10 3.1V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.4l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.4 1.9 1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.9.7Z"/>',
};
const EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>';
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.2 4L19 7"/></svg>';
const iconSvg = (k) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SVG_ICONS[k] || SVG_ICONS.spark}</svg>`;

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

const clean = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const safe = (v, f = '—') => (v === null || v === undefined || v === '' ? f : String(v));
const titleOf = (w) => w?.title?.english || w?.title?.romaji || w?.title || 'بدون عنوان';
const unique = (arr) => [...new Set(arr.filter(Boolean))];
const uniqueById = (items) => {
  const seen = new Set();
  return items.filter((x) => x && x.id && !seen.has(x.id) && seen.add(x.id));
};
const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

/**
 * @param {{ sync: any, mount: (node: Element) => void, go: (route: object) => Promise<void>,
 *           openReader: (route: object) => void, switchAccount: () => void, version: string }} deps
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
    previousPage: 'home',
    catalog: [],
    catalogPage: 0,
    catalogHasNext: true,
    collection: { kind: 'trending', page: 0, hasNext: true, items: [] },
    searchTimer: null,
    heroItems: [],
    heroPhysicalIndex: 1,
    heroTimer: null,
    heroStartX: 0,
    heroDeltaX: 0,
    heroDragging: false,
    libraryFilter: 'all',
    pendingRating: 0,
  };

  function toast(msg) {
    const t = q('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._x);
    t._x = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ───────────────────────── الأعمال المحفوظة ─────────────────────────
  // المزامنة تحفظ عنوان العمل وغلافه؛ ونُسخه (أي مصدر يحمله) تُحفظ هنا ليُفتح
  // العمل من المكتبة بلا بحث جديد.

  function rememberWork(w) {
    const all = readJson(WORKS_KEY, {});
    all[w.id] = { key: w._work.key, title: w._work.title, thumbnailUrl: w._work.thumbnailUrl, editions: w._work.editions };
    writeJson(WORKS_KEY, all);
  }
  function workFromRef(ref, fallbackTitle, cover) {
    const saved = readJson(WORKS_KEY, {})[ref];
    const base = saved ?? { key: ref.replace(/^ext:/, ''), title: fallbackTitle ?? ref, thumbnailUrl: cover ?? null, editions: [] };
    return {
      id: ref,
      title: { english: base.title },
      synonyms: [],
      genres: [],
      coverImage: { large: base.thumbnailUrl, extraLarge: base.thumbnailUrl },
      bannerImage: base.thumbnailUrl,
      staff: { edges: [] },
      averageScore: null,
      _work: base,
    };
  }

  const me = () => sync.user?.userId;
  const libraryRows = () => sync.rows('library', (r) => r.user_id === me() && !r.removed);
  const inCollection = (kind, ref) =>
    sync.rows('collections', (r) => r.user_id === me() && r.kind === kind && r.series_ref === ref && r.member)
      .length > 0;
  function libraryEntry(ref) {
    const row = libraryRows().find((r) => r.series_ref === ref);
    const later = inCollection('read_later', ref);
    const favorite = inCollection('favorite', ref);
    if (!row && !later && !favorite) return null;
    return { row, state: later ? 'later' : row ? 'reading' : null, favorite, addedAt: row?.added_at ?? 0 };
  }
  function libraryWorks(filter = 'all') {
    const refs = new Set([
      ...libraryRows().map((r) => r.series_ref),
      ...sync.rows('collections', (r) => r.user_id === me() && r.member).map((r) => r.series_ref),
    ]);
    return [...refs]
      .map((ref) => {
        const row = libraryRows().find((r) => r.series_ref === ref);
        const work = sync.rows('works', (w) => w.series_ref === ref)[0];
        return { ref, entry: libraryEntry(ref), work: workFromRef(ref, row?.series_title ?? work?.title, row?.cover_url ?? work?.cover_url) };
      })
      .filter(({ entry }) => {
        if (!entry) return false;
        if (filter === 'reading') return entry.state === 'reading';
        if (filter === 'later') return entry.state === 'later';
        if (filter === 'favorite') return entry.favorite;
        if (filter === 'completed') return false;
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

  function getHistory() {
    return readJson(HISTORY_KEY, []);
  }
  function pushHistory(w) {
    const mini = { ref: String(w.id), title: titleOf(w), cover: w.coverImage?.large ?? null };
    writeJson(HISTORY_KEY, [mini, ...getHistory().filter((x) => x.ref !== mini.ref)].slice(0, 100));
  }
  const historyWorks = () => getHistory().map((h) => workFromRef(h.ref, h.title, h.cover));

  // ───────────────────────── الصور والبطاقات (v35) ─────────────────────────

  function fallbackArt(container, label = 'VANTARA') {
    container.innerHTML = '';
    const d = el('div', 'image-fallback');
    const img = new Image();
    img.src = LOGO;
    img.alt = 'VANTARA';
    const s = el('span');
    s.textContent = label;
    d.append(img, s);
    container.appendChild(d);
  }
  async function mountImage(container, work, kind = 'cover', opts = {}) {
    const token = String(Date.now()) + Math.random();
    container.dataset.imageToken = token;
    container.innerHTML = '<div class="skeleton"></div>';
    const urls =
      kind === 'banner'
        ? unique([work.bannerImage, work.coverImage?.extraLarge, work.coverImage?.large])
        : unique([work.coverImage?.extraLarge, work.coverImage?.large, work.bannerImage]);
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
        img.alt = titleOf(work);
        img.decoding = 'async';
        img.loading = 'eager';
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = url;
      });
    for (const url of urls) {
      const img = await tryUrl(url, kind === 'banner' ? 4000 : 6000);
      if (img && container.dataset.imageToken === token) {
        container.innerHTML = '';
        if (opts.position) img.style.objectPosition = opts.position;
        container.appendChild(img);
        return;
      }
    }
    if (container.dataset.imageToken === token) fallbackArt(container);
  }

  function card(work) {
    const a = el('article', 'work-card');
    const p = el('div', 'poster');
    const t = el('div', 'work-title');
    const m = el('div', 'work-meta');
    t.textContent = titleOf(work);
    m.textContent = [work.averageScore ? `${work.averageScore}%` : null, STATUS_AR[work.status]].filter(Boolean).join(' · ');
    mountImage(p, work, 'cover', { eager: true });
    a.append(p, t, m);
    a.onclick = () => void openWork(work);
    return a;
  }
  const renderStrip = (target, items) => {
    target.innerHTML = '';
    items.slice(0, 12).forEach((w) => target.appendChild(card(w)));
  };
  const renderGrid = (target, items) => {
    target.innerHTML = '';
    items.forEach((w) => target.appendChild(card(w)));
  };
  function emptyState(target, title, text, action) {
    target.innerHTML = `<div class="empty" style="grid-column:1/-1"><div><img src="${LOGO}" alt=""><h3></h3><p></p></div></div>`;
    target.querySelector('h3').textContent = title;
    target.querySelector('p').textContent = text;
    if (action) {
      const b = el('button', 'load-more');
      b.textContent = action.label;
      b.onclick = action.run;
      target.querySelector('.empty > div').appendChild(b);
    }
  }

  // ───────────────────────── الرئيسية (v35) ─────────────────────────

  function sectionBlock(title, kind, items) {
    const s = el('section', 'section');
    const h = el('div', 'section-head');
    const h2 = el('h2');
    h2.textContent = title;
    const b = el('button', 'link');
    b.textContent = 'عرض الكل';
    b.onclick = () => void openCollection(kind);
    h.append(h2, b);
    const strip = el('div', 'card-strip');
    renderStrip(strip, items);
    s.append(h, strip);
    return s;
  }
  function renderHome() {
    const home = q('homeSections');
    home.innerHTML = '';
    const reading = libraryWorks('reading');
    if (reading.length) home.appendChild(sectionBlock('أعمال تتابعها', 'libraryReading', reading));
    const history = historyWorks();
    if (history.length) home.appendChild(sectionBlock('آخر ما شاهدت', 'history', history));
    if (state.home.featured.length) home.appendChild(sectionBlock('مقترحة لك', 'featured', state.home.featured));
    if (state.home.trending.length) home.appendChild(sectionBlock('الأكثر رواجًا', 'trending', state.home.trending));
    if (state.home.recent.length) home.appendChild(sectionBlock('المضافة حديثًا', 'recent', state.home.recent));
    if (state.home.popular.length) home.appendChild(sectionBlock('المميزة', 'popular', state.home.popular));
  }
  function renderHomeSkeleton() {
    const home = q('homeSections');
    home.innerHTML = '';
    for (const title of ['مقترحة لك', 'الأكثر رواجًا', 'المضافة حديثًا']) {
      const s = el('section', 'section');
      s.innerHTML = `<div class="section-head"><h2>${title}</h2><span class="link">...</span></div>`;
      const strip = el('div', 'card-strip');
      for (let i = 0; i < 5; i++) {
        const x = el('div', 'work-card');
        x.innerHTML = '<div class="poster"><div class="skeleton"></div></div><div class="work-title">&nbsp;</div>';
        strip.appendChild(x);
      }
      s.appendChild(strip);
      home.appendChild(s);
    }
  }
  async function loadHome() {
    if (!available()) {
      renderHeroFallback();
      renderHome();
      const box = el('div');
      emptyState(box, 'المصادر داخل تطبيق أندرويد', 'الكتالوج يُقرأ من مصادرنا العربية بمحرّك التطبيق — افتح VANTARA على الجوال.');
      q('homeSections').appendChild(box.firstElementChild);
      return;
    }
    renderHomeSkeleton();
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
      state.heroItems = uniqueById([...tr.items, ...fe.items]).filter((w) => !!w.bannerImage).slice(0, 6);
      renderHero();
      renderHome();
      browse({ kind: 'popular', page: 2 })
        .then((po) => {
          state.home.popular = po.items;
          renderHome();
        })
        .catch(() => {});
    } catch {
      renderHeroFallback();
      const home = q('homeSections');
      home.innerHTML = '';
      const box = el('div');
      emptyState(box, 'تعذر الوصول إلى المصادر', 'جرّب إعادة المحاولة بعد لحظة.', { label: 'إعادة المحاولة', run: () => void loadHome() });
      home.appendChild(box.firstElementChild);
    }
  }

  // البانر الدائري — منقول حرفيًّا من v35
  function renderHero() {
    const items = state.heroItems;
    if (!items.length) return renderHeroFallback();
    const track = q('heroTrack');
    const dots = q('heroDots');
    track.innerHTML = '';
    dots.innerHTML = '';
    const physical = [items[items.length - 1], ...items, items[0]];
    physical.forEach((w) => {
      const s = el('div', 'hero-slide');
      const im = el('div', 'hero-image');
      mountImage(im, w, 'banner', { eager: true, position: '50% 30%' });
      s.appendChild(im);
      s.onclick = () => {
        if (Math.abs(state.heroDeltaX) < 8) void openWork(w);
      };
      track.appendChild(s);
    });
    items.forEach((_, i) => {
      const d = document.createElement('button');
      d.className = `hero-dot${i === 0 ? ' active' : ''}`;
      d.setAttribute('aria-label', `البانر ${i + 1}`);
      d.onclick = (e) => {
        e.stopPropagation();
        heroGoLogical(i);
      };
      dots.appendChild(d);
    });
    state.heroPhysicalIndex = 1;
    heroPosition(false);
    bindHero();
    restartHero();
  }
  function renderHeroFallback() {
    state.heroItems = [];
    const track = q('heroTrack');
    track.innerHTML = '';
    const s = el('div', 'hero-slide');
    const im = el('div', 'hero-image');
    fallbackArt(im);
    s.appendChild(im);
    track.appendChild(s);
    q('heroDots').innerHTML = '';
    q('heroInfoTitle').textContent = 'VANTARA';
    q('heroInfoGenre').textContent = 'مانجا · مانهوا';
    q('heroInfoStatus').textContent = 'مصادر عربية';
    q('heroInfoIndex').textContent = '';
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
    tr.style.transition = anim ? 'transform .35s var(--ease)' : 'none';
    tr.style.transform = `translateX(${-state.heroPhysicalIndex * 100}%)`;
    const li = logicalIndex();
    root.querySelectorAll('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === li));
    const w = state.heroItems[li];
    if (!w) return;
    q('heroInfoTitle').textContent = titleOf(w);
    q('heroInfoGenre').textContent = (w.genres || []).slice(0, 2).join(' · ') || (w._work?.editions?.[0]?.label ?? 'مانجا');
    q('heroInfoStatus').textContent = STATUS_AR[w.status] || `${w._work?.editions?.length ?? 1} مصدر`;
    q('heroInfoIndex').textContent = `${li + 1}/${state.heroItems.length}`;
  }
  function heroNext() {
    if (!state.heroItems.length) return;
    state.heroPhysicalIndex += 1;
    heroPosition(true);
  }
  function heroPrev() {
    if (!state.heroItems.length) return;
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
    tr.addEventListener('transitionend', () => {
      const n = state.heroItems.length;
      if (state.heroPhysicalIndex === 0) {
        state.heroPhysicalIndex = n;
        heroPosition(false);
      } else if (state.heroPhysicalIndex === n + 1) {
        state.heroPhysicalIndex = 1;
        heroPosition(false);
      }
    });
    const start = (x) => {
      state.heroDragging = true;
      state.heroStartX = x;
      state.heroDeltaX = 0;
      hero.classList.add('dragging');
      clearInterval(state.heroTimer);
    };
    const move = (x) => {
      if (state.heroDragging) state.heroDeltaX = x - state.heroStartX;
    };
    const end = () => {
      if (!state.heroDragging) return;
      state.heroDragging = false;
      hero.classList.remove('dragging');
      if (state.heroDeltaX < -42) heroNext();
      else if (state.heroDeltaX > 42) heroPrev();
      else heroPosition(true);
      state.heroDeltaX = 0;
      restartHero();
    };
    hero.addEventListener('touchstart', (e) => start(e.touches[0].clientX), { passive: true });
    hero.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
    hero.addEventListener('touchend', end);
    hero.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') {
        start(e.clientX);
        hero.setPointerCapture?.(e.pointerId);
      }
    });
    hero.addEventListener('pointermove', (e) => move(e.clientX));
    hero.addEventListener('pointerup', end);
    hero.addEventListener('pointercancel', end);
  }
  function restartHero() {
    clearInterval(state.heroTimer);
    state.heroTimer = setInterval(heroNext, 4800);
  }

  // ───────────────────────── صفحة العمل (v35 + الفصول الحقيقية) ─────────────────────────

  async function openWork(work) {
    state.previousPage = root.querySelector('.page.active')?.id || 'home';
    state.current = work;
    if (work._work?.editions?.length) rememberWork(work);
    pushHistory(work);
    showPage('detail');
    resetDetailTabs();
    renderDetail(work);
    renderChaptersLoading();
    if (!work._work?.editions?.length) {
      // عملٌ من المكتبة على جهاز آخر: نُسخه لم تُحفظ هنا، فيُبحث عنه بعنوانه
      try {
        const found = (await browse({ query: titleOf(work) })).items.find((w) => w.id === work.id);
        if (found) {
          work = found;
          state.current = found;
          rememberWork(found);
        }
      } catch {
        // يبقى العمل بلا نُسخ ويقول ذلك في قائمة الفصول
      }
    }
    if (!work._work?.editions?.length) {
      q('chapterPanel').innerHTML = '<div class="no-data">ما لقينا هذا العمل في مصادرنا الآن. جرّب البحث باسمه.</div>';
      return;
    }
    try {
      const full = await detail(work);
      if (state.current !== work) return;
      state.current = full;
      renderDetail(full);
      renderChapters(full);
    } catch {
      q('chapterPanel').innerHTML = '<div class="no-data">تعذّر جلب الفصول من المصادر. جرّب بعد لحظة.</div>';
    }
  }
  function backFromDetail() {
    showPage(state.previousPage === 'detail' ? 'home' : state.previousPage);
  }
  function resetDetailTabs() {
    root.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.panel === 'summary'));
    root.querySelectorAll('.panel').forEach((x) => x.classList.toggle('active', x.id === 'summary'));
  }
  function renderDetail(w) {
    q('detailTitle').textContent = titleOf(w);
    q('detailNative').textContent = (w._sources ?? w._work?.editions ?? []).map((s) => s.label).filter(Boolean).join(' · ');
    const g = q('detailGenres');
    g.innerHTML = '';
    (w.genres || []).slice(0, 5).forEach((x) => {
      const c = el('span', 'chip');
      c.textContent = AR_GENRE[x] || x;
      g.appendChild(c);
    });
    q('sourceRating').textContent = w.averageScore ? `${w.averageScore}%` : '—';
    const rating = userRating(w.id);
    q('userRating').textContent = rating ? `${rating}/5` : '—';
    mountImage(q('detailCover'), w, 'cover', { eager: true });
    q('description').textContent = clean(w.description) || (w.description === undefined ? 'جارٍ جلب النبذة…' : 'لا توجد نبذة متاحة من المصدر.');
    refreshLibraryDetail();
    renderInfo(w);
  }
  function renderInfo(w) {
    const role = (needle) =>
      unique((w.staff?.edges || []).filter((e) => (e.role || '').toLowerCase().includes(needle)).map((e) => e.node?.name?.full)).join('، ') || '—';
    const sources = (w._sources ?? []).map((s) => `${s.label} (${s.count})`).join('، ');
    const pairs = [
      ['المؤلف', role('story')],
      ['الرسام', role('art')],
      ['الحالة', STATUS_AR[w.status] || safe(w.status)],
      ['الفصول', safe(w.chapters)],
      ['المصادر', sources || safe(w._work?.editions?.map((e) => e.label).join('، '))],
    ];
    const grid = q('infoGrid');
    grid.innerHTML = '';
    pairs.forEach(([a, b]) => {
      const d = el('div', 'info-box');
      d.innerHTML = '<div class="info-label"></div><div class="info-value"></div>';
      d.firstElementChild.textContent = a;
      d.lastElementChild.textContent = b;
      grid.appendChild(d);
    });
  }
  function renderChaptersLoading() {
    q('chapterPanel').innerHTML = '<div class="no-data">جارٍ جمع الفصول من المصادر…</div>';
  }

  /**
   * الفصول: «تابع القراءة» ثم القائمة، ولكل فصل عين قراءته.
   *
   * العين رمادية هادئة لما لم يُقرأ، وبنفسجية بعلامة صح لما قُرئ. لمستها تعلّم
   * الفصل أو تُلغي تعليمه، والقارئ يعلّمه وحده عند ٢٠٪ منه — هذا الفصل وحده،
   * لا ما قبله ولا العمل كله.
   */
  function renderChapters(w) {
    const panel = q('chapterPanel');
    panel.innerHTML = '';
    const rows = w._chapters ?? [];
    if (!rows.length) {
      panel.innerHTML = '<div class="no-data">المصادر لم تُرجع فصولًا لهذا العمل.</div>';
      return;
    }
    const ref = String(w.id);
    const readCount = rows.filter((r) => isChapterRead(sync, ref, chapterKeyOf(ref, r))).length;
    // أول فصل غير مقروء من الأقدم: القائمة مرتّبة من الأحدث
    const next = [...rows].reverse().find((r) => !isChapterRead(sync, ref, chapterKeyOf(ref, r))) ?? rows[0];

    const summary = el('div', 'chapter-summary');
    summary.innerHTML = '<strong></strong><p></p>';
    summary.querySelector('strong').textContent = String(rows.length);
    summary.querySelector('p').textContent =
      `${readCount} مقروء من ${rows.length}` + (w._sources?.length > 1 ? ` · من ${w._sources.length} مصادر` : '');
    panel.appendChild(summary);

    const cont = el('button', 'load-more reader-continue');
    cont.textContent = readCount ? `تابع القراءة · ${next.chapter.name || 'الفصل'}` : `ابدأ القراءة · ${next.chapter.name || 'الفصل الأول'}`;
    cont.onclick = () => openChapter(w, next);
    panel.appendChild(cont);

    const list = el('div', 'chapter-list');
    const fragment = document.createDocumentFragment();
    for (const r of rows) {
      const row = el('div', 'chapter-row');
      const info = el('div');
      const no = el('div', 'chapter-no');
      no.textContent = r.chapter.name || '—';
      const note = el('div', 'chapter-note');
      note.textContent = [r.label, r.chapter.scanlator].filter(Boolean).join(' · ');
      info.append(no, note);
      info.onclick = () => openChapter(w, r);
      const eye = el('button', 'chapter-eye');
      eye.type = 'button';
      const paint = () => {
        const read = isChapterRead(sync, ref, chapterKeyOf(ref, r));
        eye.classList.toggle('chapter-eye--read', read);
        eye.innerHTML = EYE_SVG + (read ? `<span class="chapter-eye__check">${CHECK_SVG}</span>` : '');
        eye.setAttribute('aria-label', read ? 'مقروء — المس لإلغاء' : 'غير مقروء — المس للتعليم');
      };
      paint();
      eye.onclick = (e) => {
        e.stopPropagation();
        markChapter(sync, ref, r, !isChapterRead(sync, ref, chapterKeyOf(ref, r)));
        paint();
      };
      row.append(info, eye);
      fragment.appendChild(row);
    }
    list.appendChild(fragment);
    panel.appendChild(list);
  }
  function openChapter(w, row) {
    const ref = String(w.id);
    deps.openReader({
      seriesRef: ref,
      title: titleOf(w),
      work: w,
      rows: w._chapters,
      row,
      back: () => {
        showPage('detail');
        renderChapters(state.current);
      },
    });
  }
  function switchTab(btn) {
    root.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    root.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    btn.classList.add('active');
    q(btn.dataset.panel).classList.add('active');
  }

  // ───────────────────────── المكتبة والتقييم (في حسابك) ─────────────────────────

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
  function setLibraryState(v) {
    if (!state.current) return;
    const d = descriptorOf(state.current);
    if (v === 'later') {
      const member = !inCollection('read_later', d.seriesRef);
      sync.enqueue('readLater.set', { ...d, member });
      toast('تم تحديث «أقرأ لاحقًا»');
    } else {
      if (!libraryEntry(d.seriesRef)?.row) sync.enqueue('library.add', d);
      if (inCollection('read_later', d.seriesRef)) sync.enqueue('readLater.set', { ...d, member: false });
      toast('تم تحديث حالة القراءة');
    }
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
  function afterLibraryChange() {
    // الكتابة في الطابور والمرآة تتحدّث مع الدفع؛ الشاشة تتحدّث الآن ثم بعده
    refreshLibraryDetail();
    setTimeout(() => {
      refreshLibraryDetail();
      renderHome();
    }, 900);
  }
  function refreshLibraryDetail() {
    if (!state.current) return;
    const e = libraryEntry(String(state.current.id));
    const btn = q('libraryBtn');
    btn.classList.toggle('added', !!e?.row);
    btn.querySelector('span').textContent = e?.row ? 'مضاف إلى مكتبتي' : 'إضافة إلى مكتبتي';
    q('readingChip').classList.toggle('on', e?.state === 'reading');
    q('laterChip').classList.toggle('on', e?.state === 'later');
    q('favChip').classList.toggle('on', !!e?.favorite);
    q('detailHeart')?.setAttribute('fill', e?.favorite ? 'currentColor' : 'none');
  }
  function initLibraryTabs() {
    const tabs = [['all', 'الكل'], ['reading', 'أقرأ حاليًا'], ['later', 'أقرأ لاحقًا'], ['favorite', 'المفضلة']];
    const tabsRoot = q('libraryTabs');
    tabsRoot.innerHTML = '';
    tabs.forEach(([k, l]) => {
      const b = el('button', `library-tab${k === state.libraryFilter ? ' active' : ''}`);
      b.textContent = l;
      b.onclick = () => {
        state.libraryFilter = k;
        renderLibrary();
      };
      tabsRoot.appendChild(b);
    });
  }
  function renderLibrary() {
    initLibraryTabs();
    const items = libraryWorks(state.libraryFilter);
    const sort = q('librarySort')?.value || 'added';
    if (sort === 'title') items.sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'ar'));
    else items.sort((a, b) => (libraryEntry(b.id)?.addedAt || 0) - (libraryEntry(a.id)?.addedAt || 0));
    const grid = q('libraryGrid');
    if (!items.length) return emptyState(grid, 'لا توجد أعمال هنا', 'أضف الأعمال من صفحة التفاصيل ثم نظّمها كما تريد.');
    renderGrid(grid, items);
  }
  function userRating(ref) {
    const row = sync.rows('ratings', (r) => r.user_id === me() && r.series_ref === String(ref))[0];
    return row?.score ? Math.round(row.score / 2) : 0;
  }
  function openRating() {
    state.pendingRating = userRating(state.current?.id);
    renderRatingStars();
    q('ratingModal').classList.add('show');
  }
  function closeRating() {
    q('ratingModal').classList.remove('show');
  }
  function renderRatingStars() {
    const stars = q('ratingStars');
    stars.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const b = el('button', `star${i <= state.pendingRating ? ' on' : ''}`);
      b.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.5 6 .9-4.35 4.24 1.03 5.98L12 16.8l-5.38 2.82 1.03-5.98L3.3 9.4l6-.9Z"/></svg>';
      b.onclick = () => {
        state.pendingRating = i;
        renderRatingStars();
      };
      stars.appendChild(b);
    }
  }
  function saveRating() {
    if (state.current && state.pendingRating) {
      // الخادم يحفظ من 10؛ النجوم خمس
      sync.enqueue('rating.set', { ...descriptorOf(state.current), score: state.pendingRating * 2 });
    }
    closeRating();
    q('userRating').textContent = state.pendingRating ? `${state.pendingRating}/5` : '—';
    toast('حُفظ تقييمك');
  }

  // ───────────────────────── المجموعات والاستكشاف والبحث ─────────────────────────

  const COLLECTIONS = {
    trending: { title: 'الأكثر رواجًا', kind: 'popular' },
    featured: { title: 'مقترحة لك', kind: 'catalogue' },
    recent: { title: 'المضافة حديثًا', kind: 'latest' },
    popular: { title: 'المميزة', kind: 'popular' },
  };
  async function openCollection(kind) {
    const sortSelect = q('collectionSort');
    if (sortSelect) sortSelect.style.display = 'none';
    if (kind === 'history') {
      showPage('collection');
      q('collectionTitle').textContent = 'آخر ما شاهدت';
      q('collectionMore').style.display = 'none';
      renderGrid(q('collectionGrid'), historyWorks());
      return;
    }
    if (kind === 'libraryReading') {
      state.libraryFilter = 'reading';
      showPage('library');
      return;
    }
    const c = COLLECTIONS[kind] || COLLECTIONS.trending;
    state.collection = { kind: c.kind, page: 0, hasNext: true, items: [], genre: null };
    q('collectionTitle').textContent = c.title;
    q('collectionGrid').innerHTML = '';
    q('collectionMore').style.display = 'block';
    showPage('collection');
    await loadMoreCollection();
  }
  async function loadMoreCollection() {
    if (!state.collection.hasNext) return;
    const btn = q('collectionMore');
    btn.disabled = true;
    btn.textContent = 'جاري التحميل...';
    try {
      const r = state.collection.genre
        ? await browse({ query: state.collection.genre, page: state.collection.page + 1 })
        : await browse({ kind: state.collection.kind, page: state.collection.page + 1 });
      state.collection.page = r.page;
      state.collection.hasNext = r.hasNextPage;
      state.collection.items = uniqueById([...state.collection.items, ...r.items]);
      renderGrid(q('collectionGrid'), state.collection.items);
      btn.style.display = state.collection.hasNext ? 'block' : 'none';
    } catch {
      toast('تعذر تحميل المزيد');
    } finally {
      btn.disabled = false;
      btn.textContent = 'تحميل المزيد';
    }
  }
  function reloadCollection() {
    state.collection.page = 0;
    state.collection.hasNext = true;
    state.collection.items = [];
    q('collectionGrid').innerHTML = '';
    void loadMoreCollection();
  }
  function openCategories() {
    showPage('categories');
    const grid = q('categoryGrid');
    grid.innerHTML = '';
    GENRES.forEach((g) => {
      const b = el('button', 'category');
      b.innerHTML = '<strong></strong><span>ابحث في كل المصادر</span>';
      b.querySelector('strong').textContent = g;
      b.onclick = () => void openGenre(g);
      grid.appendChild(b);
    });
  }
  async function openGenre(g) {
    // المصادر لا تشترك في فلتر تصنيف واحد؛ الاسم العربي يُسأل كبحث في كلها
    state.collection = { kind: 'search', page: 0, hasNext: true, items: [], genre: g };
    q('collectionTitle').textContent = g;
    q('collectionGrid').innerHTML = '';
    q('collectionMore').style.display = 'block';
    showPage('collection');
    await loadMoreCollection();
  }
  async function loadMoreDiscover() {
    if (!state.catalogHasNext || !available()) {
      if (!available()) emptyState(q('discoverGrid'), 'المصادر داخل تطبيق أندرويد', 'الاستكشاف يقرأ كتالوج مصادرنا كاملًا من محرّك التطبيق.');
      return;
    }
    const btn = q('discoverMore');
    btn.disabled = true;
    btn.textContent = 'جاري تحميل المزيد...';
    try {
      const r = await browse({ kind: 'catalogue', page: state.catalogPage + 1 });
      state.catalogPage = r.page;
      state.catalogHasNext = r.hasNextPage;
      state.catalog = uniqueById([...state.catalog, ...r.items]);
      renderGrid(q('discoverGrid'), state.catalog);
      btn.style.display = state.catalogHasNext ? 'block' : 'none';
    } catch {
      toast('تعذر تحميل الكتالوج');
    } finally {
      btn.disabled = false;
      btn.textContent = 'تحميل أعمال أكثر';
    }
  }
  function localDiscoverSearch(term) {
    term = term.trim().toLowerCase();
    if (!term) return renderGrid(q('discoverGrid'), state.catalog);
    renderGrid(q('discoverGrid'), state.catalog.filter((w) => titleOf(w).toLowerCase().includes(term)));
  }
  async function runDiscoverSearch() {
    const term = q('discoverSearch').value.trim();
    if (!term) return;
    try {
      renderGrid(q('discoverGrid'), (await browse({ query: term })).items);
    } catch {
      toast('تعذر البحث');
    }
  }
  function openSearch() {
    showPage('search');
    setTimeout(() => q('searchInput')?.focus(), 80);
  }
  function debouncedSearch(term) {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      const grid = q('searchGrid');
      if (!term.trim()) {
        grid.innerHTML = '';
        return;
      }
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">جاري البحث...</div>';
      try {
        const { items } = await browse({ query: term });
        if (items.length) renderGrid(grid, items);
        else emptyState(grid, 'لا نتائج', 'جرّب اسمًا آخر أو كتابة مختلفة.');
      } catch {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1">تعذر البحث الآن.</div>';
      }
    }, 330);
  }

  // ───────────────────────── الدرج والتنقّل (v35) ─────────────────────────

  function buildDrawer() {
    const drawer = q('drawerContent');
    drawer.innerHTML = '';
    drawerGroups.forEach(([label, items]) => {
      const g = el('div', 'drawer-group');
      g.innerHTML = '<div class="drawer-label"></div>';
      g.firstElementChild.textContent = label;
      items.forEach(([name, key, ic]) => {
        const b = el('button', 'drawer-item');
        b.innerHTML = `${iconSvg(ic)}<span></span>`;
        b.querySelector('span').textContent = name;
        b.onclick = () => drawerNavigate(key);
        g.appendChild(b);
      });
      drawer.appendChild(g);
    });
  }
  function openDrawer() {
    q('drawerBackdrop').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    q('drawerBackdrop').classList.remove('open');
    document.body.style.overflow = '';
  }
  function drawerNavigate(key) {
    closeDrawer();
    if (['home', 'library', 'discover', 'settings'].includes(key)) return navTo(key);
    if (key === 'favorites' || key === 'later') {
      state.libraryFilter = key === 'favorites' ? 'favorite' : 'later';
      return showPage('library');
    }
    if (key === 'switchAccount') return deps.switchAccount();
    const route = { friends: 'friends', activity: 'activity', notifications: 'notifications', recommendations: 'recommendations', profile: 'me', server: 'settings' }[key];
    if (route) void deps.go({ name: route });
  }
  function showPage(id) {
    root.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === id));
    const mainPages = ['home', 'library', 'discover', 'settings'];
    q('bottomNav').style.display = mainPages.includes(id) ? 'grid' : 'none';
    root.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n.dataset.page === id));
    if (id === 'library') renderLibrary();
    if (id === 'discover' && !state.catalog.length) void loadMoreDiscover();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const navTo = (id) => showPage(id);

  function renderSettings() {
    // نفس بطاقات v35، بحقائق هذا البناء لا بنصوص النموذج (AniList، «بلا قارئ»)
    const list = root.querySelector('#settings .settings-list');
    if (!list) return;
    const rows = [
      ['المظهر', 'تصميم VANTARA الداكن', 'داكن'],
      ['المصادر', 'مصادر عربية بمحرّك التطبيق · كل الكتالوج لا الرائج وحده', 'عربي'],
      ['القراءة', 'الصفحات من المصادر مباشرة · القارئ الذكي', 'متاح'],
      ['الإصدار', deps.version || 'VANTARA', 'v35'],
    ];
    list.innerHTML = '';
    for (const [title, sub, pill] of rows) {
      const d = el('div', 'setting');
      d.innerHTML = '<div><strong></strong><small></small></div><span class="pill"></span>';
      d.querySelector('strong').textContent = title;
      d.querySelector('small').textContent = sub;
      d.querySelector('.pill').textContent = pill;
      list.appendChild(d);
    }
    const server = el('button', 'load-more');
    server.textContent = 'إعدادات الخادم والتنبيهات';
    server.onclick = () => void deps.go({ name: 'settings' });
    list.appendChild(server);
  }

  function paintNotifyDots() {
    const unread = sync.rows('notifications', (r) => r.user_id === me() && !r.read).length;
    root.querySelectorAll('.has-dot').forEach((b) => b.classList.toggle('has-dot--off', unread === 0));
    root.querySelectorAll('.notify-dot').forEach((d) => (d.style.display = unread ? '' : 'none'));
  }

  // ───────────────────────── الأفعال المفوَّضة ─────────────────────────

  const actions = {
    backFromDetail,
    closeDrawer,
    closeRating,
    drawerBackdropClick: (e) => {
      if (e.target === q('drawerBackdrop')) closeDrawer();
    },
    ratingBackdrop: (e) => {
      if (e.target === q('ratingModal')) closeRating();
    },
    loadMoreCollection: () => void loadMoreCollection(),
    loadMoreDiscover: () => void loadMoreDiscover(),
    navTo: (_e, t) => navTo(t.dataset.arg),
    showPage: (_e, t) => showPage(t.dataset.arg),
    openCategories,
    openCollection: (_e, t) => void openCollection(t.dataset.arg),
    openDrawer,
    openRating,
    openSearch,
    openUtility: (_e, t) => void deps.go({ name: t.dataset.arg }),
    reloadCollection,
    renderLibrary,
    runDiscoverSearch: () => void runDiscoverSearch(),
    saveRating,
    setLibraryState: (_e, t) => setLibraryState(t.dataset.arg),
    shareCurrent: () => toast('المشاركة من صفحة العمل قريبًا — أرسل فريمًا من القارئ'),
    switchTab: (_e, t) => switchTab(t),
    toggleFavoriteCurrent,
    toggleLibraryCurrent,
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
    if (t?.dataset.input === 'localDiscoverSearch') localDiscoverSearch(t.value);
  });
  root.addEventListener('change', (e) => {
    if (e.target.closest('[data-change="renderLibrary"]')) renderLibrary();
  });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeDrawer();
      closeRating();
    }
  };
  document.addEventListener('keydown', onKey);
  const unsubscribe = sync.onChange?.((tables) => {
    if (tables.some((t) => ['library', 'collections', 'ratings'].includes(t))) {
      refreshLibraryDetail();
      if (root.querySelector('#home.active')) renderHome();
      if (root.querySelector('#library.active')) renderLibrary();
    }
    if (tables.includes('notifications')) paintNotifyDots();
  });

  buildDrawer();
  renderSettings();
  paintNotifyDots();
  void loadHome();
  if (page !== 'home') showPage(page);

  return {
    showPage,
    openWork,
    teardown() {
      clearInterval(state.heroTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      unsubscribe?.();
    },
  };
}

export { seriesRefOf };
