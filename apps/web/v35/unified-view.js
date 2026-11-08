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

export function createUnifiedView({ el, glyph, data, open, lock = () => null, genreAr = (g) => g, reducedMotion = () => false, now = () => Date.now() }) {
  const gen = (list) => (list ?? []).slice(0, 2).map(genreAr).join('، ');
  const st = { filter: readFilter(), hero: 0, day: 0, sub: null, subTab: 'all', upd: 'all' };
  let host = null, silk = null, silkWrap = null, timer = 0, overlay = null;

  const txt = (tag, cls, s) => { const n = el(tag, cls, s ?? ''); if (s && /[A-Za-z]/.test(s)) n.dir = 'auto'; return n; };
  const img = (src, cls, alt = '') => {
    if (!src) return el('span', cls);
    const i = el('img', cls); i.alt = alt; i.loading = 'lazy'; i.decoding = 'async'; i.src = src;
    i.onerror = () => { i.style.visibility = 'hidden'; };
    return i;
  };
  const head = (title, go) => {
    const h = el('header', 'uv-sh');
    h.append(el('h2', null, title));
    if (go) { const b = el('button', 'uv-all'); b.type = 'button'; b.innerHTML = `الكل${glyph('chevron', { size: 16 })}`; b.onclick = go; h.append(b); }
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
      anime: a.filter((x) => x.poster).map((x) => ({ kind: 'anime', title: x.title, cover: x.poster, color: x.color, meta: [x.score ? x.score.toFixed(1) : '', gen(x.genres)], go: () => open.anime(x) })),
      manga: m.filter((x) => x.cover).map((x) => ({ kind: 'manga', title: x.title, cover: x.cover, color: x.color ?? null, meta: [x.score ? Number(x.score).toFixed(1) : '', gen(x.genres)], go: () => open.manga(x) })),
      cinema: c.filter((x) => x.poster).map((x) => ({ kind: x.type, title: x.title, cover: x.poster, logo: x.logo, color: null, meta: [x.year ?? '', x.rating ? x.rating.toFixed(1) : '', gen(x.genres)], go: () => open.cinema(x) })),
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
    reel.addEventListener('pointerup', (e) => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 40) setHero(st.hero + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); });
    sec.append(reel, info, idx);
    sec._list = list;
    queueMicrotask(() => tint(list[st.hero]));
    return sec;
  }
  function setHero(n, dir) {
    const h = host?.querySelector('.uv-hero'); const list = h?._list; if (!list?.length) return;
    const prev = st.hero, next = ((n % list.length) + list.length) % list.length; if (prev === next) return;
    dir ??= next > prev ? 1 : -1;
    st.hero = next;
    const rc = h.querySelectorAll('.uv-rc'), hi = h.querySelectorAll('.uv-hi'), dots = h.querySelectorAll('.uv-hidx button');
    rc.forEach((e) => { e.classList.remove('on', 'out', 'from'); });
    rc[prev].style.setProperty('--dir', dir); rc[prev].classList.add('out');
    rc[next].style.setProperty('--dir', dir); rc[next].classList.add('from');
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

  /* ───── تابع ───── */
  function contItem(it) {
    const a = el('button', 'uv-po uv-ci'); a.type = 'button';
    const art = el('span', 'uv-art'); art.append(img(it.cover, 'uv-img', it.title));
    const go = el('span', 'uv-go'); go.innerHTML = glyph(it.section === 'manga' ? 'book' : 'play', { size: 15, filled: it.section !== 'manga' }); art.append(go);
    a.append(art, txt('b', 'uv-t1', it.title || 'عمل'), txt('span', 'uv-t2', [KIND_AR[it.kind] ?? '', it.label].filter(Boolean).join(' · ')));
    a.onclick = () => open.item(it);
    return a;
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
  function dayName(d) { return d === -1 ? 'أمس' : d === 0 ? 'اليوم' : d === 1 ? 'غدًا' : DAYS_AR[new Date(now() + 3 * 3600_000 + d * 86_400_000).getUTCDay()]; }

  /* ───── آخر التحديثات (المانجا والمسلسلات) ───── */
  const UPD = [['all', 'الكل'], ['manga', 'المانجا'], ['series', 'المسلسلات']];
  function updTabs(cur, onPick) {
    const d = el('div', 'uv-days');
    for (const [k, l] of UPD) { const b = el('button', cur === k ? 'on' : '', l); b.type = 'button'; b.onclick = () => onPick(k); d.append(b); }
    return d;
  }
  function updates(kind) {
    const m = kind === 'series' ? [] : (data.mangaRecent() ?? []).map((w) => ({ at: w._updateAt ?? 0, node: () => updItem(w) }));
    const sr = kind === 'manga' ? [] : (data.seriesUpdates?.() ?? []).map((u) => ({ at: u.released, node: () => seriesItem(u) }));
    return [...m, ...sr].sort((a, b) => b.at - a.at);
  }
  function seriesItem(u) {
    const a = el('button', 'uv-po uv-up'); a.type = 'button';
    const art = el('span', 'uv-art'); art.append(img(u.x.poster, 'uv-img', u.x.title));
    const line = el('span', 'uv-t2');
    line.append(el('em', null, `م${u.season} ح${u.episode}`), document.createTextNode(` · ${ago(u.released, now())}`));
    a.append(art, txt('b', 'uv-t1', u.x.title), line);
    a.onclick = () => open.cinema(u.x);
    return a;
  }
  function updItem(w) {
    const a = el('button', 'uv-po uv-up'); a.type = 'button';
    const art = el('span', 'uv-art'); art.append(img(w.cover, 'uv-img', w.title));
    const ch = w._latestChapter?.chapterNumber;
    const line = el('span', 'uv-t2');
    if (ch != null) line.append(el('em', null, `فصل ${ch}`));
    if (w._updateAt) line.append(document.createTextNode(`${ch != null ? ' · ' : ''}${ago(w._updateAt, now())}`));
    a.append(art, txt('b', 'uv-t1', w.title), line);
    a.onclick = () => open.manga(w);
    return a;
  }
  function poster(x, kind, go) {
    const a = el('button', 'uv-po'); a.type = 'button';
    const art = el('span', 'uv-art'); art.append(img(x.poster ?? x.cover, 'uv-img', x.title));
    const score = x.score ?? x.rating;
    const meta = [kind === 'manga' ? (x.chapters ? `${x.chapters} فصل` : '') : (x.year ?? ''), score ? Number(score).toFixed(1) : ''].filter(Boolean).join(' · ');
    a.append(art, txt('b', 'uv-t1 uv-2l', x.title), el('span', 'uv-t2', meta));
    a.onclick = go;
    return a;
  }
  const skRail = (n, w, h) => { const r = rail(); for (let i = 0; i < n; i++) { const c = el('div', 'uv-po'); c.append(sk(w, h, 'uv-art-sk'), sk('70%', 13, 'uv-l1'), sk('45%', 11, 'uv-l2')); r.append(c); } return r; };

  /* ───── الرئيسية ───── */
  function render() {
    if (!host) return;
    const y = host.ownerDocument.defaultView?.scrollY ?? 0;
    // «توحيد التصميم» وحده: كل قسم بهذا التصميم ومحتواه هو، بلا فلتر الأقسام
    const locked = lock();
    if (locked && st.filter !== locked) { st.filter = locked; st.hero = 0; }
    else if (!locked && st.locked) { st.filter = readFilter(); st.hero = 0; }
    st.locked = Boolean(locked);
    const page = el('div', `uv${locked ? ' uv-locked' : ''}`);
    page.append(renderHero());
    if (!locked) page.append(tabs(st.filter, UNIFIED_FILTERS, (k) => { st.filter = k; st.hero = 0; writeFilter(k); render(); }));

    const cont = (data.continue() ?? []).filter((it) => passes(it.kind ?? it.section, st.filter)).slice(0, 12);
    if (cont.length) { const s = el('section', 'uv-sec'); const r = rail(); cont.forEach((it) => r.append(contItem(it))); s.append(head('تابع'), r); page.append(s); }

    if (st.filter === 'all' || st.filter === 'anime') {
      const week = data.animeHome()?.week;
      const s = el('section', 'uv-sec');
      s.append(head('جدول البث', () => openSub('schedule')));
      const days = el('div', 'uv-days');
      for (const d of [0, 1, 2]) { const b = el('button', st.day === d ? 'on' : '', dayName(d)); b.type = 'button'; b.onclick = () => { st.day = d; render(); }; days.append(b); }
      s.append(days);
      // بطاقات مثل «آخر التحديثات» (قرار المالك)، لا سطور
      if (!week) s.append(skRail(4, 120, 180));
      else { const list = dayLineup(week, st.day, now()).slice(0, 12); const r = rail(); list.forEach((e) => r.append(airCard(e))); s.append(list.length ? r : el('p', 'uv-none', 'لا حلقات في هذا اليوم')); }
      page.append(s);
    }
    // آخر التحديثات: فصول المانجا وحلقات المسلسلات معًا (الأنمي له جدول البث)
    if (st.filter !== 'anime') {
      const allow = st.filter === 'manga' ? 'manga' : st.filter === 'cinema' ? 'series' : st.upd;
      const list = updates(allow);
      const s = el('section', 'uv-sec'); s.append(head('آخر التحديثات', () => openSub('updates')));
      if (st.filter === 'all') s.append(updTabs(st.upd, (k) => { st.upd = k; render(); }));
      if (!list.length) s.append(skRail(4, 120, 180)); else { const r = rail(); list.slice(0, 12).forEach((u) => r.append(u.node())); s.append(r); }
      page.append(s);
    }
    const rows = [];
    if (passes('anime', st.filter)) rows.push(['الأنمي الرائج', data.animeHome()?.trending, 'anime', (x) => open.anime(x)]);
    if (passes('manga', st.filter)) rows.push(['المانجا الرائجة', data.mangaPopular(), 'manga', (x) => open.manga(x)]);
    if (passes('series', st.filter)) rows.push(['مسلسلات', data.cinema()?.series, 'series', (x) => open.cinema(x)]);
    if (passes('movie', st.filter)) rows.push(['أفلام', data.cinema()?.movie, 'movie', (x) => open.cinema(x)]);
    for (const [t, list, kind, go] of rows) {
      const s = el('section', 'uv-sec'); s.append(head(t, () => open.browse(sectionOf(kind))));
      if (!list?.length) s.append(skRail(4, 120, 180)); else { const r = rail(); list.slice(0, 12).forEach((x) => r.append(poster(x, kind, () => go(x)))); s.append(r); }
      page.append(s);
    }
    host.replaceChildren(page);
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
    overlay = el('div', 'uv-page'); overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    paintSub();
    (host.closest('.v35') ?? host.ownerDocument.body).append(overlay);
    requestAnimationFrame(() => overlay?.classList.add('in'));
  }
  function closeSub() {
    if (!overlay) return false;
    const o = overlay; overlay = null; st.sub = null;
    o.classList.remove('in');
    setTimeout(() => o.remove(), reducedMotion() ? 0 : 260);
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
    } else {
      top.append(back, el('h1', null, 'آخر التحديثات'));
      body.append(tabs(st.subTab, UPD, (k) => { st.subTab = k; paintSub(); }));
      const grid = el('div', 'uv-grid');
      updates(st.subTab).forEach((u) => grid.append(u.node()));
      body.append(grid);
    }
    overlay.replaceChildren(top, body);
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
    refresh() { if (host?.isConnected) render(); },
    back: closeSub,
    destroy() { stop(); closeSub(); silk?.destroy?.(); silk = null; silkWrap = null; host = null; },
  };
}
