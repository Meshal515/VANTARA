import { describe, expect, it, vi } from 'vitest';
import { buildViewportCapture, buildZoomCapture, captureReaderViewport, containImageRect, saveViewportImage } from './reader-viewport.js';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const page = (box, width = 1000, height = 10000, clip = box) => ({ rect: box, clip, naturalWidth: width, naturalHeight: height });

describe('reader viewport capture geometry', () => {
  it('saves an entire small manga frame at ORIGINAL source resolution without phone bars or upscaling', () => {
    const original = page(rect(0, 185, 400, 400), 3000, 3000);
    const plan = buildViewportCapture({
      viewport: rect(0, 0, 400, 900), scroll: rect(0, 0, 400, 900),
      toolbar: rect(0, 0, 400, 65), tray: rect(0, 790, 400, 110),
      pages: [original], pixelRatio: 3,
    });
    expect(plan.mode).toBe('original');
    expect([plan.width, plan.height]).toEqual([3000, 3000]);
    expect(plan.bounds).toEqual(rect(0, 0, 3000, 3000));
    expect(plan.draws[0].source).toEqual(rect(0, 0, 3000, 3000));
    expect(plan.draws[0].dest).toEqual(rect(0, 0, 3000, 3000));
  });

  it('saves a whole letterboxed manga image, not the dark letterbox canvas', () => {
    const image = containImageRect(rect(0, 0, 400, 800), 1800, 1800);
    const plan = buildViewportCapture({
      viewport: rect(0, 0, 400, 900), scroll: rect(0, 0, 400, 900),
      toolbar: rect(0, 0, 400, 55), tray: rect(0, 840, 400, 60),
      pages: [page(image, 1800, 1800, rect(0, 0, 400, 800))], pixelRatio: 2,
    });
    expect(plan.mode).toBe('original');
    expect([plan.width, plan.height]).toEqual([1800, 1800]);
  });

  it('crops zoomed or horizontally clipped content instead of exporting a hidden frame', () => {
    const plan = buildViewportCapture({
      viewport: rect(0, 0, 412, 900), scroll: rect(0, 0, 412, 900),
      toolbar: rect(0, 0, 412, 64), tray: rect(0, 770, 412, 130),
      pages: [page(rect(-180, 0, 820, 900), 3200, 3512, rect(0, 0, 412, 900))],
      pixelRatio: 2,
    });
    expect(plan.mode).toBe('viewport');
    expect(plan.draws[0].source.left).toBeGreaterThan(0);
    expect(plan.draws[0].source.width).toBeLessThan(3200);
  });

  it('limits giant images instead of allocating a 100MB+ native canvas', () => {
    const plan = buildViewportCapture({
      viewport: rect(0, 0, 400, 900), scroll: rect(0, 0, 400, 900),
      pages: [page(rect(0, 0, 400, 800), 8000, 16000)], pixelRatio: 3,
    });
    expect(plan.mode).toBe('viewport');
    expect(plan.width * plan.height).toBeLessThanOrEqual(8_000_000);
  });
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
    expect(plan.bounds).toEqual(rect(0, 40, 350, 600));
    expect(plan.draws[0].source).toEqual(rect(200, 1680, 700, 1200));
    expect(plan.draws[0].dest).toEqual(rect(0, 0, 350, 600));
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

describe('zoomed manga image capture (exactly what is visible)', () => {
  it('captures only the transformed and panned visible slice of a zoomed manga page', () => {
    const result = buildZoomCapture({
      viewport: rect(0, 0, 400, 800), imageRect: rect(-200, -350, 800, 1600),
      naturalWidth: 2000, naturalHeight: 4000, pixelRatio: 2,
    });
    expect(result.mode).toBe('viewport');
    expect(result.draws).toHaveLength(1);
    expect(result.draws[0].source).toEqual(rect(500, 875, 1000, 2000));
    expect(result.draws[0].dest).toEqual(rect(0, 0, 400, 800));
    expect([result.width, result.height]).toEqual([800, 1600]);
  });

  it('saves the natural image if zoom has returned to a full view', () => {
    const result = buildZoomCapture({
      viewport: rect(0, 0, 412, 900), imageRect: rect(56, 180, 300, 450),
      naturalWidth: 1600, naturalHeight: 2400, pixelRatio: 3,
    });
    expect(result.mode).toBe('original');
    expect([result.width, result.height]).toEqual([1600, 2400]);
  });

  it('does not include a hidden frame when zoom is clipped by the right edge', () => {
    const result = buildZoomCapture({
      viewport: rect(0, 0, 412, 900), imageRect: rect(110, 200, 600, 600),
      naturalWidth: 3000, naturalHeight: 3000, pixelRatio: 2,
    });
    expect(result.mode).toBe('viewport');
    expect(result.draws[0].source.width).toBeCloseTo(1510);
    expect(result.draws[0].source.left).toBeCloseTo(0);
    expect(result.bounds).toEqual(rect(110, 200, 302, 600));
    expect(result.draws[0].dest).toEqual(rect(0, 0, 302, 600));
  });
});

describe('the actual reader save click path', () => {
  it('draws the transformed zoom image, never the hidden underlying manga image', () => {
    const image = {
      complete: true, naturalWidth: 2000, naturalHeight: 4000,
      getBoundingClientRect: () => rect(-200, -350, 800, 1600),
    };
    const draws = vi.fn();
    const doc = {
      defaultView: {innerWidth:400,innerHeight:800,devicePixelRatio:2},
      createElement: vi.fn((name) => {
        expect(name).toBe('canvas');
        return {width:0,height:0,getContext:()=>({
          fillRect:vi.fn(),scale:vi.fn(),drawImage:draws,
        })};
      }),
    };
    const zoom = {
      hidden:false,
      querySelector: (selector) => selector === '#rdZoomImg' ? image : null,
      getBoundingClientRect: () => rect(0,0,400,800),
    };
    const root = {
      ownerDocument:doc,
      getBoundingClientRect:()=>rect(0,0,400,800),
      querySelector: (selector) => selector === '#rdZoom' ? zoom
        : (() => { throw new Error('must not read underlying page'); })(),
    };
    const canvas = captureReaderViewport(root);
    expect([canvas.width,canvas.height]).toEqual([800,1600]);
    expect(draws).toHaveBeenCalledOnce();
    expect(draws.mock.calls[0][0]).toBe(image);
    expect(draws.mock.calls[0].slice(1)).toEqual([500,875,1000,2000,0,0,400,800]);
  });

  it('draws the original 3000×3000 frame from a small fully visible image', () => {
    const image={
      complete:true,naturalWidth:3000,naturalHeight:3000,
      getBoundingClientRect:()=>rect(0,185,400,400),
    };
    const frame={getBoundingClientRect:()=>rect(0,185,400,400),
      querySelector:(q)=>q===':scope > img'?image:null};
    const scroll={
      getBoundingClientRect:()=>rect(0,0,400,900),
      querySelectorAll:(q)=>q==='.rd-page'?[frame]:[],
    };
    const elements={
      '#rdZoom':{hidden:true},
      '#rdScroll':scroll,
      '#rdFrameTop':{getBoundingClientRect:()=>rect(0,0,400,65)},
      '#rdTray':{getBoundingClientRect:()=>rect(0,790,400,110)},
    };
    const draws=vi.fn();
    const doc={
      defaultView:{innerWidth:400,innerHeight:900,devicePixelRatio:3},
      createElement:()=>({width:0,height:0,getContext:()=>({
        fillRect:vi.fn(),scale:vi.fn(),drawImage:draws,
      })}),
    };
    const root={
      ownerDocument:doc,
      getBoundingClientRect:()=>rect(0,0,400,900),
      querySelector:(selector)=>elements[selector]??null,
    };
    const canvas=captureReaderViewport(root);
    expect([canvas.width,canvas.height]).toEqual([3000,3000]);
    expect(draws.mock.calls[0]).toEqual([image,0,0,3000,3000,0,0,3000,3000]);
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
