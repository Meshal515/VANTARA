import { describe, expect, it } from 'vitest';
import { playKey, remainingAr, runtimeAr, seasonsAr } from './cinema.js';

describe('السينما: صياغة الأرقام', () => {
  it('runtime and remaining time read naturally in Arabic', () => {
    expect(runtimeAr('112 min')).toBe('1 س 52 د');
    expect(runtimeAr('45 min')).toBe('45 د');
    expect(runtimeAr('120 min')).toBe('2 س');
    expect(runtimeAr(null)).toBeNull();
    expect(remainingAr(60_000, 35 * 60_000)).toBe('باقي 34 د');
    expect(remainingAr(0, 125 * 60_000)).toBe('باقي 2 س 5 د');
    expect(remainingAr(10, 0)).toBeNull();
  });
  it('season counts and play keys', () => {
    expect([1, 2, 6, 12].map(seasonsAr)).toEqual(['موسم واحد', 'موسمان', '6 مواسم', '12 موسمًا']);
    expect(playKey({ id: 'tt1', type: 'movie' })).toBe('tt1');
    expect(playKey({ id: 'tt2', type: 'series' }, 3)).toBe('tt2:3');
  });
});
describe('server picker source labels', () => {
  it('shows provider names and never the internal addon key', async () => {
    const { routeSourceLabel } = await import('./cinema.js');
    const sourceId = 'addon|https://comet.elfhosted.com|comet.elfhosted.com';
    expect(routeSourceLabel({ sourceId, sourceName: 'Comet | ElfHosted' })).toBe('Comet | ElfHosted');
    // بلا اسم معلن: من مضيف الإضافة (comet.elfhosted.com ← Comet)، لا «إضافة» مبهمة
    expect(routeSourceLabel({ sourceId })).toBe('Comet');
    expect(routeSourceLabel({ sourceId: 'arabseed' })).toBe('ArabSeed');
  });
});

describe('native torrent picker readiness', () => {
  it('allows a native torrent ticket immediately without inventing an HTTP probe', async () => {
    const ui = await import('./cinema.js');
    const torrent = {state:'READY',runtimeReady:true,probed:null};
    expect(ui.routeSelectable(torrent)).toBe(true);
    expect(ui.routePending(torrent)).toBe(false);
    expect(ui.routePending({state:'READY',probed:null})).toBe(true);
    expect(ui.routeSelectable({state:'READY',probed:false})).toBe(false);
    expect(ui.routeSelectable({state:'FAILED',runtimeReady:true})).toBe(false);
    expect(ui.routeSelectable({state:'READY',probed:true})).toBe(true);
  });
});
describe('قائمة IMDb: التقييم في سطر عمله، للكل أو لا لأحد', () => {
  it('كلها مقيَّمة: النجمة أول السطر', async () => {
    const { chartLines } = await import('./cinema.js');
    const lines = chartLines([{ rating: 8.14, year: 2026, genres: ['Drama', 'Crime', 'War'] }, { rating: 7, year: 2025 }], (g) => `«${g}»`);
    expect(lines).toEqual(['★ 8.1 · 2026 · «Drama»، «Crime»', '★ 7.0 · 2025']);
  });
  it('عمل واحد بلا تقييم يُخفيه عن القائمة كلها', async () => {
    const { chartLines } = await import('./cinema.js');
    expect(chartLines([{ rating: 6.9, year: 2026 }, { rating: null, year: 2024, genres: ['Comedy'] }])).toEqual(['2026', '2024 · Comedy']);
    expect(chartLines([])).toEqual([]);
  });
});
describe('بلاطات الأنواع: صورة من أعمال الرئيسية', () => {
  it('أول عمل له خلفية من النوع، ولا يتكرر عمل ما وُجد غيره', async () => {
    const { genreCovers } = await import('./cinema.js');
    const a = { id: 'a', background: 'A', genres: ['Action', 'Drama'] };
    const b = { id: 'b', background: 'B', genres: ['Drama'] };
    const noArt = { id: 'c', background: null, genres: ['Horror'] };
    const covers = genreCovers(['Action', 'Drama', 'Horror', 'Comedy'], [[a], [noArt, b, null]]);
    expect(covers.get('Action')).toBe(a);
    expect(covers.get('Drama')).toBe(b);
    expect(covers.has('Horror')).toBe(false);
    expect(covers.has('Comedy')).toBe(false);
  });
  it('عمل وحيد للنوعين: يتكرر خيرًا من بلاطة بلا صورة', async () => {
    const { genreCovers } = await import('./cinema.js');
    const a = { id: 'a', background: 'A', genres: ['Action', 'Drama'] };
    expect(genreCovers(['Action', 'Drama'], [[a]]).get('Drama')).toBe(a);
  });
});
describe('اكتشف: الفلاتر المتقدمة', () => {
  const m = (id, year, rating, genres) => ({ id, year, rating, genres });
  it('كل التصنيفات المختارة، مدى السنوات، وأقل تقييم', async () => {
    const { applyDiscoverFilters, DISCOVER_DEFAULTS } = await import('./cinema.js');
    const items = [m('a', 2020, 8, ['Crime', 'Drama']), m('b', 2015, 7.5, ['Crime']), m('c', 2021, null, ['Crime', 'Drama']), m('d', '2011–2019', 9, ['Drama', 'Crime'])];
    expect(applyDiscoverFilters(items, DISCOVER_DEFAULTS).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyDiscoverFilters(items, { ...DISCOVER_DEFAULTS, genres: ['Crime', 'Drama'] }).map((x) => x.id)).toEqual(['a', 'c', 'd']);
    expect(applyDiscoverFilters(items, { ...DISCOVER_DEFAULTS, minRating: 7.5 }).map((x) => x.id)).toEqual(['a', 'b', 'd']);
    expect(applyDiscoverFilters(items, { ...DISCOVER_DEFAULTS, yearFrom: 2011, yearTo: 2020 }).map((x) => x.id)).toEqual(['a', 'b', 'd']);
  });
  it('المصادر: الأشهر والأعلى تقييمًا بأول تصنيف، والأحدث سنة بعد سنة نزولًا', async () => {
    const { discoverStreams, DISCOVER_DEFAULTS } = await import('./cinema.js');
    expect(discoverStreams('movie', DISCOVER_DEFAULTS)).toEqual([{ type: 'movie', id: 'top', genre: '' }]);
    expect(discoverStreams('series', { ...DISCOVER_DEFAULTS, sort: 'rating', genres: ['Crime', 'War'] })).toEqual([{ type: 'series', id: 'imdbRating', genre: 'Crime' }]);
    expect(discoverStreams('movie', { ...DISCOVER_DEFAULTS, sort: 'newest', yearFrom: 2023 }, 2026).map((x) => x.genre)).toEqual(['2026', '2025', '2024', '2023']);
    expect(discoverStreams('movie', { ...DISCOVER_DEFAULTS, sort: 'newest', yearFrom: 2020, yearTo: 2021 }, 2026).map((x) => x.id + x.genre)).toEqual(['year2021', 'year2020']);
  });
  it('عدد الفلاتر الفعّالة وسجل البحث (العبارة النهائية، بلا تكرار، ثمانية)', async () => {
    const { activeFilterCount, pushRecentSearch, DISCOVER_DEFAULTS } = await import('./cinema.js');
    expect(activeFilterCount(DISCOVER_DEFAULTS)).toBe(0);
    expect(activeFilterCount({ ...DISCOVER_DEFAULTS, genres: ['A', 'B'], yearTo: 2020, minRating: 7, sort: 'newest' })).toBe(5);
    expect(pushRecentSearch(['Dune', 'batman'], ' Batman ')).toEqual(['Batman', 'Dune']);
    expect(pushRecentSearch(['x'], ' b')).toEqual(['x']);
    expect(pushRecentSearch(Array.from({ length: 8 }, (_, i) => `t${i}`), 'new')).toHaveLength(8);
  });
});
