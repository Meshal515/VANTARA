/**
 * انحدار دائم لهوية أعمال السينما: الاسم ليس هوية.
 *
 * البيانات حقيقية من Cinemeta (`tools/fixtures/cinemeta-namesakes.json`): بحث
 * «Shameless» يعيد مسلسل 2011 الأمريكي، و2004 البريطاني، و2017 الروسي (اسمه
 * في التفاصيل «Besstydniki»)، وأفلام 2012 و2010؛ ومعها The Office وHouse of
 * Cards وDune. كل عمل يُفتح من نتيجته يبقى هو نفسه: الاسم والسنة والنوع
 * والملصق والقصة والمواسم ومفتاح المصادر، ولا تقفز مطابقة المصادر إلى أخيه.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLocator } from './cinema-fast.js';
import { matchCriteria, mergeWork, namesakes, seasonYears, workKey } from './cinema-identity.js';
import { explainCopies, pickCopies, queriesFor } from './cinema-match.js';
import { normalize } from './cinema-meta.js';
import { STATE, overallSearchState, playState, searchState } from './source-states.js';

const FIX = JSON.parse(readFileSync(new URL('../../../tools/fixtures/cinemeta-namesakes.json', import.meta.url), 'utf8'));

/** نتائج البحث كما تعرضها شاشة البحث (فيلم ثم مسلسل بالتناوب). */
function searchResults(q) {
  const { movie, series } = FIX.search[q];
  const out = [];
  for (let i = 0; i < Math.max(movie.length, series.length); i++) out.push(movie[i], series[i]);
  return out.filter(Boolean).map(normalize).filter(Boolean);
}
const detailOf = (id) => normalize(FIX.meta[id]);
/** ضغط بطاقة في نتائج البحث ثم وصول التفاصيل: ما تفعله openWork. */
function open(q, id) {
  const card = searchResults(q).find((r) => r.id === id);
  expect(card, `${id} in search "${q}"`).toBeTruthy();
  return { card, work: mergeWork(card, detailOf(id)) };
}

const CASES = [
  // [بحث، معرّف، نوع، اسم ظاهر، سنة، مواسم (بلا الإضافات)]
  ['Shameless', 'tt1586680', 'series', 'Shameless', 2011, 11],
  ['Shameless', 'tt0377260', 'series', 'Shameless', 2004, 11],
  ['Shameless', 'tt4393622', 'series', 'Shameless', 2017, 1],
  ['Shameless', 'tt1927068', 'movie', 'Shameless', 2012, 0],
  ['Shameless', 'tt1711487', 'movie', 'Shameless', 2010, 0],
  ['The Office', 'tt0386676', 'series', 'The Office', 2005, 9],
  ['The Office', 'tt0290978', 'series', 'The Office', 2001, 2],
  ['House of Cards', 'tt1856010', 'series', 'House of Cards', 2013, 6],
  ['House of Cards', 'tt0098825', 'series', 'House of Cards', 1990, 3],
  ['Dune', 'tt1160419', 'movie', 'Dune: Part One', 2021, 0],
  ['Dune', 'tt0087182', 'movie', 'Dune', 1984, 0],
];

describe('search → card → detail keeps the same work', () => {
  for (const [q, id, type, title, year, seasons] of CASES) {
    it(`${title} ${year} (${id})`, () => {
      const { card, work } = open(q, id);
      const full = detailOf(id);
      expect(work.id).toBe(id);
      expect(work.type).toBe(type);
      expect(work.title).toBe(title);
      expect(work.title).toBe(card.title);
      expect(work.year).toBe(year);
      expect(work.description).toBe(full.description);
      expect(work.poster).toBe(full.poster ?? card.poster);
      expect(work.background).toBe(full.background ?? card.background ?? null);
      expect((work.seasons ?? []).filter((s) => s.n !== 0)).toHaveLength(seasons);
      expect(workKey(work)).toBe(`${type}:${id}`);
    });
  }

  it('Besstydniki: the card said "Shameless 2017", the page stays "Shameless 2017", its other name is an alias', () => {
    const { work } = open('Shameless', 'tt4393622');
    expect(work.title).toBe('Shameless');
    expect(work.aliases).toContain('Besstydniki');
    expect(work.year).toBe(2017);
    // الملصق ليس في التفاصيل: يبقى ملصق البطاقة
    expect(work.poster).toBeTruthy();
    // حلقاته بلا «episode» ولا «released» (number وfirstAired): 24 حلقة بتواريخها
    expect(work.seasons[0].episodes).toHaveLength(24);
    expect(new Date(work.seasons[0].episodes[0].released).getUTCFullYear()).toBe(2017);
  });

  it('details for another id or another type are never accepted as this work', () => {
    const us = searchResults('Shameless').find((r) => r.id === 'tt1586680');
    expect(mergeWork(us, detailOf('tt4393622'))).toBeNull();
    expect(mergeWork(us, detailOf('tt0377260'))).toBeNull();
    expect(mergeWork({ ...us, type: 'movie' }, detailOf('tt1586680'))).toBeNull();
  });

  it('every result of a namesake search has its own key; none is keyed by its name', () => {
    for (const q of Object.keys(FIX.search)) {
      const keys = searchResults(q).map(workKey);
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(k).toMatch(/^(movie|series):tt\d+$/);
    }
  });

  it('season years come from the episodes, not the title', () => {
    const us = seasonYears(detailOf('tt1586680'));
    expect(us[1]).toBe(2011);
    expect(us[8]).toBe(2017);
    expect(seasonYears(detailOf('tt0377260'))[1]).toBe(2004);
  });
});

describe('namesakes', () => {
  it('knows the popular one and the others with their years', () => {
    const r = searchResults('Shameless');
    const us = matchCriteria(open('Shameless', 'tt1586680').work, { season: 1, results: r });
    const uk = matchCriteria(open('Shameless', 'tt0377260').work, { season: 1, results: r });
    const ru = matchCriteria(open('Shameless', 'tt4393622').work, { season: 1, results: r });
    expect(us).toMatchObject({ primary: true, sharedNames: ['Shameless'] });
    expect(us.namesakeYears.sort()).toEqual([2004, 2017]);
    expect(uk.primary).toBe(false);
    expect(ru.primary).toBe(false);
    expect(ru.sharedNames).toEqual(['Shameless']);
    // «The Shameless» اسمٌ واحد مع «Shameless» (أداة التعريف لا تميّز): الأحوط أن يُحسب أخًا
    const movies = namesakes(open('Shameless', 'tt1927068').work, r).map((x) => x.id);
    expect(movies[0]).toBe('tt1927068');
    expect(movies).toEqual(expect.arrayContaining(['tt1711487', 'tt1267499', 'tt0152718']));
  });
});

// عناوين حقيقية من ArabSeed وTukTuk لبحث «Shameless» (2026-10)
const c = (sourceId, title) => ({ sourceId, title, url: `/${sourceId}/${encodeURIComponent(title)}` });
const SOURCE_COPIES = [
  c('arabseed', 'مسلسل Shameless الموسم العاشر'),
  c('arabseed', 'مسلسل Shameless الموسم التاسع'),
  c('tuktukcinema', 'مسلسل Shameless الموسم الاول'),
  c('tuktukcinema', 'مسلسل Shameless الموسم الثاني'),
  c('tuktukcinema', 'مسلسل Shameless الموسم 11'),
];

describe('source matching never jumps to a namesake', () => {
  const r = searchResults('Shameless');
  const crit = (id, season = 1) => matchCriteria(open('Shameless', id).work, { season, results: r });

  it('US 2011 season 1 takes the season-1 copy; UK 2004 and Russian 2017 take none of the US copies', () => {
    expect(pickCopies(SOURCE_COPIES, crit('tt1586680', 1)).map((x) => x.title)).toEqual(['مسلسل Shameless الموسم الاول']);
    expect(pickCopies(SOURCE_COPIES, crit('tt0377260', 1))).toEqual([]);
    expect(pickCopies(SOURCE_COPIES, crit('tt4393622', 1))).toEqual([]);
    const why = explainCopies(SOURCE_COPIES, crit('tt4393622', 1)).find((x) => x.copy.title.endsWith('الاول'));
    expect(why).toMatchObject({ ok: false, reason: 'ambiguous' });
  });

  it('a year in the source title decides between namesakes', () => {
    const uk = c('x', 'مسلسل Shameless 2004 الموسم الاول');
    const ru = c('y', 'مسلسل Besstydniki 2017 الموسم الاول');
    expect(pickCopies([uk, ru], crit('tt0377260', 1))).toEqual([uk]);
    expect(pickCopies([uk, ru], crit('tt4393622', 1))).toEqual([ru]);
    expect(pickCopies([uk, ru], crit('tt1586680', 1))).toEqual([]);
    // الموسم الثامن من الأمريكي عُرض 2017: سنة موسمه لا تُرفض لأنها سنة الروسي
    expect(pickCopies([c('z', 'مسلسل Shameless 2017 الموسم الثامن')], crit('tt1586680', 8))).toHaveLength(1);
  });

  it('movies: the 2012 film never takes the 2010 one, and the less known needs its year', () => {
    const m12 = matchCriteria(open('Shameless', 'tt1927068').work, { results: r });
    const m10 = matchCriteria(open('Shameless', 'tt1711487').work, { results: r });
    const copies = [c('a', 'فيلم Shameless 2012 مترجم'), c('b', 'فيلم Shameless 2010 مترجم'), c('d', 'فيلم Shameless مترجم'), c('e', 'مسلسل Shameless الموسم الاول')];
    expect(pickCopies(copies, m12).map((x) => x.sourceId)).toEqual(['a', 'd']);
    expect(pickCopies(copies, m10).map((x) => x.sourceId)).toEqual(['b']);
  });

  it('The Office and House of Cards: the remake and the original stay apart (even with a wrong season date in Cinemeta)', () => {
    const o = searchResults('The Office');
    const us = matchCriteria(open('The Office', 'tt0386676').work, { season: 1, results: o });
    const uk = matchCriteria(open('The Office', 'tt0290978').work, { season: 1, results: o });
    const plain = c('a', 'مسلسل The Office الموسم الاول');
    const dated = c('b', 'مسلسل The Office 2001 الموسم الاول');
    expect(pickCopies([plain, dated], us)).toEqual([plain]);
    expect(pickCopies([plain, dated], uk)).toEqual([dated]);
    const h = searchResults('House of Cards');
    const hoc90 = matchCriteria(open('House of Cards', 'tt0098825').work, { season: 1, results: h });
    expect(pickCopies([c('a', 'مسلسل House of Cards الموسم الاول')], hoc90)).toEqual([]);
  });

  it('Dune: Part One matches "Dune 2021" by its year, never "Dune 1984"', () => {
    const d = searchResults('Dune');
    const p1 = matchCriteria(open('Dune', 'tt1160419').work, { results: d });
    const old = matchCriteria(open('Dune', 'tt0087182').work, { results: d });
    const copies = [c('a', 'فيلم Dune 2021 مترجم'), c('b', 'فيلم Dune 1984 مترجم'), c('d', 'فيلم Dune مترجم'), c('p', 'فيلم Planet Dune 2021 مترجم')];
    expect(pickCopies(copies, p1).map((x) => x.sourceId)).toEqual(['a']);
    expect(pickCopies(copies, old).map((x) => x.sourceId)).toEqual(['b']);
  });

  it('a series name with an extra word is another series (Dark ≠ Dark Hearts, The Office ≠ The Office Movers)', () => {
    const office = matchCriteria(open('The Office', 'tt0386676').work, { season: 1, results: searchResults('The Office') });
    expect(pickCopies([c('arabseed', 'مسلسل The Office Movers الموسم الاول')], office)).toEqual([]);
    const dark = { id: 'tt5753856', type: 'series', title: 'Dark', year: 2017, endYear: 2020, seasons: [] };
    const crit = matchCriteria(dark, { season: 1, results: [dark] });
    const right = c('tuktukcinema', 'مسلسل Dark الموسم الاول');
    expect(pickCopies([c('arabseed', 'مسلسل Dark Hearts الموسم الاول'), right], crit)).toEqual([right]);
    expect(explainCopies([c('arabseed', 'مسلسل Dark Hearts الموسم الاول')], crit)[0].reason).toBe('year-unconfirmed');
  });

  it('series queries ask for the season first (source search by name returns only the latest seasons)', () => {
    expect(queriesFor('Shameless', { type: 'series', season: 1 })[0]).toBe('Shameless الموسم الاول');
    expect(queriesFor('Shameless', { type: 'series', season: 11 })[0]).toBe('Shameless الموسم 11');
    expect(queriesFor('Shameless', { type: 'series', season: 1, aliases: ['Besstydniki'] })).toContain('Besstydniki الموسم الاول');
  });
});

describe('locator: identity end to end, with diagnostic states', () => {
  /** محرك وهمي: كل مصدر يرد بما يرد به الموقع الحقيقي لكل استعلام. */
  function fakeStream(answers) {
    const asked = [];
    return {
      asked,
      searchStream(query, _content, onHit) {
        asked.push(query);
        for (const [sourceId, fn] of Object.entries(answers)) onHit(fn(query, sourceId));
        return { done: Promise.resolve(), cancel() {} };
      },
    };
  }
  const realSites = {
    // ArabSeed: أي استعلام عن Shameless يعيد الموسمين 9 و10 فقط
    arabseed: (q, sourceId) => ({ sourceId, ms: 900, items: /shameless/i.test(q) ? SOURCE_COPIES.filter((x) => x.sourceId === 'arabseed') : [], error: null }),
    // TukTuk: «الموسم الاول» يعيد كل المواسم؛ الاسم وحده 10 و11
    tuktukcinema: (q, sourceId) => ({ sourceId, ms: 1200, items: /الموسم/.test(q) ? SOURCE_COPIES.filter((x) => x.sourceId === 'tuktukcinema') : SOURCE_COPIES.filter((x) => /11/.test(x.title)), error: null }),
    slow: (_q, sourceId) => ({ sourceId, ms: 25_000, items: [], error: 'لم يرد خلال 25 ثانية' }),
  };
  const locatorWith = (stream) =>
    createLocator({ searchStream: stream.searchStream, queries: queriesFor, match: pickCopies, wait: async () => {} });

  it('Shameless 2011 S1: finds the TukTuk season-1 copy; ArabSeed responded without a match; the slow source timed out', async () => {
    const stream = fakeStream(realSites);
    const work = open('Shameless', 'tt1586680').work;
    const h = locatorWith(stream)({ key: 'tt1586680:1', ...matchCriteria(work, { season: 1 }), ready: Promise.resolve(matchCriteria(work, { season: 1, results: searchResults('Shameless') })) });
    const found = await h.done;
    expect(stream.asked[0]).toBe('Shameless الموسم الاول');
    expect(found.copies.map((x) => x.title)).toEqual(['مسلسل Shameless الموسم الاول']);
    expect(searchState(found.sources.tuktukcinema)).toBe(STATE.MATCHED);
    expect(searchState(found.sources.arabseed)).toBe(STATE.SOURCE_RESPONDED_NO_MATCH);
    expect(searchState(found.sources.slow)).toBe(STATE.SOURCE_TIMEOUT);
    expect(h.candidates().length).toBeGreaterThan(found.copies.length);
  });

  it('Besstydniki S1: sources answered, nothing is taken from the US series, and it says so', async () => {
    const stream = fakeStream(realSites);
    const work = open('Shameless', 'tt4393622').work;
    const h = locatorWith(stream)({ key: 'tt4393622:1', ...matchCriteria(work, { season: 1 }), ready: Promise.resolve(matchCriteria(work, { season: 1, results: searchResults('Shameless') })) });
    const found = await h.done;
    expect(found.copies).toEqual([]);
    expect(overallSearchState(found.sources)).toBe(STATE.SOURCE_RESPONDED_NO_MATCH);
    // وبحثٌ باسمه الآخر أيضًا
    expect(stream.asked).toContain('Besstydniki الموسم الاول');
  });
});

describe('diagnostic states', () => {
  it('search states are separate', () => {
    expect(searchState(undefined)).toBe(STATE.SEARCHING);
    expect(searchState({ items: 4, matched: 0, error: null })).toBe(STATE.SOURCE_RESPONDED_NO_MATCH);
    expect(searchState({ items: 0, matched: 0, error: null })).toBe(STATE.SOURCE_RESPONDED_NO_MATCH);
    expect(searchState({ items: 0, matched: 0, error: 'لم يرد في الوقت' })).toBe(STATE.SOURCE_TIMEOUT);
    expect(searchState({ items: 0, matched: 0, error: 'HTTP 403' })).toBe(STATE.SOURCE_ERROR);
    expect(searchState({ items: 0, matched: 0, error: 'في التبريد', skipped: true })).toBe(STATE.SOURCE_ERROR);
    expect(searchState({ items: 3, matched: 1 })).toBe(STATE.MATCHED);
  });
  it('a source that answered is never reported as silent', () => {
    expect(overallSearchState({ a: { items: 2, matched: 0 }, b: { error: 'timeout' } })).toBe(STATE.SOURCE_RESPONDED_NO_MATCH);
    expect(overallSearchState({ b: { error: 'timeout' } })).toBe(STATE.SOURCE_TIMEOUT);
  });
  it('play states: no servers, resolver failed, zero playable, playable', () => {
    expect(playState([], { done: true })).toBe(STATE.NO_SERVER_CANDIDATES);
    expect(playState([], { done: false })).toBe(STATE.SEARCHING);
    expect(playState([{ state: 'FAILED' }, { state: 'UNAVAILABLE' }])).toBe(STATE.RESOLVER_FAILED);
    expect(playState([{ state: 'READY', probed: false }])).toBe(STATE.ZERO_PLAYABLE);
    expect(playState([{ state: 'READY', probed: false }, { state: 'READY', probed: true }])).toBe(STATE.PLAYABLE);
  });
});
