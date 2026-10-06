import { afterEach, describe, expect, it } from 'vitest';
import { prepareTranslation, translatePage, withNativeTranslationStage } from './translate.js';

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

  it('does not run Route concurrently with an active Heavy native stage', async () => {
    globalThis.fetch = async () => new Response(new Uint8Array([31,32,33]));
    globalThis.localStorage = memory();
    installDevice({ textless:true });

    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const heavy = withNativeTranslationStage(() => hold, { priority:'analyze' });
    await tick();

    let routed = false;
    const original = globalThis.Capacitor.Plugins.Translation.routePage;
    globalThis.Capacitor.Plugins.Translation.routePage = async args => {
      routed = true;
      return original(args);
    };
    const preparing = prepareTranslation(
      'http://localhost/_capacitor_file_/cache/pages/serialized-route.jpg',
      { seriesRef:'ext:test', sourceId:'src', chapterKey:'c', pageIndex:2, sourceLang:'en' },
      { preAnalyze:true, via:'reader', interactive:false },
    );
    await tick();
    await tick();
    expect(routed).toBe(false);
    release();
    await heavy;
    const prepared = await preparing;
    expect(routed).toBe(true);
    expect(prepared.bypass).toBe(true);
  });

  it('routes jump ahead of queued ahead-analysis while all native inference remains serialized', async () => {
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const order = [];
    let active = 0;
    let maxActive = 0;
    const task = (name, priority, wait = null) => withNativeTranslationStage(async () => {
      active += 1; maxActive = Math.max(maxActive, active); order.push(name);
      if (wait) await wait;
      active -= 1;
    }, { priority });

    const holder = task('holder','analyze',hold);
    await tick();
    const ahead = task('ahead','aheadAnalyze');
    const route = task('route','route');
    await tick();
    release();
    await Promise.all([holder,ahead,route]);

    expect(order).toEqual(['holder','route','ahead']);
    expect(maxActive).toBe(1);
  });

  it('reader keeps a deep staged buffer instead of five end-to-end slots', async () => {
    const source = await import('node:fs').then(({readFileSync}) =>
      readFileSync(new URL('../v35/reader-translate.js', import.meta.url),'utf8'));
    expect(source).toMatch(/createQueue\(\{\s*concurrency:\s*12,\s*prepareConcurrency:\s*8,\s*maxPrepared:\s*24,\s*bypassConcurrency:\s*8\s*\}\)/);
    expect(source).toMatch(/prepareTranslation\([^;]+\{\s*preAnalyze:\s*true,/s);
  });

  it('lets a ready render beat speculative ahead route work', async () => {
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const order = [];
    const task = (name, priority, wait = null) => withNativeTranslationStage(async () => {
      order.push(name);
      if (wait) await wait;
    }, { priority });

    const holder = task('holder', 'analyze', hold);
    await tick();
    const speculativeRoute = task('ahead-route', () => 'aheadRoute');
    const readyRender = task('ready-render', 'aheadRender');
    await tick();
    release();
    await Promise.all([holder, speculativeRoute, readyRender]);

    expect(order).toEqual(['holder', 'ready-render', 'ahead-route']);
  });

  it('re-evaluates queued native priority so focus promotion is live', async () => {
    let releaseHolder;
    let releaseCandidate;
    let releaseRoute;
    const holderWait = new Promise(resolve => { releaseHolder = resolve; });
    const candidateWait = new Promise(resolve => { releaseCandidate = resolve; });
    const routeWait = new Promise(resolve => { releaseRoute = resolve; });
    const order = [];
    let focused = false;
    const task = (name, priority, wait = null) => withNativeTranslationStage(async () => {
      order.push(name);
      if (wait) await wait;
    }, { priority });

    const holder = task('holder', 'analyze', holderWait);
    await tick();
    const candidate = task('candidate', () => focused ? 'render' : 'aheadAnalyze', candidateWait);
    const route = task('route', 'route', routeWait);
    await tick();

    focused = true;
    releaseHolder();
    await tick();
    expect(order).toEqual(['holder', 'candidate']);
    releaseCandidate();
    await tick();
    expect(order).toEqual(['holder', 'candidate', 'route']);
    releaseRoute();
    await Promise.all([holder, candidate, route]);
    expect(order).toEqual(['holder', 'candidate', 'route']);
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
