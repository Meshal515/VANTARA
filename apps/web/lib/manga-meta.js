/** تقييم المانجا من AniList فقط عند مطابقة عنوان العمل نفسه بثقة. */
import { normalizeTitle } from './catalog.js';

/** Global readership, cached by the caller as a stable ranking snapshot. */
export async function fetchMangaPopular({ page = 1, fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ query: `query ($page: Int) { Page(page: $page, perPage: 24) { pageInfo { hasNextPage }
        media(type: MANGA, sort: POPULARITY_DESC, isAdult: false) { id title { english romaji native } synonyms
          coverImage { extraLarge large } genres popularity averageScore status chapters isAdult } } }`, variables: { page } }),
    });
    if (!response.ok) throw new Error(`anilist_${response.status}`);
    const data = (await response.json())?.data?.Page;
    if (!data?.media) throw new Error('anilist_no_popularity');
    const items = data.media.filter((m) => !m.isAdult).map((m) => {
      const title = m.title?.english || m.title?.romaji || m.title?.native;
      const key = normalizeTitle(title);
      return {
        id: `ext:${key}`, title: { english: title, romaji: m.title?.romaji, native: m.title?.native }, synonyms: m.synonyms ?? [],
        coverImage: m.coverImage, bannerImage: m.coverImage?.large, genres: m.genres ?? [], status: m.status,
        popularity: m.popularity, averageScore: m.averageScore, chapters: m.chapters, staff: { edges: [] },
        _metaId: m.id, _work: { key, title, thumbnailUrl: m.coverImage?.large ?? null, editions: [] },
      };
    }).filter((w) => w.title.english && w._work.key);
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
  const matches = (candidates ?? []).filter((m) => !m.isAdult &&
    [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms ?? [])]
      .some((candidate) => normalizeTitle(candidate) === key));
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
  const pages = names.map((_, i) => `p${i}: Page(perPage: 5) { media(search: $q${i}, type: MANGA, isAdult: false) { id title { romaji english native } synonyms averageScore isAdult } }`).join(' ');
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
