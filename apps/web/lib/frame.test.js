import { describe, expect, it } from 'vitest';
import {
  MAX_FRAME_PAGES,
  buildFramePayload,
  createFrameCapture,
  frameIdFromLink,
  pageAtViewport,
  resolveFramePages,
} from './frame.js';

/**
 * «فريم» في الواجهة: التقاط صفحات من القارئ، وإرسالها، وفتحها عند الصديق.
 */
describe('frame capture', () => {
  it('captures the page on screen and releases it on a second tap', () => {
    const capture = createFrameCapture();
    capture.toggle({ index: 4, url: '/p4', imageUrl: 'https://c/4.webp' });
    expect(capture.has(4)).toBe(true);
    capture.toggle({ index: 4 });
    expect(capture.has(4)).toBe(false);
    expect(capture.size).toBe(0);
  });

  it('keeps pages in capture order', () => {
    const capture = createFrameCapture();
    capture.toggle({ index: 9 });
    capture.toggle({ index: 2 });
    expect(capture.list().map((p) => p.index)).toEqual([9, 2]);
  });

  it(`refuses the page after ${MAX_FRAME_PAGES} instead of silently dropping one`, () => {
    const capture = createFrameCapture();
    for (let i = 0; i < MAX_FRAME_PAGES; i++) expect(capture.toggle({ index: i })).toBe('added');
    expect(capture.toggle({ index: 99 })).toBe('full');
    expect(capture.size).toBe(MAX_FRAME_PAGES);
  });
});

describe('frame payload', () => {
  const manga = {
    url: '/manga/1', title: 'ون بيس', thumbnailUrl: 'https://c/cover.jpg', memo: '{"k":1}',
    description: 'وصف طويل جدًا', genre: 'أكشن', author: 'أودا',
  };
  const chapter = { url: '/manga/1/1100', name: 'الفصل 1100', chapterNumber: 1100, scanlator: 'x', memo: '', dateUpload: 5 };

  it('carries what the recipient engine needs and nothing more', () => {
    const payload = buildFramePayload({
      toId: 'ngm',
      sourceId: 'pkg',
      manga,
      chapter,
      pages: [{ index: 3, url: '/p3', imageUrl: 'https://c/3.webp' }],
      message: '  شوف  ',
    });
    expect(payload).toEqual({
      toId: 'ngm',
      sourceId: 'pkg',
      work: { url: '/manga/1', title: 'ون بيس', thumbnailUrl: 'https://c/cover.jpg', memo: '{"k":1}' },
      chapter: { url: '/manga/1/1100', name: 'الفصل 1100', chapterNumber: 1100, scanlator: 'x', memo: '' },
      pages: [{ index: 3, url: '/p3', imageUrl: 'https://c/3.webp' }],
      message: 'شوف',
    });
  });

  it('an empty message is not sent as text', () => {
    const payload = buildFramePayload({ toId: 'a', sourceId: 'p', manga, chapter, pages: [{ index: 0 }], message: '   ' });
    expect(payload.message).toBeUndefined();
  });
});

describe('page on screen', () => {
  it('is the page covering the middle of the viewport', () => {
    const rects = [
      { top: -900, bottom: -100 },
      { top: -100, bottom: 700 },
      { top: 700, bottom: 1500 },
    ];
    expect(pageAtViewport(rects, 800)).toBe(1);
  });

  it('falls back to the closest page when none covers the middle', () => {
    expect(pageAtViewport([{ top: 500, bottom: 520 }, { top: 900, bottom: 1200 }], 800)).toBe(0);
    expect(pageAtViewport([], 800)).toBe(-1);
  });
});

describe('opening a frame', () => {
  it('reads its id from the notification link', () => {
    expect(frameIdFromLink('vantara://frame/op%201')).toBe('op 1');
    expect(frameIdFromLink('vantara://series/x')).toBeNull();
    expect(frameIdFromLink(null)).toBeNull();
  });

  it('takes the fresh page from the chapter list, in the sender order', () => {
    // الروابط الموقّعة تنتهي؛ القائمة الحديثة من المصدر أصدق من المحفوظ
    const fresh = [0, 1, 2, 3, 4, 5].map((index) => ({ index, url: `/p${index}`, imageUrl: `https://new/${index}` }));
    const stored = [{ index: 4, url: '/p4', imageUrl: 'https://old/4' }, { index: 1, url: '', imageUrl: null }];
    expect(resolveFramePages(stored, fresh)).toEqual([fresh[4], fresh[1]]);
  });

  it('falls back to the stored page when the chapter shrank', () => {
    const stored = [{ index: 7, url: '/p7', imageUrl: 'https://old/7' }];
    expect(resolveFramePages(stored, [{ index: 0, url: '/p0', imageUrl: null }])).toEqual([stored[0]]);
    expect(resolveFramePages(stored, null)).toEqual([stored[0]]);
  });
});
