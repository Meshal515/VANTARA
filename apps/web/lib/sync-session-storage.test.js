import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createSync } from './sync.js';

const USER = { userId: 'release-fixture-user', username: 'release_fixture', displayName: 'Test account', pinDigits: 4 };
const DEVICE = 'release-fixture-device';
const CREDENTIAL = 'release-fixture-credential-at-least-32';
const clients = [];

function fixture() {
  const values = new Map([
    ['vantara.device.id', DEVICE], ['vantara.device.credential', CREDENTIAL],
    ['vantara.public-views.v1', '1'], ['vantara.private-usage.v1', '1'],
    ['vantara.mirror', JSON.stringify({ profiles: { friend: { user_id: 'friend', display_name: 'Friend' } } })],
    ['fixture.retained', 'existing local data'],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: key => values.get(key) ?? null,
    setItem: () => { throw new DOMException('Local storage is full', 'QuotaExceededError'); },
    removeItem: key => values.delete(key),
  });
  vi.stubGlobal('sessionStorage', { getItem: () => null, removeItem: () => {} });
  vi.stubGlobal('indexedDB', new IDBFactory());
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    requests.push({ path: new URL(url).pathname, body: options.body && JSON.parse(options.body), authorization: options.headers?.authorization });
    if (String(url).endsWith('/v1/session')) return Response.json({ token: 'server-issued-session', user: USER, pinGrant: 'server-issued-pin-grant' });
    return Response.json({ cursor: 0, changes: {}, more: false });
  }));
  const open = async () => {
    const sync = createSync({ baseUrl: 'https://sync.test' });
    clients.push(sync);
    await sync.ready;
    return sync;
  };
  return { values, requests, open };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.unstubAllGlobals();
});

it('accepts an issued session when localStorage is full and preserves device proof and existing data', async () => {
  const { values, requests, open } = fixture();
  const before = new Map(values);
  const sync = await open();
  await expect(sync.signIn(USER.userId, { pin: '2580' })).resolves.toMatchObject({ userId: USER.userId });
  expect(sync.signedIn).toBe(true);
  expect(sync.locked).toBe(false);
  expect(requests[0]).toMatchObject({ path: '/v1/session', body: { deviceId: DEVICE, deviceCredential: CREDENTIAL, pin: '2580' } });
  expect(values).toEqual(before);
});

it('restores the account and server-issued PIN grant after reopening without changing device identity', async () => {
  const { values, requests, open } = fixture();
  const first = await open();
  await first.signIn(USER.userId, { pin: '2580' });
  first.dispose();
  const reopened = await open();
  expect(reopened.user).toMatchObject({ userId: USER.userId });
  expect(reopened.locked).toBe(false);
  await reopened.refreshSession();
  expect(requests.at(-1).body).toMatchObject({ deviceId: DEVICE, deviceCredential: CREDENTIAL, pinGrant: 'server-issued-pin-grant' });
  expect(requests.at(-1).body.pin).toBeUndefined();
  expect(values.get('fixture.retained')).toBe('existing local data');
});

it('does not resurrect a signed-out account or its PIN grant from the independent session copy', async () => {
  const { open } = fixture();
  const first = await open();
  await first.signIn(USER.userId, { pin: '2580' });
  await first.signOut();
  const reopened = await open();
  expect(reopened.signedIn).toBe(false);
  expect(reopened.user).toBeNull();
});

it('persists the locked state when the server revokes the saved PIN grant', async () => {
  const { open } = fixture();
  const first = await open();
  await first.signIn(USER.userId, { pin: '2580' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'pin_required', digits: 4 }, { status: 401 })));
  await expect(first.refreshSession()).rejects.toMatchObject({ code: 'pin_required' });
  const reopened = await open();
  expect(reopened.signedIn).toBe(false);
  expect(reopened.locked).toBe(true);
  expect(reopened.authorizationHeader).toBeNull();
});

it('does not restore a PIN grant cleared by an attempted account switch', async () => {
  const { open } = fixture();
  const first = await open();
  await first.signIn(USER.userId, { pin: '2580' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'pin_wrong', digits: 4 }, { status: 401 })));
  await expect(first.signIn('second-fixture-user', { pin: '1111' })).rejects.toMatchObject({ code: 'pin_wrong' });
  const reopened = await open();
  expect(reopened.user.userId).toBe(USER.userId);
  expect(reopened.locked).toBe(true);
});

it('never saves a session after a wrong PIN even while storage is full', async () => {
  const { values, open } = fixture();
  const before = new Map(values);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'pin_wrong', digits: 4 }, { status: 401 })));
  const first = await open();
  await expect(first.signIn(USER.userId, { pin: '1111' })).rejects.toMatchObject({ code: 'pin_wrong' });
  const reopened = await open();
  expect(reopened.signedIn).toBe(false);
  expect(values).toEqual(before);
});

it('keeps successful authentication in memory and reports storage, not networking, if both local stores fail', async () => {
  const { values, open } = fixture();
  vi.stubGlobal('indexedDB', { open() { throw new DOMException('Disk full', 'QuotaExceededError'); } });
  const first = await open();
  await first.signIn(USER.userId, { pin: '2580' });
  expect(first.signedIn).toBe(true);
  expect(first.health()).toMatchObject({ state: 'degraded', lastError: { code: 'session_storage_full' } });
  expect(values.get('vantara.device.id')).toBe(DEVICE);
  expect(values.get('vantara.device.credential')).toBe(CREDENTIAL);
});

it('rejects a late successful login after logout without resurrecting its persistent session', async () => {
  const { open } = fixture();
  let deliver;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { deliver = resolve; })));
  const first = await open();
  const login = first.signIn(USER.userId, { pin: '2580' });
  const rejected = expect(login).rejects.toMatchObject({ stale: true });
  await vi.waitFor(() => expect(deliver).toBeTypeOf('function'));
  await first.signOut();
  deliver(Response.json({ token: 'late-session', user: USER, pinGrant: 'late-grant' }));
  await rejected;
  expect(first.signedIn).toBe(false);
  const reopened = await open();
  expect(reopened.signedIn).toBe(false);
});
