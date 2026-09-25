import { describe, expect, it } from 'vitest';
import { smallerThanOriginal, swapPageImage } from './reader-translate.js';

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
