import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { DIM, ORDER, SHIFT, T, adjacent, sampleAt, springPath, stretchOf, admit, createDock, createLayers, easeInOut, easeOut, layerFrame, layerPlan, optionRects, settledSection, targetCover } from './dock.js';

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

  it('going up: the new layer enters from the left, the current one shifts a little right and dims lightly', () => {
    const half = layerFrame({ manga: 1, anime: 0.5 });
    expect(half.anime.x).toBeCloseTo(-50);
    expect(half.manga.x).toBeCloseTo(SHIFT / 2);
    expect(half.manga.dim).toBeCloseTo(DIM / 2);
    expect(half.anime.edge).toBe(0); // بلا ظل حافة: لا إحساس بطبقتين
    const done = layerFrame({ manga: 1, anime: 1 });
    expect(done.anime.x).toBe(0);
    expect(done.manga.x).toBeCloseTo(SHIFT);
    expect(done.manga.dim).toBeCloseTo(DIM);
    expect(SHIFT).toBeLessThanOrEqual(10);
    expect(DIM).toBeLessThanOrEqual(0.2);
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
    expect(v.cinema.style.transform).not.toContain('%'); // بلا حركة أفقية
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

describe('smoothness: compositor-only motion', () => {
  const capture = (els) => {
    const calls = [];
    for (const el of els) el.animate = (keys, opts) => { calls.push({ el, keys, opts }); return { cancel() {}, set onfinish(f) { this.f = f; } }; };
    return calls;
  };
  it('section layers hand transform/opacity keyframes to the compositor, nothing that needs layout', () => {
    const v = views();
    const layers = createLayers({ views: v, host: document.getElementById('home'), current: 'manga' });
    layers.prepare(); // ينشئ لا شيء متحركًا
    // عناصر التعتيم والظل تُنشأ عند التركيب: اعترض animate على النموذج كله
    const calls = [];
    const proto = Object.getPrototypeOf(v.manga);
    proto.animate = function (keys, opts) { calls.push({ el: this, keys, opts }); return { cancel() {}, set onfinish(f) {} }; };
    try {
      layers.go('anime');
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        for (const k of c.keys) for (const prop of Object.keys(k)) expect(['transform', 'opacity', 'offset']).toContain(prop);
        expect(c.opts.fill).toBe('both');
        expect(c.opts.easing).toMatch(/cubic-bezier/);
      }
      expect(calls.some((c) => c.el === v.anime)).toBe(true);
      expect(calls.some((c) => c.el === v.manga)).toBe(true);
      expect(calls.some((c) => c.el === v.cinema)).toBe(false); // القفز لا يلمس غير الطرفين
      tick(T.enter + 200); // المهلة الاحتياطية تنهي الحركة إن لم يصل onfinish
      expect(layers.section).toBe('anime');
    } finally { delete proto.animate; }
  });
  it('opening the switcher prepares the other sections laid out but invisible, and closing without a choice releases them', () => {
    const v = views();
    const layers = createLayers({ views: v, host: document.getElementById('home'), current: 'manga' });
    layers.prepare();
    expect(v.anime.hidden).toBe(false);
    expect(v.anime.classList.contains('layer-standby')).toBe(true);
    expect(v.manga.classList.contains('layer-standby')).toBe(false);
    layers.unprepare();
    expect(v.anime.hidden).toBe(true);
    expect(v.anime.classList.contains('layer-standby')).toBe(false);
    expect(document.getElementById('home').classList.contains('layer-ready')).toBe(false);
  });
  it('a prepared section enters without leaving the others standing by', () => {
    const v = views();
    const layers = createLayers({ views: v, host: document.getElementById('home'), current: 'manga' });
    layers.prepare();
    layers.go('cinema');
    expect(v.anime.hidden).toBe(true);
    expect(v.cinema.classList.contains('layer-standby')).toBe(false);
    tick(600);
    expect(layers.section).toBe('cinema');
  });
});

describe('glass bead physics', () => {
  it('settles exactly on the target with only a small overshoot, in well under half a second', () => {
    const path = springPath(300, 0, 40);
    const end = path[path.length - 1];
    expect(end.x).toBe(40);
    expect(end.v).toBe(0);
    expect(end.t).toBeLessThan(560);
    const overshoot = Math.max(0, ...path.map((p) => 40 - p.x));
    expect(overshoot).toBeGreaterThan(0); // حيّة: تتجاوز قليلًا وترجع
    expect(overshoot).toBeLessThan(8); // بلا اهتزاز مبالغ فيه
  });
  it('a new tap mid-flight continues from the current position and speed (no jump, no stop)', () => {
    const first = springPath(300, 0, 40);
    const mid = sampleAt(first, 90);
    expect(mid.x).toBeLessThan(300);
    expect(mid.x).toBeGreaterThan(40);
    expect(mid.v).toBeLessThan(0); // متجهة يسارًا
    const second = springPath(mid.x, mid.v, 240);
    expect(second[0].x).toBe(mid.x);
    expect(second[0].v).toBe(mid.v); // السرعة نفسها: الانعطاف ناعم
    expect(second[second.length - 1].x).toBe(240);
  });
  it('a throw carries its release velocity', () => {
    const still = springPath(100, 0, 200);
    const thrown = springPath(100, 2, 200);
    expect(sampleAt(thrown, 40).x).toBeGreaterThan(sampleAt(still, 40).x);
  });
  it('stretches along its motion with its speed and keeps its volume', () => {
    expect(stretchOf(0)).toEqual({ sx: 1, sy: 1 });
    const fast = stretchOf(2);
    expect(fast.sx).toBeGreaterThan(1.2);
    expect(fast.sx).toBeLessThanOrEqual(1.42);
    expect(fast.sx * fast.sy * fast.sy).toBeCloseTo(1); // sx·sy² ثابت تقريبًا
    expect(stretchOf(-2)).toEqual(fast);
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
