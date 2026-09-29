import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { collectFollowTime, flushFollowTime, listenFollowForeground } from './follow-time.js';
import { createSync } from './sync.js';

let store;
let full;
beforeEach(() => {
  full = false;
  store = new Map([
    ['vantara.token', 't'], ['vantara.user', JSON.stringify({ userId: 'u1' })], ['vantara.public-views.v1', '1'],
  ]);
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { if (full) throw new Error('quota'); store.set(key, value); },
    removeItem: (key) => store.delete(key),
  };
  globalThis.fetch = async () => { throw new Error('offline'); };
});
afterEach(() => {
  delete globalThis.Capacitor;
  delete globalThis.document;
});

const item = { id: 'immutable-native-credit', owner: { userId: 'u1', section: 'anime', seriesRef: 'anime:1', title: 'One', coverUrl: null }, day: '2026-09-29', activeMs: 60000 };

it('retries a lost native acknowledgement without adding the minute twice', async () => {
  let rejectAck = true;
  let pending = [item];
  globalThis.Capacitor = { Plugins: { FollowTime: {
    pending: async () => ({ items: pending }),
    acknowledge: async ({ userId, ids }) => {
      if (rejectAck) throw new Error('bridge interrupted');
      pending = pending.filter(x => x.owner.userId !== userId || !ids.includes(x.id));
    },
  } } };
  const sync = createSync({ baseUrl: 'https://sync.test' });
  await expect(flushFollowTime(sync)).rejects.toThrow('bridge interrupted');
  rejectAck = false;
  await flushFollowTime(sync);
  const queue = JSON.parse(store.get('vantara.queue'));
  expect(queue.filter(x => x.kind === 'usage.work').map(x => x.payload.activeMs)).toEqual([60000]);
  expect(queue.filter(x => x.kind === 'usage.watch').map(x => x.payload.activeMs)).toEqual([60000]);
  expect(pending).toEqual([]);
});

it('leaves the native credit untouched when the local sync queue cannot be saved', async () => {
  let pending = [item];
  globalThis.Capacitor = { Plugins: { FollowTime: {
    pending: async () => ({ items: pending }),
    acknowledge: async () => { pending = []; },
  } } };
  const sync = createSync({ baseUrl: 'https://sync.test' });
  full = true;
  await expect(flushFollowTime(sync)).rejects.toThrow();
  expect(pending).toEqual([item]);
});

it('drains a six-episode backlog instead of showing only the first hundred minutes', async () => {
  let pending = Array.from({ length: 156 }, (_, i) => ({ ...item, id: `credit-${i}` }));
  globalThis.Capacitor = { Plugins: { FollowTime: {
    pending: async () => ({ items: pending.slice(0, 100) }),
    acknowledge: async ({ ids }) => { pending = pending.filter(x => !ids.includes(x.id)); },
  } } };
  const sync = createSync({ baseUrl: 'https://sync.test' });
  await flushFollowTime(sync);
  expect(pending).toEqual([]);
  expect(JSON.parse(store.get('vantara.queue')).filter(x => x.kind === 'usage.work').reduce((sum, x) => sum + x.payload.activeMs, 0)).toBe(9360000);
});


it('never lets a broken native listener registration abort startup', () => {
  const add = vi.fn();
  const remove = vi.fn();
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: add,
    removeEventListener: remove,
  };
  globalThis.Capacitor = { Plugins: { FollowTime: {
    addListener: () => { throw new Error('native bridge not ready'); },
    pending: async () => ({ items: [] }),
    acknowledge: async () => {},
  } } };
  const sync = createSync({ baseUrl: 'https://sync.test' });

  let stop;
  expect(() => { stop = collectFollowTime(sync); }).not.toThrow();
  expect(typeof stop).toBe('function');
  expect(() => stop()).not.toThrow();
  expect(add).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
});

it('accepts a direct listener handle as well as Capacitor promise handles', () => {
  const handle = { remove: vi.fn() };
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  globalThis.Capacitor = { Plugins: { FollowTime: {
    addListener: () => handle,
    pending: async () => ({ items: [] }),
    acknowledge: async () => {},
  } } };
  const sync = createSync({ baseUrl: 'https://sync.test' });
  const stop = collectFollowTime(sync);
  stop();
  expect(handle.remove).toHaveBeenCalledTimes(1);
});


it('native foreground listener failures degrade to a no-op', () => {
  globalThis.Capacitor = { Plugins: { FollowTime: {
    addListener: () => { throw new Error('bridge not ready'); },
  } } };
  const seen = [];
  let stop;
  expect(() => { stop = listenFollowForeground((event) => seen.push(event)); }).not.toThrow();
  expect(typeof stop).toBe('function');
  expect(() => stop()).not.toThrow();
  expect(seen).toEqual([]);
});

it('native foreground listener accepts a direct handle without requiring .then()', () => {
  const handle = { remove: vi.fn() };
  globalThis.Capacitor = { Plugins: { FollowTime: {
    addListener: () => handle,
  } } };
  const stop = listenFollowForeground(() => {});
  expect(() => stop()).not.toThrow();
  expect(handle.remove).toHaveBeenCalledTimes(1);
});
