/**
 * اكتشف الأنمي: البحث، الفلاتر، وصفحات «الكل».
 *
 * على نموذج بحث المانجا: قبل أن تكتب ليست الصفحة فارغة — آخر ما بحثت عنه (النهائي
 * فقط)، والأنواع بوجوه شخصياتها، و«الرائج الآن» مرقّمًا. تكتب فتظهر النتائج تحتها
 * بلا أن يُمسّ ما فوقها (كانت الشبكة كلها تُعاد عند لمس خانة البحث فتختفي الصور).
 * وزر القمع يفتح الفلاتر: أنواع تُطلب أو تُستبعد، الشكل، الحالة، السنة والموسم،
 * أقل تقييم، والترتيب — كلها طلب AniList واحد.
 *
 * «الكل» في كل شريط يفتح قائمته هو بالضبط (الرائج، Top 10 الموسم، النوع…) صفحةً
 * بعنوانها وفلاتر سريعة وتمرير لا ينتهي.
 */
import { glyph, iconButton } from './icons.js';
import { FORMAT_AR, SEASON_AR, SORT_AR, STATUS_AR, activeFilterCount, discoverAnime, emptyFilters, seasonOf } from '../lib/anime-meta.js';
import { recentStore } from '../lib/recent-searches.js';
import { cachedGenreArt, loadGenreArt } from '../lib/anime-genre-art.js';
import { stripIn } from './motion.js';

export const RECENT_KEY = 'vantara.anime.searches.v1';
const FORMATS = ['TV', 'MOVIE', 'ONA', 'OVA', 'SPECIAL'];
const STATUSES = ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED'];
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const SORTS = ['popularity', 'score', 'newest', 'trending'];

/** مواصفات صفحات «الكل»: لكل شريط قائمته. */
export function collectionSpec({ kind, genre = null, title = null, now = new Date() }, genreAr = (g) => g) {
  const { season, year } = seasonOf(now);
  switch (kind) {
    case 'trending':
      return { kind, title: title ?? 'الرائج الآن', sub: 'ما يشاهده الناس هذا الأسبوع', filters: { sort: 'trending' } };
    case 'season':
      return { kind, title: title ?? 'Top 10', sub: `الأشهر في موسم ${SEASON_AR[season]} ${year}`, filters: { season, year, sort: 'popularity' } };
    case 'popular':
      return { kind, title: title ?? 'الأشهر على الإطلاق', sub: null, filters: { sort: 'popularity' } };
    case 'top':
      return { kind, title: title ?? 'الأعلى تقييمًا', sub: null, filters: { sort: 'score', minPop: 40_000 } };
    case 'airing':
      return { kind, title: title ?? 'يُعرض الآن', sub: null, filters: { status: 'RELEASING', sort: 'popularity' } };
    case 'genre':
      return { kind, genre, title: title ?? genreAr(genre), sub: null, filters: { include: [genre], sort: 'popularity' }, sortable: true };
    default:
      return { kind: 'popular', title: title ?? 'الأشهر', sub: null, filters: { sort: 'popularity' } };
  }
}

/** حالة نوع في ورقة الفلاتر: لا شيء ← مطلوب ← مستبعد ← لا شيء. */
export function cycleGenre(f, g) {
  const include = f.include.filter((x) => x !== g);
  const exclude = f.exclude.filter((x) => x !== g);
  if (f.include.includes(g)) exclude.push(g);
  else if (!f.exclude.includes(g)) include.push(g);
  return { ...f, include, exclude };
}

/**
 * @param {{ q: Function, el: Function, button: Function, image: Function, posterCard: Function,
 *           openSheet: Function, closeSheet: Function, showPage: Function, genreAr: Function,
 *           genres: Array<[string, number]>, trending: () => any[], toast: Function, root?: Element }} deps
 */
export function createAnimeDiscover(deps) {
  const { q, el, button, genreAr } = deps;
  const recent = recentStore(RECENT_KEY);
  const GENRE_NAMES = deps.genres.map(([g]) => g);
  const hueOf = (g) => deps.genres.find(([x]) => x === g)?.[1] ?? 215;
  const state = {
    query: '',
    filters: emptyFilters(),
    page: 0,
    hasNext: true,
    loading: false,
    token: 0,
    built: false,
    io: null,
    collection: null,
  };

  // ───────────── بطاقات الأنواع: وجه شخصية بلون النوع الخافت ─────────────
  let genreArt = cachedGenreArt();
  const cards = new Set();
  function paintGenreFace(card) {
    const art = genreArt[card.dataset.genre];
    if (!art?.image || card.querySelector('.ag-face img')) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.onload = () => img.classList.add('loaded');
    img.src = art.image;
    card.querySelector('.ag-face').append(img);
  }
  function genreCard(g, onPick) {
    const c = button('ag-card', '', onPick, genreAr(g));
    c.dataset.genre = g;
    c.style.setProperty('--hue', String(hueOf(g)));
    const face = el('span', 'ag-face');
    face.setAttribute('aria-hidden', 'true');
    c.append(face, el('span', 'ag-name', genreAr(g)));
    cards.add(c);
    paintGenreFace(c);
    return c;
  }
  let artAsked = false;
  function askGenreArt() {
    if (artAsked) return;
    artAsked = true;
    void loadGenreArt(GENRE_NAMES).then((art) => {
      genreArt = art ?? {};
      for (const c of cards) {
        if (!c.isConnected) cards.delete(c);
        else paintGenreFace(c);
      }
    });
  }
  /** شريط الأنواع في الرئيسية: صفّان يمرّران أفقيًا. */
  function genreStrip() {
    const strip = el('div', 'ag-strip');
    strip.append(...GENRE_NAMES.map((g) => genreCard(g, () => openCollection({ kind: 'genre', genre: g }))));
    askGenreArt();
    return strip;
  }

  // ───────────── الصفحة ─────────────

  function build() {
    const host = q('animeDiscover');
    if (!host) return null;
    const box = el('div', 'ad');
    const form = el('form', 'ad-search');
    form.setAttribute('role', 'search');
    form.innerHTML = `${glyph('search', { size: 20 })}<input type="search" enterkeyhint="search" autocomplete="off" placeholder="ابحث عن أنمي بالعربي أو الإنجليزي" aria-label="ابحث عن أنمي">`;
    const input = form.querySelector('input');
    const clear = button('icon-btn ad-clear', glyph('close', { size: 18 }), () => {
      input.value = '';
      setQuery('');
      input.focus();
    }, 'امسح البحث');
    clear.hidden = true;
    const funnel = button('icon-btn an-filter-btn', glyph('filter', { size: 21 }), () => openFilters(), 'الفلاتر');
    form.append(clear, funnel);
    let timer = null;
    // لمس الخانة وحده لا يغيّر شيئًا: لا بحث ولا إعادة رسم إلا إن تغيّرت الكلمة فعلًا
    input.addEventListener('input', () => {
      clear.hidden = !input.value;
      clearTimeout(timer);
      timer = setTimeout(() => setQuery(input.value), 380);
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      clearTimeout(timer);
      setQuery(input.value);
      // «بحث» من لوحة المفاتيح = البحث النهائي: وحده يُحفظ
      if (input.value.trim()) recent.remember(input.value);
      input.blur();
    };
    const chips = el('div', 'ad-active');
    chips.hidden = true;
    const idle = el('div', 'ad-idle');
    const results = el('div', 'ad-results');
    results.hidden = true;
    const count = el('p', 'ad-count');
    const grid = el('div', 'an-grid ad-grid');
    grid.id = 'animeDiscoverGrid';
    const more = el('div', 'ad-more');
    results.append(count, grid, more);
    box.append(form, chips, idle, results);
    host.replaceChildren(box);
    state.view = { host, box, input, clear, funnel, chips, idle, results, count, grid, more };
    state.built = true;
    paintIdle();
    watchMore(more, () => void loadPage());
    return state.view;
  }

  /** ما قبل الكتابة: آخر ما بحثت عنه، الأنواع، والرائج مرقّمًا. يُبنى مرة واحدة. */
  function paintIdle() {
    const v = state.view;
    const recentHost = el('div', 'ad-recent-host');
    const gHead = el('div', 'ad-head');
    gHead.append(el('h2', null, 'تصفّح حسب النوع'));
    const genres = el('div', 'ag-grid');
    genres.append(...GENRE_NAMES.map((g) => genreCard(g, () => openCollection({ kind: 'genre', genre: g }))));
    askGenreArt();
    const trendHost = el('div', 'ad-trend-host');
    v.recentHost = recentHost;
    v.idle.replaceChildren(recentHost, gHead, genres, trendHost);
    paintRecent();
    void paintTrending(trendHost);
  }

  /** «آخر ما بحثت عنه» وحده (لا يمسّ الأنواع ولا صورها). */
  function paintRecent() {
    const v = state.view;
    const host = v?.recentHost;
    if (!host) return;
    const list = recent.list();
    if (!list.length) {
      host.replaceChildren();
      return;
    }
    const head = el('div', 'ad-head');
    head.append(el('h2', null, 'آخر ما بحثت عنه'), button('ad-link', 'امسح', () => {
      recent.clear();
      paintRecent();
    }));
    const rows = el('div', 'ad-recent');
    for (const t of list) {
      const row = el('div', 'ad-recent-row');
      const go = button('ad-recent-go', glyph('history', { size: 18 }), () => {
        v.input.value = t;
        v.clear.hidden = false;
        setQuery(t);
        recent.remember(t);
      });
      go.append(el('bdi', null, t));
      const rm = button('icon-btn ad-recent-rm', glyph('close', { size: 16 }), () => {
        recent.remove(t);
        paintRecent();
      }, `احذف «${t}»`);
      row.append(go, rm);
      rows.append(row);
    }
    host.replaceChildren(head, rows);
  }

  async function paintTrending(host) {
    let items = (deps.trending?.() ?? []).slice(0, 8);
    if (!items.length) {
      try {
        items = (await discoverAnime({ sort: 'trending', perPage: 8 })).items;
      } catch {
        return;
      }
    }
    if (!items.length || !host.isConnected) return;
    const head = el('div', 'ad-head');
    head.append(el('h2', null, 'الرائج الآن'), button('ad-link', 'الكل', () => openCollection({ kind: 'trending' })));
    const list = el('ol', 'ad-trend');
    items.forEach((m, i) => {
      const li = el('li');
      const b = button('ad-trend-row', '', () => openResult(m));
      const cover = el('span', 'ad-trend-cover');
      cover.append(deps.image(m.posterSmall ?? m.poster));
      const copy = el('span', 'ad-trend-copy');
      const t = el('span', 'ad-trend-title', m.title);
      t.dir = 'auto';
      copy.append(t, el('span', 'ad-trend-meta', [FORMAT_AR[m.format], ...(m.genres ?? []).slice(0, 2).map(genreAr)].filter(Boolean).join(' · ')));
      b.append(el('span', 'ad-trend-rank', String(i + 1)), cover, copy);
      li.append(b);
      list.append(li);
    });
    host.replaceChildren(head, list);
  }

  /** فتح نتيجة من بحث مكتوب يحفظه بحثًا نهائيًا (قصدت ما كتبته). */
  function openResult(m) {
    if (state.query) recent.remember(state.query);
    deps.openAnime(m);
  }

  function setQuery(raw) {
    const query = String(raw ?? '').trim();
    if (query === state.query) return;
    state.query = query;
    if (state.view) state.view.clear.hidden = !state.view.input.value;
    refresh();
  }

  /** الكلمة أو الفلاتر تغيّرت: النتائج من أول صفحة، أو الخمول إن لم يبق شيء. */
  function refresh() {
    const v = state.view;
    if (!v) return;
    paintChips();
    const idle = !state.query && !activeFilterCount(state.filters) && !state.filters.sort;
    v.idle.hidden = !idle;
    v.results.hidden = idle;
    state.token++;
    if (idle) {
      v.grid.replaceChildren();
      paintRecent();
      return;
    }
    state.page = 0;
    state.hasNext = true;
    state.loading = false;
    v.count.textContent = '';
    v.grid.replaceChildren(...Array.from({ length: 9 }, () => el('div', 'an-skel an-skel-poster')));
    void loadPage();
  }

  async function loadPage() {
    const v = state.view;
    if (!v || v.results.hidden || state.loading || !state.hasNext) return;
    state.loading = true;
    const token = state.token;
    const page = state.page + 1;
    try {
      const { items, hasNext } = await discoverAnime({ ...state.filters, search: state.query, page });
      if (token !== state.token) return;
      state.page = page;
      state.hasNext = hasNext;
      const cards = items.map((m) => deps.posterCard(m, { onOpen: openResult }));
      if (page === 1) v.grid.replaceChildren(...cards);
      else v.grid.append(...cards);
      stripIn(cards.slice(0, 9));
      if (page === 1 && !items.length) v.grid.replaceChildren(el('p', 'an-note', state.query ? 'لا نتائج — جرّب اسمًا آخر أو بالإنجليزي، أو خفّف الفلاتر.' : 'لا أعمال بهذه الفلاتر — خفّف بعضها.'));
      v.count.textContent = page === 1 && items.length ? (state.query ? `نتائج «${state.query}»` : 'نتائج الفلاتر') : v.count.textContent;
    } catch {
      if (token === state.token && page === 1) v.grid.replaceChildren(el('p', 'an-note', 'تعذّر البحث — تحقّق من الاتصال.'));
    } finally {
      if (token === state.token) state.loading = false;
    }
    // آخر الشبكة ما زال ظاهرًا: الصفحة التالية فورًا
    if (token === state.token && state.hasNext && nearBottom(v.more)) void loadPage();
  }

  /** الفلاتر المفعّلة سطرًا من شرائح تُزال بلمسة، ونقطة على زر القمع. */
  function paintChips() {
    const v = state.view;
    const f = state.filters;
    const n = activeFilterCount(f);
    v.funnel.classList.toggle('on', n > 0 || Boolean(f.sort));
    v.funnel.dataset.count = n ? String(n) : '';
    const chips = [];
    const chip = (label, remove, cls = '') => {
      const b = button(`ad-chip ${cls}`, '', () => {
        remove();
        refresh();
      }, `أزل ${label}`);
      b.append(el('span', null, label));
      b.insertAdjacentHTML('beforeend', glyph('close', { size: 12 }));
      chips.push(b);
    };
    for (const g of f.include) chip(genreAr(g), () => (f.include = f.include.filter((x) => x !== g)));
    for (const g of f.exclude) chip(`بلا ${genreAr(g)}`, () => (f.exclude = f.exclude.filter((x) => x !== g)), 'ad-chip--out');
    for (const x of f.formats) chip(FORMAT_AR[x] ?? x, () => (f.formats = f.formats.filter((y) => y !== x)));
    if (f.status) chip(STATUS_AR[f.status], () => (f.status = ''));
    if (f.season) chip(SEASON_AR[f.season], () => (f.season = ''));
    if (f.year) chip(String(f.year), () => (f.year = null));
    if (f.minScore > 0) chip(`★ ${f.minScore}+`, () => (f.minScore = 0));
    if (f.sort) chip(SORT_AR[f.sort], () => (f.sort = ''));
    v.chips.replaceChildren(...chips);
    v.chips.hidden = !chips.length;
  }

  /** ورقة الفلاتر: نسخة تُعدَّل ثم «اعرض النتائج». */
  function openFilters() {
    let draft = structuredClone(state.filters);
    deps.openSheet((body) => {
      const head = el('div', 'af-head');
      head.append(el('h3', null, 'الفلاتر'));
      const reset = button('ad-link', 'إعادة ضبط', () => {
        draft = emptyFilters();
        paint();
      });
      head.append(reset);
      const content = el('div', 'af-body');
      const apply = button('btn btn-primary af-apply', 'اعرض النتائج', () => {
        state.filters = draft;
        deps.closeSheet();
        refresh();
        window.scrollTo?.({ top: 0, behavior: 'instant' });
      });
      const group = (title, hint) => {
        const g = el('section', 'af-group');
        const h = el('div', 'af-title');
        h.append(el('b', null, title));
        if (hint) h.append(el('span', null, hint));
        g.append(h);
        return g;
      };
      const opt = (label, on, run, cls = '') => {
        const b = button(`af-opt${on ? ' on' : ''} ${cls}`, '', () => {
          run();
          paint();
        });
        b.setAttribute('aria-pressed', String(Boolean(on)));
        b.append(el('span', null, label));
        return b;
      };
      const paint = () => {
        const genres = group('الأنواع', 'لمسة: يشمل · لمستان: يستبعد');
        const gRow = el('div', 'af-opts');
        for (const g of GENRE_NAMES) {
          const inc = draft.include.includes(g);
          const exc = draft.exclude.includes(g);
          const b = opt(genreAr(g), inc || exc, () => (draft = cycleGenre(draft, g)), exc ? 'out' : inc ? 'in' : '');
          if (inc) b.insertAdjacentHTML('afterbegin', glyph('check', { size: 14 }));
          if (exc) b.insertAdjacentHTML('afterbegin', glyph('close', { size: 14 }));
          b.setAttribute('aria-label', `${genreAr(g)}: ${exc ? 'مستبعد' : inc ? 'مطلوب' : 'بلا تحديد'}`);
          gRow.append(b);
        }
        genres.append(gRow);
        const formats = group('الشكل');
        const fRow = el('div', 'af-opts');
        for (const x of FORMATS) {
          const on = draft.formats.includes(x);
          fRow.append(opt(FORMAT_AR[x] ?? x, on, () => (draft.formats = on ? draft.formats.filter((y) => y !== x) : [...draft.formats, x])));
        }
        formats.append(fRow);
        const status = group('الحالة');
        const sRow = el('div', 'af-opts');
        sRow.append(opt('الكل', !draft.status, () => (draft.status = '')));
        for (const x of STATUSES) sRow.append(opt(STATUS_AR[x], draft.status === x, () => (draft.status = draft.status === x ? '' : x)));
        status.append(sRow);
        const when = group('السنة والموسم');
        const wRow = el('div', 'af-opts');
        const year = el('select', 'af-select');
        year.setAttribute('aria-label', 'السنة');
        const now = new Date().getFullYear();
        year.append(new Option('كل السنوات', ''));
        for (let y = now + 1; y >= 1970; y--) year.append(new Option(String(y), String(y)));
        year.value = draft.year ? String(draft.year) : '';
        year.onchange = () => (draft.year = year.value ? Number(year.value) : null);
        wRow.append(year);
        for (const x of SEASONS) wRow.append(opt(SEASON_AR[x], draft.season === x, () => (draft.season = draft.season === x ? '' : x)));
        when.append(wRow);
        const score = group('أقل تقييم');
        const range = el('input', 'af-range');
        range.type = 'range';
        range.min = '0';
        range.max = '9';
        range.step = '0.5';
        range.value = String(draft.minScore || 0);
        const label = el('span', 'af-range-value');
        const paintScore = () => (label.textContent = Number(range.value) > 0 ? `★ ${range.value}+` : 'أي تقييم');
        range.oninput = () => {
          draft.minScore = Number(range.value);
          paintScore();
        };
        paintScore();
        const sWrap = el('div', 'af-range-row');
        sWrap.append(range, label);
        score.append(sWrap);
        const sort = group('الترتيب');
        const oRow = el('div', 'af-opts');
        const sorts = state.query ? ['relevance', ...SORTS] : SORTS;
        const current = draft.sort || (state.query ? 'relevance' : 'popularity');
        for (const x of sorts) oRow.append(opt(SORT_AR[x], current === x, () => (draft.sort = x)));
        sort.append(oRow);
        content.replaceChildren(genres, formats, status, when, score, sort);
        const n = activeFilterCount(draft);
        apply.textContent = n ? `اعرض النتائج (${n} ${n === 1 ? 'فلتر' : 'فلاتر'})` : 'اعرض النتائج';
      };
      paint();
      const foot = el('div', 'af-foot');
      foot.append(apply);
      body.append(head, content, foot);
    }, { tone: 'anime' });
  }

  // ───────────── «الكل»: صفحة القائمة ─────────────

  function openCollection(input) {
    const spec = collectionSpec(input, genreAr);
    state.collection = { spec, format: '', sort: spec.filters.sort, page: 0, hasNext: true, loading: false, token: (state.collection?.token ?? 0) + 1 };
    deps.showPage('animeCollection');
    window.scrollTo?.({ top: 0, behavior: 'instant' });
    paintCollection();
  }

  function paintCollection() {
    const host = q('animeCollection');
    const c = state.collection;
    if (!host || !c) return;
    const top = el('header', 'ac-top');
    top.innerHTML = iconButton('back', 'رجوع', { act: 'goBack' });
    const titles = el('div', 'ac-titles');
    const h1 = el('h1', null, c.spec.title);
    h1.dir = 'auto';
    titles.append(h1);
    if (c.spec.sub) titles.append(el('span', 'ac-sub', c.spec.sub));
    top.append(titles);
    const quick = el('div', 'ac-quick');
    const tabs = (items, current, pick) => {
      const row = el('div', 'ac-tabs');
      for (const [key, label] of items) {
        const b = button(`ac-tab${key === current ? ' active' : ''}`, label, () => {
          if (key === current) return;
          pick(key);
          c.page = 0;
          c.hasNext = true;
          c.loading = false;
          c.token++;
          paintCollection();
        });
        b.setAttribute('aria-pressed', String(key === current));
        row.append(b);
      }
      return row;
    };
    quick.append(tabs([['', 'الكل'], ['TV', 'مسلسلات'], ['MOVIE', 'أفلام'], ['ONA', 'ONA'], ['OVA', 'OVA']], c.format, (k) => (c.format = k)));
    if (c.spec.sortable) quick.append(tabs(SORTS.map((s) => [s, SORT_AR[s]]), c.sort, (k) => (c.sort = k)));
    const grid = el('div', 'an-grid ac-grid');
    grid.append(...Array.from({ length: 9 }, () => el('div', 'an-skel an-skel-poster')));
    const more = el('div', 'ad-more');
    host.replaceChildren(top, quick, grid, more);
    c.grid = grid;
    c.more = more;
    watchMore(more, () => void loadCollection());
    void loadCollection();
  }

  async function loadCollection() {
    const c = state.collection;
    if (!c?.grid?.isConnected || c.loading || !c.hasNext) return;
    c.loading = true;
    const token = c.token;
    const page = c.page + 1;
    try {
      const filters = { ...c.spec.filters, sort: c.sort, formats: c.format ? [c.format] : [] };
      const { items, hasNext } = await discoverAnime({ ...filters, page });
      if (token !== c.token) return;
      c.page = page;
      c.hasNext = hasNext;
      const cards = items.map((m, i) => deps.posterCard(m, c.spec.kind === 'season' && !c.format ? { rankInline: (page - 1) * 30 + i + 1 } : {}));
      if (page === 1) c.grid.replaceChildren(...cards);
      else c.grid.append(...cards);
      stripIn(cards.slice(0, 9));
      if (page === 1 && !items.length) c.grid.replaceChildren(el('p', 'an-note', 'لا أعمال هنا بعد.'));
    } catch {
      if (token === c.token && page === 1) c.grid.replaceChildren(el('p', 'an-note', 'تعذّر التحميل — تحقّق من الاتصال.'));
    } finally {
      if (token === c.token) c.loading = false;
    }
    if (token === c.token && c.hasNext && nearBottom(c.more)) void loadCollection();
  }

  // ───────────── مشترك ─────────────

  const nearBottom = (node) => {
    const box = node?.getBoundingClientRect?.();
    return Boolean(box) && box.top !== 0 && box.top < (globalThis.innerHeight ?? 800) + 700;
  };
  function watchMore(node, load) {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(), { rootMargin: '700px' });
    io.observe(node);
  }

  return {
    show() {
      if (!state.built || !q('animeDiscover')?.childElementCount) build();
      else paintRecent();
    },
    open({ genre = '', query = '' } = {}) {
      if (genre) return openCollection({ kind: 'genre', genre });
      deps.showPage('discover');
      if (!state.built || !q('animeDiscover')?.childElementCount) build();
      if (query && state.view) {
        state.view.input.value = query;
        setQuery(query);
      }
    },
    openCollection,
    genreStrip,
    genreCard,
    get query() {
      return state.query;
    },
  };
}
