import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, clampPan, clampSides, isDoubleTap, zoomAround } from './reader-zoom.js';

const base = { left: 0, top: 100, width: 390, height: 1200 };
const screenOf = (z, u) => ({ x: base.left + z.t.x + z.scale * u.x, y: base.top + z.t.y + z.scale * u.y });

describe('pinch zoom keeps the page under the fingers (owner: it zoomed the page, not where the fingers were)', () => {
  it('zooming in and out keeps the content point under the midpoint of the fingers', () => {
    const f = { x: 300, y: 500 };
    const u = { x: f.x - base.left, y: f.y - base.top }; // content under the fingers at scale 1
    let z = { scale: 1, t: { x: 0, y: 0 } };
    for (const ratio of [1.3, 1.5, 0.8, 1.2]) {
      z = zoomAround({ base, scale: z.scale, t: z.t, from: f, to: f, ratio });
      const p = screenOf(z, u);
      expect(p.x).toBeCloseTo(f.x, 6); expect(p.y).toBeCloseTo(f.y, 6);
    }
  });
  it('moving the fingers while pinching drags the page with them', () => {
    const z = zoomAround({ base, scale: 2, t: { x: -100, y: -200 }, from: { x: 200, y: 400 }, to: { x: 230, y: 380 }, ratio: 1 });
    const u = { x: (200 - base.left + 100) / 2, y: (400 - base.top + 200) / 2 };
    const p = screenOf(z, u);
    expect(p.x).toBeCloseTo(230, 6); expect(p.y).toBeCloseTo(380, 6);
  });
  it('scale stays between 1 and the maximum', () => {
    expect(zoomAround({ base, scale: 4, t: { x: 0, y: 0 }, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, ratio: 3 }).scale).toBe(ZOOM_MAX);
    expect(zoomAround({ base, scale: 1.2, t: { x: 0, y: 0 }, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, ratio: 0.1 }).scale).toBe(1);
  });
  it('starting a pinch shows the page exactly where it was (scale 1, no offset)', () => {
    const z = zoomAround({ base, scale: 1, t: { x: 0, y: 0 }, from: { x: 200, y: 300 }, to: { x: 200, y: 300 }, ratio: 1 });
    expect(z).toEqual({ scale: 1, t: { x: 0, y: 0 } });
  });
});

describe('one-finger pan stays on the page', () => {
  const view = { left: 0, top: 0, width: 390, height: 844 };
  it('cannot drag an edge into the middle of the screen', () => {
    const t = clampPan({ base, scale: 2, t: { x: 500, y: 900 }, view });
    expect(base.left + t.x).toBeLessThanOrEqual(0); // left edge still at or beyond the screen edge
    expect(base.top + t.y).toBeLessThanOrEqual(0);
    const far = clampPan({ base, scale: 2, t: { x: -5000, y: -9000 }, view });
    expect(base.left + far.x + base.width * 2).toBeGreaterThanOrEqual(390);
    expect(base.top + far.y + base.height * 2).toBeGreaterThanOrEqual(844);
  });
});

describe('pinch never slides the page off its sides (owner: at normal size two fingers moved it left/right, black at the side)', () => {
  const view = { left: 0, top: 0, width: 390, height: 844 };
  it('at normal size fingers drifting sideways do not move the page sideways', () => {
    const z = zoomAround({ base, scale: 1, t: { x: 0, y: 0 }, from: { x: 200, y: 400 }, to: { x: 120, y: 400 }, ratio: 1 });
    expect(z.t.x).not.toBe(0); // the raw pinch geometry does slide it…
    expect(clampSides({ base, scale: z.scale, t: z.t, view }).x).toBe(0); // …the clamp keeps it in place
  });
  it('zoomed in, neither side edge can come inside the screen', () => {
    for (const x of [400, -2000]) {
      const t = clampSides({ base, scale: 2, t: { x, y: -300 }, view });
      expect(base.left + t.x).toBeLessThanOrEqual(0);
      expect(base.left + t.x + base.width * 2).toBeGreaterThanOrEqual(view.width);
      expect(t.y).toBe(-300); // vertical follows the fingers
    }
  });
});

describe('double tap on the zoomed page returns to reading', () => {
  it('two quick taps near each other are a double tap; slow or far apart are not', () => {
    const a = { x: 100, y: 200, at: 1000 };
    expect(isDoubleTap(a, { x: 110, y: 210, at: 1200 })).toBe(true);
    expect(isDoubleTap(a, { x: 110, y: 210, at: 1400 })).toBe(false);
    expect(isDoubleTap(a, { x: 220, y: 200, at: 1100 })).toBe(false);
    expect(isDoubleTap(null, a)).toBe(false);
  });
});
