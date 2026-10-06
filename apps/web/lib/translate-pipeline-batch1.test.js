import { afterEach, describe, expect, it } from 'vitest';
import { prepareTranslation, translatePage, withNativeTranslationStage } from './translate.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const memory = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
};

describe('batch 1 reader pipeline', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete globalThis.Capacitor;
    delete globalThis.localStorage;
  });

  it('lets a ready render jump ahead of queued analyze work without overlapping native stages', async () => {
    let releaseHolder;
    const held = new Promise(resolve => { releaseHolder = resolve; });
    const order = [];
    let active = 0;
    let maxActive = 0;

    const run = (name, priority, hold = null) => withNativeTranslationStage(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(name);
      if (hold) await hold;
      active -= 1;
    }, { priority });

    const holder = run('holder', 'analyze', held);
    await tick();
    const analyze = run('next-analyze', 'analyze');
    const render = run('ready-render', 'render');
    await tick();

    expect(order).toEqual(['holder']);
    releaseHolder();
    await Promise.all([holder, analyze, render]);

    expect(order).toEqual(['holder', 'ready-render', 'next-analyze']);
    expect(maxActive).toBe(1);
  });

  it('reuses preparation hash cache and route instead of reading the same page twice', async () => {
    let fetches = 0;
    let analyses = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      return new Response(new Uint8Array([31, 32, 33]));
    };
    globalThis.localStorage = memory();
    globalThis.Capacitor = {
      convertFileSrc: p => `http://localhost/_capacitor_file_${p}`,
      Plugins: {
        Translation: {
          routePage: async () => ({ pageHash: '75e2d2db3843a0280e4ca9a4d1b354b69646941540e711605cc66524eac20322', width: 800, height: 1200, textless: true, perf: { stages: { detect: 10 }, counts: {} } }),
          analyzePage: async () => {
            analyses += 1;
            return { pageHash: 'native-hash', width: 800, height: 1200, thumbnail: '', regions: [], perf: { stages: {}, counts: {} } };
          },
        },
      },
    };

    const src = 'http://localhost/_capacitor_file_/cache/pages/prepared.jpg';
    const meta = { seriesRef: 'ext:test', sourceId: 'src', chapterKey: 'c1', chapterNumber: 1, pageIndex: 0, sourceLang: 'en' };
    const prepared = await prepareTranslation(src, meta);
    const result = await translatePage({
      via: 'reader',
      prepared,
      sync: { translation: async () => { throw new Error('textless page must not call Luna'); } },
    }, src, meta);

    expect(result.translated).toBe(0);
    expect(fetches).toBe(1);
    expect(analyses).toBe(0);
  });

  it('never regresses the reader to one whole-page pipeline with no textless bypass', async () => {
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../v35/reader-translate.js', import.meta.url), 'utf8'));
    const match = /createQueue\(\{\s*concurrency:\s*(\d+),\s*prepareConcurrency:\s*(\d+),\s*maxPrepared:\s*(\d+),\s*bypassConcurrency:\s*(\d+)\s*\}\)/.exec(source);
    expect(match).not.toBeNull();
    const [, concurrency, prepareConcurrency, maxPrepared, bypassConcurrency] = match.map(Number);
    expect(concurrency).toBeGreaterThanOrEqual(3);
    expect(prepareConcurrency).toBeGreaterThanOrEqual(1);
    expect(maxPrepared).toBeGreaterThanOrEqual(concurrency);
    expect(bypassConcurrency).toBeGreaterThanOrEqual(1);
  });
});
