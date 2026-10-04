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
    expect(routeSourceLabel({ sourceId })).toBe('إضافة');
    expect(routeSourceLabel({ sourceId: 'arabseed' })).toBe('ArabSeed');
  });
});
