import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// المجلس محادثة: كل صلاحية تُفحص في الخادم، لا في الواجهة.

const SECRET = 'majlis-chat-secret-that-is-at-least-32-chars';
const OWNER = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const C = '07588797-a471-44d1-99ce-7fb4f188c196';

function testEnv() {
  const out = sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
    // المالك بمعرّفه: الأسماء تتغيّر من صفحة الحساب، والمعرّف لا
    VANTARA_OWNERS: OWNER,
  });
  return out;
}
const ctx = { waitUntil: () => {} };
let seq = 0;
async function call(env: ReturnType<typeof testEnv>['env'], as: string, path: string, init: RequestInit = {}, type = 'application/json') {
  const token = await mintToken(as, SECRET);
  return worker.fetch(new Request(`https://sync.test${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': type } }), env, ctx);
}
async function op(env: ReturnType<typeof testEnv>['env'], as: string, kind: string, payload: Record<string, unknown>, opId = `op-chat-${++seq}`) {
  const res = await call(env, as, '/v1/ops', { method: 'POST', body: JSON.stringify({ ops: [{ opId, kind, payload, at: Date.now() }] }) });
  expect(res.status).toBe(200);
  return opId;
}
async function pull(env: ReturnType<typeof testEnv>['env'], as: string) {
  const res = await call(env, as, '/v1/sync?since=0');
  return ((await res.json()) as { changes: Record<string, Array<Record<string, unknown>>> }).changes;
}
const row = (db: ReturnType<typeof testEnv>['db'], id: string) => db.prepare('SELECT * FROM majlis_messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;

describe('majlis chat', () => {
  it('text reaches every member; resending the same op after a reconnect is one message', async () => {
    const { env, db } = testEnv();
    const id = await op(env, B, 'majlis.send', { kind: 'text', body: '  هلا  ' }, 'op-same');
    await op(env, B, 'majlis.send', { kind: 'text', body: '  هلا  ' }, 'op-same');
    expect(db.prepare('SELECT COUNT(*) AS n FROM majlis_messages').get()).toEqual({ n: 1 });
    expect(row(db, id)).toMatchObject({ body: 'هلا', kind: 'text', sender_id: B });
    expect(((await pull(env, C)).majlis_messages ?? []).map((m) => m.body)).toEqual(['هلا']);
  });

  it('a reply points at an id, never at text', async () => {
    const { env, db } = testEnv();
    const first = await op(env, B, 'majlis.send', { kind: 'text', body: 'وش تقرأ؟' });
    const reply = await op(env, C, 'majlis.send', { kind: 'text', body: 'لوكيسم', replyTo: `msg:${first}` });
    expect(row(db, reply)?.['reply_to']).toBe(`msg:${first}`);
    const bad = await op(env, C, 'majlis.send', { kind: 'text', body: 'x', replyTo: 'DROP TABLE' });
    expect(row(db, bad)).toBeUndefined();
  });

  it('voice: only a real audio file the sender uploaded', async () => {
    const { env, db } = testEnv();
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6]);
    const up = (await (await call(env, B, '/v1/media', { method: 'POST', body: webm }, 'audio/webm')).json()) as { hash: string; mime: string };
    expect(up.mime).toBe('audio/webm');
    const ok = await op(env, B, 'majlis.send', { kind: 'voice', mediaKey: up.hash, meta: { durationMs: 4200, waveform: [0.1, 2, -1, 0.5] } });
    expect(JSON.parse(String(row(db, ok)?.['meta_json']))).toEqual({ durationMs: 4200, waveform: [0.1, 1, 0, 0.5] });
    // ملف غيره لا يُرسله صوتًا باسمه
    const stolen = await op(env, C, 'majlis.send', { kind: 'voice', mediaKey: up.hash, meta: { durationMs: 4200 } });
    expect(row(db, stolen)).toBeUndefined();
    // وصوت فارغ (أقل من 0.3 ثانية) لا يُرسل
    const empty = await op(env, B, 'majlis.send', { kind: 'voice', mediaKey: up.hash, meta: { durationMs: 100 } });
    expect(row(db, empty)).toBeUndefined();
  });

  it('delete for everyone: mine yes, a friend’s no — hide for me touches only me', async () => {
    const { env, db } = testEnv();
    const mine = await op(env, B, 'majlis.send', { kind: 'text', body: 'غلطة' });
    const theirs = await op(env, C, 'majlis.send', { kind: 'text', body: 'رسالة منصور' });

    await op(env, B, 'majlis.delete', { target: `msg:${theirs}`, scope: 'everyone' });
    expect(row(db, theirs)).toMatchObject({ deleted: 0, body: 'رسالة منصور' });

    await op(env, B, 'majlis.delete', { target: `msg:${mine}`, scope: 'everyone' });
    expect(row(db, mine)).toMatchObject({ deleted: 1, body: null });

    await op(env, B, 'majlis.delete', { target: `msg:${theirs}`, scope: 'me' });
    expect(row(db, theirs)).toMatchObject({ deleted: 0, body: 'رسالة منصور' });
    expect(((await pull(env, B)).majlis_hidden ?? []).map((h) => h.target)).toEqual([`msg:${theirs}`]);
    expect((await pull(env, C)).majlis_hidden ?? []).toEqual([]);
  });

  it('the owner (from server config) deletes anyone’s message for everyone; a client cannot claim the badge', async () => {
    const { env, db } = testEnv();
    await pull(env, OWNER); // يكتب الشارة من VANTARA_OWNERS
    expect(db.prepare('SELECT user_id FROM accounts WHERE badge = ?').all('owner')).toEqual([{ user_id: OWNER }]);
    const theirs = await op(env, C, 'majlis.send', { kind: 'text', body: 'مخالفة' });
    await op(env, OWNER, 'majlis.delete', { target: `msg:${theirs}`, scope: 'everyone' });
    expect(row(db, theirs)).toMatchObject({ deleted: 2, deleted_by: OWNER, body: null });
    // الصلاحية نفسها على الترشيحات
    await op(env, C, 'recommendation.send', { seriesRef: 'ext:x', seriesTitle: 'X' });
    const rec = db.prepare('SELECT id FROM recommendations').get() as { id: string };
    await op(env, B, 'majlis.delete', { target: `rec:${rec.id}`, scope: 'everyone' });
    expect(db.prepare('SELECT removed FROM recommendations').get()).toEqual({ removed: 0 });
    await op(env, OWNER, 'majlis.delete', { target: `rec:${rec.id}`, scope: 'everyone' });
    expect(db.prepare('SELECT removed FROM recommendations').get()).toEqual({ removed: 1 });
    // لا عملية تكتب الشارة
    await op(env, B, 'profile.patch', { fields: { badge: 'owner' } });
    await op(env, B, 'settings.patch', { fields: { badge: 'owner' } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE badge = ?').get('owner')).toEqual({ n: 1 });
  });

  it('majlis name and avatar: owner only, synced to everyone', async () => {
    const { env, db } = testEnv();
    await pull(env, OWNER);
    await op(env, B, 'majlis.meta', { name: 'مجلس دحمي' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM majlis_meta').get()).toEqual({ n: 0 });
    await op(env, OWNER, 'majlis.meta', { name: 'مجلسنا' });
    expect(((await pull(env, C)).majlis_meta ?? [])[0]).toMatchObject({ name: 'مجلسنا', updated_by: OWNER });
  });
});
