import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createSync } from './sync.js';
import { createSessionStore } from './session-store.js';
import { createAccountStore } from './account-store.js';

const A = { userId: 'ownership-fixture-A' };
const B = { userId: 'ownership-fixture-B' };
const DEVICE = 'ownership-fixture-device';
const CREDENTIAL = 'ownership-fixture-credential-at-least-32';
const A_OP = { opId: 'A-private-edit', kind: 'favorite.set', payload: { seriesRef: 'A-private-title', member: true }, at: 1 };
const A_MIRROR = { library: { privateA: { user_id: A.userId, series_ref: 'A-private-title' } } };
const clients = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.unstubAllGlobals();
});

async function fixture() {
  const values = new Map([
    ['vantara.device.id', DEVICE], ['vantara.device.credential', CREDENTIAL],
    ['vantara.public-views.v1', '1'], ['vantara.private-usage.v1', '1'],
    ['vantara.user', JSON.stringify(A)], ['vantara.token', 'token-A'],
    ['vantara.session.v1', JSON.stringify({ token: 'token-A', user: A, savedAt: 100 })],
    ['vantara.mirror', JSON.stringify(A_MIRROR)], ['vantara.cursor', '90'],
    ['vantara.queue', JSON.stringify([A_OP])],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: key => values.get(key) ?? null,
    setItem: () => { throw new DOMException('Local storage is full', 'QuotaExceededError'); },
    removeItem: key => values.delete(key),
  });
  vi.stubGlobal('sessionStorage', { getItem: () => null, removeItem() {} });
  vi.stubGlobal('indexedDB', new IDBFactory());
  // The latest account switch reached IDB while its small local copy failed.
  await createSessionStore().write({ token: 'token-B', user: B, savedAt: 200 });
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body && JSON.parse(options.body);
    requests.push({ path, body, authorization: options.headers?.authorization });
    if (path === '/v1/ops') return Response.json({ applied: body.ops.map(op => op.opId), skipped: [], cursor: 91 });
    return Response.json({ error: 'fixture-offline' }, { status: 503 });
  }));
  const open = async () => {
    const sync = createSync({ baseUrl: 'https://ownership-fixture.invalid' });
    clients.push(sync);
    await sync.ready;
    return sync;
  };
  return { values, requests, open };
}

it('preserves account A independently and never sends its legacy queue using a restored account B session', async () => {
  const { values, requests, open } = await fixture();
  const sync = await open();
  expect(sync.user.userId).toBe(B.userId);
  await sync.push({ force: true });
  expect(requests.filter(request => request.path === '/v1/ops')).toEqual([]);
  expect(sync.rows('library')).toEqual([]);
  expect(sync.pendingWrites).toBe(0);

  const store = createAccountStore();
  const [snapshot, queue] = await Promise.all([store.read('snapshot', A.userId), store.read('queue', A.userId)]);
  expect(snapshot).toMatchObject({ userId: A.userId, cursor: 90, mirror: A_MIRROR });
  expect(queue).toMatchObject({ userId: A.userId, ops: [A_OP] });
  expect(values.get('vantara.device.id')).toBe(DEVICE);
  expect(values.get('vantara.device.credential')).toBe(CREDENTIAL);
});

it('restores B mirror and queue using B cursor even when A legacy cursor was higher', async () => {
  const { requests, open } = await fixture();
  const bOp = { opId: 'B-own-edit', kind: 'favorite.set', payload: { seriesRef: 'B-own-title', member: true }, at: 2 };
  const store = createAccountStore();
  await store.write('snapshot', B.userId, {
    cursor: 7,
    mirror: { library: { ownB: { user_id: B.userId, series_ref: 'B-own-title' } } },
  });
  await store.write('queue', B.userId, { ops: [bOp] });
  const sync = await open();
  expect(sync.user.userId).toBe(B.userId);
  expect(sync.rows('library')).toEqual([{ user_id: B.userId, series_ref: 'B-own-title' }]);
  expect(sync.pendingWrites).toBe(1);
  await sync.push({ force: true });
  expect(requests.filter(request => request.path === '/v1/ops')).toEqual([
    { path: '/v1/ops', body: { ops: [bOp] }, authorization: 'Bearer token-B' },
  ]);
  expect(await store.read('queue', A.userId)).toMatchObject({ userId: A.userId, ops: [A_OP] });
});

it('preserves B quarantined writes when its local cache still belongs to A', async () => {
  const { open } = await fixture();
  const store = createAccountStore();
  const rejectedOp = { opId: 'B-rejected-edit', kind: 'favorite.set', payload: { seriesRef: 'B-title', member: true }, at: 2 };
  await store.write('queue', B.userId, { ops: [rejectedOp] });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_operation' }, { status: 422 })));
  const sync = await open();
  await sync.push({ force: true });
  expect(sync.quarantined).toBe(1);
  await vi.waitFor(async () => expect(await store.read('queue', B.userId)).toMatchObject({ ops: [] }));
  const reopened = await open();
  expect(reopened.quarantined).toBe(1);
});

it('keeps logout newer than an unread session backup when the clock moves back and IDB writes fail', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(200);
  try {
    const backup = { token: 'token-A', user: A, pinGrant: 'fixture-pin-grant', savedAt: 500 };
    const values = new Map([
      ['vantara.device.id', DEVICE], ['vantara.device.credential', CREDENTIAL],
      ['vantara.public-views.v1', '1'], ['vantara.private-usage.v1', '1'],
      ['vantara.user', JSON.stringify(A)],
      ['vantara.session.v1', JSON.stringify({ ...backup, savedAt: 100 })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    });
    vi.stubGlobal('sessionStorage', { getItem: () => null, removeItem() {} });
    let holdFirstRead = true;
    let releaseRead;
    vi.stubGlobal('indexedDB', {
      open(name) {
        const opening = {};
        queueMicrotask(() => {
          opening.result = {
            transaction() {
              const transaction = {};
              transaction.objectStore = () => ({
                get() {
                  const request = {};
                  const complete = () => {
                    request.result = name === 'vantara-session' ? structuredClone(backup) : undefined;
                    transaction.oncomplete?.();
                  };
                  if (name === 'vantara-session' && holdFirstRead) {
                    holdFirstRead = false;
                    releaseRead = complete;
                  } else queueMicrotask(complete);
                  return request;
                },
                put() {
                  const request = {};
                  queueMicrotask(() => transaction.onabort?.());
                  return request;
                },
              });
              return transaction;
            },
          };
          opening.onsuccess?.();
        });
        return opening;
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ cursor: 0, more: false, changes: {} })));
    const first = createSync({ baseUrl: 'https://ownership-fixture.invalid' });
    clients.push(first);
    while (!releaseRead) await new Promise(setImmediate);
    const signedOut = first.signOut();
    releaseRead();
    await signedOut;
    await first.ready;
    expect(first.signedIn).toBe(false);
    first.dispose();

    const reopened = createSync({ baseUrl: 'https://ownership-fixture.invalid' });
    clients.push(reopened);
    await reopened.ready;
    expect.soft(reopened.signedIn).toBe(false);
    expect.soft(JSON.parse(values.get('vantara.session.v1'))).toMatchObject({ signedOut: true });
    expect.soft(JSON.parse(values.get('vantara.session.v1')).savedAt).toBeGreaterThan(500);
    expect(values.get('vantara.device.id')).toBe(DEVICE);
    expect(values.get('vantara.device.credential')).toBe(CREDENTIAL);
  } finally {
    vi.restoreAllMocks();
  }
});
