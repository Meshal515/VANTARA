import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// «آخر المشاهدات» سجلّ واحد: حذفه من جوالك يحذفه من ملفك عند أصدقائك.

const SECRET = 'views-secret-that-is-at-least-32-characters-x';
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
async function send(env: ReturnType<typeof testEnv>['env'], as: string, kind: string, payload: Record<string, unknown>) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(
    new Request('https://sync.test/v1/ops', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ opId: `op-v-${++seq}`, kind, payload, at: Date.now() }] }),
    }),
    env,
    ctx,
  );
  expect(res.status).toBe(200);
}
async function views(env: ReturnType<typeof testEnv>['env'], as: string) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(new Request('https://sync.test/v1/sync?since=0', { headers: { authorization: `Bearer ${token}` } }), env, ctx);
  return ((await res.json()) as { changes: Record<string, Array<Record<string, unknown>>> }).changes.work_views ?? [];
}

describe('work views', () => {
  it('a view reaches friends with its chapter, and removal reaches them too', async () => {
    const { env } = testEnv();
    await send(env, A, 'view.add', { seriesRef: 'ext:lookism', seriesTitle: 'Lookism', chapterLabel: 'الفصل 620', chapterNumber: 620, at: Date.now() - 1000 });
    let [row] = await views(env, B);
    expect(row).toMatchObject({ user_id: A, series_ref: 'ext:lookism', series_title: 'Lookism', chapter_number: 620, removed: 0 });

    await send(env, A, 'view.remove', { seriesRef: 'ext:lookism' });
    [row] = await views(env, B);
    expect(row?.['removed']).toBe(1);
  });

  it('a late, older view does not bring back a removed work; a new one does', async () => {
    const { env } = testEnv();
    const t0 = Date.now() - 60_000;
    await send(env, A, 'view.add', { seriesRef: 'ext:x', seriesTitle: 'X', at: t0 });
    await send(env, A, 'view.remove', { seriesRef: 'ext:x' });
    await send(env, A, 'view.add', { seriesRef: 'ext:x', at: t0 + 10 });
    expect((await views(env, A))[0]?.['removed']).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    await send(env, A, 'view.add', { seriesRef: 'ext:x', at: Date.now() });
    expect((await views(env, A))[0]?.['removed']).toBe(0);
  });

  it('an internal ref is never stored as the title', async () => {
    const { env } = testEnv();
    await send(env, A, 'view.add', { seriesRef: 'ext:slam dunk', seriesTitle: 'ext:slam dunk' });
    expect((await views(env, A))[0]?.['series_title']).toBeNull();
  });
});

describe('full sync', () => {
  it('a fresh device receives the three seeded accounts and their profiles (rev 0)', async () => {
    const { env } = testEnv();
    const token = await mintToken(A, SECRET);
    const res = await worker.fetch(new Request('https://sync.test/v1/sync?since=0', { headers: { authorization: `Bearer ${token}` } }), env, ctx);
    const { changes } = (await res.json()) as { changes: Record<string, Array<Record<string, unknown>>> };
    expect((changes.accounts ?? []).map((a) => a['username']).sort()).toEqual(['dahmi', 'mansour', 'ngm']);
    expect((changes.profiles ?? []).length).toBe(3);
  });
});

describe('completions', () => {
  it('completed.set marks a work done for friends to see, and can be undone', async () => {
    const { env } = testEnv();
    await send(env, A, 'completed.set', { seriesRef: 'ext:x', seriesTitle: 'X', member: true });
    const token = await mintToken(B, SECRET);
    const pull = async () =>
      ((await (await worker.fetch(new Request('https://sync.test/v1/sync?since=0', { headers: { authorization: `Bearer ${token}` } }), env, ctx)).json()) as {
        changes: Record<string, Array<Record<string, unknown>>>;
      }).changes;
    expect((await pull()).completions?.[0]).toMatchObject({ user_id: A, series_ref: 'ext:x', member: 1 });
    await send(env, A, 'completed.set', { seriesRef: 'ext:x', member: false });
    expect((await pull()).completions?.[0]?.['member']).toBe(0);
  });
});
