/**
 * الرئيسية الموحدة (التصميم المعتمد من المالك): بلا حاويات، بلا ألوان أنواع، كل قسم في مكانه.
 *
 *   البنر: غلاف واحد في المنتصف، والحرير خلفه بلون الغلاف (لون AniList/اللون المحفوظ، فلا قراءة
 *   بكسلات ولا مشكلة CORS). التبديل يحرّك الغلاف والمعلومات في مكانها، فارتفاع البنر ثابت.
 *   الفلتر نص فقط. «تابع» مختلط. جدول البث للأنمي. آخر التحديثات للمانجا والمسلسلات. الرائج مفصول بالنوع.
 *   «الكل» يفتح صفحة فرعية بلا الشريط العلوي.
 *
 * العرض فقط: لا يكتب في المكتبة ولا التقدم. البيانات تأتي من `data` (القشرة تملكها).
 */
import { createSilk } from '../lib/silk.js';
import { paletteFromAccent } from '../lib/silk-palette.js';
import { agoAr } from './updates-view.js';

export const UNIFIED_FILTERS = Object.freeze([['all', 'الكل'], ['manga', 'المانجا'], ['anime', 'الأنمي'], ['cinema', 'السينما']]);
const FILTER_KEY = 'vantara.unified.filter.v1';
const KIND_AR = { manga: 'مانجا', anime: 'أنمي', movie: 'فيلم', series: 'مسلسل', cinema: 'سينما' };
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function readFilter(storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage?.getItem(FILTER_KEY) ?? 'null'); return UNIFIED_FILTERS.some(([k]) => k === v) ? v : 'all'; } catch { return 'all'; }
}
function writeFilter(v, storage = globalThis.localStorage) { try { storage?.setItem(FILTER_KEY, JSON.stringify(v)); } catch { /* تفضيل لا أكثر */ } }
const sectionOf = (kind) => (kind === 'movie' || kind === 'series' || kind === 'cinema' ? 'cinema' : kind);
export const passes = (kind, filter) => filter === 'all' || sectionOf(kind) === filter;

/** البنر: يتناوب أنمي، مانجا، سينما، بلا تكرار نوع متتاليًا إلا إن نفد غيره. */
export function heroOrder(pools, filter, max = 7) {
  const order = filter === 'all' ? ['anime', 'manga', 'cinema'] : [filter];
  const out = [];
  for (let i = 0; out.length < max && i < 20; i++) for (const s of order) if (pools[s]?.[i] && out.length < max) out.push(pools[s][i]);
  return out;
}

/** وقت مكة: اليوم يبدأ في السعودية. */
const riyadhDay = (ms) => Math.floor((ms + 3 * 3600_000) / 86_400_000);
function clock(ms) {
  const d = new Date(ms + 3 * 3600_000);
  let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, '0');
  const ap = h < 12 ? 'ص' : 'م'; h = h % 12 || 12;
  return [`${h}:${m}`, ap];
}
export function until(ms, now = Date.now()) {
  const m = Math.max(1, Math.round((ms - now) / 60_000));
  if (m < 60) return `بعد ${m} د`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `بعد ${h} س ${r} د` : `بعد ${h} س`;
}
export function ago(ms, now = Date.now()) {
  const m = Math.max(1, Math.round((now - ms) / 60_000));
  if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60);
  return h < 24 ? `قبل ${h} س` : h < 48 ? 'أمس' : `قبل ${Math.round(h / 24)} أيام`;
}
/** حلقات اليوم (بتوقيت مكة): القادمة أولًا بترتيبها، ثم ما نزل الأحدث فالأقدم. */
export function dayLineup(week, offset, now = Date.now()) {
  const day = riyadhDay(now) + offset;
  const list = (week ?? []).filter((e) => riyadhDay(e.airingAt) === day);
  if (offset !== 0) return list;
  return [...list.filter((e) => e.airingAt > now), ...list.filter((e) => e.airingAt <= now).reverse()];
}

export function createUnifiedView({ el, glyph, data, open, genreAr = (g) => g, reducedMotion = () => false, now = () => Date.now() }) {
  const gen = (list) => (list ?? []).slice(0, 2).map(genreAr).join('، ');
  const st = { filter: readFilter(), hero: 0, day: 0, sub: null, subTab: 'all', upd: 'all', airDay: null, airScrolled: false };
  let host = null, silk = null, silkWrap = null, timer = 0, overlay = null, suspended = false, suspendedScroll = 0;
  const savedBodies = new Map();
  const bodyKey = () => `${st.filter}:${st.filter === 'all' ? st.upd : ''}`;
  const trendIdentities = new WeakMap();
  let nextTrendIdentity = 0;
  const trendFingerprint = (list) => JSON.stringify((list ?? []).slice(0, 12).map((item) => {
    const source = item?.raw ?? item;
    let identity = null;
    if (source && typeof source === 'object') {
      if (!trendIdentities.has(source)) trendIdentities.set(source, ++nextTrendIdentity);
      identity = trendIdentities.get(source);
    }
    return [identity, item?.title, item?.poster, item?.cover, item?.score, item?.rating, item?.year, item?.chapters];
  }));

  const txt = (tag, cls, s) => { const n = el(tag, cls, s ?? ''); if (s && /[A-Za-z]/.test(s)) n.dir = 'auto'; return n; };
  const img = (src, cls, alt = '') => {
    if (!src) return el('span', cls);
    const i = el('img', cls); i.alt = alt; i.loading = 'lazy'; i.decoding = 'async'; i.src = src;
    i.onerror = () => { i.style.visibility = 'hidden'; };
    return i;
  };
  /**
   * صورة البطاقة: المانجا من محمّل صور القشرة (mountImage: ترويسات المصدر والبدائل والغلاف الموحّد)، لأن
   * أغلفة المصادر لا تُحمَّل بـ<img> مجرد فتبقى البطاقة هيكلًا للأبد؛ والأنمي والسينما بصورة مباشرة.
   */
  const fill = (art, x, kind, src, alt = '') => {
    if (kind === 'manga' && data.cover?.(art, x)) return art;
    art.append(img(src, 'uv-img', alt));
    return art;
  };
  const head = (title, go, more = 'الكل') => {
    const h = el('header', 'uv-sh');
    h.append(el('h2', null, title));
    if (go) { const b = el('button', 'uv-all'); b.type = 'button'; b.innerHTML = `${more}${glyph('chevron', { size: 16 })}`; b.onclick = go; h.append(b); }
    return h;
  };
  const rail = (cls = '') => el('div', `uv-rail ${cls}`);
  const sk = (w, h, cls = '') => { const s = el('i', `uv-sk ${cls}`); s.style.width = typeof w === 'number' ? `${w}px` : w; s.style.height = `${h}px`; return s; };

  /* ───── البنر ───── */
  function heroPools() {
    const a = data.animeHome()?.trending ?? [];
    const m = data.mangaPopular() ?? [];
    const c = [...(data.cinema()?.movie ?? []), ...(data.cinema()?.series ?? [])].filter((x) => (x.rating ?? 0) >= 6.8);
    return {
      anime: a.filter((x) => x.poster).map((x) => ({ kind: 'anime', title: x.title, cover: x.poster, color: x.color, logo: data.animeLogo?.(x.id) ?? null, meta: [x.score ? x.score.toFixed(1) : '', gen(x.genres)], go: () => open.anime(x) })),
      manga: m.filter((x) => x.cover).map((x) => ({ kind: 'manga', title: x.title, cover: x.cover, color: x.color ?? null, meta: [x.score ? Number(x.score).toFixed(1) : '', gen(x.genres)], go: () => open.manga(x) })),
      cinema: c.filter((x) => x.poster).map((x) => ({ kind: x.type, title: x.title, cover: x.poster, logo: x.logo || (/^tt\d+$/.test(x.id) ? `https://images.metahub.space/logo/medium/${x.id}/img` : null), color: null, meta: [x.year ?? '', x.rating ? x.rating.toFixed(1) : '', gen(x.genres)], go: () => open.cinema(x) })),
    };
  }
  function tint(item) {
    if (!silk) return;
    const c = item?.color && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : { manga: '#6f56c8', anime: '#3d6fd0', movie: '#b8484f', series: '#b8484f' }[item?.kind] ?? '#5b46a8';
    silk.setPalette(paletteFromAccent(c));
  }
  function heroInfo(x, on) {
    const box = el('div', `uv-hi${on ? ' on' : ''}`);
    const meta = el('p', 'uv-hmeta');
    [KIND_AR[x.kind], ...x.meta].filter(Boolean).forEach((m, i) => { if (i) meta.append(el('i')); meta.append(txt('span', null, String(m))); });
    const mark = el('div', 'uv-hmark');
    if (x.logo) { const l = img(x.logo, 'uv-hlogo', x.title); l.onerror = () => l.replaceWith(txt('h3', 'uv-htitle', x.title)); mark.append(l); }
    else mark.append(txt('h3', 'uv-htitle', x.title));
    const acts = el('div', 'uv-hacts');
    const go = el('button', 'uv-btn'); go.type = 'button';
    go.innerHTML = `${glyph(x.kind === 'manga' ? 'book' : 'play', { size: 19, filled: x.kind !== 'manga' })}<span>${x.kind === 'manga' ? 'اقرأ' : 'شاهد'}</span>`;
    go.onclick = x.go;
    acts.append(go);
    box.append(meta, mark, acts);
    return box;
  }
  function renderHero() {
    const list = heroOrder(heroPools(), st.filter);
    const sec = el('section', 'uv-hero');
    if (!list.length) {
      const reel = el('div', 'uv-reel'); reel.append(sk(200, 300, 'uv-rc-sk'));
      const info = el('div', 'uv-hinfo'); const hi = el('div', 'uv-hi on'); hi.append(sk(120, 12), el('div', 'uv-hmark'), sk(132, 48, 'uv-btn-sk'));
      hi.children[1].append(sk('60%', 30)); info.append(hi);
      sec.append(reel, info, el('div', 'uv-hidx'));
      return sec;
    }
    st.hero %= list.length;
    const reel = el('div', 'uv-reel');
    const info = el('div', 'uv-hinfo');
    const idx = el('div', 'uv-hidx');
    list.forEach((x, k) => {
      const c = el('button', `uv-rc${k === st.hero ? ' on' : ''}`); c.type = 'button'; c.setAttribute('aria-label', x.title);
      c.append(img(x.cover, 'uv-rcimg', x.title)); c.onclick = () => (k === st.hero ? x.go() : setHero(k));
      reel.append(c);
      info.append(heroInfo(x, k === st.hero));
      const d = el('button', k === st.hero ? 'on' : ''); d.type = 'button'; d.setAttribute('aria-label', `${k + 1} من ${list.length}`); d.append(el('i')); d.onclick = () => setHero(k);
      idx.append(d);
    });
    let sx = null;
    reel.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    // RTL (قرار المالك): السحب يمينًا يأتي بالتالي من اليسار، والخطوط تتقدّم من اليمين لليسار. كان بمنطق الإنجليزية
    reel.addEventListener('pointerup', (e) => {
      if (sx == null) return; const dx = e.clientX - sx; sx = null;
      if (Math.abs(dx) <= 40) return;
      const forward = isRtl(reel) ? dx > 0 : dx < 0;
      setHero(st.hero + (forward ? 1 : -1), forward ? 1 : -1);
    });
    sec.append(reel, info, idx);
    sec._list = list;
    queueMicrotask(() => tint(list[st.hero]));
    return sec;
  }
  const isRtl = (node) => (node?.ownerDocument?.defaultView?.getComputedStyle?.(node)?.direction ?? 'rtl') === 'rtl';
  function setHero(n, dir) {
    const h = host?.querySelector('.uv-hero'); const list = h?._list; if (!list?.length) return;
    const prev = st.hero, next = ((n % list.length) + list.length) % list.length; if (prev === next) return;
    dir ??= next > prev ? 1 : -1;
    st.hero = next;
    const rc = h.querySelectorAll('.uv-rc'), hi = h.querySelectorAll('.uv-hi'), dots = h.querySelectorAll('.uv-hidx button');
    rc.forEach((e) => { e.classList.remove('on', 'out', 'from'); });
    // اتجاه الحركة على الشاشة: التالي يدخل من جهة القراءة التالية (اليسار في العربية)
    const vis = isRtl(h) ? -dir : dir;
    rc[prev].style.setProperty('--dir', vis); rc[prev].classList.add('out');
    rc[next].style.setProperty('--dir', vis); rc[next].classList.add('from');
    void rc[next].offsetWidth; rc[next].classList.remove('from'); rc[next].classList.add('on');
    hi.forEach((e, k) => e.classList.toggle('on', k === next));
    dots.forEach((e, k) => e.classList.toggle('on', k === next));
    tint(list[next]);
  }

  /* ───── الفلتر ───── */
  function tabs(cur, list, onPick) {
    const n = el('nav', 'uv-tabs'); n.setAttribute('role', 'tablist');
    for (const [k, l] of list) {
      const b = el('button', cur === k ? 'on' : '', l); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(cur === k));
      b.onclick = () => onPick(k); n.append(b);
    }
    return n;
  }

  /* ───── جدول البث (الأنمي) ───── */
  function airRow(e) {
    const t = now(); const done = e.airingAt <= t; const [hm, ap] = clock(e.airingAt);
    const li = el('li', `uv-ar${done ? ' done' : ''}`);
    const time = el('time'); time.append(el('span', null, hm), el('small', null, ap));
    const b = el('button', 'uv-ar-b'); b.type = 'button';
    b.append(img(e.poster, 'uv-ar-img', e.title));
    const tt = el('span', 'uv-ar-t'); tt.append(txt('b', 'uv-t1', e.title), el('span', 'uv-t2', `أنمي · حلقة ${e.episode}`));
    b.append(tt, el('span', 'uv-ar-s', done ? 'متاحة' : until(e.airingAt, t)));
    b.onclick = () => open.anime(e);
    li.append(time, b);
    return li;
  }
  function airCard(e) {
    const t = now(); const done = e.airingAt <= t; const [hm, ap] = clock(e.airingAt);
    const a = el('button', `uv-po uv-ac${done ? ' done' : ''}`); a.type = 'button';
    const art = el('span', 'uv-art'); art.append(img(e.poster, 'uv-img', e.title));
    art.append(el('span', 'uv-ep', `حلقة ${e.episode}`));
    const line = el('span', 'uv-t2');
    // بعد أكثر من يوم يكفي الوقت (عنوان اليوم فوقه)، وإلا «بعد…» أو «متاحة»
    const far = !done && e.airingAt - t > 86_400_000;
    line.append(el('em', null, `${hm} ${ap}`));
    if (!far) line.append(document.createTextNode(` · ${done ? 'متاحة' : until(e.airingAt, t)}`));
    a.append(art, txt('b', 'uv-t1', e.title), line);
    a.onclick = () => open.anime(e);
    return a;
  }
  /* ───── جدول البث بتصميم Stable (anime.js على main): أيام بخط تحت المختار، وبطاقات عريضة 16:9
   * والوقت والحلقة تحت الصورة. الصورة: بنر الأنمي، وإلا لقطة الحلقة، وإلا الغلاف؛ تُحسم قبل الظهور. ───── */
  const clock12 = (ts) => new Date(ts).toLocaleTimeString('ar', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' });
  const meccaKey = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  function airDayLabel(key, today) {
    const d = Math.round((Date.parse(key) - Date.parse(today)) / 86_400_000);
    if (d === 0) return 'اليوم';
    if (d === -1) return 'أمس';
    if (d === 1) return 'غدًا';
    return new Date(`${key}T12:00:00Z`).toLocaleDateString('ar', { weekday: 'long', timeZone: 'UTC' });
  }
  /** «بعد 5 ساعات» / «نزلت قبل ساعتين»: كلمات كاملة كما في الأنمي. */
  function airWhen(at, t) {
    const past = at <= t;
    const m = Math.max(1, Math.round(Math.abs(at - t) / 60_000));
    const h = Math.round(m / 60);
    const span = m < 60 ? (m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : m <= 10 ? `${m} دقائق` : `${m} دقيقة`)
      : h < 24 ? (h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h <= 10 ? `${h} ساعات` : `${h} ساعة`)
        : (Math.round(h / 24) === 1 ? 'يوم' : `${Math.round(h / 24)} أيام`);
    return past ? `نزلت قبل ${span}` : `بعد ${span}`;
  }
  const slotArt = new Map();
  /** صورة البطاقة العريضة: البنر فورًا، وإلا تُطلب لقطة الحلقة (بمهلة) ثم الغلاف. لا تبديل بعد الظهور. */
  /**
   * صورة البطاقة العريضة بسلسلة بنر الأنمي نفسها (anime-today.js، wideCandidates): الخلفية الرسمية من metahub
   * بمعرّف IMDb، ثم fanart، ثم لقطة الحلقة، ثم بنر AniList، والغلاف آخرًا. تُحسم قبل الظهور (مهلة 4ث، والطلب يبدأ مع وصول الجدول
   * للمعرّفات)، وإن تعذّر تحميل صورة تُجرَّب التالية، فلا تبديل صورة ظاهرة بأخرى.
   */
  function slotImage(e, box) {
    const show = (list) => {
      const chain = [...new Set(list.filter(Boolean))];
      if (!chain.length) return;
      const [src, ...rest] = chain;
      const i = el('img', 'uv-slot-img');
      i.alt = '';
      i.decoding = 'async';
      i.loading = 'lazy';
      i.onload = () => {
        // بعض الخلفيات تردّ بصورة فارغة صغيرة بدل 404
        if (rest.length && i.naturalWidth && i.naturalWidth < 200) { i.remove(); show(rest); return; }
        i.classList.add('in');
      };
      i.onerror = () => { i.remove(); show(rest); };
      if (src === e.poster) i.style.objectPosition = 'center 22%';
      i.src = src;
      box.append(i);
    };
    const tail = [e.banner, e.poster];
    if (!data.animeArt) return show(tail);
    if (!slotArt.has(e.id)) {
      const request = Promise.resolve().then(() => data.animeArt(e.id)).catch(() => null).then((art) => {
        if (!art && slotArt.get(e.id) === request) slotArt.delete(e.id);
        return art;
      });
      slotArt.set(e.id, request);
      while (slotArt.size > 100) slotArt.delete(slotArt.keys().next().value);
    }
    let deadline;
    const fallback = new Promise((resolve) => { deadline = setTimeout(() => resolve(null), 4000); });
    void Promise.race([slotArt.get(e.id), fallback]).then((art) => {
      clearTimeout(deadline);
      const list = [];
      if (/^tt\d+$/.test(art?.imdb ?? '')) list.push(`https://images.metahub.space/background/medium/${art.imdb}/img`);
      list.push(art?.fanart);
      const shot = art ? data.episodeStill?.(e, e.episode, art, { width: 290, dpr: globalThis.devicePixelRatio || 1 }) : null;
      if (shot?.still) list.push(shot.src);
      show([...list, ...tail]);
    });
  }
  function slot(e) {
    const t = now();
    const aired = e.airingAt <= t;
    const c = el('button', `uv-slot${aired ? ' aired' : ''}`);
    c.type = 'button';
    c.setAttribute('aria-label', `${e.title} — الحلقة ${e.episode}`);
    const art = el('span', 'uv-slot-art');
    if (e.color) art.style.setProperty('--art', e.color);
    slotImage(e, art);
    const line = el('span', 'uv-slot-line');
    line.append(el('b', 'uv-slot-time', clock12(e.airingAt)), el('span', null, `الحلقة ${e.episode}`));
    c.append(art, line, txt('span', 'uv-slot-title', e.title), el('span', 'uv-slot-when', airWhen(e.airingAt, t)));
    c.onclick = () => open.anime(e);
    return c;
  }
  function airSchedule(week) {
    const s = el('section', 'uv-sec uv-sched');
    const h = el('header', 'uv-sh');
    const titles = el('div', 'uv-air-titles');
    titles.append(el('h2', null, 'جدول البث'), el('span', 'uv-air-sub', 'بتوقيت مكة'));
    const all = el('button', 'uv-all'); all.type = 'button'; all.innerHTML = `الكل${glyph('chevron', { size: 16 })}`; all.onclick = () => openSub('schedule');
    h.append(titles, all);
    s.append(h);
    if (!week) { s.append(el('div', 'uv-air-days uv-air-days--sk'), skRail(3, 290, 163)); return s; }
    const t = now();
    const today = meccaKey(t);
    const days = new Map();
    for (const e of week) { const k = meccaKey(e.airingAt); if (!days.has(k)) days.set(k, []); days.get(k).push(e); }
    const keys = [...days.keys()].filter((k) => k >= meccaKey(t - 86_400_000)).sort();
    if (!keys.length) { s.append(el('p', 'uv-none', 'لا حلقات هذا الأسبوع')); return s; }
    if (!keys.includes(st.airDay)) st.airDay = keys.includes(today) ? today : keys[0];
    const tabs = el('nav', 'uv-air-days'); tabs.setAttribute('role', 'tablist');
    const strip = el('div', 'uv-rail uv-air-strip');
    const showDay = (k, { scroll }) => {
      st.airDay = k;
      for (const b of tabs.children) { const on = b.dataset.day === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
      const list = days.get(k) ?? [];
      strip.replaceChildren(...list.map(slot));
      // اليوم يبدأ عند «الآن»: آخر ما نزل، وبعده القادم
      if (scroll) {
        const at = k === today ? Math.max(0, list.findIndex((e) => e.airingAt > now()) - 1) : 0;
        const target = strip.children[at];
        // بداية السطر (اليمين) عند البطاقة، بلا تحريك الصفحة رأسيًّا
        requestAnimationFrame(() => {
          if (!target || !strip.isConnected || !at) return;
          const pad = parseFloat(getComputedStyle(strip).paddingInlineStart) || 0;
          strip.scrollBy({ left: target.getBoundingClientRect().right - (strip.getBoundingClientRect().right - pad), behavior: 'instant' });
        });
      }
    };
    for (const k of keys) {
      const b = el('button', '', airDayLabel(k, today)); b.type = 'button'; b.dataset.day = k; b.setAttribute('role', 'tab');
      b.onclick = () => showDay(k, { scroll: true });
      tabs.append(b);
    }
    s.append(tabs, strip);
    showDay(st.airDay, { scroll: !st.airScrolled });
    st.airScrolled = true;
    return s;
  }

  function dayName(d) { return d === -1 ? 'أمس' : d === 0 ? 'اليوم' : d === 1 ? 'غدًا' : DAYS_AR[new Date(now() + 3 * 3600_000 + d * 86_400_000).getUTCDay()]; }

  /* ───── آخر التحديثات: أحداث Update Engine الحقيقية، لا أحدث عناصر الكتالوج ───── */
  const UPD = [['all', 'الكل'], ['manga', 'المانجا'], ['series', 'المسلسلات'], ['movie', 'الأفلام']];
  function updTabs(cur, onPick) {
    const d = el('div', 'uv-days');
    for (const [k, l] of UPD) { const b = el('button', cur === k ? 'on' : '', l); b.type = 'button'; b.onclick = () => onPick(k); d.append(b); }
    return d;
  }
  function updates(kind) {
    // No catalogue fallback: an item can be newly listed without a newly
    // published chapter. Only Update Engine's recorded release events count.
    const manga = kind === 'series' || kind === 'movie' || kind === 'cinema' ? []
      : (data.mangaUpdates?.() ?? []).filter((w) => Number.isFinite(w._updateAt) && w._updateAt > 0)
        .map((w) => ({ at: w._updateAt, node: () => updItem(w) }));
    const series = kind === 'manga' || kind === 'movie' ? []
      : (data.seriesUpdates?.() ?? []).filter((u) => Number.isFinite(u.released) && u.released > 0)
        .map((u) => ({ at: u.released, node: () => seriesItem(u) }));
    const movies = kind === 'manga' || kind === 'series' ? []
      : (data.movieUpdates?.() ?? []).filter((u) => Number.isFinite(u.at) && u.at > 0 && u.x?.id)
        .map((u) => ({ at: u.at, node: () => movieItem(u) }));
    return [...manga, ...series, ...movies].sort((a, b) => b.at - a.at);
  }
  function seriesItem(u) {
    const a = el('button', 'uv-po uv-up'); a.type = 'button';
    a.dataset.updateKey = `series:${u.x.id}`;
    const art = el('span', 'uv-art'); art.append(img(u.x.poster, 'uv-img', u.x.title));
    const line = el('span', 'uv-t2');
    line.append(el('em', null, `م${u.season} ح${u.episode}`), document.createTextNode(` · ${ago(u.released, now())}`));
    a.append(art, txt('b', 'uv-t1', u.x.title), line);
    a.onclick = () => open.cinema(u.x);
    return a;
  }
  function movieItem(u) {
    const a = el('button', 'uv-po uv-up'); a.type = 'button';
    a.dataset.updateKey = `movie:${u.x.id}`;
    const art = el('span', 'uv-art'); art.append(img(u.x.poster, 'uv-img', u.x.title));
    const line = el('span', 'uv-t2');
    // An availability event is NOT proof that a film premiered today.
    line.append(el('em', null, 'فيلم'), document.createTextNode(` · رُصد ${agoAr(u.at, now())}`));
    a.append(art, txt('b', 'uv-t1', u.x.title), line);
    a.onclick = () => open.cinema(u.x);
    return a;
  }
  function updItem(w) {
    const a = el('button', 'uv-po uv-up'); a.type = 'button';
    a.dataset.updateKey = `manga:${w.raw?.id ?? w.title}`;
    const art = fill(el('span', 'uv-art'), w, 'manga', w.cover, w.title);
    const ch = w._latestChapter?.chapterNumber;
    const line = el('span', 'uv-t2');
    if (ch != null) {
      const extra = Number.isInteger(w._newCount) && w._newCount > 1 ? ` +${w._newCount - 1}` : '';
      line.append(el('em', null, `الفصل ${ch}${extra}`));
    }
    if (w._updateAt) {
      const when = w._updatePublishedAt > 0
        ? agoAr(w._updateAt, now())
        : `رُصد ${agoAr(w._updateAt, now())}`;
      line.append(document.createTextNode(`${ch != null ? ' · ' : ''}${when}`));
    }
    a.append(art, txt('b', 'uv-t1', w.title), line);
    a.onclick = () => open.manga(w);
    return a;
  }
  function poster(x, kind, go) {
    const a = el('button', 'uv-po'); a.type = 'button';
    const art = fill(el('span', 'uv-art'), x, kind, x.poster ?? x.cover, x.title);
    const score = x.score ?? x.rating;
    const meta = [kind === 'manga' ? (x.chapters ? `${x.chapters} فصل` : '') : (x.year ?? ''), score ? Number(score).toFixed(1) : ''].filter(Boolean).join(' · ');
    a.append(art, txt('b', 'uv-t1 uv-2l', x.title), el('span', 'uv-t2', meta));
    a.onclick = go;
    return a;
  }
  const skRail = (n, w, h) => { const r = rail(); for (let i = 0; i < n; i++) { const c = el('div', 'uv-po'); c.append(sk(w, h, 'uv-art-sk'), sk('70%', 13, 'uv-l1'), sk('45%', 11, 'uv-l2')); r.append(c); } return r; };

  /* ───── آخر المشاهدات: معاينة من أربعة أغلفة (قرار المالك) ─────
   * أغلفة 2:3 بعرض ربع السطر، أصغر من ملصقات الصفوف تحتها فلا تطغى عليها؛ تحتها العنوان سطرًا والتقدّم بلغة
   * النوع. لمسة تفتح العمل، والضغط المطوّل يفتح خياراته (أضف لمكتبتي، أزل من آخر المشاهدات). */
  function pressable(node, onTap, onHold) {
    let timer = 0, held = false, x = 0, y = 0;
    const cancel = () => { clearTimeout(timer); timer = 0; };
    node.addEventListener('pointerdown', (e) => {
      held = false; x = e.clientX; y = e.clientY; cancel();
      if (onHold) timer = setTimeout(() => { timer = 0; held = true; node.classList.remove('pressing'); onHold(); }, 480);
      node.classList.add('pressing');
    });
    node.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 8) { cancel(); node.classList.remove('pressing'); } });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(t, () => { cancel(); node.classList.remove('pressing'); });
    node.addEventListener('contextmenu', (e) => { if (onHold) e.preventDefault(); });
    node.onclick = (e) => { if (held) { held = false; e.preventDefault(); return; } onTap(); };
    return node;
  }
  function recentCover(it) {
    const a = el('button', 'uv-rv'); a.type = 'button';
    const art = fill(el('span', 'uv-rv-art'), it, it.section, it.cover, it.title);
    a.append(art, txt('b', 'uv-rv-t', it.title || 'عمل'), txt('span', 'uv-rv-s', [KIND_AR[it.kind] ?? KIND_AR[it.section] ?? '', it.label].filter(Boolean).join(' · ')));
    a.setAttribute('aria-label', `${it.title ?? ''}${it.label ? `، ${it.label}` : ''}`);
    return pressable(a, () => open.item(it), open.itemMenu ? () => open.itemMenu(it) : null);
  }
  function recentSection(list) {
    const s = el('section', 'uv-sec uv-sec--recent');
    s.append(head('آخر المشاهدات', open.recent ? () => open.recent() : null, 'عرض الكل'));
    const g = el('div', 'uv-rv-grid');
    list.slice(0, 4).forEach((it) => g.append(recentCover(it)));
    s.append(g);
    return s;
  }

  /* ───── تصفّح: أربعة أبواب تحت البنر مباشرة ─────
   * شبكة 2×2 بخطوط شعرية لا صناديق (فكرة تصفّح المانجا)، وهوية الموحد: أغلفة صغيرة متراكبة من الأنواع
   * الثلاثة، والاسم، وسطر حيّ، وسهم. الأبواب بارتفاع ثابت فلا يتغيّر شيء حين تصل البيانات. */
  const cov = (x) => x?.cover ?? x?.poster ?? x?.posterSmall ?? x?.coverImage?.large ?? null;
  function browseDoor(label, sub, covers, go) {
    const b = el('button', 'uv-door'); b.type = 'button';
    const art = el('span', 'uv-door-art'); art.setAttribute('aria-hidden', 'true');
    for (const [x, kind] of covers.filter((c) => c?.[0]).slice(0, 3)) art.append(fill(el('span', 'uv-door-cv'), x, kind, cov(x)));
    const t = el('span', 'uv-door-text'); t.append(el('span', 'uv-door-l', label), el('small', 'uv-door-s', sub));
    b.append(art, t);
    b.onclick = go;
    return b;
  }
  const previewMix = (...lists) => {
    const out = [];
    for (let i = 0; i < 3; i++) for (const [list, kind] of lists) if (list?.[i]) out.push([list[i], kind]);
    return out;
  };
  function browseUpdatesDoor() {
    const manga = data.mangaUpdates?.() ?? [];
    const series = data.seriesUpdates?.() ?? [];
    const movies = data.movieUpdates?.() ?? [];
    const count = manga.length + series.length + movies.length;
    const door = browseDoor('آخر التحديثات', count ? `${count} تحديثًا` : 'فصول وحلقات وأفلام',
      previewMix([manga, 'manga'], [series.map((u) => u.x), 'cinema'], [movies.map((u) => u.x), 'cinema']),
      () => openSub('updates'));
    door.dataset.uvDoor = 'updates';
    return door;
  }
  function browseSection() {
    const a = data.animeHome?.() ?? null;
    const c = data.cinema?.() ?? null;
    const manga = data.mangaPopular?.() ?? [];
    const genres = new Set([...(a?.trending ?? []), ...(c?.movie ?? []), ...(c?.series ?? [])].flatMap((x) => x?.genres ?? []));
    const s = el('section', 'uv-browse');
    s.append(head('تصفّح'));
    const grid = el('nav', 'uv-doors'); grid.setAttribute('aria-label', 'تصفّح كل الأعمال');
    grid.append(
      browseUpdatesDoor(),
      browseDoor('الرائج', 'الأنواع الثلاثة', previewMix([a?.trending, 'anime'], [manga, 'manga'], [c?.series, 'cinema']), () => openSub('trending')),
      browseDoor('التصنيفات', 'لكل نوع', previewMix([c?.movie, 'cinema'], [a?.trending?.slice(3), 'anime'], [manga.slice(3), 'manga']), () => (open.categories ? open.categories() : open.browse('anime'))),
      browseDoor('كل الأعمال', 'الأشهر', previewMix([c?.series?.slice(3), 'cinema'], [manga.slice(6), 'manga'], [a?.trending?.slice(6), 'anime']), () => (open.discover ? open.discover() : open.browse('anime'))),
    );
    s.append(grid);
    return s;
  }

  /* ───── الرئيسية ───── */
  // البنر و«تصفّح» يُبنيان مع الصفحة؛ تغيير الفلتر يعيد ما تحت الفلتر وحده (لا يهدم البنر ولا الشريط)
  function renderUpdatesSection() {
    if (st.filter === 'anime') return null;
    const allow = st.filter === 'manga' ? 'manga' : st.filter === 'cinema' ? 'cinema' : st.upd;
    const list = updates(allow);
    const s = el('section', 'uv-sec');
    s.dataset.uvRole = 'updates';
    s.append(head('آخر التحديثات', () => openSub('updates')));
    if (st.filter === 'all') s.append(updTabs(st.upd, (k) => { const previous = bodyKey(); st.upd = k; repaintBody(previous); }));
    if (!list.length) s.append(el('p', 'uv-none', 'لا تحديثات موثّقة حاليًا'));
    else {
      const r = rail();
      list.slice(0, 12).forEach((u) => r.append(u.node()));
      s.append(r);
    }
    return s;
  }
  function renderBody(previousBody = null, retainedScrolls = []) {
    const body = el('div', 'uv-body');
    const cont = (data.continue() ?? []).filter((it) => passes(it.kind ?? it.section, st.filter));
    if (cont.length) body.append(recentSection(cont));

    if (st.filter === 'all' || st.filter === 'anime') body.append(airSchedule(data.animeHome()?.week));
    const updateSection = renderUpdatesSection();
    if (updateSection) body.append(updateSection);
    for (const [t, list, kind, go] of trendRows()) {
      const fingerprint = trendFingerprint(list);
      const previous = [...(previousBody?.children ?? [])].find(node => node.dataset.uvTrend === kind);
      if (previous?.dataset.uvFingerprint === fingerprint) {
        for (const rail of previous.querySelectorAll('.uv-rail')) retainedScrolls.push([rail, rail.scrollLeft]);
        body.append(previous); continue;
      }
      const s = el('section', 'uv-sec'); s.append(head(t, () => open.browse(sectionOf(kind))));
      s.dataset.uvTrend = kind; s.dataset.uvFingerprint = fingerprint;
      if (!list?.length) s.append(skRail(4, 120, 180)); else { const r = rail(); list.slice(0, 12).forEach((x) => r.append(poster(x, kind, () => go(x)))); s.append(r); }
      body.append(s);
    }
    return body;
  }
  function trendRows(filter = st.filter) {
    const rows = [];
    if (passes('anime', filter)) rows.push(['الأنمي الرائج', data.animeHome()?.trending, 'anime', (x) => open.anime(x)]);
    if (passes('manga', filter)) rows.push(['المانجا الرائجة', data.mangaPopular(), 'manga', (x) => open.manga(x)]);
    if (passes('series', filter)) rows.push(['مسلسلات', data.cinema()?.series, 'series', (x) => open.cinema(x)]);
    if (passes('movie', filter)) rows.push(['أفلام', data.cinema()?.movie, 'movie', (x) => open.cinema(x)]);
    return rows;
  }
  // Live update feeds must not remount hero, trending rails, dock, or navigation.
  // Only the update door, update shelf and an open Updates modal are reconciled.
  function refreshUpdates() {
    if (!host?.isConnected) return;
    if (signature() !== lastSig) savedBodies.clear();
    const previousDoor = host.querySelector('[data-uv-door="updates"]');
    if (previousDoor) previousDoor.replaceWith(browseUpdatesDoor());
    const previous = host.querySelector('[data-uv-role="updates"]');
    const next = renderUpdatesSection();
    if (previous && next) {
      const existing = new Map([...previous.querySelectorAll('.uv-up[data-update-key]')]
        .map((card) => [card.dataset.updateKey, card]));
      const nextRail = next.querySelector('.uv-rail');
      const oldRail = previous.querySelector('.uv-rail');
      for (const card of [...(nextRail?.querySelectorAll('.uv-up[data-update-key]') ?? [])]) {
        const reused = existing.get(card.dataset.updateKey);
        if (!reused) continue;
        const oldMeta = reused.querySelector('.uv-t2'), newMeta = card.querySelector('.uv-t2');
        if (oldMeta && newMeta && oldMeta.textContent !== newMeta.textContent) oldMeta.replaceWith(newMeta);
        reused.onclick = card.onclick;
        card.replaceWith(reused);
      }
      const scroll = oldRail?.scrollLeft ?? 0;
      previous.replaceWith(next);
      if (nextRail) nextRail.scrollLeft = scroll;
    } else if (next && !previous) {
      host.querySelector('.uv-body')?.append(next);
    } else if (previous && !next) previous.remove();
    if (overlay?.isConnected && st.sub === 'updates' && !suspended) paintSub();
    lastSig = signature();
  }

  function repaintBody(previousKey = bodyKey()) {
    const old = host?.querySelector('.uv-body');
    if (!old) return render();
    const y = host.ownerDocument.defaultView?.scrollY ?? 0;
    const rails = [...old.querySelectorAll('.uv-rail')].map(rail => [rail, rail.scrollLeft]);
    savedBodies.set(previousKey, { node: old, y, rails });
    const key = bodyKey();
    const saved = savedBodies.get(key);
    savedBodies.delete(key);
    old.replaceWith(saved?.node ?? renderBody());
    for (const [rail, left] of saved?.rails ?? []) rail.scrollLeft = left;
    lastSig = signature();
    host.ownerDocument.defaultView?.scrollTo?.(0, saved?.y ?? y);
  }
  function render() {
    if (!host) return;
    savedBodies.clear();
    lastSig = signature();
    const y = host.ownerDocument.defaultView?.scrollY ?? 0;
    const previousBody = host.querySelector('.uv-body');
    const retainedScrolls = [];
    const page = el('div', 'uv');
    page.append(renderHero(), browseSection());
    const t = tabs(st.filter, UNIFIED_FILTERS, (k) => {
      if (k === st.filter) return;
      const previous = bodyKey();
      st.filter = k; writeFilter(k);
      for (const b of t.children) { const on = b.textContent === UNIFIED_FILTERS.find(([x]) => x === k)[1]; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
      repaintBody(previous);
    });
    page.append(t, renderBody(previousBody, retainedScrolls));
    host.replaceChildren(page);
    for (const [rail, left] of retainedScrolls) rail.scrollLeft = left;
    ensureSilk();
    host.ownerDocument.defaultView?.scrollTo?.(0, y);
  }

  /* ───── الحرير خلف البنر وحده ───── */
  function ensureSilk() {
    const hero = host.querySelector('.uv-hero'); if (!hero) return;
    if (!silkWrap) {
      silkWrap = el('div', 'uv-silk'); silkWrap.setAttribute('aria-hidden', 'true');
      const c = el('canvas'); silkWrap.append(c);
      try { silk = createSilk(c); } catch { silk = null; }
    }
    hero.prepend(silkWrap);
    const list = hero._list; if (list?.length) tint(list[st.hero]);
  }

  /* ───── الصفحات الفرعية: فوق الشاشة، بلا الشريط العلوي ───── */
  function openSub(kind) {
    st.sub = kind;
    overlay?.remove();
    suspended = false;
    overlay = el('div', 'uv-page'); overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    paintSub();
    (host.closest('.v35') ?? host.ownerDocument.body).append(overlay);
    requestAnimationFrame(() => overlay?.classList.add('in'));
  }
  function closeSub() {
    if (!overlay || suspended) return false;
    const o = overlay; overlay = null; st.sub = null;
    o.classList.remove('in');
    setTimeout(() => o.remove(), reducedMotion() ? 0 : 400);
    return true;
  }
  function suspend() {
    if (!overlay || suspended) return false;
    suspended = true;
    suspendedScroll = overlay.scrollTop || 0;
    overlay.style.pointerEvents = 'none';
    return true;
  }
  function hideSuspended() {
    if (!suspended || !overlay) return;
    overlay.style.visibility = 'hidden';
    overlay.setAttribute('aria-hidden', 'true');
  }
  function resume() {
    if (!suspended || !overlay) return false;
    suspended = false;
    overlay.style.visibility = '';
    overlay.style.pointerEvents = '';
    overlay.removeAttribute('aria-hidden');
    overlay.scrollTop = suspendedScroll;
    return true;
  }
  function discardSuspended() {
    if (!suspended) return false;
    overlay?.remove();
    overlay = null; suspended = false; st.sub = null;
    return true;
  }
  function paintSub() {
    if (!overlay) return;
    const top = el('div', 'uv-ptop');
    const back = el('button', 'uv-back'); back.type = 'button'; back.setAttribute('aria-label', 'رجوع'); back.innerHTML = glyph('back', { size: 24 }); back.onclick = closeSub;
    const body = el('div', 'uv-pbody');
    if (st.sub === 'schedule') {
      top.append(back, el('h1', null, 'جدول البث'));
      // «نزلت» (كل ما نزل، الأحدث أولًا) و«قادمة» (حتى الأسبوع القادم، الأقرب أولًا)، مقسّمة بالأيام
      const week = data.animeHome()?.week ?? [];
      const t = now();
      const mode = st.airTab ?? 'soon';
      body.append(tabs(mode, [['soon', 'قادمة'], ['aired', 'نزلت']], (k) => { st.airTab = k; paintSub(); }));
      const list = mode === 'aired'
        ? week.filter((e) => e.airingAt <= t).sort((a, b) => b.airingAt - a.airingAt)
        : week.filter((e) => e.airingAt > t && e.airingAt - t <= 7 * 86_400_000).sort((a, b) => a.airingAt - b.airingAt);
      if (!list.length) body.append(el('p', 'uv-none', mode === 'aired' ? 'ما نزل شيء هذا الأسبوع' : 'لا حلقات قادمة'));
      let day = null, grid = null;
      for (const e of list) {
        const d = riyadhDay(e.airingAt) - riyadhDay(t);
        if (d !== day) { day = d; body.append(el('h3', 'uv-dayhead', d === 0 ? 'اليوم' : d === 1 ? 'غدًا' : d === -1 ? 'أمس' : DAYS_AR[new Date(e.airingAt + 3 * 3600_000).getUTCDay()])); grid = el('div', 'uv-grid'); body.append(grid); }
        grid.append(airCard(e));
      }
    } else if (st.sub === 'trending') {
      // الرائج بالتناوب بين الأنواع (لا يطغى نوع على غيره)، وبفلتر النوع نفسه
      top.append(back, el('h1', null, 'الرائج'));
      const k = st.trendTab ?? 'all';
      body.append(tabs(k, UNIFIED_FILTERS, (x) => { st.trendTab = x; paintSub(); }));
      const pools = trendRows('all').filter(([, , kind]) => k === 'all' || sectionOf(kind) === k).map(([, list, kind, go]) => (list ?? []).map((x) => [x, kind, go]));
      const grid = el('div', 'uv-grid');
      const longest = Math.max(0, ...pools.map((l) => l.length));
      for (let i = 0; i < longest; i++) for (const l of pools) if (l[i]) grid.append(poster(l[i][0], l[i][1], () => l[i][2](l[i][0])));
      body.append(grid.childElementCount ? grid : el('p', 'uv-none', 'نجهّز الرائج…'));
    } else {
      top.append(back, el('h1', null, 'آخر التحديثات'));
      body.append(tabs(st.subTab, UPD, (k) => { st.subTab = k; paintSub(); }));
      const grid = el('div', 'uv-grid');
      updates(st.subTab).forEach((u) => grid.append(u.node()));
      body.append(grid);
    }
    // D-029: preserve the tab host and header so the global tab animation
    // targets the NEW content after a tab switch instead of a detached node.
    const previous = overlay.querySelector('.uv-pbody');
    const oldBar = previous?.querySelector('.uv-tabs');
    const newBar = body.querySelector('.uv-tabs');
    if (previous && oldBar && newBar && overlay.querySelector('.uv-ptop h1')?.textContent === top.querySelector('h1')?.textContent) {
      for (const button of oldBar.children) {
        const on = [...newBar.children].some((b) => b.classList.contains('on') && b.textContent === button.textContent);
        button.classList.toggle('on', on);
        button.setAttribute('aria-selected', String(on));
      }
      newBar.replaceWith(oldBar);
      previous.replaceChildren(...body.children);
    } else {
      overlay.replaceChildren(top, body);
    }
  }

  /** بصمة رخيصة لما يُعرض: الفلتر و«تابع» بتقدّمه وأطوال القوائم. */
  let lastSig = '';
  function signature() {
    const n = (x) => (Array.isArray(x) ? x.length : x ? 1 : 0);
    const cont = (data.continue() ?? []).slice(0, 12).map((it) => `${it.ref ?? it.id}@${it.at ?? it.viewedAt ?? ''}:${it.label ?? it.chapterLabel ?? ''}`).join(',');
    const a = data.animeHome?.() ?? null;
    const c = data.cinema?.() ?? null;
    // Include event identities, not just lengths: chapter 125 replacing 124
    // is still a new release even if both snapshots have one row.
    const chapters = (data.mangaUpdates?.() ?? []).slice(0, 24)
      .map((w) => `${w.raw?.id ?? w.title}:${w._updateAt}:${w._latestChapter?.chapterNumber}:${w._newCount}`).join(';');
    const episodes = (data.seriesUpdates?.() ?? []).slice(0, 24)
      .map((u) => `${u.x?.id}:${u.season}:${u.episode}:${u.released}`).join(';');
    const films = (data.movieUpdates?.() ?? []).slice(0, 24)
      .map((u) => `${u.x?.id}:${u.at}`).join(';');
    return [st.filter, cont, n(a?.week), n(a?.trending), n(c?.movie), n(c?.series), chapters, episodes, films, n(data.mangaPopular?.())].join('|');
  }

  function start() {
    stop();
    timer = setInterval(() => {
      const d = host?.ownerDocument; if (!host?.isConnected || d?.hidden || overlay || (d?.defaultView?.scrollY ?? 0) > 200) return;
      setHero(st.hero + 1, 1);
    }, 7000);
  }
  function stop() { clearInterval(timer); timer = 0; }

  return {
    mount(node) { host = node; render(); start(); },
    /** `ifChanged`: يُعاد البناء فقط إن تغيّر ما يُعرض (الرجوع للرئيسية لا يهدم الشرائط ومواضعها). */
    refresh({ ifChanged = false } = {}) {
      if (!host?.isConnected) return;
      if (ifChanged && signature() === lastSig) return;
      render();
    },
    back: closeSub,
    refreshUpdates,
    suspend, hideSuspended, resume, discardSuspended, motionNode: () => overlay,
    destroy() { stop(); savedBodies.clear(); if (!discardSuspended()) closeSub(); silk?.destroy?.(); silk = null; silkWrap = null; host = null; },
  };
}
