import { describe, expect, it } from 'vitest';
import { rankFriendsReading } from './friends-reading.js';

const now = Date.UTC(2026, 9, 1, 12);
const hour = 3_600_000;
const read = (user, work, age = 0, extra = {}) => ({ user_id: user, series_ref: `ext:${work}`, series_title: work, chapter_label: 'الفصل 5', viewed_at: now - age, ...extra });
const rank = (rows, at = now) => rankFriendsReading(rows, { me: 'me', friendIds: ['a', 'b', 'c'], now: at });

describe('MANGA Hero: أصدقاؤك يقرؤون', () => {
  it('boosts distinct recent readers, without counting one friend twice', () => {
    const rows = [read('a', 'solo'), read('a', 'solo'), read('b', 'shared', hour), read('c', 'shared', 2 * hour)];
    expect(rank(rows).map((w) => w.ref)).toEqual(['ext:shared', 'ext:solo']);
    expect(rank(rows)[0].readers).toBe(2);
  });
  it('old popularity loses to current reading and expires, rather than occupying Hero forever', () => {
    const rows = [read('a', 'old', 10 * 24 * hour), read('b', 'old', 11 * 24 * hour), read('c', 'current', hour)];
    expect(rank(rows).map((w) => w.ref)).toEqual(['ext:current', 'ext:old']);
    expect(rank(rows, now + 15 * 24 * hour)).toEqual([]);
  });
  it('excludes my reading, strangers, media, removed views and mere work-page visits', () => {
    expect(rank([read('me', 'mine'), read('stranger', 'other'), read('a', 'gone', 0, { removed: 1 }), read('a', 'visited', 0, { chapter_label: null }), read('a', 'anime', 0, { series_ref: 'anime:21' }), read('a', 'internal', 0, { series_ref: '__verify__/x' })])).toEqual([]);
  });
  it('keeps multiple canonical candidates and has no random or trending fallback', () => {
    expect(rank([read('a', 'x'), read('b', 'x'), read('c', 'y', hour)]).map((w) => w.ref)).toEqual(['ext:x', 'ext:y']);
    expect(rank([])).toEqual([]);
  });
});
