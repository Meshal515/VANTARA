/** تقييم المانجا من AniList فقط عند مطابقة عنوان العمل نفسه بثقة. */
import { normalizeTitle } from './catalog.js';

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
