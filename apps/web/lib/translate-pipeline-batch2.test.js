import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareTranslation, translatePage, withNativeTranslationStage } from './translate.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const memory = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
};

function installDevice() {
  globalThis.Capacitor = {
    convertFileSrc: p => `http://localhost/_capacitor_file_${p}`,
    Plugins: {
      Translation: {
        routePage: async ({ path }) => ({
          pageHash: path.includes('textless') ? '1'.repeat(64) : '2'.repeat(64),
          width: 800,
          height: 1200,
          textless: path.includes('textless'),
          perf: { stages: { detect: 5, queue: 0 }, counts: {} },
        }),
        analyzePage: async ({ path }) => ({
          pageHash: path.includes('p1') ? 'a'.repeat(64) : 'b'.repeat(64),
          width: 800,
          height: 1200,
          thumbnail: 'AAAA',
          regions: [{ id: 'r1', source: 'Hello', kind: 'speech', status: 'pending', box: [10, 10, 100, 100] }],
          perf: { stages: { glyphs: 5, bubbles: 5, queue: 0 }, counts: {} },
        }),
        renderPage: async ({ path }) => ({
          path: path + '.translated.webp',
          translated: 1,
          perf: { stages: { erase: 2, queue: 0 }, counts: {} },
        }),
        releasePageReservation: async () => ({}),
      },
    },
  };
}

describe('batch 2 staged translation pipeline', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete globalThis.Capacitor;
    delete globalThis.localStorage;
    vi.useRealTimers();
  });

  it('lightweight route/textless detection is not blocked behind a heavy native stage', async () => {
    installDevice();
    globalThis.localStorage = memory();
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));

    let releaseHeavy;
    const heavyHold = new Promise(resolve => { releaseHeavy = resolve; });
    const heavy = withNativeTranslationStage(() => heavyHold, { priority: 'analyze' });
    await tick();

    let routed = false;
    const original = globalThis.Capacitor.Plugins.Translation.routePage;
    globalThis.Capacitor.Plugins.Translation.routePage = async args => {
      routed = true;
      return original(args);
    };

    const preparing = prepareTranslation(
      'http://localhost/_capacitor_file_/cache/textless.jpg',
      { seriesRef: 'ext:test', sourceId: 'src', chapterKey: 'c', pageIndex: 0, sourceLang: 'en' },
    );
    await tick();
    await tick();

    expect(routed).toBe(true);
    releaseHeavy();
    await heavy;
    const prepared = await preparing;
    expect(prepared.bypass).toBe(true);
  });

  it('ahead reader pages batch Luna instead of paying one direct model request each', async () => {
    installDevice();
    globalThis.localStorage = memory();
    globalThis.fetch = async src => {
      const n = String(src).includes('p1') ? 11 : 22;
      return new Response(new Uint8Array([n, n + 1, n + 2]));
    };

    const calls = [];
    const sync = {
      translation: async (path, options) => {
        calls.push({ path, body: options.body });
        if (path === '/v1/translate/text' && !options.body.image.data) {
          return { status: 409, body: { error: 'need_image' } };
        }
        if (path === '/v1/translate/text-batch') {
          return {
            status: 200,
            body: {
              pages: options.body.pages.map(page => ({
                pageHash: page.pageHash,
                pageIndex: page.pageIndex,
                status: 200,
                body: { engine: 'gpt-6-luna:t4', regions: [{ id: 'r1', kind: 'speech', arabic: 'مرحبًا' }] },
              })),
            },
          };
        }
        return { status: 200, body: { engine: 'gpt-6-luna:t4', regions: [{ id: 'r1', kind: 'speech', arabic: 'مرحبًا' }] } };
      },
    };

    const meta = index => ({ seriesRef: 'ext:test', sourceId: 'src', chapterKey: 'c', pageIndex: index, sourceLang: 'en' });
    const one = translatePage(
      { via: 'reader', interactive: false, sync },
      'http://localhost/_capacitor_file_/cache/p1.jpg',
      meta(1),
    );
    const two = translatePage(
      { via: 'reader', interactive: false, sync },
      'http://localhost/_capacitor_file_/cache/p2.jpg',
      meta(2),
    );

    await vi.waitFor(() => {
      expect(calls.filter(c => c.path === '/v1/translate/text')).toHaveLength(2);
    }, { timeout: 1_000, interval: 10 });
    await Promise.all([one, two]);

    const modelDirect = calls.filter(c => c.path === '/v1/translate/text' && c.body.image?.data);
    const batches = calls.filter(c => c.path === '/v1/translate/text-batch');
    expect(modelDirect).toHaveLength(0);
    expect(batches).toHaveLength(1);
    expect(batches[0].body.pages).toHaveLength(2);
  });

  it('reports preparation sub-stages instead of hiding route/hash/cache inside one large number', async () => {
    installDevice();
    globalThis.localStorage = memory();
    globalThis.fetch = async () => new Response(new Uint8Array([7, 8, 9]));
    const prepared = await prepareTranslation(
      'http://localhost/_capacitor_file_/cache/textless.jpg',
      { seriesRef: 'ext:test', sourceId: 'src', chapterKey: 'c', pageIndex: 0, sourceLang: 'en' },
    );
    expect(prepared.prepareStages).toEqual(expect.objectContaining({
      'prepare.hash': expect.any(Number),
      'prepare.cacheRead': expect.any(Number),
      'prepare.route': expect.any(Number),
    }));
  });

  it('keeps repair and jobs behind ready and ahead reader stages', async () => {
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const order = [];
    const holder = withNativeTranslationStage(async () => {
      order.push('holder');
      await hold;
    }, { priority: 'analyze' });
    await tick();

    const background = withNativeTranslationStage(async () => order.push('background'), { priority: 'background' });
    const aheadAnalyze = withNativeTranslationStage(async () => order.push('ahead-analyze'), { priority: 'aheadAnalyze' });
    const aheadRender = withNativeTranslationStage(async () => order.push('ahead-render'), { priority: 'aheadRender' });
    const visibleRender = withNativeTranslationStage(async () => order.push('visible-render'), { priority: 'render' });
    await tick();

    release();
    await Promise.all([holder, background, aheadAnalyze, aheadRender, visibleRender]);
    expect(order).toEqual(['holder', 'visible-render', 'ahead-render', 'ahead-analyze', 'background']);
  });

  it('exposes native admission wait separately from actual analyze/render duration', async () => {
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const first = withNativeTranslationStage(() => hold, { priority: 'analyze' });
    await tick();

    let waited = null;
    const second = withNativeTranslationStage(async () => 'done', {
      priority: 'render',
      onWait: ms => { waited = ms; },
    });
    await tick();
    expect(waited).toBeNull();
    release();
    await first;
    await expect(second).resolves.toBe('done');
    expect(waited).toEqual(expect.any(Number));
    expect(waited).toBeGreaterThanOrEqual(0);
  });

  it('keeps bounded multi-page backpressure and a real textless bypass after later pipeline tuning', async () => {
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../v35/reader-translate.js', import.meta.url), 'utf8'));
    const match = /createQueue\(\{\s*concurrency:\s*(\d+),\s*prepareConcurrency:\s*(\d+),\s*maxPrepared:\s*(\d+),\s*bypassConcurrency:\s*(\d+)\s*\}\)/.exec(source);
    expect(match).not.toBeNull();
    const [, concurrency, prepareConcurrency, maxPrepared, bypassConcurrency] = match.map(Number);
    expect(concurrency).toBeGreaterThanOrEqual(5);
    expect(prepareConcurrency).toBeGreaterThanOrEqual(4);
    expect(maxPrepared).toBeGreaterThanOrEqual(12);
    expect(bypassConcurrency).toBeGreaterThanOrEqual(2);
  });
});
