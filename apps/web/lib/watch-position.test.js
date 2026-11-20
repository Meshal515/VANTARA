import { describe, expect, it, vi } from 'vitest';
import { animePositionKey, cinemaPositionKey, createPositionSync, overlayAllPositions, POSITION_EVERY_MS } from './watch-position.js';
import { resumeEpisode } from '../v35/anime-episodes.js';

// ANX1: شاهدت ساعتين على جهاز، والجهاز الآخر يعرف الحلقة ويبدأها من أولها
const syncOf = (rows = []) => ({ user: { userId: 'u1' }, enqueue: vi.fn(), rows: (t, pred) => (t === 'progress' ? rows.filter(pred) : []) });

describe('watch position across devices', () => {
  it('sends seconds while watching, at most every 20 s, and right away on close; with an immediate confirm', () => {
    let t = 0;
    const sync = syncOf();
    const p = createPositionSync(sync, { now: () => t });
    const key = animePositionKey(21, 3);
    expect(p.record('anime:21', key, 3_000, 1_440_000)).toBe(false); // أول ثوانٍ: لا يستحق
    expect(p.record('anime:21', key, 60_000, 1_440_000)).toBe(true);
    t += 5_000;
    expect(p.record('anime:21', key, 65_000, 1_440_000)).toBe(false);
    t += POSITION_EVERY_MS;
    expect(p.record('anime:21', key, 85_000, 1_440_000)).toBe(true);
    t += 1_000;
    expect(p.record('anime:21', key, 86_500, 1_440_000, { final: true })).toBe(true);
    const ops = sync.enqueue.mock.calls;
    expect(ops[0]).toEqual(['progress.set', { chapterKey: 'anime:21#ep:3', seriesRef: 'anime:21', page: 60, ratio: 60_000 / 1_440_000 }]);
    expect(ops[1]).toEqual(['progress.confirm', { chapterKey: 'anime:21#ep:3', page: 60 }]);
    expect(ops.length).toBe(6);
  });

  it('a device that never played the work resumes from the account minute (The Odyssey case)', () => {
    const sync = syncOf([
      { user_id: 'u1', series_ref: 'cinema:tt0000001', chapter_key: cinemaPositionKey('tt0000001', 0, 1), page: 7200, ratio: 7200 / 12000, updated_at: 500 },
      { user_id: 'other', series_ref: 'cinema:tt0000001', chapter_key: cinemaPositionKey('tt0000001', 0, 1), page: 9000, ratio: 0.9, updated_at: 900 },
    ]);
    const all = overlayAllPositions({}, sync, 'cinema');
    const e = all.tt0000001.episodes['0:1'];
    expect(e.position).toBe(7_200_000);
    expect(e.duration).toBe(12_000_000);
    expect((e.duration - e.position) / 60_000).toBe(80); // «متبقي ساعة وعشرون دقيقة»
    expect(all.tt0000001._remoteOnly).toBe(true);
  });

  it('a newer local position wins, and an episode finished here stays finished', () => {
    const sync = syncOf([
      { user_id: 'u1', series_ref: 'anime:21', chapter_key: animePositionKey(21, 3), page: 600, ratio: 0.4, updated_at: 100 },
      { user_id: 'u1', series_ref: 'anime:21', chapter_key: animePositionKey(21, 4), page: 300, ratio: 0.2, updated_at: 300 },
    ]);
    const local = { 21: { id: 21, episode: 3, at: 200, episodes: { 3: { position: 900_000, duration: 1_500_000, at: 200, done: false }, 2: { done: true, at: 50 } } } };
    const w = overlayAllPositions(local, sync, 'anime')[21];
    expect(w.episodes[3].position).toBe(900_000); // المحلي أحدث
    expect(w.episodes[4].position).toBe(300_000); // من جهاز آخر وأحدث
    expect(w.episode).toBe(4);
    const r = resumeEpisode({ m: { episodes: 12 }, watch: w });
    expect(r).toMatchObject({ episode: 4, resume: true });
    expect(local[21].episodes[4]).toBeUndefined(); // التخزين المحلي لم يُمس
  });

  it('without an account or server nothing changes', () => {
    const local = { 21: { id: 21, episodes: {} } };
    expect(overlayAllPositions(local, null, 'anime')).toBe(local);
    expect(createPositionSync({ enqueue: vi.fn() }).record('anime:21', 'k', 60_000, 100_000)).toBe(false);
  });
});
