import { describe, expect, it } from 'vitest';
import { PERF_LIMIT, clearPerf, formatReport, localRoute, readPerf, recordPerf, stopwatch, summarize } from './translate-perf.js';

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

  it('reports fast, mixed and heavy pages without calling mixed pages fast', () => {
    expect(localRoute({ fastFlatRegions: 3 })).toBe('fast');
    expect(localRoute({ fastFlatRegions: 1, glyphTiles: 2, bubbleTiles: 2 })).toBe('mixed');
    expect(localRoute({ glyphTiles: 2, bubbleTiles: 2 })).toBe('heavy');

    const entries = [
      { at: 1000, pageIndex: 0, from: 'model', textless: false, total: 1000, stages: {}, native: { analyze: { counts: { fastFlatRegions: 2, fastFlatHit: 1 } } } },
      { at: 2000, pageIndex: 1, from: 'model', textless: false, total: 2000, stages: {}, native: { analyze: { counts: { fastFlatRegions: 1, fastFlatHit: 1, heavyRegions: 2, glyphTiles: 1, bubbleTiles: 1, renderBarrierWait: 1 } } } },
      { at: 3000, pageIndex: 2, from: 'model', textless: false, total: 3000, stages: {}, native: { analyze: { counts: { heavyRegions: 2, glyphTiles: 1, bubbleTiles: 1 } } } },
    ];
    const report = formatReport(entries);
    expect(report).toContain('سريع بالكامل 1 صفحة · مختلط 1 صفحة · ثقيل بالكامل 1 صفحة');
    expect(report).toContain('مسار مختلط');
    expect(report).toContain('أولوية العرض: 1 صفحة');
  });

  it('splits textless and text pages, per stage and per chapter, and leaves cached pages out', () => {
    const entries = [
      { at: 1000, chapterKey: 'c1', from: 'model', textless: true, total: 400, stages: { analyze: 380 }, native: { analyze: { stages: { detect: 300 } } } },
      { at: 10000, chapterKey: 'c1', from: 'model', textless: false, total: 9000, stages: { analyze: 5000, luna: 3000 }, native: { render: { stages: { erase: 12, encode: 200 }, counts: { eraseMaskPixels: 100, eraseChangedPixels: 40, fillChangedPixels: 20, reconstructChangedPixels: 10, inpaintMaskPixels: 20, inpaintChangedPixels: 10, eraseRegions: 3, lamaInvocations: 1, eraseE0: 0, eraseE1: 1, eraseE2: 1, eraseE3: 1, outsideMaskChanges: 0 } } } },
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
      { cleanedRegions: 1, perf: { stages: { erase: 12, 'load:lama': 50 }, counts: { eraseMaskPixels: 100, eraseChangedPixels: 45, fillChangedPixels: 25, reconstructChangedPixels: 10, inpaintMaskPixels: 20, inpaintChangedPixels: 10, outsideMaskChanges: 0 } } },
    );
    expect(report).toContain('بلا نص');
    expect(report).toContain('متطابق');
    expect(report).toContain('التبييض الفعلي');
    expect(report).toContain('E2 إعادة بناء 10');
    expect(report).toContain('E3 LaMa 10 (20 بكسل / 20% من القناع)');
    expect(report).toContain('LaMa calls 1');
    expect(report).toContain('erase/ROI 0.00 ث');
    expect(report).toContain('تغيّر خارج القناع 0');
    expect(report).toContain('اختبار التبييض المحلي');
    expect(report).toContain('offline×1');
  });

  it('reports textless route-to-done as a derived latency without adding it to page total', () => {
    const entry = {
      at: 1000, chapterKey: 'c', pageIndex: 0, from: 'model', textless: true,
      total: 420, routeToDoneMs: 330, routeDispatchToDoneMs: 120,
      stages: { wait: 40, 'prepare.hash': 20, 'prepare.cacheRead': 10, 'prepare.route': 350 },
      native: { route: { stages: { queue: 15, detect: 250, missingSweep: 60 } } },
    };
    const s = summarize([entry]);
    expect(s.textless.routeToDoneMedian).toBe(330);
    expect(s.textless.routeDispatchToDoneMedian).toBe(120);
    expect(s.textless.median).toBe(420);
    const report = formatReport([entry]);
    expect(report).toContain('route→done 0.33 ث');
    expect(report).toContain('dispatch→done 0.12 ث');
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

describe('whole chapter acceptance', () => {
  const run = (overrides = {}) => ({
    startedAt: 1000, endedAt: 91000, expectedPages: 100,
    device: { model: 'Galaxy S23 Ultra', physical: true },
    environment: { evidence: 'device', models: 'warm', translationCache: 'fresh', images: 'network', runId: 'measured-run-1', buildSha: 'b'.repeat(40) },
    pageResults: Array.from({ length: 100 }, (_, pageIndex) => ({ pageIndex, hash: pageIndex.toString(16).padStart(64,'0'), outputHash: (pageIndex+100).toString(16).padStart(64,'0'), accepted: true, saved: true, from: 'model', at: 2000 + pageIndex * 890, stages: { luna: 1000 } })),
    quality: { evidence: 'annotated-corpus', runId: 'measured-run-1', buildSha: 'b'.repeat(40), pages: Array.from({ length: 100 }, (_, pageIndex) => ({ pageIndex, hash: pageIndex.toString(16).padStart(64,'0'), outputHash: (pageIndex+100).toString(16).padStart(64,'0') })), detectionRecall: .99, untranslatedEnglishRate: 0, mixedArabicEnglish: 0, noOpWhitening: 0, outsideMaskCorruptions: 0 },
    ...overrides,
  });
  it('measures the complete saved set from request to last save, not overlapping work sum', async () => {
    const { chapterBenchmark } = await import('./translate-perf.js');
    const result = chapterBenchmark(run());
    expect(result).toMatchObject({ completed: 100, failed: 0, wallMs: 90000, target: 'met', stages: { luna: { p50: 1000, p95: 1000 } } });
    expect(chapterBenchmark(run({ pageResults: run().pageResults.reverse() }))).toEqual(result);
  });
  it('does not accept failed, duplicate, out of range or unsaved pages', async () => {
    const { chapterBenchmark } = await import('./translate-perf.js');
    const pages = run().pageResults;
    pages[99] = { ...pages[99], accepted: false, error: 'offline' };
    expect(chapterBenchmark(run({ pageResults: pages }))).toMatchObject({ completed: 99, failed: 1, target: 'incomplete' });
    expect(chapterBenchmark(run({ pageResults: [...pages.slice(0, 99), pages[0], { ...pages[99], pageIndex: 100 }] }))).toMatchObject({ completed: 99, target: 'incomplete' });
    expect(chapterBenchmark(run({ pageResults: pages.map(p => ({ ...p, saved: false })) })).completed).toBe(0);
  });
  it('keeps simulation, cache and absent device evidence out of speed claims', async () => {
    const { chapterBenchmark } = await import('./translate-perf.js');
    expect(chapterBenchmark(run({ device: null })).target).toBe('UNVERIFIED');
    expect(chapterBenchmark(run({ environment: { evidence: 'simulation' } })).target).toBe('UNVERIFIED');
    expect(chapterBenchmark(run({ pageResults: run().pageResults.map(p => ({ ...p, from: 'cache' })) })).target).toBe('cache-only');
    expect(chapterBenchmark(run({ endedAt: 150000 })).target).toBe('not-met');
    expect(chapterBenchmark(run({ endedAt: 90000, pageResults: run().pageResults.map(p => ({ ...p, at: 200000 })) })).target).toBe('UNVERIFIED');
  });
  it('never labels fast output as met without matching complete quality evidence', async () => {
    const { chapterBenchmark } = await import('./translate-perf.js');
    expect(chapterBenchmark(run({ quality: undefined })).target).toBe('UNVERIFIED');
    expect(chapterBenchmark(run({ quality: { ...run().quality, pages: [] } })).target).toBe('UNVERIFIED');
    expect(chapterBenchmark(run({ quality: { ...run().quality, detectionRecall: .70, mixedArabicEnglish: 8, outsideMaskCorruptions: 5 } })).target).toBe('quality-failed');
  });
  it('applies explicit light, mixed and heavy budgets without silently changing the 100s default', async () => {
    const { chapterBenchmark } = await import('./translate-perf.js');
    expect(chapterBenchmark(run({ profile: 'mixed', endedAt: 111000 })).target).toBe('met');
    expect(chapterBenchmark(run({ profile: 'light' })).target).toBe('not-met');
    expect(chapterBenchmark(run({ profile: 'heavy', endedAt: 301001 })).target).toBe('not-met');
    expect(chapterBenchmark(run({ profile: 'invalid' })).target).toBe('UNVERIFIED');
  });
  it('rejects absent provenance, invalid hashes and quality from a different output/build/run', async () => {
    const {chapterBenchmark}=await import('./translate-perf.js');
    expect(chapterBenchmark(run({pageResults:run().pageResults.map(p=>({...p,from:undefined}))})).target).toBe('UNVERIFIED');
    expect(chapterBenchmark(run({pageResults:run().pageResults.map(p=>({...p,hash:'not-a-hash'}))})).target).toBe('incomplete');
    for(const patch of [{buildSha:'c'.repeat(40)},{runId:'other'},{pages:[null]}])
      expect(chapterBenchmark(run({quality:{...run().quality,...patch}})).target).toBe('UNVERIFIED');
    expect(chapterBenchmark(run({quality:{...run().quality,pages:run().quality.pages.map(p=>({...p,outputHash:'d'.repeat(64)}))}})).target).toBe('UNVERIFIED');
    expect(chapterBenchmark(run({profile:'constructor'})).target).toBe('UNVERIFIED');
  });
});

it('uses the independent 100-second target without counting a 110-second chapter as met',async()=> {
 const {chapterBenchmark}=await import('./translate-perf.js');
 const results=Array.from({length:100},(_,pageIndex)=>({pageIndex,hash:pageIndex.toString(16).padStart(64,'0'),accepted:true,saved:true,from:'model',at:110000}));
 expect(chapterBenchmark({startedAt:0,endedAt:110000,expectedPages:100,pageResults:results,device:{physical:true,model:'S23 Ultra'},environment:{evidence:'device',models:'warm',translationCache:'fresh',images:'local'}}).target).toBe('not-met');
});
it('reports detector work and each independent lane without calling one gate CPU utilization',()=> {
 const entry={at:1000,from:'model',textless:false,total:1000,pageIndex:0,stages:{prepare:750},native:{route:{stages:{detect:700,queue:50}},analyze:{stages:{fastFlat:40},counts:{fastFlatRegions:1}},render:{stages:{erase:20},laneBusy:{detect:40,analyze:60,render:20}}}};
 expect(summarize([entry]).text.stages['route.detect']).toBe(700);
 const report=formatReport([entry]);
 expect(report).toContain('RT-DETR 0.70 ث');
 expect(report).toContain('كشف 40% · تحليل 60% · رسم 20%');


});


it('reports only the latest run, dedupes retries, and never calls partial pages successful', () => {
  const entries = [
    { at: 1000, runId: 'old-run', chapterKey: 'c', pageIndex: 0, from: 'model', incomplete: false, textless: false, total: 100, stages: {} },
    { at: 5000, runId: 'new-run', chapterKey: 'c', pageIndex: 0, from: 'model', incomplete: true, textless: false, total: 500, stages: {} },
    { at: 6000, runId: 'new-run', chapterKey: 'c', pageIndex: 0, from: 'model', incomplete: false, textless: false, total: 100, stages: {} },
    { at: 7000, runId: 'new-run', chapterKey: 'c', pageIndex: 1, from: 'model', incomplete: true, textless: false, total: 200, stages: {} },
    { at: 7100, runId: 'new-run', chapterKey: 'c', pageIndex: 1, from: 'repair', accepted: true, incomplete: false, textless: false, total: 80, stages: {} },
    { at: 7200, runId: 'new-run', chapterKey: 'c', pageIndex: 9, from: 'error', error: 'timeout', total: 20, stages: {} },
    { at: 7250, runId: 'new-run', chapterKey: 'c', pageIndex: 9, from: 'error', error: 'timeout', total: 20, stages: {} },
  ];
  const s = summarize(entries);
  expect(s).toMatchObject({ pages: 2, complete: 2, partial: 0, errors: 1, repairs: 1 });
  expect(s.chapters).toEqual([{ chapterKey: 'c', pages: 2, wallMs: 1200, workMs: 180 }]);
  const report = formatReport(entries);
  expect(report).toContain('2 مكتملة');
  expect(report).toContain('0 جزئية');
  expect(report).not.toContain('2 صفحة جديدة ناجحة');
});
