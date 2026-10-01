/**
 * VANTARA CINEMA — أفلام ومسلسلات عالمية مترجمة.
 *
 * البيانات من Cinemeta (والعربية من Wikidata)، والتشغيل من أربعة مصادر عربية
 * (FaselHD، ArabSeed، EgyDead، Cimaleek) عبر محرك الأنمي نفسه بمحتوى `cinema`.
 *
 * التصميم خاص بالسينما (`cn-` في cinema.css): الصورة تُعرض كاملة لا يغطيها
 * شيء، والكلام والأزرار تحتها؛ ملصقات بحواف حادة، وقائمة IMDb مرقّمة.
 * المشترك مع بقية VANTARA: الهيكل، والتنقّل، وورقة السيرفرات والمشغّل بلون
 * القسم.
 *
 * المتابعة («أكمل»، «لاحقًا»، «المفضلة») محفوظة على هذا الجهاز لكل حساب؛
 * والوقت يُحتسب لقسم السينما في الإحصاءات.
 */

import { nativeFollowTime, flushFollowTime } from '../lib/follow-time.js';
import { glyph, iconButton } from './icons.js';
import { pop, progressFill, reduced, revealIn, stripIn } from './motion.js';
import * as engine from '../lib/anime-engine.js';
import { GENRES_AR, TYPE_AR, catalog, detail as fetchDetail, displayTitle, search as searchMeta, withArabic } from '../lib/cinema-meta.js';
import { pickCopies, queriesFor } from '../lib/cinema-match.js';

const HOME_KEY = 'cinema.home.v2';
const STALE_MS = 6 * 3_600_000;
const HERO_SECONDS = 8;
const STATE_AR = { RESOLVING: 'يتجهّز…', READY: 'جاهز', UNAVAILABLE: 'غير متاح', FAILED: 'فشل التشغيل' };
const SOURCE_NAMES = { faselhd: 'FaselHD', arabseed: 'ArabSeed', egydead: 'EgyDead', cimaleek: 'Cimaleek' };
const GENRES = ['Action', 'Drama', 'Thriller', 'Comedy', 'Crime', 'Sci-Fi', 'Horror', 'Romance', 'Adventure', 'Mystery', 'Fantasy', 'Animation', 'War', 'History', 'Documentary', 'Family'];

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
const slim = (m) => ({ id: m.id, type: m.type, title: m.title, titleAr: m.titleAr ?? null, poster: m.poster, background: m.background, logo: m.logo ?? null, year: m.year, rating: m.rating, genres: (m.genres ?? []).slice(0, 3) });

/** «112 min» ← «1 س 52 د». */
export function runtimeAr(runtime) {
  const n = Number.parseInt(String(runtime ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h} س${m ? ` ${m} د` : ''}` : `${m} د`;
}
/** «باقي 34 د» من موضع ومدة بالملّي ثانية. */
export function remainingAr(position, duration) {
  if (!duration || position >= duration) return null;
  const left = Math.max(1, Math.round((duration - position) / 60_000));
  return left >= 60 ? `باقي ${Math.floor(left / 60)} س ${left % 60} د` : `باقي ${left} د`;
}
export const seasonsAr = (n) => (n === 1 ? 'موسم واحد' : n === 2 ? 'موسمان' : n <= 10 ? `${n} مواسم` : `${n} موسمًا`);

export function createCinema(deps) {
  const { q, el, toast } = deps;
  const currentUser = () => deps.sync?.user?.userId ?? null;
  const state = {
    home: null,
    loading: null,
    kind: 'all',
    hero: { index: 0, tween: null, items: [] },
    detail: null,
    details: new Map(),
    season: 1,
    token: 0,
    works: new Map(),
    playing: null,
    libraryTab: 'continue',
    discover: { query: '', genre: '', type: 'movie', token: 0 },
  };

  // ───────────── التخزين المحلي ─────────────

  const watchAll = () => readJson(userKey('watch', currentUser()), {});
  const listAll = () => readJson(userKey('list', currentUser()), {});
  function recordWatch(m, season, n, position, duration) {
    const all = watchAll();
    const w = all[m.id] ?? { ...slim(m), episodes: {} };
    Object.assign(w, slim(m));
    const ep = `${season ?? 0}:${n}`;
    const done = Boolean(w.episodes[ep]?.done) || (duration > 0 && position / duration >= 0.9);
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
  /** من أين يكمل: آخر حلقة غير مكتملة، أو التالية لآخر مكتملة. */
  function resumePoint(m) {
    const w = watchAll()[m.id];
    if (m.type === 'movie') {
      const e = w?.episodes?.['0:1'];
      const resume = Boolean(e && !e.done && e.position > 5000);
      return { season: null, episode: 1, position: resume ? e.position : 0, resume, record: e ?? null };
    }
    const first = m.seasons?.find((s) => s.n !== 0);
    if (!w?.episode) return { season: first?.n ?? 1, episode: first?.episodes[0]?.n ?? 1, position: 0, resume: false, record: null };
    const e = w.episodes?.[`${w.season}:${w.episode}`];
    if (e && !e.done) return { season: w.season, episode: w.episode, position: e.position, resume: true, record: e };
    const eps = m.seasons?.find((s) => s.n === w.season)?.episodes ?? [];
    const next = eps.find((x) => x.n > w.episode);
    if (next) return { season: w.season, episode: next.n, position: 0, resume: true, record: null };
    const nextSeason = m.seasons?.find((s) => s.n > w.season && s.n !== 0);
    return nextSeason
      ? { season: nextSeason.n, episode: nextSeason.episodes[0]?.n ?? 1, position: 0, resume: true, record: null }
      : { season: w.season, episode: w.episode, position: 0, resume: true, record: null };
  }
  const continuing = () => Object.values(watchAll()).filter((w) => w.at).sort((a, b) => b.at - a.at);

  // ───────────── قطع صغيرة ─────────────

  function image(src, cls = 'cn-img', { eager = false, fallback = null } = {}) {
    const img = new Image();
    img.alt = '';
    img.className = cls;
    img.decoding = 'async';
    if (!eager) img.loading = 'lazy';
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => {
      // صورة الحلقة غير موجودة بعد: خلفية العمل بدل مربع فارغ
      if (fallback && img.src !== fallback) img.src = fallback;
      else img.classList.add('failed');
    };
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
  const genreAr = (g) => GENRES_AR[g] ?? g;
  /** وصف Wikidata العام («مسلسل تلفزيوني») لا يضيف شيئًا: يُعرض الوصف المفيد فقط. */
  const meaningful = (d) => Boolean(d) && d.length >= 24;
  const text = (tag, cls, value, dir = 'auto') => {
    const n = el(tag, cls, value);
    n.dir = dir;
    return n;
  };
  /** شعار العنوان الرسمي إن وُجد، وإلا العنوان نصًا. */
  function titleMark(m, cls) {
    const box = el('div', `cn-mark ${cls}`);
    const name = text('h2', 'cn-mark-text', displayTitle(m));
    box.append(name);
    if (m.logo && !m.titleAr) {
      const logo = image(m.logo, 'cn-mark-logo', { eager: true });
      logo.alt = displayTitle(m);
      logo.onload = () => {
        logo.classList.add('loaded');
        box.classList.add('has-logo');
      };
      box.prepend(logo);
    }
    return box;
  }
  /** نجمة IMDb ورقمها: الشيء الوحيد الملوّن في السطر. */
  function imdb(rating) {
    const s = el('span', 'cn-imdb');
    s.innerHTML = `<b>IMDb</b><span>${rating.toFixed(1)}</span>`;
    return s;
  }
  const facts = (m, { runtime = false } = {}) => {
    const line = el('div', 'cn-facts');
    for (const f of [TYPE_AR[m.type], m.year, runtime ? runtimeAr(m.runtime) : null]) if (f) line.append(el('span', null, String(f)));
    if (m.rating) line.append(imdb(m.rating));
    return line;
  };
  function emptyBox(icon, title, body) {
    const box = el('div', 'cn-empty');
    box.innerHTML = glyph(icon, { size: 26 });
    box.append(el('h3', null, title), el('p', null, body));
    return box;
  }
  /** يبدأ جلب التفاصيل مع أول لمسة، فتفتح الصفحة جاهزة غالبًا. */
  function prefetch(m) {
    if (!m?.id || state.details.has(m.id)) return state.details.get(m.id);
    const p = fetchDetail(m.type, m.id)
      .then(async (full) => (full ? (await withArabic([full]))[0] : null))
      .catch(() => {
        state.details.delete(m.id);
        return null;
      });
    state.details.set(m.id, p);
    return p;
  }
  const opener = (node, m, opts) => {
    node.addEventListener('pointerdown', () => void prefetch(m), { passive: true });
    node.onclick = () => void openWork(m, opts);
    return node;
  };

  // ───────────── البطاقات ─────────────

  /** ملصق: الصورة نظيفة بلا شارات فوقها، والمعلومة تحتها. */
  function posterCard(m) {
    const c = el('button', 'cn-poster');
    c.type = 'button';
    c.setAttribute('aria-label', displayTitle(m));
    const art = el('span', 'cn-poster-art');
    art.append(image(m.poster));
    const meta = el('span', 'cn-poster-meta');
    meta.append(el('span', null, String(m.year ?? TYPE_AR[m.type] ?? '')));
    if (m.rating) meta.append(el('span', 'cn-poster-rate', `★ ${m.rating.toFixed(1)}`));
    c.append(art, text('span', 'cn-poster-title', displayTitle(m)), meta);
    return opener(c, m);
  }

  /** «أكمل المشاهدة»: إطار عريض، شريط أحمر رفيع، وكم باقي. */
  function continueCard(w) {
    const e = w.episodes?.[`${w.season ?? 0}:${w.episode}`] ?? {};
    const ratio = e.duration ? Math.min(1, e.position / e.duration) : 0;
    const c = el('button', 'cn-wide');
    c.type = 'button';
    const art = el('span', 'cn-wide-art');
    art.append(image(w.background ?? w.poster));
    const bar = el('span', 'cn-progress');
    const fill = el('i');
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    bar.append(fill);
    art.append(bar);
    const where = w.type === 'series' ? `الموسم ${w.season} · الحلقة ${w.episode}` : 'فيلم';
    const left = e.done ? 'شوهد' : remainingAr(e.position, e.duration);
    c.append(art, text('span', 'cn-wide-title', displayTitle(w)), el('span', 'cn-wide-sub', [where, left].filter(Boolean).join(' · ')));
    return opener(c, w, { autoplay: false });
  }

  function rail(title, items, card = posterCard, { more, sub } = {}) {
    const s = el('section', 'cn-rail');
    s.dataset.reveal = '';
    const head = el('header', 'cn-rail-head');
    const h = el('h2', null, title);
    head.append(h);
    if (sub) head.append(el('span', 'cn-rail-sub', sub));
    if (more) head.append(button('cn-rail-more', `الكل${glyph('chevron', { size: 14 })}`, more));
    const strip = el('div', 'cn-strip');
    strip.append(...items.map((m) => card(m)));
    s.append(head, strip);
    return s;
  }

  /** قائمة IMDb: أعمدة من ثلاثة، بالرقم والملصق الصغير والتقييم. */
  function chart(title, items) {
    const s = el('section', 'cn-rail cn-chart');
    s.dataset.reveal = '';
    const head = el('header', 'cn-rail-head');
    head.append(el('h2', null, title), el('span', 'cn-rail-sub', 'IMDb'));
    const grid = el('ol', 'cn-chart-grid');
    items.slice(0, 12).forEach((m, i) => {
      const li = el('li');
      const row = el('button', 'cn-chart-row');
      row.type = 'button';
      const art = el('span', 'cn-chart-art');
      art.append(image(m.poster));
      const copy = el('span', 'cn-chart-copy');
      copy.append(text('b', null, displayTitle(m)), el('span', null, [m.year, (m.genres ?? []).slice(0, 2).map(genreAr).join('، ')].filter(Boolean).join(' · ')));
      row.append(el('span', 'cn-chart-rank', String(i + 1)), art, copy);
      if (m.rating) row.append(el('span', 'cn-chart-rate', m.rating.toFixed(1)));
      li.append(opener(row, m));
      grid.append(li);
    });
    s.append(head, grid);
    return s;
  }

  function genreGrid(onPick) {
    const s = el('section', 'cn-rail');
    s.dataset.reveal = '';
    const head = el('header', 'cn-rail-head');
    head.append(el('h2', null, 'حسب النوع'));
    const grid = el('div', 'cn-genres');
    for (const g of GENRES) {
      const b = button('cn-genre', '', () => onPick(g));
      b.append(el('b', null, genreAr(g)), text('span', null, g, 'ltr'));
      grid.append(b);
    }
    s.append(head, grid);
    return s;
  }

  // ───────────── الواجهة الكبرى ─────────────
  // الصورة كاملة بلا ما يغطيها؛ العنوان والأزرار تحتها. تتبدّل كل 8 ثوانٍ
  // بتلاشٍ هادئ، والسحب يقلّبها يدويًا.

  function billboard(items) {
    const box = el('section', 'cn-bill');
    const stage = el('div', 'cn-bill-stage');
    const info = el('div', 'cn-bill-info');
    const ticks = el('div', 'cn-bill-ticks');
    const bars = items.map(() => {
      const t = el('span', 'cn-tick');
      const fill = el('i');
      t.append(fill);
      ticks.append(t);
      return fill;
    });
    box.append(stage, info, ticks);
    state.hero = { index: 0, tween: null, items };

    const paint = (i, first = false) => {
      const m = items[i];
      state.hero.index = i;
      const img = image(m.background ?? m.poster, 'cn-img cn-bill-img', { eager: first || i < 2 });
      stage.append(img);
      const settle = () => {
        img.classList.add('loaded');
        // الصورة السابقة تبقى تحت حتى تكتمل الجديدة: لا وميض أسود بينهما
        setTimeout(() => [...stage.children].slice(0, -1).forEach((n) => n.remove()), 700);
      };
      if (img.complete && img.naturalWidth) settle();
      else img.addEventListener('load', settle, { once: true });

      const top = el('div', 'cn-bill-top');
      top.append(titleMark(m, 'cn-bill-mark'), facts(m));
      const genres = (m.genres ?? []).slice(0, 3).map(genreAr).join(' · ');
      const actions = el('div', 'cn-bill-actions');
      const play = button('cn-btn cn-btn--play', `${glyph('play', { size: 18, filled: true })}<span>شاهد</span>`, () => void openWork(m, { autoplay: true }));
      const later = button('cn-btn cn-btn--ghost', '', () => {
        const on = toggleList('later', m);
        paintLater();
        pop(later);
        toast(on ? 'أُضيف إلى «شاهد لاحقًا»' : 'أُزيل من «شاهد لاحقًا»');
      });
      const paintLater = () => {
        const on = inList('later', m.id);
        later.innerHTML = `${glyph(on ? 'check' : 'plus', { size: 18 })}<span>قائمتي</span>`;
        later.setAttribute('aria-pressed', String(on));
      };
      paintLater();
      const more = opener(button('cn-btn cn-btn--icon', glyph('info', { size: 20 }), null, 'التفاصيل'), m);
      actions.append(play, later, more);
      info.replaceChildren(top, ...(genres ? [el('p', 'cn-bill-genres', genres)] : []), actions);

      bars.forEach((b, k) => {
        b.parentElement.classList.toggle('done', k < i);
        b.style.transform = k < i ? 'scaleX(1)' : 'scaleX(0)';
      });
      state.hero.tween?.kill?.();
      if (items.length > 1 && !reduced()) state.hero.tween = progressFill(bars[i], HERO_SECONDS, () => next(1));
      else bars[i].style.transform = 'scaleX(1)';
    };
    const next = (step) => {
      if (!box.isConnected || document.hidden || deps.currentPage() !== 'home' || q('cinemaHome').hidden) {
        // خارج الشاشة: لا تقليب في الخلفية، نعيد المحاولة لاحقًا
        state.hero.tween = progressFill(bars[state.hero.index], HERO_SECONDS, () => next(step));
        return;
      }
      paint((state.hero.index + step + items.length) % items.length);
    };

    // سحب أفقي على الصورة يقلّب (اليمين في العربية = السابق)
    let x0 = null;
    stage.addEventListener('pointerdown', (e) => (x0 = e.clientX), { passive: true });
    stage.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 40) next(dx > 0 ? 1 : -1);
      else void openWork(items[state.hero.index]);
    });
    paint(0, true);
    return box;
  }

  // ───────────── الرئيسية ─────────────

  function kindTabs() {
    const tabs = el('nav', 'cn-kinds');
    tabs.setAttribute('aria-label', 'النوع');
    for (const [k, label] of [['all', 'الكل'], ['movie', 'أفلام'], ['series', 'مسلسلات']]) {
      const b = button(`cn-kind${state.kind === k ? ' active' : ''}`, label, () => {
        if (state.kind === k) return;
        state.kind = k;
        renderHome(state.home);
      });
      b.setAttribute('aria-pressed', String(state.kind === k));
      tabs.append(b);
    }
    return tabs;
  }

  function renderHome(data) {
    state.hero.tween?.kill?.();
    const page = el('div', 'cn-home');
    const k = state.kind;
    const wants = (t) => k === 'all' || k === t;
    const heroItems = (k === 'series' ? data.series : k === 'movie' ? data.movies : [data.movies?.[0], data.series?.[0], data.movies?.[1], data.series?.[1], data.movies?.[2]])
      .filter((m) => m && (m.background || m.poster))
      .slice(0, 5);
    page.append(kindTabs());
    if (heroItems.length) page.append(billboard(heroItems));
    const cont = continuing().filter((w) => wants(w.type));
    if (cont.length) page.append(rail('أكمل المشاهدة', cont.slice(0, 12), continueCard, { more: () => openLibrary('continue') }));
    const later = Object.values(listAll()).filter((x) => x.later && wants(x.type)).sort((a, b) => b.later - a.later);
    if (later.length) page.append(rail('قائمتي', later.slice(0, 16), posterCard, { more: () => openLibrary('later') }));
    const skip = new Set(heroItems.map((m) => m.id));
    const rest = (list) => (list ?? []).filter((m) => !skip.has(m.id));
    if (wants('movie') && data.movies?.length) page.append(rail('أفلام رائجة الآن', rest(data.movies)));
    if (wants('series') && data.series?.length) page.append(rail('مسلسلات يتابعها الجميع', rest(data.series)));
    if (wants('movie') && data.topMovies?.length) page.append(chart('أعلى الأفلام تقييمًا', data.topMovies));
    if (wants('movie') && data.fresh?.length) page.append(rail(`جديد ${new Date().getFullYear()}`, data.fresh, posterCard, { sub: 'صدرت هذه السنة' }));
    if (wants('series') && data.topSeries?.length) page.append(chart('أعلى المسلسلات تقييمًا', data.topSeries));
    page.append(genreGrid((g) => openDiscover({ genre: g, type: k === 'series' ? 'series' : 'movie' })));
    page.append(el('p', 'cn-credit', 'بيانات الأعمال من Cinemeta وWikidata · التشغيل من المصادر العربية'));
    q('cinemaHome').replaceChildren(page);
    return page;
  }

  function renderSkeleton() {
    const page = el('div', 'cn-home');
    page.append(kindTabs(), el('div', 'cn-bill-stage cn-skel'));
    const bar = el('div', 'cn-skel cn-skel-line');
    page.append(bar);
    for (let r = 0; r < 2; r++) {
      const strip = el('div', 'cn-strip');
      for (let i = 0; i < 4; i++) strip.append(el('div', 'cn-skel cn-skel-poster'));
      page.append(strip);
    }
    q('cinemaHome').replaceChildren(page);
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
    const cut = (list) => list.slice(0, 20).map(slim);
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
          box.append(button('cn-btn cn-btn--play', 'أعد المحاولة', () => void loadHome({ force: true })));
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
          return { copies: copies.filter((_, i) => numbers[i] == null || numbers[i] === lead), number: lead };
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
    if (!engine.available()) {
      host.replaceChildren(el('span', null, 'التشغيل من المصادر العربية داخل تطبيق أندرويد'));
      host.dataset.state = 'web';
      return;
    }
    host.dataset.state = 'loading';
    host.replaceChildren(el('i', 'cn-dot'), el('span', null, 'نبحث في المصادر العربية…'));
    const found = await locate(m, season);
    if (q('cinemaSources') !== host || state.detail?.id !== m.id || (m.type === 'series' && state.season !== season)) return;
    const retry = () =>
      button('cn-link', 'ابحث مجددًا', () => {
        state.works.delete(playKey(m, season));
        void paintSources(m, season);
      });
    if (!found || !found.copies.length) {
      host.dataset.state = 'none';
      const msg = !found ? 'تعذّر البحث في المصادر — تحقّق من الاتصال' : m.type === 'series' ? `الموسم ${season} غير متوفر في المصادر العربية حاليًا` : 'غير متوفر في المصادر العربية حاليًا';
      host.replaceChildren(el('i', 'cn-dot'), el('span', null, msg), retry());
      return;
    }
    host.dataset.state = 'found';
    const names = [...new Set(found.copies.map((c) => SOURCE_NAMES[c.sourceId] ?? c.sourceId))];
    host.replaceChildren(el('i', 'cn-dot'), el('span', null, `مترجم · متاح عبر ${names.join('، ')}`));
  }

  // ───────────── صفحة العمل ─────────────

  async function openWork(m, { autoplay = false } = {}) {
    const token = ++state.token;
    state.detail = m;
    state.season = m.type === 'series' ? (watchAll()[m.id]?.season ?? null) : null;
    deps.showPage('cinema');
    window.scrollTo?.(0, 0);
    renderDetail(m, { partial: true });
    const full = await prefetch(m);
    if (token !== state.token) return;
    if (!full) {
      q('cinemaBody')?.append(emptyBox('offline', 'تعذّر جلب التفاصيل', 'تحقّق من الاتصال ثم افتح العمل من جديد.'));
      return;
    }
    if (full.type === 'series' && !full.seasons?.some((s) => s.n === state.season)) state.season = full.seasons?.find((s) => s.n !== 0)?.n ?? full.seasons?.[0]?.n ?? 1;
    state.detail = full;
    renderDetail(full);
    if (autoplay) {
      const r = resumePoint(full);
      play(full, r.season, r.episode, r.position);
    }
    void similar(full, token);
  }

  function renderDetail(m, { partial = false } = {}) {
    const page = q('cinema');
    const wrap = el('article', 'cn-detail');

    const bar = el('div', 'cn-detail-bar');
    bar.innerHTML = iconButton('back', 'رجوع', { act: 'goBack' });

    const art = el('div', 'cn-detail-art');
    art.append(image(m.background ?? m.poster, 'cn-img', { eager: true }));

    const body = el('div', 'cn-detail-body');
    body.id = 'cinemaBody';
    body.append(titleMark(m, 'cn-detail-mark'));
    if (m.titleAr && m.title !== m.titleAr) body.append(text('p', 'cn-original', m.title, 'ltr'));
    const line = facts(m, { runtime: true });
    if (m.type === 'series' && m.seasons) line.append(el('span', null, seasonsAr(m.seasons.filter((s) => s.n !== 0).length)));
    body.append(line);
    if (m.genres?.length) body.append(el('p', 'cn-genre-line', m.genres.slice(0, 4).map(genreAr).join(' · ')));

    if (!partial) {
      const point = resumePoint(m);
      const many = (m.seasons ?? []).filter((s) => s.n !== 0).length > 1;
      const label = m.type === 'movie' ? (point.resume ? 'أكمل الفيلم' : 'شاهد الفيلم') : `${point.resume ? 'تابع' : 'شاهد'} الحلقة ${point.episode}${many ? ` · الموسم ${point.season}` : ''}`;
      const main = button('cn-btn cn-btn--play cn-btn--block', `${glyph('play', { size: 20, filled: true })}<span>${label}</span>`, () => play(m, point.season, point.episode, point.position));
      body.append(main);
      if (point.record && !point.record.done && point.record.duration) {
        const ratio = Math.min(1, point.record.position / point.record.duration);
        const p = el('div', 'cn-resume');
        const track = el('span', 'cn-progress');
        const fill = el('i');
        fill.style.width = `${(ratio * 100).toFixed(1)}%`;
        track.append(fill);
        p.append(track, el('span', null, remainingAr(point.record.position, point.record.duration) ?? ''));
        body.append(p);
      }
      const actions = el('div', 'cn-actions');
      const toggle = (kind, icon, label, onToast, offToast) => {
        const b = el('button', 'cn-action');
        b.type = 'button';
        const paint = () => {
          const on = inList(kind, m.id);
          b.setAttribute('aria-pressed', String(on));
          b.innerHTML = `${glyph(on && kind === 'later' ? 'check' : icon, { size: 22, filled: on && kind === 'fav' })}<span>${label}</span>`;
        };
        paint();
        b.onclick = () => {
          const on = toggleList(kind, m);
          paint();
          pop(b);
          toast(on ? onToast : offToast);
        };
        return b;
      };
      actions.append(
        toggle('later', 'plus', 'قائمتي', 'أُضيف إلى قائمتي', 'أُزيل من قائمتي'),
        toggle('fav', 'heart', 'المفضلة', 'أُضيف إلى المفضلة', 'أُزيل من المفضلة'),
      );
      if (deps.share) actions.append(button('cn-action', `${glyph('send', { size: 22 })}<span>رشّح</span>`, () => deps.share({ ref: `cinema:${playKey(m, m.type === 'series' ? state.season : null)}`, title: displayTitle(m), cover: m.poster ?? null })));
      body.append(actions);

      const sources = el('div', 'cn-sources');
      sources.id = 'cinemaSources';
      body.append(sources);

      if (meaningful(m.descriptionAr) || m.description) {
        const about = el('section', 'cn-about');
        if (meaningful(m.descriptionAr)) about.append(el('p', 'cn-tagline', m.descriptionAr));
        if (m.description) {
          const p = text('p', 'cn-synopsis clamped', m.description);
          const more = button('cn-link', 'المزيد', () => {
            const closed = p.classList.toggle('clamped');
            more.textContent = closed ? 'المزيد' : 'أقل';
          });
          about.append(p, more);
        }
        body.append(about);
      }

      if (m.type === 'series') {
        const eps = el('section', 'cn-episodes');
        eps.id = 'cinemaEpisodes';
        body.append(eps);
        renderEpisodes(eps, m);
      }

      const credits = [['الإخراج', m.director], ['البطولة', m.cast?.slice(0, 6)]].filter(([, v]) => v?.length);
      if (credits.length) {
        const dl = el('dl', 'cn-credits');
        for (const [k, v] of credits) dl.append(el('dt', null, k), text('dd', null, v.join('، ')));
        body.append(dl);
      }
      const similarHost = el('div', 'cn-similar');
      similarHost.id = 'cinemaSimilar';
      body.append(similarHost);
    } else {
      body.append(el('div', 'cn-skel cn-skel-btn'), el('div', 'cn-skel cn-skel-line'), el('div', 'cn-skel cn-skel-line short'));
    }

    wrap.append(bar, art, body);
    page.replaceChildren(wrap);
    if (!partial) {
      void paintSources(m, m.type === 'series' ? state.season : null);
      revealIn(wrap);
    }
  }

  /** «قد يعجبك»: الأشهر من نفس النوع الأول، بلا العمل نفسه. */
  async function similar(m, token) {
    const genre = m.genres?.[0];
    if (!genre) return;
    try {
      const list = (await catalog(m.type, 'top', { genre })).filter((x) => x.id !== m.id).slice(0, 14);
      await withArabic(list);
      if (token !== state.token) return;
      const host = q('cinemaSimilar');
      if (host && list.length) host.replaceChildren(rail('قد يعجبك', list.map(slim)));
    } catch {
      // إضافة لا تُفشل الصفحة
    }
  }

  function seasonPicker(m, host) {
    deps.openSheet((body) => {
      const head = el('div', 'an-sheet-head');
      head.append(el('div', 'an-sheet-kicker', 'المواسم'), text('div', 'an-sheet-title', displayTitle(m)));
      const list = el('div', 'cn-season-list');
      for (const s of m.seasons.filter((x) => x.episodes.length)) {
        const b = button(`cn-season-row${s.n === state.season ? ' active' : ''}`, '', () => {
          deps.closeSheet();
          state.season = s.n;
          renderEpisodes(host, m);
          void paintSources(m, s.n);
        });
        b.append(el('b', null, s.n === 0 ? 'إضافات' : `الموسم ${s.n}`), el('span', null, `${s.episodes.length} حلقة`));
        if (s.n === state.season) b.setAttribute('aria-current', 'true');
        list.append(b);
      }
      body.append(head, list);
    }, { tone: 'cinema' });
  }

  function renderEpisodes(host, m) {
    const seasons = (m.seasons ?? []).filter((s) => s.episodes.length);
    const season = seasons.find((s) => s.n === state.season) ?? seasons[0];
    if (!season) {
      host.replaceChildren(el('p', 'cn-note', 'لا حلقات معروفة لهذا المسلسل بعد.'));
      return;
    }
    const head = el('header', 'cn-eps-head');
    head.append(el('h2', null, 'الحلقات'));
    const pick = button('cn-season-btn', `<span>${season.n === 0 ? 'إضافات' : `الموسم ${season.n}`}</span>${glyph('chevron', { size: 14 })}`, () => seasonPicker(m, host));
    if (seasons.length < 2) pick.disabled = true;
    head.append(pick);
    const watched = watchAll()[m.id]?.episodes ?? {};
    const now = Date.now();
    const list = el('ol', 'cn-eps');
    for (const e of season.episodes) {
      const rec = watched[`${season.n}:${e.n}`];
      const ratio = rec?.duration ? Math.min(1, rec.position / rec.duration) : 0;
      const upcoming = e.released && e.released > now;
      const li = el('li', `cn-ep${rec?.done ? ' seen' : ''}${upcoming ? ' soon' : ''}`);
      const row = el('button', 'cn-ep-row');
      row.type = 'button';
      row.disabled = Boolean(upcoming);
      const art = el('span', 'cn-ep-art');
      art.append(image(e.thumb ?? m.background ?? m.poster, 'cn-img', { fallback: m.background ?? m.poster }));
      if (!upcoming) {
        const playMark = el('span', 'cn-ep-play');
        playMark.innerHTML = glyph('play', { size: 14, filled: true });
        art.append(playMark);
      }
      if (ratio > 0 && !rec?.done) {
        const bar = el('span', 'cn-progress');
        const fill = el('i');
        fill.style.width = `${(ratio * 100).toFixed(1)}%`;
        bar.append(fill);
        art.append(bar);
      }
      const copy = el('span', 'cn-ep-copy');
      const top = el('span', 'cn-ep-top');
      top.append(el('b', 'cn-ep-no', String(e.n)), text('b', 'cn-ep-title', e.title || `الحلقة ${e.n}`));
      copy.append(top);
      const when = e.released ? new Date(e.released).toLocaleDateString('ar', { day: 'numeric', month: 'short', year: 'numeric', numberingSystem: 'latn' }) : null;
      const sub = upcoming ? `تُعرض ${when}` : rec?.done ? 'شوهدت' : remainingAr(rec?.position, rec?.duration) ?? when;
      if (sub) copy.append(el('span', 'cn-ep-sub', sub));
      if (e.overview) copy.append(text('span', 'cn-ep-over', e.overview));
      row.append(art, copy);
      row.onclick = () => play(m, season.n, e.n, rec && !rec.done ? rec.position : 0);
      li.append(row);
      list.append(li);
    }
    host.replaceChildren(head, list);
    stripIn([...list.children].slice(0, 6));
  }

  // ───────────── التشغيل ─────────────
  // ورقة السيرفرات نفسها في الأنمي (`an-pick`) بلون السينما، والمشغّل الأصلي
  // نفسه بتصميمه يأخذ `section: 'cinema'` فيلبس الأحمر.

  function play(m, season, n, position = 0) {
    const heading = m.type === 'series' ? `الموسم ${season} · الحلقة ${n}` : 'فيلم';
    if (!engine.available()) {
      deps.openSheet((body) => {
        const head = el('div', 'an-sheet-head');
        head.append(el('div', 'an-sheet-kicker', heading), text('div', 'an-sheet-title', displayTitle(m)));
        const note = el('div', 'an-sheet-note');
        note.innerHTML = `${glyph('layers', { size: 22 })}<div><b>التشغيل داخل التطبيق</b><span>المصادر العربية والسيرفرات تعمل في تطبيق VANTARA على أندرويد.</span></div>`;
        body.append(head, note);
      }, { tone: 'cinema' });
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
      head.append(el('b', null, heading), text('span', 'an-pick-anime', displayTitle(m)));
      bar.append(back, head);
      const scroll = el('div', 'an-pick-scroll');
      const hero = el('div', 'an-pick-hero');
      const thumb = m.seasons?.find((s) => s.n === season)?.episodes.find((e) => e.n === n)?.thumb;
      hero.append(image(thumb ?? m.background ?? m.poster, 'an-img loaded', { eager: true }));
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
              top.append(text('b', 'an-srv-code', r.code, 'ltr'), el('span', 'an-srv-tag', SOURCE_NAMES[r.sourceId] ?? r.sourceId));
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
      const eps = m.type === 'series' ? (m.seasons?.find((s) => s.n === season)?.episodes ?? []) : [];
      const watched = watchAll()[m.id]?.episodes ?? {};
      const resume = {};
      for (const e of eps) {
        const rec = watched[`${season}:${e.n}`];
        if (rec && !rec.done && rec.position > 5000) resume[e.n] = rec.position;
      }
      flushWatch();
      clock.pos = null;
      clock.at = null;
      state.playing = { key, m, season, n: m.type === 'movie' ? 1 : n, userId: currentUser() };
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

  function openDiscover({ genre = '', query = '', type = state.discover.type } = {}) {
    state.discover = { ...state.discover, genre, query, type };
    deps.showPage('discover');
  }

  function showDiscover() {
    const host = q('cinemaDiscover');
    if (!host) return;
    const d = state.discover;
    const form = el('form', 'cn-search');
    form.setAttribute('role', 'search');
    form.innerHTML = `${glyph('search', { size: 18 })}<input type="search" enterkeyhint="search" autocomplete="off" placeholder="فيلم، مسلسل… بالاسم الإنجليزي" aria-label="ابحث عن فيلم أو مسلسل">`;
    const input = form.querySelector('input');
    input.value = d.query;
    let t = null;
    const run = () => {
      state.discover.query = input.value.trim();
      paintFilters();
      void loadDiscover();
    };
    input.oninput = () => {
      clearTimeout(t);
      t = setTimeout(run, 380);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      clearTimeout(t);
      run();
      input.blur();
    };
    const filters = el('div', 'cn-filters');
    const paintFilters = () => {
      filters.hidden = Boolean(state.discover.query);
      const types = el('div', 'cn-kinds cn-kinds--inline');
      for (const [k, label] of [['movie', 'أفلام'], ['series', 'مسلسلات']]) {
        types.append(button(`cn-kind${state.discover.type === k ? ' active' : ''}`, label, () => {
          state.discover.type = k;
          paintFilters();
          void loadDiscover();
        }));
      }
      const genres = el('div', 'cn-chips');
      genres.append(button(`cn-chip${state.discover.genre ? '' : ' active'}`, 'الكل', () => {
        state.discover.genre = '';
        paintFilters();
        void loadDiscover();
      }));
      for (const g of GENRES) {
        genres.append(button(`cn-chip${state.discover.genre === g ? ' active' : ''}`, genreAr(g), () => {
          state.discover.genre = g;
          paintFilters();
          void loadDiscover();
        }));
      }
      filters.replaceChildren(types, genres);
    };
    paintFilters();
    const grid = el('div', 'cn-grid');
    grid.id = 'cinemaDiscoverGrid';
    host.replaceChildren(form, filters, grid);
    void loadDiscover();
  }

  async function loadDiscover() {
    const grid = q('cinemaDiscoverGrid');
    if (!grid) return;
    const token = ++state.discover.token;
    const { query, genre, type } = state.discover;
    grid.replaceChildren(...Array.from({ length: 9 }, () => el('div', 'cn-skel cn-skel-poster')));
    try {
      let items = query ? await searchMeta(query) : await catalog(type, 'top', { genre });
      items = items.slice(0, 42);
      await withArabic(items);
      if (token !== state.discover.token) return;
      grid.replaceChildren(...(items.length ? items.map((m) => posterCard(m)) : [emptyBox('search', 'لا نتائج', 'جرّب الاسم الإنجليزي للعمل.')]));
      stripIn([...grid.children].slice(0, 9));
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
    const tabs = el('div', 'cn-kinds cn-kinds--inline');
    for (const [k, label] of [['continue', 'أكمل المشاهدة'], ['later', 'قائمتي'], ['fav', 'المفضلة']]) {
      tabs.append(button(`cn-kind${state.libraryTab === k ? ' active' : ''}`, label, () => {
        state.libraryTab = k;
        renderLibrary();
      }));
    }
    const tab = state.libraryTab;
    const items = tab === 'continue' ? continuing() : Object.values(listAll()).filter((x) => x[tab]).sort((a, b) => b[tab] - a[tab]);
    const grid = el('div', tab === 'continue' ? 'cn-wide-grid' : 'cn-grid');
    grid.append(...items.map((m) => (tab === 'continue' ? continueCard(m) : posterCard(m))));
    const empty = {
      continue: ['play', 'لم تشاهد شيئًا بعد', 'ما تبدأ مشاهدته يظهر هنا لتكمله من حيث وقفت.'],
      later: ['plus', 'قائمتك فاضية', 'أضف أي فيلم أو مسلسل بزر «قائمتي».'],
      fav: ['heart', 'لا مفضلات بعد', 'علّم ما تحب بزر القلب.'],
    }[tab];
    host.replaceChildren(tabs, items.length ? grid : emptyBox(...empty), el('p', 'cn-note', 'قائمة السينما محفوظة على هذا الجهاز.'));
  }

  return { show, loadHome, openWork, showDiscover, renderLibrary, openDiscover };
}
