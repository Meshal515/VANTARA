import { expect, it, vi } from 'vitest';
import { createSourceLatest } from './source-latest.js';

it('reuses a source feed fetched by another device without calling its extension again', async () => {
  const snapshots = new Map();
  const sync = {
    latestSnapshots: async () => ({ sources: [...snapshots.values()] }),
    claimLatest: async (sourceId) => ({ claimed: !snapshots.has(sourceId), leaseUntil: 120_000 }),
    publishLatest: async (sourceId, value) => { snapshots.set(sourceId, { sourceId, value, fetchedAt: 100_000 }); },
  };
  const first = createSourceLatest(sync, { now: () => 100_000 });
  const fetchFirst = vi.fn(async () => ({ mangas: [{ title: 'عمل', url: '/one' }] }));
  expect((await first('source.ar', fetchFirst)).mangas).toHaveLength(1);
  await vi.waitFor(() => expect(snapshots.has('source.ar')).toBe(true));

  const second = createSourceLatest(sync, { now: () => 100_100 });
  const fetchAgain = vi.fn();
  expect((await second('source.ar', fetchAgain)).mangas[0].title).toBe('عمل');
  expect(fetchAgain).not.toHaveBeenCalled();
});
