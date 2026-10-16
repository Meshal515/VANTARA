import { afterEach, describe, expect, it } from 'vitest';
import {
  LUNA_EXPECT_TTL_MS, PROBE_SKIP_AFTER_MISSES, expectLuna, expectedLunaPages, incompleteReasonsOf,
  observeProbe, settleLuna, shouldProbe, translatePage,
} from './translate.js';
import { readPerf } from './translate-perf.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};

function device({ drawn = 1 } = {}) {
  globalThis.Capacitor = {
    convertFileSrc: (p) => `http://localhost/_capacitor_file_${p}`,
    Plugins: {
      Translation: {
        analyzePage: async () => ({
          pageHash: 'h', width: 800, height: 1200, thumbnail: 'AAAA',
          regions: [{ id: 'r1', box: [1, 2, 3, 4], kind: 'speech', source: 'HELLO', status: 'pending' }],
          perf: { stages: {}, counts: {} },
        }),
        releasePageReservation: async () => {},
        renderPage: async () => ({ path: '/files/translated-pages/x.webp', translated: drawn, perf: { stages: {}, counts: drawn ? {} : { noFit: 1 } } }),
      },
    },
  };
}

describe('v3: the image-less cache probe stops costing a round trip on a fresh chapter', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { delete globalThis.Capacitor; globalThis.fetch = realFetch; delete globalThis.localStorage; });

  it('after two need_image misses the image goes in the first request', async () => {
    device();
    globalThis.localStorage = memory();
    let n = 0;
    globalThis.fetch = async () => new Response(new Uint8Array([9, 9, n++]));
    const calls = [];
    const sync = {
      translation: async (path, { body }) => {
        calls.push(body.image?.data ? 'image' : 'probe');
        if (!body.image?.data) return { status: 409, body: { error: 'need_image' } };
        return { status: 200, body: { engine: 'luna:t4', regions: [{ id: 'r1', kind: 'speech', arabic: 'مرحبًا' }] } };
      },
    };
    const meta = i => ({ chapterKey: 'fresh-chapter', pageIndex: i, seriesRef: 's' });
    for (let i = 0; i < 4; i++) {
      const r = await translatePage({ sync, imagePath: `/p/${i}.jpg` }, `http://localhost/_capacitor_file_/p/${i}.jpg`, meta(i));
      expect(r.translated).toBe(1);
    }
    expect(calls).toEqual(['probe', 'image', 'probe', 'image', 'image', 'image']);
    await new Promise(r => setTimeout(r, 10));
    const last = readPerf().at(-1);
    expect(last.native.probeSkipped).toBe(true);
    expect(last.stages.cacheProbe).toBeUndefined();
  });

  it('a cached hit re-enables probing for that chapter', () => {
    const meta = { chapterKey: 'mixed', speed: 'fast' };
    for (let i = 0; i < PROBE_SKIP_AFTER_MISSES; i++) observeProbe(meta, { missed: true, cached: false });
    expect(shouldProbe(meta)).toBe(false);
    expect(shouldProbe({ chapterKey: 'mixed' })).toBe(true); // quality mode is tracked separately
    observeProbe(meta, { missed: false, cached: true });
    expect(shouldProbe(meta)).toBe(true);
  });
});

describe('v3: Luna chunk hints', () => {
  it('counts other routed pages of the same chapter and mode, and expires stale ones', () => {
    const t = 1_000_000;
    expectLuna('a', { chapterKey: 'c9' }, t);
    expectLuna('b', { chapterKey: 'c9' }, t);
    expectLuna('c', { chapterKey: 'c9', speed: 'fast' }, t);
    expectLuna('d', { chapterKey: 'other' }, t);
    expect(expectedLunaPages({ pageHash: 'a', chapterKey: 'c9' }, t)).toBe(1);
    settleLuna('b');
    expect(expectedLunaPages({ pageHash: 'a', chapterKey: 'c9' }, t)).toBe(0);
    expect(expectedLunaPages({ pageHash: 'z', chapterKey: 'c9', speed: 'fast' }, t)).toBe(1);
    expect(expectedLunaPages({ pageHash: 'z', chapterKey: 'c9', speed: 'fast' }, t + LUNA_EXPECT_TTL_MS + 1)).toBe(0);
    for (const h of ['a', 'c', 'd']) settleLuna(h);
  });
});

describe('v3: partial pages carry their reasons', () => {
  it('derives every incomplete condition with its count', () => {
    expect(incompleteReasonsOf({})).toBeNull();
    expect(incompleteReasonsOf({
      coverageUnknown: 2,
      regions: [{ status: 'skipped:unreadable' }, { status: 'pending' }],
      unanswered: 1, drawn: 1, planned: 3,
      renderCounts: { residualLatin: 1, residualRescueQueued: 1, noFit: 2 },
    })).toEqual({ coverageUnknown: 2, unreadable: 1, unanswered: 1, notDrawn: 2, residualLatin: 1, residualRescueQueued: 1, noFit: 2 });
    expect(incompleteReasonsOf({ readable: 0, textless: false })).toEqual({ noReadable: 1 });
  });

  it('a page whose Arabic did not fit logs why it is partial', async () => {
    device({ drawn: 0 });
    globalThis.localStorage = memory();
    globalThis.fetch = async () => new Response(new Uint8Array([3, 1, 4]));
    const sync = { translation: async () => ({ status: 200, body: { engine: 'luna:t4', regions: [{ id: 'r1', kind: 'speech', arabic: 'نص' }] } }) };
    const r = await translatePage({ sync, imagePath: '/p/nf.jpg' }, 'http://localhost/_capacitor_file_/p/nf.jpg', { chapterKey: 'nf', pageIndex: 0 });
    expect(r.translated).toBe(0);
    await new Promise(res => setTimeout(res, 10));
    expect(readPerf().at(-1)).toMatchObject({ incomplete: true, incompleteReasons: { notDrawn: 1, noFit: 1 } });
    delete globalThis.Capacitor; delete globalThis.localStorage;
  });
});
