import { describe, expect, it } from 'vitest';
import { agoAr, groupEvents, mergeTimelineEvents, unitLabel } from './updates-view.js';
import { trustDates } from '../lib/update-engine.js';

/** الخط الزمني: وقت نسبي صادق، ودفعات الفصول بطاقة واحدة بلا خلط أعمال. */
const NOW = new Date(2026, 9, 1, 15, 0).getTime();
const M = 60_000;
const H = 60 * M;

describe('آخر التحديثات', () => {
  it('shows only real new publications live; discovery time never promotes historic backfill', () => {
    const ev = (id, publishedAt) => ({ id, work: id, at: publishedAt ?? NOW, publishedAt, firstSeenAt: NOW });
    const original = [ev('yesterday', NOW - 24 * H)];
    const incoming = [ev('five-hours', NOW - 5 * H), ev('new', NOW + 20_000), ev('unknown', null), ...original];
    const live = mergeTimelineEvents(original, incoming, { enteredAt: NOW, now: NOW + 30_000 });
    expect(live.map((e) => e.id)).toEqual(['new', 'yesterday']);
    expect(mergeTimelineEvents(live, incoming, { enteredAt: NOW, now: NOW + 30_000, refresh: true }).map((e) => e.id)).toEqual(['new', 'unknown', 'five-hours', 'yesterday']);
  });
  it('retains genuine dated batches, but rejects synthetic timestamps over an entire long backlog', () => {
    const batch = [627, 626, 625, 624].map((number) => ({ number, publishedAt: NOW }));
    expect(trustDates(batch)).toEqual(batch);
    const backlog = Array.from({ length: 30 }, (_, i) => ({ number: i + 1, publishedAt: NOW }));
    expect(trustDates(backlog).every((u) => !u.publishedAt)).toBe(true);
  });
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

  it('shows a work once, at its newest release, even when other works came in between', () => {
    const ev = (work, number, at, s = 'x') => ({ section: 'manga', work, kind: 'chapter', number, at, title: work, sources: [{ s }] });
    const groups = groupEvents([ev('ext:a', 403, NOW), ev('ext:a', 402, NOW - M, 'y'), ev('ext:b', 7, NOW - 2 * M), ev('ext:a', 401, NOW - 3 * M)]);
    expect(groups.map((g) => [g.work, unitLabel(g), g.sources.length, g.events.length])).toEqual([
      ['ext:a', 'الفصول 401–403', 2, 3],
      ['ext:b', 'الفصل 7', 1, 1],
    ]);
  });

  it('decodes HTML entities in titles and joins the work they belong to', () => {
    const groups = groupEvents([
      { id: '1', section: 'manga', work: 'ext:don 039 t breathe', kind: 'chapter', number: 12, at: NOW, title: 'Don&#039;t Breathe', sources: [{ s: 'teamx' }] },
      { id: '2', section: 'manga', work: 'ext:don t breathe', kind: 'chapter', number: 12, at: NOW - M, title: "Don't Breathe", sources: [{ s: 'other' }] },
      { id: '3', section: 'manga', work: 'ext:don t breathe', kind: 'chapter', number: 11, at: NOW - 2 * M, title: "Don't Breathe", sources: [] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ work: 'ext:don t breathe', title: "Don't Breathe", high: 12, low: 11 });
    // الفصل 12 من المفتاحين لا يُعدّ مرتين
    expect(groups[0].events).toHaveLength(2);
    expect(groups[0].sources.map((s) => s.s)).toEqual(['teamx', 'other']);
  });

  it('labels units', () => {
    expect(unitLabel({ kind: 'episode', season: 2, high: 5, low: 5, events: [{}] })).toBe('S02E05');
    expect(unitLabel({ kind: 'episode', season: null, high: 8, low: 8, events: [{}] })).toBe('الحلقة 8');
    expect(unitLabel({ kind: 'movie', events: [{}] })).toBe('فيلم');
  });

  it('drops upload dates a source stamps identically on every chapter', () => {
    const same = Array.from({ length: 30 }, (_, i) => ({ number: i + 1, publishedAt: NOW + i }));
    expect(trustDates(same).every((u) => !('publishedAt' in u))).toBe(true);
    const real = [{ number: 3, publishedAt: NOW }, { number: 2, publishedAt: NOW - 7 * 24 * H }, { number: 1, publishedAt: NOW - 14 * 24 * H }];
    expect(trustDates(real)).toEqual(real);
  });
});
