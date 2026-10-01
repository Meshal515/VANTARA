/** Public movie metadata, never a playback source. No API key or signed stream cache. */
const BASE = 'https://v3-cinemeta.strem.io';
const cache = new Map();
const flights = new Map();
export function canonicalTitle(value) {
  return String(value ?? '').replace(/^(?:فيلم|مسلسل|برنامج)\s+/u, '')
    .replace(/\s+(?:الموسم|الحلقة)\s+.*$/u, '')
    .replace(/\s*(?:مترجم|مدبلج|اون لاين|أون لاين|كامل|مشاهدة).*$/u, '').replace(/\s+\b(?:19|20)\d{2}\b\s*$/u, '').trim();
}
export const foldTitle = (s) => canonicalTitle(s).normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function sameWork(a, b) {
  return a.type === b.type && foldTitle(a.title) === foldTitle(b.title) && Boolean(a.year && b.year && Number(a.year) === Number(b.year));
}
/** Tuktuk preserves the original TMDB artwork hash in its resized filename. */
export function artworkURL(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'tuktukhd.com') {
      const hash = /\/([A-Za-z0-9]{26,27})(?:-\d+)?-\d+x\d+\.(?:webp|jpg)$/i.exec(parsed.pathname)?.[1];
      if (hash) return `https://image.tmdb.org/t/p/w500/${hash}.jpg`;
    }
  } catch {}
  return url;
}
export function normalizeSource(anime) {
  const type = anime.mediaType === 'movie' || anime.mediaType === 'series' ? anime.mediaType : /^(?:مسلسل|برنامج)\s|\/(?:series|serie|season|episode)\//u.test(`${anime.title} ${anime.url}`) ? 'series' : 'movie';
  const title = canonicalTitle(anime.title) || anime.title;
  const year = anime.year ?? (Number(/\b((?:19|20)\d{2})\b/u.exec(anime.title)?.[1]) || null);
  return { id: `source:${anime.sourceId}:${anime.url}`, type, title, year, poster: anime.thumbnail, banner: null, description: anime.description, genres: anime.genres ?? [], copies: [anime], native: true };
}
export function normalizeMeta(m) {
  return { id: m.id, type: m.type, title: m.name, year: Number(String(m.releaseInfo ?? '').slice(0, 4)) || null, poster: m.poster, banner: m.background, description: m.description, genres: m.genres ?? [], rating: m.imdbRating, runtime: m.runtime, cast: m.cast ?? [], videos: m.videos ?? [], native: false };
}
async function request(path, fetchImpl = globalThis.fetch) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < 600_000) return cached.value;
  if (flights.has(path)) return flights.get(path);
  const job = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetchImpl(`${BASE}${path}`, { signal: controller.signal });
      if (!response.ok) throw new Error('تعذّر تحميل دليل السينما');
      const value = await response.json();
      cache.set(path, { at: Date.now(), value });
      return value;
    } finally { clearTimeout(timer); }
  })().finally(() => flights.delete(path));
  flights.set(path, job);
  return job;
}
export async function catalog(type = 'movie', { query = '', genre = '', skip = 0, fetchImpl } = {}) {
  if (!['movie', 'series'].includes(type)) throw new Error('نوع العمل غير صالح');
  const extra = [query && `search=${encodeURIComponent(query)}`, genre && `genre=${encodeURIComponent(genre)}`, skip && `skip=${skip}`].filter(Boolean).join('&');
  const data = await request(`/catalog/${type}/top${extra ? `/${extra}` : ''}.json`, fetchImpl);
  return (data.metas ?? []).map(normalizeMeta);
}
export async function detail(type, id, fetchImpl) {
  if (!['movie', 'series'].includes(type) || !/^tt\d+$/.test(id)) return null;
  const data = await request(`/meta/${type}/${id}.json`, fetchImpl);
  return data.meta ? normalizeMeta(data.meta) : null;
}
export async function enrich(work) {
  const found = (await catalog(work.type, { query: work.title })).find((x) => sameWork(work, x));
  if (!found) return work;
  const full = await detail(found.type, found.id);
  return full ? { ...work, ...full, id: work.id, copies: work.copies, native: true, imdbId: full.id } : work;
}
