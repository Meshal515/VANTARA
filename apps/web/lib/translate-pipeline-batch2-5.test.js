import { afterEach, describe, expect, it, vi } from 'vitest';
const { kv } = vi.hoisted(() => ({ kv: new Map() }));
vi.mock('./chapter-store.js', () => ({readKv:async key=>kv.get(key) ?? null,writeKv:async(key,value)=>{kv.set(key,{value});return key;}}));
import { createQueue, prepareTranslation, translatePage, withNativeTranslationStage } from './translate.js';
import { writeKv } from './chapter-store.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const memory = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
};

function installDevice({ textless = false } = {}) {
  let analyses = 0;
  const analyzePriorities = [];
  globalThis.Capacitor = {
    convertFileSrc: p => `http://localhost/_capacitor_file_${p}`,
    Plugins: {
      Translation: {
        routePage: async () => ({
          pageHash: '75e2d2db3843a0280e4ca9a4d1b354b69646941540e711605cc66524eac20322',
          width: 800,
          height: 1200,
          textless,
          perf: { stages: { detect: 4 }, counts: {} },
        }),
        analyzePage: async (args = {}) => {
          analyses += 1;
          analyzePriorities.push(args.priority);
          return {
            pageHash: '75e2d2db3843a0280e4ca9a4d1b354b69646941540e711605cc66524eac20322',
            width: 800,
            height: 1200,
            thumbnail: 'AAAA',
            regions: textless ? [] : [{ id: 'r1', box: [1,2,3,4], kind: 'speech', source: 'HELLO', status: 'pending' }],
            perf: { stages: { glyphs: 5, bubbles: 5 }, counts: {} },
          };
        },
        renderPage: async () => ({
          path: '/cache/translated.webp',
          translated: textless ? 0 : 1,
          perf: { stages: { erase: 1 }, counts: {} },
        }),
        releasePageReservation: async () => ({}),
      },
    },
  };
  return { analyses: () => analyses, analyzePriorities: () => [...analyzePriorities] };
}

describe('batch 2.5 stage pipeline', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    kv.clear();
    globalThis.fetch = realFetch;
    delete globalThis.Capacitor;
    delete globalThis.localStorage;
  });

  it('pre-analyzes dialogue during preparation so Luna waiting does not hold the heavy analyzer', async () => {
    globalThis.fetch = async () => new Response(new Uint8Array([31,32,33]));
    globalThis.localStorage = memory();
    const device = installDevice();
    const src = 'http://localhost/_capacitor_file_/cache/pages/staged.jpg';
    const meta = { seriesRef:'ext:test', sourceId:'src', chapterKey:'c', pageIndex:0, sourceLang:'en' };

    const prepared = await prepareTranslation(src, meta, { preAnalyze:true, via:'reader', interactive:false });
    expect(device.analyses()).toBe(1);
    expect(prepared.analysis?.regions?.[0]?.source).toBe('HELLO');

    const result = await translatePage({
      via:'reader',
      interactive:false,
      prepared,
      sync:{ translation: async (_path, options) => ({
        status:200,
        body:{ engine:'gpt-6-luna:t4', regions:[{ id:'r1', kind:'speech', arabic:'مرحبا' }] },
      }) },
    }, src, meta);

    expect(result.translated).toBe(1);
    expect(device.analyses()).toBe(1);
  });


  it('can return heavy pre-analysis as a bounded continuation after Route completes', async () => {
    globalThis.fetch = async () => new Response(new Uint8Array([31,32,33]));
    globalThis.localStorage = memory();
    const device = installDevice();
    const src = 'http://localhost/_capacitor_file_/cache/pages/deferred.jpg';
    const meta = { seriesRef:'ext:test', sourceId:'src', chapterKey:'c', pageIndex:0, sourceLang:'en' };

    const routed = await prepareTranslation(src, meta, { preAnalyze:true, deferAnalyze:true, via:'reader', interactive:false });
    expect(device.analyses()).toBe(0);
    expect(routed.bypass).toBe(false);
    expect(routed.continuePrepare).toEqual(expect.any(Function));

    const prepared = await routed.continuePrepare();
    expect(device.analyses()).toBe(1);
    expect(prepared.analysis?.regions?.[0]?.source).toBe('HELLO');
    expect(prepared.continuePrepare).toBeUndefined();
  });

  it('finishes textless preparation after route without invoking heavy analyze', async () => {
    globalThis.fetch = async () => new Response(new Uint8Array([31,32,33]));
    globalThis.localStorage = memory();
    const device = installDevice({ textless:true });
    const src = 'http://localhost/_capacitor_file_/cache/pages/textless.jpg';
    const meta = { seriesRef:'ext:test', sourceId:'src', chapterKey:'c', pageIndex:1, sourceLang:'en' };

    const prepared = await prepareTranslation(src, meta, { preAnalyze:true, via:'reader', interactive:false });
    expect(prepared.bypass).toBe(true);
    expect(device.analyses()).toBe(0);
  });

  it('does not pre-analyze quarantined cache only to discard it in the repair branch', async () => {
    globalThis.fetch = async () => new Response(new Uint8Array([31,32,33]));
    globalThis.localStorage = memory();
    const device=installDevice();
    const hash='75e2d2db3843a0280e4ca9a4d1b354b69646941540e711605cc66524eac20322';
    await writeKv(`tl4:${hash}`,{translated:0,incomplete:true,regions:[],tries:1,engine:'device'});
    const prepared=await prepareTranslation('http://localhost/_capacitor_file_/cache/pages/partial.jpg',
      {chapterKey:'partial',pageIndex:0},{preAnalyze:true,deferAnalyze:true});
    expect(device.analyses()).toBe(0);
    expect(prepared.bypass).toBe(true);
    expect(prepared.continuePrepare).toBeUndefined();
  });

  it('promotes a repair while its original reader page is visible', async () => {
    globalThis.fetch=async()=>new Response(new Uint8Array([31,32,33]));
    globalThis.localStorage=memory(); const device=installDevice();
    await prepareTranslation('http://localhost/_capacitor_file_/cache/pages/visible-repair.jpg',
      {chapterKey:'repair',pageIndex:0},{preAnalyze:true,via:'repair',isInteractive:()=>true});
    expect(device.analyzePriorities()).toEqual(['high']);
  });

  it('a fast-to-smart upgrade never bypasses the heavy resident window', async () => {
    globalThis.fetch=async()=>new Response(new Uint8Array([31,32,33]));globalThis.localStorage=memory();installDevice();
    const hash='75e2d2db3843a0280e4ca9a4d1b354b69646941540e711605cc66524eac20322';
    await writeKv(`tl4:${hash}`,{translated:0,incomplete:true,regions:[],engine:'luna:t4:fast'});
    const result=await prepareTranslation('http://localhost/_capacitor_file_/cache/upgrade.jpg',{speed:'smart'},
      {preAnalyze:true,deferAnalyze:true});
    expect(result.bypass).toBe(false);expect(result.continuePrepare).toEqual(expect.any(Function));
  });

  it('Route runs while another page holds the Heavy lane (no whole-page head-of-line blocking)', async () => {
    globalThis.fetch = async () => new Response(new Uint8Array([31,32,33]));
    globalThis.localStorage = memory();
    installDevice({ textless:true });

    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const heavy = withNativeTranslationStage(() => hold, { priority:'aheadAnalyze', lane:'analyze' });
    await tick();

    try {
      const prepared = await prepareTranslation(
        'http://localhost/_capacitor_file_/cache/pages/lane-route.jpg',
        { seriesRef:'ext:test', sourceId:'src', chapterKey:'c', pageIndex:2, sourceLang:'en' },
        { preAnalyze:true, via:'reader', interactive:true },
      );
      expect(prepared.bypass).toBe(true);
    } finally {
      release();
      await heavy;
    }
  });

  it('serializes each Native lane and orders it by reader priority', async () => {
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const order = [];
    const active = { route:0, analyze:0, render:0 };
    const maxActive = { route:0, analyze:0, render:0 };
    const task = (name, priority, lane, wait = null) => withNativeTranslationStage(async () => {
      active[lane] += 1; maxActive[lane] = Math.max(maxActive[lane], active[lane]); order.push(name);
      if (wait) await wait;
      active[lane] -= 1;
    }, { priority, lane });

    const holder = task('holder','aheadAnalyze','analyze',hold);
    await tick();
    const ahead = task('ahead','aheadAnalyze','analyze');
    const visible = task('visible','analyze','analyze');
    const route = task('route','aheadRoute','route');
    await route;
    expect(order).toEqual(['holder','route']);
    release();
    await Promise.all([holder,ahead,visible]);

    expect(order).toEqual(['holder','route','visible','ahead']);
    expect(maxActive).toEqual({ route:1, analyze:1, render:0 });
  });

  it('capacity contract pauses and resumes queue admission without dropping work', async () => {
    let changed;
    let allow = false;
    let prepared = 0;
    let ran = 0;
    const capacity = {
      queueLimits: () => allow
        ? { concurrency: 1, prepareConcurrency: 1, maxPrepared: 1, bypassConcurrency: 0 }
        : { concurrency: 0, prepareConcurrency: 0, maxPrepared: 0, bypassConcurrency: 0 },
      subscribe: fn => { changed = fn; return () => {}; },
    };
    const q = createQueue({ concurrency:1, prepareConcurrency:1, maxPrepared:1, bypassConcurrency:0, capacity, lane:'test' });
    const result = q.add({
      key:'c#0', chapterKey:'c', index:0,
      prepare:async()=> { prepared += 1; return { bypass:false }; },
      run:async()=> { ran += 1; return 'done'; },
    });
    await tick();
    expect(prepared).toBe(0);
    expect(ran).toBe(0);
    allow = true;
    changed();
    await expect(result).resolves.toBe('done');
    expect(prepared).toBe(1);
    expect(ran).toBe(1);
  });

  it('reader keeps a deep staged buffer instead of five end-to-end slots', async () => {
    const source = await import('node:fs').then(({readFileSync}) =>
      readFileSync(new URL('../v35/reader-translate.js', import.meta.url),'utf8'));
    expect(source).toMatch(/createQueue\(\{\s*concurrency:\s*12,\s*prepareConcurrency:\s*8,\s*maxPrepared:\s*24,\s*bypassConcurrency:\s*8,\s*maxInFlight:\s*24,\s*capacity:\s*runtimeCapacity,\s*lane:\s*'reader',\s*lead:\s*LEAD_PAGES\s*\}\)/);
    expect(source).toMatch(/prepareTranslation\([^;]+\{\s*preAnalyze:\s*true,/s);
  });

  it('a visible render beats a queued ahead render in the render lane', async () => {
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const order = [];
    const task = (name, priority, wait = null) => withNativeTranslationStage(async () => {
      order.push(name);
      if (wait) await wait;
    }, { priority, lane:'render' });

    const holder = task('holder', 'aheadRender', hold);
    await tick();
    const ahead = task('ahead-render', () => 'aheadRender');
    const visible = task('visible-render', 'render');
    await tick();
    release();
    await Promise.all([holder, ahead, visible]);

    expect(order).toEqual(['holder', 'visible-render', 'ahead-render']);
  });

  it('re-evaluates queued native priority so focus promotion is live', async () => {
    let releaseHolder;
    let releaseCandidate;
    const holderWait = new Promise(resolve => { releaseHolder = resolve; });
    const candidateWait = new Promise(resolve => { releaseCandidate = resolve; });
    const order = [];
    let focused = false;
    const task = (name, priority, wait = null) => withNativeTranslationStage(async () => {
      order.push(name);
      if (wait) await wait;
    }, { priority, lane:'analyze' });

    const holder = task('holder', 'aheadAnalyze', holderWait);
    await tick();
    const other = task('other', 'aheadAnalyze');
    const candidate = task('candidate', () => focused ? 'analyze' : 'aheadAnalyze', candidateWait);
    await tick();

    focused = true;
    releaseHolder();
    await tick();
    expect(order).toEqual(['holder', 'candidate']);
    releaseCandidate();
    await Promise.all([holder, candidate, other]);
    expect(order).toEqual(['holder', 'candidate', 'other']);
  });


  it('promotes focused preparation all the way into Kotlin analyze priority', async () => {
    globalThis.fetch = async () => new Response(new Uint8Array([31,32,33]));
    globalThis.localStorage = memory();
    const device = installDevice();
    let focused = false;
    const src = 'http://localhost/_capacitor_file_/cache/pages/focus-priority.jpg';
    const meta = { seriesRef:'ext:test', sourceId:'src', chapterKey:'c', pageIndex:7, sourceLang:'en' };

    const prepared = await prepareTranslation(src, meta, {
      preAnalyze:true,
      via:'reader',
      interactive:false,
      isInteractive:() => focused = true,
    });

    expect(prepared.analysis?.regions?.length).toBe(1);
    expect(device.analyzePriorities()).toEqual(['high']);
  });

});
