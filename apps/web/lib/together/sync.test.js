import { describe, expect, it } from 'vitest';
import { clockLabel, createClock, createDriftController, memberPosition, SYNC, targetAt } from './sync.js';

/**
 * محاكاة: مشغّل حقيقي متأخر/متقدّم بخطأ ابتدائي، يُقرأ كل 500ms بضجيج قياس،
 * وينفّذ قرارات المتحكّم (سرعة/قفز). نقيس زمن اللحاق وعدد القفزات وهل تذبذبت السرعة.
 */
function simulate({ initialError, seconds = 40, noise = 0, bufferedAhead = 30_000, bufferedBehind = 0, canRate = true, actualLoadMs = 900, seed = 7 }) {
  const ctl = createDriftController();
  let rnd = seed;
  const random = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const timeline = { playing: true, pos: 0, at: 0, rate: 1, seq: 1 };
  let at = 0;
  let pos = initialError;
  let rate = 1;
  let stalledUntil = -1;
  const log = [];
  let seeks = 0;
  let caughtAt = null;
  let flips = 0;
  let lastSign = 0;
  for (; at <= seconds * 1000; at += 500) {
    // المشغّل يتقدّم بسرعته خلال الـ500ms الماضية (إلا إن كان يحمّل بعد قفز)
    if (at > 0) pos += at <= stalledUntil ? 0 : 500 * rate;
    const buffering = at <= stalledUntil;
    const d = ctl.step({ timeline, pos: pos + random() * noise, at, buffering, canRate, bufferedAhead, bufferedBehind });
    rate = d.rate;
    const sign = Math.sign(rate - 1);
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) flips++;
    if (sign !== 0) lastSign = sign;
    if (d.seekTo != null) {
      seeks++;
      const cheap = d.reason === 'seek-buffered';
      pos = d.seekTo;
      if (!cheap) { stalledUntil = at + actualLoadMs; ctl.seeked(actualLoadMs); }
    }
    const trueError = pos - targetAt(timeline, at);
    log.push({ at, trueError, rate });
    if (caughtAt == null && Math.abs(trueError) < SYNC.DEADBAND_MS && !buffering) caughtAt = at;
    if (caughtAt != null && Math.abs(trueError) >= SYNC.DEADBAND_MS * 2 && !buffering) caughtAt = null;
  }
  return { log, seeks, caughtAt, flips, finalError: log.at(-1).trueError, rates: log.map((l) => l.rate) };
}

describe('Together clock', () => {
  it('picks the lowest-RTT sample, so a slow asymmetric reply does not skew the offset', () => {
    let local = 1_000;
    const clock = createClock({ now: () => local });
    // ساعة الخادم متقدمة 5000ms. عينة سريعة (40ms) وأخرى بطيئة غير متماثلة (400ms)
    clock.sample(1_000, 6_020, 1_040);
    clock.sample(2_000, 7_350, 2_400);
    expect(clock.offset).toBe(5_000);
    expect(clock.rtt).toBe(40);
    expect(clock.uncertainty).toBe(20);
    local = 3_000;
    expect(clock.serverNow()).toBe(8_000);
    expect(clock.toLocal(8_000)).toBe(3_000);
  });
});

describe('Together drift controller', () => {
  it('behind 1.4s with the target already buffered: one cheap jump, in sync at once', () => {
    const r = simulate({ initialError: -1_400, noise: 20 });
    expect(r.seeks).toBe(1);
    expect(r.caughtAt).toBeLessThanOrEqual(1_000);
    expect(Math.abs(r.finalError)).toBeLessThan(SYNC.DEADBAND_MS);
  });

  it('ahead 1.0s with nothing buffered behind: proportional rate, no jump, caught in < 20s', () => {
    const r = simulate({ initialError: 1_000, noise: 20, bufferedBehind: 0 });
    expect(r.seeks).toBe(0);
    expect(Math.min(...r.rates)).toBeGreaterThanOrEqual(1 - SYNC.MAX_STEP);
    expect(r.caughtAt).not.toBeNull();
    expect(r.caughtAt).toBeLessThan(20_000);
    expect(r.flips).toBe(0);
    expect(r.rates.at(-1)).toBe(1);
  });

  it('a small steady 80ms drift uses a gentle rate (not the max) and returns to 1×', () => {
    const r = simulate({ initialError: -80, noise: 10, seconds: 20 });
    expect(r.seeks).toBe(0);
    const corrected = r.rates.filter((x) => x !== 1);
    expect(corrected.length).toBeGreaterThan(0);
    expect(Math.max(...corrected)).toBeLessThanOrEqual(1 + 0.04);
    expect(r.rates.at(-1)).toBe(1);
    expect(r.flips).toBe(0);
  });

  it('measurement jitter alone never starts a correction', () => {
    const r = simulate({ initialError: 0, noise: 45, seconds: 60 });
    expect(r.seeks).toBe(0);
    expect(r.rates.every((x) => x === 1)).toBe(true);
  });

  it('one transient spike does not start a correction', () => {
    const ctl = createDriftController();
    const timeline = { playing: true, pos: 0, at: 0, rate: 1, seq: 1 };
    const reads = [0, 0, 300, 0, 0, 0, 900, 0, 0];
    const out = reads.map((e, i) => ctl.step({ timeline, pos: i * 500 + e, at: i * 500 }));
    expect(out.every((d) => d.rate === 1 && d.seekTo == null)).toBe(true);
  });

  it('far behind and not buffered: jumps ahead by the learned load time, then settles', () => {
    const r = simulate({ initialError: -5_000, bufferedAhead: 0, noise: 20, actualLoadMs: 1_200 });
    expect(r.seeks).toBeGreaterThanOrEqual(1);
    expect(r.seeks).toBeLessThanOrEqual(2);
    expect(Math.abs(r.finalError)).toBeLessThan(SYNC.DEADBAND_MS);
  });

  it('no rate control (some live streams): jumps only, at the larger threshold', () => {
    const r = simulate({ initialError: 700, canRate: false, bufferedBehind: 0 });
    expect(r.seeks).toBe(0);
    expect(r.rates.every((x) => x === 1)).toBe(true);
    const far = simulate({ initialError: 1_200, canRate: false, bufferedBehind: 0 });
    expect(far.seeks).toBe(1);
  });

  it('never corrects while buffering', () => {
    const ctl = createDriftController();
    const timeline = { playing: true, pos: 0, at: 0, rate: 1, seq: 1 };
    for (let i = 0; i < 6; i++) {
      const d = ctl.step({ timeline, pos: 0, at: i * 500, buffering: true });
      expect(d).toMatchObject({ rate: 1, seekTo: null, reason: 'buffering' });
    }
  });

  it('a host command is followed at once, even inside the post-jump cooldown', () => {
    const ctl = createDriftController();
    let timeline = { playing: true, pos: 0, at: 0, rate: 1, seq: 1 };
    expect(ctl.step({ timeline, pos: -3_000, at: 0, bufferedAhead: 10_000 }).seekTo).toBeNull();
    const first = ctl.step({ timeline, pos: -3_000 + 500, at: 500, bufferedAhead: 10_000 });
    expect(first.seekTo).not.toBeNull();
    // بعد 500ms (داخل مهلة الثلاث ثوانٍ) المضيف يقدّم إلى الدقيقة 10
    timeline = { playing: true, pos: 600_000, at: 1_000, rate: 1, seq: 2 };
    const d = ctl.step({ timeline, pos: 1_000, at: 1_000, bufferedAhead: 10_000 });
    expect(d.reason).toBe('host-command');
    expect(d.seekTo).toBeGreaterThanOrEqual(600_000);
  });

  it('host pause aligns paused players to the exact frame', () => {
    const ctl = createDriftController();
    const timeline = { playing: false, pos: 90_000, at: 0, rate: 1, seq: 3 };
    expect(ctl.step({ timeline, pos: 90_400, at: 100 })).toMatchObject({ playing: false, seekTo: 90_000 });
    expect(ctl.step({ timeline, pos: 90_050, at: 600 })).toMatchObject({ playing: false, seekTo: null });
  });

  it('measures the error at the moment of the reading, not at message arrival', () => {
    const timeline = { playing: true, pos: 10_000, at: 1_000, rate: 1, seq: 1 };
    // القراءة أُخذت عند لحظة الخادم 3000، فالمطلوب 12000 بغض النظر عن متى وصل الخط الزمني
    expect(targetAt(timeline, 3_000)).toBe(12_000);
    const ctl = createDriftController();
    expect(ctl.step({ timeline, pos: 12_000, at: 3_000 }).error).toBe(0);
    expect(targetAt(timeline, 3_000, 1_500)).toBe(13_500);
  });

  it('reports p50/p95 of the drift', () => {
    const ctl = createDriftController();
    const timeline = { playing: true, pos: 0, at: 0, rate: 1, seq: 1 };
    [10, 20, 30, 40, 200].forEach((e, i) => ctl.step({ timeline, pos: i * 500 + e, at: i * 500 }));
    expect(ctl.stats()).toEqual({ p50: 30, p95: 200 });
  });
});

describe('Together panel helpers', () => {
  it('advances a playing member between reports, freezes a paused one', () => {
    expect(memberPosition({ pos: 60_000, at: 1_000, state: 'playing' }, 4_000)).toBe(63_000);
    expect(memberPosition({ pos: 60_000, at: 1_000, state: 'paused' }, 4_000)).toBe(60_000);
    expect(memberPosition({ pos: null }, 4_000)).toBeNull();
    expect(clockLabel(724_000)).toBe('12:04');
    expect(clockLabel(3_729_000)).toBe('1:02:09');
  });
});
