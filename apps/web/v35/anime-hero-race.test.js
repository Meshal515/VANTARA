import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./motion.js', () => ({ pop() {}, pageIn() {}, revealIn() {}, stripIn() {} }));
vi.mock('../lib/anime-engine.js', async (original) => ({ ...await original(), available: () => false, sources: async () => [], on: () => () => {}, onNeedsHuman() {} }));
const { createAnime } = await import('./anime.js');
const { heroPlan } = await import('./work-looks.js');

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/**
 * صورة البطل: صورة اختيرت أولًا (الغلاف بعد مهلة 1200ms) ووصلت بعد صورة أفضل كانت تُلصق فوقها وتحذفها.
 * في «الحلقة أولًا» هذا هو «اللقطة واضحة ثم تتغبّش بعد جزء من الثانية»: الغلاف المضبّب يحل محل لقطة الحلقة.
 */
const DETAIL = {
  id: 156092, idMal: null, title: { english: 'To Be Hero X', romaji: 'To Be Hero X' }, coverImage: { extraLarge: 'https://img/cover.jpg', large: 'https://img/cover-s.jpg', color: '#d61a1a' },
  bannerImage: null, genres: ['Action'], averageScore: 85, popularity: 1000, episodes: 24, duration: 24, format: 'ONA', status: 'FINISHED', season: 'SPRING', seasonYear: 2025,
  description: 'Heroes.', studios: { nodes: [{ name: 'Studio' }] }, characters: { edges: [] }, relations: { edges: [] }, recommendations: { nodes: [] }, streamingEpisodes: [],
};

const setup = ({ style, zip }) => {
  const { window, document } = parseHTML('<html><body><main><section id="anime"></section><section id="animeLibrary"></section><div id="animeDiscover"></div><section id="animeCollection"></section></main></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  const made = [];
  vi.stubGlobal('Image', function () { const n = document.createElement('img'); made.push(n); return n; });
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {});
  const store = new Map([['vantara.appearance.v1', JSON.stringify({ style: { anime: style }, accent: {}, pureBlack: false })]]);
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://graphql.anilist.co')) {
      const body = JSON.parse(init.body);
      if (body.query.includes('Media(id:')) return { ok: true, json: async () => ({ data: { Media: DETAIL } }) };
      return { ok: true, json: async () => ({ data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } }) };
    }
    if (u.startsWith('https://api.ani.zip/')) {
      // الفن يصل بعد مهلة البطل (1200ms): هنا يبدأ السباق
      await new Promise((r) => setTimeout(r, 1300));
      return { ok: true, json: async () => zip };
    }
    return { ok: false, json: async () => ({}) };
  }));
  const root = document.querySelector('main');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const deps = { root, q: (id) => root.querySelector(`#${id}`), el, toast: vi.fn(), genreAr: (s) => s, openSheet: vi.fn(), closeSheet: vi.fn(), showPage() {}, currentPage: () => 'anime', sync: { user: null, rows: () => [], enqueue: vi.fn() } };
  const anime = createAnime(deps);
  const heroImgs = () => made.filter((n) => /aw-bg-img/.test(n.className));
  return { root, anime, heroImgs };
};
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

it('a late, worse hero image never covers a better one already shown (core)', async () => {
  const { root, anime, heroImgs } = setup({ style: 'core', zip: { mappings: { imdb_id: 'tt1234567' }, episodes: {} } });
  await anime.openAnime({ id: 156092, title: 'To Be Hero X', poster: 'https://img/cover.jpg' });
  await wait(1250);
  await settle();
  // المهلة مضت بلا فن: الغلاف (رتبة 2) قيد التحميل
  const [poster] = heroImgs();
  expect(poster.src).toBe('https://img/cover.jpg');
  await wait(150);
  await settle();
  const backdrop = heroImgs().find((n) => n.src.includes('metahub.space/background/large'));
  expect(backdrop).toBeTruthy();
  // الخلفية الأفضل تكتمل أولًا، ثم يكتمل الغلاف المتأخر
  backdrop.onload();
  await settle();
  poster.onload();
  await wait(700);
  await settle();
  const bg = root.querySelector('.aw-bg');
  expect([...bg.querySelectorAll('.aw-bg-img')].map((n) => n.src)).toEqual([backdrop.src]);
  anime.leaveDetail();
});

it('«الحلقة أولًا»: the hero is the episode still, never the blurred poster, and nothing blurred sits behind it', async () => {
  const { root, anime, heroImgs } = setup({ style: 'episode', zip: { mappings: { imdb_id: 'tt1234567' }, episodes: { 1: { image: 'https://tvdb/ep1.jpg', seasonNumber: 1, episodeNumber: 1 } } } });
  await anime.openAnime({ id: 156092, title: 'To Be Hero X', poster: 'https://img/cover.jpg' });
  await wait(1250);
  await settle();
  // قبل أن يُعرف هل للحلقة لقطة: لا غلاف ولا خلفية تسبقها (كانت تتسابق معها ثم تغطيها)
  expect(heroImgs()).toEqual([]);
  await wait(150);
  await settle();
  const imgs = heroImgs();
  expect(imgs.map((n) => n.src)).toEqual(['https://tvdb/ep1.jpg']);
  imgs[0].onload();
  await wait(700);
  await settle();
  const hero = root.querySelector('.aw-hero');
  expect([...hero.querySelectorAll('.aw-bg-img')].map((n) => [n.src, n.className])).toEqual([['https://tvdb/ep1.jpg', 'aw-bg-img in']]);
  // لا نسخة مضبّبة خلف اللقطة
  expect(hero.classList.contains('amb')).toBe(false);
  expect(hero.style.getPropertyValue('--aw-amb')).toBe('');
  expect(heroImgs().some((n) => /aw-bg-img--poster/.test(n.className))).toBe(false);
  anime.leaveDetail();
});

it('«الحلقة أولًا» without any still or backdrop keeps a plain placeholder (no poster, no blur)', async () => {
  const { root, anime, heroImgs } = setup({ style: 'episode', zip: { mappings: {}, episodes: {} } });
  await anime.openAnime({ id: 156092, title: 'To Be Hero X', poster: 'https://img/cover.jpg' });
  await wait(1500);
  await settle();
  expect(heroImgs().filter((n) => n.src === 'https://img/cover.jpg')).toEqual([]);
  expect(root.querySelector('.aw-hero').classList.contains('amb')).toBe(false);
  anime.leaveDetail();
});


it('heroPlan separates «الحلقة أولًا» from the banner treatment the other looks need', () => {
  expect(heroPlan('episode')).toEqual({ episodeStill: true, posterFallback: false, ambient: false });
  for (const look of ['core', 'platform', 'card', 'screen']) expect(heroPlan(look)).toEqual({ episodeStill: false, posterFallback: true, ambient: true });
});

it('CSS guard: no blur rule can reach any hero layer in «الحلقة أولًا»', () => {
  const css = readFileSync(new URL('./anime.css', import.meta.url), 'utf8');
  // الغلاف المضبّب وحده للأنماط الأخرى
  expect(css).toContain(".v35 .aw:not(.no-cover):not([data-style='episode']) .aw-bg-img--poster {");
  // النسخة المضبّبة خلف البطل مخفية، وأي فلتر على طبقاته يُلغى (يغلب wide.css أيضًا)
  expect(css).toMatch(/\.aw\[data-style='episode'\] \.aw-hero::before \{ display: none; \}/);
  expect(css).toMatch(/\.aw\[data-style='episode'\] \.aw-bg-img \{ filter: none !important; \}|\.aw\[data-style='episode'\] \.aw-bg-img[^{]*\{ filter: none !important; \}/);
});
