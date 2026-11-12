/** تقييم المانجا من AniList فقط عند مطابقة عنوان العمل نفسه بثقة. */
import { normalizeTitle } from './catalog.js';
import { adultGenre } from './adult-filter.js';


const MANGA_GENRES = new Set(['Action','Adventure','Comedy','Drama','Ecchi','Fantasy','Horror','Mahou Shoujo','Mecha','Music','Mystery','Psychological','Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller']);
const MANGA_TAGS = { Isekai: 'Isekai', 'Martial Arts': 'Martial Arts', Historical: 'Historical', 'School Life': 'School' };

/** An AniList catalogue item keeps the same identity as the manga home. Actual chapters still use installed sources. */
function mangaMetadata(m) {
  const title = m.title?.english || m.title?.romaji || m.title?.native;
  const key = normalizeTitle(title);
  if (!title || !key) return null;
  return {
    id: `ext:${key}`, title: { english: title, romaji: m.title?.romaji, native: m.title?.native },
    synonyms: m.synonyms ?? [], coverImage: m.coverImage, bannerImage: m.coverImage?.large,
    wideBanner: m.bannerImage ?? null, genres: m.genres ?? [], status: m.status,
    popularity: m.popularity, averageScore: m.averageScore, chapters: m.chapters, staff: { edges: [] },
    _metaId: m.id, _work: { key, title, thumbnailUrl: m.coverImage?.large ?? null, editions: [] },
  };
}

/** True genre/tag catalogue independent of installed manga extensions; never disguise source absence as no manga. */
export async function fetchMangaGenre(genre, { page = 1, fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  if (typeof genre !== 'string' || !genre.trim()) return fetchMangaPopular({page,fetchImpl,timeoutMs});
  const byGenre = MANGA_GENRES.has(genre);
  const value = byGenre ? genre : (MANGA_TAGS[genre] ?? genre);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        query: `query ($page: Int, $value: String) { Page(page: $page, perPage: 24) { pageInfo { hasNextPage }
          media(type: MANGA, sort: POPULARITY_DESC, isAdult: false, format_not: NOVEL, ${byGenre ? 'genre' : 'tag'}: $value) {
            id format title { english romaji native } synonyms coverImage { extraLarge large }
            bannerImage genres popularity averageScore status chapters isAdult
          } } }`,
        variables: { page, value },
      }),
    });
    if (!response.ok) throw new Error(`anilist_genre_${response.status}`);
    const data = (await response.json())?.data?.Page;
    if (!Array.isArray(data?.media)) throw new Error('anilist_genre_no_data');
    const seen = new Set();
    const items = data.media
      .filter((m) => !m.isAdult && !adultGenre(m.genres) && m.format !== 'NOVEL')
      .map(mangaMetadata).filter((m) => m && !seen.has(m.id) && seen.add(m.id));
    return { items, hasNextPage: Boolean(data.pageInfo?.hasNextPage), page };
  } finally { clearTimeout(timer); }
}

/** Global readership, cached by the caller as a stable ranking snapshot. */
export async function fetchMangaPopular({ page = 1, fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ query: `query ($page: Int) { Page(page: $page, perPage: 24) { pageInfo { hasNextPage }
        media(type: MANGA, sort: POPULARITY_DESC, isAdult: false, format_not: NOVEL) { id format title { english romaji native } synonyms
          coverImage { extraLarge large } bannerImage genres popularity averageScore status chapters isAdult } } }`, variables: { page } }),
    });
    if (!response.ok) throw new Error(`anilist_${response.status}`);
    const data = (await response.json())?.data?.Page;
    if (!data?.media) throw new Error('anilist_no_popularity');
    // الرواية الخفيفة ليست بطاقة مانجا: باسم مانجاها نفسه كانت تصير بطاقة ثانية بمرجع واحد
    const items = data.media.filter((m) => !m.isAdult && !adultGenre(m.genres) && m.format !== 'NOVEL').map(mangaMetadata).filter((w, i, all) => w && all.findIndex((x) => x.id === w.id) === i);
    return { items, hasNextPage: Boolean(data.pageInfo?.hasNextPage), page };
  } catch (primaryError) {
    // A provider outage must not turn global popularity back into source ranking.
    const url = `https://kitsu.io/api/edge/manga?sort=-userCount&page[limit]=24&page[offset]=${(page - 1) * 24}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/vnd.api+json' } });
    if (!response.ok) throw primaryError;
    const data = await response.json();
    if (!Array.isArray(data.data)) throw primaryError;
    const items = data.data.filter((m) => m.attributes && !['R18', 'R18+'].includes(m.attributes.ageRating)).map((m) => {
      const a = m.attributes, title = a.titles?.en || a.canonicalTitle, key = normalizeTitle(title);
      const cover = a.posterImage?.original || a.posterImage?.large || a.posterImage?.medium || null;
      return { id: `ext:${key}`, title: { english: title, romaji: a.titles?.en_jp }, coverImage: { large: cover, extraLarge: cover },
        genres: [], status: a.status, popularity: a.userCount, chapters: a.chapterCount, staff: { edges: [] },
        _work: { key, title, thumbnailUrl: cover, editions: [] } };
    }).filter((w) => w.title.english && w._work.key);
    return { items, page, hasNextPage: Boolean(data.links?.next) };
  } finally { clearTimeout(timer); }
}

export function matchMangaRating(title, candidates) {
  const key = normalizeTitle(title);
  if (!key) return null;
  const named = (candidates ?? []).filter((m) =>
    [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms ?? [])]
      .some((candidate) => normalizeTitle(candidate) === key));
  // العمل نفسه (بالاسم، بلا لبس) للكبار في AniList: البطاقة تُحجب لا تُقيَّم
  if (named.length === 1 && (named[0].isAdult || adultGenre(named[0].genres))) return { id: named[0].id, adult: true };
  const matches = named.filter((m) => !m.isAdult);
  if (matches.length !== 1) return null;
  const m = matches[0];
  const score = Number(m.averageScore);
  if (!Number.isFinite(score) || score <= 0 || score > 100) return null;
  return { id: m.id, score: Math.round(score) / 10 };
}

/** استعلام واحد لثمانية عناوين بدل طلب لكل بطاقة، مع مهلة واضحة. */
export async function fetchMangaRatings(titles, { fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  const names = [...new Set(titles.filter(Boolean))].slice(0, 8);
  const output = new Map(names.map((title) => [title, null]));
  if (!names.length) return output;
  const variables = Object.fromEntries(names.map((name, i) => [`q${i}`, name]));
  const args = names.map((_, i) => `$q${i}: String!`).join(', ');
  // بلا isAdult:false: عمل للكبار يجب أن يُعرف فيُحجب، لا أن يختفي من البحث فيبقى في القائمة
  const pages = names.map((_, i) => `p${i}: Page(perPage: 5) { media(search: $q${i}, type: MANGA) { id title { romaji english native } synonyms averageScore isAdult genres } }`).join(' ');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: `query (${args}) { ${pages} }`, variables }), signal: controller.signal,
    });
    if (!response.ok) throw new Error(`anilist_${response.status}`);
    const body = await response.json();
    if (!body?.data) throw new Error('anilist_no_data');
    names.forEach((title, i) => output.set(title, matchMangaRating(title, body.data[`p${i}`]?.media)));
    return output;
  } finally {
    clearTimeout(timer);
  }
}
