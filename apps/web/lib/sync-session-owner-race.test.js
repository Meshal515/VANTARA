import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createSync } from './sync.js';
import { createAccountStore } from './account-store.js';

const A = { userId: 'owner-race-fixture-A' };
const B = { userId: 'owner-race-fixture-B' };
const B_MIRROR = { library: { retained: { user_id: B.userId, series_ref: 'B-retained-title' } } };
const clients = [];
let releaseRead;

afterEach(() => {
  releaseRead?.();
  releaseRead = null;
  for (const client of clients.splice(0)) client.dispose();
  vi.unstubAllGlobals();
});

it('preserves the unread B snapshot when logout interrupts an A to B account switch', async () => {
  const values = new Map([
    ['vantara.user', JSON.stringify(A)], ['vantara.token', 'fixture-A-token'],
    ['vantara.device.id', 'owner-race-fixture-device'],
    ['vantara.device.credential', 'owner-race-fixture-credential-at-least-32'],
    ['vantara.public-views.v1', '1'], ['vantara.private-usage.v1', '1'],
    ['vantara.mirror', JSON.stringify({ library: { retained: { user_id: A.userId, series_ref: 'A-retained-title' } } })],
    ['vantara.cursor', '0'],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  });
  vi.stubGlobal('sessionStorage', { removeItem() {} });
  const factory = new IDBFactory();
  let holdNextBRead = false;
  let blocked;
  const atRead = new Promise(resolve => { blocked = resolve; });
  vi.stubGlobal('indexedDB', {
    open(name, version) {
      const opening = factory.open(name, version);
      if (name === 'vantara-account-recovery') opening.addEventListener('success', () => {
        const db = opening.result;
        const transaction = db.transaction.bind(db);
        db.transaction = (...args) => {
          const tx = transaction(...args);
          let holdThisRead = false;
          return new Proxy(tx, {
            get(target, key) {
              if (key === 'objectStore') return storeName => {
                const store = target.objectStore(storeName);
                return new Proxy(store, {
                  get(object, property) {
                    if (property === 'get') return recordKey => {
                      if (holdNextBRead && storeName === 'snapshot' && recordKey === B.userId) {
                        holdNextBRead = false;
                        holdThisRead = true;
                      }
                      return object.get(recordKey);
                    };
                    const value = Reflect.get(object, property, object);
                    return typeof value === 'function' ? value.bind(object) : value;
                  },
                });
              };
              const value = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
            set(target, key, value) {
              if (key === 'oncomplete') target.oncomplete = event => {
                if (!holdThisRead) return value(event);
                releaseRead = () => { holdThisRead = false; value(event); };
                blocked();
              };
              else target[key] = value;
              return true;
            },
          });
        };
      });
      return opening;
    },
  });
  vi.stubGlobal('fetch', vi.fn(async url => String(url).endsWith('/v1/session')
    ? Response.json({ token: 'fixture-B-token', user: B })
    : Response.json({ error: 'fixture-offline' }, { status: 503 })));
  const store = createAccountStore();
  await store.write('snapshot', B.userId, { cursor: 0, mirror: B_MIRROR });
  const sync = createSync({ baseUrl: 'https://owner-race-fixture.invalid' });
  clients.push(sync);
  await sync.ready;
  holdNextBRead = true;
  const login = sync.signIn(B.userId);
  const rejected = expect(login).rejects.toMatchObject({ stale: true });
  await atRead;
  await sync.signOut();
  releaseRead();
  await rejected;
  expect(sync.signedIn).toBe(false);
  expect(await store.read('snapshot', B.userId)).toMatchObject({ userId: B.userId, cursor: 0, mirror: B_MIRROR });
});
