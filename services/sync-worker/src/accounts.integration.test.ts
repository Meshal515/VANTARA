/**
 * دورة حياة الحساب على D1 حقيقية (SQLite بكل الهجرات): إضافة حساب، السقف عشرة،
 * PIN، الحذف والتراجع والمسح — وأهم شيء: الهوية لا تتغير ولا تختلط.
 */
import { describe, expect, it } from 'vitest';
import worker from './secure-index.ts';
import { sqliteEnv } from './test-d1.ts';
import { checkPin, MAX_ACCOUNTS, purgeExpired, UNDO_WINDOW_MS } from './accounts.ts';
import { hashDeviceSecret } from './secure-index.ts';

const PEPPER = 'device-pepper-for-tests-only-32-chars-x';
const DAHMI = '07588797-a471-44d1-99ce-7fb4f188c196';
const phone = { deviceId: 'phone-0000-0001', deviceCredential: 'credential-of-the-test-phone-000001' };
const tablet = { deviceId: 'tablet-000-0002', deviceCredential: 'credential-of-the-test-tablet-00002' };
const ctx = { waitUntil: () => {} };

async function setup() {
  const { env, db } = sqliteEnv({
    VANTARA_SESSION_SECRET: 'session-secret-that-is-at-least-32-characters',
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: PEPPER,
  });
  // الجوال والتابلت معتمدان للحسابات الثلاثة (كما يفعل الاعتماد الحالي)
  for (const device of [phone, tablet]) {
    const hash = await hashDeviceSecret(device.deviceCredential, PEPPER);
    for (const { user_id } of db.prepare('SELECT user_id FROM accounts').all() as { user_id: string }[]) {
      db.prepare('INSERT INTO trusted_devices (device_id, user_id, credential_hash, created_at, last_used_at) VALUES (?, ?, ?, 0, 0)').run(device.deviceId, user_id, hash);
    }
  }
  const call = (path: string, body?: unknown, token?: string, method = 'POST') =>
    worker.fetch(
      new Request(`https://sync.test${path}`, {
        method,
        body: body === undefined ? null : JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      }),
      env,
      ctx,
    );
  const session = async (userId: string, device = phone, extra: Record<string, unknown> = {}) => {
    const res = await call('/v1/session', { userId, ...device, ...extra });
    return { res, body: (await res.json()) as Record<string, any> };
  };
  const tokenFor = async (userId: string, device = phone, extra = {}) => (await session(userId, device, extra)).body.token as string;
  const list = async () => ((await (await call('/v1/accounts', undefined, undefined, 'GET')).json()) as { content: any[]; limit: number });
  return { env, db, call, session, tokenFor, list };
}

describe('add account', () => {
  it('creates a new hidden immutable id, trusts it on every approved device, and lists it', async () => {
    const { call, tokenFor, list, session, db } = await setup();
    const token = await tokenFor(DAHMI);
    const res = await call('/v1/accounts/create', { username: '@Sara_1', displayName: '  سارة  ', avatarKey: '/icons/avatars/7.webp' }, token);
    expect(res.status).toBe(200);
    const { account } = (await res.json()) as { account: { userId: string; username: string; displayName: string } };
    expect(account.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(account).toMatchObject({ username: 'sara_1', displayName: 'سارة' });

    const accounts = (await list()).content;
    expect(accounts.map((a) => a.username)).toContain('sara_1');
    expect((await list()).limit).toBe(MAX_ACCOUNTS);
    // يُفتح من الجوال والتابلت بلا اعتماد جديد
    expect((await session(account.userId, phone)).res.status).toBe(200);
    expect((await session(account.userId, tablet)).res.status).toBe(200);
    // يصل كل جهاز عبر الفروقات
    const synced = db.prepare('SELECT rev FROM accounts WHERE user_id = ?').get(account.userId) as { rev: number };
    expect(synced.rev).toBeGreaterThan(0);
  });

  it('rejects a taken or malformed username and a missing name', async () => {
    const { call, tokenFor } = await setup();
    const token = await tokenFor(DAHMI);
    expect((await call('/v1/accounts/create', { username: 'NGM', displayName: 'x' }, token)).status).toBe(409);
    expect((await call('/v1/accounts/create', { username: 'a b', displayName: 'x' }, token)).status).toBe(400);
    expect((await call('/v1/accounts/create', { username: 'okname', displayName: '   ' }, token)).status).toBe(400);
    expect((await call('/v1/accounts/create', { username: 'okname', displayName: 'x' })).status).toBe(401);
    // من شاشة «من يتابع؟» بلا جلسة: إثبات جهاز معتمد يكفي، وجهاز غريب لا
    expect((await call('/v1/accounts/create', { username: 'fromgate', displayName: 'g', ...phone })).status).toBe(200);
    expect((await call('/v1/accounts/create', { username: 'stranger', displayName: 's', deviceId: 'evil-device-01', deviceCredential: 'not-a-trusted-credential-000000' })).status).toBe(401);
  });

  it('never exceeds ten, even with concurrent requests', async () => {
    const { call, tokenFor, list } = await setup();
    const token = await tokenFor(DAHMI);
    for (let i = 0; i < 6; i += 1) expect((await call('/v1/accounts/create', { username: `user${i}`, displayName: `U${i}` }, token)).status).toBe(200);
    // 9 الآن: ثلاثة طلبات معًا، يمر واحد فقط
    const results = await Promise.all(['racea', 'raceb', 'racec'].map((u) => call('/v1/accounts/create', { username: u, displayName: u }, token)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await list()).content).toHaveLength(MAX_ACCOUNTS);
    const extra = await call('/v1/accounts/create', { username: 'eleven', displayName: '11' }, token);
    expect(extra.status).toBe(409);
    expect(await extra.json()).toEqual({ error: 'limit_reached' });
  });
});

describe('profile PIN', () => {
  it('is hashed, required for a session, and the grant renews without asking again on the same device only', async () => {
    const { call, tokenFor, session, db, list } = await setup();
    const token = await tokenFor(DAHMI);
    const set = await call('/v1/pin', { action: 'set', pin: '4826' }, token);
    expect(set.status).toBe(200);
    const { pinGrant } = (await set.json()) as { pinGrant: string };
    const stored = db.prepare('SELECT pin_hash, salt, digits FROM account_pins WHERE user_id = ?').get(DAHMI) as { pin_hash: string; salt: string; digits: number };
    expect(stored.digits).toBe(4);
    expect(stored.pin_hash).not.toContain('4826');
    expect(stored.pin_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await list()).content.find((a) => a.userId === DAHMI).pinDigits).toBe(4);

    expect((await session(DAHMI)).body).toEqual({ error: 'pin_required', digits: 4 });
    expect((await session(DAHMI, phone, { pinGrant })).res.status).toBe(200);
    // إذن الجوال لا يفتح التابلت
    expect((await session(DAHMI, tablet, { pinGrant })).body.error).toBe('pin_required');
    const ok = await session(DAHMI, tablet, { pin: '4826' });
    expect(ok.res.status).toBe(200);
    expect(ok.body.user.pinDigits).toBe(4);
    expect(typeof ok.body.pinGrant).toBe('string');
  });

  it('locks after five wrong tries, escalating, and resets on success', async () => {
    const { env, call, tokenFor, session } = await setup();
    const token = await tokenFor(DAHMI);
    await call('/v1/pin', { action: 'set', pin: '135790' }, token);
    for (let i = 0; i < 4; i += 1) expect((await session(DAHMI, phone, { pin: '000000' })).body.error).toBe('pin_wrong');
    const locked = await session(DAHMI, phone, { pin: '000000' });
    expect(locked.res.status).toBe(429);
    expect(locked.body.error).toBe('pin_locked');
    // حتى الصحيح مرفوض أثناء القفل
    expect((await session(DAHMI, phone, { pin: '135790' })).body.error).toBe('pin_locked');
    // بعد دقيقة يُقبل الصحيح ويُصفّر العداد
    const later = Date.now() + 61_000;
    expect(await checkPin(env, DAHMI, '135790', later)).toEqual({ ok: true });
    // جولة ثانية من خمسة خاطئة ⇒ قفل أطول (5 دقائق)
    for (let i = 0; i < 4; i += 1) await checkPin(env, DAHMI, '111111', later);
    const second = await checkPin(env, DAHMI, '111111', later);
    expect(second).toMatchObject({ ok: false, error: 'pin_locked' });
  });

  it('change and removal need the current PIN; data stays on the same identity', async () => {
    const { call, tokenFor, session, db } = await setup();
    db.prepare("INSERT INTO library (user_id, series_ref, series_title, added_at, removed, rev) VALUES (?, 'ext:s:1', 'Solo', 1, 0, 1)").run(DAHMI);
    const token = await tokenFor(DAHMI);
    await call('/v1/pin', { action: 'set', pin: '1111' }, token);
    expect((await call('/v1/pin', { action: 'set', pin: '222222' }, token)).status).toBe(401);
    expect((await call('/v1/pin', { action: 'set', pin: '222222', currentPin: '1111' }, token)).status).toBe(200);
    expect((await session(DAHMI, phone, { pin: '222222' })).res.status).toBe(200);
    expect((await call('/v1/pin', { action: 'remove', currentPin: '9999' }, token)).status).toBe(401);
    expect((await call('/v1/pin', { action: 'remove', currentPin: '222222' }, token)).status).toBe(200);
    expect((await session(DAHMI)).res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM library WHERE user_id = ?').get(DAHMI)).toEqual({ n: 1 });
  });
});

describe('delete account', () => {
  it('needs the PIN, hides at once, can be undone in the window, then purges and frees the username', async () => {
    const { env, db, call, tokenFor, session, list } = await setup();
    const owner = await tokenFor(DAHMI);
    const created = (await (await call('/v1/accounts/create', { username: 'temp', displayName: 'مؤقت' }, owner)).json()) as { account: { userId: string } };
    const id = created.account.userId;
    const token = await tokenFor(id);
    await call('/v1/pin', { action: 'set', pin: '5555' }, token);
    db.prepare("INSERT INTO library (user_id, series_ref, series_title, added_at, removed, rev) VALUES (?, 'ext:s:9', 'X', 1, 0, 1)").run(id);

    expect((await call('/v1/accounts/delete', { pin: '0000' }, token)).status).toBe(401);
    const del = await call('/v1/accounts/delete', { pin: '5555' }, token);
    expect(del.status).toBe(200);
    expect(((await del.json()) as { undoUntil: number }).undoUntil).toBeGreaterThan(Date.now());
    expect((await list()).content.some((a) => a.userId === id)).toBe(false);
    expect((await session(id, phone, { pin: '5555' })).res.status).toBe(401);

    // تراجع
    expect(await (await call('/v1/accounts/restore', {}, token)).json()).toEqual({ restored: true });
    expect((await list()).content.some((a) => a.userId === id)).toBe(true);
    expect((await session(id, phone, { pin: '5555' })).res.status).toBe(200);

    // حذف نهائي
    await call('/v1/accounts/delete', { pin: '5555' }, token);
    expect(await (await call('/v1/accounts/delete/commit', {}, token)).json()).toEqual({ purged: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM library WHERE user_id = ?').get(id)).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_pins WHERE user_id = ?').get(id)).toEqual({ n: 0 });
    const tomb = db.prepare('SELECT username, deleted_at FROM accounts WHERE user_id = ?').get(id) as { username: string; deleted_at: number };
    expect(tomb.username).toBe(`~${id}`);
    expect(tomb.deleted_at).toBeGreaterThan(0);
    expect(await (await call('/v1/accounts/restore', {}, token)).json()).toEqual({ restored: false });

    // username تحرر، والحساب الجديد بهوية مختلفة تمامًا — لا خلط
    const again = (await (await call('/v1/accounts/create', { username: 'temp', displayName: 'جديد' }, owner)).json()) as { account: { userId: string } };
    expect(again.account.userId).not.toBe(id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM library WHERE user_id = ?').get(again.account.userId)).toEqual({ n: 0 });
    // المحذوف لا يُحسب من العشرة
    expect(await purgeExpired(env, Date.now() + UNDO_WINDOW_MS + 1)).toBe(0);
  });

  it('a deleted account that was never committed is purged once the undo window passes', async () => {
    const { env, db, call, tokenFor } = await setup();
    const owner = await tokenFor(DAHMI);
    const { account } = (await (await call('/v1/accounts/create', { username: 'gone', displayName: 'g' }, owner)).json()) as { account: { userId: string } };
    const token = await tokenFor(account.userId);
    await call('/v1/accounts/delete', {}, token);
    expect(await purgeExpired(env, Date.now() + 1000)).toBe(0);
    expect(await purgeExpired(env, Date.now() + UNDO_WINDOW_MS + 1000)).toBe(1);
    expect((db.prepare('SELECT username FROM accounts WHERE user_id = ?').get(account.userId) as { username: string }).username).toBe(`~${account.userId}`);
  });
});
