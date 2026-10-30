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
import { FORMAT_AR, RELATION_AR, SEASON_AR, STATUS_AR, fetchAnimeDetail, fetchAnimeHome, fetchMalEpisodes, meccaDay, relativeAr } from '../lib/anime-meta.js';
import { createAnimeDiscover } from './anime-discover.js';
import { pop, revealIn, stripIn } from './motion.js';
import * as engine from '../lib/anime-engine.js';
import { createAnimeAccount } from './anime-account.js';
import { report as reportUpdate } from '../lib/update-engine.js';
import { paintWorkInsights } from './work-insights.js';
import { createServerSheet, learnStart, sourceLabel } from './server-sheet.js';
import { duration as insightDuration } from './insights.js';
import { episodeStill, episodeTitleOf, loadAnimeArt, loadHdStills } from '../lib/anime-art.js';
import { bindCollapsingHero } from './collapse-hero.js';
import { animeDepthLayers } from './anime-depth.js';
import { workStyleOf } from './appearance.js';
import { bindLookMotion, renderLook } from './work-looks.js';
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
    view: null,
    hideSeen: false,
    epQuery: '',
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
    // بدائل بالترتيب (أصلية 1920 ← 780 ← TVDB ← الغلاف): كل واحد مرة، لا إطار فارغ
    const chain = (Array.isArray(fallback) ? fallback : [fallback]).filter((f) => f && f !== src);
    img.onerror = () => {
      const next = chain.shift();
      if (next) {
        img.dataset.fellBack = '1';
        img.src = next;
        return;
      }
      img.classList.add('failed');
    };
    if (src) img.src = src;
    return img;
  }
  /**
   * صورة ظاهرة تُستبدل بأخرى بلا وميض: الجديدة تُحمَّل وتُفك خارج الصفحة ثم تحل محلها في إطار
   * واحد. تبديل src مباشرة كان يُفرغ الإطار لحظة (تختفي الصورة جزءًا من الثانية ثم ترجع).
   */
  function swapWhenReady(cur, src, opts = {}, onSwap = null) {
    if (!cur || !src || cur.dataset.want === src) return;
    cur.dataset.want = src;
    const next = image(src, cur.className.replace(/\s*\bloaded\b/, '') || 'an-img', { ...opts, eager: true });
    next.dataset.want = src;
    const done = () => {
      if (!cur.isConnected || cur.dataset.want !== src) return;
      next.classList.add('loaded');
      cur.replaceWith(next);
      onSwap?.(next);
    };
    next.addEventListener('load', () => void (next.decode?.() ?? Promise.resolve()).then(done, done), { once: true });
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

  /** سطر البطاقة الهادئ: ★ التقييم، ثم الحلقة لما يُعرض أو النوع، ثم السنة. */
  function cardMeta(m) {
    const meta = el('span', 'an-card-meta');
    if (m.score) {
      const sc = el('span', 'an-card-score');
      sc.innerHTML = `${glyph('star', { size: 11, filled: true })}<b>${m.score.toFixed(1)}</b>`;
      meta.append(sc);
    }
    // سطر قصير يتسع للبطاقة: مع التقييم شيء واحد بعده (الحلقة لما يُعرض، أو السنة)
    const airing = m.status === 'RELEASING' && m.aired ? `ح ${m.aired}` : null;
    const rest = (m.relation ? [m.relation] : m.score ? [airing ?? m.year] : [airing ?? FORMAT_AR[m.format], m.year]).filter(Boolean);
    for (const t of rest) {
      if (meta.childElementCount) meta.append(el('i', 'aw-sep', '·'));
      meta.append(el('span', null, String(t)));
    }
    return meta;
  }

  function posterCard(m, { rank, rankInline, onOpen } = {}) {
    const c = el('button', `an-card${rank ? ' an-card--ranked' : ''}`);
    c.type = 'button';
    c.setAttribute('aria-label', rank ? `${rank}. ${m.title}` : m.title);
    tint(c, m.color);
    const art = el('span', 'an-poster');
    art.append(image(m.posterSmall ?? m.poster));
    const t = el('span', 'an-card-title', m.title);
    t.dir = 'auto';
    if (rank) {
      // Top 10: الرقم الكبير المفرّغ يتكئ عليه البوستر من أسفله، والاسم سطرًا تحته
      const row = el('span', 'an-ranked-row');
      row.append(el('span', 'an-rank', String(rank)), art);
      c.append(row, t);
    } else {
      if (rankInline) art.append(el('span', 'an-rank-chip', String(rankInline)));
      c.append(art, t, cardMeta(m));
    }
    c.onclick = () => (onOpen ? onOpen(m) : void openAnime(m));
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

  /** الأنواع بطاقاتٍ بوجه أشهر شخصية في النوع، بلونه الخافت (لا نيون). */
  function genreRail() {
    const s = el('section', 'an-rail an-genres');
    s.dataset.reveal = '';
    const head = el('div', 'an-rail-head');
    const titles = el('div', 'an-rail-titles');
    titles.append(el('h2', null, 'تصفّح حسب النوع'));
    head.append(titles, button('an-more', `<span>الكل</span>${glyph('chevron', { size: 16 })}`, () => openDiscover({})));
    s.append(head, discover.genreStrip());
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

  const HOME_HISTORY = 10;

  function renderHome(data) {
    const blocks = el('div', 'an-home');
    const air = data.week?.length ? airSchedule(data.week) : null;
    if (air) blocks.append(air);
    else if (data.trending?.length) blocks.append(rail('رائج الآن', { items: data.trending.slice(0, 12), card: (m) => posterCard(m), more: () => openCollection({ kind: 'trending' }) }));
    const cont = watching();
    // نفس بطاقة «آخر المشاهدات» في مكتبتي، مصغّرة في شريط، لآخر 10 أعمال: الباقي في «الكل»
    if (cont.length) blocks.append(rail('آخر المشاهدات', { cls: 'an-rail--history', items: cont.slice(0, HOME_HISTORY), card: historyCard, more: () => openLibrary('history') }));
    // «حلقات جديدة» صارت داخل جدول البث (أمس واليوم)؛ تبقى شريطًا فقط لمحفوظ قديم بلا جدول
    if (!air && data.latest?.length) blocks.append(rail('حلقات جديدة', { sub: 'نزلت هذا الأسبوع', cls: 'an-rail--wide', items: data.latest.slice(0, 16), card: episodeCard, more: deps.openUpdates ? () => deps.openUpdates('anime') : undefined }));
    if (data.season?.length) {
      const top = data.season.slice(0, 10);
      blocks.append(rail('Top 10', { sub: `موسم ${data.seasonName}`, cls: 'an-rail--top', items: top, card: (m) => posterCard(m, { rank: top.indexOf(m) + 1 }), more: () => openCollection({ kind: 'season' }) }));
    }
    blocks.append(genreRail());
    if (data.trending?.length) blocks.append(rail('رائج هذا الأسبوع', { items: data.trending, card: (m) => posterCard(m), more: () => openCollection({ kind: 'trending', title: 'رائج هذا الأسبوع' }) }));
    if (data.popular?.length) blocks.append(rail('الأشهر على الإطلاق', { items: data.popular, card: (m) => posterCard(m), more: () => openCollection({ kind: 'popular' }) }));
    if (data.top?.length) blocks.append(rail('الأعلى تقييمًا', { items: data.top, card: (m) => posterCard(m), more: () => openCollection({ kind: 'top' }) }));
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
  // ───────────── صفحة الأنمي ─────────────
  // تُرسم مرة واحدة بهيكلها كاملًا (البطل بارتفاعه، صندوق الشعار، الزر، الأفعال)،
  // ثم يُملأ كل مكان حين يصل ما يخصّه: التفاصيل، الفن، عناوين الحلقات. لا تُعاد
  // الصفحة كلها أبدًا — كانت تومض: الاسم وغلاف فارغ، ثم الغلاف والشعار، ثم تختفي
  // لحظة وتعود. والصور تظهر بعد فكّ ترميزها فقط، تتلاشى إلى مكانها المحجوز.
  //
  // الترتيب من سؤال «ماذا أفعل الآن؟»: الشعار والسطر الهادئ، ثم «تابع الحلقة N»
  // بتقدّمك، ثم الأفعال رموزًا، ثم المصادر سطرًا، فالقصة، فالحلقات (وموعد القادمة
  // في رأسها)، فالشخصيات، فما يشبهه، فالمعلومات.

  const artOf = (m) => (state.art?.id === m?.id ? state.art : null);
  const SOURCE_AR = { ORIGINAL: 'عمل أصلي', MANGA: 'مانجا', LIGHT_NOVEL: 'رواية خفيفة', WEB_NOVEL: 'رواية ويب', NOVEL: 'رواية', VIDEO_GAME: 'لعبة فيديو', VISUAL_NOVEL: 'رواية مرئية', MANHWA: 'مانهوا', ONE_SHOT: 'قصة قصيرة', OTHER: 'أخرى' };

  async function openAnime(m, { episode = null, position = null, clip = null, play = false, focusEpisodes = false } = {}) {
    const token = ++state.detailToken;
    state.episodeRange = 0;
    state.epQuery = '';
    state.detail = m;
    state.malTitles = {};
    if (state.art?.id !== m.id) state.art = null;
    deps.showPage('anime');
    buildWork(m, token);
    // العمل يفتح من أعلاه (البطل ظاهر) أيًّا كان موضع الصفحة السابقة
    window.scrollTo?.({ top: 0, behavior: 'instant' });
    // لقطات الحلقات والشعار وخلفية IMDb من ani.zip: المخبّأ يصل في لحظة، والبطل
    // ينتظره قليلًا فيُختار مرة واحدة (لا بانر يتبدّل بعد ثانية بخلفية أخرى)
    const artReady = loadAnimeArt(m.id).then((art) => {
      if (token !== state.detailToken || !art) return null;
      state.art = { ...art, id: m.id };
      paintLogo(state.detail);
      patchStills(state.detail);
      paintSide(state.detail);
      // لقطات 1920×1080 حين تُطابَق الحلقات بالتاريخ: تحل محل لقطات TVDB الصغيرة بعد تحميلها
      void loadHdStills(art).then((hd) => {
        if (token !== state.detailToken || state.art?.id !== m.id || !Object.keys(hd).length) return;
        state.art = { ...state.art, hd };
        upgradeStills(state.detail);
        paintSide(state.detail);
        // الحلقة أولًا: إن بقي البطل على الغلاف (لا لقطة قبل وصول الدقة العالية) يُرقّى للقطة الآن
        if (state.view?.look === 'episode') paintHero(state.detail);
      });
      // وصل بعد المهلة والغلاف ظاهر: يُرقّى للخلفية الدعائية (لا يمسّ صورة عريضة)
      paintHero(state.detail);
      return art;
    });
    // خلفية ظهرت لهذا العمل من قبل: تُرسم الآن (غالبًا من كاش الصور) بلا انتظار الفن
    if (heroMemory.get(m.id) && state.view?.id === m.id) {
      state.view.artSettled = true;
      paintHero(state.detail ?? m);
    }
    // البطل لا يُرسم قبل أن يستقر ربط IMDb (أو تمضي المهلة): رسمه مبكرًا كان يثبّت
    // بانر AniList قبل وصول الخلفية الدعائية فلا تُستبدل بعده
    void Promise.race([artReady, new Promise((r) => setTimeout(r, 1200))]).then(() => {
      if (token !== state.detailToken) return;
      if (state.view?.id === m.id) state.view.artSettled = true;
      paintHero(state.detail);
    });
    // لمسة أو عجلة أثناء التحميل = المستخدم يتصفّح؛ لا نعيده للأعلى بعدها
    let userScrolled = false;
    const touched = () => (userScrolled = true);
    const INPUT = ['touchstart', 'wheel', 'keydown'];
    for (const ev of INPUT) window.addEventListener?.(ev, touched, { once: true, passive: true });
    const untouch = () => { for (const ev of INPUT) window.removeEventListener?.(ev, touched); };
    try {
      const full = String(m.id).startsWith('addon-') ? await deps.restoreSourceWork(`anime:${m.id}`, m) : m._sourceCopy ? m : await fetchAnimeDetail(m.id);
      if (token !== state.detailToken || !full) return;
      state.detail = full;
      if (full.aired > 0) senseAnime([{ ...full, episode: full.aired }]);
      if (episode) state.episodeRange = Math.floor((episode - 1) / EP_PAGE);
      fillWork(full);
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
      // عناوين الحلقات من MAL: تُكتب في صفوفها، لا تُعاد القائمة
      void fetchMalEpisodes(full.idMal)
        .then(({ titles }) => {
          if (token !== state.detailToken || !Object.keys(titles).length) return;
          state.malTitles = titles;
          patchTitles(full);
        })
        .catch(() => {});
    } catch {
      if (token !== state.detailToken) return;
      const eps = q('animeEpisodes');
      eps?.replaceChildren(el('p', 'an-note', 'تعذّر جلب تفاصيل الأنمي — تحقّق من الاتصال.'));
    } finally {
      untouch();
    }
  }

  /** من أين يكمل زر المشاهدة: الحلقة غير المكتملة الأخيرة، أو التالية لآخر مكتملة. */
  function resumePoint(m) {
    const w = localWatch()[m.id];
    if (!w?.episode) return { episode: 1, resume: false };
    const e = w.episodes?.[w.episode];
    if (e && !e.done) return { episode: w.episode, resume: true, record: e };
    const total = m.aired || m.episodes || w.episode + 1;
    return { episode: Math.min(total, w.episode + 1), resume: true };
  }

  /** موعد بتوقيت مكة بصيغة 12 ساعة: «السبت 6:30 م». */
  const meccaTime = (ts) =>
    new Date(ts).toLocaleString('ar', { timeZone: 'Asia/Riyadh', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' });

  const seenCountOf = (m) => (signedIn() ? account.seenCount(m.id) : Object.values(localWatch()[m.id]?.episodes ?? {}).filter((e) => e?.done).length);

  /** الهيكل الكامل للصفحة بما يُعرف من البطاقة التي لُمست. */
  function buildWork(m, token) {
    closeMenu();
    state.view?.unbind?.();
    const page = q('anime');
    page.style.removeProperty('--art');
    tint(page, m.color);
    const wrap = el('article', 'aw');
    // نمط الصفحة من إعدادات المظهر: الأساسي (الغلاف في النص) أو أحد الأنماط الأربعة
    const look = workStyleOf('anime');
    wrap.dataset.style = look;

    // الترويسة: رجوع، والشعار صغيرًا حين ينطوي البطل، وفي الجهة المقابلة المفضلة ورشّح والمزيد
    // رموزًا بلا كلام. تبقى ظاهرة مع التمرير؛ صلبة متى انطوى البطل (لا محتوى من خلفها)
    const bar = el('header', 'aw-bar');
    bar.innerHTML = iconButton('back', 'رجوع', { act: 'goBack' });
    const barTitle = el('div', 'aw-bar-title');
    const barText = el('span', 'aw-bar-text', m.title);
    barText.dir = 'auto';
    barTitle.append(barText);
    const tools = el('div', 'aw-tools');
    const menu = el('div', 'aw-menu');
    menu.setAttribute('role', 'menu');
    bar.append(barTitle, tools, menu);

    // البنر خلفية عريضة؛ الغلاف في الوسط عند حافته السفلى، واللوقو تحته، ثم المعلومات ولقطة الحلقة
    const hero = el('div', 'aw-hero');
    const bg = el('div', 'aw-bg');
    hero.append(bg, el('div', 'aw-shade'));
    const stage = el('div', 'aw-stage');
    const cover = el('div', 'aw-cover');
    // ضغطة مطوّلة على الاسم أو الشعار: «نسخ» و«مشاركة» (نفس ورقة المانجا، `data-copyable`)
    const mark = el('div', 'an-mark');
    mark.id = 'animeTitleMark';
    mark.dataset.copyable = '';
    const h1 = el('h1', 'an-mark-text', m.title);
    h1.dir = 'auto';
    mark.append(h1);
    const meta = el('div', 'aw-meta');
    const genres = el('div', 'aw-genres');
    const side = el('div', 'aw-side');
    const still = el('div', 'aw-still');
    const cta = el('div', 'aw-cta');
    stage.append(cover, mark, meta, genres, side, still, cta);

    const body = el('div', 'aw-body');
    // المصادر تظهر في ورقة السيرفرات عند التشغيل؛ صفحة العمل لا تعرض حالتها (لا رسائل سلبية هنا)
    const sources = el('div', 'an-sources');
    sources.id = 'animeSources';
    const about = el('section', 'aw-about');
    const insightHost = el('div', 'work-insights');
    insightHost.dataset.ref = `anime:${m.id}`;
    const eps = el('section', 'aw-episodes');
    eps.id = 'animeEpisodes';
    const more = el('div', 'aw-below');
    body.append(about, insightHost, eps, more);
    // الأنماط الأربعة: كل ما تحت البطل يرسمه work-looks.js كما في تصميمه المعتمد؛ عناصر الأساسي
    // تبقى مخفية لأن بقية الصفحة (الحلقات، التشغيل، التحديثات) تعمل عليها
    const lw = look === 'core' ? null : el('div', 'wl');
    if (lw) {
      stage.hidden = true;
      body.hidden = true;
      wrap.append(bar, hero, lw, stage, body);
    } else wrap.append(bar, hero, stage, body);

    state.view = { id: m.id, token, page, wrap, bar, barTitle, tools, menu, hero, bg, stage, mark, meta, genres, cover, side, still, cta, sources, about, insightHost, eps, more, body, look, lw, heroRank: Infinity, heroTried: new Set(), artSettled: false, unbind: null };
    paintCover(m);
    paintMeta(m);
    paintCta(m);
    paintTools(m);
    paintSources(m);
    paintAbout(m, { pending: !m.description });
    eps.append(...Array.from({ length: 3 }, () => el('div', 'an-skel an-skel-ep')));
    paintSide(m);
    page.replaceChildren(wrap);
    paintLogo(m);
    // يبقى مربوطًا حتى يُفتح عمل آخر: الرجوع للصفحة من «الكل» يجدها تنطوي كما تركتها
    const unLook = lw ? bindLookMotion(look, lw, { hero, bg, active: () => deps.currentPage() === 'anime' && state.detailToken === token }) : () => {};
    const unHero = bindCollapsingHero({ hero, bar, layers: lw ? [] : animeDepthLayers({ bg, cover, mark }), active: () => deps.currentPage() === 'anime' && state.detailToken === token });
    state.view.unbind = () => {
      unHero?.();
      unLook();
    };
  }

  /** التفاصيل وصلت: كل مكان يُملأ في موضعه. */
  function fillWork(m) {
    const v = state.view;
    if (!v || v.id !== m.id) return;
    tint(v.page, m.color);
    const h1 = v.mark.querySelector('h1');
    if (h1 && h1.textContent !== m.title) h1.textContent = m.title;
    v.barTitle.querySelector('.aw-bar-text').textContent = m.title;
    paintMeta(m);
    paintCta(m);
    paintCover(m);
    paintSide(m);
    paintTools(m);
    paintAbout(m);
    renderEpisodes(v.eps, m);
    paintBelow(m);
    paintHero(m);
    paintLogo(m);
    if (!String(m.id).startsWith('addon-')) void paintWorkInsights(v.insightHost, { sync: deps.sync, ref: `anime:${m.id}`, openProfile: deps.openProfile });
  }

  /**
   * صورة البطل: يجب أن تعرف العمل منها فورًا. الخلفية الدعائية من IMDb (metahub) إن
   * عُرفت، ثم خلفية TVDB الدعائية (ani.zip)، ثم الغلاف — مضمون لكل أنمي وفيه شخصياته. بانر AniList شريط 1900×400
   * يُقصّ على الجوال إلى منتصفه (سماء «يوميات الصيدلانية» مثلًا) فلا يُستعمل إلا على
   * الشاشة العريضة التي يناسبها شكله. تُختار مرة بعد استقرار ربط IMDb؛ لا تُستبدل إلا
   * لو كانت الغلافَ ووصل ما هو عريض. الصورة تُفكّ قبل أن تظهر ثم تتلاشى فوق لون العمل.
   */
  /**
   * خلفية البطل التي ظهرت فعلًا لكل عمل: الفتح التالي يرسمها فورًا من كاش الصور بدل انتظار
   * سلسلة ani.zip ← AniList ← Cinemeta (ثوانٍ في عمل جديد بلا IMDb) قبل أن يُعرف رابطها.
   */
  const HERO_KEY = 'vantara.heroPick.v1';
  const heroMemory = {
    get(id) {
      try { return JSON.parse(globalThis.localStorage?.getItem(HERO_KEY) ?? '{}')?.[id] ?? null; } catch { return null; }
    },
    set(id, src) {
      try {
        const all = JSON.parse(globalThis.localStorage?.getItem(HERO_KEY) ?? '{}') ?? {};
        if (src) all[id] = src;
        else delete all[id];
        const keys = Object.keys(all);
        for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete all[k];
        globalThis.localStorage?.setItem(HERO_KEY, JSON.stringify(all));
      } catch { /* تخزين محجوب: البطل ينتظر الفن كما كان */ }
    },
  };

  function paintHero(m) {
    const v = state.view;
    if (!v || v.id !== m?.id || !v.artSettled) return;
    const imdb = artOf(m)?.imdb;
    const wide = globalThis.matchMedia?.('(min-width: 900px)').matches === true;
    // الحلقة أولًا: البطل لقطة الحلقة التي ستكملها (1920) متى عُرفت؛ وإلا خلفية العمل كالعادة
    const firstShot = v.look === 'episode' ? episodeStill(m, resumePoint(m).episode, artOf(m), { full: true }) : null;
    if (v.look === 'episode' && !artOf(m) && !v.artSettled) return;
    const known = v.look === 'episode' ? null : heroMemory.get(m.id);
    // كل لقطات الحلقة بالترتيب (1920 ← 780 ← TVDB ← المنصات): رابط محجوب أو معطوب ينتقل للتالي
    // بدل القفز إلى الغلاف المضبّب، وما يصل لاحقًا مع الفن يُجرَّب أيضًا
    const shots = firstShot?.still ? [firstShot.src, ...(firstShot.fallbacks ?? [])] : [];
    const list = [
      ...shots.map((src, i) => ({ src, rank: -2 + i * 0.01 })),
      known ? { src: known, rank: -1 } : null,
      // large مباشرة (البطل يقصّ الصورة ويكبّرها على الجوال فتُخسف medium ‏1280)، صورةً واحدة
      // بلا تبديل لاحق — large في metahub قد تكون لقطة غير medium؛ medium إن تعذّرت
      /^tt\d+$/.test(imdb ?? '') ? { src: `https://images.metahub.space/background/large/${imdb}/img`, rank: 0 } : null,
      /^tt\d+$/.test(imdb ?? '') ? { src: `https://images.metahub.space/background/medium/${imdb}/img`, rank: 0.1 } : null,
      v.seriesBg ? { src: v.seriesBg, rank: 0.3 } : null,
      artOf(m)?.fanart ? { src: artOf(m).fanart, rank: 0.5 } : null,
      m.banner && wide ? { src: m.banner, rank: 1 } : null,
      m.poster ?? m.posterSmall ? { src: m.poster ?? m.posterSmall, rank: 2 } : null,
    ].filter((c) => c && !v.heroTried.has(c.src));
    const pick = list[0];
    if (!pick || pick.rank >= v.heroRank) return;
    // صورة ظاهرة عريضة لا تُستبدل؛ الغلاف الطولي وحده يُرقّى
    if (v.heroShown && v.heroRank < 2) return;
    // في الطريق صورة أفضل: الحالية تبقى حتى تحل محلها بتلاشٍ، لا فراغ بينهما
    v.heroRank = pick.rank;
    v.heroTried.add(pick.src);
    const img = new Image();
    img.alt = '';
    img.className = `aw-bg-img${pick.rank === 2 ? ' aw-bg-img--poster' : ''}`;
    img.decoding = 'async';
    const show = () => {
      if (state.view !== v) return;
      v.bg.append(img);
      // نسخة مضبّبة ثابتة خلف البنر: حين ينطوي بالعمق تملأ الأطراف بألوانه هو لا بفراغ
      v.bg.parentElement?.style.setProperty('--aw-amb', `url(${JSON.stringify(pick.src)})`);
      // تظهر تدريجيًا مع الصورة لا دفعة واحدة
      requestAnimationFrame(() => v.hero.classList.add('amb'));
      v.heroShown = true;
      // المشغّل يعرض الخلفية نفسها في شاشة التحميل (لا الغلاف الطولي)
      v.heroSrc = pick.rank < 2 ? pick.src : null;
      if (pick.rank < 1 && pick.rank > -1.5) heroMemory.set(m.id, pick.src);
      // ارتفاع البطل من شكل صورته نفسها (لا قص)، بين حدين في CSS
      if (pick.rank < 2 && img.naturalWidth && img.naturalHeight) v.hero.style.setProperty('--aw-ratio', `${img.naturalWidth} / ${img.naturalHeight}`);
      requestAnimationFrame(() => {
        img.classList.add('in');
        // ما تحتها يُزال بعد أن تغطيه
        setTimeout(() => { for (const old of [...v.bg.querySelectorAll('.aw-bg-img')]) if (old !== img) old.remove(); }, 600);
      });
    };
    img.onload = () => (img.decode ? img.decode().catch(() => {}).then(show) : show());
    img.onerror = () => {
      if (pick.rank === -1) heroMemory.set(m.id, null);
      if (state.view !== v) return;
      v.heroRank = Infinity;
      if (v.heroShown) return;
      // للعمل IMDb بلا خلفية (فيلم جديد مثلًا): خلفية السلسلة الأم قبل الغلاف
      if (pick.rank === 0.1 && !v.seriesTried) {
        v.seriesTried = true;
        void seriesBackdrop(state.detail ?? m).then((src) => {
          if (state.view !== v) return;
          if (src) v.seriesBg = src;
          paintHero(state.detail);
        });
        return;
      }
      paintHero(state.detail);
    };
    img.src = pick.src;
  }

  /** خلفية metahub لأقرب عمل أم/جزء سابق/نسخة أخرى له IMDb غير IMDb العمل (مهلة قصيرة). */
  async function seriesBackdrop(m) {
    const own = artOf(m)?.imdb;
    const order = [RELATION_AR.PARENT, RELATION_AR.PREQUEL, RELATION_AR.ALTERNATIVE];
    const ups = order.flatMap((label) => (m?.relations ?? []).filter((r) => r.relation === label));
    for (const r of ups) {
      const art = await Promise.race([loadAnimeArt(r.id), new Promise((res) => setTimeout(() => res(null), 1500))]);
      if (/^tt\d+$/.test(art?.imdb ?? '') && art.imdb !== own) return `https://images.metahub.space/background/medium/${art.imdb}/img`;
    }
    return null;
  }

  /** شعار العنوان (IMDb ← metahub) في صندوقه المحجوز، ونسخة صغيرة للترويسة. */
  function paintLogo(m) {
    const v = state.view;
    const src = artOf(m)?.logo;
    if (!v || v.id !== m?.id || !src || v.mark.querySelector('.an-mark-logo')) return;
    const logo = new Image();
    logo.alt = m.title;
    logo.className = 'an-mark-logo';
    logo.decoding = 'async';
    logo.onload = () => {
      const ready = () => {
        logo.classList.add('loaded');
        v.mark.classList.add('has-logo');
        const small = new Image();
        small.alt = '';
        small.className = 'aw-bar-logo';
        small.src = logo.src;
        v.barTitle.prepend(small);
        v.barTitle.classList.add('has-logo');
      };
      logo.decode ? logo.decode().catch(() => {}).then(ready) : ready();
    };
    logo.onerror = () => logo.remove();
    logo.src = src;
    v.mark.prepend(logo);
  }

  /** الغلاف قطعة مستقلة (لا يُدمج مع البنر). بلا غلاف: يختفي ويعيد التكوين ترتيب نفسه. */
  function paintCover(m) {
    const v = state.view;
    const src = m?.poster ?? m?.posterSmall ?? null;
    if (!v || v.id !== m?.id) return;
    v.wrap.classList.toggle('no-cover', !src);
    if (!src || v.cover.dataset.src === src) return;
    v.cover.dataset.src = src;
    // غلاف القائمة ظاهر ووصل الأكبر من التفاصيل: يُحمَّل ثم يحل محله، لا يختفي ويعود
    const shown = v.cover.querySelector('.an-img.loaded');
    if (shown) return swapWhenReady(shown, src, { position: 'center 20%' });
    v.cover.replaceChildren(image(src, 'an-img', { eager: true, position: 'center 20%' }));
  }

  /**
   * موعد الحلقة القادمة إن كان العمل يُعرض، ولقطة الحلقة التي ستشاهدها. لا يُخترع شيء لملء
   * المكان: بلا موعد يختفي السطر، وعمل لم يُعرض بعد يبقى له زر «يبدأ…» وحده بلا لقطة.
   * الضغط على زر التشغيل وحده يشغّل؛ لمسة الصورة تنبّه للزر فقط، فلا تشغيل بالغلط.
   */
  function paintSide(m) {
    const v = state.view;
    if (!v || v.id !== m?.id) return;
    if (v.lw) paintLook(m);
    const next = m.next?.at && m.next.at > Date.now() ? m.next : null;
    v.side.replaceChildren();
    if (next) {
      const line = el('span', 'aw-next');
      line.append(el('b', null, `الحلقة ${next.episode ?? ''}`.trim()), el('span', null, meccaTime(next.at)));
      v.side.append(line);
    }
    v.side.hidden = !next;
    const aired = m.aired || (m.status === 'FINISHED' ? m.episodes : 0) || 0;
    const upcoming = m.status === 'NOT_YET_RELEASED' && !aired;
    v.still.hidden = upcoming;
    if (upcoming) return v.still.replaceChildren();
    const point = resumePoint(m);
    const shot = episodeStill(m, point.episode, artOf(m), { full: true });
    const title = episodeTitleOf(m, point.episode, { mal: state.malTitles, art: artOf(m) });
    // الصورة الظاهرة تبقى بين إعادات الرسم (وصول الفن ثم الدقة الأعلى): تُستبدل بعد تحميل البديل
    // لا تُعاد من الصفر، فلا تختفي وتعود
    const prev = v.still.querySelector(':scope > .an-img');
    v.still.replaceChildren();
    if (shot?.src) {
      const opts = { eager: true, position: shot.still ? 'center' : 'center 22%', fallback: [...(shot.fallbacks ?? []), m.poster ?? null] };
      if (prev && !prev.classList.contains('failed')) {
        v.still.append(prev);
        swapWhenReady(prev, shot.src, opts, () => v.still.classList.toggle('aw-still--cover', !shot.still));
      } else {
        const img = image(shot.src, 'an-img', opts);
        img.dataset.want = shot.src;
        v.still.append(img);
        v.still.classList.toggle('aw-still--cover', !shot.still);
      }
    }
    const label = `${point.resume ? 'تابع' : 'شاهد'} الحلقة ${point.episode}`;
    const play = button('aw-still-play', glyph('play', { size: 22, filled: true }), () => playEpisode(m, point.episode), label);
    const cap = el('span', 'aw-still-cap');
    cap.append(play, el('b', null, label));
    if (title && typeof title === 'string') {
      const t = el('span', 'aw-still-title', title);
      t.dir = 'auto';
      cap.append(t);
    }
    v.still.append(cap);
    v.still.onclick = (e) => {
      if (e.target.closest('.aw-still-play')) return;
      play.classList.remove('nudge');
      void play.offsetWidth;
      play.classList.add('nudge');
    };
  }

  /** تقدّم الحلقة المحفوظ (0..1) أو null. */
  const progressOf = (point) => {
    const r = point.record;
    return r?.duration > 0 ? Math.min(1, Math.max(0, r.position / r.duration)) : null;
  };

  /** سحب الشريط جانبًا أكثر من ثلث عرضه يُخفيه حتى تُفتح الصفحة من جديد؛ أقل من ذلك يرجع مكانه. */
  function bindDockSwipe(dock) {
    let x0 = null;
    let dx = 0;
    dock.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      x0 = e.clientX;
      dx = 0;
      dock.style.transition = 'none';
      // الإصبع يبقى للشريط حتى لو خرج منه أثناء السحب
      dock.setPointerCapture?.(e.pointerId);
    });
    dock.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      dx = e.clientX - x0;
      dock.style.transform = `translateX(${dx}px)`;
      dock.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / dock.offsetWidth));
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null;
      dock.style.transition = '';
      if (Math.abs(dx) > dock.offsetWidth / 3) {
        dock.style.transform = `translateX(${Math.sign(dx) * dock.offsetWidth * 1.2}px)`;
        dock.style.opacity = '0';
        if (state.view) state.view.dockGone = true;
        setTimeout(() => { if (state.view?.dockGone) dock.hidden = true; }, 260);
      } else {
        dock.style.transform = '';
        dock.style.opacity = '';
      }
    };
    dock.addEventListener('pointerup', end);
    dock.addEventListener('pointercancel', end);
  }

  /** يجمع ما يعرضه النمط من بيانات العمل ويرسمه (عند الفتح، ووصول التفاصيل والفن والصور الأعلى دقة). */
  function paintLook(m) {
    const v = state.view;
    if (!v?.lw) return;
    const art = artOf(m);
    const point = resumePoint(m);
    const aired = m.aired || (m.status === 'FINISHED' ? m.episodes : 0) || 0;
    const total = aired || m.episodes || point.episode;
    const rec = epRecord(m, point.episode);
    const ratio = !rec.done && rec.duration > 0 ? Math.min(1, rec.position / rec.duration) : null;
    const left = ratio != null ? Math.max(1, Math.round((rec.duration - rec.position) / 60_000)) : null;
    const seen = seenCountOf(m);
    const label = `${point.resume ? 'تابع' : 'شاهد'} الحلقة ${point.episode}`;
    const minutes = (n) => {
      const d = art?.episodes?.[String(n)]?.runtime || m.duration;
      return d ? `${d} د` : '';
    };
    const facts = [
      ['الاستوديو', m.studio],
      ['المصدر', SOURCE_AR[m.source]],
      ['الموسم', m.season && m.year ? `${SEASON_AR[m.season]} ${m.year}` : m.year],
      ['المدة', m.duration ? `${m.duration} دقيقة` : null],
      ['الحلقات', m.episodes ? String(m.episodes) : null],
    ].filter(([, val]) => val);
    const byId = new Map([...(m.relations ?? []), ...(m.world ?? []).filter((w) => w.kind === 'anime'), ...(m.recommendations ?? [])].map((r) => [String(r.id), r]));
    const shown = Math.max(1, Math.min(total, 25));
    const ctx = {
      m,
      glyph,
      logo: art?.logo ?? null,
      meta: [
        FORMAT_AR[m.format],
        m.season && m.year ? `${SEASON_AR[m.season]} ${m.year}` : m.year,
        m.score ? { html: `★ <b>${m.score.toFixed(1)}</b>` } : null,
        m.episodes ? `${m.episodes} حلقة` : null,
        STATUS_AR[m.status],
      ].filter(Boolean),
      genres: (m.genres ?? []).slice(0, 4).map(genreAr),
      facts,
      point,
      label,
      total,
      ratio,
      left,
      seenRatio: total ? Math.min(1, seen / total) : 0,
      progressText: `شاهدت ${seen} من ${m.episodes || aired || '؟'}`,
      lineDone: Math.min(100, ((Math.min(seen, shown) + 0.5) / shown) * 100).toFixed(1),
      characters: m.characters ?? [],
      // عدد التوصيات الظاهر في كل نمط كما في تصميمه (الجوال / العريض)؛ الباقي خلف «الكل»
      recsCap: ({ platform: [9, 10], card: [9, 8], screen: [9, 8], episode: [9, 10] }[v.look] ?? [9, 9])[v.wrap.clientWidth >= 900 ? 1 : 0],
      heroSrc: v.heroSrc ?? null,
      rangeAt: v.lwRange ?? null,
      epTitle: (n) => {
        const t = episodeTitleOf(m, n, { mal: state.malTitles, art });
        return typeof t === 'string' ? t : null;
      },
      epOverview: (n) => art?.episodes?.[String(n)]?.overview ?? null,
      still: (n, full = false) => episodeStill(m, n, art, { full }),
      seen: (n) => epRecord(m, n).done,
      minutes,
      play: (n) => playEpisode(m, n),
      open: (id) => {
        const r = byId.get(String(id));
        if (r) void openAnime(r);
      },
      onRange: (i) => {
        v.lwRange = i;
        v.lwCenter = true;
        paintLook(m);
      },
    };
    // لا رسم من جديد إن لم يتغيّر ما يُعرض (وصول نفس البيانات، أو تقدّم لم يتغيّر)
    const sig = JSON.stringify([v.look, point, total, ratio, seen, art ? Object.keys(art.episodes ?? {}).length : 0, art?.logo, art?.hd ? Object.keys(art.hd).length : 0, v.heroSrc, v.lwRange, m.description?.length, m.characters?.length, m.recommendations?.length, m.world?.length ?? m.relations?.length, ctx.recsCap, state.malTitles ? Object.keys(state.malTitles).length : 0]);
    if (sig === v.lwSig) return;
    v.lwSig = sig;
    renderLook(v.look, v.lw, ctx, { center: v.lwCenter !== false });
    v.lwCenter = false;
    const dock = v.lw.querySelector('.wl-dock');
    if (dock) {
      dock.hidden = v.dockGone === true;
      bindDockSwipe(dock);
    }
  }

  /** سطر واحد هادئ: النوع · الموسم · ★ · الاستوديو · الحالة. وتحته الأنواع روابطَ. */
  function paintMeta(m) {
    const v = state.view;
    if (!v) return;
    const parts = [];
    const add = (text, cls) => {
      if (!text) return;
      const s = el('span', cls ?? null, String(text));
      s.dir = 'auto';
      parts.push(s);
    };
    add(FORMAT_AR[m.format]);
    add(m.season && m.year ? `${SEASON_AR[m.season]} ${m.year}` : m.year);
    if (m.score) {
      const s = el('span', 'aw-score');
      s.innerHTML = `${glyph('star', { size: 12, filled: true })}<b>${m.score.toFixed(1)}</b>`;
      parts.push(s);
    }
    // عدد الحلقات بدل الاستوديو (الاستوديو في «معلومات» أسفل الصفحة)
    add(m.episodes ? `${m.episodes} حلقة` : null);
    if (m.status) add(STATUS_AR[m.status], `aw-status aw-status--${String(m.status).toLowerCase()}`);
    // الفواصل عناصر بين الأجزاء لا ‎::before‎: جزء لاتيني (الاستوديو، التقييم) لا يقلب موضعها
    v.meta.replaceChildren(...parts.flatMap((part, i) => (i ? [el('i', 'aw-sep', '·'), part] : [part])));
    v.genres.replaceChildren();
    (m.genres ?? []).slice(0, 4).forEach((g, i) => {
      if (i) v.genres.append(el('i', 'aw-sep', '·'));
      v.genres.append(button('aw-genre', genreAr(g), () => openCollection({ kind: 'genre', genre: g })));
    });
  }

  /** «تابع الحلقة N» بتقدّمك الحقيقي، وتحته شريط رفيع وسطر: كم باقي، أو كم شاهدت. */
  function paintCta(m) {
    const v = state.view;
    if (!v || v.id !== m.id) return;
    if (v.lw) paintLook(m);
    const point = resumePoint(m);
    const aired = m.aired || (m.status === 'FINISHED' ? m.episodes : 0) || 0;
    const upcoming = m.status === 'NOT_YET_RELEASED' && !aired;
    const label = upcoming ? (m.next ? `يبدأ ${relativeAr(m.next.at)}` : 'لم يُعرض بعد') : `${point.resume ? 'تابع' : 'شاهد'} الحلقة ${point.episode}`;
    const main = button(`aw-play${upcoming ? ' aw-play--soon' : ''}`, `${glyph(upcoming ? 'clock' : 'play', { size: 20, filled: !upcoming })}<span>${label}</span>`, () => {
      if (upcoming) return toast(m.next ? `أول حلقة ${meccaTime(m.next.at)}` : 'لم يُحدَّد موعد العرض بعد');
      playEpisode(m, point.episode);
    });
    const line = el('div', 'aw-progress');
    const rec = point.record;
    const seen = seenCountOf(m);
    let ratio = 0;
    let text = '';
    if (rec?.duration && rec.position > 0) {
      ratio = Math.min(1, rec.position / rec.duration);
      text = [minutesLeft(rec), aired ? `شاهدت ${seen} من ${aired}` : null].filter(Boolean).join(' · ');
    } else if (seen && aired) {
      ratio = Math.min(1, seen / aired);
      text = seen >= aired ? `شاهدت كل الحلقات المعروضة (${aired})` : `شاهدت ${seen} من ${aired}`;
    }
    if (text) {
      line.append(progress(ratio), el('span', null, text));
    }
    v.cta.replaceChildren(main, line);
  }

  /**
   * أدوات الترويسة: المفضلة ورشّح رمزين بلا كلام، و«المزيد» نقاطًا ثلاثًا تفتح دوائر تحت
   * بعضها (أتابعها، لاحقًا، علّم حلقات، أفضل 5) كل واحدة باسمها الصغير. الحالة المفعّلة بلون القسم.
   */
  function paintTools(m) {
    const v = state.view;
    if (!v) return;
    const work = () => state.detail ?? m;
    const tool = (icon, label, onClick, { pressed, filled } = {}) => {
      const b = button('aw-tool', glyph(icon, { size: 21, filled: Boolean(filled) }), onClick, label);
      if (pressed !== undefined) b.setAttribute('aria-pressed', String(Boolean(pressed)));
      return b;
    };
    const items = [];
    if (signedIn()) {
      const fav = Boolean(account?.inCollection('favorite', m.id));
      items.push(tool('heart', fav ? 'في المفضلة' : 'المفضلة', () => {
        const now = !account?.inCollection('favorite', m.id);
        account?.setCollection('favorite', work(), now);
        paintTools(m);
        pop(v.tools.querySelector('.aw-tool'));
        toast(now ? 'في المفضلة' : 'أُزيل من المفضلة');
      }, { pressed: fav, filled: fav }));
    }
    items.push(tool(deps.share ? 'send' : 'share', deps.share ? 'رشّح' : 'شارك', () => shareCurrent()));
    const moreBtn = tool('more', 'المزيد', () => toggleMenu());
    moreBtn.setAttribute('aria-haspopup', 'menu');
    moreBtn.setAttribute('aria-expanded', String(v.menu.classList.contains('open')));
    items.push(moreBtn);
    v.tools.replaceChildren(...items);
    paintMenu(m);
  }

  function paintMenu(m) {
    const v = state.view;
    if (!v) return;
    const work = () => state.detail ?? m;
    const entry = (icon, label, onClick, { pressed = false } = {}) => {
      const b = button('aw-menu-item', `<span class="aw-menu-dot">${glyph(icon, { size: 20 })}</span><span class="aw-menu-label">${label}</span>`, () => {
        onClick();
      }, label);
      b.setAttribute('role', 'menuitem');
      if (pressed) b.setAttribute('aria-pressed', 'true');
      return b;
    };
    const rows = [];
    const listName = signedIn() ? 'أتابعها' : 'قائمتي';
    const inMine = inList(m.id);
    rows.push(entry(inMine ? 'check' : 'plus', listName, () => {
      const now = toggleList(work());
      paintMenu(m);
      toast(now ? `أُضيف إلى ${listName}` : `أُزيل من ${listName}`);
    }, { pressed: inMine }));
    if (signedIn()) {
      const later = Boolean(account?.inCollection('read_later', m.id));
      rows.push(entry(later ? 'check' : 'clock', 'لاحقًا', () => {
        const now = !account?.inCollection('read_later', m.id);
        account?.setCollection('read_later', work(), now);
        paintMenu(m);
        toast(now ? 'في «شاهد لاحقًا»' : 'أُزيل من «شاهد لاحقًا»');
      }, { pressed: later }));
      const w = work();
      const total = w.aired || w.episodes || 0;
      if (total) rows.push(entry('eye', 'علّم حلقات', () => { closeMenu(); openMarkSheet(w, total); }));
    }
    if (deps.openWorkMenu) rows.push(entry('star', 'أفضل 5', () => {
      closeMenu();
      deps.openWorkMenu({ ref: `anime:${m.id}`, title: work().title, cover: m.posterSmall ?? m.poster ?? null });
    }));
    rows.forEach((r, i) => r.style.setProperty('--i', String(i)));
    v.menu.replaceChildren(...rows);
  }

  function toggleMenu(force) {
    const v = state.view;
    if (!v) return;
    const open = force ?? !v.menu.classList.contains('open');
    v.menu.classList.toggle('open', open);
    v.tools.querySelector('[aria-haspopup]')?.setAttribute('aria-expanded', String(open));
    if (!open) return;
    // لمسة خارج القائمة أو Esc تغلقها
    const away = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && (v.menu.contains(e.target) || v.tools.contains(e.target))) return;
      closeMenu();
    };
    v.menuAway = away;
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', away, true);
  }
  function closeMenu() {
    const v = state.view;
    if (!v) return;
    v.menu.classList.remove('open');
    v.tools.querySelector('[aria-haspopup]')?.setAttribute('aria-expanded', 'false');
    if (v.menuAway) {
      document.removeEventListener('pointerdown', v.menuAway, true);
      document.removeEventListener('keydown', v.menuAway, true);
      v.menuAway = null;
    }
  }

  /** القصة: ثلاثة أسطر، بخط أصغر واتجاهها من نصّها، و«المزيد» إن كان أطول. */
  function paintAbout(m, { pending = false } = {}) {
    const v = state.view;
    if (!v) return;
    if (pending) {
      v.about.replaceChildren(el('span', 'an-skel an-skel-text'));
      return;
    }
    if (!m.description) {
      v.about.replaceChildren();
      v.about.hidden = true;
      return;
    }
    v.about.hidden = false;
    const p = el('p', 'an-synopsis clamped', m.description);
    p.dir = 'auto';
    const more = button('aw-link', 'المزيد', () => {
      const closed = p.classList.toggle('clamped');
      more.textContent = closed ? 'المزيد' : 'أقل';
    });
    more.hidden = true;
    v.about.replaceChildren(p, more);
    requestAnimationFrame(() => {
      if (p.scrollHeight > p.clientHeight + 2) more.hidden = false;
    });
  }

  /** تحت الحلقات: الشخصيات، ما يكمل القصة، «إذا عجبك هذا»، والمعلومات. */
  function paintBelow(m) {
    const v = state.view;
    if (!v) return;
    const blocks = [];
    if (m.characters?.length) {
      const s = el('section', 'aw-cast');
      s.dataset.reveal = '';
      const head = el('div', 'an-rail-head');
      head.append(el('h2', null, 'الشخصيات'));
      const strip = el('div', 'an-strip aw-cast-strip');
      for (const c of m.characters.slice(0, 16)) {
        const p = el('div', 'aw-person');
        const face = el('span', 'aw-face');
        face.append(image(c.image, 'an-img', { position: 'center 20%' }));
        const name = el('span', 'aw-person-name', c.name);
        name.dir = 'auto';
        p.append(face, name);
        if (c.voice) {
          const va = el('span', 'aw-person-va', c.voice);
          va.dir = 'auto';
          p.append(va);
        }
        strip.append(p);
      }
      s.append(head, strip);
      blocks.push(s);
    }
    const others = (m.relations ?? []).filter((r) => r.relation !== 'الجزء السابق' && r.relation !== 'الجزء التالي');
    const world = [...(m.relations ?? []).filter((r) => r.relation === 'الجزء السابق' || r.relation === 'الجزء التالي'), ...others];
    if (world.length) blocks.push(rail('من نفس العالم', { items: world, card: (r) => posterCard(r) }));
    if (m.recommendations?.length) blocks.push(rail('إذا عجبك هذا', { items: m.recommendations, card: (r) => posterCard(r) }));
    const facts = [
      ['الاستوديو', m.studio],
      ['الأصل', SOURCE_AR[m.source]],
      ['العرض', [m.start?.year ? [m.start.day, m.start.month ? MONTHS_AR[m.start.month - 1] : null, m.start.year].filter(Boolean).join(' ') : null, STATUS_AR[m.status]].filter(Boolean).join(' · ')],
      ['الحلقات', m.episodes ? `${m.episodes}${m.duration ? ` × ${m.duration} دقيقة` : ''}` : null],
      ['أسماء أخرى', [m.romaji !== m.title ? m.romaji : null, m.native].filter(Boolean).join(' · ')],
    ].filter(([, val]) => val);
    if (facts.length) {
      const s = el('section', 'aw-info');
      s.dataset.reveal = '';
      s.append(el('h2', null, 'معلومات'));
      const dl = el('dl');
      for (const [k, val] of facts) {
        const dd = el('dd', null, val);
        dd.dir = 'auto';
        dl.append(el('dt', null, k), dd);
      }
      s.append(dl);
      blocks.push(s);
    }
    v.more.replaceChildren(...blocks);
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
  const epRecord = (m, n) => {
    const e = localWatch()[m.id]?.episodes?.[n];
    return { position: 0, duration: 0, ...(e ?? {}), done: seenEp(m, n, e) };
  };

  // ───────────── الحلقات ─────────────
  // صف لكل حلقة: لقطتها 16:9 برقم صغير، عنوان سطر واحد، مدتها أو كم باقي، وشريط
  // رفيع على اللقطة. «شوهدت» علامة ✓ هادئة آخر الصف (لا مربع خلفها، ولا تعتيم للصف).
  // ضغطة مطوّلة: قائمة الحلقة. تبديل «شوهدت» يحدّث صفه وحده.

  const EP_PAGE = 50;

  /** ضغطة مطوّلة (لمس أو زر الفأرة الأيمن) بلا أن تصير لمسة تشغيل بعدها. */
  function bindLongPress(node, run) {
    let timer = null;
    let x = 0;
    let y = 0;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
    };
    node.addEventListener('pointerdown', (e) => {
      node._held = false;
      x = e.clientX;
      y = e.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        node._held = true;
        run();
      }, 480);
    });
    node.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 8) cancel();
    });
    for (const k of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(k, cancel);
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (node._held) return;
      node._held = true;
      run();
    });
  }

  function episodeRow(m, n) {
    const row = el('div', 'an-er');
    row.dataset.ep = String(n);
    const main = el('button', 'an-er-main');
    main.type = 'button';
    const shot = episodeStill(m, n, artOf(m));
    const cover = m.poster ?? m.banner ?? null;
    const art = el('span', `an-er-art${shot.still ? '' : ' an-er-art--cover'}`);
    art.append(image(shot.src, 'an-img', { position: shot.still ? 'center' : 'center 22%', fallback: shot.still ? [...shot.fallbacks, cover] : null }));
    const chip = el('span', 'an-er-chip');
    chip.innerHTML = glyph('play', { size: 9, filled: true });
    chip.append(el('b', null, String(n)));
    art.append(chip);
    const copy = el('span', 'an-er-copy');
    const title = episodeTitleOf(m, n, { mal: state.malTitles, art: artOf(m) });
    const name = el('b', 'an-er-title', title || `الحلقة ${n}`);
    name.dir = 'auto';
    copy.append(name, el('span', 'an-er-sub'));
    main.append(art, copy);
    main.onclick = () => {
      if (main._held) {
        main._held = false;
        return;
      }
      playEpisode(m, n);
    };
    bindLongPress(main, () => openEpisodeMenu(m, n));
    const mark = button('an-er-icon', '', () => toggleSeen(m, n));
    row.append(main, mark);
    paintRow(row, m, n);
    return row;
  }

  /** حالة الصف وحدها (شوهدت، التقدّم، السطر الثاني) بلا إعادة رسمه. */
  function paintRow(row, m, n) {
    const e = epRecord(m, n);
    const ratio = e.duration ? Math.min(1, e.position / e.duration) : 0;
    const watching = ratio > 0 && !e.done;
    row.classList.toggle('seen', e.done);
    row.classList.toggle('watching', watching);
    const art = row.querySelector('.an-er-art');
    let bar = art.querySelector('.an-er-bar');
    if (watching) {
      if (!bar) {
        bar = progress(ratio);
        bar.classList.add('an-er-bar');
        art.append(bar);
      } else bar.firstElementChild.style.width = `${(ratio * 100).toFixed(1)}%`;
    } else bar?.remove();
    row.querySelector('.an-er-sub').textContent = e.done ? (m.duration ? `${m.duration} د` : '') : minutesLeft(e) ?? (m.duration ? `${m.duration} د` : '');
    const icon = row.querySelector('.an-er-icon');
    // لم تُشاهد: حلقة رفيعة فارغة؛ شوهدت: ✓ بلون القسم (لا مربع خلفها)
    if (icon.dataset.on !== String(e.done)) {
      icon.dataset.on = String(e.done);
      icon.innerHTML = e.done ? glyph('check', { size: 18 }) : '<span class="an-er-ring"></span>';
    }
    icon.setAttribute('aria-pressed', String(e.done));
    icon.setAttribute('aria-label', e.done ? `ألغِ «شوهدت» للحلقة ${n}` : `علّم الحلقة ${n} شوهدت`);
  }

  const rowOf = (n) => state.view?.eps.querySelector(`.an-er[data-ep="${n}"]`);
  function repaintRows(m) {
    for (const row of state.view?.eps.querySelectorAll('.an-er') ?? []) paintRow(row, m, Number(row.dataset.ep));
    paintCta(m);
    paintEpisodeHead(m);
  }

  function toggleSeen(m, n) {
    const on = !epRecord(m, n).done;
    setSeen(m, n, on);
    account?.markEpisode(m, n, on);
    const row = rowOf(n);
    if (row) {
      paintRow(row, m, n);
      pop(row.querySelector('.an-er-icon'));
      if (on && state.hideSeen) {
        row.classList.add('leaving');
        setTimeout(() => row.remove(), 320);
      }
    }
    paintCta(m);
    paintEpisodeHead(m);
  }

  /** كل ما قبل الحلقة (وهي) شوهد: لمن بدأ يتابع من منتصفه. */
  function markUpTo(m, n) {
    for (let k = 1; k <= n; k++) setSeen(m, k, true);
    if (signedIn()) account.markRange(m, 1, n, true);
    repaintRows(m);
    toast(`عُلّمت الحلقات 1–${n} شوهدت`);
  }

  /** قائمة الحلقة (ضغطة مطوّلة): شغّل، شوهدت، كل ما قبلها، ومن ← إلى. */
  function openEpisodeMenu(m, n) {
    const e = epRecord(m, n);
    const title = episodeTitleOf(m, n, { mal: state.malTitles, art: artOf(m) });
    deps.openSheet((body) => {
      const head = el('div', 'an-sheet-head');
      const t = el('div', 'an-sheet-title', title || m.title);
      t.dir = 'auto';
      head.append(el('div', 'an-sheet-kicker', `الحلقة ${n}`), t);
      const item = (icon, label, run, { pressed } = {}) => {
        const b = el('button', 'sheet-item');
        b.type = 'button';
        b.innerHTML = glyph(icon, { filled: icon === 'play' });
        b.append(el('span', null, label));
        if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
        b.onclick = () => {
          deps.closeSheet();
          run();
        };
        return b;
      };
      body.append(
        head,
        item('play', e.position > 5000 && !e.done ? 'تابع المشاهدة' : 'شغّل الحلقة', () => playEpisode(m, n)),
        item('check', e.done ? 'ألغِ «شوهدت»' : 'علّمها شوهدت', () => toggleSeen(m, n), { pressed: e.done }),
      );
      if (n > 1) body.append(item('layers', `شاهدت كل ما قبلها (1–${n})`, () => markUpTo(m, n)));
      if (signedIn()) body.append(item('eye', 'علّم حلقات: من ← إلى', () => openMarkSheet(m, m.aired || m.episodes || n)));
    }, { tone: 'anime' });
  }

  /** رأس الحلقات: العدد، وموعد القادمة بتوقيت مكة لما يُعرض. */
  function paintEpisodeHead(m) {
    const sub = state.view?.eps.querySelector('.aw-eps-sub');
    if (!sub) return;
    const total = m.aired || m.episodes || 0;
    const seen = seenCountOf(m);
    const lines = [];
    if (m.status === 'RELEASING' && m.next) {
      lines.push(`${total}${m.episodes ? ` من ${m.episodes}` : ''} حلقة`);
      const live = el('span', 'aw-next');
      live.textContent = `الحلقة ${m.next.episode} ${relativeAr(m.next.at)} · ${meccaTime(m.next.at)}`;
      sub.replaceChildren(document.createTextNode(lines.join(' · ')), live);
      return;
    }
    if (m.status === 'NOT_YET_RELEASED') {
      sub.textContent = m.next ? `يبدأ ${relativeAr(m.next.at)} · ${meccaTime(m.next.at)}` : m.season && m.year ? `يبدأ ${SEASON_AR[m.season]} ${m.year}` : 'لم يُحدَّد موعده';
      return;
    }
    if (total) lines.push(`${total} حلقة`);
    if (m.duration) lines.push(`${m.duration} دقيقة`);
    if (seen) lines.push(`شاهدت ${seen}`);
    sub.textContent = lines.join(' · ') || 'لم تُعرض بعد';
  }

  function renderEpisodes(host, m) {
    const total = m.aired || m.episodes || 0;
    const head = el('div', 'aw-eps-head');
    const titles = el('div', 'aw-eps-titles');
    titles.append(el('h2', null, 'الحلقات'), el('span', 'aw-eps-sub'));
    head.append(titles);
    host.replaceChildren(head);
    paintEpisodeHead(m);
    if (!total) return;
    // البحث رمزًا ينفتح سطرًا، والترتيب والتصفية في قائمة واحدة
    const tools = el('div', 'aw-eps-tools');
    const find = el('form', 'aw-find');
    find.hidden = !state.epQuery;
    find.innerHTML = `${glyph('search', { size: 18 })}<input type="search" enterkeyhint="search" autocomplete="off" placeholder="رقم الحلقة أو اسمها" aria-label="ابحث في الحلقات">`;
    const input = find.querySelector('input');
    input.value = state.epQuery ?? '';
    let t = null;
    input.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const value = input.value.trim();
        if (/^\d+$/.test(value)) return jumpTo(Number(value));
        state.epQuery = value;
        paintEpisodeList(m);
      }, 220);
    };
    find.onsubmit = (ev) => {
      ev.preventDefault();
      input.blur();
    };
    const close = button('icon-btn aw-find-close', glyph('close', { size: 18 }), () => {
      state.epQuery = '';
      find.hidden = true;
      searchBtn.setAttribute('aria-expanded', 'false');
      paintEpisodeList(m);
    }, 'أغلق البحث');
    find.append(close);
    const searchBtn = button('icon-btn', glyph('search', { size: 20 }), () => {
      const open = find.hidden;
      find.hidden = !open;
      searchBtn.setAttribute('aria-expanded', String(open));
      if (open) setTimeout(() => input.focus(), 30);
    }, 'ابحث في الحلقات');
    const menuBtn = button('icon-btn', glyph('sliders', { size: 20 }), () => openEpisodeTools(m), 'الترتيب والتصفية');
    tools.append(searchBtn, menuBtn);
    head.append(tools);
    host.append(find);
    const seasons = seasonsStrip(m);
    if (seasons) host.append(seasons);
    const ranges = el('div', 'aw-ranges');
    host.append(ranges);
    const list = el('div', 'an-er-list');
    host.append(list);

    const jumpTo = (n) => {
      const k = Math.max(1, Math.min(total, n));
      state.epQuery = '';
      state.episodeRange = Math.floor((k - 1) / EP_PAGE);
      paintEpisodeList(m);
      const target = rowOf(k);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target?.classList.add('flash');
      setTimeout(() => target?.classList.remove('flash'), 2200);
    };
    paintEpisodeList(m);
  }

  /** صفوف الحلقات بحسب المدى والبحث والترتيب و«أخفِ ما شاهدته». */
  function paintEpisodeList(m) {
    const host = state.view?.eps;
    const list = host?.querySelector('.an-er-list');
    if (!list) return;
    const total = m.aired || m.episodes || 0;
    const query = (state.epQuery ?? '').toLowerCase();
    const pages = Math.ceil(total / EP_PAGE);
    state.episodeRange = Math.min(state.episodeRange, Math.max(0, pages - 1));
    const ranges = host.querySelector('.aw-ranges');
    ranges.replaceChildren();
    ranges.hidden = pages < 2 || Boolean(query);
    if (pages > 1 && !query) {
      for (let r = 0; r < pages; r++) {
        const b = button(`aw-range${r === state.episodeRange ? ' active' : ''}`, `${r * EP_PAGE + 1}–${Math.min(total, (r + 1) * EP_PAGE)}`, () => {
          state.episodeRange = r;
          paintEpisodeList(m);
        });
        b.dir = 'ltr';
        ranges.append(b);
      }
      requestAnimationFrame(() => centerInStrip(ranges, ranges.querySelector('.active')));
    }
    let nums = [];
    if (query) {
      for (let n = 1; n <= total; n++) {
        const title = episodeTitleOf(m, n, { mal: state.malTitles, art: artOf(m) }) ?? '';
        if (title.toLowerCase().includes(query)) nums.push(n);
      }
    } else {
      const start = state.episodeRange * EP_PAGE + 1;
      for (let n = start; n <= Math.min(total, start + EP_PAGE - 1); n++) nums.push(n);
    }
    if (state.hideSeen) nums = nums.filter((n) => !epRecord(m, n).done);
    if (state.newestFirst) nums.reverse();
    list.replaceChildren(...nums.map((n) => episodeRow(m, n)));
    if (!nums.length) list.append(el('p', 'an-note', query ? 'لا حلقة بهذا الاسم' : 'شاهدت كل حلقات هذا المدى'));
  }

  /** الترتيب والتصفية وتعليم المدى: قائمة واحدة. */
  function openEpisodeTools(m) {
    deps.openSheet((body) => {
      const head = el('div', 'an-sheet-head');
      head.append(el('div', 'an-sheet-kicker', 'الحلقات'), el('div', 'an-sheet-title', 'الترتيب والتصفية'));
      const item = (icon, label, pressed, run) => {
        const b = el('button', 'sheet-item');
        b.type = 'button';
        b.innerHTML = glyph(icon);
        b.append(el('span', null, label));
        b.setAttribute('aria-pressed', String(pressed));
        if (pressed) b.insertAdjacentHTML('beforeend', `<span class="trail">${glyph('check', { size: 20 })}</span>`);
        b.onclick = () => {
          deps.closeSheet();
          run();
          paintEpisodeList(m);
        };
        return b;
      };
      body.append(
        head,
        item('sort', 'الأقدم أولًا', !state.newestFirst, () => (state.newestFirst = false)),
        item('sort', 'الأحدث أولًا', state.newestFirst, () => (state.newestFirst = true)),
        item('eye', 'أخفِ ما شاهدته', Boolean(state.hideSeen), () => (state.hideSeen = !state.hideSeen)),
      );
      if (signedIn()) {
        const range = el('button', 'sheet-item');
        range.type = 'button';
        range.innerHTML = glyph('layers');
        range.append(el('span', null, 'علّم حلقات: من ← إلى'));
        range.onclick = () => {
          deps.closeSheet();
          openMarkSheet(m, m.aired || m.episodes || 0);
        };
        body.append(range);
      }
    }, { tone: 'anime' });
  }

  /** عناوين MAL وصلت: تُكتب في صفوفها. */
  function patchTitles(m) {
    for (const row of state.view?.eps.querySelectorAll('.an-er') ?? []) {
      const n = Number(row.dataset.ep);
      const title = episodeTitleOf(m, n, { mal: state.malTitles, art: artOf(m) });
      const node = row.querySelector('.an-er-title');
      if (title && node && node.textContent !== title) node.textContent = title;
    }
  }

  /** لقطات ani.zip وصلت: كل صف بغلاف العمل يأخذ لقطته بعد أن تُحمَّل (لا وميض). */
  /** صفوف تعرض لقطة أصغر من المتاح: تُحمَّل الأعلى دقة أولًا ثم تحل محلها بلا وميض. */
  function upgradeStills(m) {
    if (!m) return;
    for (const row of state.view?.eps.querySelectorAll('.an-er') ?? []) {
      const img = row.querySelector('.an-er-art img');
      const shot = episodeStill(m, Number(row.dataset.ep), artOf(m));
      if (!img || !shot.still || img.src === shot.src) continue;
      swapWhenReady(img, shot.src, { position: 'center', fallback: shot.fallbacks }, () => row.querySelector('.an-er-art')?.classList.remove('an-er-art--cover'));
    }
  }

  function patchStills(m) {
    if (!m) return;
    for (const row of state.view?.eps.querySelectorAll('.an-er') ?? []) {
      const art = row.querySelector('.an-er-art--cover');
      if (!art) continue;
      const shot = episodeStill(m, Number(row.dataset.ep), artOf(m));
      if (!shot.still) continue;
      const img = art.querySelector('img');
      if (!img) continue;
      const swap = () => {
        img.src = shot.src;
        img.style.objectPosition = 'center';
        art.classList.remove('an-er-art--cover');
      };
      // الغلاف لم يظهر بعد: اللقطة مكانه مباشرة؛ ظهر: تُحمَّل أولًا ثم تحلّ محله
      if (!img.classList.contains('loaded')) {
        swap();
        continue;
      }
      swapWhenReady(img, shot.src, { position: 'center', fallback: shot.fallbacks }, () => art.classList.remove('an-er-art--cover'));
    }
    patchTitles(m);
  }

  /**
   * المواسم: السابق ← هذا ← التالي من علاقات AniList (كل موسم عمل مستقل هناك)،
   * ألسنة نصية فوق الحلقات تنتقل بينها بلمسة.
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
      b.append(el('b', null, label(r, rel)));
      const when = [SEASON_AR[r.season], r.year].filter(Boolean).join(' ');
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
  function openMarkSheet(m, total) {
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
        repaintRows(m);
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

  /** المصادر سطرًا هادئًا واحدًا: نقطة حالة، ومن أين تشاهد. لا شرائح بإطارات. */
  function paintSources(m, phase = state.work && state.workFor === m.id ? 'found' : engine.available() ? 'loading' : 'web') {
    const host = q('animeSources');
    if (!host) return;
    host.dataset.state = phase;
    const dot = el('i', 'aw-dot');
    const text = el('span', 'aw-sources-text');
    host.replaceChildren(dot, text);
    if (phase === 'web') {
      text.textContent = 'التشغيل من المصادر العربية داخل تطبيق أندرويد';
      return;
    }
    if (phase === 'loading') {
      text.textContent = 'نبحث في المصادر العربية…';
      return;
    }
    if (phase !== 'found') {
      text.textContent = phase === 'error' ? 'تعذّر البحث في المصادر' : 'غير متوفر في المصادر العربية حاليًا';
      host.append(button('aw-link', 'ابحث مجددًا', () => {
        state.workFor = null;
        void locateWork(m);
      }));
      return;
    }
    const names = [...new Set(state.work.copies.map((c) => sourceLabel(c.sourceId, { names: SOURCE_NAMES, title: c.title })))];
    const shown = names.slice(0, 3);
    text.append(document.createTextNode('متوفر في '));
    shown.forEach((name, i) => {
      if (i) text.append(document.createTextNode('، '));
      const b = el('bdi', null, name);
      text.append(b);
    });
    if (names.length > shown.length) text.append(document.createTextNode(` و${names.length - shown.length} غيرها`));
    text.title = names.join('، ');
  }

  // Background needsHuman events remain diagnostic state. Verification is
  // managed explicitly by the Add-ons queue; this view must not append an overlay.
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
      // المشغّل أُغلق: صفوف الحلقات وزر «تابع» يتحدّثان في مكانهما
      if (state.view?.id === cur.m.id && state.detail?.id === cur.m.id) repaintRows(state.detail);
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
  engine.on('playstat', (e) => {
    reportSource(e);
    // زمن البدء الحقيقي على هذا الجهاز يدخل ترشيح «الأفضل» القادم (server-sheet.js)
    learnStart(e);
  });
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
    sheet.autoTogether = Boolean(hub?.matches(togetherRef, n)) && !globalThis.VantaraDesktop; // Keep existing PWA/APK behavior; Windows invitees choose source.
    let paintQueued = false;
    let off = [];

    // صفحة كاملة لا ورقة: قرار قبل التشغيل فيه جودة ولغة وسيرفر
    deps.openSheet((body) => {
      // رأس الورقة (server-sheet.js): لقطة الحلقة بشعار العمل، ثم تقييمها وتاريخها ومدتها ووصفها من ani.zip
      const art = state.art?.id === m.id ? state.art : null;
      const shot = episodeStill(m, n, art, { full: true });
      const thumb = shot.still ? shot.src : null;
      const epTitle = episodeTitleOf(m, n, { mal: state.malTitles, art });
      const epArt = art?.episodes?.[String(n)] ?? null;
      const minutes = epArt?.runtime || m.duration;
      const media = {
        title: m.title,
        logo: art?.logo ?? null,
        backdrop: thumb ?? m.banner ?? m.poster,
        backdropFallbacks: thumb ? shot.fallbacks : [],
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
      if (hub && !hub.matches(togetherRef, n)) {
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
        noSourcesTitle: 'أضف مصدرًا لتشاهد',
        ...(deps.addSource ? { onAddSource: () => { deps.closeSheet(); deps.addSource('anime'); } } : {}),
        onRetry: () => {
          if (engine.retrySeconds(sheet.retryAt)) return;
          deps.closeSheet();
          playEpisode(m, n, { position });
        },
        onUnavailable: (r) => deps.toast(r.reason || 'لم يُستخرج رابط فيديو من المشغّل', 5000),
      });
      void deps.playableSources?.('anime').then((count) => {
        if (count !== 0 || sheet.closed) return;
        sheet.noSources = true;
        paint();
      }, () => {});
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
          // لا مصدر مشاهدة في الحساب: «أضف مصدرًا» بدل «غير متوفر» (لا نلوم المصادر على غيابها)
          noSources: sheet.noSources === true && !sheet.routes.length,
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
          // نفس ما يُعطى للمشغّل في playEpisode: يجهز من القرص قبل الضغط على تشغيل
          engine.warmArt([state.view?.id === m.id ? state.view.heroSrc : null, artOf(m)?.fanart, artOf(m)?.logo]);
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
        // شاشة التحميل في المشغّل: شعار العمل وخلفيته العريضة (الغلاف إن لم توجد)
        logo: artOf(m)?.logo ?? null,
        backdrop: (state.view?.id === m.id ? state.view.heroSrc : null) ?? artOf(m)?.fanart ?? null,
        friends: (deps.friends?.() ?? []).map((f) => ({ userId: f.userId, displayName: f.displayName })),
        copies: sheet.copies ?? sheet.work.copies,
        malId: m.idMal ?? null,
        resume,
        presenceEndpoint: presence?.endpoint ?? null,
        presenceAuthorization: presence?.authorization ?? null,
        presenceUserId: presence?.userId ?? null,
        presenceDeviceId: presence?.deviceId ?? null,
        presenceDeviceCredential: presence?.deviceCredential ?? null,
        ...(globalThis.VantaraDesktop && hub ? { roomHub:hub } : {}),
        ...(hub?.matches(togetherRef) ? { together: hub.handOff(togetherRef) } : {}),
      });
    }
  }

  // ───────────── اكتشف وصفحات «الكل» (anime-discover.js) ─────────────

  const discover = createAnimeDiscover({
    q, el, button, image, genreAr, toast,
    posterCard: (m, opts) => posterCard(m, opts),
    openAnime: (m) => void openAnime(m),
    openSheet: deps.openSheet,
    closeSheet: deps.closeSheet,
    showPage: deps.showPage,
    genres: ANIME_GENRES,
    trending: () => state.home?.trending ?? [],
  });
  const openDiscover = (opts) => discover.open(opts);
  const openCollection = (spec) => discover.openCollection(spec);
  const showDiscover = () => discover.show();

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
    for (const node of deps.root?.querySelectorAll?.('.an-hc') ?? []) {
      if (node.dataset.ref !== ref) continue;
      node.remove();
    }
    // الرئيسية تعرض آخر 10 أعمال: يأخذ التالي مكان المحذوف، ويختفي القسم إن فرغ السجل
    if (state.home && q('animeHome')?.querySelector('.an-rail--history')) renderHome(state.home);
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

  return { show, loadHome, openAnime, play: playEpisode, showDiscover, renderLibrary, openDiscover, openCollection, shareCurrent, leaveDetail: () => {} };
}
