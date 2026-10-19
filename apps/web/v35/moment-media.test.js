import { describe, expect, it, vi } from 'vitest';
import { createMomentMediaCache, createMomentSourceCache, momentOf, safeMediaUrl } from './moment-media.js';

const row = (moment) => ({ series_ref: 'cinema:movie:1', moment_json: JSON.stringify(moment) });
describe('shared moment media', () => {
  it('keeps source episode times separate from the trimmed clip timeline', () => {
    expect(momentOf(row({ version: 1, startMs: 10000, endMs: 30000, episode: 3, mediaKey: 'abc' }))).toMatchObject({ startMs: 10000, endMs: 30000, episode: 3, mediaKey: 'abc', trimmed: true });
    expect(momentOf({ series_ref: 'anime:1', chapter_label: 'الحلقة3 ·0:10–0:30' })).toMatchObject({ startMs: 10000, endMs: 30000, episode: 3, trimmed: false });
    expect(momentOf({ series_ref: 'anime:1', moment_json: '{broken', chapter_label: 'الحلقة3 ·0:10–0:30' })).toMatchObject({ startMs: 10000, trimmed: false });
    expect(momentOf({ series_ref: 'ext:1', chapter_label: 'الفصل 3 ·0:10–0:30' })).toBeNull();
    expect(momentOf(row({ version: 1, startMs: 10000, endMs: 30000, episode: 3 }))).toMatchObject({ trimmed: false, startMs: 10000 });
    expect(momentOf(row({ version: 1, startMs: 30000, endMs: 10000, mediaKey: 'abc' }))).toBeNull();
  });
  it('rejects credential-bearing and active-content media URLs', () => {
    expect(safeMediaUrl('https://media.example/v1/media/abc')).toBeTruthy();
    expect(safeMediaUrl('https://user:secret@media.example/clip.mp4')).toBeNull();
    expect(safeMediaUrl('javascript:alert(1)')).toBeNull();
  });
  it('deduplicates downloads, omits credentials and evicts least-recent unleased media', async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(['clip'], { type: 'video/mp4' })));
    const revoke = vi.fn(); let id = 0;
    const cache = createMomentMediaCache({ fetcher, maxEntries: 1, createUrl: () => `blob:${++id}`, revokeUrl: revoke });
    const [first, same] = await Promise.all([cache.acquire('https://media.example/v1/media/a'), cache.acquire('https://media.example/v1/media/a')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
    first.release(); same.release();
    const next = await cache.acquire('https://media.example/v1/media/b'); next.release();
    expect(revoke).toHaveBeenCalledWith('blob:1');
    expect(cache.stats().entries).toBe(1);
    cache.clear();
  });
  it('bounds download concurrency and cancels a queued request on abort', async () => {
    const pending = []; let active = 0; let high = 0;
    const fetcher = vi.fn(() => new Promise((resolve) => { active++; high = Math.max(high, active); pending.push(() => { active--; resolve(new Response('clip')); }); }));
    const cache = createMomentMediaCache({ fetcher, createUrl: () => 'blob:test', revokeUrl: () => {}, concurrency: 2 });
    const a = cache.acquire('https://media.example/v1/media/a');
    const b = cache.acquire('https://media.example/v1/media/b');
    const controller = new AbortController();
    const c = cache.acquire('https://media.example/v1/media/c', { signal: controller.signal }).catch((e) => e.name);
    controller.abort();
    await Promise.resolve();
    pending.splice(0).forEach((done) => done());
    const leases = await Promise.all([a, b]);
    expect(await c).toBe('AbortError');
    expect(high).toBe(2); expect(fetcher).toHaveBeenCalledTimes(2);
    leases.forEach((lease) => lease.release()); cache.clear();
  });
  it('rejects oversized clips before reading their bodies', async () => {
    const cache = createMomentMediaCache({ fetcher: async () => new Response('large', { headers: { 'content-length': String(17 * 1024 * 1024) } }) });
    await expect(cache.acquire('https://media.example/v1/media/a')).rejects.toThrow(/size/i);
    cache.clear();
  });
  it('reuses prepared source descriptors and releases sessions when they are evicted', async () => {
    const release = vi.fn();
    const resolver = vi.fn(async (row) => [{ url: `https://source.example/${row.id}.mp4`, release }]);
    const cache = createMomentSourceCache(resolver, { maxEntries: 1 });
    const a = await cache.acquire({ id: 'a' }); a.release();
    const same = await cache.acquire({ id: 'a' }); same.release();
    expect(resolver).toHaveBeenCalledTimes(1);
    const b = await cache.acquire({ id: 'b' }); b.release();
    expect(release).toHaveBeenCalledTimes(1);
    cache.clear(); expect(release).toHaveBeenCalledTimes(2);
  });
});
