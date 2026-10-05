import { describe, expect, it } from 'vitest';
import { applyPublishedPage, smallerThanOriginal, swapPageImage } from './reader-translate.js';

const fakeImg = (src, naturalHeight) => ({
  src,
  naturalHeight,
  dataset: {},
  classList: { add() {}, remove() {}, toggle() {} },
});

describe('a saved translation smaller than its page is redone at full size', () => {
  it('a translation shorter than the original is treated as broken and the original comes back', () => {
    const img = fakeImg('file:///page.jpg', 6000);
    let broken = 0;
    swapPageImage(img, { image: 'file:///tr.webp' }, true, () => (broken += 1));
    expect(img.src).toBe('file:///tr.webp');
    img.naturalHeight = 4096;
    img.onload();
    expect(broken).toBe(1);
    expect(img.src).toBe('file:///page.jpg');
  });

  it('a translation at the page size stays', () => {
    const img = fakeImg('file:///page.jpg', 3000);
    let broken = 0;
    swapPageImage(img, { image: 'file:///tr.webp' }, true, () => (broken += 1));
    img.naturalHeight = 3000;
    img.onload();
    expect(broken).toBe(0);
    expect(img.src).toBe('file:///tr.webp');
  });

  it('the size check needs both sizes', () => {
    expect(smallerThanOriginal({ dataset: {}, naturalHeight: 100 })).toBe(false);
    expect(smallerThanOriginal({ dataset: { originalHeight: '6000' }, naturalHeight: 5990 })).toBe(false);
    expect(smallerThanOriginal({ dataset: { originalHeight: '6000' }, naturalHeight: 4096 })).toBe(true);
  });
});


describe('background chapter translation publishes into the open reader', () => {
  it('stores and paints an accepted page immediately instead of waiting for chapter completion', () => {
    const seg = {
      row: { chapter: 'c1' },
      tl: { results: new Map(), failed: new Set([1]) },
      slots: [{}, {}],
    };
    const painted = [];
    let gates = 0;
    const accepted = applyPublishedPage({
      event: { ref: 'ext:x', chapterKey: 'c1', pageIndex: 1, result: { image: 'file:///translated.webp', translated: 2 } },
      ref: 'ext:x',
      segs: [seg],
      keyOf: () => 'c1',
      paint: (_seg, index) => painted.push(index),
      updateGate: () => { gates += 1; },
    });
    expect(accepted).toBe(true);
    expect(seg.tl.results.get(1)).toMatchObject({ image: 'file:///translated.webp', translated: 2 });
    expect(seg.tl.failed.has(1)).toBe(false);
    expect(painted).toEqual([1]);
    expect(gates).toBe(1);
  });

  it('ignores a published page from another work or unloaded chapter', () => {
    const seg = { row: {}, tl: { results: new Map(), failed: new Set() }, slots: [{}] };
    const painted = [];
    expect(applyPublishedPage({
      event: { ref: 'ext:other', chapterKey: 'c2', pageIndex: 0, result: { image: 'x' } },
      ref: 'ext:x',
      segs: [seg],
      keyOf: () => 'c1',
      paint: (_seg, index) => painted.push(index),
      updateGate: () => {},
    })).toBe(false);
    expect(painted).toEqual([]);
    expect(seg.tl.results.size).toBe(0);
  });
});
