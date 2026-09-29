import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

const SECRET = 'insights-secret-with-at-least-thirty-two-chars';
const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const ctx = { waitUntil: () => {} };
async function call(env: ReturnType<typeof sqliteEnv>['env'], user: string, path: string, body?: unknown) {
  const token = await mintToken(user, SECRET);
  return worker.fetch(new Request(`https://sync.test${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, ctx);
}
let seq = 0;
async function op(env: ReturnType<typeof sqliteEnv>['env'], user: string, kind: string, payload: Record<string, unknown>, id = `insight-${++seq}`) {
  const body = { ops: [{ opId: id, kind, payload, at: Date.now() }] };
  const res = await call(env, user, '/v1/ops', body);
  expect(res.status).toBe(200);
  return body;
}

describe('per-work insights privacy and attribution', () => {
  it('keeps time private by default, credits the actual work once, and separates time from progress permission', async () => {
    const { env } = sqliteEnv({ VANTARA_SESSION_SECRET: SECRET });
    const id = `insight-${++seq}`;
    const first = await op(env, A, 'usage.work', { seriesRef: 'anime:123', section: 'anime', seriesTitle: 'Private Anime', activeMs: 60000 }, id);
    await call(env, A, '/v1/ops', first); // same op id, no double count
    await op(env, A, 'chapter.mark', { seriesRef: 'anime:123', chapterKey: 'anime:123#ep:1', read: true });
    const mine = await (await call(env, A, `/v1/insights/${A}`)).json() as any;
    expect(mine.totalMs).toBe(60000);
    expect(mine.content[0]).toMatchObject({ seriesRef: 'anime:123', activeMs: 60000, completed: 1 });
    expect((await call(env, B, `/v1/insights/${A}`)).status).toBe(403);
    expect((await call(env, B, `/v1/stats/${A}`)).status).toBe(403);
    const oldSync = await (await call(env, B, '/v1/sync?since=0')).text();
    expect(oldSync).not.toContain('Private Anime');

    await op(env, A, 'settings.patch', { fields: { shareInsights: true, shareInsightTime: true, shareInsightProgress: false } });
    const timeOnly = await (await call(env, B, `/v1/insights/${A}?work=anime%3A123`)).json() as any;
    expect(timeOnly.content[0]).toMatchObject({ activeMs: 60000, completed: 0 });
    expect((await call(env, B, `/v1/stats/${A}`)).status).toBe(403);
    await op(env, A, 'settings.patch', { fields: { shareInsightTime: false, shareInsightProgress: true } });
    const progressOnly = await (await call(env, B, `/v1/insights/${A}?work=anime%3A123`)).json() as any;
    expect(progressOnly.content[0]).toMatchObject({ activeMs: 0, completed: 1, title: null });
    await op(env, A, 'settings.patch', { fields: { shareInsights: false } });
    expect((await call(env, B, `/v1/insights/${A}?work=anime%3A123`)).status).toBe(403);
    expect((await call(env, A, `/v1/insights/${A}`)).status).toBe(200);
  });

  it('adds short visits in milliseconds without rounding them away or replaying an operation twice', async () => {
    const { env } = sqliteEnv({ VANTARA_SESSION_SECRET: SECRET });
    const first = await op(env, A, 'usage.work', { seriesRef: 'manga:short', section: 'manga', activeMs: 2300 });
    await call(env, A, '/v1/ops', first);
    await op(env, A, 'usage.work', { seriesRef: 'manga:short', section: 'manga', activeMs: 3700 });
    const mine = await (await call(env, A, `/v1/insights/${A}`)).json() as any;
    expect(mine.content[0].activeMs).toBe(6000);
  });

  it('keeps old daily usage and weekly time private in every server response', async () => {
    const { env } = sqliteEnv({ VANTARA_SESSION_SECRET: SECRET });
    await op(env, A, 'usage.add', { activeMs: 120000 });
    const otherMirror = await (await call(env, B, '/v1/sync?since=0')).json() as any;
    expect(JSON.stringify(otherMirror.changes?.usage_daily ?? [])).not.toContain(A);
    const ownMirror = await (await call(env, A, '/v1/sync?since=0')).json() as any;
    expect(JSON.stringify(ownMirror.changes?.usage_daily ?? [])).toContain(A);
    const weekly = await (await call(env, B, '/v1/week')).json() as any;
    expect(weekly.content.people.find((p: any) => p.userId === A)?.activeMs).toBe(0);
    await op(env, A, 'settings.patch', { fields: { shareInsights: true, shareInsightTime: true } });
    const shared = await (await call(env, B, '/v1/week')).json() as any;
    expect(shared.content.people.find((p: any) => p.userId === A)?.activeMs).toBe(120000);
  });
});
