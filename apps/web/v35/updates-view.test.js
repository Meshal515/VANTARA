import { describe, expect, it } from 'vitest';
import { agoAr, groupEvents, unitLabel } from './updates-view.js';
import { trustDates } from '../lib/update-engine.js';

/** الخط الزمني: وقت نسبي صادق، ودفعات الفصول بطاقة واحدة بلا خلط أعمال. */
const NOW = new Date(2026, 9, 1, 15, 0).getTime();
const M = 60_000;
const H = 60 * M;

describe('آخر التحديثات', () => {
  it('relative time in natural Arabic', () => {
    expect(agoAr(NOW - 20_000, NOW)).toBe('الآن');
    expect(agoAr(NOW - 2 * M, NOW)).toBe('قبل دقيقتين');
    expect(agoAr(NOW - 5 * M, NOW)).toBe('قبل 5 دقائق');
    expect(agoAr(NOW - H, NOW)).toBe('قبل ساعة');
    expect(agoAr(NOW - 2 * H, NOW)).toBe('قبل ساعتين');
    expect(agoAr(NOW - 20 * H, NOW)).toBe('قبل 20 ساعة');
    expect(agoAr(NOW - 30 * H, NOW)).toBe('أمس');
    expect(agoAr(NOW - 3 * 24 * H, NOW)).toBe('قبل 3 أيام');
  });

  it('groups a burst of chapters of the same work, never across another work', () => {
    const ev = (work, number, at, s = 'x') => ({ work, kind: 'chapter', number, at, sources: [{ s }] });
    const groups = groupEvents([ev('ext:a', 403, NOW), ev('ext:a', 402, NOW - M, 'y'), ev('ext:b', 7, NOW - 2 * M), ev('ext:a', 401, NOW - 3 * M)]);
    expect(groups.map((g) => [g.work, unitLabel(g), g.sources.length])).toEqual([
      ['ext:a', 'الفصول 402–403', 2],
      ['ext:b', 'الفصل 7', 1],
      ['ext:a', 'الفصل 401', 1],
    ]);
    expect(unitLabel({ kind: 'episode', season: 2, high: 5, low: 5, events: [{}] })).toBe('S02E05');
    expect(unitLabel({ kind: 'episode', season: null, high: 8, low: 8, events: [{}] })).toBe('الحلقة 8');
    expect(unitLabel({ kind: 'movie', events: [{}] })).toBe('متاح الآن');
  });

  it('drops upload dates a source stamps identically on every chapter', () => {
    const same = [{ number: 3, publishedAt: NOW }, { number: 2, publishedAt: NOW + 5 }, { number: 1, publishedAt: NOW + 9 }];
    expect(trustDates(same).every((u) => !('publishedAt' in u))).toBe(true);
    const real = [{ number: 3, publishedAt: NOW }, { number: 2, publishedAt: NOW - 7 * 24 * H }, { number: 1, publishedAt: NOW - 14 * 24 * H }];
    expect(trustDates(real)).toEqual(real);
  });
});
