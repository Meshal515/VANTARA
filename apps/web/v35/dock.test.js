import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { ORDER, T, adjacent, admit, createDock, createLayers, easeInOut, easeOut, layerFrame, layerPlan, optionRects, settledSection, targetCover } from './dock.js';

// ساعة يدوية لـ rAF والمؤقتات: كل إطار تقدّمه الاختبارات بنفسها
let clock, frames, timers;
const tick = (ms) => {
  const end = clock + ms;
  while (clock < end) {
    clock = Math.min(end, clock + 16);
    const due = frames.splice(0);
    for (const f of due) f(clock);
    for (const t of [...timers]) if (t.at <= clock) { timers.delete(t); t.fn(); }
  }
};
beforeEach(() => {
  clock = 0; frames = []; timers = new Set();
  globalThis.requestAnimationFrame = (f) => frames.push(f);
  globalThis.performance = { now: () => clock };
  globalThis.setTimeout = (fn, ms) => { const t = { fn, at: clock + ms }; timers.add(t); return t; };
  globalThis.clearTimeout = (t) => timers.delete(t);
  globalThis.matchMedia = () => ({ matches: false });
  const { document, window } = parseHTML('<html dir="rtl"><body><section id="home"><div id="m"></div><div id="a" hidden></div><div id="c" hidden></div></section></body></html>');
  globalThis.document = document;
  globalThis.CustomEvent = window.CustomEvent;
});
afterEach(() => { delete globalThis.matchMedia; });

const views = () => ({ manga: document.getElementById('m'), anime: document.getElementById('a'), cinema: document.getElementById('c') });
const xOf = (el) => Number(/translate3d\((-?[\d.]+)%/.exec(el.style.transform)?.[1] ?? 0);

describe('layer model', () => {
  it('keeps the fixed order: cinema over anime over manga', () => {
    expect(ORDER).toEqual(['manga', 'anime', 'cinema']);
    expect(adjacent('manga', 1)).toBe('anime');
    expect(adjacent('cinema', 1)).toBeNull();
    expect(adjacent('manga', -1)).toBeNull();
  });

  it('every pair moves in its own direction with its own timing', () => {
    for (const [from, to, up] of [['manga', 'anime', true], ['anime', 'cinema', true], ['manga', 'cinema', true], ['anime', 'manga', false], ['cinema', 'anime', false], ['cinema', 'manga', false]]) {
      const plan = layerPlan(from, to);
      expect(plan.up, `${from}→${to}`).toBe(up);
      expect(plan.duration).toBe(up ? T.enter : T.exit);
      expect(plan.ease).toBe(up ? easeOut : easeInOut);
      expect(plan.shown).toEqual([from, to]);
    }
  });

  it('going up: the new layer enters from the left, the current one shifts 22% right and dims to 55%', () => {
    const half = layerFrame({ manga: 1, anime: 0.5 });
    expect(half.anime.x).toBeCloseTo(-50);
    expect(half.manga.x).toBeCloseTo(11);
    expect(half.manga.dim).toBeCloseTo(0.275);
    expect(half.anime.edge).toBe(1);
    const done = layerFrame({ manga: 1, anime: 1 });
    expect(done.anime.x).toBe(0);
    expect(done.manga.x).toBeCloseTo(22);
    expect(done.manga.dim).toBeCloseTo(0.55);
    expect(done.anime.edge).toBe(0);
    expect(done.anime.z).toBeGreaterThan(done.manga.z);
  });

  it('going down: the current layer withdraws left and reveals what is under it', () => {
    const start = admit({ cinema: 1 }, 'manga');
    expect(start).toEqual({ cinema: 1, manga: 1 });
    const goal = targetCover(start, 'manga');
    expect(goal).toEqual({ cinema: 0, manga: 1 });
    expect(settledSection(goal)).toBe('manga');
  });

  it('a manga↔cinema jump is one motion: anime is never part of it', () => {
    expect(Object.keys(targetCover(admit({ manga: 1 }, 'cinema'), 'cinema')).sort()).toEqual(['cinema', 'manga']);
    expect(Object.keys(targetCover(admit({ cinema: 1 }, 'manga'), 'manga')).sort()).toEqual(['cinema', 'manga']);
    const v = views();
    const layers = createLayers({ views: v, host: document.getElementById('home'), current: 'manga' });
    layers.go('cinema');
    for (let i = 0; i < 30; i++) { tick(16); expect(v.anime.hidden).toBe(true); }
    expect(layers.section).toBe('cinema');
    expect(v.manga.hidden).toBe(true);
    expect(v.cinema.hidden).toBe(false);
    expect(v.cinema.style.transform).toBe('');
  });

  it('a new choice mid-motion continues from where the layer is: no jump, no stacking', () => {
    const v = views();
    const layers = createLayers({ views: v, host: document.getElementById('home'), current: 'manga' });
    layers.go('anime');
    tick(80);
    const before = xOf(v.anime);
    expect(before).toBeLessThan(0);
    expect(before).toBeGreaterThan(-100);
    layers.go('manga');
    tick(16);
    const after = xOf(v.anime);
    expect(Math.abs(after - before)).toBeLessThan(12); // يكمل من موضعه
    expect(after).toBeLessThan(before); // ويرجع يسارًا
    tick(600);
    expect(layers.section).toBe('manga');
    expect(v.anime.hidden).toBe(true);
    expect(document.querySelectorAll('.layer-dim').length).toBe(0);
    expect(document.getElementById('home').classList.contains('layering')).toBe(false);
  });

  it('finishes even if animation frames stop (WebView paused)', () => {
    const v = views();
    const layers = createLayers({ views: v, host: document.getElementById('home'), current: 'manga' });
    globalThis.requestAnimationFrame = () => {};
    layers.go('anime');
    tick(T.enter + 200);
    expect(layers.section).toBe('anime');
    expect(v.manga.hidden).toBe(true);
  });

  it('reduced motion is a quick fade without movement', () => {
    globalThis.matchMedia = () => ({ matches: true });
    const v = views();
    const layers = createLayers({ views: v, host: document.getElementById('home'), current: 'manga' });
    layers.go('cinema');
    tick(48);
    expect(v.cinema.style.transform).toBe('');
    expect(Number(v.cinema.style.opacity)).toBeGreaterThan(0);
    expect(Number(v.cinema.style.opacity)).toBeLessThan(1);
    tick(T.reduced + 32);
    expect(layers.section).toBe('cinema');
  });

  it('a released drag below the threshold snaps back to the section it started from', () => {
    const v = views();
    const layers = createLayers({ views: v, host: document.getElementById('home'), current: 'anime' });
    v.anime.hidden = false; v.manga.hidden = true;
    layers.drag('cinema', 0.2);
    expect(xOf(v.cinema)).toBeCloseTo(-80);
    layers.release(false);
    tick(600);
    expect(layers.section).toBe('anime');
    expect(v.cinema.hidden).toBe(true);
  });
});

describe('switcher geometry', () => {
  it('closed: three 10px squares 5px apart, centred on the switcher, manga on the right', () => {
    const r = optionRects(336, 56, 168, 0);
    expect(r.map((x) => x.id)).toEqual(['manga', 'anime', 'cinema']);
    for (const x of r) { expect(x.width).toBe(10); expect(x.height).toBe(10); expect(x.radius).toBe(3); expect(x.top).toBe(23); }
    expect(r[1].left + 5).toBe(168);
    expect(r[0].left - (r[1].left + 10)).toBe(5);
    expect(r[0].left).toBeGreaterThan(r[2].left);
  });
  it('open: three buttons across the bar, 6px margin, 6px gaps, 44px tall; labels after 55%', () => {
    const r = optionRects(336, 56, 168, 1);
    const w = (336 - 12 - 12) / 3;
    expect(r[2].left).toBeCloseTo(6);
    expect(r[0].left + r[0].width).toBeCloseTo(330);
    expect(r[1].left - (r[2].left + w)).toBeCloseTo(6);
    for (const x of r) { expect(x.width).toBeCloseTo(w); expect(x.height).toBe(44); expect(x.radius).toBe(22); expect(x.top).toBe(6); expect(x.label).toBeCloseTo(1); }
    expect(optionRects(336, 64, 168, 0.5)[0].label).toBe(0);
    expect(optionRects(336, 64, 168, 0.6)[0].label).toBeGreaterThan(0);
  });
});

describe('switcher', () => {
  const mount = () => {
    document.body.innerHTML = `<div id="scrim" hidden></div><nav class="dock" id="bar"><div class="dock-half"><button class="nav">a</button></div><button class="dock-switch" aria-expanded="false"></button><div class="dock-half"><button class="nav">b</button></div><div class="dock-options" inert aria-hidden="true">${ORDER.map((id) => `<button class="dock-opt" data-arg="${id}" tabindex="-1"></button>`).join('')}</div></nav>`;
    return createDock({ bar: document.getElementById('bar'), scrim: document.getElementById('scrim'), current: 'anime' });
  };
  it('opens with aria-expanded, disables the four buttons, and marks the current section', () => {
    const dock = mount();
    const sw = document.querySelector('.dock-switch');
    expect(sw.getAttribute('aria-label')).toContain('أنمي');
    dock.open();
    expect(sw.getAttribute('aria-expanded')).toBe('true');
    expect([...document.querySelectorAll('.dock-half')].every((h) => h.hasAttribute('inert'))).toBe(true);
    expect(document.querySelector('.dock-options').hasAttribute('inert')).toBe(false);
    expect(document.getElementById('scrim').hidden).toBe(false);
    expect(document.querySelector('[data-arg="anime"]').getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-arg="anime"]').getAttribute('tabindex')).toBe('0');
    tick(T.open + 20);
    dock.close();
    expect(document.getElementById('scrim').style.pointerEvents).toBe('none'); // فورًا، قبل التلاشي
    tick(T.close + 20);
    expect(sw.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('scrim').hidden).toBe(true);
    expect(document.querySelector('.dock-options').hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.dock-half').hasAttribute('inert')).toBe(false);
  });
  it('a new section updates the marks without opening', () => {
    const dock = mount();
    dock.setSection('cinema');
    expect(document.querySelector('[data-arg="cinema"]').classList.contains('current')).toBe(true);
    expect(document.querySelector('[data-arg="anime"]').classList.contains('current')).toBe(false);
    expect(dock.isOpen()).toBe(false);
  });
});
