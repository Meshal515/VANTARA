import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// الإشعارات الجديدة: رسالة المجلس تصل كل عضو إلا المرسل وتتجمّع لكل مرسل،
// وفصل جديد يصل من العمل في مفضلته فقط ويتجمّع مداه حتى يُقرأ.

const SECRET = 'notify-messages-units-secret-at-least-32-chars';
const OWNER = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const C = '07588797-a471-44d1-99ce-7fb4f188c196';

function testEnv() {
  return sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
    VANTARA_OWNERS: OWNER,
  });
}
type E = ReturnType<typeof testEnv>['env'];
const ctx = { waitUntil: () => {} };
let seq = 0;
async function call(env: E, as: string, path: string, init: RequestInit = {}) {
  const token = await mintToken(as, SECRET);
  return worker.fetch(new Request(`https://sync.test${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }), env, ctx);
}
async function op(env: E, as: string, kind: string, payload: Record<string, unknown>, opId = `op-notify-${++seq}`) {
  const res = await call(env, as, '/v1/ops', { method: 'POST', body: JSON.stringify({ ops: [{ opId, kind, payload, at: Date.now() }] }) });
  expect(res.status).toBe(200);
  return opId;
}
async function notes(env: E, as: string, kind: string) {
  const res = await call(env, as, '/v1/sync?since=0');
  const rows = ((await res.json()) as { changes: Record<string, Array<Record<string, unknown>>> }).changes.notifications ?? [];
  return rows.filter((n) => n['kind'] === kind && n['user_id'] === as);
}
const body = (row: Record<string, unknown> | undefined) => JSON.parse(String(row?.['body'] ?? 'null'));
async function observe(env: E, as: string, numbers: number[]) {
  const works = [{
    work: 'ext:solo leveling', section: 'manga', kind: 'chapter', title: 'Solo Leveling', cover: 'https://img.test/sl.jpg',
    source: { s: 'mangadex', u: '/m/sl' }, units: [...numbers].sort((a, b) => b - a).map((number) => ({ number })),
  }];
  const res = await call(env, as, '/v1/updates/observe', { method: 'POST', body: JSON.stringify({ works }) });
  expect(res.status).toBe(200);
  return res.json() as Promise<{ created: number }>;
}

describe('majlis message notifications', () => {
  it('reach every member but the sender, one per sender that counts while unread', async () => {
    const { env } = testEnv();
    await op(env, B, 'majlis.send', { kind: 'text', body: 'شفت الحلقة؟' });
    await op(env, B, 'majlis.send', { kind: 'text', body: 'رد علي' });
    expect(await notes(env, B, 'MESSAGE')).toHaveLength(0);
    const [toOwner] = await notes(env, OWNER, 'MESSAGE');
    expect(toOwner).toMatchObject({ actor_id: B, read: 0, seen: 0 });
    expect(body(toOwner)).toEqual({ p: 'رد علي', n: 2 });
    expect(await notes(env, C, 'MESSAGE')).toHaveLength(1);

    // بعد القراءة يبدأ العدّ من جديد
    await op(env, OWNER, 'notification.read', { id: toOwner!['id'] });
    await op(env, B, 'majlis.send', { kind: 'text', body: 'ثالثة' });
    const [again] = await notes(env, OWNER, 'MESSAGE');
    expect(again).toMatchObject({ read: 0 });
    expect(body(again)).toEqual({ p: 'ثالثة', n: 1 });
  });

  it('a message deleted for everyone leaves no preview in anyone\'s notification', async () => {
    const { env } = testEnv();
    const id = await op(env, B, 'majlis.send', { kind: 'text', body: 'سر' });
    await op(env, B, 'majlis.delete', { target: `msg:${id}`, scope: 'everyone' });
    const [row] = await notes(env, OWNER, 'MESSAGE');
    expect(String(row?.['body'])).not.toContain('سر');
    expect(body(row)).toMatchObject({ x: 1 });
  });
});

describe('new chapters of a favorite', () => {
  it('notify only who has the work in favorites, never for the baseline, and grow the range while unread', async () => {
    const { env } = testEnv();
    await op(env, C, 'favorite.set', { seriesRef: 'ext:solo leveling', seriesTitle: 'Solo Leveling', coverUrl: null, member: true });
    await observe(env, OWNER, Array.from({ length: 100 }, (_, i) => i + 1));
    expect(await notes(env, C, 'NEW_UNIT')).toHaveLength(0);

    expect((await observe(env, OWNER, [101, 102])).created).toBe(2);
    const [first] = await notes(env, C, 'NEW_UNIT');
    expect(first).toMatchObject({ series_ref: 'ext:solo leveling', link: 'vantara://series/ext%3Asolo%20leveling', read: 0 });
    expect(body(first)).toMatchObject({ t: 'Solo Leveling', k: 'chapter', a: 101, b: 102, c: 'https://img.test/sl.jpg' });
    expect(await notes(env, B, 'NEW_UNIT')).toHaveLength(0);
    expect(await notes(env, OWNER, 'NEW_UNIT')).toHaveLength(0);

    await observe(env, OWNER, [103]);
    expect(body((await notes(env, C, 'NEW_UNIT'))[0])).toMatchObject({ a: 101, b: 103 });

    // بعد القراءة: إشعار بالوحدة الجديدة وحدها
    await op(env, C, 'notification.read', { id: first!['id'] });
    await observe(env, OWNER, [104]);
    const [fresh] = await notes(env, C, 'NEW_UNIT');
    expect(fresh).toMatchObject({ read: 0 });
    expect(body(fresh)).toMatchObject({ a: 104, b: 104 });
  });

  it('a work removed from favorites stops notifying', async () => {
    const { env } = testEnv();
    await op(env, C, 'favorite.set', { seriesRef: 'ext:solo leveling', seriesTitle: 'Solo Leveling', coverUrl: null, member: true });
    await op(env, C, 'favorite.set', { seriesRef: 'ext:solo leveling', seriesTitle: 'Solo Leveling', coverUrl: null, member: false });
    await observe(env, OWNER, [1, 2, 3]);
    await observe(env, OWNER, [4]);
    expect(await notes(env, C, 'NEW_UNIT')).toHaveLength(0);
  });
});

describe('phone check-in token (no session, notifications only)', () => {
  async function device(env: E, as: string) {
    const res = await call(env, as, '/v1/notify/device', { method: 'POST' });
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }
  const withToken = (env: E, token: string, path: string, init: RequestInit = {}) =>
    worker.fetch(new Request(`https://sync.test${path}`, { ...init, headers: { authorization: `Notify ${token}`, 'content-type': 'application/json' } }), env, ctx);

  it('gives ready-to-show text of what is new, and once shown it is not offered again nor toasted in the app', async () => {
    const { env } = testEnv();
    const token = await device(env, OWNER);
    await op(env, B, 'majlis.send', { kind: 'text', body: 'وينك' });
    const res = await withToken(env, token, '/v1/notify/pending');
    expect(res.status).toBe(200);
    const { items, lockPreview } = (await res.json()) as { items: Array<Record<string, unknown>>; lockPreview: boolean };
    expect(lockPreview).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'MESSAGE', group: 'messages', body: 'وينك', round: true });

    expect((await withToken(env, token, '/v1/notify/seen', { method: 'POST', body: JSON.stringify({ ids: [items[0]!['id']] }) })).status).toBe(200);
    const again = (await (await withToken(env, token, '/v1/notify/pending')).json()) as { items: unknown[] };
    expect(again.items).toHaveLength(0);
    expect((await notes(env, OWNER, 'MESSAGE'))[0]).toMatchObject({ seen: 1, read: 0 });
  });

  it('cannot sync, write, or read someone else; a forgotten or bogus token is refused', async () => {
    const { env } = testEnv();
    const token = await device(env, OWNER);
    expect((await withToken(env, token, '/v1/sync?since=0')).status).toBe(401);
    expect((await withToken(env, 'vn_' + 'x'.repeat(43), '/v1/notify/pending')).status).toBe(401);
    expect((await withToken(env, token, '/v1/notify/device', { method: 'DELETE' })).status).toBe(200);
    expect((await withToken(env, token, '/v1/notify/pending')).status).toBe(401);
  });

  it('respects the person\'s switches: phone off, or a kind turned off', async () => {
    const { env } = testEnv();
    const token = await device(env, OWNER);
    await op(env, OWNER, 'settings.patch', { fields: { notifications: { popups: true, kinds: { MESSAGE: false } } } });
    await op(env, B, 'majlis.send', { kind: 'text', body: 'مطفأ' });
    expect(((await (await withToken(env, token, '/v1/notify/pending')).json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});
