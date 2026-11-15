import { describe, expect, it } from 'vitest';
import { detailAnyType, kindOf, normalize } from './cinema-meta.js';
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
