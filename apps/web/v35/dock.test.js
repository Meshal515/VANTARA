import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { DIM, ORDER, SHIFT, T, adjacent, sampleAt, springPath, stretchOf, admit, createDock, createLayers, easeInOut, easeOut, layerFrame, layerPlan, settledSection, targetCover } from './dock.js';

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
    expect(half.anime.edge).toBeUndefined(); // بلا ظل حافة: لا إحساس بطبقتين
    const done = layerFrame({ manga: 1, anime: 1 });
    expect(done.anime.x).toBe(0);
    expect(done.manga.x).toBeCloseTo(SHIFT);
    expect(done.manga.dim).toBeCloseTo(DIM);
    expect(SHIFT).toBeLessThanOrEqual(10);
    expect(DIM).toBeLessThanOrEqual(0.2);
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

  it('returning to the same section restores the reader to where they were', () => {
    const v = views();
    let y = 1500;
    globalThis.scrollY = 1500;
    globalThis.scrollTo = (o) => (y = o.top);
    try {
      const layers = createLayers({ views: v, host: document.getElementById('home'), current: 'manga' });
      layers.drag('anime', 0.2);
      expect(y).toBe(0);
      layers.release(false);
      tick(800);
      expect(layers.section).toBe('manga');
      expect(y).toBe(1500);
    } finally { delete globalThis.scrollY; delete globalThis.scrollTo; }
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

  it('reduced motion switches sections instantly: no fade, no waiting', () => {
    globalThis.matchMedia = () => ({ matches: true });
    const v = views();
    const layers = createLayers({ views: v, host: document.getElementById('home'), current: 'manga' });
    layers.go('cinema'); // بلا أي tick
    expect(layers.section).toBe('cinema');
    expect(layers.moving).toBe(false);
    expect(v.cinema.hidden).toBe(false);
    expect(v.manga.hidden).toBe(true);
    expect(v.cinema.style.opacity).toBe('');
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
    expect(v.anime.hidden).toBe(true); // بقية الكود تراها مخفية (البانر لا يدور خلفها)
    expect(v.anime.classList.contains('layer-standby')).toBe(true); // وCSS يخطّطها جاهزة
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


describe('split floating navigation', () => {
  // ثلاث كبسولات بعرض 336: اليمنى 224–336 (الرئيسية واكتشف)، الوسطى، اليسرى 0–112
  const rect = (left, width, top = 700, height = 58) => () => ({ left, width, top, height, right: left + width, bottom: top + height, x: left, y: top });
  const mount = (current = 'anime') => {
    const navBtn = (page) => `<button class="nav" data-page="${page}"></button>`;
    const opt = (id) => `<button class="dock-opt" data-arg="${id}" tabindex="-1" inert aria-hidden="true"></button>`;
    document.body.innerHTML = `<div id="scrim" hidden></div><nav class="dock" id="bar">` +
      `<div class="dock-cap dock-cap--nav" id="capR"><div class="cap-body"><span class="cap-ind"></span>${navBtn('home')}${navBtn('discover')}</div>${opt('manga')}</div>` +
      `<div class="dock-cap dock-cap--switch"><button class="dock-switch" aria-expanded="false"><span class="dock-sq" data-arg="manga"></span><span class="dock-sq" data-arg="anime"></span><span class="dock-sq" data-arg="cinema"></span></button>${opt('anime')}</div>` +
      `<div class="dock-cap dock-cap--nav" id="capL"><div class="cap-body"><span class="cap-ind"></span>${navBtn('library')}${navBtn('majlis')}</div>${opt('cinema')}</div></nav>`;
    const $ = (s) => document.querySelector(s);
    $('#bar').getBoundingClientRect = rect(0, 336);
    $('#capR').getBoundingClientRect = rect(224, 112);
    $('#capL').getBoundingClientRect = rect(0, 112);
    $('[data-page="home"]').getBoundingClientRect = rect(280, 56);
    $('[data-page="discover"]').getBoundingClientRect = rect(224, 56);
    $('[data-page="library"]').getBoundingClientRect = rect(56, 56);
    $('[data-page="majlis"]').getBoundingClientRect = rect(0, 56);
    const calls = [];
    for (const ind of document.querySelectorAll('.cap-ind')) ind.animate = (keys, opts) => (calls.push({ ind, keys, opts }), { cancel() {} });
    const dock = createDock({ bar: $('#bar'), scrim: $('#scrim'), current });
    return { dock, calls, $, indR: $('#capR .cap-ind'), indL: $('#capL .cap-ind') };
  };
  const xOfInd = (el) => Number(/translate3d\((-?[\d.]+)px/.exec(el.style.transform)?.[1]) + 20;

  it('inside one capsule the circle slides as one piece from the old button to the new one', () => {
    const { dock, calls, indR, indL } = mount();
    dock.activate('home');
    expect(xOfInd(indR)).toBeCloseTo(84);
    expect(indR.style.opacity).toBe('1');
    expect(indL.style.opacity).toBe('0');
    calls.length = 0;
    dock.activate('discover');
    expect(calls).toHaveLength(1); // حركة واحدة: انزلاق، لا اختفاء وظهور
    expect(calls[0].ind).toBe(indR);
    const xs = calls[0].keys.map((k) => Number(/translate3d\((-?[\d.]+)px/.exec(k.transform)[1]) + 20);
    expect(xs[0]).toBeCloseTo(84);
    expect(xs[xs.length - 1]).toBeCloseTo(28);
    expect(Math.min(...xs)).toBeGreaterThan(28 - 8); // لا يغادر كبسولته ولا يرتد كثيرًا
    expect(xOfInd(indR)).toBeCloseTo(28);
  });

  it('between capsules the old circle shrinks in place and the new one grows in place, overlapping in time', () => {
    const { dock, calls, indR, indL } = mount();
    dock.activate('discover');
    calls.length = 0;
    dock.activate('majlis');
    const shrink = calls.find((c) => c.ind === indR);
    const grow = calls.find((c) => c.ind === indL);
    expect(shrink.keys.at(-1).opacity).toBe(0);
    expect(shrink.keys.at(-1).transform).toContain('scale(0.4');
    expect(grow.keys[0].opacity).toBe(0);
    expect(grow.keys.at(-1).opacity).toBe(1);
    // كل دائرة في مكانها: لا مسار بين الكبسولتين
    for (const k of shrink.keys) expect(Number(/translate3d\((-?[\d.]+)px/.exec(k.transform)[1]) + 20).toBeCloseTo(28);
    for (const k of grow.keys) expect(Number(/translate3d\((-?[\d.]+)px/.exec(k.transform)[1]) + 20).toBeCloseTo(28);
    // الكبر يبدأ قبل نهاية الانكماش: حركة واحدة منتقلة
    expect(grow.opts.delay).toBeLessThan(shrink.opts.duration);
    expect(indR.style.opacity).toBe('0');
    expect(indL.style.opacity).toBe('1');
  });

  it('opening the switcher turns the three capsules into sections, layers opening outward from the middle', () => {
    const { dock, $ } = mount();
    dock.open();
    tick(60); // منتصف الحركة (بلا Web Animations: بالمؤقت)
    const tx = (id) => Number(/translate3d\((-?[\d.]+)%/.exec($(`.dock-opt[data-arg="${id}"]`).style.transform)?.[1] ?? 0);
    expect(tx('manga')).toBeLessThan(0); // مانجا تأتي من اليسار نحو اليمين
    expect(tx('cinema')).toBeGreaterThan(0); // سينما من اليمين نحو اليسار
    expect($('.dock-opt[data-arg="anime"]').style.transform).toContain('scale'); // أنمي تحل محل المربعات
    tick(600);
    expect(tx('manga')).toBeCloseTo(0);
    expect($('.dock-switch').getAttribute('aria-expanded')).toBe('true');
    expect([...document.querySelectorAll('.cap-body')].every((b) => b.hasAttribute('inert'))).toBe(true);
    expect($('.dock-opt[data-arg="anime"]').hasAttribute('inert')).toBe(false);
    expect($('.dock-opt[data-arg="anime"]').classList.contains('current')).toBe(true);
    expect($('.dock-opt[data-arg="anime"]').getAttribute('tabindex')).toBe('0');
    dock.close();
    expect($('#scrim').style.pointerEvents).toBe('none'); // الإغلاق يوقف لمس الستار فورًا
    tick(600);
    expect($('#scrim').hidden).toBe(true);
    expect($('.cap-body').hasAttribute('inert')).toBe(false);
    expect($('.dock-opt[data-arg="manga"]').hasAttribute('inert')).toBe(true);
    expect($('.dock-opt[data-arg="manga"]').style.transform).toBe('');
    expect($('#bar').hasAttribute('inert')).toBe(false); // الشريط نفسه لا يتعطل بعد الإغلاق أبدًا
    expect($('.dock-switch').hasAttribute('inert')).toBe(false);
  });

  it('with animation off everything changes instantly: no motion, no waiting', () => {
    globalThis.matchMedia = () => ({ matches: true });
    const { dock, calls, $, indR, indL } = mount();
    dock.activate('home');
    dock.activate('discover');
    dock.activate('library');
    expect(calls).toHaveLength(0);
    expect(indR.style.opacity).toBe('0');
    expect(indL.style.opacity).toBe('1');
    expect(xOfInd(indL)).toBeCloseTo(84);
    dock.open(); // بلا أي tick
    expect(Number($('#scrim').style.opacity)).toBe(1);
    expect(Number($('.dock-opt[data-arg="manga"]').style.opacity)).toBe(1);
    dock.close();
    expect($('#scrim').hidden).toBe(true);
  });

  it('the app setting turns animation off as well as the system one', () => {
    document.documentElement.dataset.motion = 'off';
    try {
      const { dock, calls } = mount();
      dock.activate('home');
      dock.activate('discover');
      expect(calls).toHaveLength(0);
    } finally { delete document.documentElement.dataset.motion; }
  });

  it('rapid taps follow the last choice without stacking motions', () => {
    const { dock, indR, indL } = mount();
    dock.activate('home');
    for (const p of ['discover', 'majlis', 'library', 'home', 'majlis']) dock.activate(p);
    expect(indL.style.opacity).toBe('1');
    expect(indR.style.opacity).toBe('0');
    expect(xOfInd(indL)).toBeCloseTo(28);
  });

  it('a drag interrupted by the system neither navigates nor swallows the next tap', () => {
    const navigated = [];
    const m = mount();
    const bar = m.$('#bar');
    const dock2 = m.dock;
    dock2.activate('library');
    const E = m.$('#bar').ownerDocument.defaultView.Event;
    const ev = (type, x) => { const e = new E(type, { bubbles: true }); for (const [k, v] of Object.entries({ pointerId: 1, clientX: x, clientY: 720, button: 0 })) Object.defineProperty(e, k, { value: v }); return e; };
    m.$('#capL').dispatchEvent(ev('pointerdown', 84));
    bar.dispatchEvent(ev('pointermove', 60));
    bar.dispatchEvent(ev('pointercancel', 60));
    let swallowed = true;
    const probe = m.$('[data-page="majlis"]');
    probe.addEventListener('click', () => (swallowed = false));
    probe.dispatchEvent(new E('click', { bubbles: true, cancelable: true }));
    expect(swallowed).toBe(false);
    expect(navigated).toEqual([]);
  });

  it('a new section updates the marks without opening', () => {
    const { dock, $ } = mount();
    dock.setSection('cinema');
    expect($('.dock-opt[data-arg="cinema"]').classList.contains('current')).toBe(true);
    expect($('.dock-sq[data-arg="cinema"]').classList.contains('current')).toBe(true);
    expect($('.dock-switch').getAttribute('aria-label')).toContain('سينما');
    expect(dock.isOpen()).toBe(false);
  });
});
