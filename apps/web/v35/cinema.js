/**
 * VANTARA CINEMA — أفلام ومسلسلات عالمية مترجمة.
 *
 * البيانات من Cinemeta (والعربية من Wikidata)، والتشغيل من أربعة مصادر عربية
 * (FaselHD، ArabSeed، EgyDead، Cimaleek) عبر محرك الأنمي نفسه بمحتوى `cinema`.
 * الشكل نفس شكل الأنمي (فئات `an-`) بلون القسم، فلا نظام تصميم ثانٍ.
 *
 * المتابعة («أكمل»، «لاحقًا»، «المفضلة») محفوظة على هذا الجهاز لكل حساب؛
 * والوقت يُحتسب لقسم السينما في الإحصاءات.
 */

import { nativeFollowTime, flushFollowTime } from '../lib/follow-time.js';
import { glyph, iconButton } from './icons.js';
import { pop, revealIn, stripIn } from './motion.js';
import * as engine from '../lib/anime-engine.js';
import { GENRES_AR, TYPE_AR, catalog, detail as fetchDetail, displayTitle, search as searchMeta, withArabic } from '../lib/cinema-meta.js';
import { pickCopies, queriesFor } from '../lib/cinema-match.js';

const HOME_KEY = 'cinema.home.v1';
const STALE_MS = 6 * 3_600_000;
const STATE_AR = { RESOLVING: 'يتجهّز…', READY: 'جاهز', UNAVAILABLE: 'غير متاح', FAILED: 'فشل التشغيل' };
const SOURCE_NAMES = { faselhd: 'FaselHD', arabseed: 'ArabSeed', egydead: 'EgyDead', cimaleek: 'Cimaleek' };
const GENRES = ['Action', 'Drama', 'Comedy', 'Thriller', 'Crime', 'Sci-Fi', 'Horror', 'Romance', 'Adventure', 'Mystery', 'Fantasy', 'Animation', 'War', 'History', 'Documentary'];

const userKey = (base, userId) => `vantara.cinema.${base}.v1.${userId ? `user.${encodeURIComponent(userId)}` : 'guest'}`;
const readJson = (key, fallback) => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // تخزين ممتلئ أو ممنوع
  }
};
/** مفتاح المشاهدة: الفيلم برقمه، والمسلسل برقمه وموسمه (حلقات كل موسم تبدأ من 1). */
export const playKey = (m, season = null) => (m.type === 'series' ? `${m.id}:${season ?? 1}` : m.id);
const slim = (m) => ({ id: m.id, type: m.type, title: m.title, titleAr: m.titleAr ?? null, poster: m.poster, background: m.background, year: m.year, rating: m.rating });

export function createCinema(deps) {
  const { q, el, toast } = deps;
  const currentUser = () => deps.sync?.user?.userId ?? null;
  const state = { home: null, loading: null, detail: null, season: 1, token: 0, works: new Map(), playing: null, libraryTab: 'continue', discover: { query: '', genre: '', items: [], token: 0 } };

  // ───────────── التخزين المحلي ─────────────

  const watchAll = () => readJson(userKey('watch', currentUser()), {});
  const listAll = () => readJson(userKey('list', currentUser()), {});
  function recordWatch(m, season, n, position, duration) {
    const all = watchAll();
    const w = all[m.id] ?? { ...slim(m), episodes: {} };
    Object.assign(w, slim(m));
    const ep = `${season ?? 0}:${n}`;
    const prev = w.episodes[ep];
    const done = Boolean(prev?.done) || (duration > 0 && position / duration >= 0.9);
    w.episodes[ep] = { position, duration, done };
    w.season = season;
    w.episode = n;
    w.at = Date.now();
    all[m.id] = w;
    writeJson(userKey('watch', currentUser()), all);
  }
  const inList = (kind, id) => Boolean(listAll()[id]?.[kind]);
  function toggleList(kind, m) {
    const all = listAll();
    const row = all[m.id] ?? { ...slim(m) };
    row[kind] = row[kind] ? 0 : Date.now();
    if (!row.later && !row.fav) delete all[m.id];
    else all[m.id] = { ...row, ...slim(m) };
    writeJson(userKey('list', currentUser()), all);
    return Boolean(row[kind]);
  }
  /** من أين يكمل: آخر حلقة غير مكتملة، أو التالية لآخر مكتملة في نفس الموسم. */
  function resumePoint(m) {
    const w = watchAll()[m.id];
    if (m.type === 'movie') {
      const e = w?.episodes?.['0:1'];
      return { season: null, episode: 1, position: e && !e.done ? e.position : 0, resume: Boolean(e && !e.done && e.position > 5000) };
    }
    if (!w?.episode) return { season: m.seasons?.[0]?.n ?? 1, episode: 1, position: 0, resume: false };
    const e = w.episodes?.[`${w.season}:${w.episode}`];
    if (e && !e.done) return { season: w.season, episode: w.episode, position: e.position, resume: true };
    const eps = m.seasons?.find((s) => s.n === w.season)?.episodes ?? [];
    const next = eps.find((x) => x.n > w.episode);
    if (next) return { season: w.season, episode: next.n, position: 0, resume: true };
    const nextSeason = m.seasons?.find((s) => s.n > w.season && s.n !== 0);
    return nextSeason ? { season: nextSeason.n, episode: nextSeason.episodes[0]?.n ?? 1, position: 0, resume: true } : { season: w.season, episode: w.episode, position: 0, resume: true };
  }

  // ───────────── قطع الواجهة ─────────────

  function image(src, cls = 'an-img', { eager = false, position } = {}) {
    const img = new Image();
    img.alt = '';
    img.className = cls;
    img.decoding = 'async';
    if (!eager) img.loading = 'lazy';
    if (position) img.style.objectPosition = position;
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => img.classList.add('failed');
    if (src) img.src = src;
    return img;
  }
  const button = (cls, html, onClick, label) => {
    const b = el('button', cls);
    b.type = 'button';
    b.innerHTML = html;
    if (label) b.setAttribute('aria-label', label);
    b.onclick = onClick;
    return b;
  };
  const scoreBadge = (score) => {
    const s = el('span', 'an-score');
    s.innerHTML = `${glyph('star', { size: 12, filled: true })}<b>${score.toFixed(1)}</b>`;
    return s;
  };
  const metaLine = (m) => [TYPE_AR[m.type], m.year].filter(Boolean).join(' · ');
  const genreAr = (g) => GENRES_AR[g] ?? g;
  /** «49 min» ← «49 د». */
  const minutes = (runtime) => {
    const n = Number.parseInt(String(runtime ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? `${n} د` : null;
  };
  const seasonsLabel = (n) => (n === 1 ? 'موسم واحد' : n === 2 ? 'موسمان' : n <= 10 ? `${n} مواسم` : `${n} موسمًا`);

  function posterCard(m) {
    const c = el('button', 'an-card');
    c.type = 'button';
    c.setAttribute('aria-label', displayTitle(m));
    const art = el('div', 'an-poster');
    art.append(image(m.poster));
    if (m.rating) art.append(scoreBadge(m.rating));
    c.append(art);
    const t = el('span', 'an-card-title', displayTitle(m));
    t.dir = 'auto';
    c.append(t, el('span', 'an-card-meta', metaLine(m)));
    c.onclick = () => void openWork(m);
    return c;
  }

  function continueCard(w) {
    const e = w.episodes?.[`${w.season ?? 0}:${w.episode}`] ?? {};
    const ratio = e.duration ? Math.min(1, e.position / e.duration) : 0;
    const c = el('button', 'an-cw');
    c.type = 'button';
    const art = el('div', 'an-cw-art');
    art.append(image(w.poster));
    const info = el('div', 'an-cw-info');
    const t = el('span', 'an-cw-title', displayTitle(w));
    t.dir = 'auto';
    const bar = el('span', 'an-bar');
    const fill = el('i');
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    bar.append(fill);
    info.append(el('b', 'an-cw-ep', w.type === 'series' ? `الموسم ${w.season} · الحلقة ${w.episode}` : 'فيلم'), t, bar);
    c.append(art, info);
    c.onclick = () => void openWork(w);
    return c;
  }

  function rail(title, { sub, items = [], card = posterCard, more } = {}) {
    const s = el('section', 'an-rail');
    s.dataset.reveal = '';
    const head = el('div', 'an-rail-head');
    const titles = el('div', 'an-rail-titles');
    titles.append(el('h2', null, title));
    if (sub) titles.append(el('span', 'an-rail-sub', sub));
    head.append(titles);
    if (more) head.append(button('an-more', `<span>الكل</span>${glyph('chevron', { size: 16 })}`, more));
    const strip = el('div', 'an-strip');
    strip.append(...items.map((m) => card(m)));
    s.append(head, strip);
    return s;
  }

  function emptyBox(icon, title, text) {
    const box = el('div', 'an-empty');
    box.innerHTML = `<div class="an-empty-icon">${glyph(icon, { size: 30 })}</div><h3></h3><p></p>`;
    box.querySelector('h3').textContent = title;
    box.querySelector('p').textContent = text;
    return box;
  }

  // ───────────── الرئيسية ─────────────

  function heroBlock(m) {
    const hero = el('section', 'cn-hero');
    hero.dataset.reveal = '';
    const art = el('div', 'cn-hero-art');
    art.append(image(m.background ?? m.poster, 'an-img', { eager: true }), el('div', 'cn-hero-shade'));
    const copy = el('div', 'cn-hero-copy');
    const t = el('h2', 'cn-hero-title', displayTitle(m));
    t.dir = 'auto';
    const facts = [TYPE_AR[m.type], m.year, m.rating ? `IMDb ${m.rating.toFixed(1)}` : null, ...(m.genres ?? []).slice(0, 2).map(genreAr)].filter(Boolean).join(' · ');
    copy.append(el('span', 'cn-hero-kicker', 'الأكثر مشاهدة الآن'), t, el('span', 'cn-hero-facts', facts));
    const actions = el('div', 'cn-hero-actions');
    actions.append(button('an-btn an-btn--primary', `${glyph('play', { size: 18, filled: true })}<span>شاهد</span>`, () => void openWork(m, { autoplay: true })));
    actions.append(button('an-btn an-btn--glass', `${glyph('info', { size: 18 })}<span>التفاصيل</span>`, () => void openWork(m)));
    copy.append(actions);
    hero.append(art, copy);
    return hero;
  }

  function renderHome(data) {
    const blocks = el('div', 'an-home cn-home');
    if (data.movies?.[0]) blocks.append(heroBlock(data.movies[0]));
    const cont = continuing();
    if (cont.length) blocks.append(rail('أكمل المشاهدة', { items: cont.slice(0, 12), card: continueCard, more: () => openLibrary('continue') }));
    const later = Object.values(listAll()).filter((x) => x.later).sort((a, b) => b.later - a.later);
    if (later.length) blocks.append(rail('شاهد لاحقًا', { items: later.slice(0, 16), more: () => openLibrary('later') }));
    if (data.movies?.length) blocks.append(rail('أفلام رائجة', { items: data.movies.slice(1) }));
    if (data.series?.length) blocks.append(rail('مسلسلات رائجة', { items: data.series }));
    if (data.fresh?.length) blocks.append(rail(`أفلام ${new Date().getFullYear()}`, { sub: 'الأحدث هذه السنة', items: data.fresh }));
    if (data.topMovies?.length) blocks.append(rail('أعلى الأفلام تقييمًا', { items: data.topMovies }));
    if (data.topSeries?.length) blocks.append(rail('أعلى المسلسلات تقييمًا', { items: data.topSeries }));
    const chips = el('section', 'an-rail an-genres');
    const head = el('div', 'an-rail-head');
    head.append(el('h2', null, 'التصنيفات'));
    const row = el('div', 'an-chips');
    for (const g of GENRES) row.append(button('an-chip', genreAr(g), () => openDiscover({ genre: g })));
    chips.append(head, row);
    blocks.append(chips);
    blocks.append(el('p', 'an-credit', 'بيانات الأعمال من Cinemeta وWikidata · التشغيل من المصادر العربية'));
    q('cinemaHome').replaceChildren(blocks);
    return blocks;
  }

  function renderSkeleton() {
    const box = el('div', 'an-home');
    box.append(el('div', 'cn-hero an-skel'));
    for (let r = 0; r < 2; r++) {
      const rail = el('section', 'an-rail');
      const strip = el('div', 'an-strip');
      for (let i = 0; i < 5; i++) strip.append(el('div', 'an-skel an-skel-poster'));
      rail.append(strip);
      box.append(rail);
    }
    q('cinemaHome').replaceChildren(box);
  }

  async function fetchHome() {
    const y = String(new Date().getFullYear());
    const [movies, series, fresh, topMovies, topSeries] = await Promise.all([
      catalog('movie', 'top'),
      catalog('series', 'top'),
      catalog('movie', 'year', { genre: y }).catch(() => []),
      catalog('movie', 'imdbRating').catch(() => []),
      catalog('series', 'imdbRating').catch(() => []),
    ]);
    const cut = (list) => list.slice(0, 20);
    const data = { movies: cut(movies), series: cut(series), fresh: cut(fresh), topMovies: cut(topMovies), topSeries: cut(topSeries), fetchedAt: Date.now() };
    await withArabic([...data.movies, ...data.series, ...data.fresh, ...data.topMovies, ...data.topSeries]);
    return data;
  }

  async function loadHome({ force = false } = {}) {
    if (state.loading) return state.loading;
    const run = async () => {
      if (!state.home) {
        const cached = (await deps.readKv(HOME_KEY))?.value;
        if (cached?.movies) {
          state.home = cached;
          revealIn(renderHome(cached));
        } else renderSkeleton();
      }
      if (!force && state.home && Date.now() - (state.home.fetchedAt ?? 0) < STALE_MS) return;
      try {
        const fresh = await fetchHome();
        const first = !state.home;
        state.home = fresh;
        void deps.writeKv(HOME_KEY, fresh);
        if (first || deps.currentPage() !== 'home' || q('cinemaHome').hidden) {
          const view = renderHome(fresh);
          if (first) revealIn(view);
        }
      } catch {
        if (!state.home) {
          const box = emptyBox('offline', 'تعذّر جلب الأفلام', 'تحقّق من الاتصال ثم أعد المحاولة.');
          box.append(button('an-btn an-btn--primary', 'أعد المحاولة', () => void loadHome({ force: true })));
          q('cinemaHome').replaceChildren(box);
        }
      }
    };
    state.loading = run().finally(() => (state.loading = null));
    return state.loading;
  }

  function show() {
    if (state.home && !state.loading) renderHome(state.home);
    void loadHome();
  }

  const continuing = () => Object.values(watchAll()).filter((w) => w.at).sort((a, b) => b.at - a.at);

  // ───────────── المصادر ─────────────

  /** نسخ العمل (والموسم) في المصادر العربية، مع رقم حلقة الفيلم كما يرقّمه المصدر. */
  async function locate(m, season) {
    const key = playKey(m, season);
    if (state.works.has(key)) return state.works.get(key);
    const pending = (async () => {
      for (const query of queriesFor(m.title)) {
        const works = await engine.search(query, 'cinema');
        if (!works) return null;
        const copies = pickCopies(works, { title: m.title, year: m.year, type: m.type, season: m.type === 'series' ? season : null });
        if (!copies.length) continue;
        if (m.type === 'movie') {
          // رقم «الحلقة» الوحيدة للفيلم يختلف بين المصادر (0 أو 1): نأخذ رقم الأقوى ونبقي من يوافقه
          const lists = await Promise.all(copies.map((c) => engine.episodes(c).catch(() => null)));
          const numbers = lists.map((l) => l?.[0]?.number ?? null);
          const lead = numbers.find((n) => n != null) ?? 1;
          const kept = copies.filter((_, i) => numbers[i] == null || numbers[i] === lead);
          return { copies: kept, number: lead };
        }
        return { copies, number: null };
      }
      return { copies: [], number: null };
    })().catch(() => {
      state.works.delete(key);
      return null;
    });
    state.works.set(key, pending);
    return pending;
  }

  async function paintSources(m, season) {
    const host = q('cinemaSources');
    if (!host) return;
    const label = el('span', 'an-sources-label');
    if (!engine.available()) {
      label.textContent = 'التشغيل من المصادر العربية داخل تطبيق أندرويد';
      host.replaceChildren(label);
      return;
    }
    label.innerHTML = '<i class="an-sources-spin"></i><span>نبحث في المصادر العربية…</span>';
    host.replaceChildren(label);
    const found = await locate(m, season);
    if (q('cinemaSources') !== host || state.detail?.id !== m.id || (m.type === 'series' && state.season !== season)) return;
    const out = el('span', 'an-sources-label');
    if (!found) {
      out.textContent = 'تعذّر البحث في المصادر — تحقّق من الاتصال';
      host.replaceChildren(out, button('an-sources-retry', 'ابحث مجددًا', () => void paintSources(m, season)));
      return;
    }
    if (!found.copies.length) {
      out.textContent = m.type === 'series' ? `الموسم ${season} غير متوفر في المصادر العربية حاليًا` : 'غير متوفر في المصادر العربية حاليًا';
      host.replaceChildren(out, button('an-sources-retry', 'ابحث مجددًا', () => {
        state.works.delete(playKey(m, season));
        void paintSources(m, season);
      }));
      return;
    }
    out.textContent = 'متوفر في';
    const names = [...new Set(found.copies.map((c) => SOURCE_NAMES[c.sourceId] ?? c.sourceId))];
    host.replaceChildren(out, ...names.map((n, i) => el('span', 'an-source-chip', i ? n : `${n} ★`)));
  }

  // ───────────── صفحة العمل ─────────────

  async function openWork(m, { autoplay = false } = {}) {
    const token = ++state.token;
    state.detail = m;
    state.season = m.type === 'series' ? (watchAll()[m.id]?.season ?? 1) : null;
    deps.showPage('cinema');
    renderDetail(m, { partial: true });
    try {
      const full = await fetchDetail(m.type, m.id);
      if (token !== state.token || !full) return;
      await withArabic([full]);
      if (token !== state.token) return;
      if (full.type === 'series' && !full.seasons?.some((s) => s.n === state.season)) state.season = full.seasons?.find((s) => s.n !== 0)?.n ?? 1;
      state.detail = full;
      renderDetail(full);
      if (autoplay) {
        const r = resumePoint(full);
        play(full, r.season, r.episode, r.position);
      }
    } catch {
      if (token !== state.token) return;
      q('cinemaEpisodes')?.replaceChildren(el('p', 'an-note', 'تعذّر جلب التفاصيل — تحقّق من الاتصال.'));
    }
  }

  function renderDetail(m, { partial = false } = {}) {
    const page = q('cinema');
    const wrap = el('div', 'an-detail cn-detail');
    const bar = el('div', 'an-detail-top');
    bar.innerHTML = `${iconButton('back', 'رجوع', { act: 'goBack' })}<span class="an-detail-top-title" dir="auto"></span><span></span>`;
    bar.querySelector('.an-detail-top-title').textContent = displayTitle(m);

    const hero = el('div', 'an-detail-hero');
    const art = el('div', 'an-detail-art');
    art.append(image(m.background ?? m.poster, 'an-img', { eager: true, position: m.background ? 'center' : 'center 20%' }), el('div', 'an-detail-shade'));
    hero.append(art);

    const head = el('div', 'an-detail-head');
    const poster = el('div', 'an-detail-poster');
    poster.append(image(m.poster, 'an-img', { eager: true }));
    const titles = el('div', 'an-detail-titles');
    const h1 = el('h1', null, displayTitle(m));
    h1.dir = 'auto';
    titles.append(h1);
    if (m.titleAr && m.title !== m.titleAr) {
      const a = el('div', 'an-detail-alt', m.title);
      a.dir = 'ltr';
      titles.append(a);
    }
    head.append(poster, titles);

    const facts = el('div', 'an-facts');
    for (const f of [TYPE_AR[m.type], m.year, minutes(m.runtime), m.type === 'series' && m.seasons ? seasonsLabel(m.seasons.filter((s) => s.n !== 0).length) : null]) if (f) facts.append(el('span', 'an-fact', String(f)));
    if (m.rating) {
      const r = el('span', 'an-fact cn-imdb');
      r.innerHTML = `${glyph('star', { size: 12, filled: true })}<b></b>`;
      r.querySelector('b').textContent = `IMDb ${m.rating.toFixed(1)}`;
      facts.append(r);
    }

    const actions = el('div', 'an-detail-actions');
    const point = resumePoint(m);
    const many = (m.seasons ?? []).filter((s) => s.n !== 0).length > 1;
    const label = m.type === 'movie' ? (point.resume ? 'أكمل الفيلم' : 'شاهد الفيلم') : `${point.resume ? 'تابع' : 'شاهد'} الحلقة ${point.episode}${many ? ` من الموسم ${point.season}` : ''}`;
    actions.append(button('an-btn an-btn--primary an-btn--wide', `${glyph('play', { size: 20, filled: true })}<span>${label}</span>`, () => play(m, point.season, point.episode, point.position)));
    const toggle = (kind, icon, onLabel, offLabel) => {
      const b = el('button', 'an-btn an-btn--icon');
      b.type = 'button';
      const paint = () => {
        const on = inList(kind, m.id);
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', on ? onLabel : offLabel);
        b.title = on ? onLabel : offLabel;
        b.innerHTML = glyph(icon, { size: 20, filled: on });
      };
      paint();
      b.onclick = () => {
        const on = toggleList(kind, m);
        paint();
        pop(b);
        toast(on ? onLabel : kind === 'fav' ? 'أُزيل من المفضلة' : 'أُزيل من «شاهد لاحقًا»');
      };
      return b;
    };
    actions.append(toggle('later', 'clock', 'في «شاهد لاحقًا»', 'شاهد لاحقًا'), toggle('fav', 'heart', 'في المفضلة', 'المفضلة'));

    const sources = el('div', 'an-sources');
    sources.id = 'cinemaSources';
    wrap.append(bar, hero, head, facts, actions, sources);

    const about = el('section', 'an-block');
    if (m.descriptionAr) about.append(el('p', 'cn-tagline', m.descriptionAr));
    if (m.description) {
      const p = el('p', 'an-synopsis clamped', m.description);
      p.dir = 'auto';
      const more = button('an-more-text', 'المزيد', () => {
        const closed = p.classList.toggle('clamped');
        more.textContent = closed ? 'المزيد' : 'أقل';
      });
      about.append(p, more);
    }
    if (m.genres?.length) {
      const g = el('div', 'an-tags');
      for (const x of m.genres) g.append(button('an-tag', genreAr(x), () => openDiscover({ genre: x })));
      about.append(g);
    }
    const people = [m.director?.length ? `إخراج: ${m.director.join('، ')}` : null, m.cast?.length ? `بطولة: ${m.cast.slice(0, 5).join('، ')}` : null].filter(Boolean);
    for (const line of people) {
      const p = el('p', 'cn-credits', line);
      p.dir = 'auto';
      about.append(p);
    }
    if (about.childElementCount) wrap.append(about);

    if (m.type === 'series') {
      const eps = el('section', 'an-block an-episodes');
      eps.id = 'cinemaEpisodes';
      if (partial || !m.seasons) eps.append(el('div', 'an-skel an-skel-grid'));
      else renderEpisodes(eps, m);
      wrap.append(eps);
    }
    page.replaceChildren(wrap);
    if (!partial) {
      void paintSources(m, m.type === 'series' ? state.season : null);
      revealIn(wrap);
    }
  }

  function renderEpisodes(host, m) {
    const seasons = m.seasons.filter((s) => s.episodes.length);
    const season = seasons.find((s) => s.n === state.season) ?? seasons[0];
    if (!season) {
      host.replaceChildren(el('p', 'an-note', 'لا حلقات معروفة لهذا المسلسل بعد.'));
      return;
    }
    const head = el('div', 'an-rail-head an-rail-head--flat');
    const titles = el('div', 'an-rail-titles');
    titles.append(el('h2', null, 'الحلقات'), el('span', 'an-rail-sub', `${season.episodes.length} حلقة`));
    head.append(titles);
    const strip = el('div', 'an-ranges');
    for (const s of seasons) {
      const b = button(`an-range${s.n === season.n ? ' active' : ''}`, s.n === 0 ? 'إضافات' : `الموسم ${s.n}`, () => {
        state.season = s.n;
        renderEpisodes(host, m);
        void paintSources(m, s.n);
      });
      strip.append(b);
    }
    const watched = watchAll()[m.id]?.episodes ?? {};
    const now = Date.now();
    const list = el('div', 'an-er-list');
    for (const e of season.episodes) {
      const rec = watched[`${season.n}:${e.n}`];
      const ratio = rec?.duration ? Math.min(1, rec.position / rec.duration) : 0;
      const upcoming = e.released && e.released > now;
      const row = el('div', `an-er${rec?.done ? ' seen' : ''}`);
      const main = el('button', 'an-er-main');
      main.type = 'button';
      main.disabled = Boolean(upcoming);
      const art = el('span', 'an-er-art');
      art.append(image(e.thumb ?? m.background ?? m.poster, 'an-img'), el('span', 'an-er-no', String(e.n)));
      if (ratio > 0 && !rec?.done) {
        const bar = el('span', 'an-bar an-er-bar');
        const fill = el('i');
        fill.style.width = `${(ratio * 100).toFixed(1)}%`;
        bar.append(fill);
        art.append(bar);
      }
      const copy = el('span', 'an-er-copy');
      copy.append(el('b', null, `الحلقة ${e.n}`));
      const when = e.released ? new Date(e.released).toLocaleDateString('ar', { day: 'numeric', month: 'short', year: 'numeric', numberingSystem: 'latn' }) : null;
      const sub = el('span', 'an-er-sub', [e.title, upcoming ? `تُعرض ${when}` : null].filter(Boolean).join(' · ') || (rec?.done ? 'شوهدت' : ''));
      sub.dir = 'auto';
      copy.append(sub);
      main.append(art, copy);
      main.onclick = () => play(m, season.n, e.n, rec && !rec.done ? rec.position : 0);
      row.append(main);
      list.append(row);
    }
    host.replaceChildren(head, strip, list);
    requestAnimationFrame(() => strip.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
    stripIn([...list.children].slice(0, 8));
  }

  // ───────────── التشغيل ─────────────

  function play(m, season, n, position = 0) {
    const heading = m.type === 'series' ? `الموسم ${season} · الحلقة ${n}` : 'فيلم';
    if (!engine.available()) {
      deps.openSheet((body) => {
        const head = el('div', 'an-sheet-head');
        const t = el('div', 'an-sheet-title', displayTitle(m));
        t.dir = 'auto';
        head.append(el('div', 'an-sheet-kicker', heading), t);
        const note = el('div', 'an-sheet-note');
        note.innerHTML = `${glyph('layers', { size: 22 })}<div><b>التشغيل داخل التطبيق</b><span>المصادر العربية والسيرفرات تعمل في تطبيق VANTARA على أندرويد.</span></div>`;
        body.append(head, note);
      });
      return;
    }
    const sheet = { session: null, routes: [], done: false, closed: false, launched: false, busy: false, found: null, missing: false };
    let off = [];
    let queued = false;
    deps.openSheet((body) => {
      body.classList.add('an-pick');
      const bar = el('header', 'an-pick-bar');
      const back = button('an-pick-back', glyph('back', { size: 22 }), () => deps.closeSheet(), 'رجوع');
      const head = el('div', 'an-pick-heading');
      const name = el('span', 'an-pick-anime', displayTitle(m));
      name.dir = 'auto';
      head.append(el('b', null, heading), name);
      bar.append(back, head);
      const scroll = el('div', 'an-pick-scroll');
      const hero = el('div', 'an-pick-hero');
      const thumb = m.seasons?.find((s) => s.n === season)?.episodes.find((e) => e.n === n)?.thumb;
      hero.append(image(thumb ?? m.background ?? m.poster, 'an-img', { eager: true }));
      const cap = el('div', 'an-pick-cap');
      cap.append(el('span', 'an-pick-no', heading));
      if (position > 5000) cap.append(el('span', 'an-pick-resume', `تكمل من ${engine.clock(position)}`));
      hero.append(cap);
      const status = el('div', 'an-srv-status');
      const list = el('div', 'an-srv-list');
      scroll.append(hero, status, list);
      const foot = el('footer', 'an-pick-foot');
      const best = el('button', 'an-pick-best');
      best.type = 'button';
      foot.append(best);
      body.append(bar, scroll, foot);

      const paint = () => {
        queued = false;
        if (sheet.closed) return;
        const ready = sheet.routes.filter((r) => r.state === 'READY').length;
        if (sheet.missing) status.textContent = m.type === 'series' ? `الموسم ${season} غير متوفر في المصادر العربية حاليًا` : 'غير متوفر في المصادر العربية حاليًا';
        else if (!sheet.session) status.innerHTML = '<i class="an-sources-spin"></i><span>نبحث في المصادر العربية…</span>';
        else if (!sheet.done && !ready) status.innerHTML = '<i class="an-sources-spin"></i><span>نجهّز أول سيرفر…</span>';
        else status.textContent = ready ? `${ready} ${ready === 1 ? 'سيرفر جاهز' : 'سيرفرات جاهزة'}${sheet.done ? '' : ' · البقية تصل بالخلفية'}` : 'لم يجهز أي سيرفر الآن';
        best.disabled = sheet.busy || sheet.missing || (!ready && sheet.done);
        best.innerHTML = `${glyph('play', { size: 20, filled: true })}<span>${sheet.busy ? 'نجهّز أفضل سيرفر…' : 'شغّل الأفضل'}</span>`;
        best.classList.toggle('waiting', !ready && !sheet.done && !sheet.missing);
        list.replaceChildren(
          ...engine.groupRoutes(sheet.routes).map(([group, routes]) => {
            const g = el('section', 'an-srv-group');
            const grid = el('div', 'an-srv-grid');
            for (const r of routes) {
              const b = el('button', `an-srv an-srv--${r.state.toLowerCase()}`);
              b.type = 'button';
              b.disabled = r.state === 'RESOLVING';
              const top = el('span', 'an-srv-top');
              const code = el('b', 'an-srv-code', r.code);
              code.dir = 'ltr';
              top.append(code, el('span', 'an-srv-tag', SOURCE_NAMES[r.sourceId] ?? r.sourceId));
              const line = el('span', 'an-srv-state');
              line.append(el('i', 'an-srv-dot'), el('span', null, STATE_AR[r.state] ?? ''));
              b.append(top, line);
              b.onclick = () => (r.state === 'READY' ? void playRoute(r) : toast(r.reason || 'لم يُستخرج رابط فيديو من المشغّل', 5000));
              grid.append(b);
            }
            g.append(el('h4', 'an-srv-q', group), grid);
            return g;
          }),
        );
      };
      const queuePaint = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(paint);
      };
      const playRoute = async (r) => {
        if (sheet.busy) return;
        sheet.busy = true;
        queuePaint();
        try {
          const candidate = await engine.pick(sheet.session, r.id);
          if (!candidate) return void toast('هذا السيرفر لم يعد متاحًا — جرّب غيره');
          await launch(candidate, r.code);
        } catch (e) {
          toast(`تعذّر التشغيل: ${e?.message ?? e}`);
        } finally {
          sheet.busy = false;
          queuePaint();
        }
      };
      best.onclick = async () => {
        if (sheet.busy || !sheet.session) return;
        sheet.busy = true;
        queuePaint();
        try {
          const out = await engine.best(sheet.session);
          if (sheet.closed) return;
          if (!out?.candidate) return void toast('لم يجهز أي سيرفر الآن');
          await launch(out.candidate, out.code);
        } catch (e) {
          toast(`تعذّر التشغيل: ${e?.message ?? e}`);
        } finally {
          sheet.busy = false;
          queuePaint();
        }
      };
      paint();

      void (async () => {
        const found = await locate(m, season);
        if (sheet.closed) return;
        if (!found?.copies.length) {
          sheet.missing = true;
          queuePaint();
          return;
        }
        sheet.found = found;
        off.push(
          engine.on('route', (e) => {
            if (e.session !== sheet.session) return;
            const i = sheet.routes.findIndex((r) => r.id === e.route.id);
            if (i >= 0) sheet.routes[i] = e.route;
            else sheet.routes.push(e.route);
            queuePaint();
          }),
          engine.on('prepared', (e) => {
            if (e.session !== sheet.session) return;
            sheet.done = true;
            queuePaint();
          }),
        );
        try {
          const out = await engine.prepare({ copies: found.copies, episode: m.type === 'movie' ? found.number : n });
          if (sheet.closed) {
            if (out?.session) void engine.closeSession(out.session);
            return;
          }
          sheet.session = out.session;
          const snap = await engine.routes(out.session);
          sheet.routes = snap?.routes ?? out.routes ?? [];
          sheet.done = Boolean(snap?.done ?? out.done);
          queuePaint();
        } catch (e) {
          status.textContent = `تعذّر تجهيز السيرفرات: ${e?.message ?? e}`;
        }
      })();

      return () => {
        sheet.closed = true;
        for (const f of off) f();
        off = [];
        if (!sheet.launched && sheet.session) void engine.closeSession(sheet.session);
      };
    }, { tone: 'cinema', full: true });

    async function launch(candidate, code) {
      sheet.launched = true;
      deps.closeSheet();
      const key = playKey(m, season);
      const eps = m.type === 'series' ? m.seasons?.find((s) => s.n === season)?.episodes ?? [] : [];
      const watched = watchAll()[m.id]?.episodes ?? {};
      const resume = {};
      for (const e of eps) {
        const rec = watched[`${season}:${e.n}`];
        if (rec && !rec.done && rec.position > 5000) resume[e.n] = rec.position;
      }
      flushWatch();
      clock.pos = null;
      clock.at = null;
      state.playing = { key, m, season, n: m.type === 'movie' ? 1 : n, number: m.type === 'movie' ? sheet.found.number : null, userId: currentUser() };
      const title = m.type === 'series' ? `${displayTitle(m)} · الموسم ${season}` : displayTitle(m);
      deps.setWatching?.({ ref: `cinema:${key}`, title, episode: m.type === 'series' ? n : null });
      const presence = await deps.playerPresence?.();
      await engine.open({
        session: sheet.session,
        candidate,
        prefer: code ?? null,
        title,
        animeId: key,
        section: 'cinema',
        usageUserId: currentUser(),
        episode: m.type === 'movie' ? sheet.found.number : n,
        total: m.type === 'series' ? eps.length : 1,
        position,
        poster: m.poster ?? null,
        friends: [],
        copies: sheet.found.copies,
        resume,
        presenceEndpoint: presence?.endpoint ?? null,
        presenceAuthorization: presence?.authorization ?? null,
        presenceUserId: presence?.userId ?? null,
        presenceDeviceId: presence?.deviceId ?? null,
        presenceDeviceCredential: presence?.deviceCredential ?? null,
      });
    }
  }

  // الوقت: المشغّل الأصلي الحديث يحتسبه بنفسه للسينما؛ وإلا نحتسبه هنا من التقدّم
  const clock = { pos: null, at: null, acc: 0 };
  function flushWatch() {
    const cur = state.playing;
    if (!cur || clock.acc < 1000) return;
    if (cur.userId !== currentUser()) {
      clock.acc = 0;
      return;
    }
    const ms = Math.round(clock.acc);
    deps.sync?.enqueue('usage.watch', { section: 'cinema', day: new Date().toISOString().slice(0, 10), activeMs: ms });
    deps.sync?.enqueue('usage.work', { section: 'cinema', seriesRef: `cinema:${cur.key}`, seriesTitle: displayTitle(cur.m), coverUrl: cur.m.poster ?? null, activeMs: ms });
    clock.acc = 0;
  }
  engine.on('playback', (p) => {
    const cur = state.playing;
    if (!cur || String(p.animeId ?? '') !== cur.key || cur.userId !== currentUser()) return;
    if (!nativeFollowTime() && Number.isFinite(p.position)) {
      const now = Date.now();
      const d = clock.pos === null ? 0 : p.position - clock.pos;
      const elapsed = clock.at === null ? 0 : Math.max(0, now - clock.at);
      if (d > 0 && d <= 15_000) clock.acc += Math.min(d, elapsed + 1000);
      clock.pos = p.position;
      clock.at = now;
      if (clock.acc >= 60_000) flushWatch();
    }
    const n = cur.m.type === 'series' && Number.isFinite(p.episode) && p.episode > 0 ? p.episode : cur.n;
    if (p.duration > 0) recordWatch(cur.m, cur.m.type === 'series' ? cur.season : 0, n, p.position, p.duration);
    cur.n = n;
    if (p.final) {
      void flushFollowTime(deps.sync).catch(() => {});
      flushWatch();
      clock.pos = null;
      clock.at = null;
      state.playing = null;
      deps.setWatching?.(null);
      if (deps.currentPage() === 'cinema' && state.detail?.id === cur.m.id) renderDetail(state.detail);
    }
  });

  // ───────────── اكتشف والمكتبة ─────────────

  function openDiscover({ genre = '', query = '' } = {}) {
    state.discover = { ...state.discover, genre, query };
    deps.showPage('discover');
  }

  function showDiscover() {
    const host = q('cinemaDiscover');
    if (!host) return;
    const d = state.discover;
    const form = el('form', 'search-bar an-search');
    form.setAttribute('role', 'search');
    form.innerHTML = `${glyph('search')}<input class="search-input" type="search" enterkeyhint="search" autocomplete="off" placeholder="ابحث عن فيلم أو مسلسل (بالإنجليزي)" aria-label="ابحث عن فيلم أو مسلسل">`;
    const input = form.querySelector('input');
    input.value = d.query;
    let t = null;
    input.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.discover.query = input.value.trim();
        state.discover.genre = '';
        paintChips();
        void loadDiscover();
      }, 400);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      clearTimeout(t);
      state.discover.query = input.value.trim();
      void loadDiscover();
      input.blur();
    };
    const chips = el('div', 'an-chips an-chips--filter');
    const paintChips = () => {
      chips.replaceChildren(
        ...GENRES.map((g) =>
          button(`an-chip${state.discover.genre === g ? ' active' : ''}`, genreAr(g), () => {
            state.discover.genre = state.discover.genre === g ? '' : g;
            state.discover.query = '';
            input.value = '';
            paintChips();
            void loadDiscover();
          }),
        ),
      );
    };
    paintChips();
    const grid = el('div', 'an-grid');
    grid.id = 'cinemaDiscoverGrid';
    host.replaceChildren(form, chips, grid);
    void loadDiscover();
  }

  async function loadDiscover() {
    const grid = q('cinemaDiscoverGrid');
    if (!grid) return;
    const token = ++state.discover.token;
    const { query, genre } = state.discover;
    grid.replaceChildren(...Array.from({ length: 6 }, () => el('div', 'an-skel an-skel-poster')));
    try {
      let items;
      if (query) items = await searchMeta(query);
      else {
        const [mv, sr] = await Promise.all([catalog('movie', 'top', { genre }), catalog('series', 'top', { genre })]);
        items = [];
        for (let i = 0; i < Math.max(mv.length, sr.length); i++) items.push(mv[i], sr[i]);
        items = items.filter(Boolean);
      }
      items = items.slice(0, 40);
      await withArabic(items);
      if (token !== state.discover.token) return;
      grid.replaceChildren(...(items.length ? items.map((m) => posterCard(m)) : [emptyBox('search', 'لا نتائج', 'جرّب الاسم الإنجليزي للعمل.')]));
      stripIn([...grid.children].slice(0, 12));
    } catch {
      if (token === state.discover.token) grid.replaceChildren(emptyBox('offline', 'تعذّر البحث', 'تحقّق من الاتصال ثم أعد المحاولة.'));
    }
  }

  function openLibrary(tab) {
    state.libraryTab = tab;
    deps.showPage('library');
  }

  function renderLibrary() {
    const host = q('cinemaLibrary');
    if (!host) return;
    const tabs = el('div', 'an-seg');
    for (const [k, label] of [['continue', 'أكمل المشاهدة'], ['later', 'شاهد لاحقًا'], ['fav', 'المفضلة']]) {
      tabs.append(button(`an-seg-btn${state.libraryTab === k ? ' active' : ''}`, label, () => {
        state.libraryTab = k;
        renderLibrary();
      }));
    }
    const items = state.libraryTab === 'continue'
      ? continuing()
      : Object.values(listAll()).filter((x) => x[state.libraryTab]).sort((a, b) => b[state.libraryTab] - a[state.libraryTab]);
    const grid = el('div', 'an-grid');
    grid.append(...items.map((m) => posterCard(m)));
    const empty = { continue: ['play', 'لم تشاهد شيئًا بعد', 'ما تبدأ مشاهدته يظهر هنا لتكمله.'], later: ['clock', 'القائمة فاضية', 'أضف من صفحة أي فيلم أو مسلسل بزر الساعة.'], fav: ['heart', 'لا مفضلات بعد', 'علّم ما تحب بزر القلب.'] }[state.libraryTab];
    host.replaceChildren(tabs, items.length ? grid : emptyBox(...empty), el('p', 'an-note', 'قائمة السينما محفوظة على هذا الجهاز.'));
  }

  return { show, loadHome, openWork, showDiscover, renderLibrary, openDiscover };
}
