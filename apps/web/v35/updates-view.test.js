import { describe, expect, it } from 'vitest';
import { agoAr, groupEvents, mergeTimelineEvents, unitLabel, reconcileTimelineRefresh, paintWithScrollAnchor } from './updates-view.js';
import { trustDates } from '../lib/update-engine.js';

/** الخط الزمني: وقت نسبي صادق، ودفعات الفصول بطاقة واحدة بلا خلط أعمال. */
const NOW = new Date(2026, 9, 1, 15, 0).getTime();
const M = 60_000;
const H = 60 * M;

describe('آخر التحديثات', () => {
  it('drops a withdrawn chapter inside a refreshed head while keeping older loaded pages',()=>{
    const visible=[{id:'locked251',at:300},{id:'readable218',at:200},{id:'historic',at:50}];
    const incoming=[{id:'new',at:400,publishedAt:400},{id:'readable218',at:200,publishedAt:200}];
    expect(reconcileTimelineRefresh(visible,incoming,500).map(e=>e.id)).toEqual(['new','readable218','historic']);
    expect(reconcileTimelineRefresh(visible,[],500)).toEqual(visible);
  });
  it('shows only real new publications live; discovery time never promotes historic backfill', () => {
    const ev = (id, publishedAt) => ({ id, work: id, at: publishedAt ?? NOW, publishedAt, firstSeenAt: NOW });
    const original = [ev('yesterday', NOW - 24 * H)];
    const incoming = [ev('five-hours', NOW - 5 * H), ev('new', NOW + 20_000), ev('unknown', null), ...original];
    const live = mergeTimelineEvents(original, incoming, { enteredAt: NOW, now: NOW + 30_000 });
    expect(live.map((e) => e.id)).toEqual(['new', 'yesterday']);
    expect(mergeTimelineEvents(live, incoming, { enteredAt: NOW, now: NOW + 30_000, refresh: true }).map((e) => e.id)).toEqual(['new', 'unknown', 'five-hours', 'yesterday']);
  });
  it('inserts an explicitly verified source advance live while keeping undated first sightings out', () => {
    const base = [{ id: 'old', work: 'old', at: NOW - H, publishedAt: NOW - H }];
    const incoming = [
      { id: 'advance', work: 'advance', at: NOW + 1000, firstSeenAt: NOW + 1000, publishedAt: null, observedAdvance: true },
      { id: 'unknown', work: 'unknown', at: NOW + 2000, firstSeenAt: NOW + 2000, publishedAt: null },
    ];
    expect(mergeTimelineEvents(base, incoming, { enteredAt: NOW, now: NOW + 3000 }).map(e => e.id)).toEqual(['advance', 'old']);
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

describe('آخر التحديثات: الهوية الواحدة', () => {
  it('حدثان لعمل واحد باسمين يصيران بطاقة واحدة بالمفتاح القانوني', async () => {
    const { groupEvents } = await import('./updates-view.js');
    const events = [
      { id: 'a', section: 'manga', work: 'ext:demonic emperor', title: 'Demonic Emperor', kind: 'chapter', number: 920, at: 3 },
      { id: 'b', section: 'manga', work: 'ext:magic emperor', title: 'Magic emperor', kind: 'chapter', number: 919, at: 2 },
      { id: 'c', section: 'manga', work: 'ext:solo leveling', title: 'Solo Leveling', kind: 'chapter', number: 200, at: 1 },
    ];
    const canonical = new Map([['ext:demonic emperor', 'ext:magic emperor'], ['ext:magic emperor', 'ext:magic emperor']]);
    const groups = groupEvents(events, canonical);
    expect(groups.map((g) => g.work)).toEqual(['ext:magic emperor', 'ext:solo leveling']);
    expect(groups[0].high).toBe(920);
    expect(groupEvents(events)).toHaveLength(3);
  });
});

describe("refresh keeps historical pages and the user's place across platforms", () => {
  it('a refresh prepends new events and updates existing entries but does not erase older pagination', () => {
    const base = [
      { id: 'older', work: 'old', at: 100, publishedAt: 100, title: 'old' },
      { id: 'earlier', work: 'early', at: 50, publishedAt: 50, title: 'early' },
    ];
    const refreshed = reconcileTimelineRefresh(base, [
      { id: 'new', work: 'new', at: 200, publishedAt: 200, title: 'new' },
      { id: 'older', work: 'old', at: 100, publishedAt: 100, title: 'updated' },
    ], 500);
    expect(refreshed.map(item => item.id)).toEqual(['new', 'older', 'earlier']);
    expect(refreshed[1].title).toBe('updated');
    expect(base.map(item => item.id)).toEqual(['older', 'earlier']);
    expect(reconcileTimelineRefresh(refreshed, [{ id: 'new', work: 'new', at: 200, publishedAt: 200 }], 500)).toHaveLength(3);
  });

  it('retains the first visible card screen position when new cards are inserted above', () => {
    const moves = [];
    const view = { innerHeight: 750, scrollBy: (x, y) => moves.push([x, y]) };
    const card = (id, top) => ({
      dataset: { eventId: id },
      getBoundingClientRect: () => ({ top, bottom: top + 200 }),
    });
    const list = { ownerDocument: { defaultView: view }, children: [card('top', -250), card('visible', 120), card('below', 800)] };
    paintWithScrollAnchor(list, () => {
      list.children = [card('new', -250), card('top', -100), card('visible', 370), card('below', 1050)];
    });
    expect(moves).toEqual([[0, 250]]);
  });
  it('avoids scrolling when the visible anchor is unchanged', () => {
    const moves = [];
    const view = { innerHeight: 700, scrollBy: (x, y) => moves.push([x, y]) };
    const item = { dataset: { eventId: 'same' }, getBoundingClientRect: () => ({ top: 100, bottom: 200 }) };
    const list = { ownerDocument: { defaultView: view }, children: [item] };
    paintWithScrollAnchor(list, () => {});
    expect(moves).toEqual([]);
  });
});
