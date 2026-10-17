import { beforeEach, expect, it } from 'vitest';
import { _resetAnimeImdb, parseAniZip, withImdbEpisode } from './anime-imdb.js';
import { subtitleRequest, subtitleRequests } from '../addons/subtitles.js';

const RE_ZERO = { mappings: { imdb_id: 'tt5607616' }, episodes: { 1: { seasonNumber: 4, episodeNumber: 1 }, 2: { seasonNumber: 4, episodeNumber: 2 } } };
const fetchOf = (body) => async () => ({ ok: true, json: async () => body });
const id = (episode, extra = {}) => ({ kind: 'anime', canonicalId: 'anime:189046', externalIds: { anilist: 189046, mal: 1 }, episode, ...extra });

beforeEach(() => { _resetAnimeImdb(); globalThis.localStorage?.clear?.(); });

it('يضيف IMDb والموسم لحلقة رقمها في الموسم يطابق رقمها عندنا', async () => {
  const out = await withImdbEpisode(id(2), { fetchImpl: fetchOf(RE_ZERO) });
  expect(out.externalIds.imdb).toBe('tt5607616');
  expect(out.season).toBe(4);
});

it('ترقيم TVDB مختلف عن رقمنا (جزء ثانٍ يكمل من 13، ومطلق كـOne Piece) يُربط بخريطة الحلقات لا يُرفض', async () => {
  const mushoku = { mappings: { imdb_id: 'tt13293588' }, episodes: { 1: { seasonNumber: 2, episodeNumber: 13, absoluteEpisodeNumber: 38 }, 2: { seasonNumber: 2, episodeNumber: 14, absoluteEpisodeNumber: 39 } } };
  const out = await withImdbEpisode(id(1), { fetchImpl: fetchOf(mushoku) });
  expect(out.externalIds.imdb).toBe('tt13293588');
  expect(out.season).toBe(2);
  expect(subtitleRequests(out).map(r => r.videoId)).toEqual(['tt13293588:2:13', 'tt13293588:1:38']);
  // الحلقة التالية في المشغّل نفسه تأخذ عنوانها من الخريطة
  expect(subtitleRequest({ ...out, episode: 2 }).videoId).toBe('tt13293588:2:14');
  _resetAnimeImdb();
  const onePiece = { mappings: { imdb_id: 'tt0388629' }, episodes: { 62: { seasonNumber: 5, episodeNumber: 2, absoluteEpisodeNumber: 62 } } };
  const op = await withImdbEpisode(id(62), { fetchImpl: fetchOf(onePiece) });
  expect(subtitleRequests(op).map(r => r.videoId)).toEqual(['tt0388629:5:2', 'tt0388629:1:62']);
});

it('لا يُستبدل IMDb معروف بآخر، ولا يُعاد الربط لهوية مربوطة', async () => {
  const other = await withImdbEpisode(id(2, { externalIds: { anilist: 189046, imdb: 'tt1' } }), { fetchImpl: fetchOf(RE_ZERO) });
  expect(other.externalIds.imdb).toBe('tt1');
  expect(other.imdbEpisodes).toBeUndefined();
  const same = await withImdbEpisode(id(2, { externalIds: { anilist: 189046, imdb: 'tt5607616' } }), { fetchImpl: fetchOf(RE_ZERO) });
  expect(same.season).toBe(4);
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
