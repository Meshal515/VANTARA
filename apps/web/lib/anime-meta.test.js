import { describe, expect, it } from 'vitest';
import { airedEpisodes, cleanDescription, compactCount, latestEpisodes, normalize, parseHome, relativeAr, seasonOf } from './anime-meta.js';

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
