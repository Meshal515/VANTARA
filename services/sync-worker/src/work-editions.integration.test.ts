import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// «Slam Dunk»: صديقٌ فتح العمل وقرأه، وجهازك لم يفتحه قط. قبل هذا الجدول كان
// يصلك مرجعه وحده (`ext:slam dunk`) بلا اسم ولا مصدر، فيُفتح «لا فصول».

const SECRET = 'editions-secret-that-is-at-least-32-characters';
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
      body: JSON.stringify({ ops: [{ opId: `op-ed-${++seq}`, kind, payload, at: Date.now() }] }),
    }),
    env,
    ctx,
  );
  expect(res.status).toBe(200);
}
async function works(env: ReturnType<typeof testEnv>['env'], as: string) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(new Request('https://sync.test/v1/sync?since=0', { headers: { authorization: `Bearer ${token}` } }), env, ctx);
  return ((await res.json()) as { changes: Record<string, Array<Record<string, unknown>>> }).changes.works ?? [];
}
const edition = (sourceId: string, url: string) => ({
  sourceId,
  label: sourceId.toUpperCase(),
  manga: { url, title: 'Slam Dunk', thumbnailUrl: `https://img.test/${sourceId}.jpg`, memo: '{}', description: 'dropped' },
});
const editionsOf = (row: Record<string, unknown> | undefined) =>
  JSON.parse(String(row?.['editions_json'] ?? '[]')) as Array<{ sourceId: string; manga: Record<string, unknown> }>;

describe('work.describe', () => {
  it('editions one device found reach every other account', async () => {
    const { env } = testEnv();
    await send(env, A, 'work.describe', { seriesRef: 'ext:slam dunk', title: 'Slam Dunk', coverUrl: 'https://img.test/a.jpg', editions: [edition('a', '/a/1')] });
    const [row] = await works(env, B);
    expect(row?.['title']).toBe('Slam Dunk');
    expect(editionsOf(row).map((e) => e.sourceId)).toEqual(['a']);
    // ما يلزم لفتح النسخة فقط، لا نبذة ولا فصول
    expect(editionsOf(row)[0]?.manga).toEqual({ url: '/a/1', title: 'Slam Dunk', thumbnailUrl: 'https://img.test/a.jpg', memo: '{}' });
  });

  it('two devices build one list: new sources are added, a known source takes the latest url', async () => {
    const { env } = testEnv();
    await send(env, A, 'work.describe', { seriesRef: 'ext:slam dunk', title: 'Slam Dunk', editions: [edition('a', '/a/1'), edition('b', '/b/1')] });
    await send(env, B, 'work.describe', { seriesRef: 'ext:slam dunk', editions: [edition('b', '/b/2'), edition('c', '/c/1')] });
    const [row] = await works(env, A);
    const list = editionsOf(row);
    expect(list.map((e) => e.sourceId).sort()).toEqual(['a', 'b', 'c']);
    expect(list.find((e) => e.sourceId === 'b')?.manga['url']).toBe('/b/2');
    // عنوانٌ غاب من الوصف الثاني لا يُمحى
    expect(row?.['title']).toBe('Slam Dunk');
  });

  it('an internal ref is never written as a title', async () => {
    const { env } = testEnv();
    await send(env, A, 'work.describe', { seriesRef: 'ext:slam dunk', title: 'ext:slam dunk', editions: [edition('a', '/a/1')] });
    const [row] = await works(env, B);
    expect(row?.['title']).toBeNull();
    await send(env, B, 'work.describe', { seriesRef: 'ext:slam dunk', title: 'Slam Dunk' });
    await send(env, A, 'work.describe', { seriesRef: 'ext:slam dunk', title: 'ext:slam dunk', editions: [edition('a', '/a/2')] });
    expect((await works(env, B))[0]?.['title']).toBe('Slam Dunk');
  });

  it('malformed editions are dropped, not stored', async () => {
    const { env, db } = testEnv();
    await send(env, A, 'work.describe', { seriesRef: 'ext:x', editions: [{ sourceId: 'a' }, 'junk', { manga: { url: '/u' } }] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM works').get()).toEqual({ n: 0 });
  });

  it('reading a chapter describes the work for friends even outside the library', async () => {
    const { env } = testEnv();
    await send(env, A, 'chapter.complete', {
      chapterKey: 'ext:slam dunk#n:1',
      seriesRef: 'ext:slam dunk',
      seriesTitle: 'Slam Dunk',
      coverUrl: 'https://img.test/sd.jpg',
      chapterNumber: 1,
      ratio: 0.25,
      activeMs: 9_000,
    });
    const [row] = await works(env, B);
    expect(row).toMatchObject({ series_ref: 'ext:slam dunk', title: 'Slam Dunk', cover_url: 'https://img.test/sd.jpg' });
  });
});
