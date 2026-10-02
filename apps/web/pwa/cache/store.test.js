import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createStore } from './store.js';

const MB = 1024 * 1024;
const small = { meta: { ttlMs: 1000, maxBytes: 1 * MB }, source: { ttlMs: 1000, maxBytes: 10_000 }, health: { ttlMs: 1000, maxBytes: MB }, state: { ttlMs: Infinity, maxBytes: MB } };

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe('pwa cache store', () => {
  it('serves a fresh entry, then marks it stale after its ttl instead of losing it', async () => {
    const c = clock();
    const store = createStore({ indexedDB: new IDBFactory(), now: c.now, spaces: small });
    await store.set('meta', 'work:1', { title: 'One Piece' });
    expect(await store.get('meta', 'work:1')).toMatchObject({ value: { title: 'One Piece' }, stale: false });
    c.advance(1001);
    expect(await store.get('meta', 'work:1')).toMatchObject({ value: { title: 'One Piece' }, stale: true });
    expect(await store.backendKind()).toBe('indexeddb');
  });

  it('cached(): network when stale, the old value when the network fails, and one load for concurrent callers', async () => {
    const c = clock();
    const store = createStore({ indexedDB: new IDBFactory(), now: c.now, spaces: small });
    let calls = 0;
    const load = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return { n: calls };
    };
    const [a, b] = await Promise.all([store.cached('source', 'q', load), store.cached('source', 'q', load)]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect((await store.cached('source', 'q', load)).source).toBe('cache');
    c.advance(5000);
    const offline = await store.cached('source', 'q', async () => {
      throw new Error('offline');
    });
    expect(offline).toMatchObject({ value: { n: 1 }, stale: true });
    await expect(store.cached('source', 'never-seen', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });

  it('evicts the least recently used entries once a space passes its size limit', async () => {
    const c = clock();
    const store = createStore({ indexedDB: new IDBFactory(), now: c.now, spaces: small });
    const blob = 'x'.repeat(900); // ~1.8KB لكل مدخل، والحد 10KB
    for (let i = 0; i < 8; i += 1) {
      await store.set('source', `k${i}`, blob);
      c.advance(10);
    }
    c.advance(11 * 60 * 1000);
    await store.get('source', 'k0'); // k0 استُعمل للتو: يبقى
    await new Promise((r) => setTimeout(r, 10));
    await store.sweep();
    const usage = await store.usage();
    expect(usage.source.bytes).toBeLessThanOrEqual(10_000 * 0.8);
    expect(await store.get('source', 'k0')).not.toBeNull();
    expect(await store.get('source', 'k1')).toBeNull();
  });

  it('refuses a single entry bigger than a quarter of its space', async () => {
    const store = createStore({ indexedDB: new IDBFactory(), spaces: small });
    expect(await store.set('source', 'huge', 'y'.repeat(5000))).toBe(false);
    expect(await store.get('source', 'huge')).toBeNull();
  });

  it('drops a corrupt entry and reports it as missing', async () => {
    const factory = new IDBFactory();
    const store = createStore({ indexedDB: factory, spaces: small });
    await store.set('meta', 'ok', 1);
    // نكتب مدخلًا بلا شكل صحيح مباشرة في القاعدة
    const db = await new Promise((resolve) => {
      const r = factory.open('vantara-pwa', 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction('entries', 'readwrite');
      tx.objectStore('entries').put({ id: 'meta\u0000bad', ns: 'meta', key: 'bad' });
      tx.oncomplete = resolve;
    });
    db.close();
    expect(await store.get('meta', 'bad')).toBeNull();
    expect(await store.get('meta', 'ok')).toMatchObject({ value: 1 });
  });

  it('rebuilds a database that cannot be opened, and falls back to memory if that fails too', async () => {
    const recovered = [];
    // قاعدة بنسخة أعلى من نسختنا: الفتح يفشل بـVersionError
    const factory = new IDBFactory();
    await new Promise((resolve) => {
      const r = factory.open('vantara-pwa', 99);
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
    });
    const store = createStore({ indexedDB: factory, spaces: small, onRecover: (w) => recovered.push(w) });
    expect(await store.set('meta', 'a', 1)).toBe(true);
    expect(await store.get('meta', 'a')).toMatchObject({ value: 1 });
    expect(recovered[0]).toMatch(/^reset:/);
    expect(await store.backendKind()).toBe('indexeddb');

    const broken = { open() { throw new Error('denied'); }, deleteDatabase() { throw new Error('denied'); } };
    const memory = createStore({ indexedDB: broken, spaces: small });
    await memory.set('meta', 'b', 2);
    expect(await memory.get('meta', 'b')).toMatchObject({ value: 2 });
    expect(await memory.backendKind()).toBe('memory');
  });

  it('works without IndexedDB at all (private browsing)', async () => {
    const store = createStore({ indexedDB: null, spaces: small });
    await store.set('state', 'grant', { g: 1 });
    expect(await store.get('state', 'grant')).toMatchObject({ value: { g: 1 }, stale: false });
  });
});
