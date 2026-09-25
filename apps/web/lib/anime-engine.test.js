import { afterEach, describe, expect, it, vi } from 'vitest';
import { available, clock, configure, groupRoutes, momentLabel, momentStart, pickWork, upsertRoute } from './anime-engine.js';

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

  it('groups servers by quality like the native sheet, unavailable last', () => {
    const r = (id, quality, state) => ({ id, code: id.toUpperCase(), quality, state });
    const groups = groupRoutes([r('a', 720, 'READY'), r('b', 1080, 'RESOLVING'), r('c', null, 'UNAVAILABLE'), r('d', 1080, 'READY'), r('e', null, 'FAILED')]);
    expect(groups.map((g) => g[0])).toEqual(['1080p', '720p', 'جودة غير محددة', 'غير متاح']);
    expect(groups[0][1].map((x) => x.id)).toEqual(['d', 'b']);
  });

  it('upserts a route update in place', () => {
    const list = [{ id: 'x', state: 'RESOLVING' }];
    expect(upsertRoute(list, { id: 'x', state: 'READY' })).toEqual([{ id: 'x', state: 'READY' }]);
    expect(upsertRoute(list, { id: 'y', state: 'READY' })).toHaveLength(2);
  });

  it('round-trips a shared moment through its Majlis label', () => {
    const label = momentLabel(12, 730_000, 740_000);
    expect(label).toBe('الحلقة 12 · 12:10–12:20');
    expect(momentStart(label)).toBe(730_000);
    expect(momentStart('الحلقة 12')).toBe(null);
    expect(clock(3_725_000)).toBe('1:02:05');
    expect(momentStart(momentLabel(3, 3_725_000, 3_730_000))).toBe(3_725_000);
  });
});
