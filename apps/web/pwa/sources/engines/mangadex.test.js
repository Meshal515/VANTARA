import { describe, expect, it } from 'vitest';
import { chapterNumberOfAttr, mangadex } from './mangadex.js';

describe('MangaDex chapter numbers', () => {
  it('chapter 0 is a real number (it was -1 because 0 is falsy), and non-numeric or missing is -1', () => {
    expect(chapterNumberOfAttr('0')).toBe(0);
    expect(chapterNumberOfAttr('1')).toBe(1);
    expect(chapterNumberOfAttr('12.5')).toBe(12.5);
    expect(chapterNumberOfAttr(null)).toBe(-1);
    expect(chapterNumberOfAttr('')).toBe(-1);
    expect(chapterNumberOfAttr('extra')).toBe(-1);
  });

  it('the feed keeps chapter 0 numbered 0, so it no longer collides with chapter 1 through its volume number', async () => {
    const feed = { total: 2, data: [
      { id: 'c1', attributes: { chapter: '1', volume: '1', pages: 20, publishAt: '2024-01-01T00:00:00Z' }, relationships: [] },
      { id: 'c0', attributes: { chapter: '0', volume: '1', title: 'Prologue', pages: 12, publishAt: '2024-01-01T00:00:00Z' }, relationships: [] },
    ] };
    const fetch = { json: async () => feed };
    const src = mangadex.create({ id: 'mangadex', domain: 'mangadex.org', config: { lang: 'en' } }, { fetch });
    const chapters = await src.chapters({ url: '/manga/00000000-0000-0000-0000-000000000001' });
    expect(chapters.map((c) => c.chapterNumber).sort()).toEqual([0, 1]);
  });
});
