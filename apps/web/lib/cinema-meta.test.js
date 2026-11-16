import { describe, expect, it } from 'vitest';
import { detailAnyType, kindOf, normalize, resolveWork } from './cinema-meta.js';
import { mergeWork } from './cinema-identity.js';

// ردود Cinemeta الحية (15 نوفمبر 2026) مختصرة: كل نوع خاطئ يرد بعمل «صالح» الشكل
const EDGERUNNERS_AS_MOVIE = { id: 'tt12590266', imdb_id: 'tt12590266', type: 'movie', name: 'Cyberpunk: Edgerunners', slug: 'series/cyberpunk-edgerunners-12590266', releaseInfo: '2022–',
  videos: [{ id: 'tt12590266:1:1', season: 1, episode: 1 }, { id: 'tt12590266:1:2', season: 1, episode: 2 }] };
const EDGERUNNERS = { ...EDGERUNNERS_AS_MOVIE, type: 'series' };
// Game of Thrones: بذرة فيلم بـslug movie/ بلا حلقات؛ Arcane: عمل آخر بالرقم نفسه في قاعدة الأفلام
const GOT_AS_MOVIE = { id: 'tt0944947', type: 'movie', name: 'Game of Thrones', slug: 'movie/game-of-thrones-0944947' };
const GOT = { id: 'tt0944947', imdb_id: 'tt0944947', type: 'series', name: 'Game of Thrones', slug: 'series/game-of-thrones-0944947', videos: [{ id: 'tt0944947:1:1' }, { id: 'tt0944947:1:2' }, { id: 'tt0944947:2:1' }] };
const ARCANE_AS_MOVIE = { id: 'tt11126994', imdb_id: 'tt11126994', type: 'movie', name: 'De nacht van Aalbers', slug: 'movie/de-nacht-van-aalbers-11126994' };
const ARCANE = { id: 'tt11126994', imdb_id: 'tt11126994', type: 'series', name: 'Arcane', slug: 'series/arcane-11126994', videos: [{ id: 'tt11126994:1:1' }, { id: 'tt11126994:1:2' }] };
const FIGHT_CLUB = { id: 'tt0137523', imdb_id: 'tt0137523', type: 'movie', name: 'Fight Club', slug: 'movie/fight-club-0137523' };
// /meta/series/tt0137523 يرد بعمل آخر تمامًا
const FIGHT_CLUB_AS_SERIES = { id: 'tt0137523', imdb_id: 'tt0137523', type: 'series', name: 'NICK 대하 드라마 파워레인저 와일드포스', slug: 'series/nick-0137523', videos: [{ id: 'tt0137523:1:1', season: 1, episode: 1 }] };

// ردود 16 نوفمبر 2026 الحية (بلاغ المالك: Cyberpunk «فيلم 1938 كوميديا»، Fight Club «مسلسل 2002»):
// رد النوع الخاطئ عمل آخر تمامًا بالرقم نفسه، وslugه بنوعه هو
const I_SEE_ICE = { id: 'tt12590266', imdb_id: 'tt12590266', type: 'movie', name: 'I See Ice', slug: 'movie/i-see-ice-12590266', year: '1938', runtime: '84 min', genres: ['Comedy'], imdbRating: '8.3' };
const EDGERUNNERS_LIVE = { id: 'tt12590266', imdb_id: 'tt12590266', type: 'series', name: 'Cyberpunk: Edgerunners', slug: 'series/cyberpunk-edgerunners-12590266', releaseInfo: '2022–',
  videos: Array.from({ length: 10 }, (_, i) => ({ id: `tt12590266:1:${i + 1}`, season: 1, episode: i + 1 })) };
const NICK = { ...FIGHT_CLUB_AS_SERIES, releaseInfo: '2002–' };

const fakeFetch = (table, { fail = [] } = {}) => async (url) => {
  const key = /\/meta\/(movie|series)\/(tt\d+)\.json/.exec(url)?.slice(1).join('/');
  if (fail.includes(key)) throw new TypeError('Failed to fetch');
  return { ok: true, status: 200, json: async () => ({ meta: table[key] ?? null }) };
};

describe('cinema work type (Cyberpunk filed as a movie)', () => {
  it('the slug wins over the type Cinemeta stamps on a wrong-type request', () => {
    expect(kindOf(EDGERUNNERS_AS_MOVIE)).toBe('series');
    const w = normalize(EDGERUNNERS_AS_MOVIE);
    expect(w.type).toBe('series');
    expect(w.seasons?.[0]?.episodes).toHaveLength(2);
    expect(w.typeCertain).toBe(true);
  });

  it('an unknown type is settled from both answers: a series stays a series, a movie stays a movie', async () => {
    const table = { 'movie/tt12590266': EDGERUNNERS_AS_MOVIE, 'series/tt12590266': EDGERUNNERS, 'movie/tt0137523': FIGHT_CLUB, 'series/tt0137523': FIGHT_CLUB_AS_SERIES };
    const edge = await detailAnyType('tt12590266', { fetchImpl: fakeFetch(table) });
    expect(edge).toMatchObject({ certain: true, work: { type: 'series', title: 'Cyberpunk: Edgerunners' } });
    const fc = await detailAnyType('tt0137523', { fetchImpl: fakeFetch(table) });
    // «مسلسل أولًا» كان يعطي «NICK …» مسلسلًا مكان Fight Club
    expect(fc).toMatchObject({ certain: true, work: { type: 'movie', title: 'Fight Club' } });
  });

  it('a movie stub or a colliding movie never hides a real series (Game of Thrones, Arcane)', async () => {
    const table = { 'movie/tt0944947': GOT_AS_MOVIE, 'series/tt0944947': GOT, 'movie/tt11126994': ARCANE_AS_MOVIE, 'series/tt11126994': ARCANE };
    expect(await detailAnyType('tt0944947', { fetchImpl: fakeFetch(table) })).toMatchObject({ work: { type: 'series', title: 'Game of Thrones' } });
    expect(await detailAnyType('tt11126994', { fetchImpl: fakeFetch(table) })).toMatchObject({ work: { type: 'series', title: 'Arcane' } });
  });

  it('a transient failure is never remembered as the type', async () => {
    const table = { 'movie/tt12590266': EDGERUNNERS_AS_MOVIE };
    const out = await detailAnyType('tt12590266', { fetchImpl: fakeFetch(table, { fail: ['series/tt12590266'] }) });
    // الحكم صحيح من slug، لكنه غير «مؤكد» فلا يُحفظ
    expect(out.work.type).toBe('series');
    expect(out.certain).toBe(false);
  });

  it('a card saved as a movie opens as the series Cinemeta says it is', () => {
    const merged = mergeWork({ id: 'tt12590266', type: 'movie', title: 'Cyberpunk: Edgerunners' }, normalize(EDGERUNNERS));
    expect(merged?.type).toBe('series');
    // نسخة بلا slug لا تُفرض على بطاقة نوعها مختلف
    expect(mergeWork({ id: 'tt1', type: 'series' }, { id: 'tt1', type: 'movie', typeCertain: false })).toBeNull();
  });
});

describe('the wrong-type answer is another work with the same number (16 Nov live answers)', () => {
  const table = { 'movie/tt12590266': I_SEE_ICE, 'series/tt12590266': EDGERUNNERS_LIVE, 'movie/tt0137523': FIGHT_CLUB, 'series/tt0137523': NICK };

  it('Cyberpunk is the series, not «I See Ice» 1938 — even when its card says movie', async () => {
    for (const opts of [{}, { hint: 'movie' }, { title: 'Cyberpunk: Edgerunners', hint: 'movie' }]) {
      const out = await resolveWork('tt12590266', { ...opts, fetchImpl: fakeFetch(table) });
      expect(out).toMatchObject({ certain: true, work: { type: 'series', title: 'Cyberpunk: Edgerunners', year: 2022 } });
    }
    const merged = mergeWork({ id: 'tt12590266', type: 'movie', title: 'Cyberpunk: Edgerunners' }, (await resolveWork('tt12590266', { hint: 'movie', fetchImpl: fakeFetch(table) })).work);
    expect(merged).toMatchObject({ type: 'series', year: 2022 });
    expect(merged.genres).not.toContain('Comedy');
  });

  it('Fight Club is the 1999 movie, not «NICK» 2002 — even when a card or preview asks for a series', async () => {
    for (const opts of [{}, { hint: 'series' }, { title: 'Fight Club', hint: 'series' }]) {
      const out = await resolveWork('tt0137523', { ...opts, fetchImpl: fakeFetch(table) });
      expect(out.work).toMatchObject({ type: 'movie', title: 'Fight Club' });
    }
    // slug «series/» لعمل آخر لم يعد يكفي لجعل الرد «مسلسلًا مؤكدًا»
    expect(normalize(NICK).typeCertain).toBe(false);
  });

  it('the known name settles it when episode counts cannot (a one-episode series under its own name)', async () => {
    const solo = { id: 'tt9', imdb_id: 'tt9', type: 'series', name: 'Short Story', slug: 'series/short-story-9', videos: [{ id: 'tt9:1:1' }] };
    const other = { id: 'tt9', imdb_id: 'tt9', type: 'movie', name: 'Unrelated Film', slug: 'movie/unrelated-film-9' };
    const out = await resolveWork('tt9', { title: 'Short Story', fetchImpl: fakeFetch({ 'series/tt9': solo, 'movie/tt9': other }) });
    expect(out).toMatchObject({ certain: true, work: { type: 'series', title: 'Short Story' } });
  });
});
