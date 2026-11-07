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

// Capacitor 6 parses every JS→native message on Android's main thread, the thread that drives
// WebView touch and fling. A whole-mirror backup there stalled the reader mid-scroll (Debug APK
// report: JSONTokener 158–256ms on main). The native copy must wait for a calm moment.
function fakePage() {
  const page = new EventTarget();
  page.visibilityState = 'visible';
  return page;
}

function recordingBackup() {
  const writes = [];
  const files = new Map();
  vi.stubGlobal('Capacitor', { Plugins: { AccountBackup: {
    async write({ userId, kind, value }) { writes.push({ userId, kind, value: JSON.parse(value) }); files.set(`${userId}/${kind}`, value); },
    async read({ userId, kind }) { return { value: files.get(`${userId}/${kind}`) ?? null }; },
  } } });
  return writes;
}

it('defers the Android copy while the user scrolls and sends only the latest record once calm', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const page = fakePage();
  try {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const writes = recordingBackup();
    const store = createAccountStore({ page });
    for (let cursor = 1; cursor <= 3; cursor += 1) {
      page.dispatchEvent(new Event('scroll'));
      expect(await store.write('snapshot', 'u1', { cursor, mirror: {} })).toBe(true);
      await vi.advanceTimersByTimeAsync(500);
    }
    // Still scrolling: nothing crossed the bridge yet, IndexedDB already holds the latest.
    page.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes).toHaveLength(0);
    expect(await createAccountStore({ page }).read('snapshot', 'u1')).toMatchObject({ cursor: 3 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ userId: 'u1', kind: 'snapshot', value: { cursor: 3 } });
  } finally {
    vi.useRealTimers();
  }
});

it('flushes the deferred Android copy as soon as the app is hidden', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const page = fakePage();
  try {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const writes = recordingBackup();
    const store = createAccountStore({ page });
    page.dispatchEvent(new Event('touchstart'));
    await store.write('queue', 'u1', { ops: [{ opId: 'progress' }] });
    expect(writes).toHaveLength(0);
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toMatchObject([{ kind: 'queue', value: { ops: [{ opId: 'progress' }] } }]);
  } finally {
    vi.useRealTimers();
  }
});

it('never lets continuous scrolling starve the Android copy forever', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const page = fakePage();
  try {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const writes = recordingBackup();
    const store = createAccountStore({ page });
    await store.write('snapshot', 'u1', { cursor: 5, mirror: {} });
    for (let t = 0; t < 61_000; t += 250) {
      page.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(writes).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it('reads a deferred Android record before it crosses the bridge', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const page = fakePage();
  try {
    vi.stubGlobal('indexedDB', { open() { throw new DOMException('full', 'QuotaExceededError'); } });
    recordingBackup();
    const store = createAccountStore({ page });
    // No IndexedDB: the Android file is the only copy, so it is written now, not deferred.
    page.dispatchEvent(new Event('scroll'));
    expect(await store.write('snapshot', 'u1', { cursor: 4, mirror: {} })).toBe(true);
    expect(await createAccountStore({ page }).read('snapshot', 'u1')).toMatchObject({ cursor: 4 });
  } finally {
    vi.useRealTimers();
  }
});
