import { describe, expect, it } from 'vitest';
import { animeCinemaKey, unifyFeed, unifyWorks } from './unified-identity.js';

// خرائط حقيقية مختصرة (ani.zip / Cinemeta، 2026-11)
const ZIP = {
  1535: { imdb: 'tt0877057', seasons: [1] }, // Death Note — مسلسل كامل موسم واحد
  16498: { imdb: 'tt2560140', seasons: [1] }, // Attack on Titan S1
  20958: { imdb: 'tt2560140', seasons: [2] }, // Attack on Titan S2
  21519: { imdb: 'tt5311514', seasons: [] }, // Your Name. (فيلم)
};
const opts = {
  imdbOfAnilist: (al) => ZIP[al] ?? null,
  seasonsOfImdb: (tt) => ({ tt0877057: 1, tt2560140: 4 })[tt] ?? null,
  animeOfImdb: (tt) => Object.values(ZIP).filter((z) => z.imdb === tt).length,
};
const ids = (out) => out.map((g) => g.sources.map((s) => s.id).join('+'));

describe('unified identity (experimental, not wired into the UI)', () => {
  it('home snapshot: one card per work across sections, in first-appearance order', () => {
    const feed = [
      { section: 'cinema', id: 'tt0877057', kind: 'series' }, // Death Note في كتالوج السينما
      { section: 'anime', id: 'anime:1535', kind: 'TV' },
      { section: 'manga', id: 'ext:death note', ids: { anilist: 30021 } },
      { section: 'anime', id: 'mal:1535', kind: 'TV', ids: { mal: 1535 } }, // MAL 1535 = AniList 1535
      { section: 'anime', id: 'anime:1535', kind: 'TV', ids: { mal: 1535 } },
      { section: 'cinema', id: 'cinema:tt5311514', kind: 'movie' },
      { section: 'anime', id: 'anime:21519', kind: 'MOVIE' },
      { section: 'anime', id: 'anime:16498', kind: 'TV' },
      { section: 'anime', id: 'anime:20958', kind: 'TV' },
      { section: 'cinema', id: 'tt2560140', kind: 'series' },
      { section: 'cinema', id: 'tt0877057', kind: 'movie' }, // فيلم بالمعرّف نفسه؟ نوع آخر = عمل آخر
    ];
    const out = unifyFeed(feed, opts);
    expect(ids(out)).toEqual([
      'tt0877057+anime:1535+mal:1535',
      'ext:death note',
      'cinema:tt5311514+anime:21519',
      'anime:16498',
      'anime:20958',
      'tt2560140',
      'tt0877057',
    ]);
    // العمل المدموج يُفتح بصفحة الأنمي وبنوعه الأصلي
    expect(out[0]).toMatchObject({ section: 'anime', id: 'anime:1535', kind: 'TV' });
    expect(out[2]).toMatchObject({ section: 'anime', kind: 'MOVIE' });
  });

  it('a season card with an explicit cinema season merges only with that season', () => {
    const out = unifyWorks([
      { section: 'anime', id: 'anime:20958', kind: 'TV' },
      { section: 'cinema', id: 'tt2560140', kind: 'series', ids: { imdb: 'tt2560140', season: 2 } },
    ], { ...opts, animeOfImdb: () => 1 });
    expect(ids(out)).toEqual(['anime:20958+tt2560140']);
  });

  it('OVA/SPECIAL and movie↔series never merge across sections', () => {
    expect(animeCinemaKey({ id: 'anime:1535', kind: 'OVA' }, opts)).toBeNull();
    expect(animeCinemaKey({ id: 'anime:21519', kind: 'TV' }, opts)).toBeNull();
  });

  it('manga stays alone even when it shares an AniList id number with an anime', () => {
    const out = unifyWorks([{ section: 'manga', id: 'ext:x', ids: { anilist: 1535 } }, { section: 'anime', id: 'anime:1535', kind: 'TV' }], opts);
    expect(out).toHaveLength(2);
  });

  it('ignores holes and keeps unknown ids as their own works', () => {
    expect(unifyWorks([null, { section: 'anime' }, { section: 'anime', id: 'x' }, { section: 'anime', id: 'x' }])).toHaveLength(1);
  });
});
