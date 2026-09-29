import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { flushFollowTime } from './follow-time.js';
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
afterEach(() => { delete globalThis.Capacitor; });

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
