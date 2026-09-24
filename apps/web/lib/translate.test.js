import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_EDGE, MAX_UPLOAD_WIDTH, createQueue, entryPages, readingRate, resultOf, unansweredIds, uploadPlan } from './translate.js';

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

describe('upload: the whole page goes to the worker, only shrunk when it is wider than useful', () => {
  it('a normal manga page is sent as is', () => {
    expect(uploadPlan(1080, 2316)).toEqual({ scale: 1, width: 1080, height: 2316 });
  });

  it('a very wide scan is narrowed to the detection width, keeping its ratio', () => {
    const plan = uploadPlan(3200, 4800);
    expect(plan.width).toBe(MAX_UPLOAD_WIDTH);
    expect(plan.height).toBe(2400);
    expect(plan.scale).toBeCloseTo(0.5);
  });

  it('a long webtoon strip keeps its width; only its longest edge is capped', () => {
    const strip = uploadPlan(800, 12_000);
    expect(strip.height).toBe(MAX_UPLOAD_EDGE);
    expect(strip.width).toBe(Math.round((800 * MAX_UPLOAD_EDGE) / 12_000));
    expect(uploadPlan(800, 3000)).toEqual({ scale: 1, width: 800, height: 3000 });
  });

  it('never produces a zero-sized upload', () => {
    expect(uploadPlan(0, 0)).toEqual({ scale: 1, width: 1, height: 1 });
  });
});

describe('worker reply → what the reader keeps', () => {
  it('a translated page carries its image; the original stays when nothing was translated', () => {
    const body = { translated: 2, image: 'data:image/webp;base64,AAAA', regions: [{ id: 'r1' }, { id: 'r2' }], engine: 'gpt-6-luna:t1', cached: true };
    expect(resultOf(body)).toEqual({ image: 'data:image/webp;base64,AAAA', regions: body.regions, translated: 2, engine: 'gpt-6-luna:t1', cached: true, error: null });
    // مؤثرات فقط: صورة الأصل تُعرض، ولا نحفظ صورة بلا فائدة
    expect(resultOf({ translated: 0, image: 'data:...', regions: [] }).image).toBeNull();
  });

  it('carries Luna errors (weekly limit, no credit) so the reader can explain them', () => {
    expect(resultOf({ translated: 0, error: 'weekly_limit', regions: [] })).toMatchObject({ error: 'weekly_limit', translated: 0, image: null });
    expect(resultOf(null)).toEqual({ image: null, regions: [], translated: 0, engine: null, cached: false, error: null });
  });
});

describe('queue: current chapter first, then next, then previous; nearest to you first', () => {
  const job = (chapterKey, index) => ({ key: `${chapterKey}#${index}`, chapterKey, index, run: () => new Promise(() => {}) });
  it('orders by chapter rank then distance from the page you are on', () => {
    const q = createQueue({ concurrency: 0 });
    for (const i of [0, 5, 10]) q.add(job('c2', i));
    for (const i of [0, 12, 30, 95]) q.add(job('c1', i));
    q.focus('c1', 30, { c1: 0, c2: 1 });
    expect(q.order()).toEqual(['c1#30', 'c1#12', 'c1#95', 'c1#0', 'c2#0', 'c2#5', 'c2#10']);
  });

  it('moving ahead re-prioritises instantly: you reached 30, so 30–33 go before 95', () => {
    const q = createQueue({ concurrency: 0 });
    for (const i of [95, 30, 31, 33]) q.add(job('c1', i));
    q.focus('c1', 0, { c1: 0 });
    expect(q.order()[0]).toBe('c1#30');
    q.focus('c1', 33, { c1: 0 });
    expect(q.order()).toEqual(['c1#33', 'c1#31', 'c1#30', 'c1#95']);
  });

  it('the same page is queued once', async () => {
    const q = createQueue({ concurrency: 1 });
    let runs = 0;
    const run = async () => {
      runs += 1;
      return 'ok';
    };
    const a = q.add({ key: 'c1#1', chapterKey: 'c1', index: 1, run });
    const b = q.add({ key: 'c1#1', chapterKey: 'c1', index: 1, run });
    expect(a).toBe(b);
    expect(await a).toBe('ok');
    expect(runs).toBe(1);
  });
});

describe('a bubble Luna left out is known, so the page is retried', () => {
  it('flags readable bubbles with no Arabic, but not sfx, signs or credits', () => {
    const readable = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    const reply = {
      regions: [
        { id: 'a', kind: 'speech', arabic: 'نعم' },
        { id: 'b', kind: 'speech', arabic: null },
        { id: 'c', kind: 'sfx', arabic: null },
        { id: 'd', kind: 'sign', arabic: null },
      ],
    };
    expect(unansweredIds(readable, reply)).toEqual(['b', 'e']);
    expect(unansweredIds(readable, null)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
