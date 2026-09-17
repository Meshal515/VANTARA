/**
 * VANTARA — القشرة والتوجيه.
 *
 * قاعدة الأداء الحاكمة: الواجهة تُرسم من المحلي فورًا، والشبكة تُصحّح بعدها.
 * لا شاشة تحميل عند كل مزامنة، ولا انتظار لـCloudflare قبل أول رسم:
 *
 *   0ms    إقلاع
 *   ~300ms واجهة من المرآة المحلية
 *   خلفية  جلسة · فروقات · حضور · إشعارات
 *
 * والتحديث جزئي دائمًا. إعادة رسم الشاشة كل نبضة تُعيد تحميل الصور وتُرجع
 * التمرير للأعلى، وذلك وحده يجعل التطبيق يبدو معطوبًا حتى لو كان كل رقم صحيحًا.
 */

import { createPageLoader, createProgressSaver, createTapDetector, zoneOf } from './reader.js';
import { createSync } from './lib/sync.js';
import { appVersion, endpoints, setEndpoints, syncConfigured } from './lib/config.js';
import { screenAccounts } from './screens/accounts.js';
import { icon } from './lib/icons.js';
import { checkForUpdate, dismissUpdate } from './lib/update.js';

const $ = (selector, root = document) => root.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const root = $('#root');
const config = endpoints();
const sync = createSync({ baseUrl: config.sync });

const state = {
  route: { name: 'gate' },
  /** يُستدعى قبل استبدال الشاشة: مراقبات وخلفيات WebGL تُفكّ هنا. */
  teardown: null,
  library: [],
  sources: new Map(),
  presence: [],
  screen: 'GATE',
  reading: null,
};

function mount(node) {
  if (state.teardown) state.teardown();
  state.teardown = null;
  root.replaceChildren(node);
}

/** خادم المحتوى. مطلق داخل الـAPK، ونفس الأصل في المتصفح. */
async function api(path, options = {}) {
  const response = await fetch(`${config.api}${path}`, {
    credentials: config.api ? 'include' : 'same-origin',
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

// ───────────────────────────── الحضور ووقت الاستخدام ─────────────────────────────

const BEAT_MS = 25_000;
/** الوقت المتراكم يُرسل كل دقيقتين: عملية لكل نبضة إهدار بلا فائدة. */
const USAGE_FLUSH_MS = 120_000;

let beatTimer = null;
let usageMs = 0;
let lastTick = Date.now();

function tickUsage() {
  const now = Date.now();
  const delta = now - lastTick;
  lastTick = now;
  // الخلفية والشاشة المقفلة لا تُحتسب: النبضة لا تصل أصلًا وهو مخفي، والفجوة
  // مسقوفة حتى لا تُسجّل فترة نوم الجهاز كاستخدام
  if (document.visibilityState === 'visible' && delta > 0) {
    usageMs += Math.min(delta, BEAT_MS * 2);
  }
}

function flushUsage() {
  if (usageMs < 1000) return;
  const day = new Date().toISOString().slice(0, 10);
  sync.enqueue('usage.add', { activeMs: Math.floor(usageMs), day });
  usageMs = 0;
}

function presencePayload() {
  if (state.reading) {
    return {
      status: 'READING',
      screen: 'READER',
      seriesId: state.reading.seriesId,
      seriesTitle: state.reading.seriesTitle,
      chapterId: state.reading.chapterId,
      chapterLabel: state.reading.chapterLabel,
      chapterNumber: state.reading.chapterNumber,
    };
  }
  return { status: 'ONLINE', screen: state.screen };
}

function startHeartbeat() {
  if (beatTimer) return;
  lastTick = Date.now();
  let sinceFlush = 0;
  beatTimer = setInterval(() => {
    tickUsage();
    if (document.visibilityState !== 'visible') return;
    void sync.beat(presencePayload());
    void refreshPresence();
    sinceFlush += BEAT_MS;
    if (sinceFlush >= USAGE_FLUSH_MS) {
      sinceFlush = 0;
      flushUsage();
    }
  }, BEAT_MS);

  document.addEventListener('visibilitychange', () => {
    tickUsage();
    if (document.visibilityState === 'visible') {
      void sync.beat(presencePayload());
      void sync.pull();
    } else {
      // الخروج من التطبيق: ما تراكم يُرسل الآن لا في الدورة القادمة
      flushUsage();
    }
  });
}

// ───────────────────────────── القشرة ─────────────────────────────

function avatarNode(person, className = 'avatar') {
  if (person?.avatarKey) {
    const image = el('img', className);
    image.src = person.avatarKey;
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'lazy';
    return image;
  }
  const node = el('div', `${className} ${className}--letter`);
  node.textContent = [...String(person?.displayName ?? '؟')][0] ?? '؟';
  return node;
}

function activityLine(person) {
  if (person.status === 'READING' && person.seriesTitle) {
    const chapter = person.chapterNumber ? ` · الفصل ${person.chapterNumber}` : '';
    return `يقرأ الآن · ${person.seriesTitle}${chapter}`;
  }
  if (person.status === 'ONLINE') return 'يتصفح التطبيق';
  if (person.status === 'IDLE') return 'خامل';
  if (!person.lastSeenAt) return 'غير متصل';
  const minutes = Math.floor((Date.now() - person.lastSeenAt) / 60_000);
  if (minutes < 60) return `آخر ظهور قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `آخر ظهور قبل ${hours} ساعة`;
  return `آخر ظهور قبل ${Math.floor(hours / 24)} يوم`;
}

function topbar({ title = 'VANTARA', back = null } = {}) {
  const bar = el('header', 'topbar');

  if (back) {
    const button = el('button', 'topbar__icon');
    button.type = 'button';
    button.setAttribute('aria-label', 'رجوع');
    button.append(icon('back'));
    button.addEventListener('click', back);
    bar.append(button);
  } else {
    const menu = el('button', 'topbar__icon');
    menu.type = 'button';
    menu.setAttribute('aria-label', 'القائمة');
    menu.append(icon('menu'));
    menu.addEventListener('click', openSidebar);
    bar.append(menu);
  }

  const brand = el('div', 'topbar__brand');
  brand.append(el('span', 'topbar__title', title));
  bar.append(brand);

  const actions = el('div', 'topbar__actions');
  const bell = el('button', 'topbar__icon');
  bell.type = 'button';
  bell.append(icon('bell'));
  bell.setAttribute('aria-label', 'الإشعارات');
  bell.addEventListener('click', () => void go({ name: 'notifications' }));
  const unread = sync.rows('notifications', (row) => row.user_id === sync.user?.userId && !row.read).length;
  if (unread > 0) bell.append(el('span', 'topbar__dot'));
  actions.append(bell);

  const me = el('button', 'topbar__me');
  me.type = 'button';
  me.setAttribute('aria-label', 'حسابي');
  me.append(avatarNode(myProfile(), 'avatar avatar--sm'));
  me.addEventListener('click', () => void go({ name: 'me' }));
  actions.append(me);

  bar.append(actions);
  return bar;
}

const NAV = [
  { id: 'home', label: 'الرئيسية', icon: 'home' },
  { id: 'library', label: 'مكتبتي', icon: 'library' },
  { id: 'explore', label: 'استكشاف', icon: 'search' },
];

function bottomNav(active) {
  const nav = el('nav', 'tabbar');
  for (const entry of NAV) {
    const button = el('button', `tabbar__item${entry.id === active ? ' tabbar__item--on' : ''}`);
    button.type = 'button';
    const glyph = el('span', 'tabbar__icon');
    glyph.append(icon(entry.icon, 21));
    button.append(glyph, el('span', 'tabbar__label', entry.label));
    button.addEventListener('click', () => void go({ name: entry.id }));
    nav.append(button);
  }
  return nav;
}

function myProfile() {
  const me = sync.user;
  if (!me) return null;
  const profile = sync.row('profiles', me.userId);
  return {
    userId: me.userId,
    username: me.username,
    displayName: profile?.display_name ?? me.displayName ?? me.username,
    avatarKey: profile?.avatar_key ?? null,
    bannerKey: profile?.banner_key ?? null,
    bio: profile?.bio ?? null,
  };
}

function friends() {
  const meId = sync.user?.userId;
  return state.presence.filter((person) => person.userId !== meId);
}

// ───────────────────────────── الشريط الجانبي ─────────────────────────────

const SIDEBAR_LINKS = [
  { id: 'home', label: 'الرئيسية' },
  { id: 'library', label: 'مكتبتي' },
  { id: 'explore', label: 'استكشاف' },
  { id: 'notifications', label: 'الإشعارات' },
  { id: 'friends', label: 'الأصدقاء', friends: true },
  { id: 'activity', label: 'النشاط' },
  { id: 'recommendations', label: 'التوصيات' },
  { id: 'favorites', label: 'المفضلة' },
  { id: 'readLater', label: 'أقرأ لاحقًا' },
  { id: 'downloads', label: 'التنزيلات' },
  { id: 'settings', label: 'الإعدادات' },
  { id: 'me', label: 'حسابي' },
];

let sidebarNode = null;

function closeSidebar() {
  if (!sidebarNode) return;
  sidebarNode.classList.remove('drawer--open');
  const node = sidebarNode;
  sidebarNode = null;
  // يُنتظر انتهاء الانتقال: الإزالة الفورية تُلغي حركة الإغلاق
  setTimeout(() => node.remove(), 240);
}

function openSidebar() {
  if (sidebarNode) return;
  const drawer = el('div', 'drawer');
  const scrim = el('div', 'drawer__scrim');
  scrim.addEventListener('click', closeSidebar);
  const panel = el('aside', 'drawer__panel');

  const me = myProfile();
  const head = el('button', 'drawer__me');
  head.type = 'button';
  head.append(avatarNode(me, 'avatar avatar--lg'));
  const info = el('div', 'drawer__me-info');
  info.append(el('div', 'drawer__me-name', me?.displayName ?? '—'));
  info.append(el('div', 'drawer__me-user', `@${me?.username ?? ''}`));
  const live = el('div', 'drawer__me-live');
  live.append(el('span', 'dot dot--online'), el('span', null, 'متصل الآن'));
  info.append(live);
  head.append(info);
  head.addEventListener('click', () => {
    closeSidebar();
    void go({ name: 'me' });
  });
  panel.append(head);

  const list = el('nav', 'drawer__nav');
  const online = friends().filter((person) => person.status !== 'OFFLINE');
  for (const link of SIDEBAR_LINKS) {
    const item = el('button', 'drawer__link');
    item.type = 'button';
    const label = el('span', 'drawer__link-label', link.label);
    item.append(label);

    if (link.friends) {
      // «الأصدقاء» وحدها لا تكفي: العدد والوجوه هما ما يجعل الفتح مُغريًا
      label.textContent = online.length > 0 ? `الأصدقاء • ${online.length} متصلين` : 'الأصدقاء';
      const faces = el('span', 'drawer__faces');
      for (const person of online.slice(0, 3)) {
        const face = el('span', 'drawer__face');
        face.append(avatarNode(person, 'avatar avatar--xs'), el('span', 'dot dot--online'));
        faces.append(face);
      }
      item.append(faces);
    } else if (link.id === 'notifications') {
      const unread = sync.rows(
        'notifications',
        (row) => row.user_id === sync.user?.userId && !row.read,
      ).length;
      if (unread > 0) item.append(el('span', 'pill pill--accent', String(unread)));
    }

    item.addEventListener('click', () => {
      closeSidebar();
      void go({ name: link.id });
    });
    list.append(item);
  }
  panel.append(list);

  const out = el('button', 'drawer__out', 'تبديل الحساب');
  out.type = 'button';
  out.addEventListener('click', () => {
    closeSidebar();
    sync.signOut();
    void go({ name: 'gate' });
  });
  panel.append(out);

  drawer.append(scrim, panel);
  document.body.append(drawer);
  sidebarNode = drawer;
  requestAnimationFrame(() => drawer.classList.add('drawer--open'));
}

// ───────────────────────────── الرئيسية ─────────────────────────────

function coverFor(work) {
  if (work.coverUrl) return work.coverUrl;
  return `${config.api}/v1/img/series-thumb/${encodeURIComponent(work.id ?? work.series_ref)}?maxWidth=360`;
}

function workCard(work, onOpen) {
  const card = el('button', 'tile');
  card.type = 'button';
  const shot = el('div', 'tile__shot');
  const cover = el('img', 'tile__cover');
  cover.loading = 'lazy';
  cover.decoding = 'async';
  cover.alt = '';
  cover.src = coverFor(work);
  cover.addEventListener('error', () => shot.classList.add('tile__shot--blank'), { once: true });
  shot.append(cover);
  if ((work.unread ?? 0) > 0) shot.append(el('span', 'tile__badge', String(work.unread)));
  card.append(shot);
  card.append(el('div', 'tile__title', work.title ?? work.series_title ?? '—'));
  const meta = work.chapters ? `${work.chapters} فصل` : '';
  if (meta) card.append(el('div', 'tile__meta', meta));
  card.addEventListener('click', () => onOpen(work));
  return card;
}

function rail(title, works, { onMore } = {}) {
  const section = el('section', 'rail');
  const head = el('div', 'rail__head');
  head.append(el('h2', 'rail__title', title));
  if (onMore) {
    const more = el('button', 'rail__more', 'عرض الكل');
    more.type = 'button';
    more.addEventListener('click', onMore);
    head.append(more);
  }
  section.append(head);
  const strip = el('div', 'rail__strip');
  for (const work of works) strip.append(workCard(work, (chosen) => go({ name: 'series', id: chosen.id })));
  section.append(strip);
  return section;
}

function friendsStrip() {
  const section = el('section', 'rail');
  const head = el('div', 'rail__head');
  head.append(el('h2', 'rail__title', 'الأصدقاء الآن'));
  const more = el('button', 'rail__more', 'عرض الكل');
  more.type = 'button';
  more.addEventListener('click', () => void go({ name: 'friends' }));
  head.append(more);
  section.append(head);

  const strip = el('div', 'friends');
  strip.dataset.role = 'friends';
  section.append(strip);
  paintFriends(strip);
  return section;
}

/**
 * يرقّع شرائح الأصدقاء في مكانها.
 *
 * لا `replaceChildren` هنا: النبضة كل 25 ثانية تعني إعادة تحميل الصور وفقدان
 * التمرير الأفقي في كل مرة. العنصر يُنشأ مرة ويُحدَّث نصه بعد ذلك.
 */
function paintFriends(strip) {
  const list = friends();
  if (list.length === 0) {
    if (!strip.dataset.empty) {
      strip.replaceChildren(el('p', 'state', 'لا أحد متصل الآن.'));
      strip.dataset.empty = '1';
    }
    return;
  }
  // الحالة الفارغة تُزال صراحةً: حذف العلامة وحدها يُبقي النص جوار الشرائح
  if (strip.dataset.empty) {
    strip.replaceChildren();
    delete strip.dataset.empty;
  }

  const seen = new Set();
  for (const person of list) {
    seen.add(person.userId);
    let chip = strip.querySelector(`[data-user="${person.userId}"]`);
    if (!chip) {
      chip = el('button', 'friend');
      chip.type = 'button';
      chip.dataset.user = person.userId;
      const face = el('div', 'friend__face');
      face.append(avatarNode(person, 'avatar avatar--md'), el('span', 'dot'));
      const body = el('div', 'friend__body');
      body.append(el('div', 'friend__name'), el('div', 'friend__what'));
      chip.append(face, body);
      chip.addEventListener('click', () => void go({ name: 'friend', id: person.userId }));
      strip.append(chip);
    }
    // النص وحده يُحدَّث: الصورة تبقى كما هي فلا ترتعش
    chip.querySelector('.friend__name').textContent = person.displayName;
    chip.querySelector('.friend__what').textContent = activityLine(person);
    chip.querySelector('.dot').className = `dot dot--${String(person.status).toLowerCase()}`;
  }
  for (const chip of [...strip.querySelectorAll('[data-user]')]) {
    if (!seen.has(chip.dataset.user)) chip.remove();
  }
}

function refreshPresenceInPlace() {
  for (const strip of document.querySelectorAll('[data-role="friends"]')) paintFriends(strip);
}

async function refreshPresence() {
  const list = await sync.presence();
  if (list.length === 0) return;
  state.presence = list;
  refreshPresenceInPlace();
}

async function screenHome() {
  state.screen = 'HOME';
  const wrap = el('main', 'page');
  wrap.append(topbar());

  const body = el('div', 'page__body');

  const hero = el('section', 'hero');
  const heroArt = el('div', 'hero__art');
  hero.append(heroArt);
  const heroText = el('div', 'hero__text');
  heroText.append(el('h1', 'hero__title', 'وش ودك تقرأ؟'));
  heroText.append(el('p', 'hero__sub', 'ابحث في المصادر العربية كلها. النتائج تنضم لمكتبتك بلمسة.'));
  hero.append(heroText);

  const form = el('form', 'search');
  const input = el('input', 'search__input');
  input.type = 'search';
  input.placeholder = 'اسم مانجا أو مانهوا…';
  input.autocomplete = 'off';
  const submit = el('button', 'search__go', 'بحث');
  submit.type = 'submit';
  form.append(input, submit);
  hero.append(form);
  body.append(hero);

  const searchSection = el('section', 'rail hidden');
  const searchHost = el('div', 'results');
  searchSection.append(el('h2', 'rail__title', 'نتائج البحث'), searchHost);
  body.append(searchSection);

  body.append(friendsStrip());

  const libraryHost = el('div');
  body.append(libraryHost);

  wrap.append(body, bottomNav('home'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) return;
    searchSection.classList.remove('hidden');
    await renderSearch(searchHost, q);
  });

  mount(wrap);

  // من المرآة أولًا: الشاشة تظهر مأهولة قبل أي طلب
  if (state.library.length > 0) {
    libraryHost.replaceChildren(rail('مكتبتي', state.library, { onMore: () => go({ name: 'library' }) }));
  } else {
    const skeleton = el('div', 'rail__strip');
    for (let i = 0; i < 6; i += 1) skeleton.append(el('div', 'tile tile--ghost'));
    libraryHost.replaceChildren(skeleton);
  }

  const library = await api('/v1/library').catch(() => null);
  if (library) {
    state.library = library.content ?? [];
    libraryHost.replaceChildren(
      state.library.length > 0
        ? rail('مكتبتي', state.library, { onMore: () => go({ name: 'library' }) })
        : el('p', 'state', 'ابحث فوق وأضف أول عمل.'),
    );
  } else if (state.library.length === 0) {
    libraryHost.replaceChildren(
      el('p', 'state', 'خادم المحتوى غير متصل. الأصدقاء والنشاط يعملان.'),
    );
  }

  void refreshPresence();
}

// ───────────────────────────── البحث ─────────────────────────────

const LANG_RANK = { ar: 0, en: 1 };

async function loadSourceMap() {
  if (state.sources.size > 0) return state.sources;
  try {
    const { content = [] } = await api('/v1/sources');
    for (const source of content) state.sources.set(source.id, source);
  } catch {
    // بلا خريطة مصادر: الترتيب يفقد تفضيل العربي ويبقى البحث عاملًا
  }
  return state.sources;
}

function providerRank(provider) {
  const lang =
    state.sources.get(provider.source)?.language ??
    state.sources.get(provider.sourceId)?.language ??
    '';
  return LANG_RANK[lang] ?? 2;
}

function normalizeTitle(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ar').replace(/\s+/g, ' ');
}

async function renderSearch(host, q) {
  host.replaceChildren(el('div', 'state', 'جارٍ البحث في المصادر…'));
  try {
    await loadSourceMap();
    const result = await api(`/v1/search?q=${encodeURIComponent(q)}`);
    const groups = [...(result.content ?? [])]
      .map((group) => ({
        ...group,
        providers: [...(group.providers ?? [])].sort((a, b) => providerRank(a) - providerRank(b)),
      }))
      .sort((a, b) => {
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
      const box = el('article', 'result');
      const head = el('div', 'result__head');
      head.append(el('h3', 'result__title', group.title));
      if (group.inLibrary) head.append(el('span', 'pill pill--accent', 'في مكتبتك'));
      box.append(head);

      const providers = el('div', 'result__providers');
      for (const provider of group.providers.slice(0, 8)) {
        const source = state.sources.get(provider.source) ?? state.sources.get(provider.sourceId);
        const lang = source?.language ?? '';
        const row = el('button', 'provider');
        row.type = 'button';
        const label = el('span', null, provider.name || source?.name || 'مصدر');
        row.append(label);
        if (lang === 'ar') row.append(el('span', 'pill pill--accent', 'عربي'));
        else if (lang) row.append(el('span', 'pill', lang.toUpperCase()));
        row.addEventListener('click', async () => {
          if (row.disabled) return;
          row.disabled = true;
          label.textContent = group.inLibrary ? 'جارٍ الفتح…' : 'جارٍ الإضافة…';
          try {
            if (!group.inLibrary) {
              await api('/v1/library/source', {
                method: 'POST',
                body: { source: provider.source, sourceId: provider.sourceId },
              });
            }
            const library = await api('/v1/library');
            state.library = library.content ?? [];
            const wanted = normalizeTitle(group.title);
            const match =
              state.library.find((work) => normalizeTitle(work.title) === wanted) ??
              state.library.find(
                (work) =>
                  normalizeTitle(work.title).includes(wanted) ||
                  wanted.includes(normalizeTitle(work.title)),
              );
            if (match) {
              // المكتبة تُزامن كي تظهر عند الأصدقاء وفي بقية الأجهزة
              sync.enqueue('library.add', {
                seriesRef: match.id,
                seriesTitle: match.title,
                sourceId: provider.sourceId,
              });
              sync.enqueue('activity.add', {
                verb: 'LIBRARY_ADD',
                seriesRef: match.id,
                payload: { title: match.title },
              });
              await go({ name: 'series', id: match.id });
            } else await go({ name: 'home' });
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

// ───────────────────────────── الأصدقاء ─────────────────────────────

async function screenFriends() {
  state.screen = 'FRIENDS';
  const wrap = el('main', 'page');
  wrap.append(topbar({ title: 'الأصدقاء', back: () => go({ name: 'home' }) }));
  const body = el('div', 'page__body');
  const list = el('div', 'friends friends--column');
  list.dataset.role = 'friends';
  body.append(list);
  wrap.append(body, bottomNav('home'));
  mount(wrap);
  paintFriends(list);
  await refreshPresence();
}

function formatDuration(ms) {
  const minutes = Math.floor((ms ?? 0) / 60_000);
  if (minutes < 60) return `${minutes}د`;
  const hours = Math.floor(minutes / 60);
  return `${hours}س ${minutes % 60}د`;
}

async function screenFriend(userId) {
  const person = state.presence.find((entry) => entry.userId === userId);
  const profile = sync.row('profiles', userId);
  const displayName = profile?.display_name ?? person?.displayName ?? '—';

  const wrap = el('main', 'page');
  wrap.append(topbar({ title: displayName, back: () => go({ name: 'friends' }) }));
  const body = el('div', 'page__body');

  const header = el('section', 'profile');
  const banner = el('div', 'profile__banner');
  if (profile?.banner_key) banner.style.backgroundImage = `url(${profile.banner_key})`;
  header.append(banner);
  const identity = el('div', 'profile__identity');
  identity.append(avatarNode({ ...person, avatarKey: profile?.avatar_key }, 'avatar avatar--xl'));
  const names = el('div');
  names.append(el('h1', 'profile__name', displayName));
  names.append(el('div', 'profile__user', `@${person?.username ?? ''}`));
  const live = el('div', 'profile__live');
  live.append(
    el('span', `dot dot--${String(person?.status ?? 'offline').toLowerCase()}`),
    el('span', null, person ? activityLine(person) : 'غير متصل'),
  );
  names.append(live);
  identity.append(names);
  header.append(identity);
  if (profile?.bio) header.append(el('p', 'profile__bio', profile.bio));
  body.append(header);

  const statsHost = el('section', 'stats');
  body.append(statsHost);

  const readsHost = el('div');
  body.append(readsHost);

  wrap.append(body, bottomNav('home'));
  mount(wrap);

  const stats = await sync.stats(userId);
  if (stats) {
    const cells = [
      ['فصول فريدة', String(stats.uniqueChapters ?? 0)],
      ['إجمالي القراءات', String(stats.totalReads ?? 0)],
      ['إعادات', String(stats.rereads ?? 0)],
      ['اليوم', formatDuration(stats.usage?.todayMs)],
      ['هذا الأسبوع', formatDuration(stats.usage?.weekMs)],
      ['الإجمالي', formatDuration(stats.usage?.totalMs)],
    ];
    statsHost.replaceChildren();
    for (const [label, value] of cells) {
      const cell = el('div', 'stats__cell');
      cell.append(el('div', 'stats__value', value), el('div', 'stats__label', label));
      statsHost.append(cell);
    }
  } else {
    statsHost.replaceChildren(el('p', 'state', 'تعذّر تحميل الإحصائيات.'));
  }

  const reads = sync
    .rows('chapter_reads', (row) => row.user_id === userId)
    .sort((a, b) => (b.last_read_at ?? 0) - (a.last_read_at ?? 0))
    .slice(0, 12);
  if (reads.length > 0) {
    const section = el('section', 'rail');
    section.append(el('h2', 'rail__title', 'آخر ما قرأ'));
    const strip = el('div', 'list');
    for (const read of reads) {
      const item = el('div', 'list__row');
      item.append(el('span', null, read.series_ref));
      item.append(el('span', 'pill', `الفصل ${read.chapter_number ?? '—'}`));
      strip.append(item);
    }
    section.append(strip);
    readsHost.replaceChildren(section);
  }
}

// ───────────────────────────── الإشعارات والنشاط ─────────────────────────────

async function screenNotifications() {
  state.screen = 'NOTIFICATIONS';
  const wrap = el('main', 'page');
  wrap.append(topbar({ title: 'الإشعارات', back: () => go({ name: 'home' }) }));
  const body = el('div', 'page__body');
  const list = el('div', 'list');
  body.append(list);
  wrap.append(body, bottomNav('home'));
  mount(wrap);

  const paint = () => {
    const rows = sync
      .rows('notifications', (row) => row.user_id === sync.user?.userId)
      .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    list.replaceChildren();
    if (rows.length === 0) {
      list.append(el('p', 'state', 'لا إشعارات بعد.'));
      return;
    }
    for (const row of rows) {
      const item = el('button', `list__row${row.read ? '' : ' list__row--unread'}`);
      item.type = 'button';
      item.append(el('span', null, row.body ?? row.kind));
      item.addEventListener('click', () => {
        if (!row.read) sync.enqueue('notification.read', { id: row.id });
        // الرابط العميق يفتح المكان الصحيح لا الرئيسية
        if (row.series_ref) void go({ name: 'series', id: row.series_ref });
      });
      list.append(item);
    }
  };
  paint();
  await sync.pull();
  paint();
}

async function screenActivity() {
  state.screen = 'ACTIVITY';
  const wrap = el('main', 'page');
  wrap.append(topbar({ title: 'النشاط', back: () => go({ name: 'home' }) }));
  const body = el('div', 'page__body');
  const list = el('div', 'list');
  const rows = sync.rows('activity').sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  const VERBS = {
    LIBRARY_ADD: 'أضاف عملًا',
    CHAPTER_DONE: 'أنهى فصلًا',
    RATED: 'قيّم عملًا',
    FAVORITED: 'أضاف للمفضلة',
  };
  if (rows.length === 0) list.append(el('p', 'state', 'لا نشاط بعد.'));
  for (const row of rows.slice(0, 80)) {
    const who = sync.row('profiles', row.actor_id)?.display_name ?? '—';
    const item = el('div', 'list__row');
    item.append(el('span', null, `${who} ${VERBS[row.verb] ?? row.verb}`));
    list.append(item);
  }
  body.append(list);
  wrap.append(body, bottomNav('home'));
  mount(wrap);
}

async function screenPlaceholder(title, note) {
  const wrap = el('main', 'page');
  wrap.append(topbar({ title, back: () => go({ name: 'home' }) }));
  const body = el('div', 'page__body');
  body.append(el('p', 'state', note));
  wrap.append(body, bottomNav('home'));
  mount(wrap);
}

async function screenMe() {
  state.screen = 'ME';
  const me = myProfile();
  const wrap = el('main', 'page');
  wrap.append(topbar({ title: 'حسابي', back: () => go({ name: 'home' }) }));
  const body = el('div', 'page__body');

  const header = el('section', 'profile');
  const banner = el('div', 'profile__banner');
  if (me?.bannerKey) banner.style.backgroundImage = `url(${me.bannerKey})`;
  header.append(banner);
  const identity = el('div', 'profile__identity');
  identity.append(avatarNode(me, 'avatar avatar--xl'));
  const names = el('div');
  names.append(el('h1', 'profile__name', me?.displayName ?? '—'));
  names.append(el('div', 'profile__user', `@${me?.username ?? ''}`));
  identity.append(names);
  header.append(identity);
  body.append(header);

  // الهوية الداخلية لا تُعرض ولا تُكتب: الاسم والصورة والنبذة وحدها
  const form = el('form', 'form');
  const fields = [
    ['displayName', 'الاسم', me?.displayName ?? ''],
    ['avatarKey', 'رابط الصورة', me?.avatarKey ?? ''],
    ['bannerKey', 'رابط البانر', me?.bannerKey ?? ''],
    ['bio', 'نبذة', me?.bio ?? ''],
  ];
  const inputs = new Map();
  for (const [key, label, value] of fields) {
    const row = el('label', 'form__row');
    row.append(el('span', 'form__label', label));
    const input = el('input', 'form__input');
    input.value = value ?? '';
    row.append(input);
    inputs.set(key, input);
    form.append(row);
  }
  const save = el('button', 'btn', 'حفظ');
  save.type = 'submit';
  const note = el('p', 'form__note');
  form.append(save, note);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const patch = {};
    for (const [key, input] of inputs) patch[key] = input.value.trim() || null;
    sync.enqueue('profile.patch', { fields: patch });
    note.textContent = 'حُفظ. سيظهر عند الأصدقاء بعد المزامنة.';
  });
  body.append(form);

  wrap.append(body, bottomNav('home'));
  mount(wrap);
}

// ───────────────────────────── العمل ─────────────────────────────

async function screenSeries(id) {
  state.screen = 'SERIES';
  const known = state.library.find((work) => work.id === id);
  const wrap = el('main', 'page');
  wrap.append(topbar({ title: known?.title ?? 'العمل', back: () => go({ name: 'home' }) }));
  const body = el('div', 'page__body');

  const head = el('section', 'work');
  const cover = el('img', 'work__cover');
  cover.alt = '';
  cover.decoding = 'async';
  if (known) cover.src = coverFor(known);
  const meta = el('div', 'work__meta');
  meta.append(el('h1', 'work__title', known?.title ?? '—'));
  const actions = el('div', 'work__actions');
  const follow = el('button', 'btn', 'متابعة');
  follow.type = 'button';
  follow.addEventListener('click', () => {
    sync.enqueue('favorite.set', { seriesRef: id, member: true });
    sync.enqueue('activity.add', { verb: 'FAVORITED', seriesRef: id });
    follow.textContent = 'في المفضلة';
    follow.disabled = true;
  });
  const share = el('button', 'btn btn--ghost', 'مشاركة');
  share.type = 'button';
  share.addEventListener('click', () => openShare(id, known?.title));
  const later = el('button', 'btn btn--ghost', 'أقرأ لاحقًا');
  later.type = 'button';
  later.addEventListener('click', () => {
    sync.enqueue('readLater.set', { seriesRef: id, member: true });
    later.textContent = 'محفوظ';
    later.disabled = true;
  });
  actions.append(follow, share, later);
  meta.append(actions);
  head.append(cover, meta);
  body.append(head);

  const list = el('ul', 'chapters');
  body.append(list);
  wrap.append(body, bottomNav('library'));
  mount(wrap);

  list.append(el('li', 'state', 'جارٍ تحميل الفصول…'));

  let payload;
  try {
    payload = await api(`/v1/series/${encodeURIComponent(id)}/chapters`);
  } catch (error) {
    list.replaceChildren(
      el('li', 'state', error.status === 404 ? 'العمل غير موجود.' : 'تعذّر تحميل الفصول.'),
    );
    return;
  }

  // الأحدث أولًا في القائمة، والفهرس نفسه تصاعدي للقارئ
  const chapters = [...(payload.content ?? [])].sort((a, b) => b.number - a.number);
  const coverage = payload.coverage ?? null;

  list.replaceChildren();
  if (chapters.length === 0) {
    list.append(el('li', 'state', 'المصدر لا يعرض فصولًا لهذا العمل.'));
    return;
  }

  // الفراغ يُقال لا يُخفى: أرقام لم يعرضها أي مصدر تُذكر صراحةً، وإلا بدا
  // العمل ناقصًا بلا تفسير
  if (coverage && !coverage.complete) {
    const gap = coverage.missing.length;
    list.append(
      el(
        'li',
        'state',
        `${coverage.first}–${coverage.last} · ${gap} فصلًا لا يعرضها أي مصدر`,
      ),
    );
  }

  for (const chapter of chapters) {
    const item = el('li');
    const button = el('button', 'chapter');
    button.type = 'button';
    const label = chapter.title ?? `الفصل ${chapter.number}`;
    button.append(el('span', 'chapter__name', label));

    // الحالة بسببها: «محجوب» و«دون الأرضية» قرارات لا أعطال، وعرضها
    // كـ«غير موجود» يجعل النقص غامضًا
    const STATE_LABEL = {
      ON_DISK: chapter.read ? 'مقروء' : 'اقرأ',
      MISSING: 'جلب',
      HELD: 'مُنتظر',
      BLOCKED: 'محجوب',
      FAILED: 'أعد المحاولة',
      BELOW_FLOOR: 'دون الأرضية',
    };
    const badge = el('span', 'pill', STATE_LABEL[chapter.state] ?? 'جلب');
    if (chapter.state === 'ON_DISK') badge.className = 'pill pill--accent';
    button.append(badge);

    // أكثر من مصدر ⇒ يُذكر العدد. التبديل متاح عند الفشل تلقائيًا.
    if ((chapter.copies?.length ?? 0) > 1) {
      button.append(el('span', 'pill', `${chapter.copies.length} مصادر`));
    }

    if (!chapter.readable) button.disabled = true;

    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        let bookId = chapter.bookId;
        if (!bookId) {
          badge.textContent = 'جارٍ الجلب…';
          // fallback والتحقق من الجاهزية كلاهما داخل الخادم؛ العميل يطلب مرة واحدة.
          const result = await api(
            `/v1/series/${encodeURIComponent(id)}/chapters/${chapter.number}/fetch`,
            { method: 'POST', body: {} },
          );
          bookId = result?.bookId ?? null;
        }
        if (!bookId) throw new Error('missing book id');
        await go({
          name: 'reader',
          bookId,
          seriesId: id,
          title: label,
          seriesTitle: known?.title ?? label,
        });
      } catch {
        badge.textContent = 'أعد المحاولة';
        button.disabled = false;
      }
    });
    item.append(button);
    list.append(item);
  }
}

function openShare(seriesRef, seriesTitle) {
  const sheet = el('div', 'sheet');
  const panel = el('div', 'sheet__panel');
  panel.append(el('h2', 'sheet__title', 'مشاركة مع'));

  const note = el('input', 'form__input');
  note.placeholder = 'اكتب كلمة (اختياري)';

  const people = el('div', 'sheet__people');
  for (const person of friends()) {
    const button = el('button', 'sheet__person');
    button.type = 'button';
    button.append(avatarNode(person, 'avatar avatar--md'), el('span', null, person.displayName));
    button.addEventListener('click', () => {
      sync.enqueue('recommendation.send', {
        toId: person.userId,
        seriesRef,
        seriesTitle,
        message: note.value.trim() || null,
      });
      sheet.remove();
    });
    people.append(button);
  }
  if (friends().length === 0) people.append(el('p', 'state', 'لا أصدقاء بعد.'));

  panel.append(note, people);
  const cancel = el('button', 'btn btn--ghost', 'إلغاء');
  cancel.type = 'button';
  cancel.addEventListener('click', () => sheet.remove());
  panel.append(cancel);
  sheet.append(panel);
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) sheet.remove();
  });
  document.body.append(sheet);
}

// ───────────────────────────── القارئ ─────────────────────────────

async function screenReader({ bookId, seriesId, title, seriesTitle }) {
  state.screen = 'READER';
  const shell = el('main', 'reader');
  const hud = el('div', 'reader__hud reader__hud--hidden');
  const back = el('button', 'reader__back');
  back.type = 'button';
  back.append(icon('back', 20));
  back.addEventListener('click', () => go({ name: 'series', id: seriesId }));
  const hudTitle = el('div', 'reader__title', title ?? 'القارئ');
  const hudPage = el('div', 'reader__page', '');
  hud.append(back, hudTitle, hudPage);
  const flow = el('div', 'reader__flow');
  shell.append(hud, flow);
  mount(shell);

  const cleanupFns = [];
  const savers = new Map();
  const loaders = new Map();
  const chapterNodes = new Map();
  /** بداية القراءة لكل فصل، لفرض أرضية الوقت على «قراءة مكتملة». */
  const enteredAt = new Map();
  const counted = new Set();
  let catalogue = [];
  let cursor = 0;
  let loadingNext = false;
  let endObserver = null;
  let pageObserver = null;
  let currentBookId = bookId;

  const chapterLabel = (chapter) => chapter.title ?? `الفصل ${chapter.number ?? ''}`;

  /**
   * الفهرس من الخادم: دمج واحد مُختبر بدل دمج في كل عميل.
   *
   * `readable === false` تعني رقمًا لا يُفتح بأي نسخة، فيُسقط من تدفّق القراءة:
   * القارئ المتصل لا يجوز أن يتوقف عند فصل لا يستطيع فتحه.
   */
  const refreshCatalogue = async () => {
    const payload = await api(`/v1/series/${encodeURIComponent(seriesId)}/chapters`);
    catalogue = (payload.content ?? []).filter((entry) => entry.readable);
    const byId = catalogue.findIndex((entry) => entry.bookId === currentBookId);
    cursor = Math.max(0, byId);
  };

  /**
   * يضمن أن الفصل على القرص وجاهز للقراءة. إذا لم يكن محليًا يطلبه مرة واحدة؛
   * الخادم وحده يجرّب النسخ البديلة وينتظر حتى يثبت وجود bookId قابل للفتح.
   */
  const ensureLocal = async (entry) => {
    if (entry.bookId) return entry;

    const result = await api(
      `/v1/series/${encodeURIComponent(seriesId)}/chapters/${entry.number}/fetch`,
      { method: 'POST', body: {} },
    );
    const fetchedBookId = result?.bookId ?? null;
    if (!fetchedBookId) throw new Error('chapter_not_fetched');

    const found = { ...entry, bookId: fetchedBookId, state: 'ON_DISK', readable: true };
    const index = catalogue.findIndex((row) => row.number === entry.number);
    if (index >= 0) catalogue[index] = found;
    return found;
  };

  const getSaver = (id) => {
    if (!savers.has(id)) savers.set(id, createProgressSaver({ bookId: id, baseUrl: config.api }));
    return savers.get(id);
  };

  /**
   * يُسجّل تقدم الفصل ويحتسبه مقروءًا عند استحقاقه.
   *
   * الشرطان معًا: نسبة كافية ووقت فعلي. التمرير السريع إلى آخر صفحة يبلغ 100%
   * في ثانيتين، وذلك ليس قراءة. و`counted` يمنع إرسال العملية مرتين لنفس
   * الفصل في نفس الجلسة.
   */
  const trackProgress = (chapter, page, total) => {
    const ratio = total > 0 ? page / total : 0;
    sync.enqueue('progress.set', {
      chapterKey: chapter.bookId,
      seriesRef: seriesId,
      page,
      ratio,
    });
    if (ratio < 0.9 || counted.has(chapter.bookId)) return;
    const activeMs = Date.now() - (enteredAt.get(chapter.bookId) ?? Date.now());
    if (activeMs < 5000) return;
    counted.add(chapter.bookId);
    sync.enqueue('chapter.complete', {
      chapterKey: chapter.bookId,
      seriesRef: seriesId,
      chapterNumber: chapter.number,
      ratio,
      activeMs,
    });
    sync.enqueue('activity.add', {
      verb: 'CHAPTER_DONE',
      seriesRef: seriesId,
      payload: { chapter: chapter.number },
    });
  };

  const watchPages = () => {
    pageObserver?.disconnect();
    pageObserver = new IntersectionObserver(
      (entries) => {
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
        const section = image.closest('.reader-chapter');
        if (section?.dataset.chapterTitle) hudTitle.textContent = section.dataset.chapterTitle;
        hudPage.textContent = `${page}`;

        const chapter = catalogue.find((c) => c.bookId === id);
        if (chapter) {
          state.reading = {
            seriesId,
            seriesTitle: seriesTitle ?? title,
            chapterId: id,
            chapterLabel: chapterLabel(chapter),
            chapterNumber: chapter.number,
          };
          trackProgress(chapter, page, Number(section?.dataset.pageCount ?? 0));
        }
      },
      { threshold: [0.45, 0.65] },
    );
    for (const image of flow.querySelectorAll('.reader__image')) pageObserver.observe(image);
  };

  const appendChapter = async (rawChapter, { dividerFrom = null, restore = false } = {}) => {
    const chapter = await ensureLocal(rawChapter);
    if (chapterNodes.has(chapter.bookId)) return chapter;
    const pages = await api(`/v1/books/${encodeURIComponent(chapter.bookId)}/pages`);
    const pageNumbers = (pages.content ?? []).map((p) => p.number);
    const loader = createPageLoader({
      bookId: chapter.bookId,
      pageNumbers,
      prefetch: 2,
      maxWidth: 1100,
      baseUrl: config.api,
    });
    loaders.set(chapter.bookId, loader);
    enteredAt.set(chapter.bookId, Date.now());

    if (dividerFrom) {
      const divider = el('div', 'divider');
      divider.append(el('div', 'divider__done', `انتهى الفصل ${dividerFrom.number ?? ''}`));
      divider.append(el('div', 'divider__next', chapterLabel(chapter)));
      flow.append(divider);
      if (dividerFrom.bookId) {
        void api(`/v1/books/${encodeURIComponent(dividerFrom.bookId)}/progress`, {
          method: 'PUT',
          body: { completed: true },
        }).catch(() => {});
      }
    }

    const section = el('section', 'reader-chapter');
    section.dataset.bookId = chapter.bookId;
    section.dataset.chapterTitle = chapterLabel(chapter);
    section.dataset.pageCount = String((pages.content ?? []).length);
    for (const page of pages.content ?? []) {
      const frame = el('div', 'reader__frame skeleton');
      if (page.width && page.height) frame.style.aspectRatio = `${page.width} / ${page.height}`;
      const image = el('img', 'reader__image');
      image.alt = '';
      image.decoding = 'async';
      image.loading = 'lazy';
      image.dataset.page = String(page.number);
      image.dataset.bookId = chapter.bookId;
      image.src = loader.urlFor(page.number);
      image.addEventListener('load', () => frame.classList.remove('skeleton'), { once: true });
      image.addEventListener('error', () => frame.classList.add('reader__frame--error'), { once: true });
      frame.append(image);
      section.append(frame);
    }
    flow.append(section);
    chapterNodes.set(chapter.bookId, section);
    watchPages();
    // التالي يُسخَّن الآن لا عند النهاية: بلا هذا يُحسّ توقّف عند كل حدّ فصل
    void prefetchNext();

    if (restore && pages.resumeAt) {
      requestAnimationFrame(() => {
        section.querySelector(`[data-page="${pages.resumeAt}"]`)?.scrollIntoView({ block: 'start' });
      });
    }
    return chapter;
  };

  /**
   * يسخّن الفصل التالي قبل الوصول إليه.
   *
   * قائمة صفحاته وأول صورتين فقط: الهدف إخفاء زمن الشبكة عند حدّ الفصل، لا
   * تنزيل فصل كامل لم يُطلب — وذلك يخنق اتصالًا منزليًا ويستهلك بيانات الجوال.
   *
   * لا يجلب من المصدر: التسخين لما هو على القرص أصلًا. الفصل غير المنزّل
   * يُجلب عند بلوغه، وجلبه مسبقًا يعني تنزيل عمل كامل بلا طلب.
   */
  const prefetchNext = async () => {
    const next = catalogue[cursor + 1];
    if (!next?.bookId || loaders.has(next.bookId)) return;
    try {
      const pages = await api(`/v1/books/${encodeURIComponent(next.bookId)}/pages`);
      const pageNumbers = (pages.content ?? []).map((page) => page.number);
      const loader = createPageLoader({
        bookId: next.bookId,
        pageNumbers,
        prefetch: 2,
        maxWidth: 1100,
        baseUrl: config.api,
      });
      loaders.set(next.bookId, loader);

      // الصفحة الأولى صراحةً: `warmAfter` يسخّن ما *بعد* الرقم المُعطى، وهي
      // بالضبط الصورة التي تظهر عند حدّ الفصل
      const first = pageNumbers[0];
      if (first !== undefined) {
        const image = new Image();
        image.decoding = 'async';
        image.src = loader.urlFor(first);
        loader.warmAfter(first);
      }
    } catch {
      // التسخين تحسين: فشله لا يُرى، والإضافة الفعلية تعيد المحاولة
    }
  };

  const setEndTrigger = () => {
    endObserver?.disconnect();
    flow.querySelector('.reader__sentinel')?.remove();
    const sentinel = el('div', 'reader__sentinel');
    flow.append(sentinel);
    endObserver = new IntersectionObserver(
      async (entries) => {
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
          currentBookId = appended.bookId;
          setEndTrigger();
        } catch {
          sentinel.className = 'reader__retry';
          sentinel.replaceChildren(el('span', null, 'تعذّر تجهيز الفصل التالي'));
          const retry = el('button', 'btn btn--small', 'أعد المحاولة');
          retry.type = 'button';
          retry.addEventListener('click', () => {
            loadingNext = false;
            setEndTrigger();
          });
          sentinel.append(retry);
        } finally {
          loadingNext = false;
        }
      },
      { rootMargin: '1800px 0px 1800px 0px', threshold: 0 },
    );
    endObserver.observe(sentinel);
  };

  try {
    await refreshCatalogue();
    let start = catalogue[cursor];
    if (!start || start.bookId !== bookId) {
      const series = await api(`/v1/series/${encodeURIComponent(seriesId)}/chapters`);
      const direct = (series.content ?? []).find((c) => c.bookId === bookId);
      start = direct ?? start;
      if (direct && !catalogue.some((c) => c.bookId === direct.bookId)) {
        catalogue.push(direct);
        catalogue.sort((a, b) => a.number - b.number);
        cursor = catalogue.findIndex((c) => c.bookId === direct.bookId);
      }
    }
    if (!start) throw new Error('missing_start_chapter');
    const appended = await appendChapter(start, { restore: true });
    currentBookId = appended.bookId;
    hudTitle.textContent = chapterLabel(appended);
    setEndTrigger();
  } catch {
    flow.replaceChildren(el('div', 'reader__end', 'تعذّر تحميل الفصل.'));
  }

  const detector = createTapDetector({
    onTap: ({ y }) => {
      const zone = zoneOf(y, window.innerHeight);
      if (zone === 'chrome') hud.classList.toggle('reader__hud--hidden');
      else {
        window.scrollBy({
          top: zone === 'next' ? window.innerHeight * 0.82 : -window.innerHeight * 0.82,
          behavior: 'smooth',
        });
      }
    },
  });
  cleanupFns.push(detector.attach(shell));

  const onHidden = () => {
    if (document.visibilityState === 'hidden') for (const saver of savers.values()) saver.flush(true);
  };
  document.addEventListener('visibilitychange', onHidden);
  cleanupFns.push(() => document.removeEventListener('visibilitychange', onHidden));

  state.teardown = () => {
    for (const saver of savers.values()) saver.flush(true);
    pageObserver?.disconnect();
    endObserver?.disconnect();
    for (const fn of cleanupFns) fn();
    state.reading = null;
  };
}

// ───────────────────────────── التوجيه ─────────────────────────────

async function go(route) {
  state.route = route;
  switch (route.name) {
    case 'gate': {
      state.screen = 'GATE';
      const teardown = await screenAccounts({
        sync,
        mount,
        onSignedIn: async () => {
          startHeartbeat();
          void sync.pull();
          await go({ name: 'home' });
          void offerUpdate();
        },
      });
      state.teardown = teardown;
      return;
    }
    case 'home':
      return screenHome();
    case 'library':
      return screenHome();
    case 'explore':
      return screenHome();
    case 'friends':
      return screenFriends();
    case 'friend':
      return screenFriend(route.id);
    case 'notifications':
      return screenNotifications();
    case 'activity':
      return screenActivity();
    case 'me':
      return screenMe();
    case 'series':
      return screenSeries(route.id);
    case 'reader':
      return screenReader(route);
    case 'recommendations':
      return screenPlaceholder('التوصيات', 'ما وصلتك توصية بعد.');
    case 'favorites':
      return screenPlaceholder('المفضلة', 'لا مفضلة بعد.');
    case 'readLater':
      return screenPlaceholder('أقرأ لاحقًا', 'القائمة فارغة.');
    case 'downloads':
      return screenPlaceholder('التنزيلات', 'لا تنزيلات بعد.');
    case 'settings':
      return screenSettings();
    default:
      return screenHome();
  }
}


/**
 * الإعدادات.
 *
 * وجودها ليس تكميليًا: خادم المحتوى نفق منزلي وعنوانه يتغيّر، وبلا تعديله من
 * هنا يحتاج كل تغيير عنوان إصدار APK جديدًا وتثبيتًا على ثلاثة أجهزة.
 */
async function screenSettings() {
  state.screen = 'SETTINGS';
  const wrap = el('main', 'page');
  wrap.append(topbar({ title: 'الإعدادات', back: () => go({ name: 'home' }) }));
  const body = el('div', 'page__body');

  const current = endpoints();
  const form = el('form', 'form');

  const rows = [
    ['sync', 'خادم المزامنة (Cloudflare)', current.sync],
    ['api', 'خادم المحتوى (المكتبة والفصول)', current.api],
  ];
  const inputs = new Map();
  for (const [key, label, value] of rows) {
    const row = el('label', 'form__row');
    row.append(el('span', 'form__label', label));
    const input = el('input', 'form__input');
    input.value = value ?? '';
    input.placeholder = 'https://…';
    input.dir = 'ltr';
    row.append(input);
    inputs.set(key, input);
    form.append(row);
  }

  const save = el('button', 'btn', 'حفظ وإعادة التشغيل');
  save.type = 'submit';
  const note = el('p', 'form__note');
  form.append(save, note);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setEndpoints({ sync: inputs.get('sync').value.trim(), api: inputs.get('api').value.trim() });
    note.textContent = 'حُفظ. جارٍ إعادة التشغيل…';
    // العنوانان يُقرآن مرة عند الإقلاع، فالتغيير يحتاج إعادة تحميل
    setTimeout(() => window.location.reload(), 400);
  });
  body.append(form);

  const facts = el('div', 'list');
  const version = appVersion();
  const lines = [
    ['النسخة', version ?? 'متصفح'],
    ['كتابات معلّقة', String(sync.pendingWrites)],
    ['الحساب', sync.user?.username ?? '—'],
  ];
  for (const [label, value] of lines) {
    const row = el('div', 'list__row');
    row.append(el('span', null, label), el('span', 'pill', value));
    facts.append(row);
  }
  body.append(facts);

  const force = el('button', 'btn btn--ghost', 'مزامنة الآن');
  force.type = 'button';
  force.addEventListener('click', async () => {
    force.disabled = true;
    await sync.push();
    await sync.pull();
    await refreshPresence();
    force.disabled = false;
    force.textContent = 'تمّت المزامنة';
  });
  body.append(force);

  wrap.append(body, bottomNav('home'));
  mount(wrap);
}

// ───────────────────────────── التحديث ─────────────────────────────

/**
 * شريط «نسخة جديدة».
 *
 * غير حاجب: التطبيق يعمل، والتحديث اختيار. الحجب يعني أن نسخة قديمة على جوّال
 * أحدهم توقفه تمامًا عن القراءة.
 */
async function offerUpdate() {
  const update = await checkForUpdate();
  if (!update) return;

  const bar = el('div', 'update');
  const text = el('div', 'update__text', `VANTARA ${update.version} متوفر`);
  bar.append(text);

  if (update.url) {
    const get = el('a', 'btn btn--small', 'تحديث');
    get.href = update.url;
    get.rel = 'noopener';
    bar.append(get);
  }

  const later = el('button', 'update__later', 'لاحقًا');
  later.type = 'button';
  later.addEventListener('click', () => {
    dismissUpdate(update.version);
    bar.remove();
  });
  bar.append(later);
  document.body.append(bar);
}

// ───────────────────────────── الإقلاع ─────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}

// الفروقات في الخلفية. لا تلمس الشاشة إلا عبر الترقيع الجزئي.
sync.onChange((tables) => {
  if (tables.includes('profiles') || tables.includes('presence')) refreshPresenceInPlace();
});
setInterval(() => void sync.pull(), 60_000);
setInterval(() => void sync.push(), 15_000);

async function boot() {
  if (!syncConfigured()) {
    // بلا عنوان مزامنة لا حسابات ولا أصدقاء. الرسالة صريحة بدل شاشة فارغة.
    mount(
      (() => {
        const wrap = el('main', 'gate');
        const inner = el('section', 'gate__inner');
        inner.append(el('h1', 'gate__word', 'VANTARA'));
        inner.append(
          el('p', 'gate__message gate__message--error', 'عنوان المزامنة غير مضبوط في هذه النسخة.'),
        );
        wrap.append(inner);
        return wrap;
      })(),
    );
    return;
  }

  if (sync.signedIn) {
    // جلسة قائمة: نفتح على الرئيسية فورًا من المرآة، والشبكة تُصحّح بعدها
    startHeartbeat();
    await go({ name: 'home' });
    void sync.pull();
    void refreshPresence();
    void offerUpdate();
    return;
  }
  await go({ name: 'gate' });
}

void boot();