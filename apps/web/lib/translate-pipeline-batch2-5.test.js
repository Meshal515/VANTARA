import { afterEach, describe, expect, it } from 'vitest';
import { prepareTranslation, translatePage, withNativeTranslationStage } from './translate.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const memory = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
};

function installDevice({ textless = false } = {}) {
  let analyses = 0;
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
        analyzePage: async () => {
          analyses += 1;
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
  return { analyses: () => analyses };
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
});
