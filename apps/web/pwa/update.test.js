import { describe, expect, it, vi, afterEach } from 'vitest';
import * as update from './update.js';
const { justUpdated, watchForUpdates } = update;
import { runMigrations } from '../lib/migrations.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function fakeWorker(state) {
  const handlers = [];
  return {
    state,
    sent: [],
    postMessage(msg) {
      this.sent.push(msg);
    },
    addEventListener: (_, fn) => handlers.push(fn),
    become(next) {
      this.state = next;
      handlers.forEach((fn) => fn());
    },
  };
}

function fakeRegistration() {
  const handlers = [];
  return { waiting: null, installing: null, updates: 0, update() { this.updates += 1; return Promise.resolve(); }, addEventListener: (_, fn) => handlers.push(fn), found(worker) { this.installing = worker; handlers.forEach((fn) => fn()); } };
}

const doc = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };

describe('PWA update', () => {
  afterEach(() => vi.useRealTimers());
  it('boot watching never checks or announces background workers, even after time and resume', async () => {
    vi.useFakeTimers();
    const reg = fakeRegistration();
    const ready = [];
    const visible = [];
    const doc = { visibilityState: 'visible', addEventListener: (_, fn) => visible.push(fn), removeEventListener() {} };
    const worker = fakeWorker('installed');
    reg.waiting = worker;
    const stop = watchForUpdates(reg, { onReady: (apply) => ready.push(apply), nav: { serviceWorker: { controller: {} } }, doc });
    reg.found(worker);
    worker.become('installed');
    visible.forEach(fn => fn());
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(reg.updates).toBe(0);
    expect(ready).toEqual([]);
    expect(worker.sent).toEqual([]);
    stop();
  });

  it('a manual download announces completion once and applies only on confirmation', async () => {
    globalThis.localStorage = memoryStorage();
    const reg = fakeRegistration();
    const worker = fakeWorker('installing');
    reg.installing = worker;
    const ready = [];
    expect(await update.checkForUpdates(reg, { onReady: apply => ready.push(apply) })).toBe('installing');
    worker.become('installed');
    worker.become('installed');
    expect(ready).toHaveLength(1);
    expect(worker.sent).toEqual([]);
    ready[0]();
    expect(worker.sent).toEqual(['skip-waiting']);
    expect(justUpdated(globalThis.localStorage)).toBe(true);
    expect(justUpdated(globalThis.localStorage)).toBe(false);
  });

  it('manual checking reports a waiting update without activating it', async () => {
    const reg = fakeRegistration();
    const worker = fakeWorker('installed');
    reg.waiting = worker;
    const ready = [];
    expect(await update.checkForUpdates(reg, { onReady: (apply) => ready.push(apply) })).toBe('available');
    expect(reg.updates).toBe(1);
    expect(ready).toHaveLength(1);
    expect(worker.sent).toEqual([]);
  });

  it('a manual network failure cannot report the current version as latest', async () => {
    const reg = fakeRegistration();
    reg.update = async () => { throw new Error('offline'); };
    expect(typeof update.checkForUpdates).toBe('function');
    await expect(update.checkForUpdates(reg)).rejects.toThrow('offline');
  });

  it('reports a current build and a download in progress separately', async () => {
    const reg = fakeRegistration();
    expect(await update.checkForUpdates(reg)).toBe('current');
    reg.installing = fakeWorker('installing');
    expect(await update.checkForUpdates(reg)).toBe('installing');
    expect(reg.installing.sent).toEqual([]);
  });

  it('cannot claim the latest version without a service worker registration', async () => {
    await expect(update.checkForUpdates(null)).rejects.toThrow('تعذّر الوصول');
  });

  it('never announces a changed build without a manual update', () => {
    const storage = memoryStorage();
    expect(justUpdated(storage, 'pwa-old')).toBe(false);
    expect(justUpdated(storage, 'pwa-new')).toBe(false);
    expect(justUpdated(storage, 'pwa-new')).toBe(false);
  });

  it('does not announce an older installed app upgrade without a manual request', () => {
    const storage = memoryStorage();
    const installed = { nav: { serviceWorker: { controller: {} } } };
    expect(justUpdated(storage, 'pwa-new', installed)).toBe(false);
    expect(justUpdated(storage, 'pwa-new', installed)).toBe(false);
  });

  it('does not mistake a fresh install without a controller for an upgrade', () => {
    expect(justUpdated(memoryStorage(), 'pwa-new', { nav: { serviceWorker: { controller: null } } })).toBe(false);
  });

  it('a first install (no page controlled yet) is not an update', () => {
    const reg = fakeRegistration();
    const ready = [];
    watchForUpdates(reg, { onReady: (apply) => ready.push(apply), nav: { serviceWorker: { controller: null } }, doc })();
    const worker = fakeWorker('installing');
    reg.found(worker);
    worker.become('installed');
    expect(ready).toHaveLength(0);
  });
});

describe('local data migrations', () => {
  it('runs each pending step once, in order, and stops at a failure without advancing', () => {
    const storage = memoryStorage();
    const ran = [];
    const migrations = [
      { version: 2, name: 'b', run: () => ran.push(2) },
      { version: 1, name: 'a', run: () => ran.push(1) },
      { version: 3, name: 'boom', run: () => { throw new Error('x'); } },
    ];
    expect(runMigrations({ storage, target: 3, migrations })).toEqual({ from: 0, to: 2, ok: false });
    expect(ran).toEqual([1, 2]);
    expect(storage.getItem('vantara.schema')).toBe('2');
    expect(runMigrations({ storage, target: 2, migrations })).toEqual({ from: 2, to: 2, ok: true });
    expect(ran).toEqual([1, 2]);
  });
});
