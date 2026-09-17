import {
  createPageLoader,
  createProgressSaver,
  createTapDetector,
  zoneOf,
} from './reader.js';

const $ = (selector, root = document) => root.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return null;
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const error = new Error(payload?.error ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.error;
    error.detail = payload?.detail;
    throw error;
  }
  return payload;
}

const STATUS_LABEL = { READING: 'يقرأ', ONLINE: 'متصل', IDLE: 'خامل', OFFLINE: 'غير متصل' };
const LANG_RANK = { ar: 0, en: 1 };
const state = { user: null, library: [], sources: new Map(), route: { name: 'orbit' }, cleanup: null };
const root = $('#root');

function render(node) {
  if (state.cleanup) state.cleanup();
  state.cleanup = null;
  root.replaceChildren(node);
}

function topbar(title, { back = null, actions = [] } = {}) {
  const bar = el('header', 'topbar');
  if (back) {
    const button = el('button', 'icon-btn', '→');
    button.type = 'button';
    button.setAttribute('aria-label', 'رجوع');
    button.addEventListener('click', back);
    bar.append(button);
  }
  const brand = el('div', 'topbar__brand');
  brand.append(el('span', 'topbar__mark', 'V'), el('h1', 'topbar__title', title));
  bar.append(brand);
  for (const action of actions) bar.append(action);
  return bar;
}

function normalizeTitle(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ar').replace(/\s+/g, ' ');
}

async function loadSourceMap() {
  if (state.sources.size > 0) return state.sources;
  try {
    const { content = [] } = await api('/v1/sources');
    for (const source of content) state.sources.set(source.sourceId, source);
  } catch {}
  return state.sources;
}

function providerRank(provider) {
  const lang = state.sources.get(provider.source)?.lang ?? state.sources.get(provider.sourceId)?.lang ?? '';
  return LANG_RANK[lang] ?? 2;
}

// ───────────────────────────── دخول ─────────────────────────────
async function screenOrbit() {
  const wrap = el('main', 'orbit');
  const inner = el('section', 'orbit__inner');
  const logo = el('div', 'orbit__logo');
  logo.innerHTML = '<span class="orbit__logo-mark">V</span>';
  inner.append(logo, el('h1', 'orbit__brand', 'VANTARA'));
  inner.append(el('p', 'orbit__tag', 'مكتبتكم الخاصة · العربي أولًا'));

  const accounts = el('div', 'orbit__accounts');
  inner.append(accounts);

  const form = el('form', 'login hidden');
  const password = el('input', 'login__input');
  password.type = 'password';
  password.placeholder = 'كلمة المرور';
  password.autocomplete = 'current-password';
  const submit = el('button', 'btn', 'دخول');
  submit.type = 'submit';
  const message = el('div', 'msg');
  form.append(password, submit, message);
  inner.append(form);

  let chosen = null;
  const choose = (account, button) => {
    chosen = account;
    for (const other of accounts.querySelectorAll('.account')) other.classList.toggle('account--active', other === button);
    form.classList.remove('hidden');
    password.focus();
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!chosen || submit.disabled) return;
    submit.disabled = true;
    message.className = 'msg';
    message.textContent = 'جارٍ الدخول…';
    try {
      const result = await api('/v1/auth/login', { method: 'POST', body: { username: chosen.username, password: password.value } });
      state.user = result.user;
      await go({ name: 'home' });
    } catch (error) {
      message.className = 'msg msg--error';
      message.textContent = error.code === 'invalid_credentials' ? 'كلمة المرور غير صحيحة' : 'تعذّر الدخول. حاول مرة أخرى.';
      submit.disabled = false;
      password.select();
    }
  });

  wrap.append(inner);
  render(wrap);

  try {
    const { content = [] } = await api('/v1/auth/accounts');
    accounts.replaceChildren();
    for (const account of content) {
      const button = el('button', 'account');
      button.type = 'button';
      button.append(el('div', 'account__avatar', [...account.displayName][0] ?? '؟'));
      const info = el('div', 'account__info');
      info.append(el('div', 'account__name', account.displayName), el('div', 'account__status', account.username));
      button.append(info);
      button.addEventListener('click', () => choose(account, button));
      accounts.append(button);
    }
    if (content.length === 0) accounts.append(el('p', 'state', 'لا توجد حسابات بعد.'));
  } catch {
    accounts.replaceChildren(el('p', 'state', 'تعذّر الوصول إلى الخادم.'));
  }
}

// ───────────────────────────── الرئيسية والبحث ─────────────────────────────
function workCard(work, onOpen) {
  const card = el('button', 'card');
  card.type = 'button';
  const cover = el('img', 'card__cover skeleton');
  cover.loading = 'lazy';
  cover.decoding = 'async';
  cover.alt = '';
  cover.src = `/v1/img/series-thumb/${encodeURIComponent(work.id)}?maxWidth=360`;
  cover.addEventListener('load', () => cover.classList.remove('skeleton'), { once: true });
  cover.addEventListener('error', () => { cover.classList.remove('skeleton'); cover.style.visibility = 'hidden'; }, { once: true });
  const body = el('div', 'card__body');
  body.append(el('h3', 'card__title', work.title));
  const meta = el('div', 'card__meta');
  meta.append(el('span', null, `${work.chapters ?? 0} فصل`));
  if ((work.unread ?? 0) > 0) meta.append(el('span', 'badge badge--accent', `${work.unread} جديد`));
  body.append(meta);
  card.append(cover, body);
  card.addEventListener('click', () => onOpen(work));
  return card;
}

async function renderSearchResults(host, q) {
  host.replaceChildren(el('div', 'state', 'جارٍ البحث في المصادر…'));
  try {
    await loadSourceMap();
    const result = await api(`/v1/search?q=${encodeURIComponent(q)}`);
    const groups = [...(result.content ?? [])].map((group) => ({
      ...group,
      providers: [...(group.providers ?? [])].sort((a, b) => providerRank(a) - providerRank(b)),
    })).sort((a, b) => {
      const arA = a.providers.some((p) => providerRank(p) === 0) ? 0 : 1;
      const arB = b.providers.some((p) => providerRank(p) === 0) ? 0 : 1;
      return arA - arB;
    });

    host.replaceChildren();
    if (groups.length === 0) {
      host.append(el('div', 'state', 'ما لقيت نتيجة من المصادر السليمة.'));
      return;
    }

    for (const group of groups.slice(0, 40)) {
      const box = el('article', 'search-result');
      const head = el('div', 'search-result__head');
      head.append(el('h3', 'search-result__title', group.title));
      if (group.inLibrary) head.append(el('span', 'badge badge--accent', 'في مكتبتك'));
      box.append(head);

      const providers = el('div', 'providers');
      for (const provider of group.providers.slice(0, 8)) {
        const source = state.sources.get(provider.source) ?? state.sources.get(provider.sourceId);
        const lang = source?.lang ?? '';
        const row = el('button', 'provider');
        row.type = 'button';
        const label = el('span', 'provider__name', provider.name || source?.name || 'مصدر');
        const tags = el('span', 'provider__tags');
        if (lang === 'ar') tags.append(el('span', 'badge badge--accent', 'عربي'));
        else if (lang) tags.append(el('span', 'badge', lang.toUpperCase()));
        row.append(label, tags);
        row.addEventListener('click', async () => {
          if (row.disabled) return;
          row.disabled = true;
          label.textContent = group.inLibrary ? 'جارٍ الفتح…' : 'جارٍ الإضافة…';
          try {
            if (!group.inLibrary) {
              await api('/v1/library/source', { method: 'POST', body: { source: provider.source, sourceId: provider.sourceId } });
            }
            const library = await api('/v1/library');
            state.library = library.content ?? [];
            const wanted = normalizeTitle(group.title);
            const match = state.library.find((work) => normalizeTitle(work.title) === wanted)
              ?? state.library.find((work) => normalizeTitle(work.title).includes(wanted) || wanted.includes(normalizeTitle(work.title)));
            if (match) await go({ name: 'series', id: match.id });
            else await go({ name: 'home' });
          } catch {
            label.textContent = provider.name || 'تعذّرت الإضافة';
            row.disabled = false;
          }
        });
        providers.append(row);
      }
      box.append(providers);
      host.append(box);
    }
  } catch {
    host.replaceChildren(el('div', 'state state--error', 'تعذّر البحث الآن.'));
  }
}

async function screenHome() {
  const wrap = el('main', 'app');
  const out = el('button', 'btn btn--ghost', 'خروج');
  out.type = 'button';
  out.addEventListener('click', async () => {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    await go({ name: 'orbit' });
  });
  wrap.append(topbar('VANTARA', { actions: [out] }));

  const hero = el('section', 'hero');
  hero.append(el('div', 'hero__eyebrow', 'ARABIC FIRST'));
  hero.append(el('h2', 'hero__title', 'وش ودك تقرأ؟'));
  hero.append(el('p', 'hero__copy', 'ابحث في المصادر كلها. العربي يطلع لك أولًا تلقائيًا.'));
  const form = el('form', 'searchbar');
  const input = el('input', 'searchbar__input');
  input.type = 'search';
  input.placeholder = 'اسم مانجا، مانهوا، مانهوا…';
  input.autocomplete = 'off';
  const submit = el('button', 'btn', 'بحث');
  submit.type = 'submit';
  form.append(input, submit);
  hero.append(form);
  wrap.append(hero);

  const searchSection = el('section', 'section hidden');
  const searchHead = el('div', 'section__head');
  searchHead.append(el('h2', null, 'نتائج البحث'));
  const searchResults = el('div', 'search-results');
  searchSection.append(searchHead, searchResults);
  wrap.append(searchSection);

  const friendsSection = el('section', 'section');
  const friendsHead = el('div', 'section__head');
  friendsHead.append(el('h2', null, 'الأصدقاء الآن'));
  const friends = el('div', 'presence');
  friendsSection.append(friendsHead, friends);
  wrap.append(friendsSection);

  const librarySection = el('section', 'section');
  const libraryHead = el('div', 'section__head');
  libraryHead.append(el('h2', null, 'مكتبتي'));
  const count = el('span', 'section__count');
  libraryHead.append(count);
  const grid = el('div', 'grid');
  librarySection.append(libraryHead, grid);
  wrap.append(librarySection);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) return;
    searchSection.classList.remove('hidden');
    await renderSearchResults(searchResults, q);
  });

  render(wrap);
  for (let i = 0; i < 8; i++) {
    const placeholder = el('div', 'card');
    placeholder.append(el('div', 'card__cover skeleton'));
    grid.append(placeholder);
  }

  const [library, presence] = await Promise.all([
    api('/v1/library').catch(() => ({ content: [] })),
    api('/v1/presence').catch(() => ({ content: [] })),
  ]);
  state.library = library.content ?? [];
  count.textContent = `${state.library.length} عمل`;
  grid.replaceChildren();
  if (state.library.length === 0) grid.append(el('p', 'state', 'ابحث فوق وأضف أول عمل.'));
  for (const work of state.library) grid.append(workCard(work, (chosen) => go({ name: 'series', id: chosen.id })));

  friends.replaceChildren();
  for (const person of presence.content ?? []) {
    const chip = el('div', 'friend');
    chip.append(el('span', `dot dot--${String(person.status).toLowerCase()}`), el('span', null, person.username));
    const label = person.seriesTitle ? `${STATUS_LABEL[person.status] ?? person.status} · ${person.seriesTitle}` : (STATUS_LABEL[person.status] ?? person.status);
    chip.append(el('span', 'badge', label));
    friends.append(chip);
  }
  if ((presence.content ?? []).length === 0) friends.append(el('span', 'badge', 'لا أحد متصل'));
}

// ───────────────────────────── العمل ─────────────────────────────
async function screenSeries(id) {
  const wrap = el('main', 'app');
  const known = state.library.find((work) => work.id === id);
  wrap.append(topbar(known?.title ?? 'العمل', { back: () => go({ name: 'home' }) }));
  const list = el('ul', 'chapters');
  wrap.append(list);
  render(wrap);
  list.append(el('li', 'state', 'جارٍ تحميل الفصول…'));

  let data;
  try { data = await api(`/v1/series/${encodeURIComponent(id)}`); }
  catch (error) {
    list.replaceChildren(el('li', 'state', error.status === 404 ? 'العمل غير موجود.' : 'تعذّر تحميل العمل.'));
    return;
  }

  let listing = { content: [] };
  try { listing = await api(`/v1/series/${encodeURIComponent(id)}/listing`); } catch {}
  const local = data.chapters ?? [];
  const byNumber = new Map();
  for (const chapter of local) if (Number.isFinite(chapter.number)) byNumber.set(chapter.number, { ...chapter, local: true });
  for (const entry of listing.content ?? []) if (!byNumber.has(entry.number)) byNumber.set(entry.number, { ...entry, local: false });
  const chapters = [...byNumber.values()].sort((a, b) => (b.number ?? 0) - (a.number ?? 0));

  list.replaceChildren();
  if (chapters.length === 0) {
    list.append(el('li', 'state', 'المصدر لا يعرض فصولًا لهذا العمل.'));
    return;
  }

  for (const chapter of chapters) {
    const item = el('li');
    const button = el('button', 'chapter');
    button.type = 'button';
    const name = chapter.name ?? chapter.title ?? `الفصل ${chapter.number}`;
    const label = el('span', 'chapter__name', name);
    const badge = el('span', 'badge', chapter.local ? (chapter.read ? 'مقروء' : 'اقرأ') : 'جلب وقراءة');
    button.append(label, badge);
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        let selectedBookId = chapter.id;
        if (!chapter.local) {
          badge.textContent = 'جارٍ الجلب…';
          await api(`/v1/series/${encodeURIComponent(id)}/fetch`, { method: 'POST', body: { numbers: [chapter.number] } });
          const fresh = await api(`/v1/series/${encodeURIComponent(id)}`);
          selectedBookId = (fresh.chapters ?? []).find((c) => c.number === chapter.number)?.id;
        }
        if (!selectedBookId) throw new Error('missing book id');
        await go({ name: 'reader', bookId: selectedBookId, seriesId: id, title: name });
      } catch {
        badge.textContent = 'أعد المحاولة';
        button.disabled = false;
      }
    });
    item.append(button);
    list.append(item);
  }
}

// ───────────────────────────── القارئ المتصل ─────────────────────────────
async function screenReader({ bookId, seriesId, title }) {
  const shell = el('main', 'reader');
  const hud = el('div', 'reader__hud reader__hud--hidden');
  const back = el('button', 'reader__back', '→');
  back.type = 'button';
  back.addEventListener('click', () => go({ name: 'series', id: seriesId }));
  const hudTitle = el('div', 'reader__title', title ?? 'القارئ');
  const hudPage = el('div', 'reader__page', '');
  hud.append(back, hudTitle, hudPage);
  const flow = el('div', 'reader__flow');
  shell.append(hud, flow);
  render(shell);

  const cleanupFns = [];
  const savers = new Map();
  const loaders = new Map();
  const chapterNodes = new Map();
  let catalogue = [];
  let cursor = 0;
  let loadingNext = false;
  let endObserver = null;
  let pageObserver = null;
  let currentBookId = bookId;

  const chapterLabel = (chapter) => chapter.name ?? chapter.title ?? `الفصل ${chapter.number ?? ''}`;

  const refreshCatalogue = async () => {
    const [series, listing] = await Promise.all([
      api(`/v1/series/${encodeURIComponent(seriesId)}`),
      api(`/v1/series/${encodeURIComponent(seriesId)}/listing`).catch(() => ({ content: [] })),
    ]);
    const merged = new Map();
    for (const chapter of series.chapters ?? []) {
      if (Number.isFinite(chapter.number)) merged.set(chapter.number, { ...chapter, local: true });
    }
    for (const entry of listing.content ?? []) {
      if (!merged.has(entry.number)) merged.set(entry.number, { ...entry, local: false });
    }
    catalogue = [...merged.values()].filter((c) => Number.isFinite(c.number)).sort((a, b) => a.number - b.number);
    const current = (series.chapters ?? []).find((c) => c.id === currentBookId);
    const byId = catalogue.findIndex((c) => c.id === currentBookId);
    const byNumber = current ? catalogue.findIndex((c) => c.number === current.number) : -1;
    cursor = Math.max(0, byId >= 0 ? byId : byNumber >= 0 ? byNumber : 0);
  };

  const ensureLocal = async (chapter) => {
    if (chapter.id) return chapter;
    await api(`/v1/series/${encodeURIComponent(seriesId)}/fetch`, { method: 'POST', body: { numbers: [chapter.number] } });
    const fresh = await api(`/v1/series/${encodeURIComponent(seriesId)}`);
    const local = (fresh.chapters ?? []).find((c) => c.number === chapter.number);
    if (!local?.id) throw new Error('chapter_not_fetched');
    const index = catalogue.findIndex((c) => c.number === chapter.number);
    const merged = { ...chapter, ...local, local: true };
    if (index >= 0) catalogue[index] = merged;
    return merged;
  };

  const getSaver = (id) => {
    if (!savers.has(id)) savers.set(id, createProgressSaver({ bookId: id }));
    return savers.get(id);
  };

  const watchPages = () => {
    pageObserver?.disconnect();
    pageObserver = new IntersectionObserver((entries) => {
      let best = null;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
      }
      if (!best) return;
      const image = best.target;
      const id = image.dataset.bookId;
      const page = Number(image.dataset.page);
      if (!id || !Number.isFinite(page)) return;
      currentBookId = id;
      getSaver(id).update(page);
      loaders.get(id)?.warmAfter(page);
      const chapterTitle = image.closest('.reader-chapter')?.dataset.chapterTitle;
      if (chapterTitle) hudTitle.textContent = chapterTitle;
      hudPage.textContent = `${page}`;
    }, { threshold: [0.45, 0.65] });
    for (const image of flow.querySelectorAll('.reader__image')) pageObserver.observe(image);
  };

  const appendChapter = async (rawChapter, { dividerFrom = null, restore = false } = {}) => {
    const chapter = await ensureLocal(rawChapter);
    if (chapterNodes.has(chapter.id)) return chapter;
    const pages = await api(`/v1/books/${encodeURIComponent(chapter.id)}/pages`);
    const pageNumbers = (pages.content ?? []).map((p) => p.number);
    const loader = createPageLoader({ bookId: chapter.id, pageNumbers, prefetch: 2, maxWidth: 1100 });
    loaders.set(chapter.id, loader);

    if (dividerFrom) {
      const divider = el('div', 'chapter-divider');
      divider.append(el('div', 'chapter-divider__ended', `انتهى الفصل ${dividerFrom.number ?? ''}`));
      divider.append(el('div', 'chapter-divider__next', chapterLabel(chapter)));
      flow.append(divider);
      if (dividerFrom.id) void api(`/v1/books/${encodeURIComponent(dividerFrom.id)}/progress`, { method: 'PUT', body: { completed: true } }).catch(() => {});
    }

    const section = el('section', 'reader-chapter');
    section.dataset.bookId = chapter.id;
    section.dataset.chapterTitle = chapterLabel(chapter);
    section.dataset.chapterNumber = String(chapter.number ?? '');
    for (const page of pages.content ?? []) {
      const frame = el('div', 'reader__frame skeleton');
      if (page.width && page.height) frame.style.aspectRatio = `${page.width} / ${page.height}`;
      const image = el('img', 'reader__image');
      image.alt = '';
      image.decoding = 'async';
      image.loading = 'lazy';
      image.dataset.page = String(page.number);
      image.dataset.bookId = chapter.id;
      image.src = loader.urlFor(page.number);
      image.addEventListener('load', () => frame.classList.remove('skeleton'), { once: true });
      image.addEventListener('error', () => frame.classList.add('reader__frame--error'), { once: true });
      frame.append(image);
      section.append(frame);
    }
    flow.append(section);
    chapterNodes.set(chapter.id, section);
    watchPages();

    if (restore && pages.resumeAt) {
      requestAnimationFrame(() => {
        const target = section.querySelector(`[data-page="${pages.resumeAt}"]`);
        target?.scrollIntoView({ block: 'start' });
      });
    }
    return chapter;
  };

  const setEndTrigger = () => {
    endObserver?.disconnect();
    const old = flow.querySelector('.reader__sentinel');
    old?.remove();
    const sentinel = el('div', 'reader__sentinel');
    flow.append(sentinel);
    endObserver = new IntersectionObserver(async (entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || loadingNext) return;
      loadingNext = true;
      const previous = catalogue[cursor];
      const next = catalogue[cursor + 1];
      if (!next) {
        sentinel.className = 'reader__end';
        sentinel.textContent = 'وصلت إلى آخر فصل متاح';
        endObserver.disconnect();
        loadingNext = false;
        return;
      }
      sentinel.className = 'reader__sentinel reader__sentinel--loading';
      sentinel.textContent = `جارٍ تجهيز ${chapterLabel(next)}…`;
      try {
        const appended = await appendChapter(next, { dividerFrom: previous });
        cursor += 1;
        currentBookId = appended.id;
        setEndTrigger();
      } catch {
        sentinel.className = 'reader__retry';
        sentinel.replaceChildren(el('span', null, 'تعذّر تجهيز الفصل التالي'));
        const retry = el('button', 'btn btn--small', 'أعد المحاولة');
        retry.type = 'button';
        retry.addEventListener('click', () => { loadingNext = false; setEndTrigger(); });
        sentinel.append(retry);
      } finally {
        loadingNext = false;
      }
    }, { rootMargin: '1800px 0px 1800px 0px', threshold: 0 });
    endObserver.observe(sentinel);
  };

  try {
    await refreshCatalogue();
    let start = catalogue[cursor];
    if (!start || start.id !== bookId) {
      const series = await api(`/v1/series/${encodeURIComponent(seriesId)}`);
      const direct = (series.chapters ?? []).find((c) => c.id === bookId);
      start = direct ?? start;
      if (direct && !catalogue.some((c) => c.id === direct.id)) {
        catalogue.push({ ...direct, local: true });
        catalogue.sort((a, b) => a.number - b.number);
        cursor = catalogue.findIndex((c) => c.id === direct.id);
      }
    }
    if (!start) throw new Error('missing_start_chapter');
    const appended = await appendChapter(start, { restore: true });
    currentBookId = appended.id;
    hudTitle.textContent = chapterLabel(appended);
    setEndTrigger();
  } catch {
    flow.replaceChildren(el('div', 'reader__end', 'تعذّر تحميل الفصل.'));
  }

  const detector = createTapDetector({
    onTap: ({ y }) => {
      const zone = zoneOf(y, window.innerHeight);
      if (zone === 'chrome') hud.classList.toggle('reader__hud--hidden');
      else window.scrollBy({ top: zone === 'next' ? window.innerHeight * 0.82 : -window.innerHeight * 0.82, behavior: 'smooth' });
    },
  });
  cleanupFns.push(detector.attach(shell));

  const onHidden = () => {
    if (document.visibilityState === 'hidden') for (const saver of savers.values()) saver.flush(true);
  };
  document.addEventListener('visibilitychange', onHidden);
  cleanupFns.push(() => document.removeEventListener('visibilitychange', onHidden));

  state.cleanup = () => {
    for (const saver of savers.values()) saver.flush(true);
    pageObserver?.disconnect();
    endObserver?.disconnect();
    for (const fn of cleanupFns) fn();
  };
}

async function go(route) {
  state.route = route;
  if (route.name === 'orbit') return screenOrbit();
  if (route.name === 'home') return screenHome();
  if (route.name === 'series') return screenSeries(route.id);
  if (route.name === 'reader') return screenReader(route);
  return screenHome();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}

void screenOrbit();
