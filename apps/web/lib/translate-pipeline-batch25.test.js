import { afterEach, describe, expect, it } from 'vitest';
import { translatePage } from './translate.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const memory = () => {
  const m = new Map();
  return {
    getItem: key => m.get(key) ?? null,
    setItem: (key, value) => m.set(key, value),
    removeItem: key => m.delete(key),
  };
};

function installDevice({ analyzePage, renderPage }) {
  globalThis.Capacitor = {
    convertFileSrc: path => `http://localhost/_capacitor_file_${path}`,
    Plugins: {
      Translation: {
        analyzePage,
        renderPage,
        releasePageReservation: async () => ({}),
      },
    },
  };
}

function analysis(hash, regions) {
  return {
    pageHash: hash,
    width: 800,
    height: 1200,
    thumbnail: 'AAAA',
    regions,
    perf: { stages: {}, counts: {} },
  };
}

const region = (id = 'r1') => ({
  id,
  source: 'Hello',
  kind: 'speech',
  status: 'pending',
  box: [10, 10, 100, 100],
});

describe('batch 2.5 stage ownership', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete globalThis.Capacitor;
    delete globalThis.localStorage;
  });

  it('lets a ready render use its native render lane while the next page is still analyzing', async () => {
    globalThis.localStorage = memory();
    globalThis.fetch = async src => {
      const n = String(src).includes('p1') ? 11 : 22;
      return new Response(new Uint8Array([n, n + 1, n + 2]));
    };

    let releaseP1Network;
    const p1Network = new Promise(resolve => { releaseP1Network = resolve; });
    let markP1Probe;
    const p1ProbeStarted = new Promise(resolve => { markP1Probe = resolve; });

    let releaseP2Analyze;
    const p2AnalyzeHold = new Promise(resolve => { releaseP2Analyze = resolve; });
    let markP2Analyze;
    const p2AnalyzeStarted = new Promise(resolve => { markP2Analyze = resolve; });

    const renderEvents = [];
    installDevice({
      analyzePage: async ({ path }) => {
        if (path.includes('p2')) {
          markP2Analyze();
          await p2AnalyzeHold;
          return analysis('b'.repeat(64), [region()]);
        }
        return analysis('a'.repeat(64), [region()]);
      },
      renderPage: async ({ path }) => {
        renderEvents.push(path.includes('p1') ? 'p1' : 'p2');
        return { path: path + '.translated.webp', translated: 1, perf: { stages: {}, counts: {} } };
      },
    });

    const sync = {
      translation: async (_path, options) => {
        if (options.body.pageIndex === 0) {
          markP1Probe();
          await p1Network;
        }
        return {
          status: 200,
          body: { engine: 'gpt-6-luna:t4', regions: [{ id: 'r1', kind: 'speech', arabic: 'مرحبًا' }] },
        };
      },
    };

    const meta = pageIndex => ({
      seriesRef: 'ext:test',
      seriesTitle: 'Test',
      sourceId: 'src',
      chapterKey: 'c1',
      chapterNumber: 1,
      pageIndex,
      sourceLang: 'en',
    });

    const p1 = translatePage(
      { via: 'reader', interactive: true, sync },
      'http://localhost/_capacitor_file_/cache/p1.jpg',
      meta(0),
    );
    await p1ProbeStarted;

    const p2 = translatePage(
      { via: 'reader', interactive: false, sync },
      'http://localhost/_capacitor_file_/cache/p2.jpg',
      meta(1),
    );
    await p2AnalyzeStarted;

    let renderedBeforeAnalyzeReleased = false;
    try {
      releaseP1Network();
      await tick();
      await tick();
      renderedBeforeAnalyzeReleased = renderEvents.includes('p1');
    } finally {
      releaseP2Analyze();
      await Promise.allSettled([p1, p2]);
    }

    expect(renderedBeforeAnalyzeReleased).toBe(true);
  });

  it('keeps ahead reader pages on native reader priority while Luna remains non-interactive', async () => {
    globalThis.localStorage = memory();
    globalThis.fetch = async () => new Response(new Uint8Array([41, 42, 43]));

    let nativePriority = null;
    installDevice({
      analyzePage: async ({ priority }) => {
        nativePriority = priority;
        return {
          pageHash: 'c'.repeat(64),
          width: 800,
          height: 1200,
          thumbnail: '',
          regions: [],
          perf: { stages: {}, counts: {} },
        };
      },
      renderPage: async () => {
        throw new Error('textless analysis must not render');
      },
    });

    const result = await translatePage(
      {
        via: 'reader',
        interactive: false,
        sync: { translation: async () => { throw new Error('textless analysis must not call Luna'); } },
      },
      'http://localhost/_capacitor_file_/cache/ahead.jpg',
      {
        seriesRef: 'ext:test',
        seriesTitle: 'Test',
        sourceId: 'src',
        chapterKey: 'c1',
        chapterNumber: 1,
        pageIndex: 4,
        sourceLang: 'en',
      },
    );

    expect(result.translated).toBe(0);
    expect(nativePriority).toBe('high');
  });

  it('uses page concurrency only as backpressure, sized to the native 24-route handoff instead of a five-page pipeline', async () => {
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../v35/reader-translate.js', import.meta.url), 'utf8'));

    expect(source).toMatch(
      /createQueue\(\{\s*concurrency:\s*8,\s*prepareConcurrency:\s*4,\s*maxPrepared:\s*16,\s*bypassConcurrency:\s*4\s*\}\)/,
    );
  });

  it('keeps the routed handoff window within the native 24-page LRU capacity', async () => {
    const reader = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../v35/reader-translate.js', import.meta.url), 'utf8'));
    const plugin = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../../../android/app/src/main/kotlin/com/vantara/plugins/translation/TranslationPlugin.kt', import.meta.url), 'utf8'));

    const q = /createQueue\(\{\s*concurrency:\s*(\d+),\s*prepareConcurrency:\s*(\d+),\s*maxPrepared:\s*(\d+),\s*bypassConcurrency:\s*(\d+)\s*\}\)/.exec(reader);
    const nativeCap = /routedPages[^\n]*size>(\d+)/.exec(plugin);

    expect(q).not.toBeNull();
    expect(nativeCap).not.toBeNull();
    const activePages = Number(q[1]);
    const waitingPrepared = Number(q[3]);
    expect(activePages + waitingPrepared).toBeLessThanOrEqual(Number(nativeCap[1]));
  });
});
