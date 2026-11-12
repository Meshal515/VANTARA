import { describe, expect, it } from 'vitest';
import { activeFilterCount, airedEpisodes, cleanDescription, compactCount, discoverVariables, emptyFilters, latestEpisodes, normalize, parseDetail, parseHome, relativeAr, seasonOf } from './anime-meta.js';

const media = (over = {}) => ({ id: 1, title: { english: 'A', romaji: 'a' }, coverImage: { large: 'p' }, popularity: 10_000, status: 'FINISHED', episodes: 12, ...over });

describe('anime-meta', () => {
  it('seasons follow AniList months', () => {
    expect(seasonOf(new Date(2026, 0, 5))).toEqual({ season: 'WINTER', year: 2026 });
    expect(seasonOf(new Date(2026, 8, 25))).toEqual({ season: 'SUMMER', year: 2026 });
    expect(seasonOf(new Date(2026, 9, 1))).toEqual({ season: 'FALL', year: 2026 });
  });
  it('aired episodes stop before the next one', () => {
    expect(airedEpisodes(media({ status: 'RELEASING', nextAiringEpisode: { episode: 9 } }))).toBe(8);
    expect(airedEpisodes(media())).toBe(12);
    expect(airedEpisodes(media({ status: 'NOT_YET_RELEASED' }))).toBe(0);
  });
  it('drops adult works', () => expect(normalize(media({ isAdult: true }))).toBeNull());
  it('strips html from descriptions', () => expect(cleanDescription('Hi<br><br><br><i>x</i> (Source: AL)')).toBe('Hi\n\nx'));
  it('latest episodes keep one per work and skip obscure ones', () => {
    const list = latestEpisodes([
      { episode: 3, airingAt: 3, media: media({ id: 1 }) },
      { episode: 2, airingAt: 2, media: media({ id: 1 }) },
      { episode: 1, airingAt: 1, media: media({ id: 2, popularity: 5 }) },
    ]);
    expect(list.map((m) => [m.id, m.episode])).toEqual([[1, 3]]);
  });
  it('hero needs a banner', () => {
    const home = parseHome({ trending: { media: [media({ id: 1 }), media({ id: 2, bannerImage: 'b' })] } });
    expect(home.hero.map((m) => m.id)).toEqual([2]);
  });
  it('relative time reads as Arabic', () => {
    expect(relativeAr(0, 54 * 60_000)).toBe('منذ 54 دقيقة');
    expect(relativeAr(0, 2 * 3_600_000)).toBe('منذ ساعتين');
    expect(relativeAr(2 * 86_400_000, 0)).toBe('بعد يومين');
  });
  it('compact counts', () => {
    expect(compactCount(72_400)).toBe('72K');
    expect(compactCount(1_548_458)).toBe('1.5M');
    expect(compactCount(950)).toBe('950');
  });
});

import { airingWeek, meccaDay } from './anime-meta.js';
import { describe as describe2, expect as expect2, it as it2 } from 'vitest';

describe2('airingWeek — جدول البث', () => {
  const media = (id, popularity = 50000) => ({ id, title: { english: `A${id}` }, coverImage: {}, popularity, genres: [] });
  it2('merges past and upcoming in time order without repeats or unknown shows', () => {
    const week = airingWeek(
      [{ episode: 3, airingAt: 200, media: media(1) }, { episode: 9, airingAt: 100, media: media(2, 10) }],
      [{ episode: 4, airingAt: 900, media: media(1) }, { episode: 3, airingAt: 200, media: media(1) }],
    );
    expect2(week.map((m) => `${m.id}:${m.episode}`)).toEqual(['1:3', '1:4']);
    expect2(week[0].airingAt).toBe(200_000);
  });
  it2('days are counted in Mecca time', () => {
    // 22:30 UTC = 01:30 في مكة من اليوم التالي
    expect2(meccaDay(Date.UTC(2026, 9, 1, 22, 30))).toBe('2026-10-02');
    expect2(meccaDay(Date.UTC(2026, 9, 1, 20, 59))).toBe('2026-10-01');
  });
});

describe('اكتشف: الفلاتر إلى متغيّرات AniList', () => {
  it('بلا شيء: الأشهر، وبكلمة بحث: الأقرب لها ثم الأشهر', () => {
    expect(discoverVariables({}).sort).toEqual(['POPULARITY_DESC']);
    expect(discoverVariables({ search: ' frieren ' })).toMatchObject({ search: 'frieren', sort: ['SEARCH_MATCH', 'POPULARITY_DESC'] });
  });
  it('الأنواع المطلوبة والمستبعدة والشكل والموسم وأقل تقييم والترتيب', () => {
    const v = discoverVariables({ ...emptyFilters(), include: ['Action'], exclude: ['Romance'], formats: ['TV', 'MOVIE'], status: 'FINISHED', year: 2019, season: 'SPRING', minScore: 8, sort: 'score', page: 2 });
    expect(v).toMatchObject({ page: 2, genreIn: ['Action'], genreNotIn: ['Romance'], formatIn: ['TV', 'MOVIE'], status: 'FINISHED', year: 2019, season: 'SPRING', minScore: 79, sort: ['SCORE_DESC'], minPop: 20000 });
    expect(discoverVariables({ sort: 'score', minPop: 40000 }).minPop).toBe(40000);
  });
  it('عدد الفلاتر المفعّلة لا يحسب الترتيب', () => {
    expect(activeFilterCount(emptyFilters())).toBe(0);
    expect(activeFilterCount({ ...emptyFilters(), include: ['A'], exclude: ['B'], minScore: 7, sort: 'score' })).toBe(3);
  });
  it('الشخصيات من التفاصيل: بصورها، بلا الصورة الافتراضية، وصوتها الياباني', () => {
    const d = parseDetail({ Media: { ...media(), characters: { edges: [
      { role: 'MAIN', node: { id: 1, name: { full: 'Frieren' }, image: { large: 'https://img/f.png' } }, voiceActors: [{ name: { full: 'Atsumi Tanezaki' } }] },
      { role: 'SUPPORTING', node: { id: 2, name: { full: 'X' }, image: { large: 'https://s4.anilist.co/file/anilistcdn/character/large/default.jpg' } }, voiceActors: [] },
    ] } } });
    expect(d.characters).toEqual([{ id: 1, name: 'Frieren', image: 'https://img/f.png', main: true, voice: 'Atsumi Tanezaki' }]);
  });
  it('«من نفس العالم»: الأنمي والمانجا المرتبطان بلا الأغاني وظهور الشخصيات، والعلاقات الأساسية كما هي', () => {
    const node = (id, type, format, extra = {}) => ({ id, type, format, title: { english: `W${id}` }, coverImage: { large: `https://img/${id}.jpg` }, ...extra });
    const d = parseDetail({ Media: { ...media(), relations: { edges: [
      { relationType: 'PREQUEL', node: node(10, 'MANGA', 'MANGA') },
      { relationType: 'OTHER', node: node(11, 'ANIME', 'ONA', { bannerImage: 'https://img/b11.jpg', seasonYear: 2026 }) },
      { relationType: 'CHARACTER', node: node(12, 'ANIME', 'MUSIC') },
      { relationType: 'SEQUEL', node: node(13, 'ANIME', 'TV') },
    ] } } });
    expect(d.world.map((w) => [w.id, w.kind, w.relationType])).toEqual([[10, 'manga', 'PREQUEL'], [11, 'anime', 'OTHER'], [13, 'anime', 'SEQUEL']]);
    expect(d.world[1]).toMatchObject({ banner: 'https://img/b11.jpg', year: 2026, relation: 'عمل مرتبط' });
    expect(d.relations.map((r) => r.id)).toEqual([13]);
  });
});
