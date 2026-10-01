/**
 * بيانات أعمال VANTARA CINEMA: Cinemeta (قاعدة ستريمو المفتوحة) للبحث والقوائم
 * والمواسم والحلقات، بلا مفتاح ولا حساب. القصة تُعرَّب في الخادم
 * (`/v1/cinema/overviews`) وتُحفظ للجميع. التشغيل نفسه ليس من هنا: من المصادر العربية في
 * محرك التطبيق (`anime-engine.js` بمحتوى `cinema`).
 */

const CINEMETA = 'https://v3-cinemeta.strem.io';

export const GENRES_AR = {
  Action: 'أكشن', Adventure: 'مغامرة', Animation: 'رسوم متحركة', Biography: 'سيرة', Comedy: 'كوميديا', Crime: 'جريمة',
  Documentary: 'وثائقي', Drama: 'دراما', Family: 'عائلي', Fantasy: 'فانتازيا', History: 'تاريخي', Horror: 'رعب',
  Mystery: 'غموض', Romance: 'رومانسي', 'Sci-Fi': 'خيال علمي', Sport: 'رياضة', Thriller: 'إثارة', War: 'حرب', Western: 'غربي',
  Music: 'موسيقى', Musical: 'موسيقي', 'Reality-TV': 'واقع', 'Talk-Show': 'حواري', 'Game-Show': 'مسابقات',
};
export const TYPE_AR = { movie: 'فيلم', series: 'مسلسل' };

async function getJson(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const year = (m) => {
  const y = Number.parseInt(String(m.year ?? m.releaseInfo ?? ''), 10);
  return Number.isFinite(y) ? y : null;
};

/** مواسم مرتبة من `videos` (الموسم 0 = إضافات، في الآخر). */
export function seasonsOf(videos = []) {
  const map = new Map();
  for (const v of videos) {
    const s = Number(v.season);
    const e = Number(v.episode ?? v.number);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (!map.has(s)) map.set(s, []);
    map.get(s).push({
      n: e,
      title: v.name || v.title || null,
      overview: v.overview || v.description || null,
      thumb: v.thumbnail || null,
      released: v.released ? Date.parse(v.released) || null : null,
    });
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === 0) - (b === 0) || a - b)
    .map(([n, eps]) => ({ n, episodes: eps.sort((a, b) => a.n - b.n) }));
}

/** شكل واحد للعمل في كل الواجهة. */
export function normalize(m) {
  if (!m?.id || !/^tt\d+$/.test(String(m.imdb_id ?? m.id))) return null;
  const rating = Number.parseFloat(m.imdbRating);
  return {
    id: String(m.imdb_id ?? m.id),
    type: m.type === 'series' ? 'series' : 'movie',
    title: m.name,
    poster: m.poster || null,
    background: m.background || null,
    logo: m.logo || null,
    year: year(m),
    rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    genres: m.genres ?? m.genre ?? [],
    description: m.description || null,
    runtime: m.runtime || null,
    director: m.director ?? [],
    cast: (m.cast ?? []).slice(0, 8),
    status: m.status || null,
    seasons: m.videos ? seasonsOf(m.videos) : null,
  };
}

/** قائمة: `top` (الأشهر)، `imdbRating` (الأعلى تقييمًا)، `year` (بسنة في `genre`). */
export async function catalog(type, id = 'top', { genre = '', skip = 0, fetchImpl } = {}) {
  const extra = [genre && `genre=${encodeURIComponent(genre)}`, skip && `skip=${skip}`].filter(Boolean).join('&');
  const data = await getJson(`${CINEMETA}/catalog/${type}/${id}${extra ? `/${extra}` : ''}.json`, fetchImpl);
  return (data.metas ?? []).map(normalize).filter(Boolean);
}

export async function search(query, { fetchImpl } = {}) {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const [movies, series] = await Promise.all(
    ['movie', 'series'].map((t) => getJson(`${CINEMETA}/catalog/${t}/top/search=${q}.json`, fetchImpl).then((d) => d.metas ?? []).catch(() => [])),
  );
  // بالتناوب: أفضل فيلم ثم أفضل مسلسل…، لا كل الأفلام قبل أي مسلسل
  const out = [];
  for (let i = 0; i < Math.max(movies.length, series.length); i++) out.push(movies[i], series[i]);
  return out.filter(Boolean).map(normalize).filter(Boolean);
}

export async function detail(type, id, { fetchImpl } = {}) {
  const data = await getJson(`${CINEMETA}/meta/${type}/${id}.json`, fetchImpl);
  return normalize(data.meta);
}

/** أسماء الأعمال تبقى كما هي (الإنجليزية)؛ القصة وحدها تُعرَّب. */
export const displayTitle = (m) => m?.title || '';
