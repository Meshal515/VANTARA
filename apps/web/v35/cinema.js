/**
 * VANTARA CINEMA — أفلام ومسلسلات عالمية مترجمة.
 *
 * البيانات من Cinemeta، والتشغيل من المصادر العربية في البيان (`content: cinema`)
 * عبر محرك الأنمي نفسه، بالمسار السريع (lib/cinema-fast.js): بحث متدفق، وأول
 * تشغيل صالح يفوز، والبقية تكمل في الخلفية.
 *
 * التصميم خاص بالسينما (`cn-` في cinema.css): الصورة تُعرض كاملة لا يغطيها
 * شيء، والكلام والأزرار تحتها؛ ملصقات بحواف حادة، وقائمة IMDb مرقّمة.
 * المشترك مع بقية VANTARA: الهيكل، والتنقّل، وورقة السيرفرات والمشغّل بلون
 * القسم.
 *
 * «قائمتي» و«المفضلة» و«أكمل المشاهدة» في حسابك (نفس جداول المانجا والأنمي بمرجع
 * `cinema:<IMDb>`)، والوقت يُحتسب لقسم السينما في الإحصاءات.
 */

import { nativeFollowTime, flushFollowTime } from '../lib/follow-time.js';
import { glyph, iconButton } from './icons.js';
import { pop, progressFill, reduced, revealIn, stripIn } from './motion.js';
import * as engine from '../lib/anime-engine.js';
import { GENRES_AR, TYPE_AR, catalog, detail as fetchDetail, displayTitle, search as searchMeta } from '../lib/cinema-meta.js';
import { explainCopies, namesScore, pickCopies, queriesFor, readTitle } from '../lib/cinema-match.js';
import { REJECT_AR, STATE, STATE_AR, overallSearchState, playState, searchState } from '../lib/source-states.js';
import { reportSource } from '../lib/source-report.js';
import { matchCriteria, mergeWork, namesOf } from '../lib/cinema-identity.js';
import { report as reportUpdate } from '../lib/update-engine.js';
import { createLocator, createMemory, createMetrics } from '../lib/cinema-fast.js';
import { agoAr, latestGroups, unitLabel } from './updates-view.js';

const HOME_KEY = 'cinema.home.v3';
const OVERVIEW_KEY = 'vantara.cinema.overviews.v1';
const STALE_MS = 6 * 3_600_000;
const HERO_SECONDS = 8;
const STATE_AR_ROUTE = { RESOLVING: 'يتجهّز…', READY: 'جاهز', UNAVAILABLE: 'غير متاح', FAILED: 'فشل التشغيل' };
const SOURCE_NAMES = { faselhd: 'FaselHD', arabseed: 'ArabSeed', egydead: 'EgyDead', cimaleek: 'Cimaleek', tuktukcinema: 'TukTuk', asia2tv: 'Asia2TV', akwam: 'Akwam' };
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
const slim = (m) => ({ id: m.id, type: m.type, title: m.title, poster: m.poster, background: m.background, logo: m.logo ?? null, year: m.year, rating: m.rating, genres: (m.genres ?? []).slice(0, 3) });

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
    warm: null,
    playing: null,
    libraryTab: 'continue',
    discover: { query: '', genre: '', type: 'movie', token: 0 },
  };

  // ───────────── التخزين المحلي ─────────────

  const watchAll = () => readJson(userKey('watch', currentUser()), {});
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
  // ───────────── الحساب ─────────────
  // نفس جداول المانجا والأنمي بمرجع `cinema:<IMDb>`: «قائمتي» = library، «المفضلة» =
  // favorite، و«أكمل المشاهدة» = work_views. فتصل لكل أجهزتك وتظهر في ملفك.
  // موضع التوقف داخل الحلقة وحده على الجهاز (مثل الأنمي).
  const sync = deps.sync;
  const me = () => sync?.user?.userId ?? null;
  const refOf = (id) => `cinema:${id}`;
  const isCinemaRef = (ref) => typeof ref === 'string' && ref.startsWith('cinema:');
  const descriptor = (m) => ({ seriesRef: refOf(m.id), seriesTitle: m.title ?? null, coverUrl: m.poster ?? null });
  const TYPES_KEY = 'vantara.cinema.types.v1';
  const types = readJson(TYPES_KEY, {});
  const rememberType = (m) => {
    if (!m?.id || !m.type || types[m.id] === m.type) return;
    types[m.id] = m.type;
    writeJson(TYPES_KEY, types);
  };
  const rows = (table, pick) => sync?.rows?.(table, (r) => r.user_id === me() && isCinemaRef(r.series_ref) && pick(r)) ?? [];
  const inList = (kind, id) =>
    kind === 'later'
      ? rows('library', (r) => r.series_ref === refOf(id) && !r.removed).length > 0
      : rows('collections', (r) => r.kind === 'favorite' && r.series_ref === refOf(id) && r.member).length > 0;
  function toggleList(kind, m) {
    const on = !inList(kind, m.id);
    rememberType(m);
    if (kind === 'later') sync?.enqueue(on ? 'library.add' : 'library.remove', on ? descriptor(m) : { seriesRef: refOf(m.id) });
    else sync?.enqueue('favorite.set', { ...descriptor(m), member: on });
    return on;
  }
  /** عمل من صفوف الحساب: العنوان والغلاف منها، والنوع والخلفية مما عرفه الجهاز. */
  function fromRef(ref, title, cover) {
    const id = ref.slice('cinema:'.length).split(':')[0];
    const local = watchAll()[id] ?? {};
    const work = sync?.rows?.('works', (w) => w.series_ref === refOf(id))[0];
    return { ...local, id, type: types[id] ?? local.type ?? null, title: title ?? work?.title ?? local.title ?? id, poster: cover ?? work?.cover_url ?? local.poster ?? null };
  }
  /** رف من الحساب: «قائمتي» أو «المفضلة»، الأحدث أولًا. */
  function shelf(kind) {
    const list =
      kind === 'later'
        ? rows('library', (r) => !r.removed).sort((a, b) => (b.added_at ?? 0) - (a.added_at ?? 0))
        : rows('collections', (r) => r.kind === 'favorite' && r.member).sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
    return [...new Map(list.map((r) => [r.series_ref, r])).values()].map((r) => fromRef(r.series_ref, r.series_title, r.cover_url));
  }
  /** «آخر المشاهدات» في الحساب: مرة لكل حلقة في الجلسة. */
  const viewed = new Set();
  function recordView(m, season, n) {
    if (!me()) return;
    const k = `${me()}:${m.id}:${season ?? 0}:${n}`;
    if (viewed.has(k)) return;
    viewed.add(k);
    rememberType(m);
    sync?.enqueue('view.add', { ...descriptor(m), chapterLabel: m.type === 'series' ? `الموسم ${season} · الحلقة ${n}` : 'فيلم', chapterNumber: m.type === 'series' ? n : null });
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
  /** «أكمل المشاهدة»: من الحساب (كل أجهزتك)، وموضع التوقف من الجهاز إن وُجد. */
  function continuing() {
    const local = watchAll();
    const views = rows('work_views', (r) => !r.removed).sort((a, b) => (b.viewed_at ?? 0) - (a.viewed_at ?? 0));
    const out = new Map();
    for (const v of views) {
      const w = fromRef(v.series_ref, v.series_title, v.cover_url);
      if (out.has(w.id)) continue;
      const m = /الموسم\s+(\d+)\s+·\s+الحلقة\s+(\d+(?:\.\d+)?)/.exec(v.chapter_label ?? '');
      if (m && !local[w.id]) Object.assign(w, { type: w.type ?? 'series', season: Number(m[1]), episode: Number(m[2]), episodes: {} });
      if (!m && !local[w.id]) Object.assign(w, { type: w.type ?? 'movie', season: 0, episode: 1, episodes: {} });
      out.set(w.id, { ...w, at: v.viewed_at ?? w.at });
    }
    // ما شوهد هنا قبل أن يصل الحساب (أو بلا حساب) لا يضيع
    for (const w of Object.values(local)) if (w.at && !out.has(w.id)) out.set(w.id, w);
    return [...out.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }

  // ───────────── القصة بالعربية ─────────────
  // Cinemeta يعطيها بالإنجليزية؛ الخادم يعرّبها مرة لكل نص ويحفظها للجميع،
  // وهنا نسخة على الجهاز فلا تُطلب مرتين. البصمة تكشف تغيّر النص في المصدر.

  const overviews = readJson(OVERVIEW_KEY, {});
  const fingerprint = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  function cachedOverview(key, english) {
    const hit = overviews[key];
    return hit && hit.h === fingerprint(english) ? hit.t : null;
  }
  function rememberOverviews(found, texts) {
    for (const [key, t] of Object.entries(found)) if (texts.has(key)) overviews[key] = { h: fingerprint(texts.get(key)), t };
    const keys = Object.keys(overviews);
    for (const k of keys.slice(0, Math.max(0, keys.length - 1500))) delete overviews[k];
    writeJson(OVERVIEW_KEY, overviews);
  }
  /** قصة العمل (أو حلقات الموسم المعروض) بالعربية في أماكنها، والإنجليزي إن تعذّر. */
  async function arabize(m, season) {
    await null; // بعد أن تُركّب الصفحة نفسها
    const texts = new Map();
    if (m.description) texts.set(m.id, m.description);
    for (const e of m.seasons?.find((s) => s.n === season)?.episodes ?? []) if (e.overview) texts.set(`${m.id}:${season}:${e.n}`, e.overview);
    const need = [...texts].filter(([key, english]) => !cachedOverview(key, english)).map(([key, english]) => ({ key, text: english }));
    const found = {};
    for (let i = 0; i < need.length && deps.sync?.translation; i += 24) {
      const res = await deps.sync.translation('/v1/cinema/overviews', { method: 'POST', body: { items: need.slice(i, i + 24) } }).catch(() => null);
      Object.assign(found, res?.status === 200 ? (res.body?.overviews ?? {}) : {});
    }
    if (Object.keys(found).length) rememberOverviews(found, texts);
    if (state.detail?.id !== m.id) return;
    for (const node of q('cinema')?.querySelectorAll('[data-overview].cn-pending') ?? []) {
      const key = node.dataset.overview;
      const ar = found[key] ?? cachedOverview(key, texts.get(key) ?? '');
      node.classList.remove('cn-pending');
      node.textContent = ar ?? texts.get(key) ?? '';
      if (!ar) node.dir = 'ltr';
    }
  }

  // ───────────── قطع صغيرة ─────────────

  /**
   * الشاشة الكبيرة تأخذ نسخة أوضح من نفس الصورة (Metahub بثلاثة مقاسات: 780،
   * 1280، والأصل حتى 4K). في اللوحات العريضة تظهر 1280 فورًا ثم تُستبدل
   * بالأصل متى وصل، والملصق بمقاسه المتوسط. الجوال يبقى على مقاساته.
   */
  const bigScreen = () => globalThis.matchMedia?.('(min-width: 700px)').matches === true;
  const sharpPoster = (src) => (src && bigScreen() ? src.replace(/(metahub\.space\/poster)\/small\//, '$1/medium/') : src);
  const sharpBackground = (src) => (src && bigScreen() ? src.replace(/(metahub\.space\/background)\/(?:small|medium)\//, '$1/large/') : src);
  function image(src, cls = 'cn-img', { eager = false, fallback = null, hero = false } = {}) {
    src = sharpPoster(src);
    fallback = sharpPoster(fallback);
    // الأصل الكبير للّوحات العريضة وحدها (البانر وصفحة العمل)، لا لكل بطاقة صغيرة
    const sharper = hero ? sharpBackground(src) : src;
    const img = new Image();
    img.alt = '';
    img.className = cls;
    img.decoding = 'async';
    if (!eager) img.loading = 'lazy';
    img.onload = () => {
      img.classList.add('loaded');
      if (sharper === src || img.dataset.sharp) return;
      img.dataset.sharp = '1';
      const hi = new Image();
      hi.decoding = 'async';
      hi.src = sharper;
      hi.decode().then(() => {
        img.src = sharper;
      }, () => {});
    };
    img.onerror = () => {
      // تعثّر شبكة عابر: محاولة ثانية واحدة قبل البديل (الشعار والخلفية خصوصًا)
      if (src && !img.dataset.retried && img.src === new URL(src, location.href).href) {
        img.dataset.retried = '1';
        setTimeout(() => {
          img.src = src;
        }, 1200);
        return;
      }
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
    if (m.logo) {
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
    // عمل من الحساب قد لا يُعرف نوعه على هذا الجهاز: فيلم أولًا ثم مسلسل
    const tryType = (type) => fetchDetail(type, m.id).catch(() => null);
    const p = (async () => (await tryType(m.type ?? types[m.id] ?? 'movie')) ?? (m.type ? null : await tryType('series')))().then((full) => {
      if (full) rememberType(full);
      else state.details.delete(m.id);
      return full;
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

    // الانتقال: الصورة الجديدة تدخل من جهة التقليب وتذوب فوق السابقة (التي تنزاح قليلًا
    // للجهة الأخرى)، والكلام تحتها يخرج ويدخل بنفس الاتجاه. CSS لا GSAP: لا شيء يبدأ
    // مخفيًا ويعلق إن تعطّل محرك الحركة.
    const frame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
    let swapTimer = null;
    const paint = (i, first = false, from = -1) => {
      const m = items[i];
      state.hero.index = i;
      const calm = first || reduced();
      const img = image(m.background ?? m.poster, 'cn-img cn-bill-img', { eager: first || i < 2, hero: true });
      img.classList.add('cn-bill-enter');
      if (!calm) img.style.setProperty('--from', String(from));
      const previous = [...stage.querySelectorAll('.cn-bill-img')];
      stage.append(img);
      const settle = () =>
        frame(() => {
          img.classList.add('loaded');
          img.classList.remove('cn-bill-enter');
          for (const old of previous) {
            if (!calm) old.style.setProperty('--to', String(-from));
            old.classList.add('cn-bill-leave');
          }
          // الصورة السابقة تبقى تحت حتى تكتمل الجديدة: لا وميض أسود بينهما
          setTimeout(() => previous.forEach((n) => n.remove()), 1300);
        });
      if (img.complete && img.naturalWidth) settle();
      else {
        img.addEventListener('load', settle, { once: true });
        img.addEventListener('error', settle, { once: true });
      }

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
      const content = [top, ...(genres ? [el('p', 'cn-bill-genres', genres)] : []), actions];
      clearTimeout(swapTimer);
      if (calm) {
        info.classList.remove('is-out', 'no-anim');
        info.replaceChildren(...content);
      } else {
        info.style.setProperty('--shift', `${-from * 14}px`);
        info.classList.add('is-out');
        swapTimer = setTimeout(() => {
          info.classList.add('no-anim');
          info.style.setProperty('--shift', `${from * 14}px`);
          info.replaceChildren(...content);
          void info.offsetWidth; // يثبت نقطة البداية قبل الرجوع للمكان
          info.classList.remove('no-anim');
          frame(() => info.classList.remove('is-out'));
        }, 200);
      }

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
      // التالي يدخل من اليسار (اتجاه القراءة العربي)، والسابق من اليمين
      paint((state.hero.index + step + items.length) % items.length, false, step > 0 ? -1 : 1);
    };

    // سحب أفقي على الصورة: تتبع الإصبع قليلًا (تعرف أنك تقلّب)، ثم تقلّب أو ترجع بهدوء
    let x0 = null;
    let dragged = 0;
    const current = () => stage.querySelector('.cn-bill-img:last-child');
    const follow = (dx) => {
      const top = current();
      if (top) top.style.setProperty('--drag', `${dx * 0.18}px`);
      info.style.setProperty('--drag', `${dx * 0.12}px`);
    };
    stage.addEventListener('pointerdown', (e) => {
      x0 = e.clientX;
      dragged = 0;
      box.classList.add('dragging');
    }, { passive: true });
    stage.addEventListener('pointermove', (e) => {
      if (x0 === null || reduced()) return;
      dragged = e.clientX - x0;
      follow(dragged);
    }, { passive: true });
    const release = (e) => {
      if (x0 === null) return;
      const dx = (e?.clientX ?? x0) - x0;
      x0 = null;
      box.classList.remove('dragging');
      follow(0);
      if (Math.abs(dx) > 40) next(dx > 0 ? 1 : -1);
      else if (e?.type === 'pointerup' && Math.abs(dragged) < 8) void openWork(items[state.hero.index]);
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointerleave', (e) => x0 !== null && release(e));
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
    const later = shelf('later').filter((x) => !x.type || wants(x.type));
    if (later.length) page.append(rail('قائمتي', later.slice(0, 16), posterCard, { more: () => openLibrary('later') }));
    const fresh = (state.updates ?? []).filter((g) => wants(g.kind === 'movie' ? 'movie' : 'series'));
    if (fresh.length) page.append(rail('آخر التحديثات', fresh, updateCard, { more: deps.openUpdates ? () => deps.openUpdates('cinema') : undefined }));
    const skip = new Set(heroItems.map((m) => m.id));
    const rest = (list) => (list ?? []).filter((m) => !skip.has(m.id));
    if (wants('movie') && data.movies?.length) page.append(rail('أفلام رائجة الآن', rest(data.movies)));
    if (wants('series') && data.series?.length) page.append(rail('مسلسلات يتابعها الجميع', rest(data.series)));
    if (wants('movie') && data.topMovies?.length) page.append(chart('أعلى الأفلام تقييمًا', data.topMovies));
    if (wants('movie') && data.fresh?.length) page.append(rail(`جديد ${new Date().getFullYear()}`, data.fresh, posterCard, { sub: 'صدرت هذه السنة' }));
    if (wants('series') && data.topSeries?.length) page.append(chart('أعلى المسلسلات تقييمًا', data.topSeries));
    page.append(genreGrid((g) => openDiscover({ genre: g, type: k === 'series' ? 'series' : 'movie' })));
    page.append(el('p', 'cn-credit', 'بيانات الأعمال من Cinemeta · القصص معرّبة · التشغيل من المصادر العربية'));
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
    void loadUpdates();
  }

  // «آخر التحديثات» من ذاكرة VANTARA: حلقات المسلسلات الجديدة والأفلام التي توفّرت
  let updatesAt = 0;
  async function loadUpdates() {
    if (Date.now() - updatesAt < 120_000) return;
    updatesAt = Date.now();
    const groups = await latestGroups('cinema').catch(() => null);
    if (!groups?.length) return;
    state.updates = groups;
    if (state.home && (deps.currentPage() !== 'home' || q('cinemaHome').hidden)) renderHome(state.home);
  }
  /** بطاقة حدث: الملصق، الاسم، و«S02E05 · قبل ساعتين». */
  function updateCard(g) {
    const m = { id: g.work.slice('cinema:'.length), type: g.kind === 'movie' ? 'movie' : 'series', title: g.title, poster: g.cover };
    const c = posterCard(m);
    const meta = c.querySelector('.cn-poster-meta');
    // الأحدث ورقم خفيف بعدد ما نزل، كالمانجا: «S02E05 +3 · قبل ساعتين»
    const more = g.events?.length > 1 ? ` +${g.events.length}` : '';
    meta.replaceChildren(el('span', 'cn-poster-unit', `${unitLabel({ ...g, low: g.high, events: [g] })}${more} · ${agoAr(g.at)}`));
    meta.dir = 'auto';
    return c;
  }

  // ───────────── المصادر ─────────────

  // المسار السريع (lib/cinema-fast.js): البحث متدفق مصدرًا مصدرًا، وأول نسخة
  // مطابقة تكفي لبدء التجهيز؛ وما نجح لهذا العمل قبلًا يبدأ به التجهيز فورًا.
  const memory = createMemory();
  const metrics = createMetrics();
  const nearCopies = (seen, { title, aliases = [], type }) =>
    seen
      .map((c) => ({ c, score: namesScore([title, ...aliases], c.title), kind: readTitle(c.title).kind }))
      .filter((x) => x.score >= 0.5 && (!x.kind || x.kind === type))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => x.c);
  const locator = createLocator({
    searchStream: (query, content, onHit) => engine.searchStream(query, content, onHit),
    queries: queriesFor,
    match: (items, c) => pickCopies(items, c),
    near: nearCopies,
    memory,
  });

  // إخوة الاسم من بحث Cinemeta (مرتبًا بالشهرة): نتائج شاشة البحث تُحفظ هنا،
  // وما لم يمرّ بها يُسأل عنه مرة. الاستعلام مفتاح نتائج بحث، لا هوية عمل.
  const peerResults = new Map();
  const peerKey = (t) => String(t ?? '').trim().toLowerCase();
  function peersOf(m) {
    // بكل أسماء العمل: الروسي «Besstydniki» إخوته تحت «Shameless»
    const keys = [...new Set(namesOf(m).slice(0, 3).map(peerKey).filter(Boolean))];
    if (!keys.length) return Promise.resolve([]);
    for (const k of keys) if (!peerResults.has(k)) peerResults.set(k, searchMeta(k).catch(() => { peerResults.delete(k); return null; }));
    return Promise.all(keys.map((k) => peerResults.get(k))).then((lists) => (lists.every((l) => l == null) ? null : [...new Map(lists.flat().filter(Boolean).map((r) => [r.id, r])).values()]));
  }
  /** معايير هوية العمل للمطابقة؛ إخوة الاسم بمهلة قصيرة كي لا يتأخر البحث. */
  function identityFor(m, season) {
    const timeout = new Promise((r) => setTimeout(() => r(null), 2500));
    return Promise.race([peersOf(m), timeout]).then((results) => matchCriteria(m, { season, results: results ?? null }));
  }

  /** بحث حيّ لهذا العمل/الموسم، مشترك بين صفحة العمل وورقة السيرفرات والتجهيز المسبق. */
  function locateHandle(m, season) {
    if (m._sourceCopy) return pinnedHandle(m, season, m._sourceCopy);
    const key = playKey(m, season);
    const old = state.works.get(key);
    if (old) return old;
    const h = locator({ key, ...matchCriteria(m, { season }), ready: identityFor(m, season) });
    h.run = metrics.start({ key, title: displayTitle(m), kind: m.type });
    if (h.found.fast) h.run.fastPath();
    h.onHit((hit, info) => {
      h.run.hit(hit, info);
      // صحة المصدر من هذا الجهاز: ردّ وطابق، ردّ بلا مطابقة، مهلة، خطأ
      const outcome = hit.skipped ? 'unavailable' : hit.error ? (STATE.SOURCE_TIMEOUT === searchState({ error: hit.error }) ? 'timeout' : /challenge|cloudflare/i.test(hit.error) ? 'challenge' : 'error') : info?.matched ? 'ok' : 'no_match';
      reportSource({ section: 'cinema', sourceId: hit.sourceId, stage: 'search', outcome, reason: hit.error, ms: hit.ms });
    });
    state.works.set(key, h);
    void h.first.then((found) => found.copies.length && senseMovie(m, found.copies));
    // لم يرد أي مصدر: لا نحفظ «لا شيء»، فالفتحة القادمة تبحث من جديد
    void h.done.then((found) => {
      if (!found.answered && !found.copies.length && state.works.get(key) === h) state.works.delete(key);
    });
    return h;
  }
  /** نسخة اختارها الشخص من «نتائج قريبة»: تُحفظ للعمل وتُجهَّز مباشرة. */
  function pinnedHandle(m, season, copy) {
    const key = playKey(m, season);
    state.works.get(key)?.cancel?.();
    memory.remember(key, [copy]);
    const found = { copies: [copy], near: [], total: 1, done: true, fast: true, answered: 1, sources: {} };
    const h = { found, first: Promise.resolve(found), done: Promise.resolve(found), onCopies: () => () => {}, onHit: () => () => {}, cancel() {} };
    h.run = metrics.start({ key, title: displayTitle(m), kind: m.type });
    h.run.fastPath();
    state.works.set(key, h);
    return h;
  }
  /** النسخ عند أول مطابقة (والمتأخرة تصل للجلسة بعدها). */
  const locate = (m, season) => locateHandle(m, season).first;

  // ───────────── التجهيز المسبق: أول تشغيل صالح يفوز ─────────────
  // فتح العمل يبدأ تجهيز ما ستشاهده (الفيلم، أو حلقة المتابعة) فورًا: حين تضغط
  // «شاهد» يكون أول سيرفر جاهزًا غالبًا، والبقية تكمل بالخلفية. جلسة واحدة دافئة.

  const WARM_TTL = 8 * 60_000; // روابط الفيديو تنتهي خلال دقائق
  function dropWarm() {
    const w = state.warm;
    if (!w) return;
    state.warm = null;
    w.closed = true;
    for (const f of w.off) f();
    w.off = [];
    w.copyOff?.();
    w.run?.save();
    if (w.session && !w.launched) void engine.closeSession(w.session);
  }
  function warmUp(m, season, n) {
    const key = playKey(m, season);
    const episode = m.type === 'movie' ? -1 : n;
    const forPreparation = copies => m.type === 'series' ? copies.map(c => ({ ...c, requestedSeason: season })) : copies;
    const cur = state.warm;
    if (cur && !cur.closed && cur.key === key && cur.episode === episode && Date.now() - cur.at < WARM_TTL) return cur;
    dropWarm();
    const h = locateHandle(m, season);
    // فتحة ثانية لنفس العمل بعد انتهاء الأولى: قياس جديد يبدأ من الآن
    if (h.run.saved) {
      h.run = metrics.start({ key, title: displayTitle(m), kind: m.type });
      h.run.fastPath();
    }
    const session = `cn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const w = { key, episode, at: Date.now(), session: null, routes: [], done: false, missing: false, closed: false, launched: false, remembered: false, handle: h, copies: [], run: h.run, off: [], listeners: new Set() };
    state.warm = w;
    const notify = () => {
      for (const fn of w.listeners) fn(w);
    };
    w.notify = notify;
    void (async () => {
      const identity = {canonicalId:m.canonicalId??`cinema:${m.id}`,kind:m.type,externalIds:m.externalIds??{imdb:/^tt\d+$/.test(m.id)?m.id:null},season,episode:n};
      const found = await engine.firstAvailableCopies(h.first, engine.withAddonCopies([], identity));
      if (w.closed) return;
      if (!found.copies.length) {
        w.missing = true;
        w.done = true;
        w.run.save();
        notify();
        return;
      }
      // المستمعان قبل الطلب: أول سيرفر قد يجهز قبل أن يعود النداء نفسه
      w.off.push(
        engine.on('route', (e) => {
          if (e.session !== session || w.closed) return;
          const i = w.routes.findIndex((r) => r.id === e.route.id);
          if (i >= 0) w.routes[i] = e.route;
          else w.routes.push(e.route);
          w.run.route(e.route);
          // أول سيرفر جاهز: نسخة مصدره تُحفظ للعمل، فالفتحة القادمة تبدأ منها مباشرة
          if (e.route.state === 'READY' && e.route.probed === true && !w.remembered) {
            w.remembered = true;
            memory.remember(key, h.found.copies, h.found.copies.find((c) => c.sourceId === e.route.sourceId));
          }
          notify();
        }),
        engine.on('prepared', (e) => {
          if (e.session !== session || w.closed) return;
          w.done = true;
          noteServer(w.routes);
          w.run.save();
          notify();
        }),
      );
      const pref = memory.server(key);
      w.run.prepared();
      // لقطة ثابتة: ما يصل أثناء النداء يُضاف بعده (`extend`) فلا يضيع ولا يتكرر
      const initial = [...found.copies];
      try {
        const out = await engine.prepare({
          session,
          copies: forPreparation(initial),
          identity: {canonicalId:m.canonicalId??`cinema:${m.id}`,kind:m.type,externalIds:m.externalIds??{imdb:/^tt\d+$/.test(m.id)?m.id:null},season,episode:n},
          episode,
          preferredSourceId: pref?.sourceId ?? null,
          preferredServer: pref?.server ?? null,
          probe: true,
        });
        if (w.closed) return;
        w.session = out?.session ?? session;
        w.copies = out?.copies ?? forPreparation(initial);
        for (const r of out?.routes ?? []) if (!w.routes.some((x) => x.id === r.id)) w.routes.push(r);
        if (out?.done) w.done = true;
      } catch (e) {
        w.error = String(e?.message ?? e);
        w.done = true;
      }
      notify();
      // مصدر ردّ بعد بدء التجهيز: نسخته تدخل الجلسة نفسها، وما يعمل لا يتوقف
      w.copyOff = h.onCopies((fresh) => {
          if (w.closed || !w.session) return;
          const prepared = forPreparation(fresh);
          for (const c of prepared) if (!w.copies.some(old => old.sourceId === c.sourceId && old.url === c.url)) w.copies.push(c);
          void engine.extend(w.session, prepared).then((added) => {
            if (added && !w.closed) {
              w.done = false;
              notify();
            }
          });
        });
      h.done.finally(() => {
        w.copyOff?.();
        notify();
      });
      const late = h.found.copies.filter((c) => !initial.includes(c));
      if (late.length && w.session) {
        const prepared = forPreparation(late);
        for (const c of prepared) if (!w.copies.some(old => old.sourceId === c.sourceId && old.url === c.url)) w.copies.push(c);
        void engine.extend(w.session, prepared);
      }
    })();
    return w;
  }

  // ───────────── مجسّات Update Engine ─────────────
  // المسلسل: حلقاته التي عُرضت (بتاريخ عرضها). الفيلم: «توفّر» حين نجده في
  // المصادر العربية وهو حديث. والخادم يقرّر: أول مرة خط أساس بلا أحداث.

  function senseSeries(m) {
    if (m.type !== 'series' || !m.seasons) return;
    const now = Date.now();
    const units = m.seasons
      .filter((s) => s.n > 0)
      .flatMap((s) => s.episodes.filter((e) => e.released && e.released <= now).map((e) => ({ season: s.n, number: e.n, publishedAt: e.released })))
      .sort((a, b) => b.season - a.season || b.number - a.number)
      .slice(0, 40);
    if (units.length) reportUpdate({ work: `cinema:${m.id}`, section: 'cinema', kind: 'episode', title: m.title, cover: m.poster ?? null, source: { s: 'cinemeta' }, units });
  }
  function senseMovie(m, copies) {
    if (m.type !== 'movie' || !copies?.length || !m.released || m.released > Date.now()) return;
    for (const c of copies.slice(0, 4)) {
      reportUpdate({ work: `cinema:${m.id}`, section: 'cinema', kind: 'movie', title: m.title, cover: m.poster ?? null, source: { s: c.sourceId, u: c.url }, units: [{ publishedAt: m.released }] });
    }
  }

  // ذاكرة السيرفرات على الجهاز: ما فشل مؤخرًا يُجرَّب أخيرًا (سبعة أيام)
  const FAIL_KEY = 'vantara.cinema.serverFails.v1';
  const STATE_RANK = { READY: 0, RESOLVING: 1 };
  const probeRank = (r) => (r.probed === true ? 0 : r.probed === false ? 2 : 1);
  const serverKey = (r) => `${r.sourceId}|${r.server ?? r.code}`;
  const serverName = (r) => (/[\u0600-\u06FF]/.test(String(r.code ?? '')) && r.server ? r.server : r.code ?? r.server ?? 'سيرفر');
  function failures(r) {
    const f = readJson(FAIL_KEY, {})[serverKey(r)];
    return f && Date.now() - f.at < 7 * 86_400_000 ? f.n : 0;
  }
  function noteServer(routes) {
    const all = readJson(FAIL_KEY, {});
    for (const r of routes) {
      const k = serverKey(r);
      if (r.state === 'READY' && r.probed === true) delete all[k];
      else if (r.state === 'UNAVAILABLE' || r.state === 'FAILED' || r.probed === false) all[k] = { n: Math.min(9, (all[k]?.n ?? 0) + 1), at: Date.now() };
    }
    writeJson(FAIL_KEY, all);
  }

  // ───────────── أداء المصادر (تشخيص) ─────────────
  // كل فتح عمل يُقاس: أول نتيجة، أول مطابقة، أول سيرفر، أول تشغيل صالح، لكل
  // مصدر. هنا تُعرض الأرقام، ومقياس يفتح عدة أفلام ومسلسلات واحدًا واحدًا.

  const ms = (v) => (v == null ? '—' : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`);
  const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

  /** يفتح العمل كما يفتحه الشخص (بحث متدفق + تجهيز + فحص) وينتظر حتى يكتمل أو 45 ثانية. */
  function measureOne(m, season) {
    return new Promise((resolve) => {
      const w = warmUp(m, season, m.type === 'movie' ? 1 : 1);
      const t0 = Date.now();
      const end = () => {
        clearTimeout(timer);
        w.listeners.delete(check);
        const run = { ...w.run.run };
        dropWarm();
        resolve(run);
      };
      const check = () => {
        if (w.done || w.missing || w.closed) end();
      };
      const timer = setTimeout(end, Math.max(0, 45_000 - (Date.now() - t0)));
      w.listeners.add(check);
      check();
    });
  }

  async function benchmark(onProgress) {
    const [movies, series] = await Promise.all([
      catalog('movie', 'top').catch(() => []),
      catalog('series', 'top').catch(() => []),
    ]);
    const picks = [...movies.slice(0, 4), ...series.slice(0, 3)];
    for (let i = 0; i < picks.length; i++) {
      const m = picks[i];
      onProgress?.(i, picks.length, m);
      // بلا ذاكرة سابقة: نقيس المسار الكامل لا المسار السريع
      const key = playKey(m, m.type === 'series' ? 1 : null);
      memory.forget(key);
      state.works.get(key)?.cancel?.();
      state.works.delete(key);
      await measureOne(m, m.type === 'series' ? 1 : null);
    }
    onProgress?.(picks.length, picks.length, null);
  }

  function openSourcesDebug() {
    deps.openSheet((body) => {
      const head = el('div', 'an-sheet-head');
      head.append(el('div', 'an-sheet-kicker', 'أداء المصادر'), text('div', 'an-sheet-title', 'السينما'));
      const note = el('p', 'cn-note', 'كل فتح عمل يُقاس هنا: من فتح الصفحة حتى أول تشغيل صالح، ولكل مصدر.');
      const actions = el('div', 'cn-perf-actions');
      const status = el('p', 'cn-perf-status');
      const host = el('div', 'cn-perf');
      body.append(head, note, actions, status, host);
      let closed = false;
      const paint = () => {
        if (closed) return;
        const runs = metrics.runs();
        const sources = metrics.sources();
        const table = (cols, rows) => {
          const t = el('table', 'cn-perf-table');
          const tr = el('tr');
          for (const c of cols) tr.append(el('th', null, c));
          t.append(tr);
          for (const r of rows) {
            const row = el('tr');
            for (const [i, v] of r.entries()) row.append(i === 0 ? text('td', null, v) : el('td', null, v));
            t.append(row);
          }
          return t;
        };
        if (!runs.length) {
          host.replaceChildren(el('p', 'cn-note', 'لا قياسات بعد — افتح أي فيلم أو مسلسل، أو اضغط «قِس الآن».'));
          return;
        }
        const ttfp = runs.map((r) => r.ttfp ?? r.ttfr).filter((v) => v != null).sort((a, b) => a - b);
        const mid = ttfp.length ? ttfp[Math.floor(ttfp.length / 2)] : null;
        const summary = el('div', 'cn-perf-sum');
        summary.append(
          el('b', null, `أول تشغيل صالح (الوسيط): ${ms(mid)}`),
          el('span', null, `${runs.length} فتحة · وجدنا تشغيلًا في ${runs.filter((r) => (r.ttfp ?? r.ttfr) != null).length}`),
        );
        host.replaceChildren(
          summary,
          el('h4', null, 'لكل مصدر'),
          table(
            ['المصدر', 'بحث', 'مطابقة', 'سيرفرات', 'أول صالح', 'نجاح', 'صالحة/ميتة'],
            sources.map((x) => [
              SOURCE_NAMES[x.id] ?? x.id,
              ms(x.searchMs),
              ms(x.matchMs),
              ms(x.serversMs),
              ms(x.firstPlayableMs),
              x.skipped === x.runs ? 'متخطّى' : pct(x.successRate),
              `${x.playableServers}/${x.deadServers}`,
            ]),
          ),
          ...sources.filter((x) => x.topError).map((x) => text('p', 'cn-perf-err', `${SOURCE_NAMES[x.id] ?? x.id}: ${x.topError}`)),
          el('h4', null, 'آخر الفتحات'),
          table(
            ['العمل', 'أول نتيجة', 'أول مطابقة', 'أول صالح', 'مصادر', 'سيرفرات', 'فشل'],
            runs.slice(0, 20).map((r) => [
              `${r.fast ? '⚡ ' : ''}${r.title ?? r.key}`,
              ms(r.ttfs),
              ms(r.ttfm),
              ms(r.ttfp ?? r.ttfr),
              `${r.sourcesOk}/${r.sourcesAsked}`,
              String(r.playable),
              pct(r.failRate),
            ]),
          ),
        );
      };
      const run = button('cn-btn cn-btn--play', `${glyph('play', { size: 16, filled: true })}<span>قِس الآن (7 أعمال)</span>`, async () => {
        if (!engine.available()) return toast('القياس داخل تطبيق أندرويد');
        run.disabled = true;
        try {
          await benchmark((i, n, m) => {
            if (closed) return;
            status.textContent = m ? `نقيس ${i + 1}/${n}: ${displayTitle(m)}…` : 'انتهى القياس';
            paint();
          });
        } finally {
          run.disabled = false;
          paint();
        }
      });
      const clear = button('cn-btn cn-btn--ghost', 'امسح القياسات', () => {
        metrics.clear();
        paint();
      });
      actions.append(run, clear);
      paint();
      return () => {
        closed = true;
      };
    }, { tone: 'cinema' });
  }

  /** فحص كل مصدر خطوة خطوة بعنوان هذا العمل: يقول أين يتعطّل بالضبط. */
  /**
   * تتبّع المطابقة لهذا العمل بعينه، مصدرًا مصدرًا: الهوية ← الاستعلامات ←
   * ردّ المصدر ← النسخ المرشحة بدرجتها وسبب رفضها ← المطابقة ← السيرفرات
   * وحالتها. من جلسة البحث نفسها، بلا طلبات جديدة؛ ثم الفحص العميق بالمحرك.
   */
  function diagnoseSheet(m) {
    const season = m.type === 'series' ? state.season : null;
    const h = state.works.get(playKey(m, season));
    const crit = h?.criteria ?? matchCriteria(m, { season });
    deps.openSheet((body) => {
      const head = el('div', 'an-sheet-head');
      head.append(el('div', 'an-sheet-kicker', 'فحص المصادر'), text('div', 'an-sheet-title', m.title));
      const id = el('ol', 'cn-diag-steps');
      const step = (cls, label, detail) => {
        const li = el('li', `cn-diag-${cls}`);
        li.append(el('b', null, label), text('span', null, detail ?? ''));
        return li;
      };
      id.append(
        step('ok', 'الهوية', [m.id, TYPE_AR[m.type], m.year, season ? `الموسم ${season}` : null].filter(Boolean).join(' · ')),
        step('ok', 'الأسماء', namesOf(m).join(' · ')),
      );
      if (crit.sharedNames?.length) id.append(step(crit.primary ? 'ok' : 'warn', 'إخوة الاسم', `${crit.primary ? 'الأشهر بينها' : 'يوجد عمل أشهر بنفس الاسم'} · سنواتهم ${crit.namesakeYears.join('، ') || '—'}`));
      id.append(step('ok', 'الاستعلامات', queriesFor(crit.title, crit).join(' | ')));
      const list = el('div', 'cn-diag');
      body.append(head, id, list);
      const warm = state.warm?.key === playKey(m, season) ? state.warm : null;
      const candidates = h?.candidates?.() ?? [];
      void (async () => {
        const all = (await engine.sources().catch(() => null)) ?? [];
        const mine = all.filter((x) => x.content === 'cinema' && x.enabled);
        if (!mine.length) {
          list.append(el('p', 'cn-note', 'لا مصادر سينما مفعّلة في المحرك — حدّث التطبيق.'));
          return;
        }
        for (const src of mine) {
          const box = el('section', 'cn-diag-src');
          box.append(el('h4', null, src.name ?? SOURCE_NAMES[src.id] ?? src.id));
          const steps = el('ol', 'cn-diag-steps');
          box.append(steps);
          list.append(box);
          const rec = h?.found?.sources?.[src.id];
          const st = searchState(rec);
          const cls = st === STATE.MATCHED ? 'ok' : st === STATE.SOURCE_RESPONDED_NO_MATCH ? 'warn' : st === STATE.SEARCHING ? 'wait' : 'fail';
          steps.append(step(cls, STATE_AR[st], rec ? [`${rec.items} نتيجة`, rec.searchMs != null ? `${rec.searchMs}ms` : null, rec.error].filter(Boolean).join(' · ') : ''));
          const judged = explainCopies(candidates.filter((c) => c.sourceId === src.id), crit).sort((a, b) => Number(b.ok) - Number(a.ok) || b.score - a.score);
          for (const j of judged.slice(0, 6)) {
            steps.append(step(j.ok ? 'ok' : 'fail', `${j.ok ? '✓' : '✗'} ${j.score.toFixed(2)}`, `${j.copy.title}${j.ok ? '' : ` — ${REJECT_AR[j.reason] ?? j.reason}`}`));
          }
          if (st === STATE.MATCHED && warm) {
            const routes = warm.routes.filter((r) => r.sourceId === src.id);
            const ps = playState(routes, { done: warm.done });
            steps.append(step(ps === STATE.PLAYABLE ? 'ok' : ps === STATE.SEARCHING ? 'wait' : 'fail', STATE_AR[ps], routes.map((r) => `${r.server ?? r.name ?? '؟'}${r.quality ? ` ${r.quality}p` : ''}: ${STATE_AR_ROUTE[r.state] ?? r.state}${r.state === 'READY' && r.probed !== true ? ' (لم يُفحص)' : ''}`).join(' · ')));
          }
          const deep = button('cn-link', 'فحص عميق', async () => {
            deep.disabled = true;
            const out = await engine.diagnose(src.id, crit.title).catch((e) => [{ label: 'الفحص', state: 'fail', detail: String(e?.message ?? e) }]);
            deep.replaceWith(...(out ?? []).map((x) => step(x.state, x.label, x.detail ?? '')));
          });
          steps.append(deep);
        }
      })();
    }, { tone: 'cinema' });
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
        state.works.get(playKey(m, season))?.cancel?.();
        state.works.delete(playKey(m, season));
        dropWarm();
        void paintSources(m, season);
        startWarm(m);
      });
    if (!found || !found.copies.length) {
      host.dataset.state = 'none';
      // «لم ترد» فقط لمصادر صامتة فعلًا؛ مصدر ردّ ولم نطابق فيه هذا العمل يُقال كذلك
      const st = found ? overallSearchState(found.sources) : null;
      const msg = !found
        ? 'تعذّر البحث في المصادر — تحقّق من الاتصال'
        : st === STATE.SOURCE_RESPONDED_NO_MATCH
          ? m.type === 'series' ? `ردّت المصادر، والموسم ${season} من هذا المسلسل غير موجود فيها حاليًا` : 'ردّت المصادر، وهذا الفيلم بعينه غير موجود فيها حاليًا'
          : st === STATE.SOURCE_ERROR
            ? 'المصادر ردّت بخطأ الآن'
            : 'المصادر لم ترد في الوقت';
      const row = el('div', 'cn-sources-row');
      row.append(el('i', 'cn-dot'), el('span', null, msg), retry());
      const nodes = [row];
      if (found?.near?.length) {
        const near = el('div', 'cn-near');
        near.append(el('span', 'cn-near-label', 'نتائج قريبة — اختر الصحيح:'));
        for (const c of found.near) {
          const b = button('cn-near-item', '', async () => {
            b.disabled = true;
            pinnedHandle(m, season, c);
            dropWarm();
            await paintSources(m, season);
            const p = resumePoint(m);
            if (m.type === 'movie' || p.season === season) warmUp(m, season, m.type === 'movie' ? 1 : p.episode);
          });
          b.append(text('b', null, c.title), el('span', null, SOURCE_NAMES[c.sourceId] ?? c.sourceId));
          near.append(b);
        }
        nodes.push(near);
      }
      nodes.push(button('cn-link cn-diag-open', 'افحص المصادر', () => diagnoseSheet(m)));
      host.replaceChildren(...nodes);
      return;
    }
    host.dataset.state = 'found';
    // السطر نفسه يكبر مع كل مصدر يرد، ويقول «جاهز للتشغيل» لحظة يجهز أول سيرفر
    const line = el('span');
    host.replaceChildren(el('i', 'cn-dot'), line);
    const h = state.works.get(playKey(m, season));
    const paint = () => {
      if (!line.isConnected) return false;
      const names = [...new Set(found.copies.map((c) => SOURCE_NAMES[c.sourceId] ?? c.sourceId))];
      const w = state.warm?.key === playKey(m, season) ? state.warm : null;
      const ready = w ? w.routes.filter((r) => r.state === 'READY' && r.probed === true).length : 0;
      line.textContent = `مترجم · متاح عبر ${names.join('، ')}${ready ? ` · جاهز للتشغيل (${ready})` : ''}`;
      return true;
    };
    paint();
    const offCopies = h?.onCopies?.(() => paint() || offCopies?.());
    const w = state.warm;
    if (w?.key === playKey(m, season)) {
      const listener = () => paint() || w.listeners.delete(listener);
      w.listeners.add(listener);
    }
  }

  /** تجهيز ما ستشاهده من هذه الصفحة: الفيلم، أو حلقة المتابعة في موسمها الظاهر. */
  function startWarm(m) {
    if (!engine.available() || !m?.id) return;
    const p = resumePoint(m);
    if (m.type === 'series' && p.season !== state.season) return;
    warmUp(m, m.type === 'series' ? p.season : null, m.type === 'movie' ? 1 : p.episode);
  }

  // ───────────── صفحة العمل ─────────────

  async function openWork(m, { autoplay = false } = {}) {
    const token = ++state.token;
    // عمل آخر: جلسة العمل السابق الدافئة تُغلق (روابطها لا تخصّ هذا)
    if (state.warm && String(state.warm.key).split(':')[0] !== String(m.id)) dropWarm();
    state.detail = m;
    state.season = m.type === 'series' ? (watchAll()[m.id]?.season ?? null) : null;
    deps.showPage('cinema');
    window.scrollTo?.(0, 0);
    renderDetail(m, { partial: true });
    let fetched;
    try { fetched = String(m.id).startsWith("addon-") ? await deps.restoreSourceWork(`cinema:${m.id}`, m) : m._sourceCopy ? m : await prefetch(m); }
    catch (error) { if (token === state.token) toast(error.message); return; }
    if (token !== state.token) return;
    // التفاصيل تُقبل لنفس المعرّف والنوع فقط، والاسم الذي ضغطه الشخص يبقى اسم الصفحة
    const full = mergeWork(m, fetched);
    if (!full) {
      q('cinemaBody')?.append(emptyBox('offline', 'تعذّر جلب التفاصيل', 'تحقّق من الاتصال ثم افتح العمل من جديد.'));
      return;
    }
    if (full.type === 'series' && !full.seasons?.some((s) => s.n === state.season)) state.season = full.seasons?.find((s) => s.n !== 0)?.n ?? full.seasons?.[0]?.n ?? 1;
    state.detail = full;
    senseSeries(full);
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
    if (deps.openWorkMenu) {
      const more = button('icon-btn cn-detail-more', glyph('more'), () => deps.openWorkMenu({ ref: `cinema:${m.id}`, title: displayTitle(m), cover: m.poster ?? null }), 'خيارات العمل');
      bar.append(more);
    }

    const art = el('div', 'cn-detail-art');
    art.append(image(m.background ?? m.poster, 'cn-img', { eager: true, hero: true }));

    const body = el('div', 'cn-detail-body');
    body.id = 'cinemaBody';
    body.append(titleMark(m, 'cn-detail-mark'));
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

      if (m.description) {
        // القصة بالعربية: المحفوظ فورًا، وإلا هيكل خفيف حتى تصل من الخادم (والإنجليزي إن تعذّرت)
        const about = el('section', 'cn-about');
        const ar = cachedOverview(m.id, m.description);
        const p = el('p', `cn-synopsis clamped${ar ? '' : ' cn-pending'}`, ar ?? '');
        p.dataset.overview = m.id;
        p.dir = 'rtl';
        const more = button('cn-link', 'المزيد', () => {
          const closed = p.classList.toggle('clamped');
          more.textContent = closed ? 'المزيد' : 'أقل';
        });
        about.append(p, more);
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
      startWarm(m);
      void paintSources(m, m.type === 'series' ? state.season : null);
      void arabize(m, m.type === 'series' ? state.season : null);
      revealIn(wrap);
    }
  }

  /** «قد يعجبك»: الأشهر من نفس النوع الأول، بلا العمل نفسه. */
  async function similar(m, token) {
    const genre = m.genres?.[0];
    if (!genre) return;
    try {
      const list = (await catalog(m.type, 'top', { genre })).filter((x) => x.id !== m.id).slice(0, 14);
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
          void arabize(m, s.n);
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
      if (e.overview) {
        const key = `${m.id}:${season.n}:${e.n}`;
        const ar = cachedOverview(key, e.overview);
        const over = el('span', `cn-ep-over${ar ? '' : ' cn-pending'}`, ar ?? '');
        over.dataset.overview = key;
        over.dir = 'rtl';
        copy.append(over);
      }
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

      const tileNodes = new Map();
      const groupNodes = new Map();
      const routeGroups = new Map();
      const deadFold = el('details', 'cn-srv-dead');
      const deadSummary = el('summary');
      const deadGrid = el('div', 'an-srv-grid');
      deadFold.append(deadSummary, deadGrid);
      // بعد أول سيرفر جاهز: ما زال يُفحص (غالبًا عبر المتصفح المخفي، بطيء) يُطوى
      // فلا تمتلئ الورقة بانتظار لا يُعرف آخره
      const waitFold = el('details', 'cn-srv-dead cn-srv-wait');
      const waitSummary = el('summary');
      const waitGrid = el('div', 'an-srv-grid');
      waitFold.append(waitSummary, waitGrid);
      const paint = () => {
        queued = false;
        if (sheet.closed) return;
        const ready = sheet.routes.filter((r) => r.state === 'READY' && r.probed === true).length;
        // كل سيرفر معروف انتهى (فشل) والبحث في المصادر انتهى: لا انتظار بلا نهاية
        // ولو لم تُعلن جلسة التجهيز انتهاءها (كانت الورقة تبقى على «نجهّز أول سيرفر»)
        const pendingRoute = sheet.routes.some((r) => r.state === 'RESOLVING' || (r.state === 'READY' && r.probed == null));
        const settled = sheet.done || (sheet.routes.length > 0 && !pendingRoute && sheet.found?.done === true);
        if (sheet.missing) status.textContent = m.type === 'series' ? `الموسم ${season} غير متوفر في المصادر العربية حاليًا` : 'غير متوفر في المصادر العربية حاليًا';
        else if (!sheet.session) status.innerHTML = '<i class="an-sources-spin"></i><span>نبحث في المصادر العربية…</span>';
        else if (!settled && !ready) status.innerHTML = '<i class="an-sources-spin"></i><span>نجهّز أول سيرفر…</span>';
        else status.textContent = ready ? `${ready} ${ready === 1 ? 'سيرفر جاهز' : 'سيرفرات جاهزة'}${settled ? '' : ' · البقية تصل بالخلفية'}` : 'لم يجهز أي سيرفر الآن';
        best.disabled = sheet.busy || sheet.missing || (!ready && settled);
        best.innerHTML = `${glyph('play', { size: 20, filled: true })}<span>${sheet.busy ? 'نجهّز أفضل سيرفر…' : 'شغّل الأفضل'}</span>`;
        best.classList.toggle('waiting', !ready && !settled && !sheet.missing);
        // الحيّ أولًا، والسيرفرات التي فشلت هنا مؤخرًا في آخر مجموعتها، والميت مطويّ
        const live = sheet.routes.filter((r) => r.state !== 'UNAVAILABLE' && r.state !== 'FAILED' && r.probed !== false);
        const dead = sheet.routes.filter((r) => r.state === 'UNAVAILABLE' || r.state === 'FAILED' || r.probed === false);
        const tile = (r) => {
          let b = tileNodes.get(r.id);
          if (!b) {
            b = el('button'); b.type = 'button';
            b.innerHTML = '<span class="an-srv-top"><b class="an-srv-code"></b><span class="an-srv-tag"></span></span><span class="an-srv-state"><i class="an-srv-dot"></i><span></span></span>';
            tileNodes.set(r.id, b);
          }
          const verified = r.state === 'READY' && r.probed === true;
          const pending = r.state === 'RESOLVING' || (r.state === 'READY' && r.probed == null);
          b.className = `an-srv an-srv--${pending ? 'resolving' : r.state.toLowerCase()}`;
          b.disabled = pending;
          b.querySelector('.an-srv-code').textContent = serverName(r);
          b.querySelector('.an-srv-tag').textContent = SOURCE_NAMES[r.sourceId] ?? r.sourceId;
          b.querySelector('.an-srv-state > span').textContent = pending ? 'نفحص التشغيل…' : r.probed === false ? 'غير متاح' : STATE_AR_ROUTE[r.state] ?? '';
          b.onclick = () => verified ? void playRoute(r) : toast(r.reason || 'لم ينجح فحص رابط الفيديو', 5000);
          return b;
        };
        const isPending = (r) => r.state === 'RESOLVING' || (r.state === 'READY' && r.probed == null);
        const waiting = ready ? live.filter(isPending) : [];
        for (const r of live) {
          if (ready && isPending(r)) continue;
          let group = routeGroups.get(r.id);
          if (!group) { group = engine.groupRoutes([r])[0]?.[0] ?? 'السيرفرات'; routeGroups.set(r.id, group); }
          if (!groupNodes.has(group)) {
            const g = el('section', 'an-srv-group');
            const grid = el('div', 'an-srv-grid');
            g.append(el('h4', 'an-srv-q', group), grid);
            groupNodes.set(group, grid);
            list.insertBefore(g, deadFold.parentNode === list ? deadFold : null);
          }
          const grid = groupNodes.get(group), b = tile(r);
          if (b.parentNode !== grid) grid.append(b);
        }
        for (const r of waiting) { const b = tile(r); if (b.parentNode !== waitGrid) waitGrid.append(b); }
        if (waiting.length) {
          waitSummary.textContent = `تُجهَّز بالخلفية (${waiting.length})`;
          if (waitFold.parentNode !== list) list.insertBefore(waitFold, deadFold.parentNode === list ? deadFold : null);
        } else if (waitFold.parentNode === list) waitFold.remove();
        // مجموعة جودة صار كل ما فيها مطويًا: لا عنوان فوق شبكة فارغة
        for (const grid of groupNodes.values()) grid.parentNode.hidden = !grid.children.length;
        if (dead.length) {
          deadSummary.textContent = `غير متاح (${dead.length})`;
          for (const r of dead) { const b = tile(r); if (b.parentNode !== deadGrid) deadGrid.append(b); }
          if (deadFold.parentNode !== list) list.append(deadFold);
        }
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

      // الورقة تتبنّى الجلسة الدافئة (بدأت مع فتح العمل)، أو تبدأها الآن
      const w = warmUp(m, season, n);
      sheet.warm = w;
      const sync = () => {
        if (sheet.closed) return;
        sheet.session = w.session;
        sheet.routes = w.routes;
        sheet.done = w.done;
        sheet.missing = w.missing;
        sheet.found = w.handle.found;
        if (w.error && !w.routes.length) status.textContent = `تعذّر تجهيز السيرفرات: ${w.error}`;
        queuePaint();
      };
      w.listeners.add(sync);
      off.push(() => w.listeners.delete(sync));
      sync();

      return () => {
        sheet.closed = true;
        for (const f of off) f();
        off = [];
        // الجلسة تبقى دافئة لصفحة العمل؛ تُغلق حين تغادر العمل أو تنتهي صلاحيتها
      };
    }, { tone: 'cinema', full: true });

    async function launch(candidate, code) {
      sheet.launched = true;
      const w = sheet.warm;
      // الجلسة صارت للمشغّل: لا تُغلق من هنا، والتجهيز القادم يبدأ جلسة جديدة
      if (w) {
        w.launched = true;
        if (state.warm === w) state.warm = null;
        for (const f of w.off) f();
        w.off = [];
        w.run?.save();
        const route = w.routes.find((r) => r.code === code) ?? null;
        if (route) memory.rememberServer(playKey(m, season), { sourceId: route.sourceId, server: route.server, code });
      }
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
      recordView(m, season, m.type === 'movie' ? 1 : n);
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
        subtitleIdentity: { canonicalId: m.canonicalId ?? `cinema:${m.id}`, kind: m.type, externalIds: m.externalIds ?? { imdb: /^tt\d+$/.test(m.id) ? m.id : null }, season, episode: n },
        usageUserId: currentUser(),
        episode: m.type === 'movie' ? 1 : n,
        total: m.type === 'series' ? eps.length : 1,
        position,
        poster: m.poster ?? null,
        friends: [],
        copies: sheet.warm?.copies ?? sheet.found.copies,
        resume,
        presenceEndpoint: presence?.endpoint ?? null,
        presenceAuthorization: presence?.authorization ?? null,
        presenceUserId: presence?.userId ?? null,
        presenceDeviceId: presence?.deviceId ?? null,
        presenceDeviceCredential: presence?.deviceCredential ?? null,
      });
    }
  }

  const completed = new Set();
  function completeOnce(m, season, n) {
    const k = `${me()}:${m.id}:${season ?? 0}:${n}`;
    if (!me() || completed.has(k)) return;
    completed.add(k);
    sync?.enqueue('episode.complete', { ...descriptor(m), episode: m.type === 'movie' ? 1 : n, ...(m.type === 'movie' ? { movie: true } : { season }) });
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
    if (p.duration > 0) {
      recordWatch(cur.m, cur.m.type === 'series' ? cur.season : 0, n, p.position, p.duration);
      // «أنهى S02E03» / «أنهى فيلم» للأصدقاء (حسب خصوصيتك في الخادم)، مرة لكل حلقة
      const ratio = p.watchedRatio ?? (nativeFollowTime() ? 0 : p.position / p.duration);
      if (ratio >= 0.9) completeOnce(cur.m, cur.m.type === 'series' ? cur.season : null, n);
    }
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
      if (token !== state.discover.token) return;
      if (query) peerResults.set(peerKey(query), Promise.resolve(items));
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
    // نفس شرائح «مكتبتي» في المانجا والأنمي: الاسم وعدده (قانون التوحيد)
    const tabs = el('div', 'segmented library-tabs');
    tabs.setAttribute('role', 'tablist');
    const countOf = (k) => (k === 'continue' ? continuing().length : shelf(k).length);
    for (const [k, label] of [['later', 'قائمتي'], ['continue', 'آخر المشاهدات'], ['fav', 'المفضلة']]) {
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
    const tab = state.libraryTab;
    const items = tab === 'continue' ? continuing() : shelf(tab);
    const grid = el('div', tab === 'continue' ? 'cn-wide-grid' : 'cn-grid');
    grid.append(...items.map((m) => (tab === 'continue' ? continueCard(m) : posterCard(m))));
    const empty = {
      continue: ['play', 'لم تشاهد شيئًا بعد', 'ما تبدأ مشاهدته يظهر هنا لتكمله من حيث وقفت.'],
      later: ['plus', 'قائمتك فاضية', 'أضف أي فيلم أو مسلسل بزر «قائمتي».'],
      fav: ['heart', 'لا مفضلات بعد', 'علّم ما تحب بزر القلب.'],
    }[tab];
    host.replaceChildren(tabs, items.length ? grid : emptyBox(...empty));
  }

  return { show, loadHome, openWork, showDiscover, renderLibrary, openDiscover, openSourcesDebug };
}
