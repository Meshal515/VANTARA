import { describe, expect, it } from 'vitest';
import { justUpdated, watchForUpdates } from './update.js';
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
  it('announces a downloaded version once and applies it only when asked', () => {
    globalThis.localStorage = memoryStorage();
    const reg = fakeRegistration();
    const ready = [];
    const stop = watchForUpdates(reg, { onReady: (apply) => ready.push(apply), nav: { serviceWorker: { controller: {} } }, doc });
    const worker = fakeWorker('installing');
    reg.found(worker);
    expect(ready).toHaveLength(0);
    worker.become('installed');
    worker.become('installed');
    expect(ready).toHaveLength(1);
    expect(worker.sent).toEqual([]);
    ready[0]();
    expect(worker.sent).toEqual(['skip-waiting']);
    expect(justUpdated(globalThis.localStorage)).toBe(true);
    expect(justUpdated(globalThis.localStorage)).toBe(false);
    stop();
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
