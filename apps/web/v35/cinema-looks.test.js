import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// أنماط صفحة عمل السينما: الوظائف نفسها (التشغيل، المصادر، الحلقات، «شوهدت») والنمط يرتّب ويلبس فقط
const series = {
  id: 'tt0944947', type: 'series', title: 'Game of Thrones', year: 2011, rating: 9.2, description: 'Nine noble families.', poster: 'p.jpg', background: 'b.jpg', genres: ['Drama'],
  seasons: [1, 2, 3].map((n) => ({ n, episodes: [1, 2].map((e) => ({ n: e, title: `S${n}E${e}`, released: 1 })) })),
};
vi.mock('./motion.js', () => ({ pop() {}, progressFill() {}, reduced: () => true, revealIn() {}, stripIn() {} }));
vi.mock('../lib/cinema-meta.js', async (original) => ({ ...await original(), detail: async () => series, search: async () => [], castPhotos: async () => new Map(), catalog: async () => [] }));
vi.mock('../lib/anime-engine.js', async (original) => ({ ...await original(), available: () => false, sources: async () => [], onNeedsHuman() {}, on: () => () => {} }));
const { createCinema } = await import('./cinema.js');

let store;
beforeEach(() => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<html><body><main id="cinema"></main><div id="sheet"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('Image', function () { return document.createElement('img'); });
  store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function open(style, work = series) {
  store.set('vantara.appearance.v1', JSON.stringify({ style: { cinema: style }, accent: {} }));
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const deps = { q: (id) => document.getElementById(id), el, toast: vi.fn(), showPage() {}, currentPage: () => 'cinema', openSheet() {}, closeSheet() {} };
  const cinema = createCinema(deps);
  await cinema.openWork(work);
  await vi.advanceTimersByTimeAsync(1);
  return document.querySelector('.cn-detail');
}

it('الأساسي كما هو: زر المواسم وورقته، والحلقات بعد القصة', async () => {
  const page = await open('current');
  expect(page.dataset.style).toBe('current');
  expect(page.querySelector('.cn-season-btn')).not.toBeNull();
  expect(page.querySelector('.cn-seasons')).toBeNull();
  const kids = [...page.querySelector('#cinemaBody').children];
  expect(kids.indexOf(page.querySelector('.cn-about'))).toBeLessThan(kids.indexOf(page.querySelector('#cinemaEpisodes')));
});

it('الأنماط الثلاثة: زر واحد باسم الموسم يفتح قائمته (قاعدة التطبيق)، والحلقات بلقطاتها ثانيًا بعد التشغيل', async () => {
  for (const style of ['premiere', 'poster', 'marquee']) {
    const page = await open(style);
    expect(page.dataset.style).toBe(style);
    const eps = page.querySelector('#cinemaEpisodes');
    expect(eps.querySelector('.cn-seasons')).toBeNull();
    expect(eps.querySelector('.cn-season-btn').textContent).toContain('الموسم 1');
    const kids = [...page.querySelector('#cinemaBody').children];
    expect(kids.indexOf(eps)).toBeLessThan(kids.indexOf(page.querySelector('.cn-about')));
    expect(page.querySelector('#cinemaPlay')).not.toBeNull();
    // الحلقات بلقطاتها و«شوهدت» على كل حلقة في كل نمط
    expect(eps.querySelectorAll('.cn-ep-art img')).toHaveLength(2);
    expect(eps.querySelectorAll('.cn-ep-seen')).toHaveLength(2);
  }
  // العرض الأول: زر التشغيل لقطة بنصه الذي يحدّثه refreshMarks أولًا
  const still = (await open('premiere')).querySelector('#cinemaPlay.cn-look-still');
  expect(still.querySelector('span').textContent).toContain('الحلقة 1');
  expect(still.querySelector('.cn-still-art img')).not.toBeNull();
});

it('الملصق يضع ملصق العمل، والشريط العريض كريدت بما يُعرف فقط (الفيلم بمدته)', async () => {
  expect((await open('poster')).querySelector('.cn-look-poster img')).not.toBeNull();
  const credits = (await open('marquee')).querySelector('.cn-look-credits');
  expect([...credits.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['السنة', 'المواسم', 'IMDb']);
  const movie = { id: 'tt0816692', type: 'movie', title: 'Interstellar', year: 2014, runtime: '169 min', poster: 'p.jpg', _sourceCopy: { sourceId: 'x', url: '/i', title: 'Interstellar' } };
  const m = await open('marquee', movie);
  expect([...m.querySelectorAll('.cn-look-credits dt')].map((d) => d.textContent)).toEqual(['السنة', 'المدة']);
  expect(m.querySelector('.cn-seasons')).toBeNull();
});
