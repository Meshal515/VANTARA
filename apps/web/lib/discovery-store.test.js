import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { createDiscoveryStore } from './discovery-store.js';

const day = 86_400_000;
const now = Date.UTC(2026, 10, 23, 12);
const sourceId = 'example.manga#8929911308540155494';
const sample = {
  work: 'ext:sample', section: 'manga', kind: 'chapter', title: 'Sample',
  source: { s: sourceId, u: '/sample', m: 'state' },
};
const make = (factory = new IDBFactory()) => createDiscoveryStore({ factory, keyRange: IDBKeyRange });

it('keeps a real publication time and separates the times of an undated observation', async () => {
  const factory = new IDBFactory();
  const initial = make(factory);
  await initial.record([{ ...sample, units: [{ number: 4 }, { number: 3 }] }], now - 8 * day);
  expect((await initial.timeline('manga')).events).toEqual([]);
  await initial.record([{ ...sample, units: [{ number: 6 }, { number: 5, publishedAt: now - 6 * day }] }], now);
  const reopened = make(factory);
  const { events, next } = await reopened.timeline('manga', { limit: 1 });
  expect(events).toMatchObject([{ number: 6, firstSeenAt: now, publishedAt: null, lastCheckedAt: now, updatedAt: now }]);
  expect(typeof next).toBe('string');
  expect((await reopened.timeline('manga', { before: next })).events)
    .toMatchObject([{ number: 5, publishedAt: now - 6 * day, firstSeenAt: now, lastCheckedAt: now, updatedAt: now }]);
});

it('keeps per-source evidence while deduplicating the same chapter', async () => {
  const store = make();
  await store.record([{ ...sample, units: [{ number: 4, publishedAt: now - 1000 }] }], now);
  await store.record([{ ...sample, source: { s: 'example.other#3', u: '/other' }, units: [{ number: 4, publishedAt: now - 2000 }] }], now + 1000);
  await store.record([{ ...sample, units: [{ number: 4, publishedAt: now - 1000 }] }], now + 2000);
  const { events } = await store.timeline('manga');
  expect(events).toMatchObject([{ number: 4, publishedAt: now - 2000, firstSeenAt: now, lastCheckedAt: now + 2000, updatedAt: now + 1000 }]);
  expect(events[0].sources.map(({ s }) => s).sort()).toEqual([sourceId, 'example.other#3']);
  expect(await store.knownEditions(sourceId)).toMatchObject([{ work: 'ext:sample', source: { s: sourceId, u: '/sample' }, lastCheckedAt: now + 2000 }]);
});

it('discards future dates and first batches that claim all old chapters were published together', async () => {
  const store = make();
  const units = Array.from({ length: 12 }, (_, i) => ({ number: i + 1, publishedAt: now }));
  units.push({ number: 13, publishedAt: now + day });
  await store.record([{ ...sample, units }], now);
  expect((await store.timeline('manga')).events).toEqual([]);
});
