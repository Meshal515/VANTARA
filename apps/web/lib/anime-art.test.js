import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(episodeStill(work, 1, art)).toMatchObject({ src: 'https://cr/1.jpg', still: true });
    expect(episodeStill(work, 2, art)).toMatchObject({ src: 'https://tvdb/2.jpg', still: true });
  });

  it('falls back to the cover (never a bare number tile) when no still exists', () => {
    expect(episodeStill(work, 3, art)).toMatchObject({ src: 'https://img/cover.jpg', still: false });
    expect(episodeStill(work, 3, null)).toMatchObject({ src: 'https://img/cover.jpg', still: false });
    expect(episodeStill({ banner: 'https://img/banner.jpg' }, 1)).toMatchObject({ src: 'https://img/banner.jpg', still: false });
    expect(episodeStill({}, 1)).toMatchObject({ src: null, still: false });
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
    expect(a).toEqual({ imdb: 'tt26743760', fanart: null, logo: logoOfImdb('tt26743760'), episodes: { 1: { image: 'https://tvdb/1.jpg', season: null, number: null, title: 'Maomao', overview: 'Maomao is sold to the palace.', airDate: '2023-10-22', runtime: 24, rating: 7.84 } } });
    expect(b).toEqual(a);
    expect(await loadAnimeArt(161645, { fetchImpl })).toEqual(a);
    expect(calls).toBe(1);

    expect(await loadAnimeArt('addon-x:1', { fetchImpl })).toBeNull();
    expect(await loadAnimeArt(7, { fetchImpl: async () => { throw new TypeError('offline'); } })).toBeNull();
    const noImdb = await loadAnimeArt(8, { fetchImpl: async () => ({ ok: true, json: async () => ({ mappings: {}, episodes: {} }) }) });
    expect(noImdb.logo).toBeNull();
  });
});

import { loadHdStills } from './anime-art.js';
describe('لقطات الحلقات بدقة 1920×1080', () => {
  const videos = [
    { season: 1, episode: 1, released: '2022-09-13T07:00:00.000Z', thumbnail: 'https://episodes.metahub.space/tt1/1/1/w780.jpg' },
    { season: 1, episode: 2, released: '2022-09-13T07:00:00.000Z', thumbnail: 'https://episodes.metahub.space/tt1/1/2/w780.jpg' },
    { season: 2, episode: 5, released: '2023-01-01T00:00:00.000Z', thumbnail: 'https://episodes.metahub.space/tt1/2/5/w780.jpg' },
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ meta: { videos } }) });
  it('تُعتمد الأصلية حين يطابق الموسم والرقم والتاريخ، ومعها 780 ثم TVDB بدائل', async () => {
    const art = { imdb: 'tt1', episodes: { 1: { season: 1, number: 1, airDate: '2022-09-13', image: 'https://tvdb/1.jpg' } } };
    const hd = await loadHdStills(art, { fetchImpl });
    expect(hd['1']).toEqual({ src: 'https://episodes.metahub.space/tt1/1/1/original.jpg', mid: 'https://episodes.metahub.space/tt1/1/1/w780.jpg' });
    const shot = episodeStill({}, 1, { ...art, hd }, { full: true });
    expect(shot).toEqual({ src: hd['1'].src, still: true, fallbacks: [hd['1'].mid, 'https://tvdb/1.jpg'] });
    // صفوف الحلقات: 780 لا 1920
    expect(episodeStill({}, 1, { ...art, hd })).toEqual({ src: hd['1'].mid, still: true, fallbacks: ['https://tvdb/1.jpg'] });
  });
  it('ترقيم مختلف وتاريخ مختلف: لا صورة؛ وحلقتان في اليوم نفسه بلا ترقيم مطابق: لا تخمين', async () => {
    const wrongDate = { imdb: 'tt1', episodes: { 1: { season: 1, number: 1, airDate: '2021-01-01' } } };
    expect(await loadHdStills(wrongDate, { fetchImpl })).toEqual({});
    const sameDay = { imdb: 'tt1', episodes: { 7: { season: 17, number: 7, airDate: '2022-09-13' } } };
    expect(await loadHdStills(sameDay, { fetchImpl })).toEqual({});
    const uniqueDay = { imdb: 'tt1', episodes: { 9: { season: 17, number: 9, airDate: '2023-01-01' } } };
    expect((await loadHdStills(uniqueDay, { fetchImpl }))['9'].src).toBe('https://episodes.metahub.space/tt1/2/5/original.jpg');
  });
});


describe('image budgets and HD fetch recovery', () => {
  afterEach(() => vi.useRealTimers());
  const art = { imdb: 'tt987654321', episodes: { 1: { image: 'https://tvdb/1.jpg', season: 1, number: 1, airDate: '2025-01-01' } } };
  const video = { season: 1, episode: 1, released: '2025-01-01', thumbnail: 'https://episodes.metahub.space/tt987654321/1/1/w780.jpg' };

  it('uses a native small still only when its pixels cover the requested display size', () => {
    const hd = { 1: { src: 'https://episodes.metahub.space/tt987654321/1/1/original.jpg', mid: video.thumbnail } };
    expect(episodeStill({}, 1, { ...art, hd }, { width: 170, dpr: 2 })).toEqual({
      src: 'https://episodes.metahub.space/tt987654321/1/1/w342.jpg', still: true,
      fallbacks: [video.thumbnail, 'https://tvdb/1.jpg'],
    });
    expect(episodeStill({}, 1, { ...art, hd }, { width: 300, dpr: 2 }).src).toBe(video.thumbnail);
    expect(episodeStill({}, 1, { ...art, hd }, { full: true, width: 170, dpr: 2 }).src).toBe(hd[1].src);
  });

  it('uses the small cover for row fallback and the full cover for a hero', () => {
    const m = { poster: 'https://img/full.jpg', posterSmall: 'https://img/small.jpg' };
    expect(episodeStill(m, 1).src).toBe('https://img/small.jpg');
    expect(episodeStill(m, 1, null, { full: true }).src).toBe('https://img/full.jpg');
  });

  it('retries an HD metadata server failure on the next open', async () => {
    const m = { ...art, imdb: 'tt987654322' };
    expect(await loadHdStills(m, { fetchImpl: async () => ({ ok: false, status: 503 }) })).toEqual({});
    const hd = await loadHdStills(m, { fetchImpl: async () => ({ ok: true, json: async () => ({ meta: { videos: [video] } }) }) });
    expect(hd['1']?.mid).toBe(video.thumbnail);
  });

  it('settles and permits retry when an HD metadata response body never arrives', async () => {
    vi.useFakeTimers();
    const m = { ...art, imdb: 'tt987654323' };
    let signal;
    const stalled = loadHdStills(m, { timeoutMs: 25, fetchImpl: async (_url, opts) => {
      signal = opts?.signal;
      return { ok: true, json: () => new Promise(() => {}) };
    } });
    let result;
    void stalled.then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(30);
    expect(result).toEqual({});
    expect(signal?.aborted).toBe(true);
    expect((await loadHdStills(m, { fetchImpl: async () => ({ ok: true, json: async () => ({ meta: { videos: [video] } }) }) }))['1']?.mid).toBe(video.thumbnail);
  });
});
