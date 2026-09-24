import { describe, expect, it } from 'vitest';
import { createQueue, entryPages, mergeTiles, OVERLAP, readingRate, tilePlan } from './translate.js';

describe('entry threshold: enter with the least ready that never makes you wait', () => {
  it('translation faster than you read: three pages are enough', () => {
    expect(entryPages({ total: 100, translatePerMin: 12, readPerMin: 8 })).toBe(3);
  });

  it('translation slower than you: k = N(1 − T/R) with a 20% margin, within 10–60%', () => {
    // 100 صفحة، الترجمة 6/د، أنت 8/د: 100 × (1 − 0.75) × 1.2 = 30
    expect(entryPages({ total: 100, translatePerMin: 6, readPerMin: 8 })).toBe(30);
    // بطيء جدًا: لا أكثر من 60%
    expect(entryPages({ total: 100, translatePerMin: 1, readPerMin: 10 })).toBe(60);
    // قريب من سرعتك: لا أقل من 10%
    expect(entryPages({ total: 100, translatePerMin: 7.9, readPerMin: 8 })).toBe(10);
  });

  it('no measurement yet: waits conservatively; tiny chapters never ask for more than they have', () => {
    expect(entryPages({ total: 40, translatePerMin: 0, readPerMin: 8 })).toBe(24);
    expect(entryPages({ total: 2, translatePerMin: 1, readPerMin: 10 })).toBe(2);
    expect(entryPages({ total: 0, translatePerMin: 1, readPerMin: 1 })).toBe(0);
  });

  it('reading speed comes from your own history', () => {
    expect(readingRate([])).toBe(8);
    expect(readingRate([{ pages: 20, ms: 120_000 }, { pages: 10, ms: 60_000 }])).toBe(10);
  });
});

describe('tiling: pages go whole, webtoon strips go in overlapping tiles', () => {
  it('a normal manga page is one tile, scaled to a readable width', () => {
    const plan = tilePlan(1600, 2400);
    expect(plan.tiles).toHaveLength(1);
    expect(plan.width).toBe(1200);
    expect(plan.height).toBe(1800);
  });

  it('a double spread keeps its long edge under the model limit', () => {
    const plan = tilePlan(3000, 2000);
    expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(2400);
    expect(plan.tiles).toHaveLength(1);
  });

  it('a long strip is cut into overlapping tiles that cover it exactly', () => {
    const plan = tilePlan(800, 12_000);
    expect(plan.tiles.length).toBeGreaterThan(5);
    for (const t of plan.tiles) expect(t.h).toBeLessThanOrEqual(2400);
    for (let i = 1; i < plan.tiles.length; i++) expect(plan.tiles[i - 1].y + plan.tiles[i - 1].h - plan.tiles[i].y).toBe(OVERLAP);
    const last = plan.tiles.at(-1);
    expect(last.y + last.h).toBe(plan.height);
  });

  it('merging maps boxes back to the original pixels and keeps a bubble in the overlap once', () => {
    const plan = tilePlan(800, 4000); // عرض 800 بلا تصغير، قطعتان
    expect(plan.scale).toBe(1);
    const second = plan.tiles[1];
    const inOverlapY = second.y + 100; // داخل التداخل: تراها القطعتان
    const results = [
      { regions: [
        { x: 10, y: 50, w: 100, h: 60, arabic: 'أ' },
        { x: 20, y: inOverlapY, w: 100, h: 80, arabic: 'ب' },
        { x: 30, y: 2400 - 20, w: 100, h: 20, arabic: 'مقطوعة' }, // تلمس خط القطع: القطعة التالية تراها كاملة
      ] },
      { regions: [
        { x: 20, y: 100, w: 100, h: 80, arabic: 'ب' },
        { x: 30, y: 2400 - 20 - second.y, w: 100, h: 60, arabic: 'كاملة' },
      ] },
    ];
    const merged = mergeTiles(plan, results);
    expect(merged.map((r) => r.arabic)).toEqual(['أ', 'ب', 'كاملة']);
    expect(merged[1].y).toBe(inOverlapY);
  });
});

describe('queue: current chapter first, then next, then previous; nearest to you first', () => {
  const idle = () => new Promise(() => {});
  it('orders by chapter rank then distance from the page you are on', () => {
    const q = createQueue({ concurrency: 0 });
    q.focus('c11', 10, { c11: 0, c12: 1, c10: 2 });
    for (const [c, i] of [['c12', 0], ['c11', 30], ['c10', 5], ['c11', 11], ['c11', 9], ['c11', 12]]) q.add({ key: `${c}/${i}`, chapterKey: c, index: i, run: idle });
    expect(q.order()).toEqual(['c11/11', 'c11/12', 'c11/9', 'c11/30', 'c12/0', 'c10/5']);
  });

  it('moving ahead re-prioritises instantly: you reached 30, so 30–33 go before 95', () => {
    const q = createQueue({ concurrency: 0 });
    q.focus('c11', 0, { c11: 0 });
    for (const i of [95, 31, 30, 33, 32]) q.add({ key: `p${i}`, chapterKey: 'c11', index: i, run: idle });
    q.focus('c11', 30);
    expect(q.order()).toEqual(['p30', 'p31', 'p32', 'p33', 'p95']);
  });

  it('the same page is queued once', async () => {
    const q = createQueue({ concurrency: 1 });
    let runs = 0;
    const run = async () => { runs += 1; return runs; };
    const [a, b] = await Promise.all([q.add({ key: 'x', chapterKey: 'c', index: 0, run }), q.add({ key: 'x', chapterKey: 'c', index: 0, run })]);
    expect([a, b, runs]).toEqual([1, 1, 1]);
  });
});
