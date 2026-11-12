import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

const SECRET = 'progress-touch-secret-that-is-at-least-32-chars';
const USER = '3f1c2b7e-1d2a-4c55-9d0e-5b6a7c8d9e01';

function env() {
  const out = sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
  });
  out.db.prepare("INSERT INTO accounts (user_id, username, created_at, rev) VALUES (?, 'reader', 1, 1) ON CONFLICT DO NOTHING").run(USER);
  return out;
}

async function setProgress(e: ReturnType<typeof env>['env'], opId: string, chapterKey: string, page: number, ratio: number) {
  const token = await mintToken(USER, SECRET);
  const res = await worker.fetch(
    new Request('https://worker.test/v1/ops', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ opId, kind: 'progress.set', payload: { chapterKey, seriesRef: 'ext:s:1', page, ratio } }] }),
    }),
    e,
    { waitUntil: () => {} },
  );
  expect(res.status).toBe(200);
}

// #323 U-21/U-07: نظرة على فصل قديم مكتمل كانت تحدّث updated_at وrev فيقلب «تابع» إليه
describe('progress.set that does not advance', () => {
  it('leaves updated_at and rev untouched, so a glance never becomes the latest reading', async () => {
    const { env: e, db } = env();
    await setProgress(e, 'read-337', 'c337', 20, 1);
    const before = db.prepare('SELECT page, ratio, updated_at, rev FROM progress WHERE user_id = ? AND chapter_key = ?').get(USER, 'c337') as Record<string, number>;
    await new Promise((r) => setTimeout(r, 5));
    await setProgress(e, 'glance-337', 'c337', 1, 0.05);
    await setProgress(e, 'same-337', 'c337', 20, 1);
    const after = db.prepare('SELECT page, ratio, updated_at, rev FROM progress WHERE user_id = ? AND chapter_key = ?').get(USER, 'c337') as Record<string, number>;
    expect(after).toEqual(before);
  });

  it('still records real progress (page or ratio moved forward)', async () => {
    const { env: e, db } = env();
    await setProgress(e, 'a', 'c1', 3, 0.2);
    const first = db.prepare('SELECT updated_at, rev FROM progress WHERE chapter_key = ?').get('c1') as Record<string, number>;
    await new Promise((r) => setTimeout(r, 5));
    await setProgress(e, 'b', 'c1', 4, 0.25);
    const next = db.prepare('SELECT page, ratio, updated_at, rev FROM progress WHERE chapter_key = ?').get('c1') as Record<string, number>;
    expect(next.page).toBe(4);
    expect(next.ratio).toBe(0.25);
    expect(next.rev).toBeGreaterThan(first.rev);
    expect(next.updated_at).toBeGreaterThanOrEqual(first.updated_at);
  });
});
