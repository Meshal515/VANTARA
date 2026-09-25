import { afterEach, describe, expect, it, vi } from 'vitest';
import { available, configure, pickWork } from './anime-engine.js';

const work = (title, ...copies) => ({ key: title, title, thumbnail: null, copies: copies.map((c) => ({ sourceId: c, url: `/${c}`, title })) });

describe('anime-engine bridge', () => {
  afterEach(() => {
    delete globalThis.Capacitor;
  });

  it('is absent on the web and returns null instead of fake data', async () => {
    expect(available()).toBe(false);
    expect(await configure()).toBe(null);
  });

  it('sends the bundled manifest to the native engine once', async () => {
    const plugin = { configure: vi.fn(async () => ({ ok: true, errors: [] })) };
    globalThis.Capacitor = { Plugins: { AnimeEngine: plugin } };
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ sources: [] }) }));
    await configure({ force: true, fetchImpl });
    await configure({ fetchImpl });
    expect(plugin.configure).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/anime/sources.json', { cache: 'no-cache' });
  });

  it('rejects a manifest the engine refuses', async () => {
    globalThis.Capacitor = { Plugins: { AnimeEngine: { configure: async () => ({ ok: false, errors: ['x: sha256'] }) } } };
    await expect(configure({ force: true, fetchImpl: async () => ({ json: async () => ({}) }) })).rejects.toThrow('sha256');
  });

  it('picks the work whose copy title matches exactly', () => {
    const works = [work('One Piece Film Red', 'a'), work('ONE PIECE', 'b', 'c')];
    expect(pickWork(works, ['One Piece', 'ワンピース']).copies.length).toBe(2);
  });

  it('refuses a weak match rather than playing the wrong anime', () => {
    expect(pickWork([work('Naruto Shippuden', 'a')], ['Naruto: The Movie Special Edition'])).toBe(null);
  });
});
