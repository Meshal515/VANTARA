import { describe, expect, it, vi } from 'vitest';
import { animePositionKey, cinemaPositionKey, createPositionSync, MIN_SESSION_MS, overlayAllPositions, POSITION_EVERY_MS } from './watch-position.js';
import { resumeEpisode } from '../v35/anime-episodes.js';

// ANX1: شاهدت ساعتين على جهاز، والجهاز الآخر يعرف الحلقة ويبدأها من أولها
const syncOf = (rows = [], { supports = true } = {}) => ({
  user: { userId: 'u1' }, enqueue: vi.fn(), supports: (f) => supports && f === 'position.set',
  rows: (t, pred) => (t === 'playback_positions' ? rows.filter(pred) : []),
});
const watchFor = (p, key, ms) => { for (let t = 0; t < ms; t += 5_000) p.played(key, 5_000); };

describe('watch position across devices', () => {
  it('sends nothing before 30 s of real playback in the session (opening and closing the player erases nothing)', () => {
    const sync = syncOf();
    const p = createPositionSync(sync, { now: () => 0 });
    const key = animePositionKey(21, 3);
    p.played(key, 600_000); // قفزة: لا تُعد
    expect(p.record('anime:21', key, 600_000, 1_440_000, { final: true })).toBe(false);
    watchFor(p, key, MIN_SESSION_MS - 5_000);
    expect(p.record('anime:21', key, 625_000, 1_440_000, { final: true })).toBe(false);
    expect(sync.enqueue).not.toHaveBeenCalled();
  });

  it('then sends the position with its measurement time, at most every 20 s, and right away on close', () => {
    let t = 1_000;
    const sync = syncOf();
    const p = createPositionSync(sync, { now: () => t });
    const key = animePositionKey(21, 3);
    watchFor(p, key, MIN_SESSION_MS);
    expect(p.record('anime:21', key, 60_000, 1_440_000)).toBe(true);
    t += 5_000;
    expect(p.record('anime:21', key, 65_000, 1_440_000)).toBe(false);
    t += POSITION_EVERY_MS;
    expect(p.record('anime:21', key, 85_000, 1_440_000)).toBe(true);
    t += 1_000;
    expect(p.record('anime:21', key, 86_500, 1_440_000, { final: true })).toBe(true);
    expect(sync.enqueue.mock.calls[0]).toEqual(['position.set', { mediaKey: 'anime:21#ep:3', seriesRef: 'anime:21', positionMs: 60_000, durationMs: 1_440_000, at: 1_000 }]);
    expect(sync.enqueue.mock.calls.every(([kind]) => kind === 'position.set')).toBe(true); // لا جدول المانجا
  });

  it('a restart from the beginning is sent after 30 s, so the start reaches the other devices', () => {
    const sync = syncOf();
    const p = createPositionSync(sync, { now: () => 5 });
    const key = cinemaPositionKey('tt1', 0, 1);
    watchFor(p, key, MIN_SESSION_MS);
    expect(p.record('cinema:tt1', key, 31_000, 7_200_000, { final: true })).toBe(true);
    expect(sync.enqueue.mock.calls[0][1].positionMs).toBe(31_000);
  });

  it('an older server that does not announce the feature gets nothing (the op would be quarantined and lost)', () => {
    const sync = syncOf([], { supports: false });
    const p = createPositionSync(sync);
    const key = animePositionKey(1, 1);
    watchFor(p, key, 60_000);
    expect(p.record('anime:1', key, 60_000, 1_440_000, { final: true })).toBe(false);
    expect(sync.enqueue).not.toHaveBeenCalled();
  });

  it('a device that never played the work resumes from the account minute (The Odyssey case)', () => {
    const sync = syncOf([
      { user_id: 'u1', series_ref: 'cinema:tt0000001', media_key: cinemaPositionKey('tt0000001', 0, 1), position_ms: 7_200_000, duration_ms: 12_000_000, watched_at: 500 },
      { user_id: 'other', series_ref: 'cinema:tt0000001', media_key: cinemaPositionKey('tt0000001', 0, 1), position_ms: 9_000_000, duration_ms: 12_000_000, watched_at: 900 },
    ]);
    const e = overlayAllPositions({}, sync, 'cinema').tt0000001.episodes['0:1'];
    expect(e.position).toBe(7_200_000);
    expect((e.duration - e.position) / 60_000).toBe(80); // «متبقي ساعة وعشرون دقيقة»
  });

  it('the newer measurement wins, not the bigger number: a restart here is not overridden by an older, further position', () => {
    const sync = syncOf([
      { user_id: 'u1', series_ref: 'anime:21', media_key: animePositionKey(21, 3), position_ms: 1_200_000, duration_ms: 1_440_000, watched_at: 100 },
      { user_id: 'u1', series_ref: 'anime:21', media_key: animePositionKey(21, 4), position_ms: 300_000, duration_ms: 1_440_000, watched_at: 300 },
    ]);
    // أعدت الحلقة 3 من بدايتها هنا (at 200) بعد أن وصلت 20 دقيقة على جهاز آخر (at 100)
    const local = { 21: { id: 21, episode: 3, at: 200, episodes: { 3: { position: 40_000, duration: 1_440_000, at: 200, done: false } } } };
    const w = overlayAllPositions(local, sync, 'anime')[21];
    expect(w.episodes[3].position).toBe(40_000);
    expect(w.episodes[4].position).toBe(300_000); // أحدث من جهاز آخر
    expect(resumeEpisode({ m: { episodes: 12 }, watch: w })).toMatchObject({ episode: 4, resume: true });
    expect(local[21].episodes[4]).toBeUndefined(); // التخزين المحلي لم يُمس
  });

  it('without an account or server nothing changes', () => {
    const local = { 21: { id: 21, episodes: {} } };
    expect(overlayAllPositions(local, null, 'anime')).toBe(local);
  });
});
