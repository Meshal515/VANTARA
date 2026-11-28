import { describe, expect, it } from 'vitest';
import worker, { hashDeviceSecret } from './secure-index.ts';
import { sqliteEnv } from './test-d1.ts';
import { normalizeResetKey } from './admin.ts';

// لوحة المالك ومفتاح استعادة الـPIN، عبر البوابة الحقيقية (secure-index) كما في الإنتاج.

const PEPPER = 'device-pepper-for-tests-only-32-chars-x';
const OWNER = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const FRIEND = '07588797-a471-44d1-99ce-7fb4f188c196';
const phone = { deviceId: 'phone-0000-0001', deviceCredential: 'credential-of-the-test-phone-000001' };
const ctx = { waitUntil: () => {} };

async function setup() {
  const { env, db } = sqliteEnv({
    VANTARA_SESSION_SECRET: 'session-secret-that-is-at-least-32-characters',
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: PEPPER,
  });
  const hash = await hashDeviceSecret(phone.deviceCredential, PEPPER);
  for (const { user_id } of db.prepare('SELECT user_id FROM accounts').all() as { user_id: string }[]) {
    db.prepare('INSERT INTO trusted_devices (device_id, user_id, credential_hash, created_at, last_used_at) VALUES (?, ?, ?, 0, 0)').run(phone.deviceId, user_id, hash);
  }
  db.prepare("UPDATE accounts SET badge = 'owner' WHERE user_id = ?").run(OWNER);
  const call = (path: string, body?: unknown, auth?: string, method = 'POST') =>
    worker.fetch(
      new Request(`https://sync.test${path}`, {
        method,
        body: body === undefined ? null : JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      }),
      env,
      ctx,
    );
  const session = async (userId: string, extra: Record<string, unknown> = {}) => {
    const res = await call('/v1/session', { userId, ...phone, ...extra });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const bearer = async (userId: string, extra = {}) => `Bearer ${(await session(userId, extra)).body.token}`;
  return { env, db, call, session, bearer };
}

describe('owner admin panel', () => {
  it('restricts collector policy writes to the owner and leaves the thin threads available', async () => {
    const { call, bearer } = await setup();
    const owner = await bearer(OWNER), friend = await bearer(FRIEND);
    expect((await call('/v1/admin/collector-policy', { mode: 'exclusive' }, friend)).status).toBe(403);
    expect((await call('/v1/admin/collector-policy', { mode: 'bogus' }, owner)).status).toBe(400);
    expect((await call('/v1/admin/collector-policy', { mode: 'exclusive' }, owner)).status).toBe(200);
    expect(await (await call('/v1/latest/collector-policy', undefined, friend, 'GET')).json()).toMatchObject({mode:'exclusive'});
    expect((await call('/v1/updates/observe', { works: [] }, friend)).status).toBe(409);
    expect((await call('/v1/latest/signals', undefined, friend, 'GET')).status).toBe(200);
    expect((await call('/v1/latest/backup', undefined, friend, 'GET')).status).toBe(200);
    expect((await call('/v1/admin/collector-policy', {mode:'hybrid'}, owner)).status).toBe(200);
  });

  it('is the owner\'s alone, checked on the server for every call', async () => {
    const { call, bearer } = await setup();
    expect((await call('/v1/admin/accounts', undefined, await bearer(FRIEND), 'GET')).status).toBe(403);
    expect((await call('/v1/admin/delete', { userId: OWNER }, await bearer(FRIEND))).status).toBe(403);
    const res = await call('/v1/admin/accounts', undefined, await bearer(OWNER), 'GET');
    expect(res.status).toBe(200);
    const { accounts } = (await res.json()) as { accounts: Array<Record<string, unknown>> };
    expect(accounts.find((a) => a['userId'] === OWNER)).toMatchObject({ owner: true, suspended: false });
    expect(accounts.find((a) => a['userId'] === FRIEND)).toMatchObject({ owner: false, devices: 1, pin: null });
  });

  it('the owner never acts on himself', async () => {
    const { call, bearer } = await setup();
    const auth = await bearer(OWNER);
    for (const path of ['/v1/admin/delete', '/v1/admin/suspend', '/v1/admin/signout', '/v1/admin/pin-key']) {
      expect((await call(path, { userId: OWNER }, auth)).status).toBe(409);
    }
  });

  it('suspend blocks new sessions until restored; sign-out revokes every device', async () => {
    const { call, bearer, session } = await setup();
    const auth = await bearer(OWNER);
    expect((await call('/v1/admin/suspend', { userId: FRIEND, on: true }, auth)).status).toBe(200);
    expect(await session(FRIEND)).toMatchObject({ status: 403, body: { error: 'account_suspended' } });
    await call('/v1/admin/suspend', { userId: FRIEND, on: false }, auth);
    expect((await session(FRIEND)).status).toBe(200);
    await call('/v1/admin/signout', { userId: FRIEND }, auth);
    expect(await session(FRIEND)).toMatchObject({ status: 401, body: { error: 'device_untrusted' } });
  });

  it('delete needs no PIN of the person and follows the same grace before the purge', async () => {
    const { call, bearer, db } = await setup();
    const res = await call('/v1/admin/delete', { userId: FRIEND }, await bearer(OWNER));
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT lifecycle FROM accounts WHERE user_id = ?').get(FRIEND)).toMatchObject({ lifecycle: 'PENDING_DELETE' });
  });
});

describe('forgot PIN: a one-time key from the owner', () => {
  it('replaces the PIN once, from the person\'s own trusted device, and then they set a new one', async () => {
    const { call, bearer, session } = await setup();
    const friend = await bearer(FRIEND);
    expect((await call('/v1/pin', { action: 'set', pin: '4821' }, friend)).status).toBe(200);
    expect(await session(FRIEND)).toMatchObject({ status: 401, body: { error: 'pin_required' } });

    const issued = await call('/v1/admin/pin-key', { userId: FRIEND }, await bearer(OWNER));
    const { key } = (await issued.json()) as { key: string };
    expect(key).toMatch(/^VNTR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    expect(await session(FRIEND, { pinResetKey: 'VNTR-AAAA-AAAA-AAAA-AAAA' })).toMatchObject({ status: 401, body: { error: 'reset_key_wrong' } });
    // يُكتب كيفما نُسخ: حروف صغيرة ومسافات
    const typed = key.toLowerCase().replace(/-/g, ' ');
    const ok = await session(FRIEND, { pinResetKey: typed });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ pinCleared: true, user: { pinDigits: null } });
    // مرة واحدة
    expect((await session(FRIEND, { pinResetKey: key })).status).toBe(401);
    // بلا PIN الآن حتى يضع جديدًا
    expect((await session(FRIEND)).status).toBe(200);
  });

  it('a key for one account opens no other', async () => {
    const { call, bearer, session } = await setup();
    const { key } = (await (await call('/v1/admin/pin-key', { userId: FRIEND }, await bearer(OWNER))).json()) as { key: string };
    const other = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
    expect((await session(other, { pinResetKey: key })).status).toBe(401);
  });

  it('normalizes what people paste', () => {
    expect(normalizeResetKey(' vntr abcd-efgh 2345 6789 ')).toBe('VNTR-ABCD-EFGH-2345-6789');
    expect(normalizeResetKey('VNTR-0000-1111-2222-3333')).toBeNull();
  });
});

describe('phone check-in passes the production gate', () => {
  it('a device token reads pending notifications without a session', async () => {
    const { call, bearer } = await setup();
    const reg = await call('/v1/notify/device', {}, await bearer(OWNER));
    expect(reg.status).toBe(200);
    const { token } = (await reg.json()) as { token: string };
    expect((await call('/v1/notify/pending', undefined, `Notify ${token}`, 'GET')).status).toBe(200);
    expect((await call('/v1/sync?since=0', undefined, `Notify ${token}`, 'GET')).status).toBe(401);
  });
});
