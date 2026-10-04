import { describe, expect, it } from 'vitest';
import { PERF_LIMIT, clearPerf, formatReport, readPerf, recordPerf, stopwatch, summarize } from './translate-perf.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};

describe('translation performance log (on the phone)', () => {
  it('keeps the last pages only', () => {
    const storage = memory();
    for (let i = 0; i < PERF_LIMIT + 5; i++) recordPerf({ at: i, total: 1 }, storage);
    const list = readPerf(storage);
    expect(list).toHaveLength(PERF_LIMIT);
    expect(list[0].at).toBe(5);
    clearPerf(storage);
    expect(readPerf(storage)).toEqual([]);
  });

  it('times each stage', async () => {
    let t = 0;
    const clock = stopwatch(() => t);
    t = 5;
    clock.lap('hash');
    await clock.time('luna', async () => {
      await null;
      t = 105;
    });
    expect(clock.stages).toEqual({ hash: 5, luna: 100 });
    expect(clock.total()).toBe(105);
  });

  it('splits textless and text pages, per stage and per chapter, and leaves cached pages out', () => {
    const entries = [
      { at: 1000, chapterKey: 'c1', from: 'model', textless: true, total: 400, stages: { analyze: 380 }, native: { analyze: { stages: { detect: 300 } } } },
      { at: 10000, chapterKey: 'c1', from: 'model', textless: false, total: 9000, stages: { analyze: 5000, luna: 3000 }, native: { render: { stages: { encode: 200 }, counts: { eraseMaskPixels: 100, eraseChangedPixels: 40, fillChangedPixels: 30, inpaintChangedPixels: 10 } } } },
      { at: 11000, chapterKey: 'c1', from: 'cache', total: 5 },
      { at: 12000, chapterKey: 'c1', from: 'error', error: 'offline', total: 60000, stages: { analyze: 1000, cacheProbe: 59000 } },
      { at: 13000, chapterKey: 'c1', from: 'repair', error: 'busy', total: 45000, stages: { luna: 45000 } },
    ];
    const s = summarize(entries);
    expect(s).toMatchObject({ pages: 2, cached: 1, errors: 1, repairs: 1, repairErrors: 1 });
    expect(s.errorCodes).toEqual({ offline: 1, busy: 1 });
    expect(s.textless).toMatchObject({ pages: 1, median: 400, stages: { analyze: 380, 'analyze.detect': 300 } });
    expect(s.text.stages).toMatchObject({ luna: 3000, 'render.encode': 200 });
    expect(s.chapters[0]).toMatchObject({ chapterKey: 'c1', pages: 2, wallMs: 10000 - (1000 - 400) });

    const even = summarize([
      { at: 1000, from: 'model', textless: false, total: 1000, stages: {} },
      { at: 3000, from: 'model', textless: false, total: 3000, stages: {} },
    ]);
    expect(even.text.median).toBe(2000);
    const report = formatReport(
      entries,
      [{ page: 'p1', identical: true, legacy: { stages: { glyphs: 2000 } }, current: { stages: { glyphs: 1000 } } }],
      null,
      { cleanedRegions: 1, perf: { stages: { erase: 12, 'load:lama': 50 }, counts: { eraseMaskPixels: 100, eraseChangedPixels: 45, fillChangedPixels: 35, inpaintChangedPixels: 10 } } },
    );
    expect(report).toContain('بلا نص');
    expect(report).toContain('متطابق');
    expect(report).toContain('التبييض الفعلي');
    expect(report).toContain('اختبار التبييض المحلي');
    expect(report).toContain('offline×1');
  });
});

describe('engine settings measured on the phone', () => {
  it('lists each setting with its times and whether the output matches the current one', async () => {
    const { engineLines, formatReport } = await import('./translate-perf.js');
    const run = {
      cores: 8,
      thermal: 0,
      engines: [
        { name: 'current', loadMs: 900, glyphsMs: 9700, bubblesMs: 7800, glyphDiff: 0, glyphPixels: 5000, bubblesSame: true, bubbles: 3 },
        { name: 'split', loadMs: 800, glyphsMs: 6100, bubblesMs: 5200, glyphDiff: 0, glyphPixels: 5000, bubblesSame: true, bubbles: 3 },
        { name: 'cpu-4', loadMs: 700, glyphsMs: 12000, bubblesMs: 9000, glyphDiff: 14, glyphPixels: 5010, bubblesSame: false, bubbles: 3 },
      ],
    };
    const lines = engineLines(run);
    expect(lines[0]).toContain('8 أنوية');
    expect(lines[2]).toContain('split');
    expect(lines[2]).toContain('مطابق');
    expect(lines[3]).toContain('مختلف: 14 بكسل');
    expect(lines[3]).toContain('فقاعات مختلفة');
    expect(formatReport([], [], run)).toContain('إعدادات CTD والفقاعات');
    expect(engineLines(null)).toEqual([]);
  });
});
