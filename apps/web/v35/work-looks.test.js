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

it('every look presents a movie without episode headings, numbering or a next episode', () => {
  for (const look of LOOK_IDS) {
    const host = dom();
    renderLook(look, host, ctx({ m: { id: 1, title: 'A Film', format: 'MOVIE' }, total: 1,
      next: null, facts: [['المدة', '112 دقيقة']], meta: ['فيلم'], point: { episode: 1 },
      label: 'شاهد الفيلم', progressText: 'لم يُشاهد بعد', epTitle: () => null }));
    expect(host.textContent, look).not.toMatch(/الحلقات|الحلقة|حلقة 1/);
    expect(host.textContent, look).toContain('شاهد الفيلم');
    expect(host.querySelectorAll('.er, .sp, [data-range]'), look).toHaveLength(0);
  }
});

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

it('flying-card preserves its logo DOM and animation phase when details or episode progress changes', () => {
  const host = dom();
  const first = ctx({ logo: 'https://img/logo.png' });
  renderLook('card', host, first);
  const originalLogo = host.querySelector('.wl-logo-layer');
  const originalHead = host.querySelector('.wl-head');
  const originalPoster = host.querySelector('.wl-stage3d .wl-card img');
  originalLogo.dataset.ready = 'true';
  originalLogo.dataset.entered = 'true';
  originalLogo.dataset.running = 'true';

  const afterProgress = ctx({
    logo: first.logo,
    point: { episode: 10, resume: true },
    label: 'تابع الحلقة 10',
    progressText: 'شاهدت 0 من 1100',
  });
  renderLook('card', host, afterProgress);
  expect(host.querySelector('.wl-logo-layer')).toBe(originalLogo);
  expect(host.querySelector('.wl-head')).toBe(originalHead);
  expect(host.querySelector('.wl-stage3d .wl-card img')).toBe(originalPoster);
  expect(originalLogo.dataset.running).toBe('true');
  expect(host.querySelector('.wl-big').textContent).toContain('تابع الحلقة 10');
  host.querySelector('.wl-big').click();
  expect(afterProgress.play).toHaveBeenCalledWith(10);

  renderLook('card', host, ctx({ logo: 'https://img/new-logo.png' }));
  expect(host.querySelector('.wl-logo-layer')).not.toBe(originalLogo);
  expect(host.querySelector('.wl-logo-layer').dataset.logoSrc).toBe('https://img/new-logo.png');
});

it('flying-card logos enter from outside the right edge and retain their original colors', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('./anime.css', import.meta.url), 'utf8');
  expect(css).toContain('wl-logo-enter');
  expect(css).toContain('translate3d(calc(100vw + 100%), 0, 0)');
  expect(css).toContain('.wl-logo-white img { filter: none; }');
  expect(css).not.toMatch(/\.wl-logo-white img\s*\{[^}]*brightness\(0\)\s+invert\(1\)/);
});
