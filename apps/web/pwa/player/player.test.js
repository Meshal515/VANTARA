import { describe, expect, it } from 'vitest';
import { bucket, clock, judgePlayback, MIN_REAL_DURATION_S } from './player.js';

describe('the web player only trusts real playback', () => {
  it('rejects a host placeholder clip (sendvid «temporarily unavailable» is 5 seconds)', () => {
    expect(judgePlayback({ duration: 5, videoWidth: 1280 })).toBe('placeholder');
    expect(judgePlayback({ duration: MIN_REAL_DURATION_S - 1, videoWidth: 1280 })).toBe('placeholder');
  });
  it('rejects audio with a black picture (a codec the browser cannot decode)', () => {
    expect(judgePlayback({ duration: 1420, videoWidth: 0 })).toBe('no_picture');
  });
  it('accepts a real episode, and a live stream whose length is unknown', () => {
    expect(judgePlayback({ duration: 1420, videoWidth: 1920 })).toBeNull();
    expect(judgePlayback({ duration: Infinity, videoWidth: 1280 })).toBeNull();
    expect(judgePlayback({ duration: NaN, videoWidth: 1280 })).toBeNull();
  });
});

describe('labels shared with the APK player', () => {
  it('buckets qualities like the APK', () => {
    expect([1080, 1078, 720, 704, 480, 360, null].map(bucket)).toEqual([1080, 1080, 720, 720, 480, 360, null]);
  });
  it('formats time with hours when needed', () => {
    expect(clock(65)).toBe('1:05');
    expect(clock(3725)).toBe('1:02:05');
  });
});

it('preserves actual UHD and QHD quality instead of advertising them as 1080', () => { expect([2160, 1440, 1080].map(bucket)).toEqual([2160, 1440, 1080]); });

describe('next episode warmup matches the APK window', () => {
  it('prepares only in the last four minutes', async () => {
    const { shouldWarmNext } = await import('./player.js');
    expect(shouldWarmNext(1_440_000, 1_000_000)).toBe(false);
    expect(shouldWarmNext(1_440_000, 1_200_000)).toBe(true);
    expect(shouldWarmNext(1_440_000, 1_440_000)).toBe(false);
    expect(shouldWarmNext(0, 10)).toBe(false);
  });
  it('documents every keyboard shortcut it handles', async () => {
    const { SHORTCUTS } = await import('./player.js');
    const keys = SHORTCUTS.map(([k]) => k).join(' ');
    for (const k of ['K', 'L', 'J', 'M', 'F', 'S', 'N', 'C', '0 – 9', 'Esc']) expect(keys).toContain(k);
  });
});
