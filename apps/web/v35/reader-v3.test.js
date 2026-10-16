import { describe, expect, it } from 'vitest';
import { LEAD_PAGES, createStallClock } from './reader-translate.js';
import { createQueue } from '../lib/translate.js';
import { formatReport, readerStall, sizeIndependent } from '../lib/translate-perf.js';

describe('v3 reading lead', () => {
  it('the visible page and the next LEAD_PAGES outrank the rest of the chapter', () => {
    const q = createQueue({ concurrency: 0, lead: LEAD_PAGES });
    for (let i = 0; i < 40; i++) q.add({ key: `c#${i}`, chapterKey: 'c', index: i, run: async () => i });
    q.focus('c', 20, { c: 0 });
    const order = q.order();
    expect(order.slice(0, LEAD_PAGES + 1)).toEqual(Array.from({ length: LEAD_PAGES + 1 }, (_, k) => `c#${20 + k}`));
    // moving on re-prioritises immediately
    q.focus('c', 30, { c: 0 });
    expect(q.order()[0]).toBe('c#30');
    expect(q.order().slice(1, 4)).toEqual(['c#31', 'c#32', 'c#33']);
  });
});

describe('v3 reader stall clock', () => {
  it('measures only time spent on a page that was not ready', () => {
    let t = 0;
    const rec = [];
    const clock = createStallClock({ now: () => t, record: e => rec.push(e) });
    clock.view({ chapterKey: 'c', pageIndex: 0, ready: true });
    t = 1000;
    clock.view({ chapterKey: 'c', pageIndex: 1, ready: false });
    t = 3500;
    clock.settled({ chapterKey: 'c', pageIndex: 1 });
    t = 4000;
    clock.view({ chapterKey: 'c', pageIndex: 2, ready: false });
    t = 4200;
    clock.view({ chapterKey: 'c', pageIndex: 3, ready: true }); // left page 2 before it was ready
    clock.settled({ chapterKey: 'c', pageIndex: 2 }); // late result: not a stall anymore
    expect(rec).toEqual([
      expect.objectContaining({ from: 'stall', pageIndex: 1, stallMs: 2500, outcome: 'ready' }),
      expect.objectContaining({ from: 'stall', pageIndex: 2, stallMs: 200, outcome: 'left' }),
    ]);
    expect(readerStall(rec)).toMatchObject({ views: 2, totalMs: 2700, maxMs: 2500 });
    expect(formatReport(rec)).toContain('انتظار القارئ (المعيار الأول، الهدف صفر): 2.70 ث');
  });
});

describe('v3 page-size independent metrics', () => {
  it('divides chapter wall time and device work by regions and megapixels', () => {
    const fresh = [
      { regions: 100, native: { pagePixels: 1080 * 9000 }, stages: { 'prepare.route': 300, 'prepare.analyze': 9000, render: 6000 } },
      { regions: 0, native: { pagePixels: 1080 * 1000 }, stages: { 'prepare.route': 300 } },
    ];
    const line = sizeIndependent(fresh, [{ wallMs: 30000 }]);
    expect(line).toContain('100 منطقة نص');
    expect(line).toContain('10.8 ميغابكسل');
    expect(line).toContain('زمن الفصل 300.0 ث/1000 منطقة (0.30 ث/فقاعة)');
    expect(line).toContain('عمل الجهاز 0.16 ث/فقاعة');
  });
});
