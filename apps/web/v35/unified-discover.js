/**
 * «اكتشف» الموحد (توحيد المحتوى): كان شريط «اكتشف» يفتح اكتشاف المانجا وحده، و«التصنيفات» و«كل الأعمال»
 * في «تصفّح» يفتحانه أيضًا (مضلل). هنا صفحة واحدة بلغة الموحد:
 *   البحث (يفتح البحث الموحد) ← التصنيفات بفلتر النوع (أنمي/مانجا/سينما) ← الرائج الآن مرقّمًا ومنوّعًا.
 * كل تصنيف يفتح نتائج نوعه الحقيقية: الأنمي من AniList بفلتر التصنيف، والسينما من Cinemeta بفلتره،
 * والمانجا من AniList بفلتر تصنيف أو وسم حقيقي، دون اشتراط مصدر مثبّت لعرض الأغلفة.
 * البطاقات من نظام البطاقات الموحد (cards.css).
 */

import { layerIn, layerOut } from './page-motion.js';
import { stripIn } from './motion.js';

export const DISCOVER_TYPES = Object.freeze([['anime', 'أنمي'], ['manga', 'مانجا'], ['cinema', 'سينما']]);
const KIND = { anime: 'أنمي', manga: 'مانجا', cinema: 'سينما' };

/**
 * @param {{ el: Function, glyph: Function, genres: (type: string) => {id: string, label: string, hue?: number, cover?: string|null}[],
 *   results: (type: string, genreId: string) => Promise<any[]>, card: (item: any, type: string) => {title: string, cover: string|null, sub?: string},
 *   open: (item: any, type: string) => void, openMangaGenre: (genreId: string) => void, openSearch: () => void,
 *   trending: () => {item: any, group: string}[], mount: (node: HTMLElement) => void, storage?: Storage }} ctx
 */
export function createUnifiedDiscover({ el, glyph, genres, genreArt = null, results, card, open, openMangaGenre, openSearch, trending, mount, storage = globalThis.localStorage }) {
  const KEY = 'vantara.unified.discover.type';
  let type = 'anime';
  try { const v = storage?.getItem(KEY); if (DISCOVER_TYPES.some(([k]) => k === v)) type = v; } catch { /* */ }
  let host = null, overlay = null, token = 0, suspended = false, suspendedScroll = 0;
  // Bounded result cache, intentionally separate from the browser's image-byte cache.
  const RESULT_TTL = 5 * 60_000;
  const RESULT_LIMIT = 12;
  const resultCache = new Map();
  const pending = new Map();
  const scrollByKey = new Map();
  let moreObserver = null, observedMore = null;
  const stopMore = (node = null) => {
    if (node && node !== observedMore) return;
    moreObserver?.disconnect(); moreObserver = null; observedMore = null;
  };
  const watchMore = (node) => {
    stopMore();
    if (!node || suspended || !globalThis.IntersectionObserver) return;
    moreObserver = new IntersectionObserver((entries) => {
      if (observedMore === node && !suspended && node.isConnected && entries.some(e => e.isIntersecting)) node.click();
    }, { root: overlay, rootMargin: '200px' });
    observedMore = node;
    moreObserver.observe(node);
  };
  let activeKey = null;
  const resultKey = (g, t) => t + ':' + (g.id ?? '__all__');
  const normalizeResults = (result) => Array.isArray(result)
    ? { items: result, hasNext: false }
    : { items: Array.isArray(result?.items) ? result.items : [], hasNext: Boolean(result?.hasNext ?? result?.hasNextPage) };
  const remember = (key, result) => {
    resultCache.delete(key);
    const entry = { list: result.items, hasNext: result.hasNext, page: 1, at: Date.now(), loading: false };
    resultCache.set(key, entry);
    while (resultCache.size > RESULT_LIMIT) {
      const oldest = resultCache.keys().next().value;
      resultCache.delete(oldest);
      scrollByKey.delete(oldest);
    }
    return entry;
  };
  const requestResults = (key, t, g) => {
    if (!pending.has(key)) {
      const p = Promise.resolve().then(() => results(t, g.id, 1))
        .then((result) => remember(key, normalizeResults(result)))
        .finally(() => { if (pending.get(key) === p) pending.delete(key); });
      pending.set(key, p);
    }
    return pending.get(key);
  };
  const txt = (tag, cls, s) => { const n = el(tag, cls, s ?? ''); if (s && /[A-Za-z]/.test(s)) n.dir = 'auto'; return n; };
  // صورة في ذاكرة المتصفح تظهر فورًا (لا تتلاشى من جديد مع كل رسم)، والفاشلة تُزال فلا يبقى إطار مكسور
  const img = (src, cls) => { const i = el('img', cls); i.alt = ''; i.loading = 'lazy'; i.decoding = 'async'; i.onload = () => i.classList.add('in'); i.onerror = () => i.remove(); if (src) i.src = src; if (i.complete && i.naturalWidth) i.classList.add('in'); return i; };

  function poster(item, t) {
    const c = card(item, t);
    const b = el('button', 'uv-po ud-po'); b.type = 'button';
    const art = el('span', 'uv-art'); if (c.cover) art.append(img(c.cover, 'uv-img'));
    b.append(art, txt('b', 'uv-t1', c.title || 'عمل'));
    if (c.sub) b.append(txt('span', 'uv-t2', c.sub));
    b.onclick = () => open(item, t);
    return b;
  }
  /**
   * بلاطة التصنيف بتصميم «حسب النوع» في السينما: صورة عمل عريضة تغطي البلاطة، وتدرّج داكن من الأسفل يحمل
   * الاسم في زاويته. الصورة: مما في الرئيسية إن وُجدت، وإلا تُطلب لنوعها (بنر الأنمي، خلفية السينما) وتظهر بتلاشٍ.
   */
  function genreTile(g) {
    const b = el('button', 'ud-genre'); b.type = 'button';
    b.style.setProperty('--h', String(g.hue ?? 260));
    const art = el('span', 'ud-genre-art');
    const put = (src) => { if (src && !art.firstChild) art.append(img(src, 'ud-genre-img')); };
    put(g.cover);
    if (!g.cover && genreArt) {
      const t = type;
      void Promise.resolve(genreArt(t, g.id)).then((src) => { if (t === type) put(src); }, () => {});
    }
    b.append(art, el('b', 'ud-genre-l', g.label));
    b.onclick = () => openGenre(g);
    return b;
  }
  /**
   * نتائج تصنيف (أو «كل الأعمال» حين `g.id` فارغ) بنوعها، وفوقها فلتر النوع نفسه: نفس التصنيف في نوع آخر
   * بلمسة. المانجا تفتح صفحة مجموعتها (فلتر التصنيف في المصادر) لأنها تُجلب من محرّك التطبيق.
   */
  function openGenre(g, t = type) {
    stopMore();
    const key = resultKey(g, t);
    const mine = ++token;
    if (overlay && !suspended && activeKey) scrollByKey.set(activeKey, overlay.scrollTop || 0);
    // D-027: keep the same opaque overlay while switching types. Removing it
    // before a new overlay's fade exposes the underlying unified Home.
    if (!overlay || suspended) {
      overlay?.remove();
      suspended = false;
      const page = el('div', 'uv-page');
      page.setAttribute('role', 'dialog');
      page.setAttribute('aria-modal', 'true');
      overlay = page;
      mount(page);
      page.classList.add('in');
      layerIn(page);
    }
    activeKey = key;
    const page = overlay;
    const top = el('div', 'uv-ptop');
    const back = el('button', 'uv-back'); back.type = 'button'; back.setAttribute('aria-label', 'رجوع'); back.innerHTML = glyph('back', { size: 24 }); back.onclick = closeGenre;
    top.append(back, el('h1', null, g.label));
    const seg = el('nav', 'us-seg ud-seg ud-seg--page'); seg.setAttribute('role', 'tablist');
    for (const [k, l] of DISCOVER_TYPES) {
      const b = el('button', k === t ? 'on' : '', l); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(k === t));
      b.onclick = () => { if (k !== t) openGenre(g, k); };
      seg.append(b);
    }
    const cached = resultCache.get(key);
    const valid = cached && Date.now() - cached.at < RESULT_TTL;
    const grid = (valid && cached.grid) || el('div', 'uv-grid');
    page.replaceChildren(top, seg, grid);
    page.scrollTop = scrollByKey.get(key) ?? 0;
    const bindMore = (entry) => {
      const more = el('button', 'us-more', 'تحميل المزيد'); more.type = 'button'; more.dataset.udMore = '';
      entry.updateMore = (rearm = false) => {
        if (!entry.hasNext) { stopMore(more); more.remove(); return; }
        more.textContent = entry.loading ? 'جارٍ التحميل…' : entry.failed ? 'أعد المحاولة' : 'تحميل المزيد';
        more.setAttribute('aria-busy', String(entry.loading));
        if (rearm && !entry.failed && entry.autoContinue !== false && more.isConnected) watchMore(more);
      };
      more.onclick = () => {
        if (entry.loading || !entry.hasNext) return;
        entry.loading = true; entry.failed = false; entry.updateMore();
        void Promise.resolve().then(() => results(t, g.id, entry.page + 1)).then((raw) => {
          if (resultCache.get(key) !== entry) return;
          const next = normalizeResults(raw);
          const seen = new Set(entry.list.filter(x => x?.id != null).map(x => String(x.id)));
          const added = next.items.filter(x => x?.id == null || (!seen.has(String(x.id)) && seen.add(String(x.id))));
          entry.list.push(...added);
          entry.autoContinue = added.length > 0;
          if (added.length) entry.grid.querySelector('.uv-none')?.remove();
          entry.grid.append(...added.map(x => poster(x, t)));
          entry.page++; entry.hasNext = next.hasNext;
        }, () => { entry.failed = true; }).finally(() => { entry.loading = false; entry.updateMore?.(true); });
      };
      if (entry.hasNext) { page.append(more); watchMore(more); }
      entry.updateMore();
    };
    const present = (entry, animate = false) => {
      if (page !== overlay || mine !== token) return;
      grid.replaceChildren(...entry.list.map((x) => poster(x, t)));
      if (!grid.childElementCount) grid.append(el('p', 'uv-none', 'لا أعمال في هذا التصنيف الآن'));
      else if (animate) stripIn([...grid.children].slice(0, 9));
      entry.grid = grid;
      bindMore(entry);
      page.scrollTop = scrollByKey.get(key) ?? 0;
    };
    if (valid) {
      // D-028: no new skeletons or catalogue requests on returning to a loaded type.
      resultCache.delete(key);
      resultCache.set(key, cached);
      if (!cached.grid) present(cached);
      else bindMore(cached);
      return;
    }
    for (let i = 0; i < 9; i++) { const p = el('div', 'uv-po'); p.append(el('i', 'uv-art')); grid.append(p); }
    void requestResults(key, t, g).then((entry) => present(entry, true),
      () => { if (page === overlay && mine === token) grid.replaceWith(el('p', 'uv-none', 'تعذّر الجلب، حاول بعد قليل')); });
  }
  function closeGenre() {
    if (!overlay || suspended) return false;
    stopMore();
    const o = overlay;
    if (activeKey) scrollByKey.set(activeKey, o.scrollTop || 0);
    overlay = null; activeKey = null; token++;
    o.classList.remove('in');
    layerOut(o, () => o.remove());
    return true;
  }

  function suspend() {
    if (!overlay || suspended) return false;
    stopMore();
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
    watchMore(overlay.querySelector('[data-ud-more]'));
    return true;
  }
  function discardSuspended() {
    if (!suspended) return false;
    stopMore();
    overlay?.remove();
    overlay = null; activeKey = null; suspended = false; token++;
    return true;
  }

  function paintGenres(box) {
    box.replaceChildren(...genres(type).map(genreTile));
  }
  /**
   * الصفحة تُبنى مرة وتبقى (#323 U-10): كانت تُبنى من الصفر مع كل دخول ورجوع، فتُفك الأغلفة من جديد وتضيع
   * حالة اللمس والتركيز. الدخول التالي يحدّث «الرائج» وحده، وفقط إن تغيّرت قائمته.
   */
  let built = null;
  let trendingBox = null;
  let trendingSig = null;
  function render(node = host) {
    if (!node) return;
    host = node;
    if (built && built.parentNode === node) return void refreshTrending();
    const page = el('div', 'ud');
    const field = el('button', 'ud-field'); field.type = 'button';
    field.insertAdjacentHTML('afterbegin', glyph('search', { size: 20 }));
    field.append(el('span', null, 'أنمي، مانجا، فيلم أو مسلسل'));
    field.onclick = openSearch;
    page.append(field);

    const sec = el('section', 'ud-sec');
    const h = el('header', 'ud-sh'); h.append(el('h2', null, 'التصنيفات'));
    const seg = el('nav', 'us-seg ud-seg'); seg.setAttribute('role', 'tablist'); seg.setAttribute('aria-label', 'نوع التصنيفات');
    const box = el('div', 'ud-genres');
    for (const [k, l] of DISCOVER_TYPES) {
      const b = el('button', k === type ? 'on' : '', l); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(k === type));
      b.onclick = () => {
        type = k; try { storage?.setItem(KEY, k); } catch { /* */ }
        for (const x of seg.children) { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }
        paintGenres(box);
      };
      seg.append(b);
    }
    sec.append(h, seg, box);
    paintGenres(box);
    page.append(sec);

    const ts = el('section', 'ud-sec');
    const th = el('header', 'ud-sh'); th.append(el('h2', null, 'الرائج الآن'));
    trendingBox = el('div', 'ud-trending');
    trendingSig = null;
    ts.append(th, trendingBox);
    page.append(ts);
    refreshTrending();
    built = page;
    node.replaceChildren(page);
  }
  /**
   * «الرائج» وحده من بيانات الموحد الحالية. تُستدعى أيضًا حين تصل البيانات والصفحة ظاهرة (#323 U-05: كانت
   * تُقرأ مرة داخل render فقط، فمن دخل قبل وصولها بقي على «نجهّز الرائج…» للأبد).
   */
  function refreshTrending() {
    if (!trendingBox) return false;
    const tr = trending().slice(0, 10);
    const sig = tr.map(({ item, group }) => `${group}:${item?.id ?? item?.ref ?? item?.title ?? ''}`).join('|');
    if (sig === trendingSig) return false;
    trendingSig = sig;
    if (!tr.length) { trendingBox.replaceChildren(el('p', 'uv-none', 'نجهّز الرائج…')); return true; }
    const list = el('ol', 'us-rank');
    tr.forEach(({ item, group }, i) => {
      const c = card(item, group);
      const li = el('li');
      const b = el('button', 'us-rank-row'); b.type = 'button';
      const art = el('span', 'us-rank-art'); if (c.cover) art.append(img(c.cover, 'us-img'));
      const tx = el('span', 'us-rank-tx');
      tx.append(txt('b', 'us-t1', c.title || 'عمل'), txt('span', 'us-t2', [group === 'cinema' ? null : KIND[group], c.sub].filter(Boolean).join(' · ')));
      b.append(el('span', 'us-rank-n', String(i + 1)), art, tx);
      b.onclick = () => open(item, group);
      li.append(b); list.append(li);
    });
    trendingBox.replaceChildren(list);
    return true;
  }
  /** «كل الأعمال» بنوع الاكتشاف الحالي (الأنمي افتراضيًا). */
  const openAll = (t = type) => openGenre({ id: null, label: 'كل الأعمال' }, t);
  return { render, refreshTrending, back: closeGenre, openAll, openGenre, suspend, hideSuspended, resume, discardSuspended, motionNode: () => overlay, state: () => ({ type, suspended }) };
}
