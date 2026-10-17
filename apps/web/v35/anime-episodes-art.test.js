import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./motion.js', () => ({ pop() {}, pageIn() {}, revealIn() {}, stripIn() {} }));
vi.mock('../lib/anime-engine.js', async (original) => ({ ...await original(), available: () => false, sources: async () => [], on: () => () => {}, onNeedsHuman() {} }));
const { createAnime } = await import('./anime.js');

afterEach(() => { vi.unstubAllGlobals(); });

const setup = () => {
  const { window, document } = parseHTML('<html><body><main><section id="anime"></section><section id="animeLibrary"></section></main></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  vi.stubGlobal('fetch', async (url) => {
    if (String(url).startsWith('https://api.ani.zip/')) {
      return { ok: true, json: async () => ({ mappings: { imdb_id: 'tt26743760' }, episodes: { 1: { image: 'https://tvdb/1.jpg', title: { en: 'Maomao' } } } }) };
    }
    return { ok: false, json: async () => ({}) };
  });
  const root = document.querySelector('main');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const sheet = document.createElement('div');
  const sync = { user: null, rows: () => [], enqueue: vi.fn() };
  const deps = { root, q: (id) => root.querySelector(`#${id}`), el, toast: vi.fn(), genreAr: (s) => s, openSheet: vi.fn((build) => { sheet.replaceChildren(); build(sheet); }), closeSheet: vi.fn(), showPage() {}, currentPage: () => 'anime', sync };
  const anime = createAnime(deps);
  return { root, anime, sheet, deps, store };
};

it('episode rows look like series: a still per episode, the cover where none, never a number tile; title logo from ani.zip', async () => {
  const { root, anime } = setup();
  const m = { id: 161645, title: 'The Apothecary Diaries', poster: 'https://img/cover.jpg', aired: 3, episodes: 3, duration: 24, _sourceCopy: true };
  await anime.openAnime(m);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  const rows = [...root.querySelectorAll('.an-er')];
  expect(rows.map((r) => r.dataset.ep)).toEqual(['1', '2', '3']);
  expect(root.querySelector('.an-er-num, .an-er-art--num')).toBeNull();
  const srcs = rows.map((r) => r.querySelector('.an-er-art img').getAttribute('src'));
  expect(srcs).toEqual(['https://tvdb/1.jpg', 'https://img/cover.jpg', 'https://img/cover.jpg']);
  expect(rows[0].querySelector('.an-er-title').textContent).toBe('Maomao');
  expect(rows[1].querySelector('.an-er-title').textContent).toBe('الحلقة 2');
  // «شوهدت» يبقى في كل صف
  expect(rows.every((r) => r.querySelector('.an-er-icon'))).toBe(true);
  const logo = root.querySelector('#animeTitleMark .an-mark-logo');
  expect(logo.getAttribute('src')).toBe('https://images.metahub.space/logo/medium/tt26743760/img');
  // الاسم نصًا باقٍ حتى يُحمَّل الشعار
  expect(root.querySelector('#animeTitleMark h1').textContent).toBe('The Apothecary Diaries');
  anime.leaveDetail();
});

it('continue-watching rows get a ⋮ beside the title: list and remove work, favorite only with an account', async () => {
  const { root, anime, sheet, deps, store } = setup();
  const key = 'vantara.anime.watch.v2.guest';
  store.set(key, JSON.stringify({ 5: { id: 5, title: 'Frieren', poster: 'p.jpg', episode: 3, at: 1, episodes: { 3: { position: 60_000, duration: 1_440_000 } } } }));
  anime.renderLibrary();
  const row = root.querySelector('.an-hc');
  // بطاقة بهوية الأنمي: لقطة عريضة، شارة الحلقة، الوقت، «تابع»، التقدّم، البوستر — و⋮ بدل سلة الحذف
  expect(row.querySelector('.an-hc-chip').textContent).toBe('الحلقة3');
  expect(row.querySelector('.an-hc-play').textContent).toBe('تابع');
  expect(row.querySelector('.an-hc-bar i').style.width).toBe('4.2%');
  expect(row.querySelector('.an-hc-left').textContent).toBe('باقي 23 د');
  expect(row.querySelector('.an-hc-poster img').getAttribute('src')).toBe('p.jpg');
  expect(row.querySelector('[aria-label="احذف من السجل"]')).toBeNull();
  expect(root.querySelector('.an-clear')).toBeTruthy();
  const more = row.querySelector('.cw-name .cw-more');
  expect(more).toBeTruthy();
  more.onclick({ stopPropagation() {}, preventDefault() {} });
  expect(deps.openSheet).toHaveBeenCalledTimes(1);
  const keys = () => [...sheet.querySelectorAll('.sheet-item')].map((b) => b.dataset.key);
  expect(keys()).toEqual(['list', 'remove']);
  sheet.querySelector('[data-key="list"]').onclick();
  expect(JSON.parse(store.get('vantara.anime.list.v2.guest'))[5].title).toBe('Frieren');
  more.onclick({ stopPropagation() {}, preventDefault() {} });
  expect(sheet.querySelector('[data-key="list"]').getAttribute('aria-pressed')).toBe('true');
  sheet.querySelector('[data-key="remove"]').onclick();
  expect(JSON.parse(store.get(key))).toEqual({});
  expect(root.querySelector('.an-hc')).toBeNull();
  expect(deps.closeSheet).toHaveBeenCalled();
});

it('signed in: the ⋮ sheet adds to favorites through the account', () => {
  const { root, anime, sheet, deps, store } = setup();
  deps.sync.user = { userId: 'u1' };
  deps.sync.insights = () => new Promise(() => {});
  store.set('vantara.anime.watch.v2.user.u1', JSON.stringify({ 5: { id: 5, title: 'Frieren', poster: 'p.jpg', episode: 3, at: 1, episodes: {} } }));
  anime.renderLibrary();
  root.querySelector('.an-hc .cw-more').onclick({ stopPropagation() {}, preventDefault() {} });
  expect([...sheet.querySelectorAll('.sheet-item')].map((b) => b.dataset.key)).toEqual(['favorite', 'list', 'remove']);
  sheet.querySelector('[data-key="favorite"]').onclick();
  expect(deps.sync.enqueue).toHaveBeenCalledWith('favorite.set', expect.objectContaining({ seriesRef: 'anime:5', member: true }));
  sheet.querySelector('[data-key="remove"]').onclick();
  expect(deps.sync.enqueue).toHaveBeenCalledWith('view.remove', { seriesRef: 'anime:5' });
});
