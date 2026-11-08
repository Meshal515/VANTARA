import { describe, expect, it } from 'vitest';
import { dayLineup, heroOrder, passes, readFilter, until } from './unified-view.js';

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 8, 15, 0); // 6 مساءً بتوقيت مكة

describe('الرئيسية الموحدة', () => {
  it('البنر يتناوب أنمي ثم مانجا ثم سينما، ومع الفلتر نوعه وحده', () => {
    const pools = { anime: ['a1', 'a2'], manga: ['m1', 'm2'], cinema: ['c1'] };
    expect(heroOrder(pools, 'all')).toEqual(['a1', 'm1', 'c1', 'a2', 'm2']);
    expect(heroOrder(pools, 'manga')).toEqual(['m1', 'm2']);
  });

  it('الفلتر: السينما تشمل الأفلام والمسلسلات، و«الكل» يشمل الجميع', () => {
    expect(passes('movie', 'cinema')).toBe(true);
    expect(passes('series', 'cinema')).toBe(true);
    expect(passes('anime', 'cinema')).toBe(false);
    expect(passes('manga', 'all')).toBe(true);
  });

  it('جدول اليوم بتوقيت مكة: القادم أولًا بترتيبه، ثم ما نزل الأحدث فالأقدم', () => {
    const week = [NOW - 3 * H, NOW - 1 * H, NOW + 1 * H, NOW + 2 * H, NOW + 8 * H].map((airingAt, i) => ({ id: i, airingAt }));
    expect(dayLineup(week, 0, NOW).map((e) => e.id)).toEqual([2, 3, 1, 0]);
    expect(dayLineup(week, 1, NOW).map((e) => e.id)).toEqual([4]); // بعد منتصف الليل بمكة: الغد
  });

  it('المدة المتبقية بالعربية', () => {
    expect(until(NOW + 18 * 60_000, NOW)).toBe('بعد 18 د');
    expect(until(NOW + 2 * H + 49 * 60_000, NOW)).toBe('بعد 2 س 49 د');
  });

  it('الفلتر المحفوظ يُقرأ، وأي قيمة غريبة تعود «الكل»', () => {
    const s = (v) => ({ getItem: () => v });
    expect(readFilter(s('"anime"'))).toBe('anime');
    expect(readFilter(s('"x"'))).toBe('all');
    expect(readFilter(s('{bad'))).toBe('all');
  });
});
