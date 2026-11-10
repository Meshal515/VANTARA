/**
 * البحث الموحد (توحيد المحتوى): حقل واحد يبحث في الأنواع الثلاثة معًا، والنتائج مجمّعة بالنوع.
 *
 * - الطلبات الثلاثة متوازية؛ كل مجموعة تظهر حين تصل (لا ينتظر الأسرع الأبطأ)، ومقاسها محجوز بهياكل
 *   فلا تقفز الصفحة.
 * - آخر استعلام يفوز: نتيجة استعلام قديم تصل متأخرة لا تكتب فوق الجديد.
 * - بلا حاويات: عنوان المجموعة وعدّادها، وشبكة ملصقات 2:3 بلغة الرئيسية الموحدة، و«عرض الكل» للمجموعة.
 * العرض فقط؛ الفتح والبحث من القشرة.
 */

export const SEARCH_GROUPS = Object.freeze([
  Object.freeze({ id: 'anime', label: 'أنمي' }),
  Object.freeze({ id: 'manga', label: 'مانجا' }),
  Object.freeze({ id: 'cinema', label: 'أفلام ومسلسلات' }),
]);
const FILTERS = [['all', 'الكل'], ['anime', 'الأنمي'], ['manga', 'المانجا'], ['cinema', 'السينما']];
const PREVIEW = 6;
const KIND = { anime: 'أنمي', manga: 'مانجا', cinema: 'سينما' };

/**
 * يطلب الأنواع الثلاثة ويستدعي `onGroup` لكل مجموعة حين تصل. آخر استعلام يفوز (`isCurrent`).
 * @param {string} query
 * @param {Record<'anime'|'manga'|'cinema', (q: string) => Promise<any[]>>} engines
 */
export function runSearch(query, engines, onGroup, isCurrent = () => true) {
  return Promise.all(SEARCH_GROUPS.map(({ id }) =>
    Promise.resolve()
      .then(() => engines[id]?.(query) ?? [])
      .then((items) => ({ items: Array.isArray(items) ? items : [], error: false }), () => ({ items: [], error: true }))
      .then((r) => { if (isCurrent()) onGroup(id, r); return [id, r]; })));
}

/**
 * @param {{ el: Function, glyph: Function, engines: Record<string, Function>, open: (item: object, group: string) => void,
 *   card: (item: object, group: string) => { title: string, cover: string|null, sub?: string }, mount: (node: HTMLElement) => void,
 *   debounceMs?: number }} ctx
 */
export function createUnifiedSearch({ el, glyph, engines, open, card, mount, debounceMs = 320, recent = null, genres = () => [], trending = () => [], openTrend = null }) {
  let page = null, input = null, results = null, filterNav = null;
  let query = '', token = 0, timer = 0, filter = 'all', suspended = false, suspendedScroll = 0;
  const groups = new Map(); // id → { items, error, done, expanded }

  const txt = (tag, cls, s) => { const n = el(tag, cls, s ?? ''); if (s && /[A-Za-z]/.test(s)) n.dir = 'auto'; return n; };

  function posterOf(item, group) {
    const c = card(item, group);
    const b = el('button', 'us-po'); b.type = 'button';
    const art = el('span', 'us-art');
    if (c.cover) {
      const i = el('img', 'us-img'); i.alt = ''; i.loading = 'lazy'; i.decoding = 'async';
      i.onload = () => i.classList.add('in'); i.onerror = () => { i.style.visibility = 'hidden'; };
      i.src = c.cover; art.append(i);
    }
    b.append(art, txt('b', 'us-t1', c.title || 'عمل'));
    if (c.sub) b.append(txt('span', 'us-t2', c.sub));
    b.onclick = () => open(item, group);
    return b;
  }
  function skeleton() {
    const g = el('div', 'us-grid');
    for (let i = 0; i < 3; i++) { const p = el('div', 'us-po'); p.append(el('i', 'us-art us-sk'), el('i', 'us-sk us-l1'), el('i', 'us-sk us-l2')); g.append(p); }
    return g;
  }
  function groupNode(id) {
    const meta = SEARCH_GROUPS.find((g) => g.id === id);
    const st = groups.get(id);
    const sec = el('section', 'us-sec'); sec.dataset.group = id;
    const h = el('header', 'us-sh');
    h.append(el('h2', null, meta.label));
    if (st?.done && st.items.length) h.append(el('span', 'us-count', String(st.items.length)));
    sec.append(h);
    if (!st?.done) { sec.append(skeleton()); return sec; }
    if (!st.items.length) { sec.append(el('p', 'us-none', st.error ? 'تعذّر البحث هنا الآن' : 'لا نتائج')); return sec; }
    const g = el('div', 'us-grid');
    const list = st.expanded ? st.items : st.items.slice(0, PREVIEW);
    for (const it of list) g.append(posterOf(it, id));
    sec.append(g);
    if (!st.expanded && st.items.length > PREVIEW) {
      const more = el('button', 'us-more'); more.type = 'button';
      more.innerHTML = `<span>عرض الكل (${st.items.length})</span>${glyph('chevronDown', { size: 16 })}`;
      more.onclick = () => { st.expanded = true; paintGroup(id); };
      sec.append(more);
    }
    return sec;
  }
  function paintGroup(id) {
    const old = results?.querySelector(`.us-sec[data-group="${id}"]`);
    if (old) old.replaceWith(groupNode(id));
  }
  function paintResults() {
    if (!results) return;
    if (!query) { results.replaceChildren(...idleNodes()); return; }
    const shown = SEARCH_GROUPS.filter((g) => filter === 'all' || g.id === filter).map((g) => groupNode(g.id));
    results.replaceChildren(...shown);
  }
  /**
   * قبل الكتابة (طلب المالك): آخر ما بحثت عنه، ثم التصنيفات، ثم «الرائج الآن» قائمة مرقّمة منوّعة بين الأنواع.
   * الفلتر يصفّي الرائج والتصنيفات معًا.
   */
  function idleNodes() {
    const out = [];
    const terms = recent?.list() ?? [];
    if (terms.length) {
      const sec = el('section', 'us-sec');
      const h = el('header', 'us-sh'); h.append(el('h2', null, 'آخر ما بحثت عنه'));
      const clear = el('button', 'us-link', 'امسح'); clear.type = 'button'; clear.onclick = () => { recent.clear(); paintResults(); };
      h.append(clear);
      const chips = el('div', 'us-chips');
      for (const t of terms) {
        const c = el('span', 'us-chip us-chip--recent');
        const go = el('button', 'us-chip-go'); go.type = 'button';
        go.insertAdjacentHTML('afterbegin', glyph('history', { size: 16 }));
        go.append(txt('span', null, t));
        go.onclick = () => { input.value = t; void search(t); };
        const x = el('button', 'us-chip-x'); x.type = 'button'; x.setAttribute('aria-label', `احذف ${t}`); x.innerHTML = glyph('close', { size: 14 });
        x.onclick = () => { recent.remove(t); paintResults(); };
        c.append(go, x); chips.append(c);
      }
      sec.append(h, chips); out.push(sec);
    }
    const gs = genres(filter);
    if (gs.length) {
      const sec = el('section', 'us-sec');
      const h = el('header', 'us-sh'); h.append(el('h2', null, 'تصفّح بالتصنيف'));
      const chips = el('div', 'us-chips');
      for (const g of gs) { const b = el('button', 'us-chip', g.label); b.type = 'button'; b.onclick = () => g.open(); chips.append(b); }
      sec.append(h, chips); out.push(sec);
    }
    const tr = trending(filter);
    const sec = el('section', 'us-sec');
    const h = el('header', 'us-sh'); h.append(el('h2', null, 'الرائج الآن'));
    sec.append(h);
    if (!tr.length) sec.append(skeleton());
    else {
      const list = el('ol', 'us-rank');
      tr.slice(0, 10).forEach(({ item, group }, i) => {
        const c = card(item, group);
        const li = el('li');
        const b = el('button', 'us-rank-row'); b.type = 'button';
        const n = el('span', 'us-rank-n', String(i + 1));
        const art = el('span', 'us-rank-art');
        if (c.cover) { const im = el('img', 'us-img'); im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.onload = () => im.classList.add('in'); im.src = c.cover; art.append(im); }
        const tx = el('span', 'us-rank-tx');
        tx.append(txt('b', 'us-t1', c.title || 'عمل'), txt('span', 'us-t2', [group === 'cinema' ? null : KIND[group], c.sub].filter(Boolean).join(' · ')));
        b.append(n, art, tx);
        b.onclick = () => (openTrend ? openTrend(item, group) : open(item, group));
        li.append(b); list.append(li);
      });
      sec.append(list);
    }
    out.push(sec);
    return out;
  }
  function search(q) {
    query = q.trim();
    const mine = ++token;
    if (query.length >= 2) recent?.remember(query);
    groups.clear();
    if (!query) return paintResults();
    for (const g of SEARCH_GROUPS) groups.set(g.id, { items: [], error: false, done: false, expanded: false });
    paintResults();
    return runSearch(query, engines, (id, r) => {
      groups.set(id, { ...r, done: true, expanded: false });
      if (filter === 'all' || filter === id) paintGroup(id);
    }, () => mine === token);
  }
  function setFilter(k) {
    filter = k;
    // الرائج والتصنيفات تتبع الفلتر أيضًا
    for (const b of filterNav.children) { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    paintResults();
  }

  function build() {
    page = el('div', 'uv-page us-page'); page.setAttribute('role', 'dialog'); page.setAttribute('aria-modal', 'true'); page.setAttribute('aria-label', 'البحث');
    // ترويسة بعنوان، ثم الحقل تحتها بمسافة (كان الحقل كبسولة ملتصقة بأعلى الشاشة)، ثم الفلتر مقطّعًا ظاهرًا
    const top = el('div', 'us-top');
    const back = el('button', 'uv-back'); back.type = 'button'; back.setAttribute('aria-label', 'رجوع'); back.innerHTML = glyph('back', { size: 24 }); back.onclick = close;
    top.append(back, el('h1', 'us-title', 'البحث'));
    const form = el('form', 'us-field'); form.setAttribute('role', 'search');
    form.insertAdjacentHTML('afterbegin', glyph('search', { size: 20 }));
    input = el('input', 'us-input'); input.type = 'search'; input.enterKeyHint = 'search'; input.autocomplete = 'off'; input.placeholder = 'أنمي، مانجا، فيلم أو مسلسل'; input.setAttribute('aria-label', 'ابحث');
    input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => search(input.value), debounceMs); };
    form.onsubmit = (e) => { e.preventDefault(); clearTimeout(timer); void search(input.value); input.blur(); };
    form.append(input);
    filterNav = el('nav', 'us-seg'); filterNav.setAttribute('role', 'tablist'); filterNav.setAttribute('aria-label', 'النوع');
    for (const [k, l] of FILTERS) { const b = el('button', k === filter ? 'on' : '', l); b.type = 'button'; b.dataset.k = k; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(k === filter)); b.onclick = () => setFilter(k); filterNav.append(b); }
    const head = el('div', 'us-head'); head.append(top, form, filterNav);
    results = el('div', 'us-results');
    page.append(head, results);
    paintResults();
  }

  function openPage(initial = '') {
    if (suspended) resume();
    if (!page) build();
    if (!page.isConnected) mount(page);
    if (!query) paintResults(); // الرائج والسجل بآخر حالهما في كل فتح
    requestAnimationFrame(() => page.classList.add('in'));
    if (initial) { input.value = initial; void search(initial); }
    setTimeout(() => input?.focus(), 60);
  }
  function close() {
    if (!page?.isConnected || suspended) return false;
    page.classList.remove('in');
    const p = page;
    setTimeout(() => p.remove(), 260);
    return true;
  }
  function suspend() {
    if (!page?.isConnected || suspended) return false;
    suspended = true;
    suspendedScroll = page.scrollTop || 0;
    page.style.pointerEvents = 'none';
    return true;
  }
  function hideSuspended() {
    if (!suspended || !page) return;
    page.style.visibility = 'hidden';
    page.setAttribute('aria-hidden', 'true');
  }
  function resume() {
    if (!suspended || !page) return false;
    suspended = false;
    page.style.visibility = '';
    page.style.pointerEvents = '';
    page.removeAttribute('aria-hidden');
    page.scrollTop = suspendedScroll;
    return true;
  }
  function discardSuspended() {
    if (!suspended) return false;
    page?.remove(); page = null; suspended = false;
    return true;
  }
  return { open: openPage, close, suspend, hideSuspended, resume, discardSuspended, motionNode: () => page, isOpen: () => Boolean(page?.isConnected && !suspended), search, state: () => ({ query, filter, groups, suspended }) };
}
