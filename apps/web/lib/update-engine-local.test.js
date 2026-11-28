import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectLocalTimeline, connectUpdates, timeline, setLegacyUpdateMode, legacyUpdatesAllowed } from './update-engine.js';
import { createIndexedDbBackend, openLatestStore } from './latest-store.js';

const ev = (id, at) => ({ id, work: 'w', section: 'manga', kind: 'chapter', number: at, title: 't', at, firstSeenAt: at, sources: [{ s: 'x' }] });

describe('الخط الزمني: المحلي بعد الهجرة، والخادم قبلها وعند الفشل', () => {
  it('قبل الاكتمال: الخادم كما كان', async () => {
    const send = vi.fn(async () => ({ status: 200, body: { events: [ev('srv', 1)], next: null } }));
    connectUpdates(send);
    connectLocalTimeline({ ready: () => false });
    expect((await timeline('manga')).events.map((e) => e.id)).toEqual(['srv']);
  });
  it('بعد الاكتمال: المحلي، والمرآة تجلب جديد الخادم أولًا', async () => {
    const store = openLatestStore({ account: 'ui-1', backend: createIndexedDbBackend(indexedDB) });
    await store.putEvents([ev('old', 5)], { pinned: true });
    const mirror = vi.fn(async () => { await store.putEvents([ev('new', 9)], { pinned: true }); });
    const send = vi.fn(); connectUpdates(send);
    connectLocalTimeline({ store, ready: () => true, mirror });
    const page = await timeline('anime');
    expect(page.local).toBe(true);
    expect((await timeline('manga')).events.map((e) => e.id)).toEqual(['new', 'old']);
    expect(send).not.toHaveBeenCalled();
  });
  it('فشل المخزن المحلي: يرجع للخادم بلا شاشة فارغة', async () => {
    const send = vi.fn(async () => ({ status: 200, body: { events: [ev('srv2', 1)], next: null } }));
    connectUpdates(send);
    connectLocalTimeline({ ready: () => true, mirror: async () => {}, store: { timeline: async () => { throw new Error('x'); } } });
    expect((await timeline('cinema')).events.map((e) => e.id)).toEqual(['srv2']);
  });
});

describe('94% modes', () => {
  afterEach(() => setLegacyUpdateMode('hybrid'));
  it('exclusive displays preserved local events but neither mirrors nor falls back', async () => {
    const store = openLatestStore({ account:'exclusive-test', backend:createIndexedDbBackend(indexedDB) });
    await store.putEvents([ev('saved',1)], { pinned:true });
    const mirror = vi.fn(), send = vi.fn();
    connectUpdates(send);
    connectLocalTimeline({store, ready:()=>true, mirror});
    setLegacyUpdateMode('exclusive');
    expect((await timeline('manga')).events.map(e=>e.id)).toEqual(['saved']);
    expect(mirror).not.toHaveBeenCalled();
    connectLocalTimeline({ready:()=>false});
    expect(await timeline('manga')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it('manga-local leaves anime and cinema paths open', () => {
    setLegacyUpdateMode('manga-local');
    expect(legacyUpdatesAllowed('manga')).toBe(false);
    expect(legacyUpdatesAllowed('anime')).toBe(true);
    expect(legacyUpdatesAllowed('cinema')).toBe(true);
  });
});
