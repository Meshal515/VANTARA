import { nativeFollowTime, flushFollowTime } from '../lib/follow-time.js';
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
import { reportSource } from '../lib/source-report.js';
import { glyph, iconButton } from './icons.js';
import { FORMAT_AR, SEASON_AR, STATUS_AR, fetchAnimeDetail, fetchAnimeHome, fetchMalEpisodes, meccaDay, relativeAr, searchAnime } from '../lib/anime-meta.js';
import { pageIn, pop, revealIn, stripIn } from './motion.js';
import * as engine from '../lib/anime-engine.js';
import { createAnimeAccount } from './anime-account.js';
import { report as reportUpdate } from '../lib/update-engine.js';
import { paintWorkInsights } from './work-insights.js';
import { createServerSheet, sourceLabel } from './server-sheet.js';
import { duration as insightDuration } from './insights.js';
import { episodeStill, episodeTitleOf, loadAnimeArt } from '../lib/anime-art.js';
import { asButton, moreButton, openWatchMenu, watchMenuItems } from './watch-menu.js';

export const animeAddonIdentity = (m, episode = 1) => ({ canonicalId: m.canonicalId ?? `anime:${m.id}`, kind: 'anime', format: m.format, externalIds: { mal: m.idMal, anilist: m.id, ...m.externalIds }, episode });

const HOME_KEY = 'anime.home.v2';
// Legacy unowned keys remain on disk for recovery, but are never read into a new account.
const LIST_KEY = 'vantara.anime.list.v2.guest';
const watchKey = (userId) => `vantara.anime.watch.v2.${userId ? `user.${encodeURIComponent(userId)}` : 'guest'}`;
const STALE_MS = 30 * 60_000;

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

/** يضيف أنمي لـ«قائمتي» من خارج صفحته (رفيق): إضافة فقط، لا تبديل. */
export function addToAnimeList(m) {
  const all = readJson(LIST_KEY, {});
  if (!all[m.id]) all[m.id] = { ...m, at: Date.now() };
  writeJson(LIST_KEY, all);
  return true;
}

/** سجل المشاهدة: لكل أنمي آخر حلقة وموضعها، ولكل حلقة تقدّمها. */
export function readWatch(userId = null) {
  return readJson(watchKey(userId), {});
}
/** يُنادى من المشغّل: يحفظ موضع الحلقة، ويعلّمها مُشاهدة عند 90%. */
export function recordWatch(m, episode, position, duration, userId = null) {
  const all = readWatch(userId);
  const w = all[m.id] ?? { id: m.id, episodes: {} };
  Object.assign(w, { title: m.title, poster: m.posterSmall ?? m.poster, banner: m.banner, color: m.color, total: m.episodes ?? null });
  const done = duration > 0 && position / duration >= 0.9;
  w.episodes[episode] = { position, duration, at: Date.now(), done: done || Boolean(w.episodes[episode]?.done) };
  w.episode = episode;
  w.at = Date.now();
  all[m.id] = w;
  writeJson(watchKey(userId), all);
}

/**
 * @param {{ root: Element, q: (id: string) => HTMLElement, el: Function, toast: (m: string) => void,
 *           openSheet: Function, closeSheet: Function, showPage: (id: string) => void, goBack: () => void,
 *           currentPage: () => string, genreAr: (g: string) => string, readKv: Function, writeKv: Function }} deps
 */
export function createAnime(deps) {
  const { q, el, toast, genreAr } = deps;
  // حسابك: القوائم وعين الحلقة وآخر المشاهدات تُزامَن مثل المانجا (وتظهر في ملفك)
  const account = deps.sync ? createAnimeAccount(deps.sync) : null;
  const currentUser = () => deps.sync?.user?.userId ?? null;
  const localWatch = () => readWatch(currentUser());
  const saveWatch = (all) => writeJson(watchKey(currentUser()), all);
  const signedIn = () => Boolean(account && deps.sync?.user?.userId);
  // Shelf order is refreshed on entry or a user action, never by background sync.
  const workListeners = new Set();
  const state = {
    home: null,
    loading: null,
    detail: null,
    detailToken: 0,
    detailScroll: null,
    episodeRange: 0,
    work: null,
    workFor: null,
    workPending: null,
    workError: false,
    playing: null,
    newestFirst: false,
    malTitles: {},
    // فن العمل من ani.zip: لقطات الحلقات والشعار ({ id, episodes, imdb, logo })
    art: null,
    libraryTab: 'history',
    discover: { query: '', genre: '', page: 1, items: [], hasNext: false, token: 0 },
  };

  // ───────────── عناصر صغيرة ─────────────

  function image(src, cls = 'an-img', { eager = false, position, fallback = null } = {}) {
    const img = new Image();
    img.alt = '';
    img.className = cls;
    img.decoding = 'async';
    if (!eager) img.loading = 'lazy';
    if (position) img.style.objectPosition = position;
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => {
      // لقطة مكسورة: الغلاف مكانها مرة واحدة، لا إطار فارغ
      if (fallback && img.src !== fallback && !img.dataset.fellBack) {
        img.dataset.fellBack = '1';
        img.src = fallback;
        return;
      }
      img.classList.add('failed');
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
  /**
   * يمرّر شريطًا أفقيًا حتى يتوسّطه العنصر، أفقيًا فقط. (scrollIntoView ولو
   * بـ block: 'nearest' كان يحرّك الصفحة كلها للأسفل حين يكون الشريط تحت الشاشة،
   * فتفتح صفحة الأنمي منزلقةً إلى الحلقات بدل أعلاها.)
   */
  const centerInStrip = (strip, node, align = 'center') => {
    if (!strip || !node) return;
    const s = strip.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    const delta = align === 'start' ? n.right - s.right : n.left + n.width / 2 - (s.left + s.width / 2);
    if (Math.abs(delta) > 1) strip.scrollBy?.({ left: delta, behavior: 'instant' });
  };
  /** رقم الموسم من العنوان: «Season 4» · «4th Season» · «第4期» · «S2». */
  const seasonNumber = (r) => {
    const t = [r?.title, r?.romaji, r?.native].filter(Boolean).join(' | ');
    const hit = /\bseason\s*(\d{1,2})\b/i.exec(t) ?? /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i.exec(t) ?? /第(\d{1,2})期/.exec(t) ?? /\bS(\d{1,2})\b/.exec(t);
    return hit ? Number(hit[1]) : null;
  };
  const minutesLeft = (e) => {
    if (!e?.duration || e.position >= e.duration) return null;
    const left = Math.max(1, Math.round((e.duration - e.position) / 60_000));
    return `باقي ${left} د`;
  };

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
    // رقم الحلقة كبيرًا كشاشة بثّ، و«جديدة» لما نزل خلال يومين
    const num = el('span', 'an-ep-num');
    num.append(el('small', null, 'الحلقة'), el('b', null, String(m.episode)));
    art.append(play, num);
    const copy = el('span', 'an-ep-copy');
    const t = el('span', 'an-ep-title', m.title);
    t.dir = 'auto';
    const fresh = m.airedAt && Date.now() - m.airedAt < 48 * 3600e3;
    const when = el('span', 'an-ep-when', relativeAr(m.airedAt));
    if (fresh) when.prepend(el('b', 'an-ep-fresh', 'جديدة · '));
    copy.append(t, when);
    c.append(art, copy);
    c.onclick = () => void openAnime(m, { episode: m.episode });
    return c;
  }

  /** «آخر المشاهدات»: إطار عريض 16:9 بشريط التقدّم، العنوان سطرين، و«الحلقة 19 · باقي 22 د». */
  function continueCard(w) {
    const e = w.episodes?.[w.episode] ?? {};
    const ratio = e.duration ? Math.min(1, e.position / e.duration) : 0;
    const c = asButton(el('div', 'an-cw'), `${w.title} — الحلقة ${w.episode}`);
    tint(c, w.color);
    const art = el('span', 'an-cw-art');
    const src = w.banner ?? w.poster;
    if (src) art.append(image(src, 'an-img', { position: w.banner ? 'center' : 'center 22%' }));
    else art.append(el('b', 'an-cw-num', String(w.episode)));
    art.append(el('span', 'an-cw-shade'));
    const play = el('span', 'an-cw-play');
    play.innerHTML = glyph('play', { size: 16, filled: true });
    art.append(play);
    if (ratio > 0 && !e.done) art.append(progress(ratio));
    c.dataset.ref = `anime:${w.id}`;
    const t = el('span', 'an-cw-title', w.title);
    t.dir = 'auto';
    // ⋮ بجانب الاسم: المفضلة والقائمة والحذف من السجل
    const name = el('span', 'cw-name');
    name.append(t, moreButton(el, () => openContinueMenu(w), `خيارات ${w.title}`));
    const sub = el('span', 'an-cw-sub', [`الحلقة ${w.episode}`, e.done ? 'شوهدت' : minutesLeft(e)].filter(Boolean).join(' · '));
    c.append(art, name, sub);
    c.onclick = () => void openAnime({ id: w.id, title: w.title, poster: w.poster, posterSmall: w.poster, banner: w.banner, color: w.color });
    return c;
  }

  function genreChips() {
    const s = el('section', 'an-rail an-genres');
    s.dataset.reveal = '';
    const head = el('div', 'an-rail-head');
    const titles = el('div', 'an-rail-titles');
    titles.append(el('h2', null, 'تصفّح حسب النوع'));
    head.append(titles);
    const strip = el('div', 'an-chips');
    for (const [g, hue] of ANIME_GENRES) {
      const b = button('an-chip', genreAr(g), () => openDiscover({ genre: g }));
      b.style.setProperty('--hue', String(hue));
      strip.append(b);
    }
    s.append(head, strip);
    return s;
  }

  // ───────────── جدول البث: توقيع الأنمي ─────────────
  // الأنمي يُعرض أسبوعيًّا في مواعيد ثابتة؛ هذا ما لا يملكه غيره. فالرئيسية تبدأ
  // بجدول الأسبوع لا ببانر: أيام بألسنة القسم، وأعمال اليوم بصورها ووقتها
  // بتوقيت مكة تحتها (الكلام تحت الصورة لا فوقها). ما عُرض يُشغَّل، والقادم
  // يقول متى. الشريط يبدأ عند «الآن».

  const clock12 = (ts) => new Date(ts).toLocaleTimeString('ar', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' });
  function dayLabel(key, today) {
    const d = Math.round((Date.parse(key) - Date.parse(today)) / 86_400_000);
    if (d === 0) return 'اليوم';
    if (d === -1) return 'أمس';
    if (d === 1) return 'غدًا';
    return new Date(`${key}T12:00:00Z`).toLocaleDateString('ar', { weekday: 'long', timeZone: 'UTC' });
  }

  function slot(m) {
    const now = Date.now();
    const aired = m.airingAt <= now;
    const c = el('button', `an-slot${aired ? ' aired' : ''}`);
    c.type = 'button';
    c.setAttribute('aria-label', `${m.title} — الحلقة ${m.episode}`);
    tint(c, m.color);
    const art = el('span', 'an-slot-art');
    art.append(image(m.banner ?? m.poster, 'an-img', { position: m.banner ? 'center' : 'center 22%' }));
    const line = el('span', 'an-slot-line');
    line.append(el('b', 'an-slot-time', clock12(m.airingAt)), el('span', null, `الحلقة ${m.episode}`));
    const t = el('span', 'an-slot-title', m.title);
    t.dir = 'auto';
    const when = el('span', 'an-slot-when', aired ? `نزلت ${relativeAr(m.airingAt)}` : relativeAr(m.airingAt));
    c.append(art, line, t, when);
    c.onclick = () => void openAnime(m, aired ? { episode: m.episode } : {});
    return c;
  }

  function airSchedule(week) {
    const today = meccaDay(Date.now());
    const days = new Map();
    for (const m of week) {
      const k = meccaDay(m.airingAt);
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(m);
    }
    const keys = [...days.keys()].filter((k) => k >= meccaDay(Date.now() - 86_400_000)).sort();
    if (!keys.length) return null;
    const s = el('section', 'an-rail an-air');
    s.dataset.reveal = '';
    const head = el('div', 'an-rail-head');
    const titles = el('div', 'an-rail-titles');
    titles.append(el('h2', null, 'جدول البث'), el('span', 'an-rail-sub', 'بتوقيت مكة'));
    head.append(titles);
    // كل ما نزل بترتيبه في «آخر التحديثات» (نفس سلوك الأقسام الثلاثة)
    if (deps.openUpdates) head.append(button('an-more', `<span>الكل</span>${glyph('chevron', { size: 16 })}`, () => deps.openUpdates('anime')));
    const tabs = el('nav', 'an-days');
    tabs.setAttribute('role', 'tablist');
    const strip = el('div', 'an-strip an-air-strip');
    let current = keys.includes(today) ? today : keys[0];
    const show = (k, { scroll = true } = {}) => {
      current = k;
      for (const b of tabs.children) {
        const on = b.dataset.day === k;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      }
      const list = days.get(k) ?? [];
      strip.replaceChildren(...list.map(slot));
      stripIn([...strip.children].slice(0, 4));
      // اليوم يبدأ عند «الآن»: آخر ما نزل، وبعده القادم
      const now = Date.now();
      const at = Math.max(0, list.findIndex((m) => m.airingAt > now) - 1);
      if (scroll) requestAnimationFrame(() => centerInStrip(strip, strip.children[k === today ? at : 0], 'start'));
    };
    for (const k of keys) {
      const b = button(`an-day${k === current ? ' active' : ''}`, dayLabel(k, today), () => show(k));
      b.dataset.day = k;
      b.setAttribute('role', 'tab');
      tabs.append(b);
    }
    s.append(head, tabs, strip);
    show(current, { scroll: true });
    return s;
  }

  // ───────────── الرئيسية ─────────────

  const watching = () => {
    const entries = new Map(Object.values(localWatch()).filter((w) => w?.id && w.episode).map((w) => [String(w.id), w]));
    // The owner's server history survives reinstall and is visible on every device.
    // A local position is useful for resume, but never stands in for another user's data.
    if (signedIn()) for (const row of deps.sync.rows('work_views', (r) => r.user_id === currentUser() && !r.removed && r.series_ref?.startsWith('anime:'))) {
      const rawId = row.series_ref.slice(6);
      const id = rawId.startsWith("addon-") ? rawId : Number(rawId);
      const episode = Number(row.chapter_number ?? /\d+(?:\.\d+)?/.exec(row.chapter_label ?? '')?.[0]);
      if ((!String(id).startsWith("addon-") && !Number.isFinite(id)) || !Number.isFinite(episode) || episode <= 0) continue;
      const old = entries.get(String(id));
      if (old && old.at >= row.viewed_at) continue;
      entries.set(String(id), {
        id, episode, at: row.viewed_at, title: row.series_title ?? old?.title ?? `#${id}`,
        poster: row.cover_url ?? old?.poster ?? null, episodes: old?.episodes ?? {},
      });
    }
    return [...entries.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  };

  function renderHome(data) {
    const blocks = el('div', 'an-home');
    const air = data.week?.length ? airSchedule(data.week) : null;
    if (air) blocks.append(air);
    else if (data.trending?.length) blocks.append(rail('رائج الآن', { items: data.trending.slice(0, 12), card: (m) => posterCard(m) }));
    const cont = watching();
    if (cont.length) blocks.append(rail('آخر المشاهدات', { items: cont.slice(0, 12), card: continueCard, more: () => openLibrary('history') }));
    // «حلقات جديدة» صارت داخل جدول البث (أمس واليوم)؛ تبقى شريطًا فقط لمحفوظ قديم بلا جدول
    if (!air && data.latest?.length) blocks.append(rail('حلقات جديدة', { sub: 'نزلت هذا الأسبوع', cls: 'an-rail--wide', items: data.latest.slice(0, 16), card: episodeCard, more: deps.openUpdates ? () => deps.openUpdates('anime') : undefined }));
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
        senseAnime(fresh.latest ?? []);
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

  /** مجسّ Update Engine: حلقات AniList (بوقت بثها الحقيقي إن وُجد). */
  function senseAnime(list) {
    for (const m of list) {
      if (!m?.id || !(m.episode > 0)) continue;
      reportUpdate({
        work: `anime:${m.id}`,
        section: 'anime',
        kind: 'episode',
        title: m.title,
        cover: m.posterSmall ?? m.poster ?? null,
        source: { s: 'anilist' },
        units: [{ number: m.episode, ...(m.airedAt ? { publishedAt: m.airedAt } : {}) }],
      });
    }
  }

  function show() {
    // «آخر المشاهدات» تتغيّر بعد كل حلقة: تُرسم من جديد عند العودة
    if (state.home && !state.loading) {
      try { renderHome(state.home); }
      catch (error) { console.error('تعذّر رسم رئيسية الأنمي', error); renderError(() => void loadHome({ force: true })); }
    }
    void loadHome();
  }

  // ───────────── قائمتي ─────────────

  const inList = (id) => (signedIn() ? account.inLibrary(id) : Boolean(readJson(LIST_KEY, {})[id]));
  function toggleList(m) {
    if (signedIn()) return account.setLibrary(m, !account.inLibrary(m.id));
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

  async function openAnime(m, { episode = null, position = null, clip = null, play = false, focusEpisodes = false } = {}) {
    const token = ++state.detailToken;
    state.episodeRange = 0;
    state.detail = m;
    if (state.art?.id !== m.id) state.art = null;
    deps.showPage('anime');
    // لقطات الحلقات والشعار من ani.zip: إضافة لا تؤخّر الصفحة، والمخبّأ يصل قبل التفاصيل غالبًا
    void loadAnimeArt(m.id).then((art) => {
      if (token !== state.detailToken || !art) return;
      state.art = { ...art, id: m.id };
      paintTitleLogo(state.detail);
      const box = q('animeEpisodes');
      if (box?.querySelector('.an-er-list')) renderEpisodes(box, state.detail);
    });
    renderDetail(m, { partial: true });
    // العمل يفتح من أعلاه (البطل ظاهر) أيًّا كان موضع الصفحة السابقة
    window.scrollTo?.({ top: 0, behavior: 'instant' });
    // لمسة أو عجلة أثناء التحميل = المستخدم يتصفّح؛ لا نعيده للأعلى بعدها
    let userScrolled = false;
    const touched = () => (userScrolled = true);
    const INPUT = ['touchstart', 'wheel', 'keydown'];
    for (const ev of INPUT) window.addEventListener?.(ev, touched, { once: true, passive: true });
    const untouch = () => { for (const ev of INPUT) window.removeEventListener?.(ev, touched); };
    try {
      const full = String(m.id).startsWith("addon-") ? await deps.restoreSourceWork(`anime:${m.id}`, m) : m._sourceCopy ? m : await fetchAnimeDetail(m.id);
      if (token !== state.detailToken || !full) return;
      state.detail = full;
      if (full.aired > 0) senseAnime([{ ...full, episode: full.aired }]);
      if (episode) state.episodeRange = Math.floor((episode - 1) / 50);
      state.malTitles = {};
      renderDetail(full);
      void locateWork(full, token);
      // لحظة أرسلها صديق: ورقة سيرفرات الحلقة جاهزة من ثانيتها
      if (episode && (position != null || play)) playEpisode(full, episode, { position, clip });
      // الحلقة المقصودة تُعلَّم في القائمة؛ لا ننزلق إليها إلا لمن طلب قائمة الحلقات صراحة
      const target = episode ? q('anime').querySelector(`[data-ep="${episode}"]`) : null;
      if (target) {
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 2600);
      }
      if (target && focusEpisodes) target.scrollIntoView({ block: 'center' });
      else if (window.scrollY > 0 && !userScrolled) window.scrollTo?.({ top: 0, behavior: 'instant' });
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
    } finally {
      untouch();
    }
  }

  /** من أين يكمل زر المشاهدة: الحلقة غير المكتملة الأخيرة، أو التالية لآخر مكتملة. */
  function resumePoint(m) {
    const w = localWatch()[m.id];
    if (!w?.episode) return { episode: 1, resume: false };
    const e = w.episodes?.[w.episode];
    if (e && !e.done) return { episode: w.episode, resume: true };
    const total = m.aired || m.episodes || w.episode + 1;
    return { episode: Math.min(total, w.episode + 1), resume: true };
  }

  /** موعد بتوقيت مكة بصيغة 12 ساعة: «السبت 6:30 م». */
  const meccaTime = (ts) =>
    new Date(ts).toLocaleString('ar', { timeZone: 'Asia/Riyadh', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' });

  /**
   * لوحة «على الهواء»: الحلقة القادمة وموعدها، آخر ما عُرض، وتقدّمك حلقةً حلقة.
   * مكتمل: عدد حلقاته وموسمه. لم يبدأ: موعد أول حلقة. بلا ما يُقال: لا لوحة.
   */
  function onAirPanel(m) {
    const total = m.episodes || m.aired || 0;
    const aired = m.aired || (m.status === 'FINISHED' ? total : 0);
    const seen = signedIn() ? account.seenCount(m.id) : Object.values(localWatch()[m.id]?.episodes ?? {}).filter((e) => e?.done).length;
    const panel = el('section', 'an-onair');
    panel.dataset.reveal = '';
    const big = el('div', 'an-onair-big');
    const side = el('div', 'an-onair-side');
    if (m.status === 'RELEASING' && m.next) {
      panel.classList.add('live');
      big.append(el('small', null, 'الحلقة القادمة'), el('b', null, String(m.next.episode)));
      side.append(el('span', 'an-onair-tag', 'يُعرض الآن'), el('strong', null, relativeAr(m.next.at)), el('span', null, meccaTime(m.next.at)));
    } else if (m.status === 'NOT_YET_RELEASED') {
      big.append(el('small', null, 'يبدأ'), el('b', null, m.next ? relativeAr(m.next.at).replace(/^بعد /, '') : 'قريبًا'));
      side.append(el('span', 'an-onair-tag', 'قريبًا'), el('strong', null, m.season && m.year ? `${SEASON_AR[m.season]} ${m.year}` : 'لم يُحدَّد'), m.next ? el('span', null, meccaTime(m.next.at)) : el('span'));
    } else if (total) {
      // الحالة («مكتمل») في الشارة بجانبه مرة واحدة؛ هنا العدد وما هو
      big.append(el('small', null, 'حلقة'), el('b', null, String(total)));
      side.append(el('span', 'an-onair-tag', STATUS_AR[m.status] ?? 'حلقات'), el('strong', null, m.season && m.year ? `${SEASON_AR[m.season]} ${m.year}` : `${total} حلقة`), el('span', null, m.duration ? `${m.duration} دقيقة للحلقة` : ''));
    } else {
      return null;
    }
    panel.append(big, side);
    // التقدّم: شريحة لكل حلقة عُرضت (حتى 52)، والمشاهَد ممتلئ
    if (aired > 0) {
      const ticks = el('div', 'an-onair-ticks');
      if (aired <= 52) {
        for (let n = 1; n <= aired; n++) ticks.append(el('i', n <= seen ? 'on' : ''));
      } else {
        const fill = el('i', 'an-onair-fill');
        fill.style.setProperty('--p', String(Math.min(1, seen / aired)));
        ticks.classList.add('long');
        ticks.append(fill);
      }
      const label = el('span', 'an-onair-progress', seen ? `شاهدت ${seen} من ${aired}` : `${aired} حلقة متاحة${total > aired ? ` من ${total}` : ''}`);
      panel.append(ticks, label);
    }
    return panel;
  }

  function renderDetail(m, { partial = false } = {}) {
    const page = q('anime');
    page.style.removeProperty('--art');
    tint(page, m.color);
    const wrap = el('div', 'an-detail');

    const bar = el('div', 'an-detail-top');
    bar.innerHTML = iconButton('back', 'رجوع', { act: 'goBack' }) + `<span class="an-detail-top-title" dir="auto"></span>` + iconButton('share', 'شارك', { act: 'shareAnime' });
    bar.querySelector('.an-detail-top-title').textContent = m.title;
    if (deps.openWorkMenu) {
      const more = el('button', 'icon-btn'); more.type = 'button'; more.setAttribute('aria-label', 'خيارات العمل');
      more.innerHTML = glyph('more'); more.onclick = () => deps.openWorkMenu({ ref: `anime:${m.id}`, title: m.title, cover: m.posterSmall ?? m.poster ?? null });
      bar.append(more);
    }

    const hero = el('div', 'an-detail-hero');
    // بلا لافتة عريضة: الغلاف (460px) خلفيةٌ — على الشاشة الكبيرة تُضبَّب عمدًا بدل أن تُمطّ
    const art = el('div', m.banner ? 'an-detail-art' : 'an-detail-art an-detail-art--poster');
    art.dataset.art = '';
    art.append(image(m.banner ?? m.poster, 'an-img', { eager: true, position: m.banner ? 'center' : 'center 20%' }), el('div', 'an-detail-shade'));
    hero.append(art);

    const head = el('div', 'an-detail-head');
    head.dataset.reveal = '';
    const poster = el('div', 'an-detail-poster');
    poster.append(image(m.poster, 'an-img', { eager: true }));
    const titles = el('div', 'an-detail-titles');
    // شعار العنوان كالسينما إن وُجد؛ الاسم يبقى للقارئ ويظهر إن لم يُحمَّل الشعار
    const mark = el('div', 'an-mark');
    mark.id = 'animeTitleMark';
    const h1 = el('h1', null, m.title);
    h1.dir = 'auto';
    mark.append(h1);
    titles.append(mark);
    const alt = m.romaji && m.romaji !== m.title ? m.romaji : m.native;
    if (alt && alt.toLowerCase() !== m.title.toLowerCase()) {
      const a = el('div', 'an-detail-alt', alt);
      a.dir = 'auto';
      titles.append(a);
    }
    head.append(poster, titles);
    queueMicrotask(() => paintTitleLogo(m));

    const facts = el('div', 'an-facts');
    facts.dataset.reveal = '';
    // الحالة والموسم في لوحة البث إن وُجدت؛ هنا ما لا تقوله هي
    const onair = onAirPanel(m);
    if (m.status && !onair) facts.append(el('span', `an-status an-status--${String(m.status).toLowerCase()}`, STATUS_AR[m.status] ?? m.status));
    for (const f of [FORMAT_AR[m.format], !onair && m.season && m.year ? `${SEASON_AR[m.season]} ${m.year}` : null, m.studio]) if (f) facts.append(el('span', 'an-fact', String(f)));

    // لوحة البث مكان أرقام عامة (متابعين، مدة): ما يخص هذا الأنمي الآن
    if (m.score) facts.append(scoreBadge(m.score));

    const actions = el('div', 'an-detail-actions');
    actions.dataset.reveal = '';
    const { episode: startEp, resume } = resumePoint(m);
    const watch = button('an-btn an-btn--primary an-btn--wide', `${glyph('play', { size: 20, filled: true })}<span>${resume ? 'تابع' : 'شاهد'} الحلقة ${startEp}</span>`, () => playEpisode(m, startEp));
    const toggleBtn = (kind, icon, onLabel, offLabel) => {
      const b = el('button', 'an-btn an-btn--icon');
      b.type = 'button';
      const paint = () => {
        const on = account?.inCollection(kind, m.id);
        b.setAttribute('aria-pressed', String(Boolean(on)));
        b.setAttribute('aria-label', on ? onLabel : offLabel);
        b.title = on ? onLabel : offLabel;
        b.innerHTML = `${glyph(icon, { size: 20, filled: Boolean(on) })}<span>${kind === 'favorite' ? 'المفضلة' : 'لاحقًا'}</span>`;
      };
      paint();
      b.onclick = () => {
        const on = !account?.inCollection(kind, m.id);
        account?.setCollection(kind, m, on);
        setTimeout(paint, 60);
        pop(b);
        toast(on ? onLabel : kind === 'favorite' ? 'أُزيل من المفضلة' : 'أُزيل من «شاهد لاحقًا»');
      };
      return b;
    };
    actions.append(watch, listButton(m, 'an-btn an-btn--glass'));
    if (signedIn()) actions.append(toggleBtn('read_later', 'clock', 'في «شاهد لاحقًا»', 'شاهد لاحقًا'), toggleBtn('favorite', 'heart', 'في المفضلة', 'المفضلة'));
    // الترشيح للمجلس من زر المشاركة في الأعلى وحده (كان مكررًا هنا)

    const sourcesStrip = el('div', 'an-sources');
    sourcesStrip.id = 'animeSources';
    sourcesStrip.dataset.reveal = '';
    const insightHost = el('div', 'work-insights');
    insightHost.dataset.ref = `anime:${m.id}`;
    wrap.append(bar, hero, head, facts, ...(onair ? [onair] : []), actions, insightHost, sourcesStrip);
    paintSources(m);


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
    if (!partial) void paintWorkInsights(insightHost, { sync: deps.sync, ref: `anime:${m.id}`, openProfile: deps.openProfile });
    bindDetailScroll(page, bar);
    if (partial) pageIn(page);
  }

  function setSeen(m, n, on) {
    const all = localWatch();
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
    saveWatch(all);
  }

  /**
   * «شوهدت»: حسابك هو المرجع متى سجّلت دخولك (كل أجهزتك، والإلغاء يلغي فعلًا)،
   * وسجل هذا الجهاز لمن لم يسجّل. سجل الجهاز القديم يُرحَّل للحساب مرة واحدة.
   */
  const seenEp = (m, n, e) => (signedIn() ? account.isSeen(m.id, n) : Boolean(e?.done));

  /** يضع شعار العنوان فوق الاسم متى عُرف (مرة واحدة لكل صفحة). */
  function paintTitleLogo(m) {
    const mark = q('animeTitleMark');
    const src = state.art?.id === m?.id ? state.art.logo : null;
    if (!mark || !src || mark.querySelector('.an-mark-logo')) return;
    const logo = image(src, 'an-mark-logo', { eager: true });
    logo.alt = m.title;
    logo.onload = () => {
      logo.classList.add('loaded');
      mark.classList.add('has-logo');
    };
    mark.prepend(logo);
  }

  /** صف حلقة كالمسلسلات: لقطتها 16:9 (أو غلاف العمل)، رقمها وعنوانها، وزر «شوهدت». */
  function episodeRow(m, n, e) {
    const done = seenEp(m, n, e);
    e = e ? { ...e, done } : done ? { done: true, position: 0, duration: 0 } : e;
    const ratio = e?.duration ? Math.min(1, e.position / e.duration) : 0;
    const row = el('div', `an-er${e?.done ? ' seen' : ''}`);
    row.dataset.ep = String(n);
    const main = el('button', 'an-er-main');
    main.type = 'button';
    const shot = episodeStill(m, n, state.art?.id === m.id ? state.art : null);
    const cover = m.poster ?? m.banner ?? null;
    const art = el('span', `an-er-art${shot.still ? '' : ' an-er-art--cover'}`);
    art.append(image(shot.src, 'an-img', { position: shot.still ? 'center' : 'center 22%', fallback: shot.still ? cover : null }));
    const playMark = el('span', 'an-er-play');
    playMark.innerHTML = glyph('play', { size: 14, filled: true });
    art.append(playMark);
    if (ratio > 0 && !e?.done) {
      const bar = progress(ratio);
      bar.classList.add('an-er-bar');
      art.append(bar);
    }
    const copy = el('span', 'an-er-copy');
    const top = el('span', 'an-er-top');
    const title = episodeTitleOf(m, n, { mal: state.malTitles, art: state.art?.id === m.id ? state.art : null });
    const name = el('b', 'an-er-title', title || `الحلقة ${n}`);
    name.dir = 'auto';
    top.append(el('b', 'an-er-no', String(n)), name);
    copy.append(top);
    // الرقم بجانب العنوان؛ هنا ما يخصّك: شوهدت، أو كم باقي، أو مدتها
    const sub = e?.done ? 'شوهدت' : minutesLeft(e) ?? (m.duration ? `${m.duration} د` : null);
    if (sub) copy.append(el('span', 'an-er-sub', sub));
    main.append(art, copy);
    main.onclick = () => playEpisode(m, n);
    const eye = button(`an-er-icon${e?.done ? ' on' : ''}`, glyph('eye', { size: 20 }), () => {
      setSeen(m, n, !e?.done);
      account?.markEpisode(m, n, !e?.done);
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
    if (signedIn()) tools.append(button('an-er-icon', glyph('eye', { size: 20 }), () => openMarkSheet(host, m, total), 'علّم حلقات: من ← إلى'));
    host.append(tools);
    const seasons = seasonsStrip(m);
    if (seasons) host.insertBefore(seasons, tools);

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
      requestAnimationFrame(() => centerInStrip(tabs, tabs.querySelector('.active')));
    }
    const seen = localWatch()[m.id]?.episodes ?? {};
    const list = el('div', 'an-er-list');
    const start = state.episodeRange * SIZE + 1;
    const nums = [];
    for (let n = start; n <= Math.min(total, start + SIZE - 1); n++) nums.push(n);
    if (state.newestFirst) nums.reverse();
    list.append(...nums.map((n) => episodeRow(m, n, seen[n])));
    host.append(list);
    stripIn([...list.children].slice(0, 8));
  }

  /**
   * المواسم: السابق ← هذا ← التالي من علاقات AniList (كل موسم عمل مستقل هناك)،
   * فتنتقل بينها بلمسة بدل البحث عنها.
   */
  function seasonsStrip(m) {
    const prev = (m.relations ?? []).filter((r) => r.relation === 'الجزء السابق');
    const next = (m.relations ?? []).filter((r) => r.relation === 'الجزء التالي');
    if (!prev.length && !next.length) return null;
    // أسماء قصيرة «الموسم 4» بدل عناوين طويلة مقصوصة؛ العنوان الكامل للوصول وللتلميح
    const own = seasonNumber(m) ?? (prev.length === 1 && seasonNumber(prev[0]) ? seasonNumber(prev[0]) + 1 : prev.length ? null : 1);
    const label = (r, rel) => {
      if (r.format === 'MOVIE') return 'فيلم';
      const k = r === m ? own : seasonNumber(r) ?? (own && prev.length + next.length <= 2 ? own + rel : null);
      const part = /\bpart\s*(\d+)/i.exec(r.title ?? '')?.[1];
      if (k) return `الموسم ${k}${part ? ` · ج${part}` : ''}`;
      return rel < 0 ? 'الموسم السابق' : rel > 0 ? 'الموسم التالي' : 'هذا الموسم';
    };
    const strip = el('div', 'an-seasons');
    const chip = (r, rel) => {
      const current = r === m;
      const b = el('button', `an-season${current ? ' active' : ''}`);
      b.type = 'button';
      b.title = r.title ?? '';
      b.setAttribute('aria-label', r.title ?? label(r, rel));
      const when = [SEASON_AR[r.season], r.year].filter(Boolean).join(' ');
      b.append(el('b', null, label(r, rel)));
      if (when) b.append(el('span', null, when));
      if (!current) b.onclick = () => void openAnime(r);
      else b.setAttribute('aria-current', 'true');
      return b;
    };
    strip.append(...prev.map((r) => chip(r, -1)), chip(m, 0), ...next.map((r) => chip(r, 1)));
    requestAnimationFrame(() => centerInStrip(strip, strip.querySelector('.active')));
    return strip;
  }

  /**
   * عين الحلقات: «من ← إلى» دفعة واحدة، «شاهدته كله»، «ألغِ الكل»، و«أكملته».
   * تُحفظ في حسابك فتظهر في كل أجهزتك وفي ملفك.
   */
  function openMarkSheet(host, m, total) {
    deps.openSheet((body) => {
      const head = el('div', 'an-sheet-head');
      const t = el('div', 'an-sheet-title', m.title);
      t.dir = 'auto';
      const count = () => account.seenCount(m.id);
      const kicker = el('div', 'an-sheet-kicker');
      const paintCount = () => (kicker.textContent = `شاهدت ${count()} من ${total}`);
      paintCount();
      head.append(kicker, t);
      const field = (label, value) => {
        const f = el('label', 'field');
        f.append(el('span', 'field-label', label));
        const input = el('input', 'field-input');
        input.type = 'number';
        input.inputMode = 'numeric';
        input.min = '1';
        input.max = String(total);
        input.value = String(value);
        f.append(input);
        return { f, input };
      };
      // البداية بعد آخر حلقة معلّمة: الغالب أنك تكمل من حيث وقفت
      let last = 0;
      for (let n = 1; n <= total; n++) if (account.isSeen(m.id, n)) last = n;
      const from = field('من الحلقة', Math.min(total, last + 1));
      const to = field('إلى الحلقة', total);
      const pair = el('div', 'an-mark-range');
      pair.append(from.f, to.f);
      const clamp = (v) => Math.max(1, Math.min(total, Math.round(Number(v) || 1)));
      const done = (changed, msg) => {
        paintCount();
        renderEpisodes(host, m);
        toast(changed ? msg : 'ما تغيّر شيء');
      };
      const act = el('div', 'an-mark-actions');
      const seenBtn = button('btn btn-primary', 'علّمها شوهدت', () => {
        const a = clamp(from.input.value);
        const b = clamp(to.input.value);
        const n = account.markRange(m, a, b, true);
        done(n, `عُلّمت ${n} حلقة (${Math.min(a, b)}–${Math.max(a, b)})`);
      });
      const unseenBtn = button('btn', 'ألغِ تعليمها', () => {
        const a = clamp(from.input.value);
        const b = clamp(to.input.value);
        const n = account.markRange(m, a, b, false);
        done(n, `أُلغي تعليم ${n} حلقة`);
      });
      act.append(seenBtn, unseenBtn);
      const quick = el('div', 'an-mark-actions');
      quick.append(
        button('btn', 'شاهدته كله', () => {
          const n = account.markRange(m, 1, total, true);
          done(n, `عُلّمت كل الحلقات (${total})`);
        }),
        button('btn', 'ألغِ الكل', () => {
          const had = count();
          account.clearAll(m);
          done(had, 'أُلغي تعليم كل الحلقات');
        }),
      );
      const completed = el('label', 'an-mark-toggle');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = account.isCompleted(m.id);
      box.onchange = () => {
        account.setCompleted(m, box.checked);
        toast(box.checked ? 'أُضيف إلى «المكتمل»' : 'أُزيل من «المكتمل»');
      };
      completed.append(box, el('span', null, 'أكملته (يظهر في «المكتمل» بملفك)'));
      body.append(head, pair, act, quick, completed);
    });
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

  // نسخ كل أنمي في المصادر تُحفظ على الجهاز: الفتحة التالية تبدأ منها فورًا،
  // والبحث يتحدّث بصمت في الخلفية (كان يُعاد من الصفر مع كل دخول وخروج)
  const FOUND_KEY = 'vantara.anime.found.v1';
  const FOUND_TTL = 7 * 24 * 3600e3;
  const knownWork = (id) => {
    const hit = readJson(FOUND_KEY, {})[id];
    return hit?.work?.copies?.length && Date.now() - (hit.at ?? 0) < FOUND_TTL ? hit.work : null;
  };
  const keepWork = (id, work) => {
    const all = readJson(FOUND_KEY, {});
    all[id] = { work, at: Date.now() };
    const ids = Object.keys(all);
    if (ids.length > 300) for (const old of ids.sort((a, b) => all[a].at - all[b].at).slice(0, ids.length - 300)) delete all[old];
    writeJson(FOUND_KEY, all);
  };

  /** يبحث عن الأنمي في كل المصادر العربية (محرك التطبيق): أول مصدر يطابق يكفي، والبقية تُضاف حين تصل. */
  async function locateWork(m, token = state.detailToken) {
    if (!engine.available()) return null;
    if (state.workFor === m.id && state.work) return state.work;
    // صفحة العمل وزر تشغيل الحلقة يصلان غالبًا قبل انتهاء البحث: يشتركان في طلب واحد.
    if (state.workFor === m.id && state.workPending) return state.workPending;
    state.work = null;
    state.workError = false;
    state.workFor = m.id;
    const titles = [m.title, m.romaji, m.native, ...(m.synonyms ?? [])];
    const current = () => token === state.detailToken && state.workFor === m.id;
    const adopt = (work) => {
      keepWork(m.id, work);
      if (!current()) return;
      const copies = [...(state.work?.copies ?? []), ...work.copies];
      state.work = { ...work, copies: copies.filter((copy, index) => copies.findIndex(c => c.sourceId === copy.sourceId && c.url === copy.url) === index) };
      paintSources(m, 'found');
      for (const listener of workListeners) listener(m.id, state.work);
    };
    if (m._sourceCopy) { const work = { title: m.title, copies: [m._sourceCopy] }; adopt(work); return work; }
    const remembered = knownWork(m.id);
    if (remembered) {
      state.work = remembered;
      paintSources(m, 'found');
      // تحديث صامت: مصدر جديد أو رابط تغيّر يدخل للفتحة القادمة بلا انتظار الآن
      void engine.findWorkStream(titles, adopt, { year: m.year ?? null }).then((fresh) => fresh && adopt(fresh)).catch(() => {});
      void engine.withAddonCopies([], animeAddonIdentity(m)).then(copies => copies.length && adopt({ title: m.title, copies })).catch(() => {});
      return remembered;
    }
    paintSources(m, 'loading');
    const pending = (async () => {
      try {
        let sourceError = null;
        const core = engine.findWorkStream(titles, adopt, { year: m.year ?? null }).catch(error => { sourceError = error; return null; });
        const addons = engine.withAddonCopies([], animeAddonIdentity(m)).then(copies => { if (copies.length) adopt({ title: m.title, copies }); return copies; });
        const work = await engine.firstAvailableCopies(core, addons);
        if (!work?.copies?.length && sourceError) throw sourceError;
        if (!current()) return null;
        if (work?.copies?.length) adopt(work);
        else paintSources(m, 'none');
        return work?.copies?.length ? state.work : null;
      } catch {
        if (current()) { state.workError = true; paintSources(m, 'error'); }
        return null;
      } finally {
        if (state.workPending === pending) state.workPending = null;
      }
    })();
    state.workPending = pending;
    return pending;
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
    const names = [...new Set(state.work.copies.map((c) => sourceLabel(c.sourceId, { names: SOURCE_NAMES, title: c.title })))];
    names.forEach((name, i) => {
      const chip = el('span', `an-source-chip${i === 0 ? ' an-source-chip--main' : ''}`, name);
      chip.dir = 'auto';
      host.append(chip);
    });
  }

  // مصدر يطلب تحقق إنسان من Cloudflare: شريحة صغيرة «تحقّق» لعشر ثوانٍ ثم تختفي،
  // مرة لكل مصدر في الجلسة. لا شيء يظهر من تلقاء نفسه بعدها: التحقق متاح أيضًا
  // من «المصادر» في الإعدادات متى شئت.
  const askedVerify = new Set();
  engine.onNeedsHuman((id) => {
    if (askedVerify.has(id)) return;
    askedVerify.add(id);
    showVerifyPill(id);
  });
  function showVerifyPill(id) {
    const pill = el('div', 'an-verify');
    pill.setAttribute('role', 'status');
    pill.append(el('span', 'an-verify-text', `${sourceName(id)} يطلب تحقق`));
    let timer = 0;
    const close = () => {
      clearTimeout(timer);
      pill.classList.remove('in');
      setTimeout(() => pill.remove(), 250);
    };
    pill.append(button('an-verify-go', 'تحقّق', () => {
      close();
      void verifySource(id);
    }));
    (deps.root ?? document.body).append(pill);
    requestAnimationFrame(() => pill.classList.add('in'));
    timer = setTimeout(close, 10_000);
  }
  /** يفتح صفحة التحقق، وبعد نجاحه يعيد البحث عن الأنمي المفتوح ليضم المصدر. */
  async function verifySource(id) {
    toast(`نفتح تحقق ${sourceName(id)}…`);
    const out = await engine.verify(id);
    if (!out?.ok) return toast(`لم يكتمل التحقق: ${out?.error ?? 'تعذّر'}`);
    toast(`تم التحقق من ${sourceName(id)}`);
    const m = state.detail;
    if (m && state.workFor === m.id) {
      state.workFor = null;
      state.work = null;
      void locateWork(m);
    }
  }

  const SOURCE_NAMES = {};
  // نسخ الإضافات تحمل اسم الإضافة في `title`؛ وإلا يُستخرج من مضيفها (torrentio ← Torrentio)
  const sourceName = (id) => sourceLabel(id, { names: SOURCE_NAMES, title: state.work?.copies?.find((c) => c.sourceId === id)?.title ?? null });
  void engine.sources().then((list) => {
    for (const s of list ?? []) SOURCE_NAMES[s.id] = s.name;
  }).catch(() => {});

  // ───────────── التشغيل: ورقة السيرفرات ثم المشغّل الأصلي ─────────────

  /** الرابط خاص بالحلقة؛ هوية المصدر والسيرفر الناجح تصلح لترجيح الأعمال الأخرى. */
  const SERVER_KEY = 'vantara.anime.servers';
  const WORKING_SERVER_KEY = 'vantara.anime.working-server';
  const preferredCode = (id) => readJson(SERVER_KEY, {})[id] ?? null;
  const workingServer = (id) => {
    const known = readJson(WORKING_SERVER_KEY, {});
    return known[id] ?? known.lastWorking ?? null;
  };
  const rememberCode = (id, code) => {
    if (!id || !code) return;
    const all = readJson(SERVER_KEY, {});
    all[id] = code;
    writeJson(SERVER_KEY, all);
  };

  // تقدّم المشغّل الأصلي ← سجل المشاهدة (الاستئناف و«آخر المشاهدات»). الحلقة
  // من الحدث نفسه: التبديل لحلقة أخرى داخل المشغّل يُسجَّل لها لا للأولى.
  // وقت المشاهدة لقسم الأنمي في ملفك: تقدّم الموضع الفعلي فقط (قفزة أو توقف لا تُحسب)
  const watchClock = { pos: null, at: null, acc: 0 };
  const flushWatch = () => {
    if (watchClock.acc < 1000 || !deps.sync) return;
    const cur = state.playing;
    if (!cur || cur.userId !== currentUser()) { watchClock.acc = 0; return; }
    const ms = Math.round(watchClock.acc);
    deps.sync.enqueue('usage.watch', { section: 'anime', day: new Date().toISOString().slice(0, 10), activeMs: ms });
    deps.sync.enqueue('usage.work', {
      section: 'anime', seriesRef: `anime:${cur.m.id}`, seriesTitle: cur.m.title,
      coverUrl: cur.m.posterSmall ?? cur.m.poster ?? null, activeMs: ms,
    });
    watchClock.acc = 0;
  };
  engine.on('playback', (p) => {
    const cur = state.playing;
    if (!cur || (p.animeId ? String(p.animeId) !== String(cur.m.id) : p.session !== cur.session)) return;
    // An old native player must never credit playback to the account now signed in.
    if (cur.userId !== currentUser()) return;
    if (!nativeFollowTime() && Number.isFinite(p.position)) {
      const now = Date.now();
      const d = watchClock.pos === null ? 0 : p.position - watchClock.pos;
      const elapsed = watchClock.at === null ? 0 : Math.max(0, now - watchClock.at);
      // قفزة المشغّل لا تُحتسب متابعة؛ السرعات >1× تُحسب بوقت الشخص الفعلي.
      if (d > 0 && d <= 15_000) watchClock.acc += Math.min(d, elapsed + 1000);
      watchClock.pos = p.position;
      watchClock.at = now;
      if (watchClock.acc >= 60_000) flushWatch();
    }
    if (p.final) {
      void flushFollowTime(deps.sync).catch(() => {});
      flushWatch();
      watchClock.pos = null;
      watchClock.at = null;
    }
    const n = Number.isFinite(p.episode) && p.episode > 0 ? p.episode : cur.n;
    if (p.duration > 0) {
      recordWatch(cur.m, n, p.position, p.duration, cur.userId);
      account?.recordView(cur.m, n);
      // 90% = شوهدت، في حسابك (مرة واحدة)
      const watchedRatio = p.watchedRatio ?? (nativeFollowTime() ? 0 : p.position / p.duration);
      if (watchedRatio >= 0.9 && account) {
        if (!account.isSeen(cur.m.id, n)) account.markEpisode(cur.m, n, true);
        // «أنهى الحلقة N» من المشغّل وحده: تعليم العين يدويًّا لا يعلن شيئًا
        account.completeEpisode(cur.m, n);
      }
    }
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
    if (e?.animeId && e.code) {
      rememberCode(e.animeId, e.code);
      if (e.sourceId && e.server) {
        const working = readJson(WORKING_SERVER_KEY, {});
        const route = { sourceId: e.sourceId, server: e.server, quality: e.quality ?? null };
        working[e.animeId] = route;
        working.lastWorking = route;
        writeJson(WORKING_SERVER_KEY, working);
      }
    }
  });

  /**
   * اللحظات والترشيحات من المشغّل ← المجلس. المشغّل يحفظها في صندوق صادر
   * أصلي فلا تضيع إن كانت الواجهة نائمة خلفه؛ هنا تُسحب وتدخل طابور المزامنة
   * (الذي يعيد المحاولة وحده حتى تصل).
   */
  const outboxInFlight = new Set();
  async function flushOutbox() {
    if (!engine.available() || !deps.sync) return;
    const userId = currentUser();
    if (!userId || outboxInFlight.has(userId)) return;
    outboxInFlight.add(userId);
    try {
      const key = `vantara.anime.native-outbox.v1.${encodeURIComponent(userId)}`;
      let items = [];
      try {
        items = await engine.outbox(userId);
      } catch {
        // Still deliver items that made it to the account-bound web handoff.
      }
      // Persist the native handoff for its original owner before touching the active session.
      const pending = [...readJson(key, []), ...items.filter((it) => it.userId === userId)];
      const unique = [...new Map(pending.map((it) => [it.id, it])).values()];
      writeJson(key, unique);
      if (currentUser() !== userId) return;
      for (const it of unique) {
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
      writeJson(key, []);
    } finally {
      outboxInFlight.delete(userId);
    }
  }
  engine.on('outbox', () => void flushOutbox());
  // قياس «تعذّر» من المشغّل الأصلي (أنمي وسينما): محاولة الحلقة وكل سيرفر، عدّادات بلا هوية
  engine.on('playstat', (e) => reportSource(e));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushOutbox();
  });
  setTimeout(() => void flushOutbox(), 2500);

  /**
   * لمسة الحلقة: الورقة تفتح فورًا والسيرفرات تتجهّز خلفها واحدًا واحدًا.
   * الورقة نفسها في السينما (server-sheet.js): «الأفضل لك» فوق، ثم المباشر
   * فالتورنت بأسماء بشرية وجودة ولغة وصحة سرب. الأفضل يرجّح سيرفرك السابق
   * لهذا الأنمي دون أن يقفل عليه.
   */
  function playEpisode(m, n, { position = null, clip = null } = {}) {
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
    const saved = localWatch()[m.id]?.episodes?.[n];
    const startAt = clip?.startMs ?? position ?? (saved && !saved.done ? saved.position : 0);
    const prefer = preferredCode(m.id);
    const previousServer = workingServer(m.id);
    const sheet = { session: null, routes: [], retryAt: 0, done: false, closed: false, launched: false, busy: false, work: null, touched: false };
    // Together: دخلت من بطاقة «مشاهدة معًا» (أو دعوت الحين) ← بلا اختيار: أول سيرفر جاهز عندك يشتغل على طول
    const hub = deps.together?.() ?? null;
    const togetherRef = `anime:${m.id}`;
    sheet.autoTogether = Boolean(hub?.matches(togetherRef, n));
    let paintQueued = false;
    let off = [];

    // صفحة كاملة لا ورقة: قرار قبل التشغيل فيه جودة ولغة وسيرفر
    deps.openSheet((body) => {
      // رأس الورقة (server-sheet.js): لقطة الحلقة بشعار العمل، ثم تقييمها وتاريخها ومدتها ووصفها من ani.zip
      const art = state.art?.id === m.id ? state.art : null;
      const shot = episodeStill(m, n, art);
      const thumb = shot.still ? shot.src : null;
      const epTitle = episodeTitleOf(m, n, { mal: state.malTitles, art });
      const epArt = art?.episodes?.[String(n)] ?? null;
      const minutes = epArt?.runtime || m.duration;
      const media = {
        title: m.title,
        logo: art?.logo ?? null,
        backdrop: thumb ?? m.banner ?? m.poster,
        backdropFallback: m.banner ?? m.poster ?? null,
        backdropPosition: thumb || m.banner ? null : 'center 25%',
        label: `الحلقة ${n}`,
        episodeTitle: epTitle,
        description: epArt?.overview ?? null,
        rating: epArt?.rating ? { value: epArt.rating } : null,
        date: epArt?.airDate ?? null,
        duration: minutes ? `${minutes} د` : null,
        resume: clip ? `اللقطة ${engine.clock(clip.startMs)}–${engine.clock(clip.endMs)}` : startAt > 5000 ? `تكمل من ${engine.clock(startAt)}` : null,
      };

      const extraFoot = [];
      if (hub && !sheet.autoTogether) {
        const withFriends = button('an-pick-together', `${glyph('users', { size: 20 })}<span>شاهد مع أصدقائك</span>`, () => {
          hub.openInvite({
            kind: 'anime',
            key: `${togetherRef}#${n}`,
            label: `${m.title} — الحلقة ${n}`,
            seriesRef: togetherRef,
            title: m.title,
            cover: m.posterSmall ?? m.poster ?? null,
            // شاشة الغرفة: بنر الحلقة (أو بنر العمل) وعنوانها؛ الشعار يُكمَّل من ani.zip
            banner: thumb ?? m.banner ?? null,
            episodeTitle: epTitle ?? null,
            episode: n,
          }, {
            // ورقة الدعوة أغلقت ورقة السيرفرات وأوقفت تجهيزها: نعيد فتحها والغرفة نشطة،
            // فتشغّل أول سيرفر جاهز وحدها ويفتح المشغّل على شاشة الغرفة.
            onStarted: () => playEpisode(m, n),
          });
        }, 'شاهد مع أصدقائك');
        extraFoot.push(withFriends);
      }

      // انتهى التجهيز بلا أي سيرفر جاهز: الزر يعيد المحاولة بدل أن يبقى معطّلًا
      const exhausted = () => sheet.done && sheet.work !== false && !sheet.routes.some((r) => r.state === 'READY');

      const playRoute = async (r) => {
        if (sheet.busy) return;
        sheet.touched = true;
        sheet.busy = true;
        paint();
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

      // بلا جاهز بعد: «شغّل أول سيرفر يجهز» ينتظره المحرك ويزن الموثوقية وسيرفرك السابق
      const playBest = async () => {
        if (sheet.busy || !sheet.session) return;
        sheet.busy = true;
        paint();
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

      const ui = createServerSheet(body, {
        el,
        kicker: `الحلقة ${n}`,
        title: m.title,
        media,
        extraFoot,
        prefer,
        // المصادر العربية تترجم الحلقة على الصورة نفسها؛ المدبلج يُقال صراحة
        directLang: 'مترجم عربي',
        sourceName: (r) => sourceName(r.sourceId),
        onBack: () => deps.closeSheet(),
        onPick: (r) => playRoute(r),
        onBest: () => playBest(),
        onRetry: () => {
          if (engine.retrySeconds(sheet.retryAt)) return;
          deps.closeSheet();
          playEpisode(m, n, { position });
        },
        onUnavailable: (r) => deps.toast(r.reason || 'لم يُستخرج رابط فيديو من المشغّل', 5000),
      });
      const status = ui.status;

      const statusLine = () => {
        const ready = sheet.routes.filter((r) => r.state === 'READY').length;
        const total = sheet.routes.length;
        if (!sheet.session) {
          if (sheet.searchError) return { text: 'تعذّر البحث في المصادر — أعد المحاولة' };
          if (sheet.work === false) return { text: 'غير متوفر في المصادر العربية حاليًا' };
          return { text: 'نبحث في المصادر العربية والإضافات…', spin: true };
        }
        if (!sheet.done && ready) return { text: `${ready} ${ready === 1 ? 'سيرفر جاهز' : 'سيرفرات جاهزة'} من ${total} · البقية تصل`, spin: true };
        if (!sheet.done) return { text: 'نجهّز السيرفرات…', spin: true };
        return { text: ready ? `${ready} ${ready === 1 ? 'سيرفر جاهز' : 'سيرفرات جاهزة'}${total > ready ? ` من ${total}` : ''}` : 'لم يجهز أي سيرفر لهذه الحلقة الآن' };
      };

      const paint = () => {
        paintQueued = false;
        if (sheet.closed) return;
        ui.update({
          routes: sheet.routes,
          busy: sheet.busy,
          settled: sheet.done,
          missing: sheet.work === false,
          error: Boolean(sheet.searchError),
          status: statusLine(),
          retry: exhausted() ? { wait: engine.retrySeconds(sheet.retryAt) } : null,
        });
        // «دخول» من بطاقة الغرفة: أول سيرفر جاهز يشتغل وحده، وجاري التجهيز يظهر في المشغّل
        if (sheet.autoTogether && !sheet.launched && !sheet.busy && sheet.routes.some((r) => r.state === 'READY')) {
          sheet.autoTogether = false;
          queueMicrotask(() => ui.best.onclick());
        }
      };
      const queuePaint = () => {
        if (paintQueued) return;
        paintQueued = true;
        requestAnimationFrame(paint);
      };

      const onWork = (id, work) => {
        if (sheet.closed || id !== m.id) return;
        sheet.work = work;
        sheet.copies = [...(sheet.copies ?? []), ...work.copies].filter((c, i, all) => all.findIndex(x => x.sourceId === c.sourceId && x.url === c.url) === i);
        if (sheet.session) void engine.extend(sheet.session, work.copies).catch(() => {});
      };
      workListeners.add(onWork);
      off.push(() => workListeners.delete(onWork));
      paint();
      const cooldownTimer = setInterval(() => {
        if (!sheet.closed && exhausted()) paint();
      }, 1000);
      void (async () => {
        const work = state.work && state.workFor === m.id ? state.work : await locateWork(m);
        if (sheet.closed) return;
        if (!work) {
          sheet.searchError = state.workFor === m.id && state.workError;
          sheet.work = sheet.searchError ? null : false;
          sheet.done = true;
          paint();
          return;
        }
        sheet.work = work;
        off.push(
          engine.on('route', (e) => {
            if (e.session !== sheet.session || !e.route) return;
            sheet.retryAt = Math.max(sheet.retryAt, Number(e.retryAt) || 0);
            sheet.routes = engine.upsertRoute(sheet.routes, e.route);
            queuePaint();
          }),
          engine.on('prepared', (e) => {
            if (e.session !== sheet.session) return;
            sheet.retryAt = Math.max(sheet.retryAt, Number(e.retryAt) || 0);
            sheet.done = true;
            queuePaint();
          }),
        );
        try {
          const copies = previousServer?.sourceId
            ? [...work.copies].sort((a, b) => Number(b.sourceId === previousServer.sourceId) - Number(a.sourceId === previousServer.sourceId))
            : work.copies;
          const out = await engine.prepare({ copies, identity: animeAddonIdentity(m, n), episode: n, preferredSourceId: previousServer?.sourceId, preferredServer: previousServer?.server });
          if (sheet.closed) {
            if (out?.session) void engine.closeSession(out.session);
            return;
          }
          sheet.session = out.session;
          sheet.copies = out.copies ?? copies;
          if (state.workFor === m.id && state.work) onWork(m.id, state.work);
          // ما وصل قبل أن نعرف رقم الجلسة: نأخذ اللقطة الكاملة الآن
          const snap = await engine.routes(out.session);
          sheet.retryAt = Math.max(sheet.retryAt, Number(snap?.retryAt ?? out.retryAt) || 0);
          sheet.routes = snap?.routes ?? out.routes ?? [];
          sheet.done = Boolean(snap?.done ?? out.done);
          queuePaint();
        } catch (e) {
          status.textContent = `تعذّر تجهيز السيرفرات: ${e?.message ?? e}`;
        }
      })();

      return () => {
        sheet.closed = true;
        clearInterval(cooldownTimer);
        for (const f of off) f();
        off = [];
        // أُغلقت الورقة بلا تشغيل: لا نترك التجهيز يعمل في الخلفية
        if (!sheet.launched && sheet.session) void engine.closeSession(sheet.session);
      };
    }, { tone: 'anime', full: true });

    async function launch(candidate, code) {
      sheet.launched = true;
      const session = sheet.session;
      deps.closeSheet();
      const watch = localWatch()[m.id]?.episodes ?? {};
      const resume = {};
      for (const [ep, e] of Object.entries(watch)) if (!e.done && e.position > 5000) resume[ep] = e.position;
      flushWatch();
      watchClock.pos = null;
      watchClock.at = null;
      state.playing = { session, m, n, userId: currentUser() };
      deps.setWatching?.({ ref: `anime:${m.id}`, title: m.title, episode: n });
      const presence = await deps.playerPresence?.();
      await engine.open({
        session,
        candidate,
        prefer: code ?? prefer,
        title: m.title,
        animeId: String(m.id),
        subtitleIdentity: { ...animeAddonIdentity(m, n), externalIds: { ...animeAddonIdentity(m, n).externalIds, ...(sheet.copies?.find(c => c.identity?.externalIds?.kitsu)?.identity?.externalIds ?? {}) } },
        usageUserId: currentUser(),
        episode: n,
        total: m.aired || m.episodes || 0,
        position: startAt,
        ...(clip ? { clipStart: clip.startMs, clipEnd: clip.endMs } : {}),
        poster: m.posterSmall ?? m.poster ?? null,
        friends: (deps.friends?.() ?? []).map((f) => ({ userId: f.userId, displayName: f.displayName })),
        copies: sheet.copies ?? sheet.work.copies,
        malId: m.idMal ?? null,
        resume,
        presenceEndpoint: presence?.endpoint ?? null,
        presenceAuthorization: presence?.authorization ?? null,
        presenceUserId: presence?.userId ?? null,
        presenceDeviceId: presence?.deviceId ?? null,
        presenceDeviceCredential: presence?.deviceCredential ?? null,
        ...(hub?.matches(togetherRef) ? { together: hub.handOff(togetherRef) } : {}),
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
    requestAnimationFrame(() => centerInStrip(chips, chips.querySelector('.active')));
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

  /** حذف عمل من «آخر المشاهدات»: من الجهاز والحساب، ومن كل بطاقة ظاهرة له. */
  function removeWatch(w) {
    const all = localWatch();
    delete all[w.id];
    saveWatch(all);
    if (signedIn()) deps.sync.enqueue('view.remove', { seriesRef: `anime:${w.id}` });
    const ref = `anime:${w.id}`;
    for (const node of deps.root?.querySelectorAll?.('.an-cw, .an-hc') ?? []) {
      if (node.dataset.ref !== ref) continue;
      const strip = node.closest('.an-rail');
      node.remove();
      // كان آخر بطاقة في الشريط: لا شريط فارغًا بعنوانه
      if (strip && !strip.querySelector('.an-cw')) strip.remove();
    }
    if (state.libraryTab === 'history' && !watching().length) renderLibrary();
    toast('حُذف من آخر المشاهدات');
  }

  /** ورقة ⋮ لبطاقة «آخر المشاهدات»: نفس أفعال صفحة العمل (المفضلة، القائمة) والحذف. */
  function openContinueMenu(w) {
    const m = { id: w.id, title: w.title, poster: w.poster, posterSmall: w.poster, banner: w.banner, color: w.color };
    const listName = signedIn() ? 'أتابعها' : 'قائمتي';
    openWatchMenu({
      openSheet: deps.openSheet,
      closeSheet: deps.closeSheet,
      el,
      title: w.title,
      tone: 'anime',
      items: watchMenuItems({ favorite: signedIn() ? Boolean(account.inCollection('favorite', w.id)) : null, list: { on: inList(w.id), name: listName } }),
      actions: {
        favorite: () => {
          const on = !account.inCollection('favorite', w.id);
          account.setCollection('favorite', m, on);
          toast(on ? `أُضيف إلى المفضلة: ${w.title}` : 'أُزيل من المفضلة');
        },
        list: () => {
          const on = toggleList(m);
          toast(on ? `أُضيف إلى ${listName}: ${w.title}` : `أُزيل من ${listName}`);
        },
        remove: () => removeWatch(w),
      },
    });
  }

  /**
   * «آخر المشاهدات» في مكتبتي بهوية الأنمي: لقطة الحلقة نفسها عريضة بتوهّج لون العمل،
   * شارة الحلقة ووقتها، زر «تابع» زجاجي، شريط التقدّم مضيئًا، والبوستر يطلّ من الزاوية.
   * اللقطة من ani.zip (مخبّأة) تحلّ محل البنر متى وصلت؛ بلا لقطة يبقى البنر أو الغلاف.
   */
  function historyCard(w) {
    const e = w.episodes?.[w.episode] ?? {};
    const ratio = e.duration ? Math.min(1, e.position / e.duration) : e.done ? 1 : 0;
    const c = asButton(el('div', `an-hc${e.done ? ' done' : ''}`), `تابع ${w.title} — الحلقة ${w.episode}`);
    c.dataset.ref = `anime:${w.id}`;
    tint(c, w.color);
    const stage = el('div', 'an-hc-stage');
    const wide = w.banner ?? w.poster ?? null;
    const still = image(wide, 'an-img an-hc-still', { position: w.banner ? 'center' : 'center 22%' });
    stage.append(still, el('span', 'an-hc-shade'));
    const chip = el('span', 'an-hc-chip');
    chip.append(el('small', null, 'الحلقة'), el('b', null, String(w.episode)));
    const when = el('span', 'an-hc-when', relativeAr(w.at));
    const play = el('span', 'an-hc-play');
    play.innerHTML = `${glyph('play', { size: 16, filled: true })}<span>${e.done ? 'التالية' : 'تابع'}</span>`;
    const bar = el('span', 'an-hc-bar');
    const fill = el('i');
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    bar.append(fill);
    stage.append(chip, when, play, bar);

    const foot = el('div', 'an-hc-foot');
    const poster = el('span', 'an-hc-poster');
    poster.append(image(w.poster));
    const info = el('div', 'an-hc-info');
    const t = el('b', 'an-hc-title', w.title);
    t.dir = 'auto';
    const name = el('span', 'cw-name');
    name.append(t, moreButton(el, () => openContinueMenu(w), `خيارات ${w.title}`));
    const meta = el('span', 'an-hc-meta');
    meta.append(el('span', e.done ? 'an-hc-left done' : 'an-hc-left', e.done ? 'شوهدت كاملة' : minutesLeft(e) ?? `الحلقة ${w.episode}`), el('span', 'an-hc-watched'));
    info.append(name, meta);
    // البوستر في زاوية النهاية: بداية شريط التقدّم (جهة البداية) تبقى ظاهرة
    foot.append(info, poster);
    c.append(stage, foot);
    c.onclick = () => void openAnime({ id: w.id, title: w.title, poster: w.poster, posterSmall: w.poster, banner: w.banner, color: w.color }, { episode: w.episode });

    // لقطة الحلقة نفسها حين تصل (لا وميض: تُبدَّل بعد أن تُحمَّل)
    void loadAnimeArt(w.id).then((art) => {
      const shot = episodeStill({}, w.episode, art);
      if (!shot.still || !c.isConnected) return;
      const pre = new Image();
      pre.onload = () => {
        still.src = shot.src;
        still.style.objectPosition = 'center';
        c.classList.add('has-still');
      };
      pre.src = shot.src;
    });
    return c;
  }

  function renderLibrary() {
    const host = q('animeLibrary');
    if (!host) return;
    // نفس شرائح «مكتبتي» في المانجا والسينما: الاسم وعدده، وبنفس الترتيب (قانون التوحيد)
    const tabs = el('div', 'segmented library-tabs');
    tabs.setAttribute('role', 'tablist');
    const countOf = (k) =>
      k === 'history' ? watching().length
        : k === 'list' ? (signedIn() ? account.shelf('library').length : Object.keys(readJson(LIST_KEY, {})).length)
          : k === 'sources' ? 0
            : signedIn() ? account.shelf(k).length : 0;
    for (const [k, label] of [
      ['list', signedIn() ? 'أتابعها' : 'قائمتي'],
      ['history', 'آخر المشاهدات'],
      ...(signedIn()
        ? [
            ['read_later', 'لاحقًا'],
            ['favorite', 'المفضلة'],
            ['completed', 'المكتمل'],
          ]
        : []),
      ...(engine.available() ? [['sources', 'المصادر']] : []),
    ]) {
      const b = el('button', `library-tab${state.libraryTab === k ? ' active' : ''}`, label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(state.libraryTab === k));
      const n = countOf(k);
      if (n) b.append(el('b', null, String(n)));
      b.onclick = () => {
        state.libraryTab = k;
        renderLibrary();
      };
      tabs.append(b);
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
            saveWatch({});
            if (signedIn()) for (const w of items) deps.sync.enqueue('view.remove', { seriesRef: `anime:${w.id}` });
            renderLibrary();
            toast('مُسح سجل المشاهدة');
          }),
        );
        const list = el('div', 'an-hc-list');
        list.append(...items.map(historyCard));
        nodes.push(list);
      }
    } else {
      // رفوف الحساب (تظهر في ملفك ولأصدقائك)، أو قائمة الجهاز لمن لم يسجّل
      const kind = state.libraryTab;
      const SHELF = {
        list: ['library', 'أتابعها', 'اضغط «قائمتي» على أي أنمي ليظهر هنا.', 'تتابعها'],
        read_later: ['clock', 'شاهد لاحقًا', 'اضغط الساعة في صفحة أي أنمي تنوي تشاهده.', 'في «شاهد لاحقًا»'],
        favorite: ['heart', 'المفضلة', 'اضغط القلب في صفحة الأنمي اللي تحبه.', 'في المفضلة'],
        completed: ['check', 'المكتمل', 'علّم «أكملته» من زر العين في قائمة الحلقات.', 'أكملتها'],
      };
      const [icon, title, hint, unit] = SHELF[kind] ?? SHELF.list;
      const items = signedIn()
        ? account.shelf(kind === 'list' ? 'library' : kind)
        : Object.values(readJson(LIST_KEY, {})).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
      if (!items.length) {
        const box = emptyBox(icon, `${title}: فارغة`, hint);
        box.append(button('an-btn an-btn--primary', 'اكتشف أنمي', () => openDiscover({})));
        nodes.push(box);
      } else {
        const grid = el('div', 'an-grid');
        grid.append(...items.map((m) => posterCard(m)));
        nodes.push(el('p', 'an-count', `${items.length} ${unit}`), grid);
      }
    }
    host.replaceChildren(...nodes);
    const historyOwner = currentUser();
    if (state.libraryTab === 'history' && signedIn()) void deps.sync.insights(historyOwner).then((data) => {
      if (!host.isConnected || state.libraryTab !== 'history' || currentUser() !== historyOwner || !data?.content) return;
      const times = new Map(data.content.map((item) => [item.seriesRef, item.activeMs]));
      for (const row of host.querySelectorAll('.an-hc[data-ref]')) {
        const ms = times.get(row.dataset.ref);
        if (ms < 60000) continue;
        row.querySelector('.an-hc-watched').textContent = `شاهدت ${insightDuration(ms)}`;
      }
    });
    stripIn([...host.querySelectorAll('.an-hc, .an-card')].slice(0, 10));
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
        // تحقق إنسان من Cloudflare: يُحلّ هنا بضغطة، لا بالانتظار
        if (r?.blocked === 'cloudflare_interactive') line.append(button('an-src-btn an-src-btn--verify', 'تحقّق', async () => {
          await verifySource(s.id);
          void renderSourcesHealth(box);
        }));
        else if (r?.blocked) line.append(button('an-src-btn', 'أعد المحاولة', async () => {
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
