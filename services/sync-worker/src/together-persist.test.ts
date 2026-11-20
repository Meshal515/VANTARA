import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersistThrottle, SOFT_PERSIST_MS, softMessage } from './together.ts';

// WT7: 3 ث تمرير عند المضيف في «القراءة معًا» كانت 39 كتابة في تخزين الغرفة
afterEach(() => { vi.useRealTimers(); });

describe('room persistence throttle', () => {
  it('a burst of position updates writes about once per gap, and the last position is never lost', async () => {
    vi.useFakeTimers();
    let writes = 0;
    const t = new PersistThrottle(async () => { writes++; }, () => Date.now());
    // 3 ثوانٍ تمرير، أمر كل 75ms (≈40 أمرًا)
    for (let i = 0; i < 40; i++) { await t.request(true); await vi.advanceTimersByTimeAsync(75); }
    await vi.advanceTimersByTimeAsync(SOFT_PERSIST_MS);
    expect(writes).toBeGreaterThanOrEqual(2);
    expect(writes).toBeLessThanOrEqual(3);
  });
  it('an urgent change (join, host, episode) writes immediately and cancels the pending one', async () => {
    vi.useFakeTimers();
    let writes = 0;
    const t = new PersistThrottle(async () => { writes++; }, () => Date.now());
    await t.request(true);
    await t.request(true);
    expect(writes).toBe(1);
    await t.request(false);
    expect(writes).toBe(2);
    await vi.advanceTimersByTimeAsync(SOFT_PERSIST_MS * 2);
    expect(writes).toBe(2);
  });
  it('only frequent messages are soft', () => {
    expect(softMessage({ t: 'cmd', op: 'seek' })).toBe(true);
    expect(softMessage({ t: 'report' })).toBe(true);
    expect(softMessage({ t: 'ping' })).toBe(true);
    for (const m of [{ t: 'cmd', op: 'load' }, { t: 'cmd', op: 'play' }, { t: 'host' }, { t: 'kick' }, { t: 'mode' }]) expect(softMessage(m)).toBe(false);
  });
});
