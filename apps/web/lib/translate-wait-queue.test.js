import { describe, expect, it } from 'vitest';
import { createQueue } from './translate.js';
import { formatReport, summarize } from './translate-perf.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

describe('wait/queue admission invariants', () => {
  it('does not let a blocked near-forward quota head-of-line block free prepare slots', async () => {
    const q = createQueue({ concurrency: 4, prepareConcurrency: 4, maxPrepared: 8, bypassConcurrency: 0 });
    const holds = Array.from({ length: 6 }, () => deferred());
    const started = [];
    const runs = [];

    for (let index = 0; index < 6; index += 1) {
      runs.push(q.add({
        key: `c#${index}`,
        chapterKey: 'c',
        index,
        prepare: async () => {
          started.push(index);
          await holds[index].promise;
          return { index };
        },
        run: async () => index,
      }));
    }
    q.focus('c', 0, { c: 0 });

    await tick();
    await tick();

    // 0 + one near-forward slot are admitted first. Pages 2/3 are temporarily
    // quota-blocked, but that must not waste the remaining global prepare slots:
    // farther work can route/hash/cache while preserving the near quota.
    expect(started).toEqual([0, 1, 4, 5]);

    for (const hold of holds) hold.resolve();
    await Promise.all(runs);
  });

  it('reports outer admission wait separately from prepared-to-run wait', async () => {
    const q = createQueue({ concurrency: 1, prepareConcurrency: 1, maxPrepared: 2, bypassConcurrency: 0 });
    const firstRun = deferred();
    let secondContext = null;

    const first = q.add({
      key: 'c#0',
      chapterKey: 'c',
      index: 0,
      prepare: async () => ({ ok: true }),
      run: async () => firstRun.promise,
    });
    const second = q.add({
      key: 'c#1',
      chapterKey: 'c',
      index: 1,
      prepare: async () => ({ ok: true }),
      run: async context => {
        secondContext = context;
        return 1;
      },
    });

    q.focus('c', 0, { c: 0 });
    await tick();
    await tick();
    firstRun.resolve();
    await Promise.all([first, second]);

    expect(secondContext).toEqual(expect.objectContaining({
      waitedMs: expect.any(Number),
      admissionWaitMs: expect.any(Number),
      preparedWaitMs: expect.any(Number),
    }));
    expect(secondContext.waitedMs).toBeGreaterThanOrEqual(
      secondContext.admissionWaitMs + secondContext.preparedWaitMs - 2,
    );
  });

  it('keeps analyzed run+prepared pages within Android snapshot handoff capacity', async () => {
    const reader = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../v35/reader-translate.js', import.meta.url), 'utf8'));
    const plugin = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../../../android/app/src/main/kotlin/com/vantara/plugins/translation/TranslationPlugin.kt', import.meta.url), 'utf8'));

    const q = /createQueue\(\{[^}]*maxInFlight:\s*(\d+)[^}]*\}\)/.exec(reader);
    const nativeCap = /snapshots\s*=\s*AnalysisHandoff<Pipeline\.Analysis>\((\d+)\)/.exec(plugin);

    expect(q).not.toBeNull();
    expect(nativeCap).not.toBeNull();
    expect(Number(q[1])).toBeLessThanOrEqual(Number(nativeCap[1]));
  });

  it('prints outer wait phases without adding them to page totals a second time', () => {
    const entry = {
      at: 1_000,
      runId: 'wait-telemetry',
      via: 'reader',
      chapterKey: 'c',
      pageIndex: 0,
      hash: 'a'.repeat(64),
      from: 'model',
      translated: 1,
      incomplete: false,
      textless: false,
      total: 100,
      stages: { wait: 90, luna: 10 },
      queueWait: { admission: 70, prepared: 20 },
    };
    expect(summarize([entry]).text.median).toBe(100);
    const report = formatReport([entry]);
    expect(report).toContain('تفصيل wait (لا يُجمع مرة ثانية): admission 0.07 ث · prepared→run 0.02 ث');
  });
});
