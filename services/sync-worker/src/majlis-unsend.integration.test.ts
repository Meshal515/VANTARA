import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// «حذف للجميع» في آخر ما صار: صاحبه وحده، والشرط في الخادم لا في الواجهة.

const SECRET = 'majlis-unsend-secret-that-is-at-least-32-chars';
const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';

function testEnv() {
  return sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
  });
}
const ctx = { waitUntil: () => {} };
let seq = 0;
async function op(env: ReturnType<typeof testEnv>['env'], as: string, kind: string, payload: Record<string, unknown>) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(
    new Request('https://sync.test/v1/ops', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ opId: `op-unsend-${++seq}`, kind, payload, at: Date.now() }] }),
    }),
    env,
    ctx,
  );
  expect(res.status).toBe(200);
}
async function pull(env: ReturnType<typeof testEnv>['env'], as: string) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(new Request('https://sync.test/v1/sync?since=0', { headers: { authorization: `Bearer ${token}` } }), env, ctx);
  return ((await res.json()) as { changes: Record<string, Array<Record<string, unknown>>> }).changes;
}

describe('majlis.unsend', () => {
  it('the sender removes a recommendation for everyone; the tombstone reaches friends without the note', async () => {
    const { env, db } = testEnv();
    await op(env, A, 'recommendation.send', { seriesRef: 'ext:lookism', seriesTitle: 'Lookism', message: 'اقرأه' });
    const { id } = db.prepare('SELECT id FROM recommendations').get() as { id: string };

    await op(env, B, 'majlis.unsend', { targetKind: 'rec', targetId: id });
    expect(db.prepare('SELECT removed, message FROM recommendations WHERE id = ?').get(id)).toEqual({ removed: 0, message: 'اقرأه' });

    await op(env, A, 'majlis.unsend', { targetKind: 'rec', targetId: id });
    expect(db.prepare('SELECT removed, message FROM recommendations WHERE id = ?').get(id)).toEqual({ removed: 1, message: null });
    const seen = (await pull(env, B)).recommendations?.find((r) => r.id === id);
    expect(seen).toMatchObject({ removed: 1, message: null });
  });

  it('activity: only the actor can remove it, and the payload is cleared', async () => {
    const { env, db } = testEnv();
    db.prepare(
      `INSERT INTO accounts (user_id, username, created_at, rev) VALUES (?, 'a', 1, 1), (?, 'b', 1, 1)
       ON CONFLICT DO NOTHING`,
    ).run(A, B);
    db.prepare(`INSERT INTO activity (id, actor_id, verb, series_ref, payload, created_at, rev) VALUES ('act-1', ?, 'CHAPTER_DONE', 'ext:x', '{"chapter":50}', 1, 1)`).run(A);
    await op(env, B, 'majlis.unsend', { targetKind: 'activity', targetId: 'act-1' });
    expect(db.prepare('SELECT removed FROM activity WHERE id = ?').get('act-1')).toEqual({ removed: 0 });
    await op(env, A, 'majlis.unsend', { targetKind: 'activity', targetId: 'act-1' });
    expect(db.prepare('SELECT removed, payload FROM activity WHERE id = ?').get('act-1')).toEqual({ removed: 1, payload: '{}' });
  });
});
