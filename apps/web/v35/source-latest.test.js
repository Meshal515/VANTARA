import { expect, it, vi } from 'vitest';
import { createSourceLatest } from './source-latest.js';
import { _pending } from '../lib/source-report.js';

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

it('recovers shared snapshot discovery after a temporary initial outage', async () => {
  let online = false;
  const sync = { latestSnapshots: async () => { if (!online) throw new Error('offline'); return { sources: [{ sourceId: 's', fetchedAt: 100, value: { mangas: [{ title: 'shared' }] } }] }; } };
  const latest = createSourceLatest(sync, { now: () => 100 });
  await latest('s', async () => ({ mangas: [{ title: 'fallback' }] }));
  online = true;
  expect((await latest('s', async () => ({ mangas: [{ title: 'fallback' }] }))).mangas[0].title).toBe('shared');
});

it('does not silently call an expired shared snapshot a successful refresh', async () => {
  const sync = { latestSnapshots: async () => ({ sources: [{ sourceId: 's', fetchedAt: 1, value: { mangas: [] } }] }), claimLatest: async () => { throw new Error('sync offline'); } };
  const latest = createSourceLatest(sync, { now: () => 100_000 });
  await expect(latest('s', async () => { throw new Error('source offline'); })).rejects.toThrow('source offline');
});

it('a stalled snapshot transport leaves the source its own request budget', async () => {
  vi.useFakeTimers();
  try {
    const sync = { latestSnapshots: () => new Promise(() => {}) };
    const latest = createSourceLatest(sync);
    const request = latest('extension.installed#123', async () => {
      await new Promise((resolve) => setTimeout(resolve, 16_000));
      return { mangas: [{ title: 'Spy x Family' }] };
    });
    let value;
    request.then((result) => { value = result; });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(value).toEqual({ mangas: [{ title: 'Spy x Family' }] });
  } finally {
    vi.useRealTimers();
  }
});

it('reports a rejected source id even when the local extension returns its listing', async () => {
  const latest = createSourceLatest({
    latestSnapshots: async () => ({ sources: [] }),
    claimLatest: async () => { throw Object.assign(new Error('http_400'), { translationError: 'source' }); },
  });
  const mangas = [{ title: 'Spy x Family' }];
  expect(await latest('extension.mangamillion#123', async () => ({ mangas }))).toEqual({ mangas });
  expect(_pending()).toContainEqual(expect.objectContaining({ sourceId: 'extension.mangamillion.123', stage: 'snapshot_claim', outcome: 'error', reason: 'source_id_rejected' }));
});
