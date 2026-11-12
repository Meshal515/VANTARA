import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
import { episodeStill } from '../lib/anime-art.js';

// Execute the production closure against image/network and DOM boundaries. HERO_IMPL
// lets the independently supplied replacement run before root integrates anime.js.
const source = readFileSync(process.env.HERO_IMPL ?? new URL('./anime.js', import.meta.url), 'utf8');
const a = source.indexOf('  function paintHero(');
const b = source.indexOf('  async function seriesBackdrop(', a);
const make = new Function('state', 'artOf', 'resumePoint', 'heroPlan', 'episodeStill', 'heroMemory', 'seriesBackdrop', 'paintLook', `${source.slice(a, b)}; return paintHero;`);
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup({ look = 'episode', banner = 'https://img/banner.jpg', poster = 'https://img/poster.jpg', art = null } = {}) {
  vi.useFakeTimers();
  const { document } = parseHTML('<html><body><div class="aw-hero"><div class="aw-bg"></div></div></body></html>');
  vi.stubGlobal('document', document);
  const made = [];
  vi.stubGlobal('Image', function () { const n = document.createElement('img'); n.decode = () => Promise.resolve(); made.push(n); return n; });
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const m = { id: 1, poster, banner };
  const v = { id: 1, look, artSettled: true, artDone: false, heroTried: new Set(), heroRank: Infinity, heroShownRank: Infinity, hero: document.querySelector('.aw-hero'), bg: document.querySelector('.aw-bg') };
  const state = { detail: m, view: v };
  let ep = 1;
  const paint = make(state, () => art, () => ({ episode: ep }), name => ({ episodeStill: name === 'episode', posterFallback: name !== 'episode', ambient: name !== 'episode' }), episodeStill, { get: () => null, set() {} }, async () => null, () => {});
  return { made, m, v, state, paint: () => paint(m), art(value) { art = value; }, episode(value) { ep = value; }, shown: () => [...v.bg.querySelectorAll('.aw-bg-img')].map(i => i.src) };
}
const tick = async (ms = 2) => vi.advanceTimersByTimeAsync(ms);
const low = { episodes: { 1: { image: 'https://img/ep1-low.jpg' }, 2: { image: 'https://img/ep2-low.jpg' } } };

it('requeues a preempted valid poster when newly arrived preferred backgrounds fail', async () => {
  const t = setup({ look: 'core', banner: null });
  t.paint();
  const firstPoster = t.made[0];
  t.m.banner = 'https://img/broken-banner.jpg';
  t.paint();
  t.art({ imdb: 'tt123' });
  t.paint();
  expect(firstPoster.getAttribute('src')).toBeNull();
  t.made.find(im => im.src === t.m.banner).onerror();
  t.made.find(im => im.src.includes('/background/large/')).onerror();
  t.made.find(im => im.src.includes('/background/medium/')).onerror();
  await tick();
  const retriedPoster = t.made.find(im => im !== firstPoster && im.src === t.m.poster);
  expect(retriedPoster).toBeTruthy();
  retriedPoster.onload();
  await tick(700);
  expect(t.shown()).toEqual([t.m.poster]);
  expect(t.v.heroLoad.attempts).toBeLessThanOrEqual(8);
});

it('starts a clear banner immediately in episode mode while metadata is pending', () => {
  const t = setup(); t.paint();
  expect(t.made.map(i => i.src)).toEqual(['https://img/banner.jpg']);
  expect(t.made[0].className).not.toContain('--poster');
  expect(t.v.hero.classList.contains('amb')).toBe(false);
});

it('starts the available fallback alongside preferred art with at most two loads', () => {
  const t = setup({ look: 'core', art: { imdb: 'tt123' } }); t.paint(); t.paint();
  expect(t.made.map(i => i.src)).toEqual(['https://images.metahub.space/background/large/tt123/img', 'https://img/banner.jpg']);
});

it('a delayed worse image cannot cover a decoded preferred image', async () => {
  const t = setup({ look: 'core', banner: null }); t.paint();
  const posterLoad = t.made[0].onload;
  t.art({ imdb: 'tt123' }); t.paint();
  const preferred = t.made.find(i => i.src.includes('/background/large/'));
  preferred.onload(); await tick(); posterLoad(); await tick(700);
  expect(t.shown()).toEqual([preferred.src]);
});

it('upgrades the same episode to HD after decode while keeping the old still visible', async () => {
  const t = setup({ banner: null, art: low }); t.paint(); t.made[0].onload(); await tick();
  const shown = t.made[0].src;
  t.art({ ...low, hd: { 1: { src: 'https://episodes.metahub.space/tt1/1/1/original.jpg', mid: 'https://episodes.metahub.space/tt1/1/1/w780.jpg' } } }); t.paint();
  const hd = t.made.find(i => i.src.endsWith('original.jpg'));
  expect(hd).toBeTruthy();
  let decoded; hd.decode = () => new Promise(r => { decoded = r; }); hd.onload(); await tick();
  expect(t.shown()).toEqual([shown]);
  decoded(); await tick(700);
  expect(t.shown()).toEqual([hd.src]);
});

it('an episode target change replaces the former episode instead of comparing its old quality rank', async () => {
  const t = setup({ banner: null, art: low }); t.paint(); t.made[0].onload(); await tick();
  t.episode(2); t.paint();
  const second = t.made.find(i => i.src === 'https://img/ep2-low.jpg');
  expect(second).toBeTruthy();
  second.onload(); await tick(700);
  expect(t.shown()).toEqual([second.src]);
});

it('a stalled source moves to its fallback after a bounded attempt and cannot revive later', async () => {
  const t = setup({ look: 'core', banner: null, poster: null, art: { imdb: 'tt123' } }); t.paint();
  const late = t.made[0].onload;
  await tick(6001);
  const medium = t.made.find(i => i.src.includes('/background/medium/'));
  expect(medium).toBeTruthy();
  medium.onload(); await tick(); late(); await tick(700);
  expect(t.shown()).toEqual([medium.src]);
});

it('callbacks from a previous view cannot append into either current or old heroes', async () => {
  const t = setup(); t.paint(); const old = t.made[0].onload;
  t.state.view = { ...t.v }; old(); await tick();
  expect(t.shown()).toEqual([]);
});

it('an earlier transition cleanup cannot remove the newer hero image', async () => {
  const t = setup({ look: 'core' }); t.paint(); t.made[0].onload(); await tick(300);
  t.art({ imdb: 'tt123' }); t.paint(); const preferred = t.made.find(i => i.src.includes('/background/large/'));
  preferred.onload(); await tick(350);
  expect(t.shown()).toContain(preferred.src);
  await tick(400); expect(t.shown()).toEqual([preferred.src]);
});

it('repeated metadata paints cannot create an unbounded queue or retry budget', () => {
  const t = setup({ look: 'core', poster: null });
  for (let i = 0; i < 20; i++) {
    t.m.banner = `https://img/banner-${i}.jpg`;
    t.paint();
    expect(t.made.filter(im => im.getAttribute('src') && im.onload).length).toBeLessThanOrEqual(2);
    for (const im of [...t.made]) im.onerror?.();
  }
  expect(t.made).toHaveLength(8);
});
