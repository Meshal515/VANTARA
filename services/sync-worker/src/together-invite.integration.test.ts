import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// دعوة Together: البطاقة والإشعار لمن اخترتهم فقط.

const SECRET = 'together-invite-secret-that-is-at-least-32-chars';
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
const media = { kind: 'anime', key: 'anime:frieren:e5', label: 'فريرن — الحلقة 5', seriesRef: 'anilist:154587', episode: 5 };

describe('together invite', () => {
  it('reaches only the chosen people, with a notification each, and the type of watch', async () => {
    const { env } = testEnv();
    await op(env, OWNER, 'together.invite', { code: 'ABCDEF', invitees: [B], mode: 'free', media });
    const host = (await pull(env, OWNER)).together_invites ?? [];
    const invited = (await pull(env, B)).together_invites ?? [];
    const other = (await pull(env, C)).together_invites ?? [];
    expect(host).toHaveLength(1);
    expect(invited).toHaveLength(1);
    expect(other).toHaveLength(0);
    expect(invited[0]).toMatchObject({ code: 'ABCDEF', host_id: OWNER, mode: 'free', kind: 'anime' });
    expect(JSON.parse(String(invited[0]!['media_json']))).toMatchObject({ episode: 5 });
    const note = ((await pull(env, B)).notifications ?? []).find((n) => n['kind'] === 'TOGETHER');
    expect(note).toMatchObject({ link: '#together=ABCDEF', actor_id: OWNER });
    expect(((await pull(env, C)).notifications ?? []).some((n) => n['kind'] === 'TOGETHER')).toBe(false);
  });

  it('“all” reaches everyone; strangers and bad codes are ignored; only the host can extend it', async () => {
    const { env, db } = testEnv();
    await op(env, OWNER, 'together.invite', { code: 'GHJKMN', invitees: '*', mode: 'sync', media });
    expect((await pull(env, C)).together_invites).toHaveLength(1);
    await op(env, OWNER, 'together.invite', { code: 'bad', invitees: [B], media });
    await op(env, OWNER, 'together.invite', { code: 'PQRSTU', invitees: ['not-an-account'], media });
    expect(db.prepare('SELECT COUNT(*) AS n FROM together_invites').get()).toEqual({ n: 1 });
    // غير المضيف لا يغيّر مدعوي غرفة غيره
    await op(env, OWNER, 'together.invite', { code: 'VWXYZ2', invitees: [B], media });
    await op(env, B, 'together.invite', { code: 'VWXYZ2', invitees: [C], media });
    expect(db.prepare("SELECT invitees_json FROM together_invites WHERE code = 'VWXYZ2'").get()).toEqual({ invitees_json: JSON.stringify([B]) });
    await op(env, OWNER, 'together.invite', { code: 'VWXYZ2', invitees: [B, C], media });
    expect((await pull(env, C)).together_invites?.map((r) => r['code']).sort()).toEqual(['GHJKMN', 'VWXYZ2']);
  });
});
