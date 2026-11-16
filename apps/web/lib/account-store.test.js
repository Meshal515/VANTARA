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

it('never writes to the Android file during continuous scrolling, even past the 60 s deferral', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const page = fakePage();
  try {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const writes = recordingBackup();
    const store = createAccountStore({ page });
    await store.write('snapshot', 'u1', { cursor: 5, mirror: {} });
    // Two minutes of fling: a scroll event every frame-ish, short gaps (<300ms) only.
    for (let t = 0; t < 120_000; t += 250) {
      page.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(writes).toHaveLength(0);
    // Overdue: the first real pause (fling ended) is enough, no need for the full 1.5 s.
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it('waits while a finger rests on the screen without scrolling', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const page = fakePage();
  try {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const writes = recordingBackup();
    const store = createAccountStore({ page });
    page.dispatchEvent(new Event('touchstart'));
    await store.write('queue', 'u1', { ops: [] });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(writes).toHaveLength(0);
    page.dispatchEvent(new Event('touchend'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(700);
    expect(writes).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps an owed Android record when the bridge write fails, retrying a bounded number of times', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const page = fakePage();
  try {
    vi.stubGlobal('indexedDB', new IDBFactory());
    let attempts = 0;
    let failing = 1;
    const files = new Map();
    vi.stubGlobal('Capacitor', { Plugins: { AccountBackup: {
      async write({ userId, kind, value }) { attempts += 1; if (failing-- > 0) throw new Error('disk busy'); files.set(`${userId}/${kind}`, value); },
      async read({ userId, kind }) { return { value: files.get(`${userId}/${kind}`) ?? null }; },
    } } });
    const store = createAccountStore({ page });
    await store.write('snapshot', 'u1', { cursor: 6, mirror: {} });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(attempts).toBe(2);
    expect(JSON.parse(files.get('u1/snapshot'))).toMatchObject({ cursor: 6 });
    // A permanently failing file is tried NATIVE_ATTEMPTS (3) times, then left to IndexedDB.
    attempts = 0;
    failing = Infinity;
    await store.write('queue', 'u1', { ops: [] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(3);
  } finally {
    vi.useRealTimers();
  }
});

it('reads an owed record from memory instead of sending it across the bridge', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const page = fakePage();
  try {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const writes = recordingBackup();
    const store = createAccountStore({ page });
    page.dispatchEvent(new Event('scroll'));
    await store.write('snapshot', 'u1', { cursor: 7, mirror: {} });
    expect(await store.read('snapshot', 'u1')).toMatchObject({ cursor: 7 });
    expect(writes).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

it('never lets an older record overwrite a newer one in the Android file', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const page = fakePage();
  try {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const pending = [];
    let file = null;
    vi.stubGlobal('Capacitor', { Plugins: { AccountBackup: {
      write({ value }) { return new Promise((resolve, reject) => pending.push({ value, resolve, reject })); },
      async read() { return { value: file }; },
    } } });
    const store = createAccountStore({ page });
    await store.write('snapshot', 'u1', { cursor: 1, mirror: {} });
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    await store.write('snapshot', 'u1', { cursor: 2, mirror: {} });
    page.dispatchEvent(new Event('visibilitychange'));
    expect(pending.map((p) => JSON.parse(p.value).cursor)).toEqual([1, 2]);
    // The older write fails after the newer was sent: it must not be queued again.
    pending[0].reject(new Error('disk busy'));
    file = pending[1].value;
    pending[1].resolve();
    page.visibilityState = 'visible';
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending).toHaveLength(2);
    expect(JSON.parse(file)).toMatchObject({ cursor: 2 });
  } finally {
    vi.useRealTimers();
  }
});

it('restores the account snapshot and queue after a sudden kill, and keeps the last calm Android copy if WebView storage is lost', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const page = fakePage();
  try {
    const webview = new IDBFactory();
    vi.stubGlobal('indexedDB', webview);
    recordingBackup();
    const store = createAccountStore({ page });
    await store.write('snapshot', 'u1', { cursor: 10, mirror: { library: { a: {} } } });
    await store.write('queue', 'u1', { ops: [{ opId: 'calm' }] });
    await vi.advanceTimersByTimeAsync(2_000);
    // Reading on: newer records reach IndexedDB, the Android copy is still owed when the app is killed.
    page.dispatchEvent(new Event('scroll'));
    await store.write('snapshot', 'u1', { cursor: 11, mirror: { library: { a: {}, b: {} } } });
    await store.write('queue', 'u1', { ops: [{ opId: 'calm' }, { opId: 'latest' }] });
    // Killed: no flush, no timers. Restart with the same WebView storage.
    const restarted = createAccountStore({ page: fakePage() });
    expect(await restarted.read('snapshot', 'u1')).toMatchObject({ cursor: 11 });
    expect(await restarted.read('queue', 'u1')).toMatchObject({ ops: [{ opId: 'calm' }, { opId: 'latest' }] });
    // WebView storage wiped as well: the Android file still holds the last calm copy, never nothing.
    vi.stubGlobal('indexedDB', new IDBFactory());
    const wiped = createAccountStore({ page: fakePage() });
    expect(await wiped.read('snapshot', 'u1')).toMatchObject({ cursor: 10 });
    expect(await wiped.read('queue', 'u1')).toMatchObject({ ops: [{ opId: 'calm' }] });
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
