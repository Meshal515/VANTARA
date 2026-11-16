import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// «حذف العمل» (قرار المالك، 16 نوفمبر 2026): المالك وحده يحذف ويعيد، الأرشيف له وحده،
// غيره يستلم بصمات بلا اسم ولا غلاف، ولا إشعار ولا نشاط لأحد.

const SECRET = 'removed-works-secret-that-is-at-least-32-chars';
const OWNER = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';

function testEnv() {
  return sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
    VANTARA_OWNERS: OWNER,
  });
}
const ctx = { waitUntil: () => {} };
let seq = 0;
async function call(env: ReturnType<typeof testEnv>['env'], as: string, path: string, init: RequestInit = {}) {
  const token = await mintToken(as, SECRET);
  return worker.fetch(new Request(`https://sync.test${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }), env, ctx);
}
async function op(env: ReturnType<typeof testEnv>['env'], as: string, kind: string, payload: Record<string, unknown>) {
  const res = await call(env, as, '/v1/ops', { method: 'POST', body: JSON.stringify({ ops: [{ opId: `op-rm-${++seq}`, kind, payload, at: Date.now() }] }) });
  expect(res.status).toBe(200);
}
async function pull(env: ReturnType<typeof testEnv>['env'], as: string) {
  const res = await call(env, as, '/v1/sync?since=0');
  return ((await res.json()) as { changes: Record<string, Array<Record<string, unknown>>> }).changes;
}
const work = { key: 'cinema:tt0137523', kind: 'cinema', keys: ['cinema:tt0137523', 'tt0137523'], tokens: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb'], title: 'Fight Club', cover: 'https://img/fc.jpg' };

describe('حذف العمل من التطبيق', () => {
  it('المالك يحذف: الأرشيف له وحده، والبصمات بلا اسم للجميع، ولا إشعار ولا نشاط', async () => {
    const { env, db } = testEnv();
    await pull(env, OWNER);
    await pull(env, B);
    await op(env, OWNER, 'work.remove', work);
    const owner = await pull(env, OWNER);
    const other = await pull(env, B);
    expect(owner.removed_works).toEqual([expect.objectContaining({ key: 'cinema:tt0137523', title: 'Fight Club', active: 1 })]);
    expect(other.removed_works ?? []).toHaveLength(0);
    expect((other.removed_work_tokens ?? []).map((r) => r.token).sort()).toEqual(work.tokens);
    // البصمة لا تحمل اسمًا ولا غلافًا ولا مرجعًا
    for (const row of other.removed_work_tokens ?? []) expect(Object.keys(row).sort()).toEqual(['active', 'rev', 'token']);
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM activity").get()).toEqual({ n: 0 });
  });

  it('غير المالك لا يحذف ولا يعيد', async () => {
    const { env, db } = testEnv();
    await pull(env, OWNER);
    await pull(env, B);
    await op(env, B, 'work.remove', work);
    expect(db.prepare('SELECT COUNT(*) AS n FROM removed_works').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM removed_work_tokens').get()).toEqual({ n: 0 });
    await op(env, OWNER, 'work.remove', work);
    await op(env, B, 'work.restore', { key: work.key });
    expect(db.prepare('SELECT active FROM removed_works').get()).toEqual({ active: 1 });
  });

  it('الإعادة ترجعه للجميع بلا إشعار', async () => {
    const { env, db } = testEnv();
    await pull(env, OWNER);
    await pull(env, B);
    await op(env, OWNER, 'work.remove', work);
    await op(env, OWNER, 'work.restore', { key: work.key });
    expect((await pull(env, B)).removed_work_tokens?.every((r) => r.active === 0)).toBe(true);
    expect((await pull(env, OWNER)).removed_works?.[0]).toMatchObject({ active: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications").get()).toEqual({ n: 0 });
  });
});
