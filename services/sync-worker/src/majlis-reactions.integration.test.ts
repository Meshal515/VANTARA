import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

const SECRET = 'majlis-secret-that-is-at-least-32-characters';
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
async function react(env: ReturnType<typeof testEnv>['env'], as: string, payload: Record<string, unknown>) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(
    new Request('https://sync.test/v1/ops', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ opId: `op-react-${++seq}`, kind: 'majlis.react', payload, at: Date.now() }] }),
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
function frame(db: ReturnType<typeof testEnv>['db'], id: string, from: string, to: string, hidden: string[]) {
  db.prepare(
    `INSERT INTO frames (id, from_id, to_id, source_id, series_title, chapter_label, cover_url, work_json, chapter_json,
       pages_json, message, created_at, rev, audience, hidden_json, broadcast)
     VALUES (?, ?, ?, 'pkg', 'عمل', 'الفصل 1', NULL, '{}', '{}', '[{"index":1}]', NULL, 1, 1, 'MAJLIS', ?, 0)`,
  ).run(id, from, to, JSON.stringify(hidden));
}

describe('majlis reactions', () => {
  it('a friend who sees the frame can react; the owner is notified; others who see it see the reaction', async () => {
    const { env, db } = testEnv();
    frame(db, 'f-open', A, B, []);
    await react(env, C, { targetKind: 'frame', targetId: 'f-open', emoji: '🔥' });

    const row = db.prepare('SELECT emoji FROM majlis_reactions WHERE target_id = ?').get('f-open') as { emoji: string };
    expect(row.emoji).toBe('🔥');
    const note = db.prepare("SELECT user_id, body FROM notifications WHERE kind = 'REACTION'").get() as { user_id: string; body: string };
    expect(note).toEqual({ user_id: A, body: '🔥' });

    const seenByB = await pull(env, B);
    expect((seenByB.majlis_reactions ?? []).map((r) => r.emoji)).toEqual(['🔥']);
  });

  it('someone the frame is hidden from can neither react nor see reactions on it', async () => {
    const { env, db } = testEnv();
    frame(db, 'f-hidden', A, B, [C]);
    await react(env, C, { targetKind: 'frame', targetId: 'f-hidden', emoji: '❤️' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM majlis_reactions').get()).toEqual({ n: 0 });

    await react(env, B, { targetKind: 'frame', targetId: 'f-hidden', emoji: '❤️' });
    expect((await pull(env, C)).majlis_reactions ?? []).toEqual([]);
    expect(((await pull(env, A)).majlis_reactions ?? []).length).toBe(1);
  });

  it('a new reaction replaces the old one, and withdrawing notifies no one', async () => {
    const { env, db } = testEnv();
    frame(db, 'f-x', A, B, []);
    await react(env, B, { targetKind: 'frame', targetId: 'f-x', emoji: '😂' });
    await react(env, B, { targetKind: 'frame', targetId: 'f-x', emoji: '👏' });
    await react(env, B, { targetKind: 'frame', targetId: 'f-x', emoji: null });
    const rows = db.prepare('SELECT emoji FROM majlis_reactions').all();
    expect(rows).toEqual([{ emoji: null }]);
    // تغيير التفاعل يحدّث الإشعار نفسه لا يضيف غيره
    const notes = db.prepare("SELECT body FROM notifications WHERE kind = 'REACTION'").all();
    expect(notes).toEqual([{ body: '👏' }]);
  });

  it('only the closed set of emoji is accepted, and reacting to yourself notifies no one', async () => {
    const { env, db } = testEnv();
    frame(db, 'f-self', A, B, []);
    await react(env, B, { targetKind: 'frame', targetId: 'f-self', emoji: 'بطيخ' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM majlis_reactions').get()).toEqual({ n: 0 });
    await react(env, A, { targetKind: 'frame', targetId: 'f-self', emoji: '❤️' });
    expect((db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'REACTION'").get() as { n: number }).n).toBe(0);
  });
});
