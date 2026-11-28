import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// آخر التحديثات المحلي، المرحلة 7: الخيطان الرفيعان
const SECRET = 'latest-threads-secret-at-least-32-characters';
const A = '1e4b51d9-4ca0-4da2-9b1f-2205e67134e1';
const B = '2edcf897-a6f0-4730-b757-402b14891ca2';
const ctx = { waitUntil: () => {} };
const testEnv = () => sqliteEnv({ VANTARA_SESSION_SECRET: SECRET, VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars', VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x' });
type Env = ReturnType<typeof testEnv>['env'];
async function call(env: Env, as: string, path: string, method = 'GET', body?: unknown) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(new Request(`https://sync.test${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, ctx);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
const sig = (n: number, src = 'pkg.ar.src') => ({ eventId: `ext:w|c:${n}`, work: 'ext:w', section: 'manga', kind: 'chapter', season: null, number: n, title: 'عمل', sourceId: src, at: 1000 + n });

describe('نسخة الحساب', () => {
  it('لصاحبها وحده، وتُستعاد كما حُفظت', async () => {
    const { env } = testEnv();
    expect((await call(env, A, '/v1/latest/backup')).body).toEqual({ payload: null, updatedAt: null, next: null });
    const events = [{ id: 'ext:w|c:5', work: 'ext:w', number: 5, at: 5 }];
    expect((await call(env, A, '/v1/latest/backup/events', 'POST', { events })).status).toBe(200);
    expect((await call(env, A, '/v1/latest/backup')).body.payload.events).toEqual(events);
    expect((await call(env, B, '/v1/latest/backup')).body.payload).toBeNull();
  });
  it('جهازان للحساب نفسه: يُدمجان بالمعرّف ولا يمحو أحدهما الآخر، والرفع القديم يُدمج لا يستبدل', async () => {
    const { env } = testEnv();
    await call(env, A, '/v1/latest/backup/events', 'POST', { events: [{ id: 'a1', at: 1 }, { id: 'a2', at: 2 }] });
    await call(env, A, '/v1/latest/backup/events', 'POST', { events: [{ id: 'b1', at: 3 }] });
    // جهاز بإصدار سابق يرفع نسخته كاملة: كانت تستبدل ما سبق
    await call(env, A, '/v1/latest/backup', 'POST', { payload: { v: 1, events: [{ id: 'old1', at: 4 }] } });
    const ids = (await call(env, A, '/v1/latest/backup')).body.payload.events.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual(['a1', 'a2', 'b1', 'old1']);
  });
  it('يرفض الكبير والروابط ولا يكتب شيئًا', async () => {
    const { env } = testEnv();
    expect((await call(env, A, '/v1/latest/backup', 'POST', { payload: { blob: 'x'.repeat(300 * 1024) } })).status).toBe(413);
    expect((await call(env, A, '/v1/latest/backup', 'POST', { payload: { u: 'https://site/secret' } })).status).toBe(400);
    expect((await call(env, A, '/v1/latest/backup')).body.payload).toBeNull();
  });
});

describe('إشارات الأصحاب', () => {
  it('تصل للآخرين لا لمرسلها، بلا هوية المرسل، وبمؤشر يمنع التكرار', async () => {
    const { env } = testEnv();
    expect((await call(env, A, '/v1/latest/signals', 'POST', { signals: [sig(11), sig(11), sig(12, 'other.src')] })).body.accepted).toBe(2);
    const mine = await call(env, A, '/v1/latest/signals');
    expect(mine.body.signals).toEqual([]);
    const theirs = await call(env, B, '/v1/latest/signals');
    expect(theirs.body.signals).toHaveLength(2);
    expect(JSON.stringify(theirs.body)).not.toContain(A);
    expect(theirs.body.signals[0]).toEqual({ eventId: 'ext:w|c:11', work: 'ext:w', section: 'manga', kind: 'chapter', season: null, number: 11, title: 'عمل', sourceId: 'pkg.ar.src', at: 1011 });
    const again = await call(env, B, `/v1/latest/signals?after=${theirs.body.next}`);
    expect(again.body.signals).toEqual([]);
  });
  it('يرفض الناقص والروابط', async () => {
    const { env } = testEnv();
    const r = await call(env, A, '/v1/latest/signals', 'POST', { signals: [{ ...sig(1), work: '' }, { ...sig(2), title: 'https://x.test/y' }, { ...sig(3), section: 'other' }] });
    expect(r.body.accepted).toBe(0);
  });
  it('بلا جلسة: لا شيء', async () => {
    const { env } = testEnv();
    const res = await worker.fetch(new Request('https://sync.test/v1/latest/signals'), env, ctx);
    expect(res.status).toBe(401);
  });
});
