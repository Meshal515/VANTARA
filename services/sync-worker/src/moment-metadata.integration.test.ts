import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';
const SECRET = 'moment-metadata-secret-that-is-at-least-32-chars';
const ME = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const FRIEND = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const ctx = { waitUntil: () => {} };
function fixture() { return sqliteEnv({ VANTARA_SESSION_SECRET: SECRET }); }
async function call(env: ReturnType<typeof fixture>['env'], path: string, init: RequestInit = {}, as = ME) {
  return worker.fetch(new Request(`https://sync.test${path}`, { ...init, headers: { authorization: `Bearer ${await mintToken(as, SECRET)}`, ...init.headers } }), env, ctx);
}
let sequence = 0;
async function recommend(env: ReturnType<typeof fixture>['env'], moment: unknown, toId: string | null = FRIEND) {
  const opId = `moment-${++sequence}`;
  const response = await call(env, '/v1/ops', { method: 'POST', body: JSON.stringify({ ops: [{ opId, kind: 'recommendation.send', payload: { seriesRef: 'anime:1', toId: toId ?? undefined, moment }, at: Date.now() }] }) });
  expect(response.status).toBe(200);
  return opId;
}
const moment = { version: 1, startMs: 5000, endMs: 40_000, episode: 3, sources: [{ sourceId: 'addon|public-source', server: '1080p' }] };
describe('recommendation moment metadata', () => {
  it('persists source hints and the original range for friend and Majlis recipients', async () => {
    const { env, db } = fixture();
    const direct = await recommend(env, moment);
    const majlis = await recommend(env, { ...moment, episode: null }, null);
    expect(JSON.parse(String(db.prepare('SELECT moment_json FROM recommendations WHERE id = ?').get(direct)?.moment_json))).toEqual(moment);
    const sync = await (await call(env, '/v1/sync?since=0', {}, FRIEND)).json() as { changes: { recommendations: Array<{ id: string; moment_json: string }> } };
    expect(JSON.parse(sync.changes.recommendations.find(r => r.id === direct)!.moment_json)).toEqual(moment);
    expect(sync.changes.recommendations.some(r => r.id === majlis)).toBe(true);
    const old = await recommend(env, undefined);
    expect(db.prepare('SELECT moment_json FROM recommendations WHERE id = ?').get(old)).toEqual({ moment_json: null });
  });
  it('rejects invalid metadata without sending recommendations or notifications', async () => {
    const { env, db } = fixture();
    for (const invalid of [{ ...moment, endMs: 5000 }, { ...moment, endMs: 80_001 }, { ...moment, sources: [{ url: 'https://user:secret@example.com/x' }] }]) {
      const bad = await recommend(env, invalid);
      expect(db.prepare('SELECT id FROM recommendations WHERE id = ?').get(bad)).toBeUndefined();
      expect(db.prepare('SELECT id FROM notifications WHERE id LIKE ?').all(`%${bad}%`)).toEqual([]);
    }
  });
  it('accepts only an existing image owned by the sender as a poster', async () => {
    const { env, db } = fixture();
    const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
    const upload = async (as: string) => (await (await call(env, '/v1/media', { method: 'POST', body: image }, as)).json()) as {hash: string};
    const friendPoster = await upload(FRIEND);
    const stolen = await recommend(env, { ...moment, posterKey: friendPoster.hash });
    expect(db.prepare('SELECT id FROM recommendations WHERE id = ?').get(stolen)).toBeUndefined();
    const missing = await recommend(env, { ...moment, posterKey: 'f'.repeat(64) });
    expect(db.prepare('SELECT id FROM recommendations WHERE id = ?').get(missing)).toBeUndefined();
    image[4] = 2;
    const ownPoster = await upload(ME);
    const valid = await recommend(env, { ...moment, posterKey: ownPoster.hash });
    expect(db.prepare('SELECT id FROM recommendations WHERE id = ?').get(valid)).toEqual({ id: valid });
  });
});
