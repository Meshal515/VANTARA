import { expect, it, vi, afterEach } from 'vitest';
import { parseHTML } from 'linkedom';
import { mountLogoLayer, transparentLogoPixels } from './logo-layer.js';

afterEach(() => vi.unstubAllGlobals());
const make = () => {
  const { document } = parseHTML('<html><body><div id="host"><div class="wl-head"><div class="wl-logo-layer" hidden><div class="wl-logo-entry"><span class="wl-logo-train"><span class="wl-logo-group"><img src="logo.png"></span><span class="wl-logo-group"><img src="logo.png"></span></span></div></div><div class="wl-info"></div></div></div></body></html>');
  let hidden = false, width = 390, infoRight = 150;
  Object.defineProperty(document, 'hidden', { get: () => hidden });
  const host = document.querySelector('#host'), layer = host.querySelector('.wl-logo-layer'), train = host.querySelector('.wl-logo-train'), image = train.querySelector('img');
  Object.defineProperties(image, { naturalWidth: { value: 800 }, naturalHeight: { value: 310 } });
  const rect = (left, right, top = 0, bottom = 48) => ({ left, right, top, bottom, width: right - left, height: bottom - top });
  layer.getBoundingClientRect = () => rect(0, width);
  host.querySelector('.wl-head').getBoundingClientRect = () => rect(0, width);
  host.querySelector('.wl-info').getBoundingClientRect = () => rect(20, infoRight);
  const animations = [];
  train.animate = vi.fn((frames, timing) => {
    const a = { frames, timing, currentTime: 0, playState: 'running', pause: vi.fn(function () { this.playState = 'paused'; }), play: vi.fn(function () { this.playState = 'running'; }), cancel: vi.fn(function () { this.playState = 'idle'; }), finish() { this.currentTime = timing.duration; this.playState = 'finished'; this.onfinish?.(); } };
    animations.push(a); return a;
  });
  const mq = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => mq);
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: key => key === '--wl-logo-gap' ? '48px' : '', columnGap: '48px' }));
  let intersection, resize;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { constructor(fn) { intersection = fn; } observe() {} disconnect = disconnect; });
  vi.stubGlobal('ResizeObserver', class { constructor(fn) { resize = fn; } observe() {} disconnect = disconnect; });
  return { document, host, layer, train, image, animations, mq, disconnect,
    load: () => image.dispatchEvent(new document.defaultView.Event('load')),
    hide: value => { hidden = value; document.dispatchEvent(new document.defaultView.Event('visibilitychange')); },
    intersect: value => intersection([{ isIntersecting: value }]),
    motion: value => { mq.matches = value; mq.addEventListener.mock.calls[0][1](); },
    resize: value => { width = value; vi.stubGlobal('innerWidth', value); resize(); },
    info: value => { infoRight = value; host._updateLogoLayer(); },
  };
};
const x = frame => Number(/translate3d\(([-\d.]+)px/.exec(frame.transform)[1]);
const velocity = a => (x(a.frames[0]) - x(a.frames[1])) / (a.timing.duration / 1000);

it('rejects opaque or empty art and accepts visible ink with real transparency', () => {
  expect(transparentLogoPixels(new Uint8ClampedArray(400).fill(255))).toBe(false);
  expect(transparentLogoPixels(new Uint8ClampedArray(400))).toBe(false);
  const pixels = new Uint8ClampedArray(400); pixels.fill(255, 200);
  expect(transparentLogoPixels(pixels)).toBe(true);
});

it('starts the actual first logo just beyond the right edge and keeps the same 12px/s through repetition', () => {
  const t = make(); mountLogoLayer(t.host, { validate: () => true }); t.load();
  expect(t.animations).toHaveLength(1);
  const entry = t.animations[0];
  expect(x(entry.frames[0])).toBe(398);
  expect(x(entry.frames[1])).toBe(0);
  expect(entry.timing.easing).toBe('linear');
  expect(velocity(entry)).toBeCloseTo(12, 10);
  entry.finish();
  const loop = t.animations[1];
  expect(loop.timing.iterations).toBe(Infinity);
  expect(loop.timing.easing).toBe('linear');
  expect(velocity(loop)).toBeCloseTo(12, 10);
  expect(x(loop.frames[0])).toBe(x(entry.frames[1]));
  const groups = t.train.querySelectorAll('.wl-logo-group');
  expect(groups[0].innerHTML).toBe(groups[1].innerHTML);
  expect(-x(loop.frames[1])).toBeCloseTo(Number.parseFloat(t.layer.style.getPropertyValue('--wl-logo-period')));
  expect(t.layer.hidden).toBe(false);
});

it('uses natural logo bounds with a 40–64px gap and enough repeated tiles to cover a desktop corridor', () => {
  const t = make(); mountLogoLayer(t.host, { validate: () => true }); t.load(); t.resize(1440);
  const width = Number.parseFloat(t.layer.style.getPropertyValue('--wl-logo-width'));
  expect(width).toBeCloseTo(48 * .86 * 800 / 310, 1);
  const period = Number.parseFloat(t.layer.style.getPropertyValue('--wl-logo-period'));
  const count = t.train.querySelector('.wl-logo-group').children.length;
  expect(period).toBeCloseTo(count * (width + 64));
  expect(period).toBeGreaterThanOrEqual(1440 + width);
  expect(period - 1440).toBeLessThan(2 * (width + 64));
});

it('pauses and resumes the entrance and loop at the same active position when hidden, out of view, or reduced', () => {
  const t = make(); const off = mountLogoLayer(t.host, { validate: () => true }); t.load();
  const entry = t.animations[0]; entry.currentTime = 2500;
  for (const pause of [t.hide, value => t.intersect(!value), t.motion]) {
    pause(true); expect(entry.playState).toBe('paused'); expect(t.layer.dataset.running).toBe('false');
    expect(entry.currentTime).toBe(2500);
    pause(false); expect(entry.playState).toBe('running'); expect(entry.currentTime).toBe(2500);
  }
  entry.finish(); const loop = t.animations[1]; loop.currentTime = 1300;
  t.hide(true); t.hide(false); expect(loop.currentTime).toBe(1300); expect(loop.playState).toBe('running');
  off(); expect(loop.cancel).toHaveBeenCalled(); expect(t.disconnect).toHaveBeenCalledTimes(2);
  expect(t.host._updateLogoLayer).toBeUndefined(); expect(t.mq.removeEventListener).toHaveBeenCalled();
});

it('keeps the current translation through resize and only refreshes the desktop title exclusion for metadata', () => {
  const t = make(); mountLogoLayer(t.host, { validate: () => true }); t.load();
  t.animations[0].currentTime = 2500;
  t.resize(1440);
  const resized = t.animations.at(-1);
  expect(x(resized.frames[0])).toBe(368);
  expect(velocity(resized)).toBeCloseTo(12, 10);
  const count = t.animations.length;
  t.info(420);
  expect(t.animations).toHaveLength(count);
  expect(Number.parseFloat(t.layer.style.getPropertyValue('--wl-logo-fade-start'))).toBeGreaterThan(420);
  expect(Number.parseFloat(t.layer.style.getPropertyValue('--wl-logo-fade-end'))).toBeGreaterThan(480);
});

it('anchors the first visible logo when a responsive loop is resized', () => {
  const t = make(); mountLogoLayer(t.host, { validate: () => true }); t.load();
  t.animations[0].finish(); const loop = t.animations[1]; loop.currentTime = 13450;
  const oldWidth = Number.parseFloat(t.layer.style.getPropertyValue('--wl-logo-width'));
  const oldStride = oldWidth + Number.parseFloat(t.layer.style.getPropertyValue('--wl-logo-gap'));
  let before = -161.4;
  while (before + oldWidth <= 0) before += oldStride;
  t.resize(1440);
  const resized = t.animations.at(-1);
  const newStride = oldWidth + Number.parseFloat(t.layer.style.getPropertyValue('--wl-logo-gap'));
  let after = x(resized.frames[0]);
  while (after + oldWidth <= 0) after += newStride;
  expect(after).toBeCloseTo(before);
  expect(velocity(resized)).toBeCloseTo(12, 10);
  expect(resized.timing.iterations).toBe(Infinity);
});

it('does not reveal until decoded, and cannot revive a disposed or subsequently failed logo', async () => {
  const t = make(); let resolveDecode;
  t.image.decode = vi.fn(() => new Promise(resolve => { resolveDecode = resolve; }));
  const off = mountLogoLayer(t.host, { validate: () => true }); t.load(); await Promise.resolve();
  expect(t.layer.hidden).toBe(true); expect(t.animations).toHaveLength(0);
  off(); resolveDecode(); await Promise.resolve(); await Promise.resolve();
  expect(t.layer.hidden).toBe(true); expect(t.animations).toHaveLength(0);
  const u = make(); let decoded;
  u.image.decode = () => new Promise(resolve => { decoded = resolve; });
  mountLogoLayer(u.host, { validate: () => true }); u.load(); await Promise.resolve();
  u.image.dispatchEvent(new u.document.defaultView.Event('error')); decoded(); await Promise.resolve(); await Promise.resolve();
  expect(u.layer.hidden).toBe(true);
});

it('keeps rejected or failed artwork hidden while the ordinary title image is independent', () => {
  const t = make(); mountLogoLayer(t.host, { validate: () => false }); t.load();
  expect(t.layer.hidden).toBe(true); expect(t.animations).toHaveLength(0);
  expect(t.layer.dataset.running).toBe('false');
});

it('refreshes only the title mask for a root direction change and disconnects its narrow observer', () => {
  const t = make(); let changed; const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('MutationObserver', class { constructor(fn) { changed = fn; } observe = observe; disconnect = disconnect; });
  const off = mountLogoLayer(t.host, { validate: () => true }); t.load(); t.resize(1440);
  const clock = t.animations.at(-1); clock.currentTime = 1234;
  const count = t.animations.length;
  t.host.querySelector('.wl-info').getBoundingClientRect = () => ({ left: 1020, right: 1350 });
  changed();
  expect(observe).toHaveBeenCalledWith(t.document.documentElement, { attributes: true, attributeFilter: ['dir'] });
  expect(t.animations).toHaveLength(count); expect(clock.currentTime).toBe(1234);
  expect(Number.parseFloat(t.layer.style.getPropertyValue('--wl-logo-fade-out-end'))).toBe(1004);
  off(); expect(disconnect).toHaveBeenCalledOnce();
});
