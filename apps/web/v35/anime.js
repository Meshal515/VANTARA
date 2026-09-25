/**
 * VANTARA ANIME — الرئيسية، صفحة الأنمي، اكتشف، قائمتي.
 *
 * نفس هيكل التطبيق (الترويسة، التنقّل، الأوراق)، وتركيبٌ خاص بالأنمي:
 *
 *   - البانر بطاقات دائرية الزوايا تطلّ جاراتها من الجانبين ونقاط تحته.
 *   - «آخر المشاهدات» بشريط تقدّم ونسبة، و«حلقات جديدة» بطاقات أفقية
 *     (الحلقة هي الوحدة هنا لا العمل)، و«Top 10» بأرقام كبيرة مفرّغة،
 *     والأنواع بألوانها.
 *   - صفحة الأنمي: بانر، بوستر يعلوه، حقائق، بطاقة أرقام (التقييم يُعدّ)،
 *     زر المشاهدة يعرف من أين تكمل، الحلقة القادمة بعدّاد، وشبكة حلقات.
 *   - قائمتي: سجل المشاهدة (تقدّم وتاريخ وحذف) وقائمتي.
 *
 * البيانات الوصفية من AniList (`lib/anime-meta.js`)، وتُحفظ آخر رئيسية
 * فتظهر فورًا في الفتحة التالية. التشغيل (السيرفرات) من امتدادات المصادر
 * العربية، ويُربط في الخطوة التالية.
 */
import { glyph, iconButton } from './icons.js';
import { FORMAT_AR, SEASON_AR, STATUS_AR, compactCount, fetchAnimeDetail, fetchAnimeHome, relativeAr, searchAnime } from '../lib/anime-meta.js';
import { countUp, pageIn, pop, revealIn, stripIn } from './motion.js';

const HOME_KEY = 'anime.home.v2';
const LIST_KEY = 'vantara.anime.list';
const WATCH_KEY = 'vantara.anime.watch';
const STALE_MS = 30 * 60_000;
const SLIDE_MS = 5500;

const ANIME_GENRES = [
  ['Action', 8], ['Adventure', 28], ['Fantasy', 265], ['Romance', 335], ['Comedy', 45], ['Drama', 215],
  ['Mystery', 190], ['Horror', 355], ['Psychological', 290], ['Sci-Fi', 175], ['Supernatural', 245],
  ['Sports', 140], ['Slice of Life', 95], ['Thriller', 0], ['Mecha', 200], ['Music', 310],
];
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
    detailToken: 0,
    detailScroll: null,
    episodeRange: 0,
    libraryTab: 'history',
    discover: { query: '', genre: '', page: 1, items: [], hasNext: false, token: 0 },
  };

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
  const tint = (node, color) => {
    if (color) node.style.setProperty('--art', color);
  };
  const scoreBadge = (score) => {
    const s = el('span', 'an-score');
    s.innerHTML = `${glyph('star', { size: 12, filled: true })}<b>${score.toFixed(1)}</b>`;
    return s;
  };
  const progress = (ratio) => {
    const b = el('span', 'an-bar');
    const fill = el('i');
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    b.append(fill);
    return b;
  };
  const metaLine = (m) => [FORMAT_AR[m.format] ?? null, m.year ?? null].filter(Boolean).join(' · ');

  function rail(title, { sub, cls = '', items = [], card, more } = {}) {
    const s = el('section', `an-rail ${cls}`);
    s.dataset.reveal = '';
    const head = el('div', 'an-rail-head');
    const titles = el('div', 'an-rail-titles');
    titles.append(el('h2', null, title));
    if (sub) titles.append(el('span', 'an-rail-sub', sub));
    head.append(titles);
    if (more) head.append(button('an-more', `<span>الكل</span>${glyph('chevron', { size: 16 })}`, more));
    const strip = el('div', 'an-strip');
    strip.append(...items.map(card));
    s.append(head, strip);
    return s;
  }

  // ───────────── البطاقات ─────────────

  function posterCard(m, { rank } = {}) {
    const c = el('button', `an-card${rank ? ' an-card--ranked' : ''}`);
    c.type = 'button';
    c.setAttribute('aria-label', m.title);
    tint(c, m.color);
    if (rank) c.append(el('span', 'an-rank', String(rank)));
    const art = el('div', 'an-poster');
    art.append(image(m.posterSmall ?? m.poster));
    if (m.score) art.append(scoreBadge(m.score));
    if (m.status === 'RELEASING' && m.aired) art.append(el('span', 'an-ep-badge', `ح ${m.aired}`));
    c.append(art);
    if (!rank) {
      const t = el('span', 'an-card-title', m.title);
      t.dir = 'auto';
      c.append(t, el('span', 'an-card-meta', m.relation ?? metaLine(m)));
    }
    c.onclick = () => void openAnime(m);
    return c;
  }

  /** بطاقة حلقة: عريضة، الحلقة ومتى نزلت، وزر تشغيل زجاجي. */
  function episodeCard(m) {
    const c = el('button', 'an-ep-card');
    c.type = 'button';
    c.setAttribute('aria-label', `${m.title} — الحلقة ${m.episode}`);
    tint(c, m.color);
    const art = el('div', 'an-ep-art');
    art.append(image(m.banner ?? m.poster, 'an-img', { position: m.banner ? 'center' : 'center 22%' }), el('span', 'an-ep-shade'));
    const play = el('span', 'an-play');
    play.innerHTML = glyph('play', { size: 18, filled: true });
    art.append(play, el('span', 'an-ep-num', `الحلقة ${m.episode}`));
    const copy = el('span', 'an-ep-copy');
    const t = el('span', 'an-ep-title', m.title);
    t.dir = 'auto';
    copy.append(t, el('span', 'an-ep-when', relativeAr(m.airedAt)));
    c.append(art, copy);
    c.onclick = () => void openAnime(m, { episode: m.episode });
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
    const t = el('span', 'an-cw-title', w.title);
    t.dir = 'auto';
    info.append(el('b', 'an-cw-ep', `الحلقة ${pad2(w.episode)}`), t, progress(ratio), el('span', 'an-cw-pct', `${(ratio * 100).toFixed(1)}%`));
    c.append(art, info);
    c.onclick = () => void openAnime({ id: w.id, title: w.title, poster: w.poster, posterSmall: w.poster, banner: w.banner, color: w.color });
    return c;
  }

  function genreChips() {
    const s = el('section', 'an-rail an-genres');
    s.dataset.reveal = '';
    const head = el('div', 'an-rail-head');
    head.append(el('h2', null, 'تصفّح حسب النوع'));
    const strip = el('div', 'an-chips');
    for (const [g, hue] of ANIME_GENRES) {
      const b = button('an-chip', genreAr(g), () => openDiscover({ genre: g }));
      b.style.setProperty('--hue', String(hue));
      strip.append(b);
    }
    s.append(head, strip);
    return s;
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
      tint(s, m.color);
      s.append(image(m.banner ?? m.poster, 'an-img', { eager: i < 2, position: m.banner ? 'center' : 'center 25%' }), el('span', 'an-car-shade'));
      const copy = el('span', 'an-car-copy');
      const kicker = el('span', 'an-car-kicker');
      kicker.innerHTML = `<span class="an-car-rank">#${i + 1}</span><span>رائج الآن</span>`;
      const t = el('span', 'an-car-title', m.title);
      t.dir = 'auto';
      const facts = el('span', 'an-car-sub');
      if (m.score) facts.append(scoreBadge(m.score));
      const ep = m.status === 'RELEASING' && m.aired ? `الحلقة ${m.aired}` : m.episodes ? `${m.episodes} حلقة` : null;
      for (const f of [FORMAT_AR[m.format], ep].filter(Boolean)) facts.append(el('span', null, f));
      copy.append(kicker, t, facts);
      s.append(copy);
      s.onclick = () => void openAnime(m);
      track.append(s);
      const d = button(`an-dot${i === 0 ? ' active' : ''}`, '', () => goSlide(track, i), `الشريحة ${i + 1}`);
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
      s.style.opacity = (1 - t * 0.45).toFixed(3);
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

  function renderHome(data) {
    const blocks = el('div', 'an-home');
    if (data.hero?.length) blocks.append(carousel(data.hero));
    const cont = watching();
    if (cont.length) blocks.append(rail('آخر المشاهدات', { items: cont.slice(0, 12), card: continueCard, more: () => openLibrary('history') }));
    if (data.latest?.length) blocks.append(rail('حلقات جديدة', { sub: 'نزلت هذا الأسبوع', cls: 'an-rail--wide', items: data.latest.slice(0, 16), card: episodeCard }));
    if (data.season?.length) {
      const top = data.season.slice(0, 10);
      blocks.append(rail('Top 10', { sub: `موسم ${data.seasonName}`, cls: 'an-rail--top', items: top, card: (m) => posterCard(m, { rank: top.indexOf(m) + 1 }) }));
    }
    blocks.append(genreChips());
    if (data.trending?.length) blocks.append(rail('رائج هذا الأسبوع', { items: data.trending, card: (m) => posterCard(m), more: () => openDiscover({}) }));
    if (data.popular?.length) blocks.append(rail('الأشهر على الإطلاق', { items: data.popular, card: (m) => posterCard(m) }));
    if (data.top?.length) blocks.append(rail('الأعلى تقييمًا', { items: data.top, card: (m) => posterCard(m) }));
    blocks.append(el('p', 'an-credit', 'بيانات الأعمال من AniList · التشغيل من المصادر العربية'));
    q('animeHome').replaceChildren(blocks);
    return blocks;
  }

  function renderSkeleton() {
    const box = el('div', 'an-home');
    const car = el('div', 'an-car');
    const track = el('div', 'an-car-track');
    track.append(el('div', 'an-car-slide an-skel'), el('div', 'an-car-slide an-skel'));
    car.append(track);
    box.append(car);
    for (const wide of [true, false]) {
      const r = el('section', `an-rail${wide ? ' an-rail--wide' : ''}`);
      const head = el('div', 'an-rail-head');
      head.append(el('span', 'an-skel an-skel-line'));
      const strip = el('div', 'an-strip');
      for (let i = 0; i < 5; i++) strip.append(el('div', `an-skel ${wide ? 'an-skel-wide' : 'an-skel-poster'}`));
      r.append(head, strip);
      box.append(r);
    }
    q('animeHome').replaceChildren(box);
  }

  function renderError(retry) {
    const box = emptyBox('offline', 'تعذّر جلب الأنمي', 'تحقّق من الاتصال ثم أعد المحاولة.');
    box.append(button('an-btn an-btn--primary', 'أعد المحاولة', retry));
    q('animeHome').replaceChildren(box);
  }

  /** الرئيسية: المحفوظ فورًا، ثم الحديث إن قدُم المحفوظ. */
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
        // لا تُعاد بناء رئيسية أمام العين إلا أول مرة؛ بعدها تتحدّث في الفتحة القادمة
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

  // ───────────── قائمتي ─────────────

  const inList = (id) => Boolean(readJson(LIST_KEY, {})[id]);
  function toggleList(m) {
    const all = readJson(LIST_KEY, {});
    if (all[m.id]) delete all[m.id];
    else {
      const { id, title, poster, posterSmall, banner, color, format, year, score, status, episodes, aired } = m;
      all[m.id] = { id, title, poster, posterSmall, banner, color, format, year, score, status, episodes, aired, at: Date.now() };
    }
    writeJson(LIST_KEY, all);
    return Boolean(all[m.id]);
  }
  function listButton(m, cls) {
    const b = el('button', cls);
    b.type = 'button';
    const paint = () => {
      const on = inList(m.id);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'في قائمتي' : 'أضف إلى قائمتي');
      b.innerHTML = `${glyph(on ? 'check' : 'plus', { size: 18 })}<span>${on ? 'في قائمتي' : 'قائمتي'}</span>`;
    };
    paint();
    b.onclick = (e) => {
      e.stopPropagation();
      const on = toggleList(m);
      paint();
      pop(b);
      toast(on ? `أُضيف إلى قائمتي: ${m.title}` : 'أُزيل من قائمتي');
    };
    return b;
  }

  // ───────────── صفحة الأنمي ─────────────

  async function openAnime(m, { episode = null } = {}) {
    const token = ++state.detailToken;
    state.episodeRange = 0;
    state.detail = m;
    deps.showPage('anime');
    renderDetail(m, { partial: true });
    try {
      const full = await fetchAnimeDetail(m.id);
      if (token !== state.detailToken || !full) return;
      state.detail = full;
      if (episode) state.episodeRange = Math.floor((episode - 1) / 50);
      renderDetail(full);
      if (episode) q('anime').querySelector(`[data-ep="${episode}"]`)?.scrollIntoView({ block: 'center' });
    } catch {
      if (token !== state.detailToken) return;
      q('animeEpisodes')?.replaceChildren(el('p', 'an-note', 'تعذّر جلب تفاصيل الأنمي — تحقّق من الاتصال.'));
    }
  }

  /** من أين يكمل زر المشاهدة: الحلقة غير المكتملة الأخيرة، أو التالية لآخر مكتملة. */
  function resumePoint(m) {
    const w = readWatch()[m.id];
    if (!w?.episode) return { episode: 1, resume: false };
    const e = w.episodes?.[w.episode];
    if (e && !e.done) return { episode: w.episode, resume: true };
    const total = m.aired || m.episodes || w.episode + 1;
    return { episode: Math.min(total, w.episode + 1), resume: true };
  }

  function renderDetail(m, { partial = false } = {}) {
    const page = q('anime');
    page.style.removeProperty('--art');
    tint(page, m.color);
    const wrap = el('div', 'an-detail');

    const bar = el('div', 'an-detail-top');
    bar.innerHTML = iconButton('back', 'رجوع', { act: 'goBack' }) + `<span class="an-detail-top-title" dir="auto"></span>` + iconButton('share', 'شارك', { act: 'shareAnime' });
    bar.querySelector('.an-detail-top-title').textContent = m.title;

    const hero = el('div', 'an-detail-hero');
    const art = el('div', 'an-detail-art');
    art.dataset.art = '';
    art.append(image(m.banner ?? m.poster, 'an-img', { eager: true, position: m.banner ? 'center' : 'center 20%' }), el('div', 'an-detail-shade'));
    hero.append(art);

    const head = el('div', 'an-detail-head');
    head.dataset.reveal = '';
    const poster = el('div', 'an-detail-poster');
    poster.append(image(m.poster, 'an-img', { eager: true }));
    const titles = el('div', 'an-detail-titles');
    const h1 = el('h1', null, m.title);
    h1.dir = 'auto';
    titles.append(h1);
    const alt = m.romaji && m.romaji !== m.title ? m.romaji : m.native;
    if (alt && alt.toLowerCase() !== m.title.toLowerCase()) {
      const a = el('div', 'an-detail-alt', alt);
      a.dir = 'auto';
      titles.append(a);
    }
    head.append(poster, titles);

    const facts = el('div', 'an-facts');
    facts.dataset.reveal = '';
    if (m.status) facts.append(el('span', `an-status an-status--${String(m.status).toLowerCase()}`, STATUS_AR[m.status] ?? m.status));
    for (const f of [FORMAT_AR[m.format], m.season && m.year ? `${SEASON_AR[m.season]} ${m.year}` : m.year, m.studio]) if (f) facts.append(el('span', 'an-fact', String(f)));

    const stats = el('div', 'an-stats');
    stats.dataset.reveal = '';
    const stat = (value, label, cls = '') => {
      const s = el('div', `an-stat ${cls}`);
      const v = el('b', null, value);
      s.append(v, el('span', null, label));
      stats.append(s);
      return v;
    };
    const scoreNode = m.score ? stat('0.0', 'التقييم', 'an-stat--score') : null;
    stat(String(m.episodes ?? (m.aired || '—')), 'حلقة');
    if (m.duration) stat(String(m.duration), 'دقيقة للحلقة');
    if (m.popularity) stat(compactCount(m.popularity), 'متابع');

    const actions = el('div', 'an-detail-actions');
    actions.dataset.reveal = '';
    const { episode: startEp, resume } = resumePoint(m);
    const watch = button('an-btn an-btn--primary an-btn--wide', `${glyph('play', { size: 20, filled: true })}<span>${resume ? 'تابع' : 'شاهد'} الحلقة ${startEp}</span>`, () => playEpisode(m, startEp));
    const party = button('an-btn an-btn--icon', glyph('users', { size: 20 }), () => toast('المشاهدة الجماعية قريبًا: تابعوا معي وتزامن لحظي'), 'مشاهدة جماعية');
    actions.append(watch, listButton(m, 'an-btn an-btn--glass'), party);

    wrap.append(bar, hero, head, facts, stats, actions);

    if (m.next) {
      const next = el('div', 'an-next');
      next.dataset.reveal = '';
      next.innerHTML = `<span class="an-next-dot"></span><span>الحلقة ${m.next.episode} ${relativeAr(m.next.at)}</span>`;
      wrap.append(next);
    }

    if (m.description) {
      const about = el('section', 'an-block');
      about.dataset.reveal = '';
      const p = el('p', 'an-synopsis clamped', m.description);
      p.dir = 'auto';
      const more = button('an-more-text', 'المزيد', () => {
        const closed = p.classList.toggle('clamped');
        more.textContent = closed ? 'المزيد' : 'أقل';
      });
      about.append(p, more);
      if (m.genres?.length) {
        const g = el('div', 'an-tags');
        for (const x of m.genres) g.append(button('an-tag', genreAr(x), () => openDiscover({ genre: x })));
        about.append(g);
      }
      wrap.append(about);
    }

    const eps = el('section', 'an-block an-episodes');
    eps.dataset.reveal = '';
    eps.id = 'animeEpisodes';
    if (partial) eps.append(el('div', 'an-skel an-skel-grid'));
    else renderEpisodes(eps, m);
    wrap.append(eps);

    if (!partial && m.relations?.length) wrap.append(rail('من نفس العالم', { items: m.relations, card: (r) => posterCard(r) }));
    if (!partial && m.recommendations?.length) wrap.append(rail('قد يعجبك', { items: m.recommendations, card: (r) => posterCard(r) }));

    page.replaceChildren(wrap);
    bindDetailScroll(page, bar);
    if (scoreNode) countUp(scoreNode, m.score);
    if (partial) pageIn(page);
  }

  function renderEpisodes(host, m) {
    const total = m.aired || m.episodes || 0;
    const head = el('div', 'an-rail-head an-rail-head--flat');
    const titles = el('div', 'an-rail-titles');
    titles.append(el('h2', null, 'الحلقات'), el('span', 'an-rail-sub', total ? `${total} حلقة متاحة${m.episodes && m.episodes > total ? ` من ${m.episodes}` : ''}` : 'لم تُعرض بعد'));
    head.append(titles);
    host.replaceChildren(head);
    if (!total) return;
    const SIZE = 50;
    const ranges = Math.ceil(total / SIZE);
    if (ranges > 1) {
      const tabs = el('div', 'an-ranges');
      for (let r = 0; r < ranges; r++) {
        tabs.append(
          button(`an-range${r === state.episodeRange ? ' active' : ''}`, `${r * SIZE + 1}–${Math.min(total, (r + 1) * SIZE)}`, () => {
            state.episodeRange = r;
            renderEpisodes(host, m);
          }),
        );
      }
      host.append(tabs);
      requestAnimationFrame(() => tabs.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
    }
    const seen = readWatch()[m.id]?.episodes ?? {};
    const grid = el('div', 'an-ep-grid');
    const start = state.episodeRange * SIZE + 1;
    for (let n = start; n <= Math.min(total, start + SIZE - 1); n++) {
      const e = seen[n];
      const ratio = e?.duration ? Math.min(1, e.position / e.duration) : 0;
      const b = button(`an-ep${e?.done ? ' seen' : e ? ' partial' : ''}`, `<b>${n}</b><span>${e?.done ? 'شوهدت' : 'حلقة'}</span>`, () => playEpisode(m, n));
      b.dataset.ep = String(n);
      if (e && !e.done) b.append(progress(ratio));
      grid.append(b);
    }
    host.append(grid);
    stripIn([...grid.children].slice(0, 20));
  }

  function bindDetailScroll(page, bar) {
    const onScroll = () => {
      if (deps.currentPage() !== 'anime') return;
      bar.classList.toggle('scrolled', window.scrollY > 180);
      const art = page.querySelector('.an-detail-art');
      if (art) art.style.translate = `0 ${Math.min(120, window.scrollY * 0.35)}px`;
    };
    window.removeEventListener('scroll', state.detailScroll);
    state.detailScroll = onScroll;
    window.addEventListener('scroll', onScroll, { passive: true });
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
    const chips = el('div', 'an-chips an-chips--filter');
    const pick = (g) => () => {
      state.discover = { ...state.discover, genre: g, page: 1, items: [] };
      renderDiscover();
      void loadDiscover();
    };
    chips.append(button(`an-chip${d.genre ? '' : ' active'}`, 'الكل', pick('')));
    for (const [g, hue] of ANIME_GENRES) {
      const b = button(`an-chip${d.genre === g ? ' active' : ''}`, genreAr(g), pick(g));
      b.style.setProperty('--hue', String(hue));
      chips.append(b);
    }
    const grid = el('div', 'an-grid');
    grid.id = 'animeDiscoverGrid';
    const more = button('an-btn an-btn--glass an-load-more', 'المزيد', () => {
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

  // ───────────── مكتبتي: سجل المشاهدة + قائمتي ─────────────

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
    info.append(t, el('span', 'an-hr-ep', `الحلقة ${w.episode}`), progress(ratio), when);
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
    const tabs = el('div', 'an-seg');
    for (const [k, label] of [
      ['history', 'سجل المشاهدة'],
      ['list', 'قائمتي'],
    ]) {
      tabs.append(
        button(`an-seg-btn${state.libraryTab === k ? ' active' : ''}`, label, () => {
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
        const box = emptyBox('library', 'قائمتك فارغة', 'اضغط «قائمتي» على أي أنمي ليظهر هنا.');
        box.append(button('an-btn an-btn--primary', 'اكتشف أنمي', () => openDiscover({})));
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

  return { show, loadHome, openAnime, showDiscover, renderLibrary, openDiscover, shareCurrent, leaveDetail: () => window.removeEventListener('scroll', state.detailScroll) };
}
