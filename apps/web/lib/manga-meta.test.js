import { describe, expect, it } from 'vitest';
import { fetchMangaRatings, matchMangaRating } from './manga-meta.js';

describe('AniList manga rating', () => {
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
