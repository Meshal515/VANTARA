import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

const SECRET = 'media-secret-that-is-at-least-32-characters';
const ME = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const FRIEND = 'bedcf897-a6f0-4730-b757-402b14891ca5';

function testEnv() {
  return sqliteEnv({
    VANTARA_SESSION_SECRET: SECRET,
    VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
    VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
  });
}
const ctx = { waitUntil: () => {} };
async function call(env: ReturnType<typeof testEnv>['env'], path: string, init: RequestInit = {}, as: string | null = ME) {
  const headers = new Headers(init.headers);
  if (as) headers.set('authorization', `Bearer ${await mintToken(as, SECRET)}`);
  return worker.fetch(new Request(`https://sync.test${path}`, { ...init, headers }), env, ctx);
}
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('profile media', () => {
  it('uploads an image and serves it publicly by its content hash', async () => {
    const { env } = testEnv();
    const up = await call(env, '/v1/media', { method: 'POST', body: png(), headers: { 'content-type': 'image/png' } });
    expect(up.status).toBe(200);
    const body = (await up.json()) as { url: string; hash: string; mime: string };
    expect(body.mime).toBe('image/png');
    expect(body.url).toBe(`https://sync.test/v1/media/${body.hash}`);

    // بلا جلسة: <img> وشاشة «من يتابع؟» لا ترسلان هوية
    const got = await call(env, `/v1/media/${body.hash}`, {}, null);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('cache-control')).toContain('immutable');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(png());
  });

  it('the same image twice is one row and one url', async () => {
    const { env, db } = testEnv();
    const a = (await (await call(env, '/v1/media', { method: 'POST', body: png() })).json()) as { url: string };
    const b = (await (await call(env, '/v1/media', { method: 'POST', body: png() })).json()) as { url: string };
    expect(a.url).toBe(b.url);
    expect((db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }).n).toBe(1);
  });

  it('refuses what is not an image, whatever it claims', async () => {
    const { env } = testEnv();
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const res = await call(env, '/v1/media', { method: 'POST', body: html, headers: { 'content-type': 'image/png' } });
    expect(res.status).toBe(415);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect((await call(env, '/v1/media', { method: 'POST', body: svg })).status).toBe(415);
  });

  it('refuses an upload without a session and an oversized one', async () => {
    const { env } = testEnv();
    expect((await call(env, '/v1/media', { method: 'POST', body: png() }, null)).status).toBe(401);
    const big = new Uint8Array(1_600_000);
    big.set(png());
    expect((await call(env, '/v1/media', { method: 'POST', body: big })).status).toBe(413);
  });

  it('a malformed media id is not found, never a path', async () => {
    const { env } = testEnv();
    expect((await call(env, '/v1/media/..%2F..%2Fetc', {}, null)).status).toBe(404);
  });
});

describe('profile stats and top 5', () => {
  it('stats carry the followed works count, not the library itself', async () => {
    const { env, db } = testEnv();
    const insert = db.prepare(
      'INSERT INTO library (user_id, series_ref, series_title, cover_url, source_id, added_at, removed, rev) VALUES (?, ?, NULL, NULL, NULL, 1, ?, 1)',
    );
    insert.run(FRIEND, 'ext:a', 0);
    insert.run(FRIEND, 'ext:b', 0);
    insert.run(FRIEND, 'ext:gone', 1);
    const res = await call(env, `/v1/stats/${FRIEND}`);
    const body = (await res.json()) as { followedWorks: number };
    expect(body.followedWorks).toBe(2);
  });

  it("a friend's top 5 is visible, their favorites are not", async () => {
    const { env, db } = testEnv();
    db.prepare(
      'INSERT INTO collections (user_id, kind, series_ref, member, position, updated_at, rev) VALUES (?, ?, ?, 1, 0, 1, 1)',
    ).run(FRIEND, 'top', 'ext:top-one');
    const top = await call(env, `/v1/collections?kind=top&user=${FRIEND}`);
    expect(top.status).toBe(200);
    const body = (await top.json()) as { content: Array<{ seriesRef: string }> };
    expect(body.content.map((x) => x.seriesRef)).toEqual(['ext:top-one']);
    expect((await call(env, `/v1/collections?kind=favorite&user=${FRIEND}`)).status).toBe(403);
  });
});
