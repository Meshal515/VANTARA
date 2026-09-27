import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// الخصوصية كما يراها صديقك فعلًا: من الخادم، لا من إخفاء في الواجهة.

const SECRET = 'privacy-secret-that-is-at-least-32-characters';
const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const HOUR = 3_600_000;
let clock = 1_800_000_000_000;

function testEnv() {
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const out = sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
  });
  out.db.prepare(`INSERT INTO accounts (user_id, username, created_at, rev) VALUES (?, 'a', 1, 1), (?, 'b', 1, 1) ON CONFLICT DO NOTHING`).run(A, B);
  return out;
}
afterEach(() => vi.restoreAllMocks());
const ctx = { waitUntil: () => {} };
let seq = 0;
async function call(env: ReturnType<typeof testEnv>['env'], as: string, path: string, init: RequestInit = {}) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(
    new Request(`https://sync.test${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }),
    env,
    ctx,
  );
  return res;
}
async function op(env: ReturnType<typeof testEnv>['env'], as: string, kind: string, payload: Record<string, unknown>) {
  const res = await call(env, as, '/v1/ops', { method: 'POST', body: JSON.stringify({ ops: [{ opId: `op-priv-${++seq}`, kind, payload, at: clock }] }) });
  expect(res.status).toBe(200);
}
async function pull(env: ReturnType<typeof testEnv>['env'], as: string, since = 0) {
  const res = await call(env, as, `/v1/sync?since=${since}`);
  return (await res.json()) as { cursor: number; changes: Record<string, Array<Record<string, unknown>>> };
}
const views = async (env: ReturnType<typeof testEnv>['env'], as: string) => {
  const changes = (await pull(env, as)).changes;
  return ((as === A ? changes.work_views : changes.public_work_views) ?? []).filter((r) => r.user_id === A);
};

describe('current work privacy', () => {
  it('sharing on: friends see the recent view immediately (no artificial delay)', async () => {
    const { env } = testEnv();
    await op(env, A, 'view.add', { seriesRef: 'ext:lookism', seriesTitle: 'Lookism', chapterLabel: 'الفصل 5', chapterNumber: 5 });
    expect((await views(env, B)).map((r) => r.series_ref)).toEqual(['ext:lookism']);
  });

  it('hidden: owner sees it now, friends only after one hour — and a friend who already synced still receives it', async () => {
    const { env } = testEnv();
    await op(env, A, 'settings.patch', { fields: { shareCurrent: false } });
    await op(env, A, 'view.add', { seriesRef: 'ext:x', seriesTitle: 'X', chapterLabel: 'الفصل 3', chapterNumber: 3 });

    expect((await views(env, A)).map((r) => r.series_ref)).toEqual(['ext:x']);
    const early = await pull(env, B);
    expect((early.changes.public_work_views ?? []).filter((r) => r.user_id === A)).toEqual([]);

    clock += HOUR + 1000;
    // B يسحب من حيث وقف: النشر رفع rev فيصله
    const later = await pull(env, B, early.cursor);
    expect((later.changes.public_work_views ?? []).map((r) => r.series_ref)).toEqual(['ext:x']);
  });

  it('hidden and removed within the hour: friends never receive it, not even a tombstone', async () => {
    const { env } = testEnv();
    await op(env, A, 'settings.patch', { fields: { shareCurrent: false } });
    await op(env, A, 'view.add', { seriesRef: 'ext:secret', seriesTitle: 'Secret' });
    clock += 20 * 60_000;
    await op(env, A, 'view.remove', { seriesRef: 'ext:secret' });
    clock += 2 * HOUR;
    await pull(env, A); // يشغّل النشر
    expect(await views(env, B)).toEqual([]);
    const all = JSON.stringify((await pull(env, B)).changes);
    expect(all).not.toContain('ext:secret');
  });

  it('presence: hidden work keeps «يقرأ» but drops the title, chapter and ref', async () => {
    const { env } = testEnv();
    await op(env, A, 'settings.patch', { fields: { shareCurrent: false } });
    await call(env, A, '/v1/presence', { method: 'POST', body: JSON.stringify({ status: 'READING', seriesRef: 'ext:x', seriesTitle: 'X', chapterLabel: 'الفصل 3', screen: 'READER' }) });
    const list = (await (await call(env, B, '/v1/presence')).json()) as { content: Array<Record<string, unknown>> };
    const a = list.content.find((p) => p.userId === A);
    expect(a).toMatchObject({ status: 'READING', seriesTitle: null, seriesRef: null, chapterLabel: null, workHidden: true });
  });
});

describe('recent views privacy', () => {
  it('backfills already published legacy views and revokes them after the setting changes', async () => {
    const { env, db } = testEnv();
    db.prepare('INSERT INTO work_views (user_id, series_ref, series_title, viewed_at, rev, published) VALUES (?, ?, ?, ?, ?, 1)')
      .run(A, 'ext:legacy', 'Legacy', clock, 1);
    const old = await pull(env, B);
    expect(old.changes.public_work_views?.map((r) => r.series_ref)).toEqual(['ext:legacy']);
    await op(env, A, 'settings.patch', { fields: { showRecentViews: false } });
    expect((await pull(env, B, old.cursor)).changes.view_privacy).toMatchObject([{ user_id: A, visible: 0 }]);
    expect((await pull(env, B)).changes.public_work_views ?? []).toEqual([]);
  });

  it('revokes previously synced views, preserves the owner history, and never republishes private-period views', async () => {
    const { env, db } = testEnv();
    await op(env, A, 'view.add', { seriesRef: 'ext:old', seriesTitle: 'Old' });
    const received = await pull(env, B);
    expect(received.changes.work_views?.filter((r) => r.user_id === A) ?? []).toEqual([]);
    expect(received.changes.public_work_views?.map((r) => r.series_ref)).toEqual(['ext:old']);

    await op(env, A, 'settings.patch', { fields: { showRecentViews: false } });
    const revoked = await pull(env, B, received.cursor);
    expect(revoked.changes.view_privacy).toMatchObject([{ user_id: A, visible: 0 }]);
    expect(revoked.changes.public_work_views ?? []).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM public_work_views WHERE user_id = ?').get(A)).toEqual({ n: 0 });

    await op(env, A, 'view.add', { seriesRef: 'ext:private', seriesTitle: 'Private' });
    clock += 2 * HOUR;
    const friend = await pull(env, B, revoked.cursor);
    expect(friend.changes.work_views?.filter((r) => r.user_id === A) ?? []).toEqual([]);
    expect(friend.changes.public_work_views ?? []).toEqual([]);
    expect((await views(env, A)).map((r) => r.series_ref).sort()).toEqual(['ext:old', 'ext:private']);
    expect((await pull(env, B)).changes.public_work_views ?? []).toEqual([]);

    await op(env, A, 'settings.patch', { fields: { showRecentViews: true } });
    expect((await views(env, B))).toEqual([]);
    await op(env, A, 'view.add', { seriesRef: 'ext:new', seriesTitle: 'New' });
    expect((await views(env, B)).map((r) => r.series_ref)).toEqual(['ext:new']);
  });

  it('does not change presence or completion activity when only recent views are hidden', async () => {
    const { env } = testEnv();
    await op(env, A, 'settings.patch', { fields: { showRecentViews: false } });
    await call(env, A, '/v1/presence', { method: 'POST', body: JSON.stringify({ status: 'READING', seriesRef: 'ext:now', seriesTitle: 'Now', screen: 'READER' }) });
    const presence = (await (await call(env, B, '/v1/presence')).json()) as { content: Array<Record<string, unknown>> };
    expect(presence.content.find((p) => p.userId === A)?.seriesRef).toBe('ext:now');
    await op(env, A, 'chapter.complete', { chapterKey: 'ext:now#n:2', seriesRef: 'ext:now', chapterNumber: 2, ratio: 1, activeMs: 9000 });
    expect(((await pull(env, B)).changes.activity ?? []).some((r) => r.verb === 'CHAPTER_DONE')).toBe(true);
  });
});

describe('completion privacy', () => {
  const complete = (n: number) => ({ chapterKey: `ext:y#n:${n}`, seriesRef: 'ext:y', chapterNumber: n, ratio: 1, activeMs: 9000 });

  it('default: one completion event per chapter, even when read twice', async () => {
    const { env, db } = testEnv();
    await op(env, A, 'chapter.complete', complete(50));
    await op(env, A, 'chapter.complete', complete(50));
    expect(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE verb = 'CHAPTER_DONE'").get()).toEqual({ n: 1 });
    expect(((await pull(env, B)).changes.activity ?? []).map((r) => r.verb)).toEqual(['CHAPTER_DONE']);
  });

  it('hidden completions: no event for friends, but own progress still counts', async () => {
    const { env, db } = testEnv();
    await op(env, A, 'settings.patch', { fields: { shareCompletions: false } });
    await op(env, A, 'chapter.complete', complete(51));
    expect(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE verb = 'CHAPTER_DONE'").get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT read_count FROM chapter_reads WHERE chapter_key = ?').get('ext:y#n:51')).toEqual({ read_count: 1 });
  });

  it('chapter_reads are the owner’s alone', async () => {
    const { env } = testEnv();
    await op(env, A, 'chapter.complete', complete(52));
    expect((await pull(env, B)).changes.chapter_reads ?? []).toEqual([]);
    expect(((await pull(env, A)).changes.chapter_reads ?? []).length).toBe(1);
  });
});
