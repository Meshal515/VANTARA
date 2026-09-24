import { afterEach, describe, expect, it } from 'vitest';
import { translatePage } from './translate.js';
import { readPerf } from './translate-perf.js';

/** الإضافة الأصلية مزيّفة: ما يعيده الجهاز هو ما يقرر ما يُعرض. */
function device({ drawn }) {
  const calls = { render: 0 };
  globalThis.Capacitor = {
    convertFileSrc: (p) => `http://localhost/_capacitor_file_${p}`,
    Plugins: {
      Translation: {
        analyzePage: async () => ({
          pageHash: 'h',
          width: 800,
          height: 1200,
          thumbnail: 'AAAA',
          regions: [{ id: 'r1', box: [1, 2, 3, 4], kind: 'speech', source: 'HELLO', status: 'pending' }],
          perf: { stages: { detect: 120, glyphs: 900 }, counts: { detectTiles: 1 } },
        }),
        renderPage: async () => {
          calls.render += 1;
          return { path: '/cache/translated-pages/h-abc.webp', translated: drawn, perf: { stages: { encode: 80 } } };
        },
      },
    },
  };
  return calls;
}

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};

const deps = () => ({
  imagePath: '/cache/pages/p1.jpg',
  sync: { translation: async () => ({ status: 200, body: { engine: 'gpt-6-luna:t2', regions: [{ id: 'r1', kind: 'speech', arabic: 'مرحبًا' }] } }) },
});

describe('what the phone draws is what the reader shows', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    delete globalThis.Capacitor;
    globalThis.fetch = realFetch;
    delete globalThis.localStorage;
  });

  it('a page where no Arabic was actually drawn keeps its original image (never a cleaned-only page)', async () => {
    device({ drawn: 0 });
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
    globalThis.localStorage = memory();
    const result = await translatePage(deps(), 'http://localhost/_capacitor_file_/cache/pages/p1.jpg', { chapterKey: 'c1', pageIndex: 0 });
    expect(result.image).toBeNull();
    expect(result.translated).toBe(0);
  });

  it('a drawn page shows the new file, and every stage lands in the performance log', async () => {
    device({ drawn: 1 });
    globalThis.fetch = async () => new Response(new Uint8Array([4, 5, 6]));
    globalThis.localStorage = memory();
    const result = await translatePage({ ...deps(), waitMs: 50, fetchMs: 30 }, 'http://localhost/_capacitor_file_/cache/pages/p2.jpg', { chapterKey: 'c1', pageIndex: 1 });
    expect(result.image).toContain('h-abc.webp');
    expect(result.translated).toBe(1);
    await new Promise((r) => setTimeout(r, 10));
    const [entry] = readPerf();
    expect(entry).toMatchObject({ chapterKey: 'c1', pageIndex: 1, from: 'model', translated: 1, textless: false });
    expect(Object.keys(entry.stages)).toEqual(expect.arrayContaining(['wait', 'fetch', 'hash', 'cacheRead', 'analyze', 'luna', 'render']));
    expect(entry.native.analyze.stages.glyphs).toBe(900);
    expect(entry.native.render.stages.encode).toBe(80);
  });
});
