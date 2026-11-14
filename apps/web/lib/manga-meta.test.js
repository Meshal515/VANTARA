import { describe, expect, it } from 'vitest';
import { fetchMangaGenre, fetchMangaPopular, fetchMangaRatings, matchMangaRating } from './manga-meta.js';

describe('AniList manga rating', () => {
  it('loads actual Manga genre results even with no installed sources, preserving cover and source-less detail metadata', async () => {
    let body;
    const fetched = await fetchMangaGenre('Drama', { fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ data: { Page: { pageInfo: {hasNextPage:true}, media: [
        { id: 123, format: 'MANGA', title: {english:'Vagabond'}, coverImage: {large:'https://covers/123'}, genres:['Drama'], chapters: 327 },
        { id: 234, format: 'NOVEL', title: {english:'Drama Novel'}, genres:['Drama'] },
        { id: 345, format: 'MANGA', title: {english:'Adult'}, isAdult:true },
      ] } } }) };
    }});
    expect(body.query).toContain('genre: $value');
    expect(body.query).toContain('format_not: NOVEL');
    expect(body.variables).toEqual({page:1,value:'Drama'});
    expect(fetched.items.map(x => x.id)).toEqual(['ext:vagabond']);
    expect(fetched.items[0]._work.editions).toEqual([]);
    expect(fetched.items[0].coverImage.large).toBe('https://covers/123');
    expect(fetched.hasNextPage).toBe(true);
  });
  it('queries AniList tags for Isekai and School Life; provider errors must not appear as empty results', async () => {
    let request;
    await fetchMangaGenre('School Life', {fetchImpl:async(_url,init)=>{
      request=JSON.parse(init.body);
      return {ok:true,json:async()=>({data:{Page:{media:[],pageInfo:{hasNextPage:false}}}})};
    }});
    expect(request.query).toContain('tag: $value');
    expect(request.variables.value).toBe('School');
    await expect(fetchMangaGenre('Action',{fetchImpl:async()=>({ok:false,status:503})})).rejects.toThrow('anilist_genre_503');
  });

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
  it('a light novel is not a manga card, and two AniList works with one name are one card', async () => {
    // حيّ 2026-11-08: «Mushoku Tensei: Jobless Reincarnation» المانجا (85564) والرواية (85470) بمرجع واحد
    let query;
    const items = await fetchMangaPopular({ fetchImpl: async (_url, init) => {
      query = JSON.parse(init.body).query;
      return { ok: true, json: async () => ({ data: { Page: { pageInfo: { hasNextPage: false }, media: [
        { id: 85564, format: 'MANGA', title: { english: 'Mushoku Tensei: Jobless Reincarnation' } },
        { id: 85470, format: 'NOVEL', title: { english: 'Mushoku Tensei: Jobless Reincarnation' } },
        { id: 30013, format: 'MANGA', title: { english: 'One Piece' } },
        { id: 999, format: 'ONE_SHOT', title: { english: 'ONE PIECE' } },
      ] } } }) };
    } });
    expect(query).toContain('format_not: NOVEL');
    expect(items.items.map((m) => [m.id, m._metaId])).toEqual([['ext:mushoku tensei jobless reincarnation', 85564], ['ext:one piece', 30013]]);
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
    // عمل للكبار بالاسم نفسه: لا تقييم، بل علامة حجب
    expect(matchMangaRating('Nano Machine', [{ ...row, isAdult: true }])).toEqual({ id: row.id, adult: true });
    expect(matchMangaRating('Nano Machine', [{ ...row, genres: ['Romance', 'Hentai'] }])).toEqual({ id: row.id, adult: true });
    // الإيتشي يبقى: يُقيَّم كأي عمل
    expect(matchMangaRating('Nano Machine', [{ ...row, genres: ['Romance', 'Ecchi'] }])).toEqual({ id: 2, score: 8.4 });
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
