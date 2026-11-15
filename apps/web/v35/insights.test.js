import { describe, expect, it } from 'vitest';
import { pieGroups, pieSlices, splitShort } from './insights.js';

describe('إحصائيات المتابعة', () => {
  it('خمسة أشخاص كحد أقصى في الدائرة: عشرة = دائرتان، وأربعة = دائرة', () => {
    const p = Array.from({ length: 10 }, (_, i) => ({ uid: String(i), ms: i + 1 }));
    expect(pieGroups(p).map((g) => g.length)).toEqual([5, 5]);
    expect(pieGroups(p.slice(0, 4)).length).toBe(1);
  });
  it('الشرائح تغطي الدائرة بنسبها، والأفاتار بين 22 و34', () => {
    const s = pieSlices([{ uid: 'a', ms: 300 }, { uid: 'b', ms: 100 }]);
    expect(s[0].frac).toBeCloseTo(0.75);
    expect(s[1].start).toBeCloseTo(270);
    for (const x of s) { expect(x.avatar).toBeGreaterThanOrEqual(22); expect(x.avatar).toBeLessThanOrEqual(34); }
    expect(pieSlices([{ uid: 'a', ms: 0 }])[0].frac).toBe(1);
  });
  it('الأقل من عشر دقائق يُطوى تحت «عرض المزيد»', () => {
    const { main, short } = splitShort([{ activeMs: 11 * 60_000 }, { activeMs: 9 * 60_000 }]);
    expect(main).toHaveLength(1);
    expect(short).toHaveLength(1);
  });
});
