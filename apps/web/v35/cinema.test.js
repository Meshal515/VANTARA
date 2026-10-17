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
