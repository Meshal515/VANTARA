import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { createDiscoveryStore, createSqliteDiscoveryStore } from './discovery-store.js';

const day = 86_400_000;
const now = Date.UTC(2026, 10, 23, 12);
const sourceId = 'example.manga#8929911308540155494';
const sample = {
  work: 'ext:sample', section: 'manga', kind: 'chapter', title: 'Sample',
  source: { s: sourceId, u: '/sample', m: 'state' },
};
const make = (factory = new IDBFactory()) => createDiscoveryStore({ factory, keyRange: IDBKeyRange });

it('keeps provider context in the current session and excludes private links from the archive', async () => {
  const factory = new IDBFactory();
  const store = make(factory);
  const providerContext = '{"session":"example-session"}';
  await store.record([{
    ...sample, source: { s: sourceId, u: '/sample?work_id=45', m: providerContext },
    cover: 'https://img.example/sample.jpg?token=example-cover', units: [{ number: 4, publishedAt: now - 1000 }],
  }, {
    ...sample, work: 'ext:private', title: 'Private link',
    source: { s: sourceId, u: '/private?sig=example-private' }, units: [{ number: 1, publishedAt: now - 2000 }],
  }], now);
  expect((await store.knownEditions(sourceId)).find((row) => row.work === sample.work).source.m).toBe(providerContext);

  const reopened = make(factory);
  const events = (await reopened.timeline('manga')).events;
  const editions = await reopened.knownEditions(sourceId);
  expect(events.find((row) => row.work === sample.work)).toMatchObject({ cover: null, sources: [{ s: sourceId, u: '/sample?work_id=45', c: true }] });
  expect(events.find((row) => row.work === 'ext:private').sources[0]).not.toHaveProperty('u');
  expect(JSON.stringify({ events, editions })).not.toMatch(/example-(?:session|cover|private)/);
});

it('pages large discovery batches while preserving the first undated baseline and every later advance', async () => {
  let rev = 0;
  const editions = new Map(), events = new Map();
  const store = createSqliteDiscoveryStore(async (request) => {
    expect(request.editions.length + request.events.length).toBeLessThanOrEqual(128);
    if (request.action === 'snapshot') return {
      rev,
      editions: request.editions.map((key) => editions.get(key)).filter(Boolean),
      events: request.events.map((key) => events.get(key)).filter(Boolean),
    };
    expect(request.rev).toBe(rev++);
    for (const row of request.editions) editions.set(row.id, row);
    for (const row of request.events) events.set(row.id, row);
    return { committed: true };
  });
  const chapters = (length) => Array.from({ length }, (_, index) => ({ number: index + 1 }));
  await store.record([{ ...sample, units: chapters(140) }], now - day);
  expect(events.size).toBe(0);
  await store.record([{ ...sample, units: chapters(290) }], now);
  expect(events.size).toBe(150);
  expect(editions.values().next().value.baselines).toEqual([[0, 290]]);
});

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
