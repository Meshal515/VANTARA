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
import { FORMAT_AR, SEASON_AR, STATUS_AR, compactCount, fetchAnimeDetail, fetchAnimeHome, fetchMalEpisodes, relativeAr, searchAnime } from '../lib/anime-meta.js';
import { countUp, pageIn, pop, revealIn, stripIn } from './motion.js';
import * as engine from '../lib/anime-engine.js';

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
    work: null,
    workFor: null,
    playing: null,
    newestFirst: false,
    malTitles: {},
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
      s.onclick = () => void openAnime(m);
      track.append(s);
      dots.append(button(`an-dot${i === 0 ? ' active' : ''}`, '', () => goSlide(track, i), `الشريحة ${i + 1}`));
    });
    // المعلومات تحت البطاقة لا فوقها: تذوب مع السحب وتظهر معلومات التالية
    const info = el('div', 'an-car-info');
    wrap.append(track, dots, info);
    wrap._items = items;
    wrap._shown = -1;
    let raf = 0;
    track.addEventListener(
      'scroll',
      () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => paintCarousel(wrap));
      },
      { passive: true },
    );
    track.addEventListener('touchstart', () => clearInterval(state.carouselTimer), { passive: true });
    track.addEventListener('touchend', () => autoplay(track));
    requestAnimationFrame(() => paintCarousel(wrap));
    autoplay(track);
    return wrap;
  }
  function carouselInfo(m, i) {
    const box = el('div', 'an-car-info-in');
    const kicker = el('span', 'an-car-kicker');
    kicker.innerHTML = `<span class="an-car-rank">#${i + 1}</span><span>رائج الآن</span>`;
    const t = el('h2', 'an-car-title', m.title);
    t.dir = 'auto';
    const facts = el('span', 'an-car-sub');
    if (m.score) facts.append(scoreBadge(m.score));
    const ep = m.status === 'RELEASING' && m.aired ? `الحلقة ${m.aired}` : m.episodes ? `${m.episodes} حلقة` : null;
    for (const f of [FORMAT_AR[m.format], ep, (m.genres ?? []).slice(0, 2).map(genreAr).join(' · ')].filter(Boolean)) facts.append(el('span', null, f));
    const actions = el('div', 'an-car-actions');
    actions.append(
      button('an-btn an-btn--primary', `${glyph('play', { size: 18, filled: true })}<span>شاهد</span>`, () => void openAnime(m, { episode: 1 })),
      listButton(m, 'an-btn an-btn--glass'),
    );
    box.append(kicker, t, facts, actions);
    return box;
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
  /** البطاقات الجانبية تصغر وتخفت، والوسطى بحجمها، والمعلومات تحتها تذوب مع البعد عن المنتصف. */
  function paintCarousel(wrap) {
    const track = wrap.querySelector('.an-car-track');
    const dots = wrap.querySelector('.an-car-dots');
    const info = wrap.querySelector('.an-car-info');
    const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
    let nearest = 1;
    for (const s of track.children) {
      const r = s.getBoundingClientRect();
      const t = Math.min(1, Math.abs(r.left + r.width / 2 - mid) / r.width);
      nearest = Math.min(nearest, t);
      s.style.transform = `scale(${(1 - t * 0.1).toFixed(3)})`;
      s.style.opacity = (1 - t * 0.45).toFixed(3);
    }
    const i = slideIndex(track);
    [...dots.children].forEach((d, k) => d.classList.toggle('active', k === i));
    if (wrap._shown !== i) {
      wrap._shown = i;
      info.replaceChildren(carouselInfo(wrap._items[i], i));
    }
    // في منتصف السحبة تكون المعلومات شفافة، وتكتمل حين تستقرّ البطاقة
    const fade = Math.max(0, 1 - nearest * 2.4);
    info.style.opacity = fade.toFixed(3);
    info.style.transform = `translateY(${((1 - fade) * 8).toFixed(1)}px)`;
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

  async function openAnime(m, { episode = null, position = null } = {}) {
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
      state.malTitles = {};
      renderDetail(full);
      void locateWork(full, token);
      // لحظة أرسلها صديق: ورقة سيرفرات الحلقة جاهزة من ثانيتها
      if (episode && position != null) playEpisode(full, episode, { position });
      if (episode) q('anime').querySelector(`[data-ep="${episode}"]`)?.scrollIntoView({ block: 'center' });
      // عناوين الحلقات من MAL: إضافة لا تؤخّر الصفحة
      void fetchMalEpisodes(full.idMal)
        .then(({ titles }) => {
          if (token !== state.detailToken || !Object.keys(titles).length) return;
          state.malTitles = titles;
          const box = q('animeEpisodes');
          if (box) renderEpisodes(box, full);
        })
        .catch(() => {});
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
    // ترشيح لصديق أو للمجلس (بدل زر «مشاهدة جماعية» لم يكن يعمل)
    const recommend = button('an-btn an-btn--icon', glyph('send', { size: 20 }), () => shareCurrent(), 'رشّح لصديق');
    actions.append(watch, listButton(m, 'an-btn an-btn--glass'), recommend);

    const sourcesStrip = el('div', 'an-sources');
    sourcesStrip.id = 'animeSources';
    sourcesStrip.dataset.reveal = '';
    wrap.append(bar, hero, head, facts, stats, actions, sourcesStrip);
    paintSources(m);

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

  function setSeen(m, n, on) {
    const all = readWatch();
    const w = all[m.id] ?? { id: m.id, episodes: {} };
    Object.assign(w, { title: m.title, poster: m.posterSmall ?? m.poster, banner: m.banner, color: m.color });
    const prev = w.episodes[n] ?? { position: 0, duration: 0 };
    if (on) w.episodes[n] = { ...prev, done: true, at: Date.now() };
    else delete w.episodes[n];
    if (on && (!w.episode || n >= w.episode)) {
      w.episode = n;
      w.at = Date.now();
    }
    all[m.id] = w;
    writeJson(WATCH_KEY, all);
  }

  function episodeRow(m, n, e) {
    const ratio = e?.duration ? Math.min(1, e.position / e.duration) : 0;
    const row = el('div', `an-er${e?.done ? ' seen' : ''}`);
    row.dataset.ep = String(n);
    const main = el('button', 'an-er-main');
    main.type = 'button';
    const art = el('span', 'an-er-art');
    const thumb = m.thumbs?.[n]?.thumbnail;
    art.append(image(thumb ?? m.banner ?? m.poster, 'an-img', { position: thumb || m.banner ? 'center' : 'center 25%' }));
    art.append(el('span', 'an-er-no', String(n)));
    if (ratio > 0 && !e?.done) {
      const bar = progress(ratio);
      bar.classList.add('an-er-bar');
      art.append(bar);
    }
    const copy = el('span', 'an-er-copy');
    copy.append(el('b', null, `الحلقة ${n}`));
    const title = state.malTitles?.[n] ?? m.thumbs?.[n]?.title;
    const sub = el('span', 'an-er-sub', [title, m.duration ? `${m.duration} د` : null].filter(Boolean).join(' · ') || (e?.done ? 'شوهدت' : ''));
    sub.dir = 'auto';
    copy.append(sub);
    main.append(art, copy);
    main.onclick = () => playEpisode(m, n);
    const eye = button(`an-er-icon${e?.done ? ' on' : ''}`, glyph('eye', { size: 20 }), () => {
      setSeen(m, n, !e?.done);
      const box = q('animeEpisodes');
      if (box) renderEpisodes(box, m);
    }, e?.done ? 'ألغِ «شوهدت»' : 'علّمها شوهدت');
    row.append(main, eye);
    return row;
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
    state.episodeRange = Math.min(state.episodeRange, ranges - 1);

    // أدوات: انتقل لحلقة برقمها، وعكس الترتيب
    const tools = el('div', 'an-ep-tools');
    const jump = el('form', 'an-jump');
    jump.innerHTML = `${glyph('search', { size: 18 })}<input type="number" inputmode="numeric" min="1" max="${total}" placeholder="انتقل للحلقة… (1–${total})" aria-label="رقم الحلقة">`;
    jump.onsubmit = (ev) => {
      ev.preventDefault();
      const n = Math.max(1, Math.min(total, Number(jump.querySelector('input').value) || 1));
      state.episodeRange = Math.floor((n - 1) / SIZE);
      renderEpisodes(host, m);
      const target = host.querySelector(`[data-ep="${n}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target?.classList.add('flash');
    };
    const order = button(`an-er-icon${state.newestFirst ? ' on' : ''}`, glyph('sort', { size: 20 }), () => {
      state.newestFirst = !state.newestFirst;
      renderEpisodes(host, m);
    }, state.newestFirst ? 'الأحدث أولًا' : 'الأقدم أولًا');
    tools.append(jump, order);
    host.append(tools);

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
    const list = el('div', 'an-er-list');
    const start = state.episodeRange * SIZE + 1;
    const nums = [];
    for (let n = start; n <= Math.min(total, start + SIZE - 1); n++) nums.push(n);
    if (state.newestFirst) nums.reverse();
    list.append(...nums.map((n) => episodeRow(m, n, seen[n])));
    host.append(list);
    stripIn([...list.children].slice(0, 8));
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

  // ───────────── المصادر العربية والتشغيل ─────────────

  /** يبحث عن الأنمي في كل المصادر العربية (محرك التطبيق) ويدمج نسخه. */
  async function locateWork(m, token = state.detailToken) {
    if (!engine.available()) return null;
    if (state.workFor === m.id && state.work) return state.work;
    state.work = null;
    state.workFor = m.id;
    paintSources(m, 'loading');
    try {
      const work = await engine.findWork([m.title, m.romaji, m.native, ...(m.synonyms ?? [])]);
      if (token !== state.detailToken) return null;
      state.work = work;
      paintSources(m, work ? 'found' : 'none');
      return work;
    } catch {
      if (token === state.detailToken) paintSources(m, 'error');
      return null;
    }
  }

  function paintSources(m, phase = state.work ? 'found' : engine.available() ? 'loading' : 'web') {
    const host = q('animeSources');
    if (!host) return;
    host.replaceChildren();
    const label = el('span', 'an-sources-label');
    if (phase === 'web') {
      label.textContent = 'التشغيل من المصادر العربية داخل تطبيق أندرويد';
      host.append(label);
      return;
    }
    if (phase === 'loading') {
      label.innerHTML = '<i class="an-sources-spin"></i><span>نبحث في المصادر العربية…</span>';
      host.append(label);
      return;
    }
    if (phase !== 'found') {
      label.textContent = phase === 'error' ? 'تعذّر البحث في المصادر — تحقّق من الاتصال' : 'غير متوفر في المصادر العربية حاليًا';
      host.append(label, button('an-sources-retry', 'ابحث مجددًا', () => {
        state.workFor = null;
        void locateWork(m);
      }));
      return;
    }
    label.textContent = 'متوفر في';
    host.append(label);
    for (const c of state.work.copies) host.append(el('span', 'an-source-chip', c.sourceId === state.work.copies[0].sourceId ? `${sourceName(c.sourceId)} ★` : sourceName(c.sourceId)));
  }

  const SOURCE_NAMES = {};
  const sourceName = (id) => SOURCE_NAMES[id] ?? id;
  void engine.sources().then((list) => {
    for (const s of list ?? []) SOURCE_NAMES[s.id] = s.name;
  }).catch(() => {});

  // ───────────── التشغيل: ورقة السيرفرات ثم المشغّل الأصلي ─────────────

  /** آخر سيرفر نجح أو اختاره المستخدم لكل أنمي: ترجيح في «الأفضل» لا قفل. */
  const SERVER_KEY = 'vantara.anime.servers';
  const preferredCode = (id) => readJson(SERVER_KEY, {})[id] ?? null;
  const rememberCode = (id, code) => {
    if (!id || !code) return;
    const all = readJson(SERVER_KEY, {});
    all[id] = code;
    writeJson(SERVER_KEY, all);
  };

  // تقدّم المشغّل الأصلي ← سجل المشاهدة (الاستئناف و«آخر المشاهدات»). الحلقة
  // من الحدث نفسه: التبديل لحلقة أخرى داخل المشغّل يُسجَّل لها لا للأولى.
  engine.on('playback', (p) => {
    const cur = state.playing;
    if (!cur || (p.animeId ? String(p.animeId) !== String(cur.m.id) : p.session !== cur.session)) return;
    const n = Number.isFinite(p.episode) && p.episode > 0 ? p.episode : cur.n;
    if (p.duration > 0) recordWatch(cur.m, n, p.position, p.duration);
    if (p.code) rememberCode(cur.m.id, p.code);
    cur.n = n;
    if (p.final) {
      // المشغّل أُغلق (التبديل بين الحلقات داخله ليس نهاية)
      state.playing = null;
      deps.setWatching?.(null);
      const box = q('animeEpisodes');
      if (box && state.detail?.id === cur.m.id) renderEpisodes(box, state.detail);
    } else {
      deps.setWatching?.({ ref: `anime:${cur.m.id}`, title: cur.m.title, episode: n });
    }
  });
  engine.on('episode', (e) => {
    const cur = state.playing;
    if (!cur || String(e.animeId) !== String(cur.m.id)) return;
    cur.session = e.session;
    cur.n = e.episode;
  });
  engine.on('server', (e) => {
    if (e?.animeId && e.code) rememberCode(e.animeId, e.code);
  });

  /**
   * اللحظات والترشيحات من المشغّل ← المجلس. المشغّل يحفظها في صندوق صادر
   * أصلي فلا تضيع إن كانت الواجهة نائمة خلفه؛ هنا تُسحب وتدخل طابور المزامنة
   * (الذي يعيد المحاولة وحده حتى تصل).
   */
  async function flushOutbox() {
    if (!engine.available() || !deps.sync) return;
    let items = [];
    try {
      items = await engine.outbox();
    } catch {
      return;
    }
    for (const it of items) {
      const ep = Number(it.episode) || 1;
      const label = it.type === 'moment' ? engine.momentLabel(ep, it.startMs, it.endMs) : `الحلقة ${ep}`;
      deps.sync.enqueue('recommendation.send', {
        toId: it.toId ?? null,
        seriesRef: `anime:${it.animeId}`,
        seriesTitle: it.title || 'أنمي',
        coverUrl: it.poster ?? null,
        message: null,
        hiddenFrom: [],
        chapterLabel: label,
        chapterNumber: ep,
      });
    }
  }
  engine.on('outbox', () => void flushOutbox());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushOutbox();
  });
  setTimeout(() => void flushOutbox(), 2500);

  const STATE_AR = { RESOLVING: 'يتجهّز…', READY: 'جاهز', UNAVAILABLE: 'غير متاح', FAILED: 'فشل التشغيل' };

  /**
   * لمسة الحلقة: الورقة تفتح فورًا والسيرفرات تتجهّز خلفها واحدًا واحدًا.
   * رموز قصيرة لا أسماء استضافات، مجمّعة بالجودة، بحالة كل سيرفر الآن.
   * «شغّل الأفضل» يزن الموثوقية وسرعة البدء والجودة والفشل الأخير، ويرجّح
   * سيرفرك السابق لهذا الأنمي دون أن يقفل عليه.
   */
  function playEpisode(m, n, { position = null } = {}) {
    if (!engine.available()) {
      deps.openSheet((body) => {
        const head = el('div', 'an-sheet-head');
        const t = el('div', 'an-sheet-title', m.title);
        t.dir = 'auto';
        head.append(el('div', 'an-sheet-kicker', `الحلقة ${n}`), t);
        const note = el('div', 'an-sheet-note');
        note.innerHTML = `${glyph('layers', { size: 22 })}<div><b>التشغيل داخل التطبيق</b><span>المصادر العربية والسيرفرات تعمل في تطبيق VANTARA على أندرويد.</span></div>`;
        body.append(head, note);
      });
      return;
    }
    const saved = readWatch()[m.id]?.episodes?.[n];
    const startAt = position ?? (saved && !saved.done ? saved.position : 0);
    const prefer = preferredCode(m.id);
    const sheet = { session: null, routes: [], done: false, closed: false, launched: false, busy: false, work: null };
    let paintQueued = false;
    let off = [];

    deps.openSheet((body) => {
      body.classList.add('an-srv-sheet');
      const head = el('div', 'an-sheet-head');
      const t = el('div', 'an-sheet-title', m.title);
      t.dir = 'auto';
      head.append(el('div', 'an-sheet-kicker', `الحلقة ${n}${startAt > 5000 ? ` · من ${engine.clock(startAt)}` : ''}`), t);
      const bestBtn = el('button', 'an-btn an-btn--primary an-btn--wide an-srv-best');
      bestBtn.type = 'button';
      const status = el('div', 'an-srv-status');
      const list = el('div', 'an-srv-list');
      body.append(head, bestBtn, status, list);

      const paintBest = () => {
        const ready = sheet.routes.some((r) => r.state === 'READY');
        bestBtn.disabled = sheet.busy || (!ready && sheet.done);
        bestBtn.innerHTML = `${glyph('play', { size: 20, filled: true })}<span>${sheet.busy ? 'نجهّز أفضل سيرفر…' : 'شغّل الأفضل'}</span>`;
        bestBtn.classList.toggle('waiting', !ready && !sheet.done);
      };

      const paint = () => {
        paintQueued = false;
        if (sheet.closed) return;
        paintBest();
        const ready = sheet.routes.filter((r) => r.state === 'READY').length;
        if (!sheet.session) status.innerHTML = `<i class="an-sources-spin"></i><span>${sheet.work === false ? 'غير متوفر في المصادر العربية حاليًا' : 'نبحث في المصادر العربية…'}</span>`;
        else if (!sheet.done) status.innerHTML = `<i class="an-sources-spin"></i><span>نجهّز السيرفرات… ${ready ? `${ready} جاهز` : ''}</span>`;
        else status.textContent = ready ? `${ready} ${ready === 1 ? 'سيرفر جاهز' : 'سيرفرات جاهزة'}` : 'لم يجهز أي سيرفر لهذه الحلقة الآن';
        if (sheet.work === false) status.querySelector('i')?.remove();
        list.replaceChildren();
        for (const [name, routes] of engine.groupRoutes(sheet.routes)) {
          const group = el('section', 'an-srv-group');
          group.append(el('h4', 'an-srv-q', name));
          const grid = el('div', 'an-srv-grid');
          for (const r of routes) grid.append(tile(r));
          group.append(grid);
          list.append(group);
        }
      };
      const queuePaint = () => {
        if (paintQueued) return;
        paintQueued = true;
        requestAnimationFrame(paint);
      };

      const tile = (r) => {
        const b = el('button', `an-srv an-srv--${r.state.toLowerCase()}${r.code === prefer ? ' an-srv--prefer' : ''}`);
        b.type = 'button';
        b.disabled = r.state !== 'READY';
        const code = el('b', 'an-srv-code', r.code);
        code.dir = 'ltr';
        const line = el('span', 'an-srv-state');
        line.append(el('i', 'an-srv-dot'), el('span', null, STATE_AR[r.state] ?? ''));
        b.append(code, line);
        if (r.variant === 'DUB') b.append(el('span', 'an-srv-tag', 'مدبلج'));
        else if (r.code === prefer) b.append(el('span', 'an-srv-tag', 'آخر اختيار'));
        b.setAttribute('aria-label', `سيرفر ${r.code}، ${STATE_AR[r.state] ?? ''}`);
        b.onclick = async () => {
          if (sheet.busy) return;
          sheet.busy = true;
          paintBest();
          try {
            const candidate = await engine.pick(sheet.session, r.id);
            if (!candidate) {
              toast('هذا السيرفر لم يعد متاحًا — جرّب غيره');
              return;
            }
            rememberCode(m.id, r.code);
            await launch(candidate, r.code);
          } catch (e) {
            toast(`تعذّر التشغيل: ${e?.message ?? e}`);
          } finally {
            sheet.busy = false;
            queuePaint();
          }
        };
        return b;
      };

      bestBtn.onclick = async () => {
        if (sheet.busy || !sheet.session) return;
        sheet.busy = true;
        paintBest();
        try {
          const out = await engine.best(sheet.session, prefer);
          if (sheet.closed) return;
          if (!out?.candidate) {
            toast('لم يجهز أي سيرفر لهذه الحلقة الآن');
            return;
          }
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
        const work = state.work && state.workFor === m.id ? state.work : await locateWork(m);
        if (sheet.closed) return;
        if (!work) {
          sheet.work = false;
          sheet.done = true;
          paint();
          return;
        }
        sheet.work = work;
        off.push(
          engine.on('route', (e) => {
            if (e.session !== sheet.session || !e.route) return;
            sheet.routes = engine.upsertRoute(sheet.routes, e.route);
            queuePaint();
          }),
          engine.on('prepared', (e) => {
            if (e.session !== sheet.session) return;
            sheet.done = true;
            queuePaint();
          }),
        );
        try {
          const out = await engine.prepare({ copies: work.copies, episode: n });
          if (sheet.closed) {
            if (out?.session) void engine.closeSession(out.session);
            return;
          }
          sheet.session = out.session;
          // ما وصل قبل أن نعرف رقم الجلسة: نأخذ اللقطة الكاملة الآن
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
        // أُغلقت الورقة بلا تشغيل: لا نترك التجهيز يعمل في الخلفية
        if (!sheet.launched && sheet.session) void engine.closeSession(sheet.session);
      };
    }, { tone: 'anime' });

    async function launch(candidate, code) {
      sheet.launched = true;
      const session = sheet.session;
      deps.closeSheet();
      const watch = readWatch()[m.id]?.episodes ?? {};
      const resume = {};
      for (const [ep, e] of Object.entries(watch)) if (!e.done && e.position > 5000) resume[ep] = e.position;
      state.playing = { session, m, n };
      deps.setWatching?.({ ref: `anime:${m.id}`, title: m.title, episode: n });
      await engine.open({
        session,
        candidate,
        prefer: code ?? prefer,
        title: m.title,
        animeId: String(m.id),
        episode: n,
        total: m.aired || m.episodes || 0,
        position: startAt,
        poster: m.posterSmall ?? m.poster ?? null,
        friends: (deps.friends?.() ?? []).map((f) => ({ userId: f.userId, displayName: f.displayName })),
        copies: sheet.work.copies,
        resume,
      });
    }
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
      ...(engine.available() ? [['sources', 'المصادر']] : []),
    ]) {
      tabs.append(
        button(`an-seg-btn${state.libraryTab === k ? ' active' : ''}`, label, () => {
          state.libraryTab = k;
          renderLibrary();
        }),
      );
    }
    const nodes = [tabs];
    if (state.libraryTab === 'sources') {
      const box = el('div', 'an-health');
      box.append(el('p', 'an-note', 'نقرأ صحة المصادر…'));
      nodes.push(box);
      host.replaceChildren(...nodes);
      void renderSourcesHealth(box);
      return;
    }
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
  /** صحة كل مصدر: النجاح، آخر نجاح/فشل، الزمن، الدومين الحالي، والكتالوج المحلوب. */
  async function renderSourcesHealth(box) {
    let list;
    let records;
    try {
      [list, records] = await Promise.all([engine.sources(), engine.health()]);
    } catch (e) {
      box.replaceChildren(el('p', 'an-note', `تعذّر قراءة المحرك: ${e?.message ?? e}`));
      return;
    }
    const byKey = Object.fromEntries((records ?? []).map((r) => [r.key, r]));
    const rows = (list ?? []).map((s) => {
      const r = byKey[`source:${s.id}`];
      const row = el('div', `an-src${s.enabled ? '' : ' off'}`);
      const total = (r?.ok ?? 0) + (r?.fail ?? 0);
      const rate = total ? Math.round(((r?.ok ?? 0) / total) * 100) : null;
      const mood = !s.enabled ? 'off' : r?.blocked ? 'blocked' : r && r.streak >= 3 ? 'down' : rate === null ? 'new' : rate >= 70 ? 'good' : 'weak';
      const top = el('div', 'an-src-top');
      top.append(el('i', `an-dot-state an-dot-state--${mood}`), el('b', null, s.name), el('span', 'an-src-rate', rate === null ? '—' : `${rate}%`));
      const facts = [
        s.domain ? String(s.domain).replace(/^https?:\/\//, '') : null,
        r?.latencyMs ? `${Math.round(r.latencyMs)} ms` : null,
        r?.lastOkAt ? `آخر نجاح ${relativeAr(r.lastOkAt)}` : null,
        r?.lastFailAt ? `آخر فشل ${relativeAr(r.lastFailAt)}` : null,
      ].filter(Boolean);
      const meta = el('div', 'an-src-meta', facts.join(' · '));
      meta.dir = 'ltr';
      row.append(top, meta);
      // السبب يظهر متى تعطّل المصدر أو لم ينجح قط (لا «0%» بلا تفسير)
      const why = s.disabledReason ?? s.loadError ?? r?.blocked ?? (r?.streak >= 3 || (r && !r.ok) ? r?.lastError : null);
      if (why) row.append(el('div', 'an-src-why', why));
      if (s.enabled) {
        const cat = s.catalog;
        const line = el('div', 'an-src-cat');
        line.append(el('span', null, cat ? `الكتالوج: ${cat.count} عمل · ${cat.pagesFetched} صفحة${cat.done ? ' · مكتمل' : ''}` : 'الكتالوج لم يُحلب بعد'));
        line.append(button('an-src-btn', cat?.done ? 'حدّث' : cat ? 'أكمل' : 'احلب الكتالوج', async () => {
          await engine.crawl(s.id);
          toast(`بدأ حلب كتالوج ${s.name}`);
        }));
        if (r?.blocked) line.append(button('an-src-btn', 'أعد المحاولة', async () => {
          await engine.unblock(`source:${s.id}`);
          void renderSourcesHealth(box);
        }));
        const report = el('div', 'an-diag');
        line.append(button('an-src-btn', 'تشخيص', () => runDiagnosis(s, report)));
        row.append(line, report);
      }
      return row;
    });
    box.replaceChildren(...rows);
  }

  /** يفحص المصدر خطوة خطوة ويعرض أين ينكسر، مع نسخ التقرير لإرساله. */
  async function runDiagnosis(s, report) {
    report.replaceChildren(el('p', 'an-diag-wait', 'جارٍ الفحص… (قد يأخذ حتى دقيقة على شبكة بطيئة)'));
    let steps;
    try {
      steps = await engine.diagnose(s.id);
    } catch (e) {
      report.replaceChildren(el('p', 'an-src-why', `تعذّر الفحص: ${e?.message ?? e}`));
      return;
    }
    const mark = { ok: '✓', warn: '!', fail: '✕' };
    const rows = (steps ?? []).map((st) => {
      const li = el('div', `an-diag-row an-diag-row--${st.state}`);
      const detail = el('span', 'an-diag-detail', st.detail);
      detail.dir = 'auto';
      li.append(el('i', null, mark[st.state] ?? '·'), el('b', null, st.label), detail);
      return li;
    });
    const text = [`${s.name} — ${new Date().toISOString()}`, ...(steps ?? []).map((st) => `${mark[st.state] ?? '·'} ${st.label}: ${st.detail}`)].join('\n');
    const copy = button('an-src-btn', 'انسخ التقرير', () => {
      void navigator.clipboard?.writeText(text).then(() => toast('نُسخ التقرير'));
    });
    report.replaceChildren(...rows, copy);
    stripIn(rows);
  }

  // تقدّم الحلب يحدّث شاشة الصحة إن كانت مفتوحة
  engine.on('catalog', () => {
    const box = q('animeLibrary')?.querySelector('.an-health');
    if (box && state.libraryTab === 'sources') void renderSourcesHealth(box);
  });

  function emptyBox(icon, title, text) {
    const box = el('div', 'an-empty');
    box.innerHTML = `<div class="an-empty-icon">${glyph(icon, { size: 30 })}</div><h3>${title}</h3><p>${text}</p>`;
    return box;
  }

  function shareCurrent() {
    const m = state.detail;
    if (!m) return;
    // داخل الحساب: ترشيح في المجلس لصديق أو للجميع (نفس ورقة المانجا)
    if (deps.share) {
      deps.share({ ref: `anime:${m.id}`, title: m.title, cover: m.posterSmall ?? m.poster ?? null });
      return;
    }
    const url = `https://anilist.co/anime/${m.id}`;
    if (navigator.share) void navigator.share({ title: m.title, url }).catch(() => {});
    else void navigator.clipboard?.writeText(url).then(() => toast('نُسخ الرابط'));
  }

  return { show, loadHome, openAnime, play: playEpisode, showDiscover, renderLibrary, openDiscover, shareCurrent, leaveDetail: () => window.removeEventListener('scroll', state.detailScroll) };
}
