import { describe, expect, it } from 'vitest';
import { cleanIntent, gatherCandidates } from './rafiq.ts';
import { buildProfile } from './rafiq-profile.ts';

/**
 * جودة المرشّحين قبل النموذج: «زي لوكيسم وقتال شوارع» يجيب قتال مدارس وعصابات،
 * لا دراما رومانسية ولا موسم ثاني ولا فيلم، وتوصيات قرّاء المرجع أولًا.
 */

const media = (id: number, title: string, genres: string[], tags: string[], extra: Record<string, unknown> = {}) => ({
  id, type: 'MANGA', format: 'MANGA', status: 'FINISHED', episodes: null, chapters: 80, averageScore: 80, popularity: 40000, genres, isAdult: false,
  seasonYear: null, startDate: { year: 2020 }, countryOfOrigin: 'KR', title: { romaji: title, english: title, native: null }, synonyms: [],
  coverImage: { large: null, extraLarge: null, color: null }, bannerImage: null, description: `${title}.`,
  tags: tags.map((name, i) => ({ name, rank: 90 - i * 5, isMediaSpoiler: false, isGeneralSpoiler: false })), relations: { edges: [] }, ...extra,
});

const LOOKISM = media(1, 'Lookism', ['Action', 'Comedy', 'Drama'], ['Delinquents', 'Bullying', 'School', 'Gangs', 'Fist Fighting', 'Full Color']);
const REC = [media(10, 'Viral Hit', ['Action', 'Comedy'], ['Delinquents', 'Fist Fighting', 'School']), media(11, 'Weak Hero', ['Action', 'Drama'], ['Bullying', 'Delinquents', 'School'])];
const PAGE = [
  media(20, 'Study Group', ['Action', 'Comedy'], ['Delinquents', 'School', 'Martial Arts']),
  media(21, 'Girls Drama Love', ['Drama', 'Romance'], ['School', 'Female Protagonist']),
  media(22, 'Viral Hit Season 2', ['Action'], ['Delinquents', 'Fist Fighting']),
  media(23, 'Street Punch The Movie', ['Action'], ['Delinquents', 'Fist Fighting'], { format: 'MOVIE' }),
  media(24, 'Quiet Cafe', ['Slice of Life'], ['Food']),
];

const fakeAniList: typeof fetch = async (_url, init) => {
  const q = String(JSON.parse(String(init?.body)).query);
  if (q.includes('recommendations')) return Response.json({ data: { Media: { recommendations: { nodes: REC.map((m) => ({ mediaRecommendation: m })) } } } });
  if (q.includes('Media(search')) return Response.json({ data: { Media: LOOKISM } });
  return Response.json({ data: { Page: { media: PAGE } } });
};

describe('rafiq retrieval', () => {
  it('«زي لوكيسم وقتال شوارع»: fights and delinquents first, no romance, sequels or movies', async () => {
    const profile = buildProfile([], [], Date.now());
    const pool = await gatherCandidates(
      null as never,
      fakeAniList,
      cleanIntent({ intent: 'similar', format: 'MANGA', country: 'KR', references: ['Lookism'], genres_in: ['Action'], genres_out: ['Romance', 'Slice of Life'], tags_in: ['Delinquents', 'Fist Fighting', 'School'] }),
      { profile, works: [], prefs: [] },
      [],
      [],
      Date.now(),
    );
    const titles = pool.map((c) => c.title);
    expect(titles.slice(0, 2).sort()).toEqual(['Viral Hit', 'Weak Hero']);
    expect(titles).toContain('Study Group');
    for (const bad of ['Girls Drama Love', 'Viral Hit Season 2', 'Street Punch The Movie', 'Quiet Cafe', 'Lookism']) expect(titles).not.toContain(bad);
    expect(pool[0]!.matches).toEqual(expect.arrayContaining(['Delinquents']));
    expect(pool[0]!.matches).not.toContain('Full Color');
  });

  it('an open request in the anime section asks the catalog for anime', async () => {
    const asked: string[] = [];
    const spy: typeof fetch = async (url, init) => {
      asked.push(String(JSON.parse(String(init?.body)).variables?.type ?? ''));
      return fakeAniList(url, init);
    };
    await gatherCandidates(null as never, spy, cleanIntent({ intent: 'recommend' }), { profile: buildProfile([], [], Date.now()), works: [], prefs: [] }, [], [], Date.now(), 'ANIME');
    expect(asked.filter(Boolean).every((t) => t === 'ANIME')).toBe(true);
  });
});
