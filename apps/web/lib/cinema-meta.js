/**
 * بيانات أعمال VANTARA CINEMA: Cinemeta (قاعدة ستريمو المفتوحة) للبحث والقوائم
 * والمواسم والحلقات، وWikidata للعنوان والوصف العربيين بنفس رقم IMDb.
 *
 * كلاهما بلا مفتاح ولا حساب. التشغيل نفسه ليس من هنا: من المصادر العربية في
 * محرك التطبيق (`anime-engine.js` بمحتوى `cinema`).
 */

const CINEMETA = 'https://v3-cinemeta.strem.io';
const SPARQL = 'https://query.wikidata.org/sparql';
const AR_KEY = 'vantara.cinema.ar.v1';

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
    titleAr: null,
    poster: m.poster || null,
    background: m.background || null,
    logo: m.logo || null,
    year: year(m),
    rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    genres: m.genres ?? m.genre ?? [],
    description: m.description || null,
    descriptionAr: null,
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

// ───────────── العربية من Wikidata ─────────────

const memory = new Map();
function stored() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(AR_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function store(all) {
  try {
    const keys = Object.keys(all);
    // آخر 1500 عمل يكفي؛ الأقدم يُعاد جلبه إن احتيج
    for (const k of keys.slice(0, Math.max(0, keys.length - 1500))) delete all[k];
    globalThis.localStorage?.setItem(AR_KEY, JSON.stringify(all));
  } catch {
    // تخزين ممتلئ أو ممنوع: الذاكرة تكفي لهذه الجلسة
  }
}

/** {tt…: {t, d}} للأرقام المطلوبة. ما لا عربي له يُحفظ فارغًا فلا يُسأل عنه كل مرة. */
export async function arabic(ids, { fetchImpl = globalThis.fetch } = {}) {
  const disk = stored();
  const out = {};
  const missing = [];
  for (const id of new Set(ids)) {
    const hit = memory.get(id) ?? disk[id];
    if (hit) out[id] = hit;
    else if (/^tt\d+$/.test(id)) missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 60) {
    const chunk = missing.slice(i, i + 60);
    const query = `SELECT ?imdb ?l ?d WHERE { VALUES ?imdb { ${chunk.map((id) => `"${id}"`).join(' ')} } ?i wdt:P345 ?imdb .
      OPTIONAL { ?i rdfs:label ?l FILTER(LANG(?l) = "ar") } OPTIONAL { ?i schema:description ?d FILTER(LANG(?d) = "ar") } }`;
    try {
      const res = await fetchImpl(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, { headers: { Accept: 'application/sparql-results+json' } });
      if (!res.ok) continue;
      const rows = (await res.json())?.results?.bindings ?? [];
      for (const id of chunk) out[id] = { t: null, d: null };
      for (const r of rows) {
        const id = r.imdb?.value;
        if (!id) continue;
        out[id] = { t: out[id]?.t ?? r.l?.value ?? null, d: out[id]?.d ?? r.d?.value ?? null };
      }
      for (const id of chunk) {
        memory.set(id, out[id]);
        disk[id] = out[id];
      }
    } catch {
      // Wikidata غير متاح: العناوين تبقى كما هي
    }
  }
  if (missing.length) store(disk);
  return out;
}

/** يضيف `titleAr`/`descriptionAr` للأعمال في مكانها، ويرجعها. */
export async function withArabic(items, opts) {
  const list = items.filter(Boolean);
  const ar = await arabic(list.map((m) => m.id), opts).catch(() => ({}));
  for (const m of list) {
    const t = ar[m.id]?.t;
    // اسم عربي فعلي فقط، لا نقل حرفي للاسم اللاتيني نفسه
    if (t && /[؀-ۿ]/.test(t)) m.titleAr = t;
    if (ar[m.id]?.d) m.descriptionAr = ar[m.id].d;
  }
  return list;
}

/** العنوان الظاهر: العربي إن وُجد. */
export const displayTitle = (m) => m?.titleAr || m?.title || '';
