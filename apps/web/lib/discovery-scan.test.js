import { expect, it, vi } from 'vitest';
import { scanDiscovery } from './discovery-scan.js';

it('rechecks known chapters and advances a catalogue page when Latest is unavailable', async () => {
  const now = Date.UTC(2026, 10, 23);
  const state = new Map();
  const source = { id: 'org.example#123' };
  const catalogue = vi.fn(async () => ({ mangas: [{ url: '/catalogued', title: 'Catalogued' }], hasNextPage: true }));
  const latest = vi.fn(async () => { throw new Error('unsupported'); });
  const chapters = vi.fn(async () => []);
  const knownEditions = async () => [{ source: { u: '/known' }, title: 'Known', lastChapterCheckAt: now - 7 * 86_400_000 }];
  const options = { catalogue, latest, chapters, knownEditions, readState: (key) => state.get(key), writeState: (key, value) => state.set(key, value), now };
  await scanDiscovery([source], options);
  expect(chapters.mock.calls.map(([, manga]) => manga.url)).toEqual(['/known', '/catalogued']);
  expect(state.get('source:org.example#123').cataloguePage).toBe(2);
  await scanDiscovery([source], { ...options, now: now + 1000 });
  expect(catalogue).toHaveBeenLastCalledWith(source, 2);
});

it('limits a pass to three sources and three chapter checks per source', async () => {
  const sources = Array.from({ length: 8 }, (_, number) => ({ id: String(number) }));
  const catalogue = vi.fn(async () => ({ mangas: Array.from({ length: 20 }, (_, n) => ({ url: '/' + n, title: String(n) })) }));
  const latest = vi.fn(async () => ({ mangas: [{ url: '/fresh', title: 'Fresh' }] }));
  const chapters = vi.fn(async () => []);
  await scanDiscovery(sources, { catalogue, latest, chapters, knownEditions: async () => [], readState: () => null, writeState: () => {} });
  expect(catalogue).toHaveBeenCalledTimes(3);
  expect(chapters).toHaveBeenCalledTimes(9);
  expect(latest).toHaveBeenCalledTimes(3);
  expect(chapters.mock.calls.filter(([, manga]) => manga.url === '/fresh')).toHaveLength(3);
});

it('backs off a failing source while another source still completes its batch', async () => {
  const state = new Map();
  const sources = [{ id: 'unavailable' }, { id: 'working' }];
  const catalogue = vi.fn(async (source) => {
    if (source.id === 'unavailable') throw new Error('offline');
    return { mangas: [{ url: '/work', title: 'Work' }] };
  });
  const chapters = vi.fn(async () => []);
  const options = { catalogue, latest: async () => ({}), chapters, knownEditions: async () => [],
    readState: (key) => state.get(key), writeState: (key, value) => state.set(key, value), now: 10_000 };
  await scanDiscovery(sources, options);
  await scanDiscovery(sources, { ...options, now: 11_000 });
  expect(catalogue.mock.calls.filter(([source]) => source.id === 'unavailable')).toHaveLength(1);
  expect(chapters.mock.calls.map(([source]) => source.id)).toEqual(['working', 'working']);
});
