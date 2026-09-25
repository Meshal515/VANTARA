/**
 * VANTARA ANIME — الرئيسية، صفحة الأنمي، قائمتي.
 *
 * التركيب على نمط تطبيقات الأنمي التي يعرفها العيال (Aniyomi وأخواته):
 *
 *   الرئيسية: بانر بطاقات دائرية الزوايا تطلّ جاراتها من الجانبين ونقاط
 *   تحته، ثم «آخر المشاهدات» بشريط تقدّم ونسبة، ثم «الإصدارات الحديثة»
 *   بوسم الحالة والحلقة، ثم بقية الشرائط.
 *
 *   صفحة الأنمي: خلفية مموّهة من البوستر، البوستر والمعلومات جنبًا إلى
 *   جنب، تقييم MAL وAniList، زر «استمرار (الحلقة)»، وتبويبات: التفاصيل،
 *   الحلقات، سجل المشاهدة، الحلقات المفضلة. الحلقة صف بصورة ومدة وزر
 *   «شغّل الآن» أو «استمرار».
 *
 *   قائمتي: سجل المشاهدة (شريط تقدّم وتاريخ وحذف) وقائمتي.
 *
 * البيانات الوصفية من AniList، وتقييم MAL وعناوين الحلقات من Jikan.
 * التشغيل (السيرفرات) من امتدادات المصادر العربية ويُربط تاليًا.
 */
import { glyph } from './icons.js';
import {
  FORMAT_AR,
  SEASON_AR,
  STATUS_AR,
  compactCount,
  fetchAnimeDetail,
  fetchAnimeHome,
  fetchMalEpisodes,
  fetchMalScore,
  relativeAr,
  searchAnime,
} from '../lib/anime-meta.js';
import { pageIn, pop, revealIn, stripIn } from './motion.js';

const HOME_KEY = 'anime.home.v2';
const LIST_KEY = 'vantara.anime.list';
const WATCH_KEY = 'vantara.anime.watch';
const FAV_EP_KEY = 'vantara.anime.favEpisodes';
const PREFS_KEY = 'vantara.anime.prefs';
const STALE_MS = 30 * 60_000;
const SLIDE_MS = 5500;

const ANIME_GENRES = ['Action', 'Adventure', 'Fantasy', 'Romance', 'Comedy', 'Drama', 'Mystery', 'Horror', 'Psychological', 'Sci-Fi', 'Supernatural', 'Sports', 'Slice of Life', 'Thriller', 'Mecha', 'Music'];
const SOURCE_AR = { MANGA: 'مانجا', LIGHT_NOVEL: 'رواية خفيفة', ORIGINAL: 'أصلي', WEB_NOVEL: 'رواية ويب', NOVEL: 'رواية', VISUAL_NOVEL: 'رواية مرئية', VIDEO_GAME: 'لعبة', GAME: 'لعبة', OTHER: 'آخر', WEB_MANGA: 'مانهوا/ويب' };
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // تخزين ممتلئ أو ممنوع: يبقى للجلسة
  }
};
const pad2 = (n) => String(n).padStart(2, '0');
const dateAr = (ts) => {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS_AR[d.getMonth()]} ${d.getFullYear()} - ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** سجل المشاهدة: لكل أنمي آخر حلقة وموضعها، ولكل حلقة تقدّمها. */
export function readWatch() {
  return readJson(WATCH_KEY, {});
}
/** يُنادى من المشغّل: يحفظ موضع الحلقة، ويعلّمها مُشاهدة عند 90%. */
export function recordWatch(m, episode, position, duration) {
  const all = readWatch();
  const w = all[m.id] ?? { id: m.id, episodes: {} };
  Object.assign(w, { title: m.title, poster: m.posterSmall ?? m.poster, banner: m.banner, color: m.color, total: m.episodes ?? null });
  const done = duration > 0 && position / duration >= 0.9;
  w.episodes[episode] = { position, duration, at: Date.now(), done: done || Boolean(w.episodes[episode]?.done) };
  w.episode = episode;
  w.at = Date.now();
  all[m.id] = w;
  writeJson(WATCH_KEY, all);
}

/**
 * @param {{ root: Element, q: (id: string) => HTMLElement, el: Function, toast: (m: string) => void,
 *           openSheet: Function, closeSheet: Function, showPage: (id: string) => void, goBack: () => void,
 *           currentPage: () => string, genreAr: (g: string) => string, readKv: Function, writeKv: Function }} deps
 */
export function createAnime(deps) {
  const { q, el, toast, genreAr } = deps;
  const state = {
    home: null,
    loading: null,
    carouselTimer: null,
    detail: null,
    mal: null,
    malTitles: {},
    detailToken: 0,
    tab: 'episodes',
    libraryTab: 'history',
    discover: { query: '', genre: '', page: 1, items: [], hasNext: false, token: 0 },
  };
  const prefs = () => ({ newestFirst: false, hideSeen: false, grid: false, ...readJson(PREFS_KEY, {}) });
  const setPref = (k, v) => writeJson(PREFS_KEY, { ...prefs(), [k]: v });

  // ───────────── عناصر صغيرة ─────────────

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
  const statusBadge = (m) => {
    if (m.status === 'RELEASING') return el('span', 'an-badge an-badge--live', 'يُعرض حاليًا');
    if (m.status === 'FINISHED') return el('span', 'an-badge an-badge--done', 'مكتملة');
    if (m.status === 'NOT_YET_RELEASED') return el('span', 'an-badge an-badge--soon', 'قريبًا');
    return null;
  };
  const bar = (ratio) => {
    const b = el('span', 'an-bar');
    const fill = el('i');
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    b.append(fill);
    return b;
  };

  function section(title, { more, body, cls = '' }) {
    const s = el('section', `an-sec ${cls}`);
    s.dataset.reveal = '';
    const head = el('div', 'an-sec-head');
    head.append(el('h2', null, title));
    if (more) head.append(button('an-sec-more', 'عرض المزيد', more));
    s.append(head, body);
    return s;
  }
  const strip = (items, card) => {
    const s = el('div', 'an-strip');
    s.append(...items.map(card));
    return s;
  };

  // ───────────── البطاقات ─────────────

  /** بطاقة العمل: بوستر بوسم حالته وحلقته، والعنوان والتقييم تحته. */
  function posterCard(m, { episode } = {}) {
    const c = el('button', 'an-card');
    c.type = 'button';
    c.setAttribute('aria-label', m.title);
    const art = el('div', 'an-poster');
    art.append(image(m.posterSmall ?? m.poster));
    const badge = statusBadge(m);
    if (badge) art.append(badge);
    const ep = episode ?? (m.status === 'RELEASING' ? m.aired : m.episodes);
    if (ep && m.format !== 'MOVIE') art.append(el('span', 'an-poster-ep', `الحلقة : ${ep}`));
    const t = el('span', 'an-card-title', m.title);
    t.dir = 'auto';
    c.append(art, t);
    if (m.score) {
      const s = el('span', 'an-card-score');
      s.innerHTML = `${glyph('star', { size: 13, filled: true })}<b>${m.score.toFixed(1)}</b>`;
      if (m.popularity) s.append(el('span', null, `(${compactCount(m.popularity)})`));
      c.append(s);
    }
    c.onclick = () => void openAnime(m);
    return c;
  }

  /** «آخر المشاهدات»: البوستر، الحلقة، العنوان، وشريط التقدّم بنسبته. */
  function continueCard(w) {
    const e = w.episodes?.[w.episode] ?? {};
    const ratio = e.duration ? Math.min(1, e.position / e.duration) : 0;
    const c = el('button', 'an-cw');
    c.type = 'button';
    const art = el('div', 'an-cw-art');
    art.append(image(w.poster));
    const info = el('div', 'an-cw-info');
    info.append(el('b', 'an-cw-ep', `الحلقة ${pad2(w.episode)}`));
    const t = el('span', 'an-cw-title', w.title);
    t.dir = 'auto';
    info.append(t, bar(ratio), el('span', 'an-cw-pct', `${(ratio * 100).toFixed(1)}%`));
    c.append(art, info);
    c.onclick = () => void openAnime({ id: w.id, title: w.title, poster: w.poster, posterSmall: w.poster, banner: w.banner, color: w.color });
    return c;
  }

  // ───────────── البانر: بطاقات تطلّ جاراتها ─────────────

  function carousel(items) {
    const wrap = el('section', 'an-car');
    wrap.dataset.reveal = '';
    wrap.setAttribute('aria-roledescription', 'carousel');
    wrap.setAttribute('aria-label', 'رائج الآن');
    const track = el('div', 'an-car-track');
    const dots = el('div', 'an-car-dots');
    items.forEach((m, i) => {
      const s = el('button', 'an-car-slide');
      s.type = 'button';
      s.setAttribute('aria-label', m.title);
      s.append(image(m.banner ?? m.poster, 'an-img', { eager: i < 2, position: m.banner ? 'center' : 'center 25%' }));
      s.append(el('span', 'an-car-shade'));
      const copy = el('span', 'an-car-copy');
      const t = el('span', 'an-car-title', m.title);
      t.dir = 'auto';
      const ep = m.status === 'RELEASING' && m.aired ? `الحلقة ${m.aired}` : m.episodes ? `${m.episodes} حلقة` : FORMAT_AR[m.format] ?? '';
      copy.append(t, el('span', 'an-car-sub', ep));
      s.append(copy);
      s.onclick = () => void openAnime(m);
      track.append(s);
      const d = el('button', `an-dot${i === 0 ? ' active' : ''}`);
      d.type = 'button';
      d.setAttribute('aria-label', `الشريحة ${i + 1}`);
      d.onclick = () => goSlide(track, i);
      dots.append(d);
    });
    wrap.append(track, dots);
    let raf = 0;
    track.addEventListener(
      'scroll',
      () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => paintCarousel(track, dots));
      },
      { passive: true },
    );
    track.addEventListener('touchstart', () => clearInterval(state.carouselTimer), { passive: true });
    track.addEventListener('touchend', () => autoplay(track));
    requestAnimationFrame(() => paintCarousel(track, dots));
    autoplay(track);
    return wrap;
  }
  const slideIndex = (track) => {
    const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
    let best = 0;
    let bestD = Infinity;
    [...track.children].forEach((s, i) => {
      const r = s.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  /** البطاقات الجانبية تصغر وتخفت، والوسطى بحجمها. */
  function paintCarousel(track, dots) {
    const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
    for (const s of track.children) {
      const r = s.getBoundingClientRect();
      const t = Math.min(1, Math.abs(r.left + r.width / 2 - mid) / r.width);
      s.style.transform = `scale(${(1 - t * 0.1).toFixed(3)})`;
      s.style.opacity = (1 - t * 0.4).toFixed(3);
    }
    const i = slideIndex(track);
    [...dots.children].forEach((d, k) => d.classList.toggle('active', k === i));
  }
  function goSlide(track, i) {
    const s = track.children[i];
    if (!s) return;
    track.scrollTo({ left: s.offsetLeft - (track.clientWidth - s.clientWidth) / 2, behavior: 'smooth' });
  }
  function autoplay(track) {
    clearInterval(state.carouselTimer);
    state.carouselTimer = setInterval(() => {
      if (!track.isConnected) return clearInterval(state.carouselTimer);
      if (deps.currentPage() !== 'home' || q('animeHome').hidden || document.hidden) return;
      goSlide(track, (slideIndex(track) + 1) % track.children.length);
    }, SLIDE_MS);
  }

  // ───────────── الرئيسية ─────────────

  const watching = () =>
    Object.values(readWatch())
      .filter((w) => w?.id && w.episode)
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

  function genres() {
    const row = el('div', 'an-pills');
    for (const g of ANIME_GENRES) row.append(button('an-pill', genreAr(g), () => openDiscover({ genre: g })));
    return row;
  }

  function renderHome(data) {
    const home = el('div', 'an-home');
    if (data.hero?.length) home.append(carousel(data.hero));
    const cont = watching();
    if (cont.length) home.append(section('آخر المشاهدات', { more: () => openLibrary('history'), body: strip(cont.slice(0, 12), continueCard), cls: 'an-sec--cw' }));
    if (data.latest?.length) home.append(section('الإصدارات الحديثة', { more: () => openDiscover({}), body: strip(data.latest.slice(0, 18), (m) => posterCard(m, { episode: m.episode })) }));
    if (data.season?.length) home.append(section(`موسم ${data.seasonName}`, { body: strip(data.season, (m) => posterCard(m)) }));
    home.append(section('الأنواع', { body: genres() }));
    if (data.trending?.length) home.append(section('الأكثر رواجًا', { more: () => openDiscover({}), body: strip(data.trending, (m) => posterCard(m)) }));
    if (data.popular?.length) home.append(section('الأشهر على الإطلاق', { body: strip(data.popular, (m) => posterCard(m)) }));
    if (data.top?.length) home.append(section('الأعلى تقييمًا', { body: strip(data.top, (m) => posterCard(m)) }));
    home.append(el('p', 'an-credit', 'بيانات الأعمال من AniList وMAL · التشغيل من المصادر العربية'));
    q('animeHome').replaceChildren(home);
    return home;
  }

  function renderSkeleton() {
    const home = el('div', 'an-home');
    const car = el('div', 'an-car');
    const track = el('div', 'an-car-track');
    track.append(el('div', 'an-car-slide an-skel'), el('div', 'an-car-slide an-skel'));
    car.append(track);
    home.append(car);
    for (let r = 0; r < 2; r++) {
      const s = el('section', 'an-sec');
      const head = el('div', 'an-sec-head');
      head.append(el('span', 'an-skel an-skel-line'));
      s.append(head, strip([0, 1, 2, 3], () => el('div', 'an-skel an-skel-poster')));
      home.append(s);
    }
    q('animeHome').replaceChildren(home);
  }

  function renderError(retry) {
    const box = emptyBox('offline', 'تعذّر جلب الأنمي', 'تحقّق من الاتصال ثم أعد المحاولة.');
    box.append(button('an-cta', 'أعد المحاولة', retry));
    q('animeHome').replaceChildren(box);
  }

  async function loadHome({ force = false } = {}) {
    if (state.loading) return state.loading;
    const run = async () => {
      if (!state.home) {
        const cached = (await deps.readKv(HOME_KEY))?.value;
        if (cached?.hero) {
          state.home = cached;
          revealIn(renderHome(cached));
        } else renderSkeleton();
      }
      if (!force && state.home && Date.now() - (state.home.fetchedAt ?? 0) < STALE_MS) return;
      try {
        const fresh = await fetchAnimeHome();
        const first = !state.home;
        state.home = fresh;
        void deps.writeKv(HOME_KEY, fresh);
        // لا تُعاد بناء رئيسية أمام العين إلا أول مرة
        if (first || deps.currentPage() !== 'home' || q('animeHome').hidden) {
          const view = renderHome(fresh);
          if (first) revealIn(view);
        }
      } catch {
        if (!state.home) renderError(() => void loadHome({ force: true }));
      }
    };
    state.loading = run().finally(() => (state.loading = null));
    return state.loading;
  }

  function show() {
    // «آخر المشاهدات» تتغيّر بعد كل حلقة: تُرسم من جديد عند العودة
    if (state.home && !state.loading) renderHome(state.home);
    void loadHome();
  }

  // ───────────── قائمتي والمفضلة ─────────────

  const inList = (id) => Boolean(readJson(LIST_KEY, {})[id]);
  function toggleList(m) {
    const all = readJson(LIST_KEY, {});
    if (all[m.id]) delete all[m.id];
    else {
      const { id, title, poster, posterSmall, banner, color, format, year, score, status, episodes, aired, popularity } = m;
      all[m.id] = { id, title, poster, posterSmall, banner, color, format, year, score, status, episodes, aired, popularity, at: Date.now() };
    }
    writeJson(LIST_KEY, all);
    return Boolean(all[m.id]);
  }
  const favEpisodes = (id) => readJson(FAV_EP_KEY, {})[id] ?? [];
  function toggleFavEpisode(id, n) {
    const all = readJson(FAV_EP_KEY, {});
    const list = new Set(all[id] ?? []);
    if (list.has(n)) list.delete(n);
    else list.add(n);
    all[id] = [...list].sort((a, b) => a - b);
    writeJson(FAV_EP_KEY, all);
    return list.has(n);
  }

  // ───────────── صفحة الأنمي ─────────────

  async function openAnime(m, { episode = null } = {}) {
    const token = ++state.detailToken;
    state.tab = 'episodes';
    state.mal = null;
    state.malTitles = {};
    state.detail = { relations: [], recommendations: [], thumbs: {}, ...m };
    deps.showPage('anime');
    renderDetail({ partial: true });
    pageIn(q('anime'));
    try {
      const full = await fetchAnimeDetail(m.id);
      if (token !== state.detailToken || !full) return;
      state.detail = full;
      renderDetail();
      if (episode) q('anime').querySelector(`[data-ep="${episode}"]`)?.scrollIntoView({ block: 'center' });
      // تقييم MAL وعناوين الحلقات: إضافات، لا تؤخّر الصفحة
      void fetchMalScore(full.idMal)
        .then((mal) => {
          if (token !== state.detailToken || !mal) return;
          state.mal = mal;
          paintScores();
        })
        .catch(() => {});
      void fetchMalEpisodes(full.idMal)
        .then(({ titles }) => {
          if (token !== state.detailToken || !Object.keys(titles).length) return;
          state.malTitles = titles;
          if (state.tab === 'episodes') renderTab();
        })
        .catch(() => {});
    } catch {
      if (token !== state.detailToken) return;
      q('animeTab')?.replaceChildren(el('p', 'an-note', 'تعذّر جلب تفاصيل الأنمي — تحقّق من الاتصال.'));
    }
  }

  function scoreBlock(kind, value, sub) {
    const b = el('div', `an-scorebox an-scorebox--${kind}`);
    const logo = el('span', kind === 'mal' ? 'an-mal' : 'an-al-star', kind === 'mal' ? 'MAL' : undefined);
    if (kind !== 'mal') logo.innerHTML = glyph('star', { size: 24, filled: true });
    const v = el('div', 'an-scorebox-v');
    v.innerHTML = value == null ? '<b>—</b>' : `<b>${value}</b><small>/10</small>`;
    b.append(logo, v, el('span', 'an-scorebox-sub', sub ?? ''));
    return b;
  }
  function paintScores() {
    const host = q('animeScores');
    const m = state.detail;
    if (!host || !m) return;
    const mal = state.mal;
    host.replaceChildren(
      scoreBlock('mal', mal?.score?.toFixed(2) ?? null, mal?.scoredBy ? compactCount(mal.scoredBy) : '—'),
      scoreBlock('al', m.score ? m.score.toFixed(1) : null, m.popularity ? compactCount(m.popularity) : '—'),
    );
    const rank = q('animeRank');
    if (rank) rank.lastChild.textContent = mal?.rank ? `#${mal.rank}` : m.rank ? `#${m.rank}` : 'N/A';
  }

  /** الحلقة التي يبدأ منها زر المشاهدة: غير المكتملة الأخيرة، أو التالية لآخر مكتملة. */
  function resumePoint(m) {
    const w = readWatch()[m.id];
    if (!w?.episode) return { episode: 1, resume: false };
    const e = w.episodes?.[w.episode];
    if (e && !e.done) return { episode: w.episode, resume: true };
    const total = m.aired || m.episodes || w.episode + 1;
    return { episode: Math.min(total, w.episode + 1), resume: true };
  }

  function renderDetail({ partial = false } = {}) {
    const m = state.detail;
    const page = q('anime');
    const wrap = el('div', 'an-d');

    // الترويسة: خلفية مموّهة من البوستر، الأزرار فوقها
    const head = el('div', 'an-d-head');
    const back = el('div', 'an-d-backdrop');
    back.append(image(m.banner ?? m.poster, 'an-img', { eager: true }));
    head.append(back);
    const barRow = el('div', 'an-d-bar');
    const start = el('div', 'an-d-bar-group');
    start.append(button('an-sq', glyph('close'), () => deps.goBack(), 'إغلاق'));
    const end = el('div', 'an-d-bar-group');
    const heart = button(`an-sq${inList(m.id) ? ' on' : ''}`, glyph('heart', { filled: inList(m.id) }), () => {
      const on = toggleList(m);
      pop(heart);
      toast(on ? 'أُضيف إلى قائمتي' : 'أُزيل من قائمتي');
      paintListState();
    }, 'قائمتي');
    heart.id = 'animeHeart';
    end.append(heart, button('an-sq', glyph('share'), () => shareCurrent(), 'شارك'));
    barRow.append(start, end);

    const top = el('div', 'an-d-top');
    top.dataset.reveal = '';
    const info = el('div', 'an-d-info');
    const h1 = el('h1', null, m.title);
    h1.dir = 'auto';
    info.append(h1);
    const line = [FORMAT_AR[m.format], m.season && m.year ? `${SEASON_AR[m.season]} ${m.year}` : m.year].filter(Boolean).join(' • ');
    if (line) info.append(el('div', 'an-d-line', line));
    const count = m.episodes ?? m.aired;
    if (count) info.append(el('div', 'an-d-line', `${count} حلقة`));
    const rank = el('div', 'an-d-stat');
    rank.id = 'animeRank';
    rank.innerHTML = `<span class="an-d-trophy">${glyph('trophy', { size: 18, filled: true })}</span><span>${m.rank ? `#${m.rank}` : 'N/A'}</span>`;
    const favs = el('div', 'an-d-stat');
    favs.innerHTML = `<span class="an-d-heart">${glyph('heart', { size: 18, filled: true })}</span><span>${compactCount(m.favourites ?? 0)}</span>`;
    info.append(rank, favs);
    if (m.status) info.append(el('span', `an-d-status an-d-status--${String(m.status).toLowerCase()}`, m.status === 'FINISHED' ? 'مكتملة' : STATUS_AR[m.status] ?? m.status));
    const scores = el('div', 'an-scores');
    scores.id = 'animeScores';
    info.append(scores);
    const poster = el('div', 'an-d-poster');
    poster.append(image(m.poster, 'an-img', { eager: true }));
    top.append(info, poster);
    head.append(barRow, top);

    const actions = el('div', 'an-d-actions');
    actions.id = 'animeActions';
    actions.dataset.reveal = '';

    const tabs = el('div', 'an-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.dataset.reveal = '';
    for (const [k, label] of [
      ['details', 'التفاصيل'],
      ['episodes', 'الحلقات'],
      ['history', 'سجل المشاهدة'],
      ['favorites', 'الحلقات المفضلة'],
    ]) {
      const b = button(`an-tab${state.tab === k ? ' active' : ''}`, label, () => selectTab(k));
      b.dataset.tab = k;
      b.setAttribute('role', 'tab');
      tabs.append(b);
    }
    const body = el('div', 'an-tab-body');
    body.id = 'animeTab';

    wrap.append(head, actions, tabs, body);
    page.replaceChildren(wrap);
    paintScores();
    paintActions();
    if (partial) body.append(...Array.from({ length: 4 }, () => el('div', 'an-skel an-skel-row')));
    else renderTab();
    requestAnimationFrame(() => tabs.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }

  function selectTab(k) {
    if (state.tab === k) return;
    state.tab = k;
    for (const t of q('anime').querySelectorAll('.an-tab')) t.classList.toggle('active', t.dataset.tab === k);
    renderTab();
    stripIn([...q('animeTab').querySelectorAll('.an-er, .an-hist-ep, .an-info-row')].slice(0, 8));
  }

  function paintListState() {
    const m = state.detail;
    const on = inList(m.id);
    const heart = q('animeHeart');
    if (heart) {
      heart.classList.toggle('on', on);
      heart.innerHTML = glyph('heart', { filled: on });
    }
    paintActions();
  }

  function paintActions() {
    const host = q('animeActions');
    const m = state.detail;
    if (!host || !m) return;
    const { episode, resume } = resumePoint(m);
    const play = button('an-cta an-cta--go', `<span>${resume ? 'استمرار' : 'شاهد'} (${episode})</span>${glyph('play', { size: 18, filled: true })}`, () => playEpisode(m, episode));
    const list = button(`an-act${inList(m.id) ? ' on' : ''}`, glyph('library', { filled: inList(m.id) }), (e) => {
      const on = toggleList(m);
      pop(e.currentTarget);
      toast(on ? 'أُضيف إلى قائمتي' : 'أُزيل من قائمتي');
      paintListState();
    }, 'قائمتي');
    const fav = button('an-act', glyph('star'), () => selectTab('favorites'), 'الحلقات المفضلة');
    const talk = button('an-act', glyph('chat'), () => toast('نقاش الحلقات في المجلس قريبًا'), 'النقاش');
    host.replaceChildren(play, list, fav, talk);
  }

  function renderTab() {
    const host = q('animeTab');
    const m = state.detail;
    if (!host || !m) return;
    if (state.tab === 'details') return renderDetails(host, m);
    if (state.tab === 'history') return renderHistoryTab(host, m);
    if (state.tab === 'favorites') return renderEpisodeList(host, m, { only: favEpisodes(m.id), empty: 'لا حلقات مفضلة بعد — اضغط مطولًا على أي حلقة لإضافتها.' });
    return renderEpisodeList(host, m, { toolbar: true });
  }

  function episodeRow(m, n, { grid = false } = {}) {
    const e = readWatch()[m.id]?.episodes?.[n];
    const ratio = e?.duration ? Math.min(1, e.position / e.duration) : 0;
    const inProgress = e && !e.done && ratio > 0.01;
    const title = state.malTitles[n] ?? m.thumbs?.[n]?.title ?? null;
    const row = el('div', `an-er${e?.done ? ' seen' : ''}${grid ? ' an-er--grid' : ''}`);
    row.dataset.ep = String(n);
    const info = el('div', 'an-er-info');
    const name = el('div', 'an-er-name');
    name.append(el('b', null, `الحلقة ${pad2(n)}`));
    if (title && !grid) {
      const t = el('span', null, title);
      t.dir = 'auto';
      name.append(el('i', 'an-er-sep', '•'), t);
    }
    if (favEpisodes(m.id).includes(n)) name.insertAdjacentHTML('afterbegin', `<i class="an-er-fav">${glyph('star', { size: 13, filled: true })}</i>`);
    const act = inProgress
      ? button('an-er-btn an-er-btn--resume', `<span>استمرار</span>${glyph('pause', { size: 16, filled: true })}`, () => playEpisode(m, n))
      : button('an-er-btn', `<span>${e?.done ? 'أعد المشاهدة' : 'شغّل الآن'}</span>${glyph('play', { size: 16, filled: true })}`, () => playEpisode(m, n));
    info.append(name, act);
    const art = el('div', 'an-er-art');
    const thumb = m.thumbs?.[n]?.thumbnail;
    art.append(image(thumb ?? m.banner ?? m.poster, 'an-img', { position: thumb || m.banner ? 'center' : 'center 25%' }));
    if (m.duration) art.append(el('span', 'an-er-dur', `${m.duration}:00`));
    if (ratio > 0) {
      const b = bar(ratio);
      b.classList.add('an-er-bar');
      art.append(b);
    }
    row.append(info, art);
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const on = toggleFavEpisode(m.id, n);
      toast(on ? `الحلقة ${n} في المفضلة` : `أُزيلت الحلقة ${n} من المفضلة`);
      renderTab();
    });
    return row;
  }

  function renderEpisodeList(host, m, { toolbar = false, only = null, empty = 'لم تُعرض حلقات بعد.' } = {}) {
    const total = m.aired || m.episodes || 0;
    const p = prefs();
    let list = only ?? Array.from({ length: total }, (_, i) => i + 1);
    const seen = readWatch()[m.id]?.episodes ?? {};
    if (toolbar && p.hideSeen) list = list.filter((n) => !seen[n]?.done);
    if (p.newestFirst) list = [...list].reverse();
    const nodes = [];
    const grid = p.grid && toolbar;
    if (toolbar) {
      const tools = el('div', 'an-tools');
      const tool = (icon, label, on, run) => {
        const b = button(`an-tool${on ? ' on' : ''}`, glyph(icon), run, label);
        b.title = label;
        b.setAttribute('aria-pressed', String(Boolean(on)));
        return b;
      };
      tools.append(
        el('span', 'an-tools-meta', total ? `${total} حلقة${m.episodes && m.episodes > total ? ` من ${m.episodes}` : ''}` : ''),
        tool(p.grid ? 'listView' : 'grid', p.grid ? 'عرض القائمة' : 'عرض الشبكة', false, () => (setPref('grid', !p.grid), renderTab())),
        tool('eyeOff', 'إخفاء المُشاهَد', p.hideSeen, () => (setPref('hideSeen', !p.hideSeen), renderTab())),
        tool('sort', p.newestFirst ? 'الأحدث أولًا' : 'الأقدم أولًا', p.newestFirst, () => (setPref('newestFirst', !p.newestFirst), renderTab())),
      );
      nodes.push(tools);
      if (m.next) {
        const next = el('div', 'an-next');
        next.innerHTML = `<span class="an-next-dot"></span><span>الحلقة ${m.next.episode} ${relativeAr(m.next.at)}</span>`;
        nodes.push(next);
      }
    }
    if (!list.length) nodes.push(el('p', 'an-note', empty));
    // الحلقات الطويلة (ون بيس) تُرسم دفعات
    const BATCH = 60;
    const box = el('div', grid ? 'an-er-grid' : 'an-er-list');
    const paint = (from) => {
      box.append(...list.slice(from, from + BATCH).map((n) => episodeRow(m, n, { grid })));
      if (from + BATCH < list.length) {
        const more = button('an-more-eps', `عرض المزيد (${list.length - from - BATCH})`, () => {
          more.remove();
          paint(from + BATCH);
        });
        box.append(more);
      }
    };
    paint(0);
    nodes.push(box);
    host.replaceChildren(...nodes);
  }

  function renderHistoryTab(host, m) {
    const eps = Object.entries(readWatch()[m.id]?.episodes ?? {})
      .map(([n, e]) => ({ n: Number(n), ...e }))
      .sort((a, b) => b.at - a.at);
    if (!eps.length) return host.replaceChildren(el('p', 'an-note', 'لم تشاهد شيئًا من هذا الأنمي بعد.'));
    host.replaceChildren(
      ...eps.map((e) => {
        const r = el('button', 'an-hist-ep');
        r.type = 'button';
        const ratio = e.duration ? Math.min(1, e.position / e.duration) : 0;
        const top = el('div', 'an-hist-ep-top');
        top.append(el('b', null, `الحلقة ${pad2(e.n)}`), el('span', null, e.done ? 'مكتملة' : `${Math.round(ratio * 100)}%`));
        const when = el('span', 'an-when');
        when.innerHTML = `${glyph('clock', { size: 15 })}<span>${dateAr(e.at)} (${relativeAr(e.at)})</span>`;
        r.append(top, bar(ratio), when);
        r.onclick = () => playEpisode(m, e.n);
        return r;
      }),
    );
  }

  function renderDetails(host, m) {
    const nodes = [];
    if (m.description) {
      const p = el('p', 'an-synopsis clamped', m.description);
      p.dir = 'auto';
      const more = button('an-more-text', 'المزيد', () => {
        const closed = p.classList.toggle('clamped');
        more.textContent = closed ? 'المزيد' : 'أقل';
      });
      nodes.push(p, more);
    }
    if (m.genres?.length) {
      const g = el('div', 'an-pills an-pills--wrap');
      for (const x of m.genres) g.append(button('an-pill', genreAr(x), () => openDiscover({ genre: x })));
      nodes.push(g);
    }
    const rows = [
      ['الاستوديو', m.studio],
      ['المصدر', SOURCE_AR[m.source] ?? null],
      ['بدأ العرض', m.start ? `${m.start.day ?? ''} ${MONTHS_AR[(m.start.month ?? 1) - 1]} ${m.start.year}`.trim() : null],
      ['مدة الحلقة', m.duration ? `${m.duration} دقيقة` : null],
      ['الاسم الياباني', m.native],
      ['الاسم الروماجي', m.romaji !== m.title ? m.romaji : null],
    ].filter(([, v]) => v);
    if (rows.length) {
      const grid = el('div', 'an-info');
      for (const [k, v] of rows) {
        const r = el('div', 'an-info-row');
        const val = el('span', null, String(v));
        val.dir = 'auto';
        r.append(el('span', 'an-info-k', k), val);
        grid.append(r);
      }
      nodes.push(grid);
    }
    host.replaceChildren(...nodes);
    if (m.relations?.length) host.append(section('من نفس العالم', { body: strip(m.relations, relationCard), cls: 'an-sec--inset' }));
    if (m.recommendations?.length) host.append(section('قد يعجبك', { body: strip(m.recommendations, (r) => posterCard(r)), cls: 'an-sec--inset' }));
  }
  function relationCard(r) {
    const c = posterCard(r);
    c.querySelector('.an-card-score')?.remove();
    c.append(el('span', 'an-card-rel', r.relation));
    return c;
  }

  /** الحلقة: السيرفرات من امتدادات المصادر (الخطوة التالية)، والورقة جاهزة لها. */
  function playEpisode(m, n) {
    deps.openSheet((body) => {
      const head = el('div', 'an-sheet-head');
      const t = el('div', 'an-sheet-title', m.title);
      t.dir = 'auto';
      head.append(el('div', 'an-sheet-kicker', `الحلقة ${n}`), t);
      const note = el('div', 'an-sheet-note');
      note.innerHTML = `${glyph('layers', { size: 22 })}<div><b>السيرفرات قيد الربط</b><span>WitAnime وبقية المصادر العربية تُربط الآن بمحرّك التطبيق: تختار السيرفر والجودة، ويبدأ التشغيل في المشغّل.</span></div>`;
      body.append(head, note);
    });
  }

  // ───────────── اكتشف ─────────────

  function openDiscover({ genre = '', query = '' } = {}) {
    state.discover = { ...state.discover, genre, query, page: 1, items: [], hasNext: false };
    deps.showPage('discover');
    renderDiscover();
    void loadDiscover();
  }

  function renderDiscover() {
    const host = q('animeDiscover');
    if (!host) return;
    const d = state.discover;
    const box = el('div', 'an-discover');
    const form = el('form', 'search-bar an-search');
    form.setAttribute('role', 'search');
    form.innerHTML = `${glyph('search')}<input class="search-input" type="search" enterkeyhint="search" autocomplete="off" placeholder="ابحث عن أنمي" aria-label="ابحث عن أنمي">`;
    const input = form.querySelector('input');
    input.value = d.query;
    let t = null;
    input.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.discover = { ...state.discover, query: input.value.trim(), page: 1, items: [] };
        void loadDiscover();
      }, 420);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      input.blur();
    };
    const chips = el('div', 'an-pills');
    const pick = (g) => () => {
      state.discover = { ...state.discover, genre: g, page: 1, items: [] };
      renderDiscover();
      void loadDiscover();
    };
    chips.append(button(`an-pill${d.genre ? '' : ' active'}`, 'الكل', pick('')));
    for (const g of ANIME_GENRES) chips.append(button(`an-pill${d.genre === g ? ' active' : ''}`, genreAr(g), pick(g)));
    const grid = el('div', 'an-grid');
    grid.id = 'animeDiscoverGrid';
    const more = button('an-more-eps an-load-more', 'المزيد', () => {
      state.discover.page += 1;
      void loadDiscover({ append: true });
    });
    more.id = 'animeDiscoverMore';
    more.hidden = true;
    box.append(form, chips, grid, more);
    host.replaceChildren(box);
    requestAnimationFrame(() => chips.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }

  async function loadDiscover({ append = false } = {}) {
    const d = state.discover;
    const token = ++d.token;
    const grid = q('animeDiscoverGrid');
    if (!grid) return;
    if (!append) grid.replaceChildren(...Array.from({ length: 9 }, () => el('div', 'an-skel an-skel-poster')));
    try {
      const { items, hasNext } = await searchAnime({ search: d.query, genre: d.genre, page: d.page });
      if (token !== state.discover.token) return;
      d.items = append ? [...d.items, ...items] : items;
      d.hasNext = hasNext;
      const cards = items.map((m) => posterCard(m));
      if (append) grid.append(...cards);
      else grid.replaceChildren(...cards);
      if (!d.items.length) grid.replaceChildren(el('p', 'an-note', 'لا نتائج — جرّب اسمًا آخر أو بالإنجليزي.'));
      q('animeDiscoverMore').hidden = !hasNext;
      stripIn(cards.slice(0, 12));
    } catch {
      if (token === state.discover.token) grid.replaceChildren(el('p', 'an-note', 'تعذّر البحث — تحقّق من الاتصال.'));
    }
  }

  function showDiscover() {
    if (!q('animeDiscover')?.childElementCount) {
      renderDiscover();
      void loadDiscover();
    }
  }

  // ───────────── قائمتي: سجل المشاهدة + قائمتي ─────────────

  function openLibrary(tab) {
    state.libraryTab = tab;
    deps.showPage('library');
  }

  function historyRow(w) {
    const e = w.episodes?.[w.episode] ?? {};
    const ratio = e.duration ? Math.min(1, e.position / e.duration) : 0;
    const r = el('div', 'an-hr');
    const info = el('div', 'an-hr-info');
    const t = el('b', 'an-hr-title', w.title);
    t.dir = 'auto';
    const when = el('span', 'an-when');
    when.innerHTML = `${glyph('clock', { size: 15 })}<span>${dateAr(w.at)} (${relativeAr(w.at)})</span>`;
    info.append(t, el('span', 'an-hr-ep', `الحلقة ${w.episode}`), bar(ratio), when);
    const art = el('div', 'an-hr-art');
    art.append(image(w.poster));
    const x = button('an-hr-x', glyph('close'), (ev) => {
      ev.stopPropagation();
      const all = readWatch();
      delete all[w.id];
      writeJson(WATCH_KEY, all);
      r.remove();
      if (!Object.keys(all).length) renderLibrary();
    }, 'احذف من السجل');
    r.append(art, info, x);
    r.onclick = () => void openAnime({ id: w.id, title: w.title, poster: w.poster, posterSmall: w.poster, banner: w.banner, color: w.color });
    return r;
  }

  function renderLibrary() {
    const host = q('animeLibrary');
    if (!host) return;
    const tabs = el('div', 'an-tabs an-tabs--page');
    for (const [k, label] of [
      ['history', 'سجل المشاهدة'],
      ['list', 'قائمتي'],
    ]) {
      tabs.append(
        button(`an-tab${state.libraryTab === k ? ' active' : ''}`, label, () => {
          state.libraryTab = k;
          renderLibrary();
        }),
      );
    }
    const nodes = [tabs];
    if (state.libraryTab === 'history') {
      const items = watching();
      if (!items.length) nodes.push(emptyBox('clock', 'لا مشاهدات بعد', 'أول حلقة تشاهدها تظهر هنا بتقدّمها.'));
      else {
        nodes.push(
          button('an-clear', 'مسح الكل', () => {
            writeJson(WATCH_KEY, {});
            renderLibrary();
            toast('مُسح سجل المشاهدة');
          }),
        );
        const list = el('div', 'an-hr-list');
        list.append(...items.map(historyRow));
        nodes.push(list, el('div', 'an-foot', 'تم حفظ هذه المشاهدات على جهازك'));
      }
    } else {
      const items = Object.values(readJson(LIST_KEY, {})).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
      if (!items.length) {
        const box = emptyBox('library', 'قائمتك فارغة', 'اضغط ♡ أو علامة الحفظ في صفحة أي أنمي ليظهر هنا.');
        box.append(button('an-cta', 'اكتشف أنمي', () => openDiscover({})));
        nodes.push(box);
      } else {
        const grid = el('div', 'an-grid');
        grid.append(...items.map((m) => posterCard(m)));
        nodes.push(el('p', 'an-count', `${items.length} في قائمتك`), grid);
      }
    }
    host.replaceChildren(...nodes);
    stripIn([...host.querySelectorAll('.an-hr, .an-card')].slice(0, 10));
  }
  function emptyBox(icon, title, text) {
    const box = el('div', 'an-empty');
    box.innerHTML = `<div class="an-empty-icon">${glyph(icon, { size: 30 })}</div><h3>${title}</h3><p>${text}</p>`;
    return box;
  }

  function shareCurrent() {
    const m = state.detail;
    if (!m) return;
    const url = `https://anilist.co/anime/${m.id}`;
    if (navigator.share) void navigator.share({ title: m.title, url }).catch(() => {});
    else void navigator.clipboard?.writeText(url).then(() => toast('نُسخ الرابط'));
  }

  return { show, loadHome, openAnime, showDiscover, renderLibrary, openDiscover, shareCurrent, leaveDetail: () => {} };
}
