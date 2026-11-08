import { describe, expect, it, vi } from 'vitest';
import { collectItems, countKinds, dedupeByIds, describeRef, filterItems, loadIdentity, unifiedFeed } from './unified-home.js';

const table = (data) => (name, pick) => (data[name] ?? []).filter(pick);
const U = 'u1';

describe('الرئيسية المشتركة', () => {
  it('القسم والنوع من المرجع: الأنمي أنمي ولو فيلمًا، والسينما فيلم أو مسلسل', () => {
    expect(describeRef('anime:21')).toEqual({ section: 'anime', kind: 'anime', ids: { anilist: '21' } });
    expect(describeRef('cinema:tt1:2').kind).toBe('series');
    expect(describeRef('cinema:tt9', { label: 'فيلم' }).kind).toBe('movie');
    expect(describeRef('cinema:tt9', { cinemaTypes: { tt9: 'series' } }).kind).toBe('series');
    expect(describeRef('al:30013')).toEqual({ section: 'manga', kind: 'manga', ids: { anilist: '30013' } });
    expect(describeRef('ext:one piece').section).toBe('manga');
  });

  it('تجمع المكتبة وآخر المشاهدات للمستخدم وحده، عنصرًا لكل مرجع، الأحدث أولًا، ولا تكتب شيئًا', () => {
    const data = {
      work_views: [
        { user_id: U, series_ref: 'anime:1', series_title: 'A', viewed_at: 30, chapter_label: 'الحلقة 4' },
        { user_id: U, series_ref: 'anime:1', series_title: 'A', viewed_at: 10 },
        { user_id: 'other', series_ref: 'al:5', series_title: 'X', viewed_at: 99 },
        { user_id: U, series_ref: 'cinema:tt2', series_title: 'M', viewed_at: 20, chapter_label: 'فيلم' },
      ],
      library: [{ user_id: U, series_ref: 'al:7', series_title: 'B', added_at: 25 }, { user_id: U, series_ref: 'al:8', removed: true, added_at: 50 }],
    };
    const before = JSON.stringify(data);
    const items = collectItems(table(data), { userId: U });
    expect(items.map((i) => i.ref)).toEqual(['anime:1', 'al:7', 'cinema:tt2']);
    expect(items[0].label).toBe('الحلقة 4');
    expect(items[2].kind).toBe('movie');
    expect(JSON.stringify(data)).toBe(before);
  });

  it('الوسيط: فيلم أنمي في الأنمي والسينما يظهر مرة، ومانجا وأنميها بالاسم نفسه يبقيان منفصلين', () => {
    const items = [
      { ref: 'anime:199', section: 'anime', kind: 'anime', title: 'Spirited Away', ids: { anilist: '199', imdb: 'tt0245429' } },
      { ref: 'cinema:tt0245429', section: 'cinema', kind: 'movie', title: 'Spirited Away', ids: { imdb: 'tt0245429' } },
      { ref: 'al:30013', section: 'manga', kind: 'manga', title: 'One Piece', ids: { anilist: '30013', mal: '13' } },
      { ref: 'anime:21', section: 'anime', kind: 'anime', title: 'One Piece', ids: { anilist: '21', mal: '21' } },
      // MAL يعدّ المانجا والأنمي منفصلين: الرقم نفسه ليس العمل نفسه
      { ref: 'anime:900', section: 'anime', kind: 'anime', title: 'Other', ids: { mal: '13' } },
    ];
    const out = dedupeByIds(items);
    expect(out.map((i) => i.ref)).toEqual(['anime:199', 'al:30013', 'anime:21', 'anime:900']);
    expect(out[0].section).toBe('anime');
    expect(out[0].sources).toEqual([{ section: 'anime', ref: 'anime:199' }, { section: 'cinema', ref: 'cinema:tt0245429' }]);
    // لا دمج بالعنوان وحده
    expect(dedupeByIds([{ ref: 'al:1', section: 'manga', title: 'Same', ids: {} }, { ref: 'anime:2', section: 'anime', title: 'Same', ids: {} }])).toHaveLength(2);
  });

  it('كل العناصر تمر من نقطة واحدة تستدعي unifyFeed حين يتوفر، بمعرّفاتها كاملة', async () => {
    const unifyFeed = vi.fn((list) => list.slice(0, 1).map((i) => ({ ...i, sources: [{ section: 'x', ref: 'y' }] })));
    expect(await loadIdentity(async () => ({ unifyFeed }))).toBe(unifyFeed);
    const items = [{ ref: 'anime:1', section: 'anime', ids: { anilist: '1' } }, { ref: 'cinema:tt1', section: 'cinema', ids: { imdb: 'tt1' } }];
    const out = unifiedFeed(items);
    expect(unifyFeed).toHaveBeenCalledTimes(1);
    expect(unifyFeed.mock.calls[0][0].map((i) => i.ids)).toEqual([{ anilist: '1' }, { imdb: 'tt1' }]);
    expect(out).toHaveLength(1);
    // غياب الملف ليس خطأ
    await expect(loadIdentity(async () => { throw new Error('404'); })).resolves.toBe(unifyFeed);
    // والوسيط حين يُمرَّر صراحة بلا مكتبة
    expect(unifiedFeed(items, null)).toHaveLength(2);
  });

  it('التصفية بالنوع والبحث بالعنوان (عربي بلا تشكيل، ولاتيني بلا حالة)', () => {
    const items = [
      { title: 'ون بيس', kind: 'manga' }, { title: 'Naruto', kind: 'anime' }, { title: 'Dune', kind: 'movie' }, { title: 'Dark', kind: 'series' },
    ];
    expect(filterItems(items, { kind: 'movie' }).map((i) => i.title)).toEqual(['Dune']);
    expect(filterItems(items, { query: 'naru' }).map((i) => i.title)).toEqual(['Naruto']);
    expect(filterItems(items, { query: 'وَن' }).map((i) => i.title)).toEqual(['ون بيس']);
    expect(countKinds(items)).toEqual({ all: 4, manga: 1, anime: 1, movie: 1, series: 1 });
  });
});
