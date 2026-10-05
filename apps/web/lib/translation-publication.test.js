import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';

describe('accepted translation publication', () => {
  const realFetch = globalThis.fetch;
  const realIndexedDB = globalThis.indexedDB;

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realIndexedDB === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = realIndexedDB;
  });

  it('publishes each saved page before a later chapter page finishes', async () => {
    globalThis.indexedDB = new IDBFactory();
    globalThis.fetch = async (url) =>
      new Response(new Uint8Array(String(url).includes('p0') ? [1, 2, 3] : [4, 5, 6]));

    const mod = await import('./translate.js');
    expect(typeof mod.subscribeTranslationResults).toBe('function');
    if (typeof mod.subscribeTranslationResults !== 'function') return;

    const seen = [];
    const off = mod.subscribeTranslationResults((event) => seen.push(event));
    let releaseSecond;
    const secondGate = new Promise((resolve) => (releaseSecond = resolve));
    const api = async (_path, options) => {
      const pageIndex = options.body.pageIndex;
      if (pageIndex === 1) await secondGate;
      return {
        translated: 1,
        image: `data:image/webp;base64,page-${pageIndex}`,
        regions: [{ id: 'r1', source: 'HELLO', arabic: 'مرحبا', status: 'translated' }],
        engine: 'test:t4',
      };
    };
    const meta = (pageIndex) => ({
      seriesRef: 'ext:progressive',
      seriesTitle: 'Progressive',
      sourceId: 'source',
      chapterKey: 'ext:progressive#n:1',
      chapterNumber: 1,
      pageIndex,
      sourceLang: 'en',
    });

    const first = mod.translatePage({ api, via: 'job' }, 'https://page.test/p0.jpg', meta(0));
    const second = mod.translatePage({ api, via: 'job' }, 'https://page.test/p1.jpg', meta(1));
    const firstResult = await first;

    expect(firstResult.saved).toBe(true);
    expect(seen.map((event) => event.meta.pageIndex)).toEqual([0]);
    expect(seen[0].result.image).toContain('page-0');

    releaseSecond();
    await second;
    expect(seen.map((event) => event.meta.pageIndex)).toEqual([0, 1]);
    off();
  });
});
