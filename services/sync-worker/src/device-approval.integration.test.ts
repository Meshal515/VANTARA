import { describe, expect, it } from 'vitest';
import worker from './secure-index.ts';
import { sqliteEnv } from './test-d1.ts';
// @ts-expect-error -- أداة Node بلا أنواع
import { buildApproveSql, codeHash, normalizeCode } from '../tools/approve-device.mjs';

const PEPPER = 'device-pepper-for-tests-only-32-chars-x';
const ME = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';

function testEnv() {
  return sqliteEnv({
    VANTARA_SESSION_SECRET: 'session-secret-that-is-at-least-32-characters',
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: PEPPER,
  });
}
const ctx = { waitUntil: () => {} };
const post = (env: ReturnType<typeof testEnv>['env'], path: string, body: unknown) =>
  worker.fetch(
    new Request(`https://sync.test${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    env,
    ctx,
  );
const phone = { deviceId: 'phone-0000-0001', deviceCredential: 'credential-of-the-new-phone-000001' };

describe('approving a new phone by the code on its screen', () => {
  it('request → owner approves the code → claim trusts the phone → session works', async () => {
    const { env, db } = testEnv();
    expect((await post(env, '/v1/session', { userId: ME, ...phone })).status).toBe(401);

    const req = await post(env, '/v1/device/request', phone);
    expect(req.status).toBe(200);
    const { code } = (await req.json()) as { code: string };
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // قبل الاعتماد: ينتظر
    expect(await (await post(env, '/v1/device/claim', phone)).json()).toEqual({ paired: false, pending: true });

    // المالك يعتمد بالأداة نفسها التي يشغّلها سير العمل
    db.exec(buildApproveSql(codeHash(code, PEPPER)));

    const claim = (await (await post(env, '/v1/device/claim', phone)).json()) as { paired: boolean; accounts: number };
    expect(claim.paired).toBe(true);
    expect(claim.accounts).toBe(3);

    const session = await post(env, '/v1/session', { userId: ME, ...phone });
    expect(session.status).toBe(200);
    // الاعتماد يُستهلك مرة واحدة
    expect(((await (await post(env, '/v1/device/claim', phone)).json()) as { paired: boolean }).paired).toBe(false);
  });

  it('an approved code is useless to any other device, even with the same device id', async () => {
    const { env, db } = testEnv();
    const { code } = (await (await post(env, '/v1/device/request', phone)).json()) as { code: string };
    db.exec(buildApproveSql(codeHash(code, PEPPER)));
    const thief = { deviceId: phone.deviceId, deviceCredential: 'attacker-credential-000000000000' };
    expect(((await (await post(env, '/v1/device/claim', thief)).json()) as { paired: boolean }).paired).toBe(false);
    expect((await post(env, '/v1/session', { userId: ME, ...thief })).status).toBe(401);
    // صاحب الطلب ما زال يأخذه
    expect(((await (await post(env, '/v1/device/claim', phone)).json()) as { paired: boolean }).paired).toBe(true);
  });

  it('the code is never stored, a wrong code approves nothing, and a new request replaces the old', async () => {
    const { env, db } = testEnv();
    const first = ((await (await post(env, '/v1/device/request', phone)).json()) as { code: string }).code;
    const second = ((await (await post(env, '/v1/device/request', phone)).json()) as { code: string }).code;
    const rows = db.prepare('SELECT code_hash FROM device_requests').all() as { code_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(second.replace('-', ''));
    db.exec(buildApproveSql(codeHash(first, PEPPER)));
    expect(((await (await post(env, '/v1/device/claim', phone)).json()) as { paired: boolean }).paired).toBe(false);
    db.exec(buildApproveSql(codeHash(second, PEPPER)));
    expect(((await (await post(env, '/v1/device/claim', phone)).json()) as { paired: boolean }).paired).toBe(true);
  });

  it('rejects malformed requests and codes', async () => {
    const { env } = testEnv();
    expect((await post(env, '/v1/device/request', { deviceId: 'x', deviceCredential: 'short' })).status).toBe(400);
    expect(() => normalizeCode('K7Q4-M2X')).toThrow();
    expect(() => normalizeCode('K7Q4-M2X0')).toThrow(); // 0 ليس في الأبجدية
    expect(normalizeCode(' k7q4 m2xd ')).toBe('K7Q4M2XD');
  });
});

describe('profile images through the public gate', () => {
  it('an uploaded image is readable without a session, as <img> needs', async () => {
    const { env, db } = testEnv();
    const hash = 'a'.repeat(64);
    db.prepare('INSERT INTO media (hash, owner_id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      hash,
      ME,
      'image/png',
      4,
      btoa('\u0089PNG'),
      Date.now(),
    );
    const res = await worker.fetch(new Request(`https://sync.test/v1/media/${hash}`), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    // الرفع نفسه ما زال يحتاج جلسة
    const up = await worker.fetch(new Request('https://sync.test/v1/media', { method: 'POST', body: 'x' }), env, ctx);
    expect(up.status).toBe(401);
  });
});
