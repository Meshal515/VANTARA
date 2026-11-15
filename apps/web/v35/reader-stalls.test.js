import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { detectStall, FRAME_GAP_MS, HOLD_FRAMES } from './reader-stalls.js';

// [t, scrollTop, finger]: 60 fps, momentum moving down 30 px per frame
const moving = (from, count, t0 = 0, top0 = 0) => Array.from({ length: count }, (_, i) => [t0 + (from + i) * 16.7, top0 + (from + i) * 30, false]);

describe('detectStall', () => {
  it('a frame that comes late while scrolling is a drawing freeze, with how far the page jumped', () => {
    const frames = moving(0, 10);
    const [t, top] = frames.at(-1);
    frames.push([t + FRAME_GAP_MS + 30, top + 240, false]);
    expect(detectStall(frames)).toMatchObject({ kind: 'frame-gap', ms: FRAME_GAP_MS + 30, dy: 240, finger: false });
  });

  it('the position held still for frames between two movements is the scroll itself stopping', () => {
    const frames = moving(0, 10);
    const [t, top] = frames.at(-1);
    for (let k = 1; k <= HOLD_FRAMES + 1; k++) frames.push([t + k * 16.7, top, false]);
    expect(detectStall(frames)).toBe(null); // still held: not reported until it moves again
    frames.push([t + (HOLD_FRAMES + 2) * 16.7, top + 30, false]);
    expect(detectStall(frames)).toMatchObject({ kind: 'scroll-hold', frames: HOLD_FRAMES + 1, finger: false });
  });

  it('the end of a fling and a change of direction are not stalls', () => {
    const end = moving(0, 10);
    const [t, top] = end.at(-1);
    for (let k = 1; k <= 6; k++) end.push([t + k * 16.7, top, false]);
    expect(detectStall(end)).toBe(null);
    end.push([t + 7 * 16.7, top - 30, true]); // the finger pulls back up
    expect(detectStall(end)).toBe(null);
  });

  it('a one-frame pause is normal frame pacing, not a stall', () => {
    const frames = moving(0, 10);
    const [t, top] = frames.at(-1);
    frames.push([t + 16.7, top, false], [t + 33.4, top + 30, false]);
    expect(detectStall(frames)).toBe(null);
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock('../lib/diagnostics-ui.js'); vi.doUnmock('./reader-translate.js'); });

async function openReader(visible) {
  vi.useFakeTimers(); vi.resetModules();
  vi.doMock('./reader-translate.js', () => ({ createReaderTranslation: () => ({ attach() {}, openGate() {}, focus() {}, needs: () => false, enabled: () => false, isOn: () => false, destroy() {}, onImage() {} }) }));
  vi.doMock('../lib/diagnostics-ui.js', () => ({ diagnosticsUi: { initialize: async () => {}, visible: () => visible, available: () => visible } }));
  const { window, document } = parseHTML('<html><body></body></html>');
  document.visibilityState = 'visible';
  vi.stubGlobal('document', document); vi.stubGlobal('window', window); vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal('Image', class { constructor() { const img = document.createElement('img'); img.decode = async () => {}; img.naturalWidth = 800; img.naturalHeight = 7000; return img; } });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.HTMLElement.prototype.scrollTo = function ({ top = 0 }) { this.scrollTop = top; };
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 844, height: 844 });
  let frames = 0;
  vi.stubGlobal('requestAnimationFrame', (fn) => { frames++; return setTimeout(() => fn(performance.now()), 16); }); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const engine = { pages: async () => Array.from({ length: 4 }, (_, i) => ({ url: `p${i}` })), pageImage: async (_s, page) => ({ src: `img:${page.url}` }) };
  const row = { number: 1, sourceId: 'A', chapter: { url: '/1', name: 'Chapter 1' } };
  const { openSmartReader } = await import('./reader.js');
  const reader = openSmartReader({ sync: { user: { userId: 'u' }, rows: () => [], enqueue() {} }, engine, mount: (n) => document.body.append(n), exit() {} },
    { title: 'W', seriesRef: 'w', rows: [row], row, work: null });
  for (let n = 0; n < 20; n++) await vi.advanceTimersByTimeAsync(50);
  return { reader, document, frames: () => frames };
}

describe('the stall recorder in the reader', () => {
  it('does not exist for a reader without Debug diagnostics: no counter, no extra frame loop', async () => {
    const { reader, document, frames } = await openReader(false);
    expect(document.querySelector('#rdStalls').hidden).toBe(true);
    const before = frames();
    await vi.advanceTimersByTimeAsync(500);
    expect(frames() - before).toBeLessThan(5); // no per-frame recorder loop
    reader.destroy();
  });

  it('with diagnostics visible it counts a momentum stall and reports what landed just before it', async () => {
    const { reader, document } = await openReader(true);
    const badge = document.querySelector('#rdStalls');
    expect(badge.hidden).toBe(false);
    const scroll = document.querySelector('#rdScroll');
    // momentum: moving, then the position holds for 5 frames, then moves on
    for (let n = 1; n <= 10; n++) { scroll.scrollTop = n * 30; await vi.advanceTimersByTimeAsync(16); }
    await vi.advanceTimersByTimeAsync(16 * 5);
    scroll.scrollTop += 30; await vi.advanceTimersByTimeAsync(32);
    expect(badge.textContent).toMatch(/وقفات [1-9]/);
    reader.destroy();
  });
});

describe('the report', () => {
  it('puts the app main-thread block that overlaps a stall next to that stall', async () => {
    const { createStallRecorder } = await import('./reader-stalls.js');
    let t = 0; const queue = [];
    const scroll = { scrollTop: 0, addEventListener() {}, removeEventListener() {} };
    const rec = createStallRecorder({ scroll, page: () => ({ index: 4, total: 40 }), now: () => t, raf: (fn) => queue.push(fn), caf() {}, Observer: class { observe() {} disconnect() {} } });
    const frame = () => { t += 16; queue.shift()(t); };
    for (let n = 0; n < 10; n++) { scroll.scrollTop += 30; frame(); }
    const held = t;
    for (let n = 0; n < 5; n++) frame();
    scroll.scrollTop += 30; frame();
    const text = rec.report([{ start: held - 10, end: held + 70, ms: 80, what: 'Handler (android.os.Handler) UsagePlugin$tick', stack: ['UsageJournal.save:30'] }]);
    expect(text).toMatch(/وقف التمرير/);
    expect(text).toMatch(/أثناء الزخم، صفحة 5\/40/);
    expect(text).toMatch(/الخيط الرئيسي 80ms Handler \(android.os.Handler\) UsagePlugin\$tick ← UsageJournal.save:30/);
    rec.stop();
  });
});
