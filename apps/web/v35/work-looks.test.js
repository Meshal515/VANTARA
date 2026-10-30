import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
import { LOOK_IDS, heroPlan, renderLook } from './work-looks.js';

afterEach(() => vi.unstubAllGlobals());

/** نفس ما يجمعه paintLook في anime.js: الأنماط ترسم ولا تجلب شيئًا. */
const ctx = (over = {}) => ({
  m: { id: 21, title: 'One Piece', poster: 'https://img/p.jpg', posterSmall: 'https://img/ps.jpg', description: 'Pirates.', recommendations: [], relations: [] },
  glyph: () => '<svg></svg>',
  logo: null,
  meta: ['مسلسل'],
  genres: ['أكشن', 'مغامرة'],
  genreKeys: ['Action', 'Adventure'],
  facts: [['الاستوديو', 'Toei'], ['الحلقات', '1100']],
  point: { episode: 2, resume: true },
  label: 'تابع الحلقة 2',
  upcoming: false,
  next: { episode: 1101, at: Date.now() + 86400000, rel: 'بعد يوم', time: 'الأحد 4:00 م' },
  total: 1100,
  ratio: 0.45,
  left: 13,
  seenRatio: 0.001,
  progressText: 'شاهدت 1 من 1100',
  lineDone: '2',
  characters: [],
  heroSrc: null,
  rangeAt: null,
  epTitle: (n) => `Ep ${n}`,
  epOverview: () => null,
  still: () => ({ src: 'https://img/s.jpg', still: true, fallbacks: [] }),
  seen: (n) => n < 2,
  minutes: () => '24 د',
  play: vi.fn(),
  open: vi.fn(),
  openGenre: vi.fn(),
  ...over,
});

const dom = () => {
  const { window, document } = parseHTML('<html><body><div id="h"></div></body></html>');
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('getComputedStyle', () => ({ direction: 'rtl' }));
  return document.getElementById('h');
};

it('every look carries the core functions: next-episode time, a slot for friends activity, facts, progress', () => {
  for (const look of LOOK_IDS) {
    const host = dom();
    renderLook(look, host, ctx());
    const next = host.querySelector('.wl-next');
    expect(next?.textContent, look).toContain('الحلقة 1101 بعد يوم');
    expect(next.textContent, look).toContain('الأحد 4:00 م');
    expect(host.querySelectorAll('[data-slot="insights"]').length, look).toBe(1);
    expect(host.querySelector('.wl-facts')?.textContent, look).toContain('Toei');
    expect(host.textContent, look).toContain('شاهدت 1 من 1100');
  }
});

it('no airing date, no countdown: nothing is invented', () => {
  for (const look of LOOK_IDS) {
    const host = dom();
    renderLook(look, host, ctx({ next: null }));
    expect(host.querySelector('.wl-next'), look).toBeNull();
  }
});

it('genres open their collection, and a long-press on an episode is not a play', () => {
  const host = dom();
  const c = ctx();
  renderLook('platform', host, c);
  host.querySelector('[data-genre="Adventure"]').click();
  expect(c.openGenre).toHaveBeenCalledWith('Adventure');
  const ep = host.querySelector('.er[data-ep="3"]');
  ep._held = true;
  ep.click();
  expect(c.play).not.toHaveBeenCalled();
  ep.click();
  expect(c.play).toHaveBeenCalledWith(3);
});

it('heroPlan: only «الحلقة أولًا» drops the blurred poster and the blurred ambient copy', () => {
  expect(heroPlan('episode').posterFallback).toBe(false);
  expect(heroPlan('episode').ambient).toBe(false);
  expect(heroPlan('core').posterFallback).toBe(true);
});
