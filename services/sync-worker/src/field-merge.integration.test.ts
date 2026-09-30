import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';
import type { Env } from './types.ts';

const SECRET = 'field-merge-secret-that-is-at-least-32-chars';
const USER = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';

function fieldMergeEnv() {
  return sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
  });
}

async function postPatches(
  env: Env,
  kind: 'profile.patch' | 'settings.patch',
  ops: Array<{ opId: string; fields: Record<string, unknown> }>,
): Promise<Response> {
  const token = await mintToken(USER, SECRET);
  return worker.fetch(
    new Request('https://worker.test/v1/ops', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        ops: ops.map((op) => ({ opId: op.opId, kind, payload: { fields: op.fields } })),
      }),
    }),
    env,
    { waitUntil: () => {} },
  );
}

describe('field merge delivery guarantees', () => {
  it('persists profile colors and delivers them to a friend through sync', async () => {
    const { env, db } = fieldMergeEnv();
    const fields = { backgroundColor: '#201234', backgroundGradient: '#0c1830', backgroundAngle: 135, cardColor: '#34204a' };
    expect((await postPatches(env, 'profile.patch', [{ opId: 'colors', fields }])).status).toBe(200);
    const expected = { background_color: '#201234', background_gradient: '#0c1830', background_angle: 135, card_color: '#34204a' };
    expect(db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(USER)).toMatchObject(expected);
    const friend = 'bedcf897-a6f0-4730-b757-402b14891ca5';
    const token = await mintToken(friend, SECRET);
    const response = await worker.fetch(new Request('https://worker.test/v1/sync?since=0', {
      headers: { authorization: `Bearer ${token}` },
    }), env, { waitUntil: () => {} });
    expect(response.status).toBe(200);
    const body = await response.json() as { changes: { profiles: Array<Record<string, unknown>> } };
    expect(body.changes.profiles.find((row) => row.user_id === USER)).toMatchObject(expected);
  });

  it('merges colors independently, ignores malformed theme values and allows reset', async () => {
    const { env, db } = fieldMergeEnv();
    await postPatches(env, 'profile.patch', [{ opId: 'theme-start', fields: {
      backgroundColor: '#223344', backgroundGradient: '#334455', backgroundAngle: 90, cardColor: '#445566',
    } }]);
    await postPatches(env, 'profile.patch', [{ opId: 'card-only', fields: { cardColor: '#abcdef' } }]);
    await postPatches(env, 'profile.patch', [{ opId: 'invalid-theme', fields: {
      backgroundColor: 'url(https://example.com)', backgroundGradient: {}, backgroundAngle: 999, cardColor: '#12',
    } }]);
    expect(db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(USER)).toMatchObject({
      background_color: '#223344', background_gradient: '#334455', background_angle: 90, card_color: '#abcdef',
    });
    await postPatches(env, 'profile.patch', [{ opId: 'theme-reset', fields: {
      backgroundColor: null, backgroundGradient: null, backgroundAngle: null, cardColor: null,
    } }]);
    expect(db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(USER)).toMatchObject({
      background_color: null, background_gradient: null, background_angle: null, card_color: null,
    });
    await postPatches(env, 'profile.patch', [{ opId: 'theme-start', fields: { backgroundColor: '#223344' } }]);
    expect(db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(USER)).toMatchObject({ background_color: null });
  });

  it('does not let a retried older profile op overwrite a newer value', async () => {
    const { env, db } = fieldMergeEnv();
    await postPatches(env, 'profile.patch', [{ opId: 'old-op', fields: { displayName: 'قديم' } }]);
    await postPatches(env, 'profile.patch', [{ opId: 'new-op', fields: { displayName: 'جديد' } }]);
    const retry = await postPatches(env, 'profile.patch', [
      { opId: 'old-op', fields: { displayName: 'قديم' } },
    ]);

    expect(retry.status).toBe(200);
    const row = db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').get(USER) as {
      display_name: string;
    };
    expect(row.display_name).toBe('جديد');
  });

  it('applies later overlapping profile patches from the same request', async () => {
    const { env, db } = fieldMergeEnv();
    const response = await postPatches(env, 'profile.patch', [
      { opId: 'first-op', fields: { displayName: 'الأول', bio: 'نبذة' } },
      { opId: 'second-op', fields: { displayName: 'الثاني' } },
    ]);

    expect(response.status).toBe(200);
    const row = db.prepare('SELECT display_name, bio FROM profiles WHERE user_id = ?').get(USER) as {
      display_name: string;
      bio: string;
    };
    expect(row).toEqual({ display_name: 'الثاني', bio: 'نبذة' });
  });

  it('keeps a newer settings value when an older op is retried', async () => {
    const { env, db } = fieldMergeEnv();
    await postPatches(env, 'settings.patch', [{ opId: 'settings-old', fields: { readerMode: 'old' } }]);
    await postPatches(env, 'settings.patch', [{ opId: 'settings-new', fields: { readerMode: 'new' } }]);
    await postPatches(env, 'settings.patch', [{ opId: 'settings-old', fields: { readerMode: 'old' } }]);

    const row = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(USER) as { data: string };
    expect(JSON.parse(row.data)).toMatchObject({ readerMode: 'new' });
  });
});
