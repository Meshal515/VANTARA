import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createAccountStore } from './account-store.js';

afterEach(() => vi.unstubAllGlobals());

it('retains a transactional account snapshot and cursor when a later transaction aborts', async () => {
  const factory = new IDBFactory();
  vi.stubGlobal('indexedDB', factory);
  const store = createAccountStore();
  expect(await store.write('snapshot', 'u1', { cursor: 7, mirror: { library: { old: { title: 'keep' } } } })).toBe(true);
  const request = factory.open('vantara-account-recovery', 1);
  const db = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
  const tx = db.transaction('snapshot', 'readwrite');
  tx.objectStore('snapshot').put({ userId: 'u1', cursor: 99, mirror: {} }, 'u1');
  tx.abort();
  expect(await store.read('snapshot', 'u1')).toMatchObject({ cursor: 7, mirror: { library: { old: { title: 'keep' } } } });
  expect(await store.read('snapshot', 'u2')).toBeNull();
});

it('uses the independent Android file when IndexedDB is unavailable', async () => {
  vi.stubGlobal('indexedDB', { open() { throw new DOMException('full', 'QuotaExceededError'); } });
  const files = new Map();
  vi.stubGlobal('Capacitor', { Plugins: { AccountBackup: {
    async write({ userId, kind, value }) { files.set(`${userId}/${kind}`, value); },
    async read({ userId, kind }) { return { value: files.get(`${userId}/${kind}`) ?? null }; },
  } } });
  const store = createAccountStore();
  expect(await store.write('snapshot', 'u1', { cursor: 8, mirror: { library: { a: {} } } })).toBe(true);
  expect(await store.write('queue', 'u1', { ops: [{ opId: 'pending' }] })).toBe(true);
  const reopened = createAccountStore();
  expect(await reopened.read('snapshot', 'u1')).toMatchObject({ cursor: 8 });
  expect(await reopened.read('queue', 'u1')).toMatchObject({ ops: [{ opId: 'pending' }] });
  expect(await reopened.read('snapshot', 'u2')).toBeNull();
});

it('keeps IndexedDB usable when Android backup fails and rejects wrong-account backup records', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('Capacitor', { Plugins: { AccountBackup: {
    async write() { throw new Error('disk full'); },
    async read() { return { value: JSON.stringify({ userId: 'u2', cursor: 900 }) }; },
  } } });
  const store = createAccountStore();
  expect(await store.write('snapshot', 'u1', { cursor: 9, mirror: {} })).toBe(true);
  expect(await store.read('snapshot', 'u1')).toMatchObject({ userId: 'u1', cursor: 9 });
  expect(await store.read('queue', 'u1')).toBeNull();
});
