import { beforeEach, describe, expect, it } from 'vitest';
import { episodeLine, logoOfImdb, mediaKind, resolveArt } from './art.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

describe('room art', () => {
  beforeEach(() => { globalThis.localStorage = memory(); });

  it('names the kind correctly (series are not anime, manga is not a recommendation)', () => {
    expect(mediaKind({ kind: 'anime' })).toBe('أنمي');
    expect(mediaKind({ kind: 'manga' })).toBe('مانجا');
    expect(mediaKind({ kind: 'cinema', format: 'series', season: 2, episode: 3 })).toBe('مسلسل');
    expect(mediaKind({ kind: 'cinema', format: 'movie' })).toBe('فيلم');
    expect(mediaKind({ kind: 'cinema', episode: -1 })).toBe('فيلم');
    expect(episodeLine({ kind: 'cinema', format: 'series', season: 2, episode: 3 })).toBe('م2 · الحلقة 3');
    expect(episodeLine({ kind: 'anime', episode: 5 })).toBe('الحلقة 5');
    expect(episodeLine({ kind: 'cinema', format: 'movie' })).toBe('فيلم');
  });

  it('fills anime logo, episode still and title from ani.zip once', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ mappings: { imdb_id: 'tt22248376' }, episodes: { 5: { image: 'https://img/5.jpg', title: { en: 'Phantoms of the Dead' } } } }) }; };
    const media = { kind: 'anime', seriesRef: 'anime:154587', episode: 5, title: 'Frieren', cover: 'https://img/cover.jpg' };
    const a = await resolveArt(media, { fetchImpl });
    expect(a).toEqual({ banner: 'https://img/5.jpg', logo: logoOfImdb('tt22248376'), title: 'Frieren', episodeTitle: 'Phantoms of the Dead' });
    await resolveArt(media, { fetchImpl });
    expect(calls).toBe(1);
  });

  it('keeps what the invite sent and never guesses without data', async () => {
    const offline = async () => { throw new TypeError('offline'); };
    const a = await resolveArt({ kind: 'anime', seriesRef: 'anime:1', episode: 2, title: 'X', cover: 'c.jpg' }, { fetchImpl: offline });
    expect(a).toEqual({ banner: 'c.jpg', logo: null, title: 'X', episodeTitle: null });
    const b = await resolveArt({ kind: 'cinema', seriesRef: 'cinema:tt0903747:2', banner: 'b.jpg', logo: 'l.png', title: 'Breaking Bad' }, { fetchImpl: offline });
    expect(b.logo).toBe('l.png');
    const c = await resolveArt({ kind: 'cinema', seriesRef: 'cinema:tt0903747:2', title: 'Breaking Bad' }, { fetchImpl: offline });
    expect(c.logo).toBe(logoOfImdb('tt0903747'));
  });
});
