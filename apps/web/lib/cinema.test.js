import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { artworkURL, canonicalTitle, normalizeSource, sameWork } from './cinema-meta.js';
import { episodeKey, ownerKey, readCinema, recordCinema, toggleSaved } from './cinema-library.js';
const memory = () => { const map = new Map(); return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; };
afterEach(() => { delete globalThis.Capacitor; vi.unstubAllGlobals(); vi.resetModules(); });
describe('Cinema identity', () => {
  it('uses the source artwork hash without substituting another work', () => {
    expect(artworkURL('https://tuktukhd.com/wp-content/uploads/2026/09/yBKMAIj7clP42UkFejhGDBBoTpb-2-500x750.webp?x93784')).toBe('https://image.tmdb.org/t/p/w500/yBKMAIj7clP42UkFejhGDBBoTpb.jpg');
    expect(artworkURL('https://tuktukhd.com/wp-content/uploads/2026/09/RBAaUJP47j1Sxeq92PwgerHwde-500x750.webp')).toBe('https://image.tmdb.org/t/p/w500/RBAaUJP47j1Sxeq92PwgerHwde.jpg');
    expect(artworkURL('https://other.test/something.webp')).toBe('https://other.test/something.webp');
    expect(artworkURL('https://tuktukhd.com/poster.webp')).toBe('https://tuktukhd.com/poster.webp');
  });
  it('keeps year and media type separate from a source title', () => {
    const movie = normalizeSource({ sourceId: 'cinema-tuktuk', url: 'https://tuktukhd.com/runner/', title: 'فيلم Runner 2026 مترجم اون لاين' });
    expect(movie).toMatchObject({ title: 'Runner', year: 2026, type: 'movie' });
    expect(canonicalTitle('مسلسل Irreplaceable الموسم 1 الحلقة 2 مترجم')).toBe('Irreplaceable');
  });
  it('does not match The Runner, a different year or a series to the film', () => {
    const wanted = { title: 'Runner', year: 2026, type: 'movie' };
    expect(sameWork(wanted, { ...wanted, title: 'The Runner' })).toBe(false);
    expect(sameWork(wanted, { ...wanted, year: 2025 })).toBe(false);
    expect(sameWork(wanted, { ...wanted, type: 'series' })).toBe(false);
    expect(sameWork(wanted, { ...wanted, title: 'RUNNER' })).toBe(true);
    expect(sameWork({ ...wanted, year: null }, wanted)).toBe(false);
  });
  it('distinguishes season two from season one and movies from numbered episodes', () => {
    expect(episodeKey('movie', 1, 1)).toBe('movie');
    expect(episodeKey('series', 1, 1)).toBe('s1e1');
    expect(episodeKey('series', 2, 1)).toBe('s2e1');
    expect(ownerKey('a')).not.toBe(ownerKey('b'));
  });
  it('records both seasons under the launching account without overwriting saved state', () => {
    const storage = memory(), work = { id: 'source:x:show', type: 'series', title: 'Show' };
    toggleSaved('a', work, storage);
    recordCinema('a', work, { season: 1, episode: 1, position: 1000, duration: 2000 }, storage);
    recordCinema('a', work, { season: 2, episode: 1, position: 1500, duration: 2000 }, storage);
    const entry = readCinema('a', storage)[work.id];
    expect(entry.saved).toBe(true);
    expect(Object.keys(entry.progress)).toEqual(['s1e1', 's2e1']);
    expect(entry.latest).toBe('s2e1');
    expect(readCinema('b', storage)).toEqual({});
  });
  it('rejects unusable progress and survives storage errors', () => {
    const storage = memory(), work = { id: 'movie', type: 'movie' };
    expect(recordCinema('a', work, { season: 1, episode: 1, position: NaN, duration: 2000 }, storage)).toBe(false);
    expect(readCinema('a', storage)).toEqual({});
    expect(readCinema('a', { getItem() { throw Error('blocked'); } })).toEqual({});
  });
});
describe('Cinema native bridge namespace', () => {
  beforeEach(() => vi.resetModules());
  it('shares a configure flight, and never configures the Anime manifest', async () => {
    const configure = vi.fn(async () => ({ ok: true }));
    globalThis.Capacitor = { Plugins: { AnimeEngine: { configure } } };
    const fetchImpl = vi.fn(async (url) => ({ ok: true, json: async () => ({ version: 1, sources: [] }) }));
    const engine = await import('./cinema-engine.js');
    await Promise.all([engine.configure({ fetchImpl }), engine.configure({ fetchImpl })]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe('/cinema/sources.json');
    expect(configure).toHaveBeenCalledWith({ content: 'cinema', manifest: { version: 1, sources: [] } });
  });
  it('allows a fresh configure after a failed request', async () => {
    globalThis.Capacitor = { Plugins: { AnimeEngine: { configure: async () => ({ ok: true }) } } };
    const engine = await import('./cinema-engine.js');
    await expect(engine.configure({ fetchImpl: async () => ({ ok: false }) })).rejects.toThrow();
    await expect(engine.configure({ fetchImpl: async () => ({ ok: true, json: async () => ({ version: 1, sources: [] }) }) })).resolves.toMatchObject({ version: 1 });
  });
});
describe('Public metadata cache', () => {
  it('coalesces concurrent reads and rejects invalid types', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ metas: [{ id: 'tt123', type: 'movie', name: 'Runner', releaseInfo: '2026' }] }) }));
    const { catalog } = await import('./cinema-meta.js');
    const [first, second] = await Promise.all([catalog('movie', { query: 'Runner', fetchImpl }), catalog('movie', { query: 'Runner', fetchImpl })]);
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(first).toEqual(second);
    await expect(catalog('anime', { fetchImpl })).rejects.toThrow();
  });
});
