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
  originalLogo.dataset.phase = 'loop';
  originalLogo.dataset.logoState = 'ready';
  originalLogo.style.setProperty('--wl-logo-fade-start', '436px');
  const train = originalLogo.querySelector('.wl-logo-train');
  const clock = { currentTime: 18432 };
  train.getAnimations = () => [clock];
  const extra = train.querySelector('img').cloneNode(true);
  train.querySelector('.wl-logo-group').append(extra);
  const refresh = vi.fn(() => {
    expect(host.querySelector('.wl-big').textContent).toContain('تابع الحلقة 10');
  });
  host._updateLogoLayer = refresh;
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
  expect(originalLogo.dataset.phase).toBe('loop');
  expect(originalLogo.dataset.logoState).toBe('ready');
  expect(originalLogo.style.getPropertyValue('--wl-logo-fade-start')).toBe('436px');
  expect(host.querySelector('.wl-logo-train').getAnimations()[0]).toBe(clock);
  expect(clock.currentTime).toBe(18432);
  expect(originalLogo.contains(extra)).toBe(true);
  expect(refresh).toHaveBeenCalledOnce();
  expect(host.querySelector('.wl-big').textContent).toContain('تابع الحلقة 10');
  host.querySelector('.wl-big').click();
  expect(afterProgress.play).toHaveBeenCalledWith(10);

  renderLook('card', host, ctx({ logo: 'https://img/new-logo.png' }));
  expect(host.querySelector('.wl-logo-layer')).not.toBe(originalLogo);
  expect(host.querySelector('.wl-logo-layer').dataset.logoSrc).toBe('https://img/new-logo.png');
});

it('flying-card uses identical color-preserving copies in a transparent compositor corridor', async () => {
  const host = dom();
  renderLook('card', host, ctx({ logo: 'https://img/logo.png' }));
  const layer = host.querySelector('.wl-logo-layer');
  expect(layer.getAttribute('aria-hidden')).toBe('true');
  expect(layer.hidden).toBe(true);
  expect(layer.querySelectorAll('.wl-logo-train')).toHaveLength(1);
  const groups = layer.querySelectorAll('.wl-logo-group');
  expect(groups).toHaveLength(2);
  expect(groups[0].innerHTML).toBe(groups[1].innerHTML);
  expect(groups[0].querySelector('img').getAttribute('crossorigin')).toBe('anonymous');
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('./anime.css', import.meta.url), 'utf8');
  const band = /\.v35 \.wl-card \.wl-logo-layer\s*\{([^}]+)\}/.exec(css)?.[1];
  expect(band).toContain('mask-image: linear-gradient');
  expect(band).not.toMatch(/(?:^|;)\s*background(?:-color|-image)?\s*:/);
  const artwork = /\.v35 \.wl-card \.wl-logo-group img\s*\{([^}]+)\}/.exec(css)?.[1];
  expect(artwork).toMatch(/filter:\s*none/);
  expect(artwork).not.toMatch(/brightness|invert|grayscale/);
  expect(css).not.toMatch(/@keyframes\s+wl-logo-(?:enter|drift)/);
});

it('releases and replaces the logo when its source or work identity changes', () => {
  const host = dom();
  const first = ctx({ logo: 'https://img/logo.png' });
  renderLook('card', host, first);
  const initial = host.querySelector('.wl-logo-layer');
  const releaseFirst = vi.fn(host._releaseLogoLayer);
  host._releaseLogoLayer = releaseFirst;
  renderLook('card', host, ctx({ logo: 'https://img/new-logo.png' }));
  expect(releaseFirst).toHaveBeenCalledOnce();
  const replacement = host.querySelector('.wl-logo-layer');
  expect(replacement).not.toBe(initial);
  expect(replacement.dataset.logoSrc).toBe('https://img/new-logo.png');
  const releaseSecond = vi.fn(host._releaseLogoLayer);
  host._releaseLogoLayer = releaseSecond;
  renderLook('card', host, ctx({ m: { ...first.m, id: 999 }, logo: 'https://img/new-logo.png' }));
  expect(releaseSecond).toHaveBeenCalledOnce();
  expect(host.querySelector('.wl-logo-layer')).not.toBe(replacement);
  expect(host.dataset.workId).toBe('999');
});

it('preserves the host identity so late artwork can render after a no-logo update', () => {
  const host = dom();
  renderLook('card', host, ctx());
  renderLook('card', host, ctx({ progressText: 'new progress' }));
  expect(document.getElementById('h')).toBe(host);
  renderLook('card', document.getElementById('h'), ctx({ logo: 'https://img/late-logo.png' }));
  expect(host.querySelector('.wl-logo-layer')?.dataset.logoSrc).toBe('https://img/late-logo.png');
  expect(host.querySelector('.wl-info .wl-logo')?.getAttribute('src')).toBe('https://img/late-logo.png');
});

it('keeps an expanded description and visible episode mini-player through a progress repaint', () => {
  const host = dom(); renderLook('episode', host, ctx());
  const description = host.querySelector('.wl-desc'), mini = host.querySelector('.wl-mini');
  description.classList.add('open'); mini.classList.add('on');
  renderLook('episode', host, ctx({ point: { episode: 3, resume: true }, label: 'تابع الحلقة 3' }));
  expect(host.querySelector('.wl-desc')).toBe(description);
  expect(description.classList.contains('open')).toBe(true);
  expect(host.querySelector('.wl-mini')).toBe(mini);
  expect(mini.classList.contains('on')).toBe(true);
  expect(mini.textContent).toContain('تابع الحلقة 3');
});
