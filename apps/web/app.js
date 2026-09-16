/**
 * VANTARA — واجهة الطبقة الاجتماعية والقارئ.
 *
 * بلا إطار عمل بقرار: التطبيق شاشات قليلة، والحالة كلها من الخادم، وقارئ
 * يحتاج تحكمًا مباشرًا في أحداث اللمس والتمرير. إطار يضيف طبقة إعادة رسم بيننا
 * وبين الإطار الستين، وهو ما نحاول حمايته.
 */

import {
  createPageLoader,
  createProgressSaver,
  createTapDetector,
  observePages,
  zoneOf,
} from './reader.js';

const $ = (selector, root = document) => root.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** كل نداء يمر هنا: الخطأ يُعرض ولا يُهمل بصمت. */
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.error;
    throw error;
  }
  return payload;
}

const STATUS_LABEL = {
  READING: 'يقرأ',
  ONLINE: 'متصل',
  IDLE: 'خامل',
  OFFLINE: 'غير متصل',
};

const state = {
  user: null,
  library: [],
  route: { name: 'orbit' },
  cleanup: null,
};

const root = $('#root');

function render(node) {
  // كل شاشة تُنظّف مستمعاتها قبل أن تُستبدل: المستمع المتروك يسرّب ويتضاعف
  if (state.cleanup) {
    state.cleanup();
    state.cleanup = null;
  }
  root.replaceChildren(node);
}

// ───────────────────────────── ORBIT ─────────────────────────────

async function screenOrbit() {
  const wrap = el('div', 'orbit');
  const inner = el('div', 'orbit__inner');
  inner.append(el('h1', 'orbit__brand', 'VANTARA'));
  inner.append(el('p', 'orbit__tag', 'مكتبة وقارئ خاص'));

  const accounts = el('div', 'orbit__accounts');
  inner.append(accounts);

  const form = el('form', 'login hidden');
  const password = el('input');
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
    for (const other of accounts.querySelectorAll('.account')) {
      other.style.borderColor = other === button ? 'var(--accent)' : '';
    }
    form.classList.remove('hidden');
    password.focus();
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!chosen) return;
    submit.disabled = true;
    message.className = 'msg';
    message.textContent = 'جارٍ الدخول…';

    try {
      const result = await api('/v1/auth/login', {
        method: 'POST',
        body: { username: chosen.username, password: password.value },
      });
      state.user = result.user;
      await go({ name: 'home' });
    } catch (error) {
      message.className = 'msg msg--error';
      message.textContent =
        error.code === 'invalid_credentials'
          ? 'كلمة المرور غير صحيحة'
          : error.code === 'rate_limited'
            ? 'محاولات كثيرة. انتظر دقيقة.'
            : 'تعذّر الدخول. حاول مرة أخرى.';
      submit.disabled = false;
      password.select();
    }
  });

  wrap.append(inner);
  render(wrap);

  try {
    const { content } = await api('/v1/auth/accounts');
    accounts.replaceChildren();
    for (const account of content) {
      const button = el('button', 'account');
      button.type = 'button';
      const avatar = el('div', 'account__avatar');
      avatar.textContent = [...account.displayName][0] ?? '؟';
      button.append(avatar, el('div', 'account__name', account.displayName));
      button.append(el('div', 'account__status', account.username));
      button.addEventListener('click', () => choose(account, button));
      accounts.append(button);
    }
    if (content.length === 0) {
      accounts.append(el('p', 'state', 'لا توجد حسابات بعد.'));
    }
  } catch {
    accounts.replaceChildren(el('p', 'state', 'تعذّر الوصول إلى الخادم.'));
  }
}

// ───────────────────────────── الرئيسية ─────────────────────────────

function topbar(title, { back = null, actions = [] } = {}) {
  const bar = el('header', 'topbar');
  if (back) {
    const button = el('button', 'btn btn--ghost', '→');
    button.type = 'button';
    button.setAttribute('aria-label', 'رجوع');
    button.addEventListener('click', back);
    bar.append(button);
  }
  bar.append(el('h1', 'topbar__title', title));
  for (const action of actions) bar.append(action);
  return bar;
}

function workCard(work, onOpen) {
  const card = el('button', 'card');
  card.type = 'button';

  const cover = el('img', 'card__cover skeleton');
  cover.loading = 'lazy';
  cover.decoding = 'async';
  cover.alt = '';
  cover.src = `/v1/img/series-thumb/${encodeURIComponent(work.id)}?maxWidth=360`;
  cover.addEventListener('load', () => cover.classList.remove('skeleton'), { once: true });
  // غلاف مفقود لا يترك صندوقًا مكسورًا
  cover.addEventListener(
    'error',
    () => {
      cover.classList.remove('skeleton');
      cover.style.visibility = 'hidden';
    },
    { once: true },
  );

  const body = el('div', 'card__body');
  body.append(el('h3', 'card__title', work.title));
  const meta = el('div', 'card__meta');
  meta.append(el('span', null, `${work.chapters} فصل`));
  if (work.unread > 0) meta.append(el('span', 'badge', `${work.unread} جديد`));
  body.append(meta);

  card.append(cover, body);
  card.addEventListener('click', () => onOpen(work));
  return card;
}

async function screenHome() {
  const wrap = el('div', 'app');
  wrap.append(
    topbar('مكتبتي', {
      actions: [
        (() => {
          const out = el('button', 'btn btn--ghost', 'خروج');
          out.type = 'button';
          out.addEventListener('click', async () => {
            await api('/v1/auth/logout', { method: 'POST' }).catch(() => {});
            state.user = null;
            await go({ name: 'orbit' });
          });
          return out;
        })(),
      ],
    }),
  );

  const friendsSection = el('section', 'section');
  const friendsHead = el('div', 'section__head');
  friendsHead.append(el('h2', null, 'الأصدقاء الآن'));
  friendsSection.append(friendsHead);
  const friends = el('div', 'presence');
  friendsSection.append(friends);
  wrap.append(friendsSection);

  const librarySection = el('section', 'section');
  const libraryHead = el('div', 'section__head');
  libraryHead.append(el('h2', null, 'أتابعها'));
  const count = el('span', 'section__count');
  libraryHead.append(count);
  librarySection.append(libraryHead);
  const grid = el('div', 'grid');
  librarySection.append(grid);
  wrap.append(librarySection);

  render(wrap);

  // شبكة هيكلية أثناء التحميل: أفضل من فراغ يقفز عند وصول البيانات
  for (let i = 0; i < 10; i++) {
    const placeholder = el('div', 'card');
    placeholder.append(el('div', 'card__cover skeleton'));
    grid.append(placeholder);
  }

  const [library, presence] = await Promise.all([
    api('/v1/library').catch(() => ({ content: [] })),
    api('/v1/presence').catch(() => ({ content: [] })),
  ]);

  state.library = library.content;
  count.textContent = `${library.content.length} عمل`;

  grid.replaceChildren();
  if (library.content.length === 0) {
    grid.append(el('p', 'state', 'لا توجد أعمال بعد.'));
  }
  for (const work of library.content) {
    grid.append(workCard(work, (chosen) => go({ name: 'series', id: chosen.id })));
  }

  friends.replaceChildren();
  for (const person of presence.content) {
    const chip = el('div', 'friend');
    const dot = el('span', `dot dot--${person.status.toLowerCase()}`);
    chip.append(dot, el('span', null, person.username));
    const label = person.seriesTitle
      ? `${STATUS_LABEL[person.status]} · ${person.seriesTitle}`
      : STATUS_LABEL[person.status];
    chip.append(el('span', 'badge', label));
    friends.append(chip);
  }
  if (presence.content.length === 0) {
    friends.append(el('span', 'badge', 'لا أحد متصل'));
  }
}

// ───────────────────────────── صفحة العمل ─────────────────────────────

async function screenSeries(id) {
  const wrap = el('div', 'app');
  const known = state.library.find((work) => work.id === id);
  wrap.append(topbar(known?.title ?? 'العمل', { back: () => go({ name: 'home' }) }));

  const list = el('ul', 'chapters');
  wrap.append(list);
  render(wrap);

  list.append(el('li', 'state', 'جارٍ تحميل الفصول…'));

  let data;
  try {
    data = await api(`/v1/series/${encodeURIComponent(id)}`);
  } catch (error) {
    list.replaceChildren(
      el('li', 'state', error.status === 404 ? 'العمل غير موجود.' : 'تعذّر تحميل العمل.'),
    );
    return;
  }

  list.replaceChildren();
  const chapters = data.chapters ?? [];
  const haveNumbers = new Set(chapters.map((chapter) => chapter.number));

  const openReader = (chapter) =>
    go({
      name: 'reader',
      bookId: chapter.id,
      seriesId: id,
      title: chapter.name ?? `الفصل ${chapter.number ?? ''}`,
    });

  for (const chapter of chapters) {
    const item = el('li');
    const button = el('button', 'chapter');
    button.type = 'button';
    button.append(el('span', 'chapter__name', chapter.name ?? `الفصل ${chapter.number ?? ''}`));
    if (chapter.read) button.append(el('span', 'badge', 'مقروء'));
    button.addEventListener('click', () => openReader(chapter));
    item.append(button);
    list.append(item);
  }

  // قائمة المصدر: ما يعرضه الموقع ولم يُجلب بعد.
  // العمل يُتابع بلا تنزيل، فبدون هذا القسم تبدو الصفحة فارغة وهي ليست كذلك.
  let listing = { content: [] };
  try {
    listing = await api(`/v1/series/${encodeURIComponent(id)}/listing`);
  } catch {
    listing = { content: [] };
  }

  const pending = listing.content.filter((entry) => !haveNumbers.has(entry.number));
  if (pending.length === 0 && chapters.length === 0) {
    list.append(el('li', 'state', 'المصدر لا يعرض فصولًا لهذا العمل.'));
    return;
  }

  if (pending.length > 0) {
    const head = el('li', 'section__head');
    head.append(el('h2', null, 'متوفر في المصدر'));
    head.append(el('span', 'section__count', `${pending.length} فصل`));
    list.append(head);
  }

  for (const entry of pending.slice(0, 60)) {
    const item = el('li');
    const button = el('button', 'chapter');
    button.type = 'button';
    const label = el('span', 'chapter__name', entry.title ?? `الفصل ${entry.number}`);
    const badge = el('span', 'badge', 'جلب وقراءة');
    button.append(label, badge);

    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      badge.textContent = 'جارٍ الجلب…';
      try {
        await api(`/v1/series/${encodeURIComponent(id)}/fetch`, {
          method: 'POST',
          body: { numbers: [entry.number] },
        });
        // الجلب يكتب الفصل في المكتبة، فنعيد القراءة لنأخذ معرّفه
        const fresh = await api(`/v1/series/${encodeURIComponent(id)}`);
        const match = (fresh.chapters ?? []).find((chapter) => chapter.number === entry.number);
        if (match) {
          await openReader(match);
          return;
        }
        badge.textContent = 'جُلب — حدّث الصفحة';
        button.disabled = false;
      } catch {
        // الفصل قد يفشل على مصدر بعينه؛ الرسالة تقول ذلك ولا تبقى معلّقة
        badge.textContent = 'تعذّر الجلب';
        button.disabled = false;
      }
    });

    item.append(button);
    list.append(item);
  }
}

// ───────────────────────────── القارئ ─────────────────────────────

async function screenReader({ bookId, seriesId, title }) {
  const wrap = el('div', 'reader');

  const chrome = el('header', 'reader__chrome');
  const back = el('button', 'btn btn--ghost', '→');
  back.type = 'button';
  back.setAttribute('aria-label', 'رجوع');
  back.addEventListener('click', () => go({ name: 'series', id: seriesId }));
  chrome.append(back, el('h1', 'topbar__title', title || 'قراءة'));

  const pagesWrap = el('div', 'reader__pages');
  const hud = el('div', 'reader__hud');

  wrap.append(chrome, pagesWrap, hud);
  render(wrap);

  let data;
  try {
    data = await api(`/v1/books/${encodeURIComponent(bookId)}/pages`);
  } catch (error) {
    pagesWrap.append(
      el('p', 'state', error.code === 'no_pages' ? 'لا صفحات في هذا الفصل.' : 'تعذّر تحميل الصفحات.'),
    );
    return;
  }

  const pages = data.content;
  const numbers = pages.map((page) => page.number);
  const loader = createPageLoader({ bookId, pageNumbers: numbers, prefetch: 2, maxWidth: 1400 });
  const saver = createProgressSaver({ bookId });

  const images = [];
  pages.forEach((page, position) => {
    const image = el('img', 'page');
    image.dataset.page = String(page.number);
    image.alt = '';
    image.decoding = 'async';
    // الأبعاد الحقيقية من الخادم: الصندوق محفوظ قبل التحميل ⇒ صفر قفزة تخطيط
    if (page.width && page.height) {
      image.width = page.width;
      image.height = page.height;
      image.style.aspectRatio = `${page.width} / ${page.height}`;
    }
    if (position < 2) {
      image.loading = 'eager';
      image.src = loader.urlFor(page.number);
    } else {
      image.loading = 'lazy';
      image.dataset.src = loader.urlFor(page.number);
    }
    images.push(image);
    pagesWrap.append(image);
  });

  const lazy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const image = entry.target;
        if (image.dataset.src) {
          image.src = image.dataset.src;
          delete image.dataset.src;
        }
        lazy.unobserve(image);
      }
    },
    { rootMargin: '1200px 0px' },
  );
  for (const image of images) lazy.observe(image);

  let hudTimer = null;
  const total = data.pagesCount ?? pages.length;

  const tracker = observePages({
    container: pagesWrap,
    onPageChange: (pageNumber) => {
      hud.textContent = `${pageNumber} / ${total}`;
      hud.dataset.visible = 'true';
      loader.warmAfter(pageNumber);
      saver.update(pageNumber);
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => {
        hud.dataset.visible = 'false';
      }, 1400);
    },
  });
  for (const image of images) tracker.watch(image);

  // الاستئناف من حيث توقّف: بعد رسم أول إطار، وإلا قفز قبل أن يوجد ما يُقفز إليه
  if (data.resumeAt && data.resumeAt > 1 && !data.completed) {
    requestAnimationFrame(() => {
      const target = images.find((image) => Number(image.dataset.page) === data.resumeAt);
      if (target) target.scrollIntoView({ block: 'start' });
    });
  }

  let chromeVisible = false;
  let chromeTimer = null;

  const setChrome = (visible) => {
    chromeVisible = visible;
    chrome.dataset.visible = String(visible);
    // الإزاحة بدل التغطية: المحتوى ينزل بمقدار الشريط
    document.documentElement.style.setProperty(
      '--chrome-offset',
      visible ? `${chrome.offsetHeight}px` : '0px',
    );
    clearTimeout(chromeTimer);
    if (visible) chromeTimer = setTimeout(() => setChrome(false), 3200);
  };

  const detector = createTapDetector({
    onTap: ({ y }) => {
      const zone = zoneOf(y, window.innerHeight);
      if (zone === 'chrome') {
        setChrome(!chromeVisible);
        return;
      }
      // النقر يطوي صفحة لا فصلًا: الفصل يُختار من قائمته
      const at = Math.max(numbers.indexOf(tracker.current), 0);
      const target = images[zone === 'next' ? at + 1 : at - 1];
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });

  const detach = detector.attach(wrap);

  const onHide = () => {
    // آخر حدث مضمون على الجوال؛ beforeunload لا يُطلق موثوقًا
    if (document.visibilityState === 'hidden') saver.flush(true);
  };
  document.addEventListener('visibilitychange', onHide);

  state.cleanup = () => {
    detach();
    lazy.disconnect();
    tracker.disconnect();
    clearTimeout(hudTimer);
    clearTimeout(chromeTimer);
    document.removeEventListener('visibilitychange', onHide);
    document.documentElement.style.setProperty('--chrome-offset', '0px');
    saver.flush();
  };
}

// ───────────────────────────── التوجيه والنبضة ─────────────────────────────

async function go(route) {
  state.route = route;
  if (route.name === 'orbit') return screenOrbit();
  if (route.name === 'home') return screenHome();
  if (route.name === 'series') return screenSeries(route.id);
  if (route.name === 'reader') return screenReader(route);
  return screenOrbit();
}

/**
 * النبضة: تعلن الحضور وتغذّي حساب وقت القراءة.
 *
 * `interactions` تُجمع بين نبضتين، والخادم لا يحتسب وقتًا بلا تفاعل ولا لتبويب
 * مخفي — فالتبويب المتروك مفتوحًا لا يضخّم إحصائيات أحد.
 */
function startHeartbeat() {
  let interactions = 0;
  const bump = () => {
    interactions++;
  };
  for (const event of ['scroll', 'click', 'keydown', 'touchend']) {
    window.addEventListener(event, bump, { passive: true });
  }

  setInterval(() => {
    if (!state.user) return;
    const route = state.route;
    const body = {
      visible: document.visibilityState === 'visible',
      interactions,
    };
    if (route.name === 'reader') {
      body.seriesRef = route.seriesId;
      body.chapterRef = route.bookId;
      const work = state.library.find((item) => item.id === route.seriesId);
      if (work) body.seriesTitle = work.title;
      if (route.title) body.chapterLabel = route.title;
    }
    interactions = 0;
    void api('/v1/presence/beat', { method: 'POST', body }).catch(() => {});
  }, 25_000);
}

async function boot() {
  startHeartbeat();
  try {
    const me = await api('/v1/auth/me');
    state.user = me;
    await go({ name: 'home' });
  } catch {
    await go({ name: 'orbit' });
  }
}

void boot();
