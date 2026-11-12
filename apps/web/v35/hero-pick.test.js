import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
import { episodeStill } from '../lib/anime-art.js';

// بطل صفحة عمل الأنمي: يُحسم المصدر النهائي قبل العرض (لا أولي ثم ثانٍ ثم نهائي)، وتلاشٍ واحد على الأكثر.
// نفس طريقة anime-hero-scheduler.test.js: تشغيل paintHero الحقيقي على حدود الصور والـDOM.
const source = readFileSync(new URL('./anime.js', import.meta.url), 'utf8');
const a = source.indexOf('  function paintHero(');
const b = source.indexOf('  async function seriesBackdrop(', a);
const make = new Function('state', 'artOf', 'resumePoint', 'heroPlan', 'episodeStill', 'heroMemory', 'seriesBackdrop', 'paintLook', 'settleWork', `${source.slice(a, b)}; return paintHero;`);
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup({ look = 'core', banner = 'https://img/banner.jpg', poster = 'https://img/poster.jpg', remembered = null } = {}) {
  vi.useFakeTimers();
  const { document } = parseHTML('<html><body><div class="aw-hero"><div class="aw-bg"></div></div></body></html>');
  vi.stubGlobal('document', document);
  const made = [];
  vi.stubGlobal('Image', function () { const n = document.createElement('img'); n.decode = () => Promise.resolve(); made.push(n); return n; });
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  const memory = new Map(remembered ? [[1, remembered]] : []);
  const m = { id: 1, poster, banner };
  const v = { id: 1, look, artSettled: true, artDone: false, heroTried: new Set(), heroRank: Infinity, heroShownRank: Infinity, hero: document.querySelector('.aw-hero'), bg: document.querySelector('.aw-bg') };
  let art = null;
  const state = { detail: m, view: v };
  const paint = make(state, () => art, () => ({ episode: 1 }), (name) => ({ episodeStill: name === 'episode', posterFallback: name !== 'episode', ambient: name !== 'episode' }), episodeStill, { get: (id) => memory.get(id) ?? null, set: (id, src) => memory.set(id, src) }, async () => null, () => {}, () => {});
  const shown = () => [...v.bg.querySelectorAll('.aw-bg-img')].map((i) => i.src);
  return { made, m, v, memory, shown, paint: () => paint(m), art(value) { art = value; v.artDone = true; } };
}
const tick = (ms = 2) => vi.advanceTimersByTimeAsync(ms);

it('holds an early worse image until the better source resolves: one image, one fade', async () => {
  const t = setup();
  t.paint();
  expect(t.v.hero.classList.contains('aw-wait')).toBe(true);
  // البنر والغلاف جاهزان مبكرًا، والفن لم يصل: لا يُعرض شيء بعد
  for (const im of [...t.made]) im.onload();
  await tick();
  expect(t.shown()).toEqual([]);
  t.art({ imdb: 'tt1' });
  t.paint();
  const large = t.made.find((i) => i.src.includes('/background/large/'));
  large.onload();
  await tick(700);
  expect(t.shown()).toEqual([large.src]);
  expect(t.v.hero.classList.contains('aw-wait')).toBe(false);
  expect(t.memory.get(1)).toBe(large.src);
});

it('after the deadline shows the best ready image, and a later better one is saved, not swapped', async () => {
  const t = setup();
  t.paint();
  const banner = t.made.find((i) => i.src === t.m.banner);
  banner.onload();
  await tick(2600);
  expect(t.shown()).toEqual([t.m.banner]);
  t.art({ imdb: 'tt1' });
  t.paint();
  t.made.find((i) => i.src.includes('/background/large/')).onload();
  await tick(700);
  expect(t.shown()).toEqual([t.m.banner]);
  expect(t.memory.get(1)).toContain('/background/large/tt1');
});

it('the remembered choice for this work is displayed as soon as it decodes', async () => {
  const t = setup({ remembered: 'https://images.metahub.space/background/large/tt9/img' });
  t.paint();
  t.made.find((i) => i.src.includes('tt9')).onload();
  await tick(700);
  expect(t.shown()).toEqual(['https://images.metahub.space/background/large/tt9/img']);
});

it('falls back to the best ready image once every better source failed', async () => {
  const t = setup({ banner: null });
  t.paint();
  t.art({ imdb: 'tt1' });
  t.paint();
  const poster = t.made.find((i) => i.src === t.m.poster);
  poster.onload();
  await tick();
  expect(t.shown()).toEqual([]);
  // الخلفيتان تُجرَّبان تباعًا (حانتان على الأكثر) وتفشلان
  for (let i = 0; i < 3; i++) {
    for (const im of t.made.filter((x) => x.src.includes('metahub') && x.onerror)) im.onerror();
    await tick();
  }
  await tick(700);
  expect(t.shown()).toEqual([t.m.poster]);
});
