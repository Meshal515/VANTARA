/**
 * ترجمات الإضافات للأنمي: إضافات الترجمة (OpenSubtitles وأشباهها) لا تعرف الحلقة
 * إلا بمعرّف IMDb + الموسم + رقم الحلقة في الموسم، كما في المسلسلات تمامًا، والأنمي يصلنا
 * بمعرّفات AniList/Kitsu ورقم الحلقة داخل عمله فقط. ani.zip يربط AniList ← IMDb ويعطي لكل
 * حلقة موسمها ورقمها في TVDB ورقمها المطلق. نحمل الخريطة نفسها مع الهوية (لا موسم الحلقة
 * الأولى وحده) فيعرف المشغّل عنوان كل حلقة، حتى «التالية» وحلقة عبرت حدّ الموسم.
 * كان الربط يُرفض متى اختلف رقم TVDB عن رقمنا (Mushoku Tensei 2 تبدأ من 13، Spy x Family
 * الجزء الثاني، One Piece بالمطلق) فلا تصل هذه الأعمال أي ترجمة.
 */
import { animeImdbAddresses } from '../addons/subtitles.js';

const KEY = 'vantara.anime.imdb.v2.';
const WINDOW = 400;
const TTL_MS = 7 * 86_400_000;
const memory = new Map();

export function parseAniZip(d) {
  const imdb = /^tt\d+$/.test(d?.mappings?.imdb_id ?? '') ? d.mappings.imdb_id : null;
  const episodes = {};
  for (const [n, e] of Object.entries(d?.episodes ?? {})) {
    if (!/^\d+$/.test(n)) continue;
    const season = Number(e?.seasonNumber);
    const number = Number(e?.episodeNumber);
    const absolute = Number(e?.absoluteEpisodeNumber);
    if (Number.isInteger(season) && season >= 0 && Number.isInteger(number) && number > 0) episodes[n] = Number.isInteger(absolute) && absolute > 0 ? [season, number, absolute] : [season, number];
  }
  return { imdb, episodes };
}

async function mapping(anilistId, { fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = 4000 } = {}) {
  const id = String(anilistId);
  if (memory.has(id)) return memory.get(id);
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY + id) ?? 'null');
    if (raw && now - raw.at < TTL_MS) { memory.set(id, raw.data); return raw.data; }
  } catch { /* تخزين غير متاح */ }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`https://api.ani.zip/mappings?anilist_id=${encodeURIComponent(id)}`, { signal: ctrl?.signal });
    if (!r?.ok) return null;
    const data = parseAniZip(await r.json());
    memory.set(id, data);
    try { globalThis.localStorage?.setItem(KEY + id, JSON.stringify({ at: now, data })); } catch { /* اختياري */ }
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** خريطة حول الحلقة الحالية فقط: One Piece يتجاوز 1100 حلقة ولا داعي لحملها كلها إلى المشغّل. */
function around(episodes, episode) {
  const keys = Object.keys(episodes);
  if (keys.length <= WINDOW) return episodes;
  const near = keys.sort((a, b) => Math.abs(a - episode) - Math.abs(b - episode)).slice(0, WINDOW);
  return Object.fromEntries(near.map((k) => [k, episodes[k]]));
}

/**
 * هوية الترجمة للأنمي + IMDb وخريطة حلقاته (imdbEpisodes) والموسم للحلقة الحالية.
 * عمل بلا IMDb في ani.zip أو IMDb يخالف ما عندنا يبقى كما هو. لا ترمي أبدًا.
 */
export async function withImdbEpisode(identity, opts = {}) {
  if (identity?.kind !== 'anime') return identity;
  const known = identity.externalIds?.imdb ?? null;
  if (known && (identity.format === 'MOVIE' || identity.imdbEpisodes)) return identity;
  const anilist = Number(identity.externalIds?.anilist);
  const episode = Number(identity.episode);
  if (!(anilist > 0)) return identity;
  const m = await mapping(anilist, opts);
  if (!m?.imdb || (known && known !== m.imdb)) return identity;
  if (identity.format === 'MOVIE') return { ...identity, externalIds: { ...identity.externalIds, imdb: m.imdb } };
  if (!Object.keys(m.episodes).length) return identity;
  const imdbEpisodes = around(m.episodes, episode);
  const [first] = animeImdbAddresses(imdbEpisodes, episode);
  return { ...identity, ...(first ? { season: first[0] } : {}), imdbEpisodes, externalIds: { ...identity.externalIds, imdb: m.imdb } };
}

export const _resetAnimeImdb = () => memory.clear();
