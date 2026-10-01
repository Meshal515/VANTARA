import { describe, expect, it } from 'vitest';
import { fetchMangaPopular, fetchMangaRatings, matchMangaRating } from './manga-meta.js';

describe('AniList manga rating', () => {
  it('uses global popularity rather than source feed rank, retaining canonical refs and a trustworthy cover', async () => {
    let query;
    const items = await fetchMangaPopular({ fetchImpl: async (_url, init) => {
      query = JSON.parse(init.body).query;
      return { ok: true, json: async () => ({ data: { Page: { pageInfo: { hasNextPage: true }, media: [
        { id: 1, title: { english: 'One Piece' }, coverImage: { large: 'https://c/one.jpg' }, popularity: 999, genres: ['Action'] },
        { id: 2, title: { english: 'Adult' }, isAdult: true },
      ] } } }) };
    } });
    expect(query).toContain('POPULARITY_DESC');
    expect(items.items.map((m) => m.id)).toEqual(['ext:one piece']);
    expect(items.items[0].coverImage.large).toBe('https://c/one.jpg');
    expect(items.hasNextPage).toBe(true);
  });
  it('falls back to worldwide readership on Kitsu if AniList is unavailable', async () => {
    const result = await fetchMangaPopular({ fetchImpl: async (url) => url.includes('anilist') ? { ok: false, status: 403 } : {
      ok: true, json: async () => ({ data: [{ id: '38', attributes: { canonicalTitle: 'One Piece', userCount: 100000, posterImage: { original: 'https://c/op.jpg' } } }], links: {} }),
    } });
    expect(result.items[0]).toMatchObject({ id: 'ext:one piece', popularity: 100000, coverImage: { large: 'https://c/op.jpg' } });
  });
  it('accepts only an exact normalized title, never the first search result by guess', () => {
    const results = [
      { id: 1, title: { romaji: 'Nano Machine: Ragnarok' }, averageScore: 99 },
      { id: 2, title: { english: 'Nano Machine' }, averageScore: 84 },
    ];
    expect(matchMangaRating('Nano Machine', results)).toEqual({ id: 2, score: 8.4 });
    expect(matchMangaRating('Nano', results)).toBeNull();
  });
  it('hides ambiguous, adult, missing and unscored matches', () => {
    const row = { id: 2, title: { romaji: 'Nano Machine' }, averageScore: 84 };
    expect(matchMangaRating('Nano Machine', [row, { ...row, id: 3 }])).toBeNull();
    expect(matchMangaRating('Nano Machine', [{ ...row, isAdult: true }])).toBeNull();
    expect(matchMangaRating('Nano Machine', [{ ...row, averageScore: null }])).toBeNull();
  });
  it('requests manga in a batch and leaves an unmatched title unrated', async () => {
    let requested;
    const fetchImpl = async (_url, init) => {
      requested = JSON.parse(init.body);
      return { ok: true, json: async () => ({ data: {
        p0: { media: [{ id: 7, title: { romaji: 'Nano Machine' }, averageScore: 84 }] },
        p1: { media: [{ id: 8, title: { romaji: 'Different Work' }, averageScore: 99 }] },
      } }) };
    };
    const found = await fetchMangaRatings(['Nano Machine', 'Other Work'], { fetchImpl });
    expect(requested.query).toContain('type: MANGA');
    expect(requested.variables).toEqual({ q0: 'Nano Machine', q1: 'Other Work' });
    expect(found.get('Nano Machine')?.score).toBe(8.4);
    expect(found.get('Other Work')).toBeNull();
  });
});
