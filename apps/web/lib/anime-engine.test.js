import { afterEach, describe, expect, it, vi } from 'vitest';
import { available, clock, configure, groupRoutes, matchingWorkingRoute, momentLabel, momentStart, pickWork, retrySeconds, upsertRoute } from './anime-engine.js';

const work = (title, ...copies) => ({ key: title, title, thumbnail: null, copies: copies.map((c) => ({ sourceId: c, url: `/${c}`, title })) });

describe('anime-engine bridge', () => {
  afterEach(() => {
    delete globalThis.Capacitor;
  });

  it('is absent on the web and returns null instead of fake data', async () => {
    expect(available()).toBe(false);
    expect(await configure()).toBe(null);
  });

  it('sends the bundled manifest to the native engine once', async () => {
    const plugin = { configure: vi.fn(async () => ({ ok: true, errors: [] })) };
    globalThis.Capacitor = { Plugins: { AnimeEngine: plugin } };
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ sources: [] }) }));
    await configure({ force: true, fetchImpl });
    await configure({ fetchImpl });
    expect(plugin.configure).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/anime/sources.json', { cache: 'no-cache' });
  });

  it('rejects a manifest the engine refuses', async () => {
    globalThis.Capacitor = { Plugins: { AnimeEngine: { configure: async () => ({ ok: false, errors: ['x: sha256'] }) } } };
    await expect(configure({ force: true, fetchImpl: async () => ({ json: async () => ({}) }) })).rejects.toThrow('sha256');
  });

  it('picks the work whose copy title matches exactly', () => {
    const works = [work('One Piece Film Red', 'a'), work('ONE PIECE', 'b', 'c')];
    expect(pickWork(works, ['One Piece', 'ワンピース']).copies.length).toBe(2);
  });

  it('refuses a weak match rather than playing the wrong anime', () => {
    expect(pickWork([work('Naruto Shippuden', 'a')], ['Naruto: The Movie Special Edition'])).toBe(null);
  });

  it('groups servers by quality like the native sheet, unavailable last', () => {
    const r = (id, quality, state) => ({ id, code: id.toUpperCase(), quality, state });
    const groups = groupRoutes([r('a', 720, 'READY'), r('b', 1080, 'RESOLVING'), r('c', null, 'UNAVAILABLE'), r('d', 1080, 'READY'), r('e', null, 'FAILED')]);
    expect(groups.map((g) => g[0])).toEqual(['1080p', '720p', 'جودة غير محددة', 'غير متاح']);
    expect(groups[0][1].map((x) => x.id)).toEqual(['d', 'b']);
  });

  it('upserts a route update in place', () => {
    const list = [{ id: 'x', state: 'RESOLVING' }];
    expect(upsertRoute(list, { id: 'x', state: 'READY' })).toEqual([{ id: 'x', state: 'READY' }]);
    expect(upsertRoute(list, { id: 'y', state: 'READY' })).toHaveLength(2);
  });

  it('reuses a working host across titles without trusting the unstable tile code or episode URL', () => {
    const routes = [
      { sourceId: 'ok', server: 'MMX', code: 'MMX2', quality: 720, state: 'READY' },
      { sourceId: 'wit', server: 'MMX', code: 'MMX', quality: 1080, state: 'READY' },
      { sourceId: 'ok', server: 'MMX', code: 'MMX', quality: 1080, state: 'READY' },
    ];
    expect(matchingWorkingRoute(routes, { sourceId: 'ok', server: 'MMX', quality: 720 })).toBe(routes[0]);
    expect(matchingWorkingRoute(routes.map((r) => ({ ...r, state: 'FAILED' })), { sourceId: 'ok', server: 'MMX' })).toBe(null);
  });

  it('round-trips a shared moment through its Majlis label', () => {
    const label = momentLabel(12, 730_000, 740_000);
    expect(label).toBe('الحلقة 12 · 12:10–12:20');
    expect(momentStart(label)).toBe(730_000);
    expect(momentStart('الحلقة 12')).toBe(null);
    expect(clock(3_725_000)).toBe('1:02:05');
    expect(momentStart(momentLabel(3, 3_725_000, 3_730_000))).toBe(3_725_000);
  });
});


describe('source retry cooldown', () => {
  it('keeps retry disabled until the entire native cooldown has elapsed', () => {
    const retryAt = 46_000;
    expect(retrySeconds(retryAt, 0)).toBe(46);
    expect(retrySeconds(retryAt, 45_001)).toBe(1);
    expect(retrySeconds(retryAt, 46_000)).toBe(0);
    expect(retrySeconds(retryAt, 70_000)).toBe(0);
  });

  it('accepts older bridge snapshots without a cooldown', () => {
    for (const value of [undefined, null, NaN, Infinity, 0]) expect(retrySeconds(value, 100)).toBe(0);
  });
});

describe('findWorkStream — أول مصدر يطابق يكفي', () => {
  afterEach(() => {
    delete globalThis.Capacitor;
  });

  /** محرك وهمي: كل مصدر يرد بعد زمنه، و`searchDone` بعد أبطئهم. */
  function fakeEngine(plan) {
    const listeners = {};
    const asked = [];
    globalThis.Capacitor = { Plugins: { AnimeEngine: {
      configure: async () => ({ ok: true, errors: [] }),
      addListener: async (name, fn) => {
        (listeners[name] ??= new Set()).add(fn);
        return { remove() { listeners[name].delete(fn); } };
      },
      searchStream: async ({ query, searchId }) => {
        asked.push(query);
        const hits = plan[query] ?? [];
        let last = 0;
        for (const h of hits) {
          last = Math.max(last, h.after);
          setTimeout(() => { for (const fn of listeners.searchHit ?? []) fn({ searchId, sourceId: h.sourceId, items: h.items, ms: h.after }); }, h.after);
        }
        setTimeout(() => { for (const fn of listeners.searchDone ?? []) fn({ searchId }); }, last + 1);
        return { searchId };
      },
    } } };
    return { asked };
  }
  const copy = (sourceId, title) => ({ sourceId, url: `/${sourceId}/${title}`, title });

  it('ReZero romaji matches immediately while the English query is stalled', async () => {
    vi.useFakeTimers();
    try {
      const { configure: cfg, findWorkStream } = await import('./anime-engine.js');
      const english = 'Re:ZERO -Starting Life in Another World- Season 4';
      const romaji = 'Re:Zero kara Hajimeru Isekai Seikatsu 4th Season';
      fakeEngine({ [english]: [{ sourceId: 'slow', items: [], after: 12000 }], [romaji]: [{ sourceId: 'shahiid', items: [copy('shahiid', romaji)], after: 3 }] });
      await cfg({ force: true, fetchImpl: async () => ({ json: async () => ({ sources: [] }) }) });
      let result;
      void findWorkStream([english, romaji], () => {}, { year: 2026 }).then((w) => { result = w; });
      await vi.advanceTimersByTimeAsync(10);
      expect(result?.copies[0].sourceId).toBe('shahiid');
    } finally { vi.useRealTimers(); }
  });

  it('skipped or failed sources cannot be reported as proof the anime is absent', async () => {
    const { configure: cfg, findWorkStream } = await import('./anime-engine.js');
    const events = new Map();
    globalThis.Capacitor = { Plugins: { AnimeEngine: {
      configure: async () => ({ ok: true }), addListener: async (e, fn) => { events.set(e, fn); return { remove() {} }; },
      searchStream: async ({ searchId }) => { queueMicrotask(() => {
        events.get('searchHit')({ searchId, sourceId: 'shahiid', items: [], skipped: true, error: 'لم يرد خلال 12 ثانية' });
        events.get('searchDone')({ searchId });
      }); return { searchId }; },
    } } };
    await cfg({ force: true, fetchImpl: async () => ({ json: async () => ({ sources: [] }) }) });
    await expect(findWorkStream(['Re:Zero'])).rejects.toThrow('تعذّر');
  });

  it('resolves on the first matching source and reports later copies', async () => {
    const { configure: cfg, findWorkStream } = await import('./anime-engine.js');
    fakeEngine({ 'One Piece': [{ sourceId: 'wit', items: [copy('wit', 'One Piece')], after: 5 }, { sourceId: 'ok', items: [copy('ok', 'ONE PIECE')], after: 60 }] });
    await cfg({ force: true, fetchImpl: async () => ({ json: async () => ({ sources: [] }) }) });
    const later = new Promise((r) => {
      const t0 = Date.now();
      void findWorkStream(['One Piece'], r).then((w) => {
        expect(Date.now() - t0).toBeLessThan(50);
        expect(w.copies.map((c) => c.sourceId)).toEqual(['wit']);
      });
    });
    expect((await later).copies.map((c) => c.sourceId)).toEqual(['wit', 'ok']);
  });

  it('searches the two leading aliases together without weakening title matching', async () => {
    const { configure: cfg, findWorkStream } = await import('./anime-engine.js');
    const { asked } = fakeEngine({ 'Shingeki no Kyojin': [{ sourceId: 'wit', items: [copy('wit', 'Attack on Titan')], after: 2 }], 'Attack on Titan': [{ sourceId: 'wit', items: [copy('wit', 'Attack on Titan')], after: 2 }] });
    await cfg({ force: true, fetchImpl: async () => ({ json: async () => ({ sources: [] }) }) });
    const w = await findWorkStream(['Shingeki no Kyojin', 'Attack on Titan']);
    // «Attack on Titan» يطابق العنوان الثاني من نتائج الاستعلام الأول نفسه
    expect(w.title).toBe('Attack on Titan');
    expect(asked).toEqual(['Shingeki no Kyojin', 'Attack on Titan']);
  });

  it('refuses a weak match and returns null when nothing matches', async () => {
    const { configure: cfg, findWorkStream, pickCopies } = await import('./anime-engine.js');
    expect(pickCopies([copy('a', 'Naruto Shippuden')], ['Naruto: The Movie Special Edition'])).toBe(null);
    fakeEngine({ Bleach: [{ sourceId: 'a', items: [copy('a', 'Black Clover')], after: 1 }] });
    await cfg({ force: true, fetchImpl: async () => ({ json: async () => ({ sources: [] }) }) });
    expect(await findWorkStream(['Bleach'])).toBe(null);
  });
});

describe('شاهد اللقطة', () => {
  it('يقرأ مدى اللحظة من عنوانها', async () => {
    const { momentRange, momentLabel } = await import('./anime-engine.js');
    expect(momentRange(momentLabel(12, 730_000, 750_000))).toEqual({ startMs: 730_000, endMs: 750_000 });
    expect(momentRange('الحلقة 3 · 1:02:10–1:02:30')).toEqual({ startMs: 3_730_000, endMs: 3_750_000 });
    expect(momentRange('الحلقة 3')).toBeNull();
    expect(momentRange('الحلقة 3 · 2:00–1:00')).toBeNull();
  });
});
