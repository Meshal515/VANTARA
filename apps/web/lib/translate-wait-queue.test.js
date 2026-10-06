import { describe, expect, it } from 'vitest';
import { createQueue } from './translate.js';
import { formatReport, summarize } from './translate-perf.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

describe('wait/queue integration invariants', () => {
  it('lets Route stay ahead while the hard bound blocks additional Heavy snapshots', async () => {
    const q = createQueue({
      concurrency:1,
      prepareConcurrency:2,
      maxPrepared:4,
      bypassConcurrency:0,
      continueConcurrency:1,
      maxRouteAhead:4,
      maxInFlight:1,
    });
    const firstRun = deferred();
    const routed = [];
    const heavy = [];

    const work = [0,1].map(index => q.add({
      key:`c#${index}`,
      chapterKey:'c',
      index,
      prepare:async()=> {
        routed.push(index);
        return {
          continuePrepare: async()=> {
            heavy.push(index);
            return { analysis:{page:index}, bypass:false };
          },
        };
      },
      run:async()=> index === 0 ? firstRun.promise : index,
    }));
    q.focus('c',0,{c:0});

    await tick(); await tick(); await tick();
    expect(routed).toEqual(expect.arrayContaining([0,1]));
    expect(heavy).toEqual([0]);

    firstRun.resolve(0);
    await expect(Promise.all(work)).resolves.toEqual([0,1]);
    expect(heavy).toEqual([0,1]);
  });

  it('reports admission, Route-to-Analyze and prepared wait without inflating canonical wait', async () => {
    const q = createQueue({
      concurrency:1,
      prepareConcurrency:1,
      maxPrepared:2,
      bypassConcurrency:0,
      continueConcurrency:1,
    });
    const firstRun = deferred();
    let secondContext = null;

    const first=q.add({
      key:'c#0',chapterKey:'c',index:0,
      prepare:async()=>({continuePrepare:async()=>({analysis:{},bypass:false})}),
      run:async()=>firstRun.promise,
    });
    const second=q.add({
      key:'c#1',chapterKey:'c',index:1,
      prepare:async()=>({continuePrepare:async()=>({analysis:{},bypass:false})}),
      run:async context=>{secondContext=context;return 1;},
    });
    q.focus('c',0,{c:0});

    await tick(); await tick(); await tick();
    firstRun.resolve(0);
    await Promise.all([first,second]);

    expect(secondContext).toEqual(expect.objectContaining({
      waitedMs:expect.any(Number),
      admissionWaitMs:expect.any(Number),
      continuationWaitMs:expect.any(Number),
      preparedWaitMs:expect.any(Number),
    }));
    const diagnostic =
      secondContext.admissionWaitMs +
      secondContext.continuationWaitMs +
      secondContext.preparedWaitMs;
    expect(Math.abs(secondContext.waitedMs-diagnostic)).toBeLessThanOrEqual(2);
  });

  it('keeps the reader hard bound at or below Android snapshot handoff capacity', async () => {
    const reader = await import('node:fs').then(({readFileSync}) =>
      readFileSync(new URL('../v35/reader-translate.js',import.meta.url),'utf8'));
    const plugin = await import('node:fs').then(({readFileSync}) =>
      readFileSync(new URL('../../../android/app/src/main/kotlin/com/vantara/plugins/translation/TranslationPlugin.kt',import.meta.url),'utf8'));

    const q=/createQueue\(\{[^}]*maxInFlight:\s*(\d+)[^}]*\}\)/.exec(reader);
    const nativeCap=/snapshots\s*=\s*AnalysisHandoff<Pipeline\.Analysis>\((\d+)\)/.exec(plugin);
    expect(q).not.toBeNull();
    expect(nativeCap).not.toBeNull();
    expect(Number(q[1])).toBeLessThanOrEqual(Number(nativeCap[1]));
  });

  it('prints queue phases as diagnostics and does not add them to total again', () => {
    const entry={
      at:1000,runId:'wait-telemetry',via:'reader',chapterKey:'c',pageIndex:0,
      hash:'a'.repeat(64),from:'model',translated:1,incomplete:false,textless:false,
      total:100,stages:{wait:90,luna:10},
      queueWait:{admission:40,continuation:30,prepared:20},
    };
    expect(summarize([entry]).text.median).toBe(100);
    const report=formatReport([entry]);
    expect(report).toContain('تفصيل wait (تشخيصي؛ لا يُجمع مرة ثانية): admission 0.04 ث · route→analyze 0.03 ث · prepared→run 0.02 ث');
  });
});
