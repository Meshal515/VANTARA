import { beforeEach, expect, it } from 'vitest';
import { _resetAnimeImdb, parseAniZip, withImdbEpisode } from './anime-imdb.js';

const RE_ZERO = { mappings: { imdb_id: 'tt5607616' }, episodes: { 1: { seasonNumber: 4, episodeNumber: 1 }, 2: { seasonNumber: 4, episodeNumber: 2 } } };
const fetchOf = (body) => async () => ({ ok: true, json: async () => body });
const id = (episode, extra = {}) => ({ kind: 'anime', canonicalId: 'anime:189046', externalIds: { anilist: 189046, mal: 1 }, episode, ...extra });

beforeEach(() => { _resetAnimeImdb(); globalThis.localStorage?.clear?.(); });

it('يضيف IMDb والموسم لحلقة رقمها في الموسم يطابق رقمها عندنا', async () => {
  const out = await withImdbEpisode(id(2), { fetchImpl: fetchOf(RE_ZERO) });
  expect(out.externalIds.imdb).toBe('tt5607616');
  expect(out.season).toBe(4);
});

it('حلقة ترقيمها في TVDB مختلف (مطلق) لا تُرسل بمعرّف حلقة أخرى', async () => {
  const body = { mappings: { imdb_id: 'tt0388629' }, episodes: { 1100: { seasonNumber: 21, episodeNumber: 208 } } };
  const out = await withImdbEpisode(id(1100), { fetchImpl: fetchOf(body) });
  expect(out.externalIds.imdb).toBeUndefined();
});

it('فيلم أنمي: IMDb وحده، وفشل الشبكة لا يكسر التشغيل', async () => {
  const movie = await withImdbEpisode(id(1, { format: 'MOVIE' }), { fetchImpl: fetchOf({ mappings: { imdb_id: 'tt5311514' } }) });
  expect(movie.externalIds.imdb).toBe('tt5311514');
  _resetAnimeImdb();
  const broken = await withImdbEpisode(id(3), { fetchImpl: async () => { throw new Error('offline'); } });
  expect(broken.externalIds.imdb).toBeUndefined();
});

it('parseAniZip يتجاهل الحلقات الخاصة والمعرّف غير الصالح', () => {
  expect(parseAniZip({ mappings: { imdb_id: 'x' }, episodes: { S1: {}, 1: { seasonNumber: 1, episodeNumber: 1 } } })).toEqual({ imdb: null, episodes: { 1: [1, 1] } });
});
