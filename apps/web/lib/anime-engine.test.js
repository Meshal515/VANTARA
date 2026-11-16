import { afterEach, describe, expect, it, vi } from 'vitest';
import { available, clock, configure, groupRoutes, judgeAnimeCopy, matchingWorkingRoute, momentLabel, momentStart, pickWork, retrySeconds, upsertRoute, withPhaseDeadline } from './anime-engine.js';
import * as engine from './anime-engine.js';

describe('canonical anime identity', () => {
  it.each([
    ['Attack on Titan Season 2', 'Attack on Titan Season 3'],
    ['Re Zero Season 2 Part 1', 'Re Zero Season 2 Part 2'],
    ['The Ancient Magus Bride', 'The Ancient Magus Bride 2'],
    ['Mushoku Tensei II', 'Mushoku Tensei III'],
    ['ون بيس الموسم الثاني', 'ون بيس الموسم الثالث'],
    ['One Piece', 'One Piece Movie'],
  ])('rejects a different edition: %s versus %s', (wanted, title) => {
    expect(judgeAnimeCopy({ title }, [wanted])).toMatchObject({ ok: false, reason: 'sequel' });
  });
  it.each([
    ['Attack on Titan Season 2', 'Attack on Titan 2nd Season'],
    ['Mushoku Tensei II', 'Mushoku Tensei Season 2'],
    ['Kaiju No. 8', 'Kaiju No. 8 (TV)'],
    ['86', '86 (TV)'],
    ['ون بيس Season 2', 'ون بيس الجزء الثاني'],
  ])('accepts equivalent edition spelling: %s versus %s', (wanted, title) => {
    expect(judgeAnimeCopy({ title }, [wanted]).ok).toBe(true);
  });
  it('uses known movie format even when the title has no movie suffix', () => {
    expect(judgeAnimeCopy({ title: 'One Piece Movie' }, ['One Piece'], { format: 'MOVIE' }).ok).toBe(true);
    expect(judgeAnimeCopy({ title: 'One Piece Movie' }, ['One Piece'], { format: 'TV' }).ok).toBe(false);
  });
  it('does not require a provider to repeat the known movie format in its title', () => {
    expect(judgeAnimeCopy({ title: 'A Silent Voice مترجم' }, ['A Silent Voice'], { format: 'MOVIE' }).ok).toBe(true);
    expect(judgeAnimeCopy({ title: 'A Silent Voice', format: 'TV' }, ['A Silent Voice'], { format: 'MOVIE' }).ok).toBe(false);
  });
});

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
  function fakeEngine(plan, debug = false) {
    const listeners = {};
    const asked = [];
    globalThis.Capacitor = { Plugins: { AnimeEngine: {
      configure: async () => ({ ok: true, errors: [], debug }),
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
          setTimeout(() => { for (const fn of listeners.searchHit ?? []) fn({ ...h, searchId, ms: h.after }); }, h.after);
        }
        setTimeout(() => { for (const fn of listeners.searchDone ?? []) fn({ searchId }); }, last + 1);
        return { searchId };
      },
    } } };
    return { asked };
  }
  const copy = (sourceId, title) => ({ sourceId, url: `/${sourceId}/${title}`, title });

  it('preserves a native page failure in Debug evidence instead of only the generic discovery error', async () => {
    const { findWorkStream } = await import('./anime-engine.js');
    const { discoveryDiagnostics } = await import('./discovery-diagnostics.js');
    fakeEngine({ Example: [{ sourceId: 'source-b', items: [], after: 1, page: 2, error: 'HTTP 522', diagnostic: 'java.net.UnknownHostException: original DNS failure' }] }, true);
    await configure({ force: true, fetchImpl: async () => ({ json: async () => ({ sources: [] }) }) });
    await expect(findWorkStream(['Example'])).rejects.toThrow('تعذّر');
    expect(discoveryDiagnostics().at(-1).events).toContainEqual(expect.objectContaining({ stage: 'source_page', sourceId: 'source-b', page: 2, diagnostic: 'java.net.UnknownHostException: original DNS failure' }));
  });

  it('discovers a source requiring a later alias after another source has matched', async () => {
    vi.useFakeTimers();
    try {
      const { findWorkStream } = await import('./anime-engine.js');
      fakeEngine({ English: [{ sourceId: 'a', items: [copy('a', 'English')], after: 1 }], Arabic: [{ sourceId: 'b', items: [copy('b', 'Arabic')], after: 1 }] });
      await configure({ force: true, fetchImpl: async () => ({ json: async () => ({ sources: [] }) }) });
      const updates = [];
      const first = findWorkStream(['English', 'Romaji', 'Arabic'], w => updates.push(w));
      await vi.advanceTimersByTimeAsync(20);
      expect((await first).copies.map(c => c.sourceId)).toEqual(['a']);
      expect(updates.at(-1)?.copies.map(c => c.sourceId)).toEqual(['a', 'b']);
    } finally { vi.useRealTimers(); }
  });

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

describe('prepare stage timeouts', () => {
  it('returns the original completed value and clears the deadline', async () => {
    await expect(withPhaseDeadline(Promise.resolve({ ok: true }), 100, 'TEST')).resolves.toEqual({ ok: true });
  });
  it('returns a stable error code instead of awaiting an unresponsive bridge forever', async () => {
    await expect(withPhaseDeadline(new Promise(() => {}), 10, 'BRIDGE_STAGE_TIMEOUT')).rejects.toMatchObject({
      code: 'BRIDGE_STAGE_TIMEOUT',
    });
  });
});

describe('seasonAliases: موسم لاحق باسم فرعي يُطابق ترقيم المواقع', () => {
  const s1 = { id: 1, format: 'TV', title: 'Tougen Anki', romaji: 'Tougen Anki', relations: [] };
  const s2 = { id: 2, format: 'TV', title: 'Tougen Anki: Nikko Kegon no Taki-hen', romaji: 'Tougen Anki: Nikkou Kegon no Taki-hen',
    relations: [{ id: 1, format: 'TV', relation: 'الجزء السابق' }, { id: 9, format: 'MOVIE', relation: 'الجزء السابق' }] };
  const detail = (id) => Promise.resolve({ 1: s1 }[id] ?? null);

  it('follows the TV prequel chain to number the season and keeps season 1 out of matching', async () => {
    const a = await engine.seasonAliases(s2, detail);
    expect(a.titles).toEqual(['Tougen Anki Season 2']);
    expect(a.queries).toEqual(['Tougen Anki']);
    const titles = [s2.title, s2.romaji, ...a.titles];
    for (const t of ['Tougen Anki Season 2', 'Tougen Anki 2nd Season', 'Tougen Anki الموسم الثاني', 'tougen anki: nikko kegon no taki-hen'])
      expect(engine.judgeAnimeCopy({ title: t }, titles, { format: 'TV' }).ok, t).toBe(true);
    for (const t of ['Tougen Anki', 'Tougen Anki Season 3'])
      expect(engine.judgeAnimeCopy({ title: t }, titles, { format: 'TV' }).ok, t).toBe(false);
  });

  it('gives nothing when the chain cannot be confirmed or the title already carries its number', async () => {
    expect(await engine.seasonAliases({ ...s2, id: 3 }, () => Promise.reject(new Error('offline')))).toEqual({ titles: [], queries: [] });
    expect(await engine.seasonAliases({ ...s2, id: 4, title: 'Jujutsu Kaisen Season 2', romaji: 'Jujutsu Kaisen 2nd Season' }, detail)).toEqual({ titles: [], queries: [] });
    expect(await engine.seasonAliases(s1, detail)).toEqual({ titles: [], queries: [] });
  });
});

describe('source titles carry episode numbers and site noise (AniList 204650, cs3 diagnostic)', () => {
  const titles = ['TOUGEN ANKI: Nikko Kegon Falls Arc', 'Tougen Anki: Nikko・Kegon no Taki-hen', '桃源暗鬼 日光・華厳の滝編', 'TOUGEN ANKI Season 2', 'Tougen Anki Season 2'];
  const judge = (t) => engine.judgeAnimeCopy({ title: t }, titles, { format: 'TV' });
  it.each([
    'انمي Tougen Anki الموسم الثاني الحلقة 5 مترجمة اون لاين',
    'Tougen Anki الموسم الثاني الحلقة 5',
    'Tougen Anki 2nd Season Episode 5',
    'Tougen Anki Season 2 - Episode 05 English Subbed',
    'مشاهدة انمي Tougen Anki الموسم 2 الحلقة 12 مترجمة',
    '桃源暗鬼 日光・華厳の滝編 第5話',
  ])('accepts the right season: %s', (t) => expect(judge(t).ok).toBe(true));
  it.each([
    'انمي Tougen Anki الحلقة 5 مترجمة',
    'انمي Tougen Anki الموسم الثالث الحلقة 1',
    'Tougen Anki Movie',
    'انمي Kimetsu no Yaiba الموسم الثاني الحلقة 5 مترجمة',
  ])('still refuses another season or another work: %s', (t) => expect(judge(t).ok).toBe(false));
});

it('one copy per source: the series page before episode pages, then the first reply', () => {
  const titles = ['Tougen Anki Season 2'];
  const items = [
    { sourceId: 'cs3', url: '/ep5', title: 'انمي Tougen Anki الموسم الثاني الحلقة 5 مترجمة' },
    { sourceId: 'cs3', url: '/ep4', title: 'انمي Tougen Anki الموسم الثاني الحلقة 4 مترجمة' },
    { sourceId: 'cs3', url: '/series', title: 'Tougen Anki الموسم الثاني' },
    { sourceId: 'rift', url: '/a', title: 'Tougen Anki Season 2' },
  ];
  const work = engine.pickCopies(items, titles, { format: 'TV' });
  expect(work.copies.map((c) => `${c.sourceId}${c.url}`).sort()).toEqual(['cs3/series', 'rift/a']);
  const onlyEpisodes = engine.pickCopies(items.slice(0, 2), titles, { format: 'TV' });
  expect(onlyEpisodes.copies.map((c) => c.url)).toEqual(['/ep5']);
});

describe('أسماء البحث العام: ما تكتبه المواقع العربية، وأربعة على الأكثر', () => {
  it('يُسقط الياباني والكوري والصيني والسيريلي، ويُبقي اللاتيني والعربي بترتيبه بلا تكرار', () => {
    expect(engine.searchQueries(['One Piece', 'ONE PIECE', 'ワンピース', '원피스', '海贼王', 'Ван-Пис', 'ون بيس', 'Wan Pisu'])).toEqual(['One Piece', 'ون بيس', 'Wan Pisu']);
  });
  it('أربعة أسماء على الأكثر: كل اسم بحثٌ كامل في كل مصدر', () => {
    expect(engine.searchQueries(['A1', 'B2', 'C3', 'D4', 'E5', 'F6'])).toEqual(['A1', 'B2', 'C3', 'D4']);
  });
  it('الوسم بين قوسين لا يُرسل للموقع', () => {
    expect(engine.searchQueries(['Jujutsu Kaisen (TV)'])).toEqual(['Jujutsu Kaisen']);
  });
});
