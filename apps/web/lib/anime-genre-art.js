/**
 * وجه لكل نوع في الأنمي: أشهر شخصية من أشهر عمل في النوع (من AniList).
 *
 * بطاقة «أكشن» يطلّ منها ليفاي، و«غموض» يطلّ منها L. طلبٌ واحد يجمع الأنواع كلها
 * (أسماء مستعارة في GraphQL)، ويُحفظ أسبوعين؛ وكل نوع يأخذ شخصية لم يأخذها نوع
 * قبله، فلا يتكرّر الوجه نفسه في الشريط. بلا شبكة تبقى البطاقة بلونها واسمها.
 */

const ENDPOINT = 'https://graphql.anilist.co';
const KEY = 'vantara.anime.genre-art.v1';
const TTL = 14 * 24 * 3600e3;

export function genreArtQuery(genres) {
  return `query { ${genres
    .map((g, i) => `g${i}: Page(perPage: 6) { media(type: ANIME, genre: ${JSON.stringify(g)}, sort: POPULARITY_DESC, isAdult: false) { id characters(perPage: 1, sort: FAVOURITES_DESC) { nodes { id name { full } image { large } } } } }`)
    .join(' ')} }`;
}

/**
 * من ردّ AniList إلى {نوع: {image, name}}: لكل نوع أول شخصية لم تُستعمل لنوع قبله.
 * @param {Record<string, any>} data
 * @param {string[]} genres
 */
export function pickGenreArt(data, genres) {
  const used = new Set();
  const out = {};
  genres.forEach((g, i) => {
    for (const m of data?.[`g${i}`]?.media ?? []) {
      const c = m?.characters?.nodes?.[0];
      const image = c?.image?.large;
      if (!image || /default\.(jpg|png)$/.test(image) || used.has(c.id ?? image)) continue;
      used.add(c.id ?? image);
      out[g] = { image, name: c.name?.full ?? null };
      break;
    }
  });
  return out;
}

const readCache = (now) => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
    return v && now - v.at < TTL && v.art ? v.art : null;
  } catch {
    return null;
  }
};

let inflight = null;
/** وجوه الأنواع: المحفوظ فورًا، وإلا طلب واحد (مشترك بين الرئيسية والبحث). */
export function loadGenreArt(genres, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const hit = readCache(now);
  if (hit && genres.every((g) => g in hit || hit.__none?.includes(g))) return Promise.resolve(hit);
  inflight ??= (async () => {
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: genreArtQuery(genres) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) return hit ?? {};
      const art = pickGenreArt(body.data, genres);
      art.__none = genres.filter((g) => !art[g]);
      try {
        globalThis.localStorage?.setItem(KEY, JSON.stringify({ at: now, art }));
      } catch {
        // اختياري
      }
      return art;
    } catch {
      return hit ?? {};
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** المحفوظ وحده بلا شبكة (للرسم الأول). */
export const cachedGenreArt = (now = Date.now()) => readCache(now) ?? {};
