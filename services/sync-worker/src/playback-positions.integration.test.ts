import { describe, expect, it } from 'vitest';
import worker from './index.ts';
import { mintToken } from './session.ts';
import { sqliteEnv } from './test-d1.ts';

// ANX1: موضع التوقف داخل الحلقة/الفيلم بين أجهزتك. الأحدث بوقت القياس يفوز (لا الأكبر)، وجدول مستقل عن المانجا.
const SECRET = 'positions-secret-that-is-at-least-32-characters';
const A = '9e4b51d9-4ca0-4da2-9b1f-2205e67134ed';
const B = 'bedcf897-a6f0-4730-b757-402b14891ca5';
const ctx = { waitUntil: () => {} };
let seq = 0;
const testEnv = () => sqliteEnv({
  VANTARA_SESSION_SECRET: SECRET,
  VANTARA_IDENTITY_SECRET: 'identity-secret-for-tests-only-32-chars',
  VANTARA_DEVICE_PEPPER: 'device-pepper-for-tests-only-32-chars-x',
});
type Env = ReturnType<typeof testEnv>['env'];
async function send(env: Env, as: string, kind: string, payload: Record<string, unknown>) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(new Request('https://sync.test/v1/ops', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ops: [{ opId: `op-p-${++seq}`, kind, payload, at: Date.now() }] }),
  }), env, ctx);
  expect(res.status).toBe(200);
  return (await res.json()) as { applied?: string[]; skipped?: string[] };
}
async function pull(env: Env, as: string) {
  const token = await mintToken(as, SECRET);
  const res = await worker.fetch(new Request('https://sync.test/v1/sync?since=0', { headers: { authorization: `Bearer ${token}` } }), env, ctx);
  return (await res.json()) as { features?: string[]; changes: Record<string, Array<Record<string, unknown>>> };
}
const pos = (positionMs: number, at: number, key = 'cinema:tt0000001#s:0#e:1') =>
  ({ mediaKey: key, seriesRef: key.slice(0, key.indexOf('#')), positionMs, durationMs: 12_000_000, at });

describe('playback positions across devices', () => {
  it('the server announces the feature, so clients never send it to an older server', async () => {
    const { env } = testEnv();
    expect((await pull(env, A)).features).toContain('position.set');
  });

  it('the newest measurement wins, even when it is earlier in the episode (rewatch from the start)', async () => {
    const { env } = testEnv();
    const t = Date.now() - 600_000;
    await send(env, A, 'position.set', pos(7_200_000, t));          // جهاز 1: ساعتان
    await send(env, A, 'position.set', pos(120_000, t + 60_000));   // جهاز 2 أعاد من البداية بعدها
    let [row] = (await pull(env, A)).changes.playback_positions ?? [];
    expect(row).toMatchObject({ media_key: 'cinema:tt0000001#s:0#e:1', position_ms: 120_000 });
    // عملية متأخرة من طابور بلا شبكة، أقدم مما حُفظ وأبعد في الحلقة: لا تغلب
    await send(env, A, 'position.set', pos(9_000_000, t + 30_000));
    [row] = (await pull(env, A)).changes.playback_positions ?? [];
    expect(row?.['position_ms']).toBe(120_000);
  });

  it('a time from the future is clamped to the server clock and cannot pin a position forever', async () => {
    const { env } = testEnv();
    await send(env, A, 'position.set', pos(600_000, Date.now() + 10 * 86_400_000));
    await new Promise((r) => setTimeout(r, 5));
    await send(env, A, 'position.set', pos(900_000, Date.now()));
    const [row] = (await pull(env, A)).changes.playback_positions ?? [];
    expect(row?.['position_ms']).toBe(900_000);
  });

  it('stays apart from manga progress and private to its owner; non-video keys are refused', async () => {
    const { env } = testEnv();
    await send(env, A, 'position.set', pos(300_000, Date.now() - 1000, 'anime:21#ep:3'));
    const refused = await send(env, A, 'position.set', { ...pos(300_000, Date.now()), mediaKey: 'ext:lookism#ch:5', seriesRef: 'ext:lookism' });
    expect(refused.applied ?? []).toHaveLength(0);
    const mine = await pull(env, A);
    expect(mine.changes.playback_positions?.map((r) => r['media_key'])).toEqual(['anime:21#ep:3']);
    expect(mine.changes.progress ?? []).toHaveLength(0);
    expect((await pull(env, B)).changes.playback_positions ?? []).toHaveLength(0);
  });
});
