import { describe, expect, it } from 'vitest';
import { createQueue, withNativeTranslationStage } from './translate.js';
import { formatReport, summarize } from './translate-perf.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const flush = async () => { for (let i = 0; i < 5; i++) await tick(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('live reader admission', () => {
  it('keeps routing textless pages while routed text pages wait for one Heavy owner', async () => {
    const heavy = deferred(); const routed = [];
    const q = createQueue({ prepareConcurrency: 2, maxPrepared: 4, maxRouteAhead: 12, maxInFlight: 24 });
    const pages = Array.from({ length: 12 }, (_, index) => q.add({ key: `k#${index}`, chapterKey: 'k', index,
      prepare: async () => {
        routed.push(index);
        // Even pages carry text and need Heavy; odd pages are textless.
        return index % 2 ? { bypass: true } : { continuePrepare: async () => { await heavy.promise; return { analysis: {} }; } };
      },
      run: async () => index,
    }));
    q.focus('k', 0, { k: 0 });
    await flush(); await flush();
    // Old rule: routed-and-waiting text pages filled maxPrepared (4) and Route stopped.
    expect(routed.length).toBe(12);
    heavy.resolve();
    await expect(Promise.all(pages)).resolves.toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it('admits the visible continuation past a waiting ahead continuation without overlapping Native', async () => {
    const held = deferred(); const order = []; let active = 0; let peak = 0;
    const native = (name, wait, priority) => withNativeTranslationStage(async () => {
      active++; peak = Math.max(peak, active); order.push(name); await wait; active--;
    }, { priority });
    const owner = native('owner', held.promise, 'analyze'); await tick();
    const q = createQueue({ prepareConcurrency: 2, maxPrepared: 6, maxInFlight: 3 });
    const add = index => q.add({ key: `c#${index}`, chapterKey: 'c', index,
      prepare: async ({ isInteractive }) => ({ continuePrepare: async () => {
        await native(index, null, () => isInteractive() ? 'analyze' : 'aheadAnalyze');
        return { analysis: {} };
      } }), run: async () => index,
    });
    const ahead = add(1); await flush();
    q.focus('c', 9, { c: 0 }); const visible = add(9); await flush();
    held.resolve(); await Promise.all([owner, ahead, visible]);
    expect(order).toEqual(['owner', 9, 1]);
    expect(peak).toBe(1);
  });

  it('keeps the snapshot bound even for a newly focused continuation', async () => {
    const hold = deferred(); const heavy = [];
    const q = createQueue({ prepareConcurrency: 2, maxPrepared: 6, maxInFlight: 1 });
    const add = index => q.add({key: `b#${index}`,chapterKey:'b',index,
      prepare: async () => ({ continuePrepare: async () => { heavy.push(index); await hold.promise; return { analysis:{} }; } }),
      run: async () => index });
    const a = add(0); await flush(); q.focus('b', 9, {b:0}); const b = add(9); await flush();
    expect(heavy).toEqual([0]); hold.resolve(); await Promise.all([a,b]); expect(heavy).toEqual([0,9]);
  });

  it('uses live page distance at a Native handover', async () => {
    const hold=deferred(); const order=[]; let focus=0;
    const owner=withNativeTranslationStage(()=>hold.promise); await tick();
    const tasks=[1,8,9].map(index=>withNativeTranslationStage(()=>{order.push(index);}, {
      priority:'aheadAnalyze', order:()=>Math.abs(index-focus),
    }));
    focus=9; hold.resolve(); await Promise.all([owner,...tasks]); expect(order).toEqual([9,8,1]);
  });

  it('bounds speculative Route overtakes so Heavy cannot starve', async () => {
    const hold=deferred(); const order=[];
    const owner=withNativeTranslationStage(()=>hold.promise); await tick();
    const heavy=withNativeTranslationStage(()=>{order.push('heavy');},{priority:'aheadAnalyze'});
    const routes=Array.from({length:12},(_,i)=>withNativeTranslationStage(()=>{order.push(i);},{priority:'aheadRoute'}));
    hold.resolve(); await Promise.all([owner,heavy,...routes]); expect(order.indexOf('heavy')).toBeLessThanOrEqual(2);
  });

  it('records the continuation blocker, owner identity and live focus without inflating wait', async () => {
    const hold=deferred(); let context;
    const q=createQueue({prepareConcurrency:2,maxPrepared:4,maxInFlight:1});
    const a=q.add({key:'trace#0',chapterKey:'trace',index:0,prepare:async()=>({continuePrepare:async()=>{await hold.promise;return {analysis:{}};}}),run:async()=>0});
    const b=q.add({key:'trace#1',chapterKey:'trace',index:1,prepare:async()=>({continuePrepare:async()=>({analysis:{}})}),run:async c=>{context=c;}});
    await flush(); q.focus('trace',1,{trace:0}); await flush(); hold.resolve(); await Promise.all([a,b]);
    expect(context.queueTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({event:'continuation-blocked',reason:'resident-limit',owners:['trace#0']}),
      expect.objectContaining({event:'focus',focused:true}),
    ]));
    expect(context.queueTrace.events.length).toBeLessThanOrEqual(32);
    expect(context.waitedMs).toBe(context.admissionWaitMs+context.continuationWaitMs+context.preparedWaitMs);
  });

  it('prints who blocked a page and the gate interval without adding diagnostic time', () => {
    const row={at:10000,from:'model',runId:'trace',chapterKey:'c',pageIndex:1,translated:1,regions:1,total:1000,stages:{wait:700,render:300},
      queueTrace:{events:[{at:1000,event:'continuation-blocked',reason:'continuation-limit',owners:['c#0'],continuing:1,resident:1,continuationCap:1,maxInFlight:24,capacity:{thermal:2,heapMb:80}}]},
      nativeTrace:[{at:1800,event:'native-blocker',owner:{chapterKey:'c',pageIndex:0},ownerStage:'aheadRoute',startedAt:1000,endedAt:1800}]};
    const report=formatReport([row]);
    expect(report).toContain('continuation-limit');
    expect(report).toContain('c#0');
    expect(report).toContain('aheadRoute');
    expect(report).toContain('0.80 ث');
    expect(summarize([row]).text.median).toBe(1000);
  });
});
