import { describe, expect, it } from 'vitest';
import { buildViewportCapture, containImageRect, saveViewportImage } from './reader-viewport.js';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const page = (box, width = 1000, height = 10000, clip = box) => ({ rect: box, clip, naturalWidth: width, naturalHeight: height });

describe('reader viewport capture geometry', () => {
  it('crops a huge manhwa page to the reader content between the toolbar and tray', () => {
    const plan = buildViewportCapture({
      viewport: rect(0, 0, 412, 900), scroll: rect(0, 0, 412, 900),
      toolbar: rect(0, 0, 412, 64), tray: rect(0, 770, 412, 130),
      pages: [page(rect(0, -1000, 412, 4120))], pixelRatio: 2,
    });
    expect(plan.bounds).toEqual(rect(0, 64, 412, 706));
    expect([plan.width, plan.height]).toEqual([824, 1412]);
    expect(plan.draws).toHaveLength(1);
    expect(plan.draws[0].source.top).toBeCloseTo(1064 / 0.412);
    expect(plan.draws[0].source.height).toBeCloseTo(706 / 0.412);
    expect(plan.draws[0].dest).toEqual(rect(0, 0, 412, 706));
  });

  it('stitches only the visible intersections of adjacent pages, retaining the actual gap', () => {
    const plan = buildViewportCapture({ viewport: rect(0, 0, 400, 800), scroll: rect(0, 0, 400, 800),
      toolbar: rect(0, 0, 400, 60), tray: rect(0, 700, 400, 100),
      pages: [page(rect(0, -500, 400, 800), 1000, 2000), page(rect(0, 308, 400, 1200), 1000, 3000), page(rect(0, 1516, 400, 400), 1000, 1000)] });
    expect(plan.draws.map(d => d.index)).toEqual([0, 1]);
    expect(plan.draws[0].source).toEqual(rect(0, 1400, 1000, 600));
    expect(plan.draws[0].dest).toEqual(rect(0, 0, 400, 240));
    expect(plan.draws[1].source).toEqual(rect(0, 0, 1000, 980));
    expect(plan.draws[1].dest).toEqual(rect(0, 248, 400, 392));
  });

  it('clips a scrolled paged image to its frame, including horizontal clipping', () => {
    const plan = buildViewportCapture({ viewport: rect(0, 0, 400, 800), scroll: rect(0, 0, 400, 800),
      pages: [page(rect(-100, -800, 500, 5000), 1000, 10000, rect(0, 40, 350, 600))] });
    expect(plan.bounds).toEqual(rect(0, 0, 350, 800));
    expect(plan.draws[0].source).toEqual(rect(200, 1680, 700, 1200));
    expect(plan.draws[0].dest).toEqual(rect(0, 40, 350, 600));
  });

  it('preserves fit-height letterboxing and crops desktop side gutters to the page frame', () => {
    expect(containImageRect(rect(0, 0, 400, 800), 1000, 1000)).toEqual(rect(0, 200, 400, 400));
    const plan = buildViewportCapture({ viewport: rect(0, 0, 1440, 900), scroll: rect(0, 0, 1440, 900),
      pages: [page(rect(310, -100, 820, 1640), 1000, 2000)] });
    expect(plan.bounds).toEqual(rect(310, 0, 820, 900));
  });

  it('uses the visible viewport and clamps output memory without stretching the crop', () => {
    const plan = buildViewportCapture({ viewport: rect(20, 50, 3000, 3000), scroll: rect(0, 0, 4000, 4000),
      pages: [page(rect(0, 0, 4000, 4000), 1000, 1000)], pixelRatio: 4 });
    expect(plan.bounds).toEqual(rect(20, 50, 3000, 3000));
    expect(plan.width * plan.height).toBeLessThanOrEqual(8_000_000);
    expect(plan.width).toBe(plan.height);
  });

  it('rejects a capture with no visible manga instead of saving blank UI', () => {
    expect(() => buildViewportCapture({ viewport: rect(0, 0, 400, 800), scroll: rect(0, 0, 400, 800), pages: [page(rect(0, 900, 400, 1000))] })).toThrow(/visible/);
  });
});

describe('reader viewport save destination', () => {
  it('passes actual image bytes to the Android gallery contract', async () => {
    let received;
    const result = await saveViewportImage(new Blob([Uint8Array.of(137, 80, 78, 71)], { type: 'image/png' }), 'VANTARA.png', {
      native: { saveImage: async value => { received = value; } },
    });
    expect(result).toBe('gallery');
    expect(received).toEqual({ base64: 'iVBORw==', mimeType: 'image/png', filename: 'VANTARA.png' });
  });

  it('reports Android storage failure without pretending a browser download saved to gallery', async () => {
    await expect(saveViewportImage(new Blob(['png'], { type: 'image/png' }), 'VANTARA.png', {
      native: { saveImage: async () => { throw new Error('Storage is full'); } },
    })).rejects.toThrow('Storage is full');
  });
});
