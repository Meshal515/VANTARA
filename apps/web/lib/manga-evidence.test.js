import { beforeEach, describe, expect, it } from 'vitest';
import { _reset, isMangaDex, knownEmpty, mangaDexNames, noteEditionChapters, withMangaDexNames } from './manga-evidence.js';

const DEX = 'eu.kanade.tachiyomi.extension.all.mangadex';
const ID = '53f1ec5e-058b-4d18-a23b-2a7dbca5669f';
const API = { data: [{ id: ID, attributes: { title: { 'ko-ro': 'Hoegwihan' }, altTitles: [{ en: "The Regressed Mercenary's Machinations" }, { ko: '회귀한 용병은 다 계획이 있다' }] } }] };

beforeEach(() => _reset());

describe('MangaDex names', () => {
  it('reads every title and alternative title', () => {
    expect(mangaDexNames(API.data[0])).toEqual(['Hoegwihan', "The Regressed Mercenary's Machinations", '회귀한 용병은 다 계획이 있다']);
    expect(isMangaDex(DEX)).toBe(true);
    expect(isMangaDex(`${DEX}@en`)).toBe(true);
    expect(isMangaDex('eu.kanade.tachiyomi.extension.ar.mangalek')).toBe(false);
  });

  it('one request per listing page, then from memory', async () => {
    const asked = [];
    const fetchImpl = async (url) => {
      asked.push(url);
      return { ok: true, json: async () => API };
    };
    const page = { mangas: [{ title: 'Hoegwihan', url: `/manga/${ID}` }] };
    const out = await withMangaDexNames(DEX, page, { fetchImpl });
    expect(out.mangas[0].altNames).toContain("The Regressed Mercenary's Machinations");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`ids%5B%5D=${ID}`);
    await withMangaDexNames(DEX, page, { fetchImpl });
    expect(asked).toHaveLength(1);
  });

  it('other sources, and a failing API, leave the page as it came', async () => {
    const page = { mangas: [{ title: 'x', url: `/manga/${ID}` }] };
    expect(await withMangaDexNames('eu.kanade.tachiyomi.extension.ar.teamx', page, { fetchImpl: () => { throw new Error('never'); } })).toBe(page);
    const out = await withMangaDexNames(DEX, page, { fetchImpl: async () => { throw new Error('offline'); } });
    expect(out.mangas[0].altNames).toBeUndefined();
  });
});

describe('editions with no chapters', () => {
  const work = (...urls) => ({ editions: urls.map((url) => ({ sourceId: DEX, manga: { url } })) });
  it('hidden only when every edition answered empty recently', () => {
    noteEditionChapters(DEX, '/manga/a', 0);
    expect(knownEmpty(work('/manga/a'))).toBe(true);
    expect(knownEmpty(work('/manga/a', '/manga/b'))).toBe(false);
    expect(knownEmpty(work('/manga/a'), (s) => s, Date.now() + 3 * 24 * 3600e3)).toBe(false);
    noteEditionChapters(DEX, '/manga/a', 12);
    expect(knownEmpty(work('/manga/a'))).toBe(false);
    expect(knownEmpty({ editions: [] })).toBe(false);
  });
});
