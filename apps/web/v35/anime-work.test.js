import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./motion.js', () => ({ pop() {}, pageIn() {}, revealIn() {}, stripIn() {} }));
vi.mock('../lib/anime-engine.js', async (original) => ({ ...await original(), available: () => false, sources: async () => [], on: () => () => {}, onNeedsHuman() {} }));
const { createAnime, recordWatch } = await import('./anime.js');
const { cycleGenre, collectionSpec } = await import('./anime-discover.js');
const { diagnosticsUi } = await import('../lib/diagnostics-ui.js');
const { beginDiscovery, setDiscoveryDebug } = await import('../lib/discovery-diagnostics.js');

afterEach(() => { vi.restoreAllMocks(); setDiscoveryDebug(false); vi.useRealTimers(); vi.unstubAllGlobals(); });

const DETAIL = {
  id: 161645, idMal: null, title: { english: 'The Apothecary Diaries', romaji: 'Kusuriya no Hitorigoto' }, coverImage: { extraLarge: 'https://img/cover.jpg', large: 'https://img/cover-s.jpg', color: '#e4a15d' },
  bannerImage: 'https://img/banner.jpg', genres: ['Drama', 'Mystery'], averageScore: 88, popularity: 300000, episodes: 3, duration: 24, format: 'TV', status: 'FINISHED', season: 'FALL', seasonYear: 2023,
  description: 'Maomao lives a quiet life.', studios: { nodes: [{ name: 'OLM' }] },
  characters: { edges: [{ role: 'MAIN', node: { id: 1, name: { full: 'Maomao' }, image: { large: 'https://img/maomao.png' } }, voiceActors: [{ name: { full: 'Aoi Yuuki' } }] }] },
  relations: { edges: [] }, recommendations: { nodes: [] }, streamingEpisodes: [],
};

const setup = ({ detail = DETAIL } = {}) => {
  const { window, document } = parseHTML('<html><body><main><section id="anime"></section><section id="animeLibrary"></section><div id="animeDiscover"></div><section id="animeCollection"></section></main></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    if (String(url).startsWith('https://graphql.anilist.co')) {
      const body = JSON.parse(init.body);
      if (body.query.includes('Media(id:')) return { ok: true, json: async () => ({ data: { Media: detail } }) };
      return { ok: true, json: async () => ({ data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } }) };
    }
    return { ok: false, json: async () => ({}) };
  }));
  const root = document.querySelector('main');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const sync = { user: null, rows: () => [], enqueue: vi.fn() };
  const pages = [];
  const deps = { root, q: (id) => root.querySelector(`#${id}`), el, toast: vi.fn(), genreAr: (s) => s, openSheet: vi.fn(), closeSheet: vi.fn(), showPage: (id) => pages.push(id), currentPage: () => 'anime', sync };
  const anime = createAnime(deps);
  return { root, anime, store, calls, pages, document, window, deps };
};
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

it('presents an anime movie as a film with duration and no episode list', async () => {
  const { root, anime } = setup({ detail: { ...DETAIL, format: 'MOVIE', episodes: 1, duration: 112 } });
  await anime.openAnime({ id: DETAIL.id, title: 'The Apothecary Diaries', format: 'MOVIE', episodes: 1 });
  await settle();
  expect(root.querySelector('.aw-cta').textContent).toContain('شاهد الفيلم');
  expect(root.querySelector('.aw-meta').textContent).not.toContain('حلقة');
  expect(root.querySelector('.aw-info').textContent).toContain('112 دقيقة');
  expect(root.querySelectorAll('.an-er')).toHaveLength(0);
  expect(root.querySelector('.aw-episodes').textContent).not.toContain('الحلقات');
});

it('keeps a finished film in history without a next episode label', () => {
  const { root, anime } = setup();
  recordWatch({ id: 91, title: 'A Film', format: 'MOVIE', episodes: 1 }, 1, 112000, 112000);
  anime.renderLibrary();
  const card = root.querySelector('.an-hc');
  expect(card.textContent).toContain('الفيلم');
  expect(card.textContent).not.toMatch(/الحلقة|التالية/);
});

it('Debug exposes recorded discovery evidence from the actual work page', async () => {
  vi.spyOn(diagnosticsUi, 'visible').mockReturnValue(true);
  setDiscoveryDebug(true);
  beginDiscovery({ workId: DETAIL.id }).record('candidate_rejected', { reason: 'sequel', sourceId: 'example' });
  const { root, anime, deps, document } = setup();
  const sheet = document.createElement('section');
  deps.openSheet = fn => fn(sheet);
  await anime.openAnime({ id: DETAIL.id, title: 'The Apothecary Diaries' });
  await settle();
  root.querySelector('.aw-discovery-debug').click();
  expect(sheet.textContent).toContain('candidate_rejected');
  expect(sheet.textContent).toContain('sequel');
  expect(sheet.textContent).toContain('example');
});

it('hides diagnostics and its content while internal Debug evidence continues recording', async () => {
  setDiscoveryDebug(true);
  const { root, anime } = setup();
  await anime.openAnime({ id: DETAIL.id, title: 'The Apothecary Diaries' });
  await settle();
  expect(root.querySelector('.aw-discovery-debug')).toBeNull();
  expect(root.querySelector('#animeSources').hidden).toBe(true);
  expect(root.querySelector('#animeSources').childElementCount).toBe(0);
});

it('the work page is built once and filled in place: no re-render when details arrive, title is long-press copyable', async () => {
  const { root, anime } = setup();
  const opening = anime.openAnime({ id: 161645, title: 'The Apothecary Diaries', poster: 'https://img/cover.jpg' });
  const page = root.querySelector('#anime .aw');
  const mark = root.querySelector('#animeTitleMark');
  const cta = root.querySelector('.aw-cta');
  expect(page).toBeTruthy();
  // الهيكل كاملًا من اللحظة الأولى: الشعار في صندوقه، الزر، الأفعال، والحلقات هياكل
  expect(mark.hasAttribute('data-copyable')).toBe(true);
  expect(cta.textContent).toContain('شاهد الحلقة 1');
  expect(root.querySelectorAll('.an-skel-ep').length).toBe(3);
  await opening;
  await settle();
  // نفس العقد بعد وصول التفاصيل: مُلئت أماكنها، لم تُستبدل الصفحة
  expect(root.querySelector('#anime .aw')).toBe(page);
  expect(root.querySelector('#animeTitleMark')).toBe(mark);
  // سطر المعلومات: النوع والموسم والتقييم وعدد الحلقات والحالة؛ الاستوديو في «معلومات» أسفل الصفحة
  expect(root.querySelector('.aw-meta').textContent).toContain('3 حلقة');
  expect(root.querySelector('.aw-info').textContent).toContain('OLM');
  expect(root.querySelector('.aw-meta').textContent).toContain('8.8');
  expect([...root.querySelectorAll('.an-er')].map((r) => r.dataset.ep)).toEqual(['1', '2', '3']);
  expect(root.querySelector('.aw-person-name').textContent).toBe('Maomao');
  expect(root.querySelector('.an-onair, .an-stats, .an-detail-poster')).toBeNull();
  anime.leaveDetail();
});

it('toggling watched repaints only that row (same nodes, same image), and the CTA moves on', async () => {
  const { root, anime, store } = setup();
  await anime.openAnime({ id: 161645, title: 'The Apothecary Diaries', poster: 'https://img/cover.jpg' });
  await settle();
  const rows = [...root.querySelectorAll('.an-er')];
  const img = rows[0].querySelector('img');
  rows[0].querySelector('.an-er-icon').onclick();
  const after = [...root.querySelectorAll('.an-er')];
  expect(after).toEqual(rows);
  expect(after[0].querySelector('img')).toBe(img);
  expect(after[0].classList.contains('seen')).toBe(true);
  expect(after[0].querySelector('.an-er-icon').getAttribute('aria-pressed')).toBe('true');
  expect(after[1].classList.contains('seen')).toBe(false);
  expect(JSON.parse(store.get('vantara.anime.watch.v2.guest'))[161645].episodes[1].done).toBe(true);
  expect(root.querySelector('.aw-cta').textContent).toContain('تابع الحلقة 2');
  anime.leaveDetail();
});

it('discover: focusing or re-typing the same text never re-renders; only a real query searches', async () => {
  vi.useFakeTimers();
  const { root, anime, calls, window } = setup();
  anime.showDiscover();
  await vi.advanceTimersByTimeAsync(10);
  const input = root.querySelector('#animeDiscover input');
  const idle = root.querySelector('.ad-idle');
  const genres = root.querySelector('.ag-grid');
  const searchesBefore = calls.filter((c) => c.body?.query?.includes('$search')).length;
  // لوحة مفاتيح أندرويد تطلق input عند اللمس بلا تغيّر: لا شيء يتغيّر
  input.dispatchEvent(new window.Event('input'));
  await vi.advanceTimersByTimeAsync(500);
  expect(root.querySelector('.ad-idle')).toBe(idle);
  expect(root.querySelector('.ag-grid')).toBe(genres);
  expect(idle.hidden).toBe(false);
  expect(calls.filter((c) => c.body?.query?.includes('$search')).length).toBe(searchesBefore);
  input.value = 'Frieren';
  input.dispatchEvent(new window.Event('input'));
  await vi.advanceTimersByTimeAsync(500);
  const searches = calls.filter((c) => c.body?.variables?.search === 'Frieren');
  expect(searches.length).toBe(1);
  expect(idle.hidden).toBe(true);
  input.dispatchEvent(new window.Event('input'));
  await vi.advanceTimersByTimeAsync(500);
  expect(calls.filter((c) => c.body?.variables?.search === 'Frieren').length).toBe(1);
  // الكتابة وحدها لا تُحفظ في «آخر ما بحثت عنه»
  expect(localStorage.getItem('vantara.anime.searches.v1')).toBeNull();
});

it('«الكل» opens its exact list, and genres cycle include → exclude → off', () => {
  const now = new Date(2026, 9, 17);
  expect(collectionSpec({ kind: 'trending' }, (g) => g, now).filters).toEqual({ sort: 'trending' });
  expect(collectionSpec({ kind: 'season', now })).toMatchObject({ filters: { season: 'FALL', year: 2026, sort: 'popularity' } });
  expect(collectionSpec({ kind: 'top' }).filters).toMatchObject({ sort: 'score', minPop: 40000 });
  expect(collectionSpec({ kind: 'genre', genre: 'Mystery' }, (g) => `«${g}»`)).toMatchObject({ title: '«Mystery»', filters: { include: ['Mystery'] }, sortable: true });
  let f = { include: [], exclude: [] };
  f = cycleGenre(f, 'Action');
  expect(f).toEqual({ include: ['Action'], exclude: [] });
  f = cycleGenre(f, 'Action');
  expect(f).toEqual({ include: [], exclude: ['Action'] });
  f = cycleGenre(f, 'Action');
  expect(f).toEqual({ include: [], exclude: [] });
});

it('hero: waits for the IMDb link, prefers its key art, and never uses the AniList strip banner on a phone', async () => {
  const { anime, document } = setup();
  const made = [];
  vi.stubGlobal('Image', function () { const n = document.createElement('img'); made.push(n); return n; });
  const anilist = globalThis.fetch;
  let finishArt;
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).startsWith('https://api.ani.zip/')) {
      // ربط IMDb يصل بعد بيانات AniList: هذا السباق كان يثبّت بانر AniList
      await new Promise(resolve => { finishArt = resolve; });
      return { ok: true, json: async () => ({ mappings: { imdb_id: 'tt26743760' }, episodes: {} }) };
    }
    return anilist(url, init);
  }));
  await anime.openAnime({ id: 161645, title: 'The Apothecary Diaries', poster: 'https://img/cover.jpg' });
  await settle();
  const heroSrcs = () => made.filter((n) => /aw-bg-img/.test(n.className)).map((n) => n.src);
  expect(heroSrcs()).toEqual([]);
  finishArt();
  await settle();
  expect(heroSrcs()).toEqual(['https://images.metahub.space/background/large/tt26743760/img']);
  expect(heroSrcs()).not.toContain('https://img/banner.jpg');
  anime.leaveDetail();
});


it('renders episodes of an already loaded provider-local anime without a second source read', async () => {
  const { sourceWorkModel } = await import('../addons/work-view.js');
  const work = sourceWorkModel({ url: 'https://provider.example/anime/local', type: 'anime', title: 'Native anime' }, {
    addon: { key: 'core|user-native-anime', sourceId: 'user-native-anime', contentTypes: ['anime'] },
    episodes: [{ number: 1 }, { number: 2 }],
  });
  const { root, anime, deps } = setup();
  deps.restoreSourceWork = async () => { throw new Error('Source is offline after catalogue navigation'); };
  await anime.openAnime(work);
  expect([...root.querySelectorAll('.an-er')].map(row => row.dataset.ep)).toEqual(['1', '2']);
});

it('rehydrates a saved provider-local anime reference before rendering its episodes', async () => {
  const work = { id: 'addon-saved-anime', title: 'Saved anime', episodes: 2, aired: 2, _sourceCopy: { sourceId: 'user-native-anime', url: '/anime/saved' } };
  const { root, anime, deps } = setup();
  deps.restoreSourceWork = async ref => { expect(ref).toBe('anime:addon-saved-anime'); return work; };
  await anime.openAnime({ id: work.id, title: work.title });
  expect([...root.querySelectorAll('.an-er')].map(row => row.dataset.ep)).toEqual(['1', '2']);
});

it('updates the mounted work diagnostics without moving the card or clearing engine traces', async () => {
  let visible = false, changed;
  vi.spyOn(diagnosticsUi, 'visible').mockImplementation(() => visible);
  vi.spyOn(diagnosticsUi, 'subscribe').mockImplementation(fn => { changed = fn; return () => {}; });
  const { root, anime, store } = setup();
  store.set('vantara.appearance.v1', JSON.stringify({ style: { anime: 'card' } }));
  await anime.openAnime({ id: DETAIL.id, title: 'The Apothecary Diaries' }); await settle();
  const cover = root.querySelector('.wl-stage3d');
  expect(root.querySelector('.aw-discovery-debug')).toBeNull();
  visible = true; changed();
  expect(root.querySelector('.aw-discovery-debug')).not.toBeNull();
  expect(root.querySelector('#animeSources').previousElementSibling.classList.contains('wl')).toBe(true);
  visible = false; changed();
  expect(root.querySelector('.aw-discovery-debug')).toBeNull();
  expect(root.querySelector('#animeSources').hidden).toBe(true);
  expect(root.querySelector('.wl-stage3d')).toBe(cover);
});
