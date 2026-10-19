import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

const SECRET = 'moment-media-secret-that-is-at-least-32-chars';
const ME = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const FRIEND = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const ctx = { waitUntil: () => {} };
function fixture() { return sqliteEnv({ VANTARA_SESSION_SECRET: SECRET }); }
async function call(env: ReturnType<typeof fixture>['env'], path: string, init: RequestInit = {}, as: string | null = ME) {
  const headers = new Headers(init.headers);
  if (as) headers.set('authorization', `Bearer ${await mintToken(as, SECRET)}`);
  return worker.fetch(new Request(`https://sync.test${path}`, { ...init, headers }), env, ctx);
}
// Minimal ISO BMFF boxes, including a real movie duration (the payload is not decoded).
function mp4(length = 1_200_000, duration = 35_000) {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  const type = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(0, 24); type(4, 'ftyp'); type(8, 'isom'); type(16, 'isom'); type(20, 'mp42');
  view.setUint32(24, 44); type(28, 'moov');
  view.setUint32(32, 36); type(36, 'mvhd'); view.setUint32(52, 1000); view.setUint32(56, duration);
  view.setUint32(68, length - 68); type(72, 'mdat');
  for (let i = 76; i < length; i++) bytes[i] = i % 251;
  return bytes;
}
async function upload(env: ReturnType<typeof fixture>['env'], bytes = mp4()) {
  const res = await call(env, '/v1/media', { method: 'POST', body: bytes, headers: { 'content-type': 'video/mp4' } });
  expect(res.status).toBe(200);
  return await res.json() as { hash: string; durationMs: number };
}
let sequence = 0;
async function recommend(env: ReturnType<typeof fixture>['env'], moment: unknown, as = ME) {
  const opId = `moment-${++sequence}`;
  const response = await call(env, '/v1/ops', { method: 'POST', body: JSON.stringify({ ops: [{ opId, kind: 'recommendation.send', payload: { seriesRef: 'anime:1', toId: FRIEND, moment }, at: Date.now() }] }) }, as);
  expect(response.status).toBe(200);
  return opId;
}

describe('MP4 moment media', () => {
  it('stores bounded chunks and streams ranges across chunk boundaries, suffixes, and HEAD', async () => {
    const { env, db } = fixture();
    const bytes = mp4();
    const { hash, durationMs } = await upload(env, bytes);
    expect(durationMs).toBe(35_000);
    expect(db.prepare('SELECT data, duration_ms FROM media WHERE hash = ?').get(hash)).toEqual({ data: '', duration_ms: 35_000 });
    const chunks = db.prepare('SELECT size, length(data) AS encoded FROM media_chunks WHERE hash = ? ORDER BY chunk_index').all(hash) as Array<{size: number; encoded: number}>;
    expect(chunks.length).toBe(3);
    expect(chunks.every(c => c.size <= 524_288 && c.encoded < 700_000)).toBe(true);
    const range = await call(env, `/v1/media/${hash}`, { headers: { range: 'bytes=524280-524300' } }, null);
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe('bytes 524280-524300/1200000');
    expect(range.headers.get('content-length')).toBe('21');
    expect(range.headers.get('access-control-expose-headers')).toContain('Content-Range');
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(bytes.slice(524280, 524301));
    const suffix = await call(env, `/v1/media/${hash}`, { headers: { range: 'bytes=-19' } }, null);
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(bytes.slice(-19));
    const head = await call(env, `/v1/media/${hash}`, { method: 'HEAD' }, null);
    expect(head.status).toBe(200); expect(head.headers.get('content-length')).toBe('1200000'); expect(await head.text()).toBe('');
    const full = await call(env, `/v1/media/${hash}`, {}, null);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
    for (const range of ['bytes=1200000-', 'bytes=5-2', 'bytes=0-1,3-4', 'bytes=-0']) {
      const res = await call(env, `/v1/media/${hash}`, { headers: { range } }, null);
      expect(res.status).toBe(416); expect(res.headers.get('content-range')).toBe('bytes */1200000');
    }
  });
  it('rejects oversized, disguised, malformed, and overlong videos and requires upload auth', async () => {
    const { env } = fixture();
    const post = (body: Uint8Array, type = 'video/mp4', as: string | null = ME) => call(env, '/v1/media', { method: 'POST', body, headers: { 'content-type': type } }, as);
    expect((await post(mp4(), 'video/mp4', null)).status).toBe(401);
    expect((await post(mp4(16 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await post(mp4(100, 70_001))).status).toBe(415);
    expect((await post(new Uint8Array(100))).status).toBe(415);
    const fake = mp4(100); new DataView(fake.buffer).setUint32(0, 0xffffffff);
    expect((await post(fake)).status).toBe(415);
    expect((await post(mp4(), 'image/png')).status).toBe(415);
  });
  it('persists and syncs safe moment metadata only for owned existing video and poster media', async () => {
    const { env, db } = fixture();
    const { hash } = await upload(env);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
    const poster = await (await call(env, '/v1/media', { method: 'POST', body: png })).json() as {hash: string};
    const moment = { version: 1, startMs: 5000, endMs: 40_000, episode: 3, mediaKey: hash, posterKey: poster.hash, durationMs: 35_000, sources: [{ url: 'https://cdn.example/episode.mp4', title: '1080p' }] };
    const id = await recommend(env, moment);
    expect(JSON.parse(String(db.prepare('SELECT moment_json FROM recommendations WHERE id = ?').get(id)?.moment_json))).toEqual(moment);
    const sync = await (await call(env, '/v1/sync?since=0', {}, FRIEND)).json() as { changes: { recommendations: Array<{id: string; moment_json: string}> } };
    expect(sync.changes.recommendations.find(r => r.id === id)?.moment_json).toBe(JSON.stringify(moment));
    for (const invalid of [{ ...moment, endMs: 5000 }, { ...moment, endMs: 80_001 }, { ...moment, mediaKey: 'f'.repeat(64) }, { ...moment, posterKey: hash }, { ...moment, sources: [{ url: 'https://user:secret@example.com/x' }] }]) {
      const bad = await recommend(env, invalid);
      expect(db.prepare('SELECT id FROM recommendations WHERE id = ?').get(bad)).toBeUndefined();
      expect(db.prepare('SELECT id FROM notifications WHERE id LIKE ?').all(`%${bad}%`)).toEqual([]);
    }
    const stolen = await recommend(env, moment, FRIEND);
    expect(db.prepare('SELECT id FROM recommendations WHERE id = ?').get(stolen)).toBeUndefined();
  });
});
