import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// «جاري الاستلام» إلى الأبد: صاحبك فتح الفريم وتفاعل معه، وأنت ترى «وصله».

const SECRET = 'receipts-secret-that-is-at-least-32-characters';
const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const C = '07588797-a471-44d1-99ce-7fb4f188c196';

function testEnv() {
  return sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
  });
}
const ctx = { waitUntil: () => {} };
let seq = 0;
async function receipt(env: ReturnType<typeof testEnv>['env'], as: string, payload: Record<string, unknown>) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(
    new Request('https://sync.test/v1/ops', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ opId: `op-rc-${++seq}`, kind: 'majlis.receipt', payload, at: Date.now() }] }),
    }),
    env,
    ctx,
  );
  expect(res.status).toBe(200);
}
async function pull(env: ReturnType<typeof testEnv>['env'], as: string) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(new Request('https://sync.test/v1/sync?since=0', { headers: { authorization: `Bearer ${token}` } }), env, ctx);
  return ((await res.json()) as { changes: Record<string, Array<Record<string, unknown>>> }).changes.majlis_receipts ?? [];
}
function frame(db: ReturnType<typeof testEnv>['db'], id: string, from: string, to: string, hidden: string[]) {
  db.prepare(
    `INSERT INTO frames (id, from_id, to_id, source_id, series_title, chapter_label, cover_url, work_json, chapter_json,
       pages_json, message, created_at, rev, audience, hidden_json, broadcast)
     VALUES (?, ?, ?, 'pkg', 'عمل', 'الفصل 1', NULL, '{}', '{}', '[{"index":1}]', NULL, 1, 1, 'MAJLIS', ?, 0)`,
  ).run(id, from, to, JSON.stringify(hidden));
}

describe('majlis receipts', () => {
  it('delivered then seen reaches the sender, and never goes back', async () => {
    const { env: e2, db } = testEnv();
    frame(db, 'f1', A, B, []);
    await receipt(e2, B, { targetKind: 'frame', targetId: 'f1', seen: false });
    let rows = await pull(e2, A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['delivered_at']).toBeTypeOf('number');
    expect(rows[0]?.['seen_at']).toBeNull();

    await receipt(e2, B, { targetKind: 'frame', targetId: 'f1', seen: true });
    rows = await pull(e2, A);
    const seenAt = rows[0]?.['seen_at'];
    expect(seenAt).toBeTypeOf('number');

    // إعادة «وصل» بعد «شاف» لا تمحو المشاهدة ولا تحرّك rev
    const before = db.prepare('SELECT rev FROM majlis_receipts').get() as { rev: number };
    await receipt(e2, B, { targetKind: 'frame', targetId: 'f1', seen: false });
    await receipt(e2, B, { targetKind: 'frame', targetId: 'f1', seen: true });
    const after = db.prepare('SELECT rev, seen_at FROM majlis_receipts').get() as { rev: number; seen_at: number };
    expect(after).toEqual({ rev: before.rev, seen_at: seenAt });
  });

  it('only the sender and the viewer see a receipt; the hidden cannot write one; the sender writes none on their own', async () => {
    const { env, db } = testEnv();
    frame(db, 'f2', A, B, [C]);
    await receipt(env, C, { targetKind: 'frame', targetId: 'f2', seen: true });
    await receipt(env, A, { targetKind: 'frame', targetId: 'f2', seen: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM majlis_receipts').get()).toEqual({ n: 0 });

    frame(db, 'f3', A, B, []);
    await receipt(env, C, { targetKind: 'frame', targetId: 'f3', seen: true });
    expect((await pull(env, A)).map((r) => r['user_id'])).toEqual([C]);
    expect(await pull(env, B)).toEqual([]);
    expect((await pull(env, C)).length).toBe(1);
  });

  it('pulse answers the current rev', async () => {
    const { env, db } = testEnv();
    frame(db, 'f4', A, B, []);
    await receipt(env, B, { targetKind: 'frame', targetId: 'f4', seen: true });
    const token = await mintToken(A, SECRET);
    const res = await worker.fetch(new Request('https://sync.test/v1/pulse', { headers: { authorization: `Bearer ${token}` } }), env, ctx);
    const body = (await res.json()) as { rev: number };
    const { rev } = db.prepare('SELECT rev FROM sync_state WHERE id = 1').get() as { rev: number };
    expect(body.rev).toBe(rev);
    expect(rev).toBeGreaterThan(0);
  });
});
