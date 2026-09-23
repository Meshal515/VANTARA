import { describe, expect, it } from 'vitest';
import { MAX_FRAME_PAGES, frameLinkFor, normalizeFramePages } from './frames.ts';
import { isNotificationKind } from './notifications.ts';

/**
 * «فريم»: صفحات من فصل تُرسل لصديق فيفتحها في قارئ صغير.
 *
 * السؤال: ما الذي يصل الخادم؟ مراجع صفحات لا صورها — المستلم يجلبها من
 * المصدر بمحرّكه. فالقواعد هنا تضمن أن ما يُخزَّن صغير ومحدود وآمن الروابط.
 */
describe('frame pages', () => {
  it('keeps the chosen pages in the order they were captured', () => {
    expect(normalizeFramePages([{ index: 7 }, { index: 2 }, { index: 5 }])).toEqual([
      { index: 7, url: '', imageUrl: null },
      { index: 2, url: '', imageUrl: null },
      { index: 5, url: '', imageUrl: null },
    ]);
  });

  it('captures the same page once', () => {
    expect(normalizeFramePages([{ index: 3 }, { index: 3 }])).toEqual([{ index: 3, url: '', imageUrl: null }]);
  });

  it(`never stores more than ${MAX_FRAME_PAGES} pages`, () => {
    const many = Array.from({ length: 25 }, (_, index) => ({ index }));
    expect(normalizeFramePages(many)).toHaveLength(MAX_FRAME_PAGES);
  });

  it('keeps an http image url as a fallback hint and drops anything else', () => {
    // `javascript:` أو `file:` في رابطٍ يفتحه جهاز صديقك ليس تلميحًا بل هجوم
    expect(
      normalizeFramePages([
        { index: 0, imageUrl: 'https://cdn.example/p0.webp' },
        { index: 1, imageUrl: 'javascript:alert(1)' },
        { index: 2, imageUrl: 'file:///data/data/x' },
      ]),
    ).toEqual([
      { index: 0, url: '', imageUrl: 'https://cdn.example/p0.webp' },
      { index: 1, url: '', imageUrl: null },
      { index: 2, url: '', imageUrl: null },
    ]);
  });

  it('keeps the page url the source resolves images from', () => {
    // بعض المصادر لا تعطي رابط الصورة إلا من رابط الصفحة عبر getImageUrl
    expect(normalizeFramePages([{ index: 1, url: '/read/1/2' }])).toEqual([
      { index: 1, url: '/read/1/2', imageUrl: null },
    ]);
  });

  it('rejects indexes that are not page positions', () => {
    expect(normalizeFramePages([{ index: -1 }, { index: 1.5 }, { index: '4' }, { index: 100_000 }])).toBeNull();
  });

  it('an empty or malformed frame is no frame', () => {
    expect(normalizeFramePages([])).toBeNull();
    expect(normalizeFramePages(null)).toBeNull();
    expect(normalizeFramePages('pages')).toBeNull();
  });

  it('opens by its own link, not the series link', () => {
    expect(frameLinkFor('op 1/2')).toBe('vantara://frame/op%201%2F2');
  });

  it('is a notification kind the user can switch off', () => {
    expect(isNotificationKind('FRAME')).toBe(true);
  });
});
