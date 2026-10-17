import { beforeEach, describe, expect, it } from 'vitest';
import { anilistIdOf, animeLogoOf, episodeStill, episodeTitleOf, loadAnimeArt } from './anime-art.js';
import { logoOfImdb } from './together/art.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

describe('anime episode art', () => {
  beforeEach(() => { globalThis.localStorage = memory(); });

  const work = { id: 161645, poster: 'https://img/cover.jpg', banner: 'https://img/banner.jpg', thumbs: { 1: { thumbnail: 'https://cr/1.jpg', title: 'Maomao' } } };
  const art = { imdb: 'tt26743760', episodes: { 1: { image: 'https://tvdb/1.jpg', title: 'X' }, 2: { image: 'https://tvdb/2.jpg', title: 'A Bad Omen' } } };

  it('picks a real still first: AniList, then ani.zip', () => {
    expect(episodeStill(work, 1, art)).toEqual({ src: 'https://cr/1.jpg', still: true });
    expect(episodeStill(work, 2, art)).toEqual({ src: 'https://tvdb/2.jpg', still: true });
  });

  it('falls back to the cover (never a bare number tile) when no still exists', () => {
    expect(episodeStill(work, 3, art)).toEqual({ src: 'https://img/cover.jpg', still: false });
    expect(episodeStill(work, 3, null)).toEqual({ src: 'https://img/cover.jpg', still: false });
    expect(episodeStill({ banner: 'https://img/banner.jpg' }, 1)).toEqual({ src: 'https://img/banner.jpg', still: false });
    expect(episodeStill({}, 1)).toEqual({ src: null, still: false });
  });

  it('titles episodes from MAL, then AniList, then ani.zip', () => {
    expect(episodeTitleOf(work, 1, { mal: { 1: 'From MAL' }, art })).toBe('From MAL');
    expect(episodeTitleOf(work, 1, { art })).toBe('Maomao');
    expect(episodeTitleOf(work, 2, { art })).toBe('A Bad Omen');
    expect(episodeTitleOf(work, 9, { art })).toBeNull();
  });

  it('only links numeric AniList ids', () => {
    expect(anilistIdOf(161645)).toBe(161645);
    expect(anilistIdOf('161645')).toBe(161645);
    expect(anilistIdOf('addon-x:1')).toBeNull();
    expect(anilistIdOf(0)).toBeNull();
    expect(animeLogoOf({ imdb: 'tt26743760' })).toBe(logoOfImdb('tt26743760'));
    expect(animeLogoOf({ imdb: null })).toBeNull();
  });

  it('loads stills and the title logo from ani.zip once, and never throws', async () => {
    let calls = 0;
    const fetchImpl = async (url) => {
      calls++;
      expect(url).toBe('https://api.ani.zip/mappings?anilist_id=161645');
      return { ok: true, json: async () => ({ mappings: { imdb_id: 'tt26743760' }, episodes: { 1: { image: 'https://tvdb/1.jpg', title: { en: 'Maomao' }, overview: ' Maomao is sold to the palace. ', airDate: '2023-10-22', runtime: 24, rating: '7.84' }, S1: { image: 'nope' } } }) };
    };
    const [a, b] = await Promise.all([loadAnimeArt(161645, { fetchImpl }), loadAnimeArt(161645, { fetchImpl })]);
    expect(calls).toBe(1);
    expect(a).toEqual({ imdb: 'tt26743760', fanart: null, logo: logoOfImdb('tt26743760'), episodes: { 1: { image: 'https://tvdb/1.jpg', title: 'Maomao', overview: 'Maomao is sold to the palace.', airDate: '2023-10-22', runtime: 24, rating: 7.84 } } });
    expect(b).toEqual(a);
    expect(await loadAnimeArt(161645, { fetchImpl })).toEqual(a);
    expect(calls).toBe(1);

    expect(await loadAnimeArt('addon-x:1', { fetchImpl })).toBeNull();
    expect(await loadAnimeArt(7, { fetchImpl: async () => { throw new TypeError('offline'); } })).toBeNull();
    const noImdb = await loadAnimeArt(8, { fetchImpl: async () => ({ ok: true, json: async () => ({ mappings: {}, episodes: {} }) }) });
    expect(noImdb.logo).toBeNull();
  });
});
