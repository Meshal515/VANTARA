/**
 * ترجمات الإضافات للأنمي: إضافات الترجمة (OpenSubtitles وأشباهها) لا تعرف الحلقة
 * إلا بمعرّف IMDb + الموسم + رقم الحلقة في الموسم، والأنمي يصلنا بمعرّفات AniList/Kitsu
 * فقط، فكانت ترجع لا شيء بينما المسلسلات تعمل. ani.zip يربط AniList ← IMDb ويعطي لكل
 * حلقة موسمها ورقمها في TVDB. نُضيف IMDb والموسم فقط حين يطابق رقم الحلقة في الموسم
 * رقمها عندنا (لا تخمين: حلقة لا نعرف موسمها لا تُرسل بمعرّف قد يكون لحلقة أخرى).
 */
const KEY = 'vantara.anime.imdb.v1.';
const TTL_MS = 7 * 86_400_000;
const memory = new Map();

export function parseAniZip(d) {
  const imdb = /^tt\d+$/.test(d?.mappings?.imdb_id ?? '') ? d.mappings.imdb_id : null;
  const episodes = {};
  for (const [n, e] of Object.entries(d?.episodes ?? {})) {
    if (!/^\d+$/.test(n)) continue;
    const season = Number(e?.seasonNumber);
    const number = Number(e?.episodeNumber);
    if (Number.isInteger(season) && season >= 0 && Number.isInteger(number) && number > 0) episodes[n] = [season, number];
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

/** هوية الترجمة للأنمي + IMDb والموسم إن عُرفا يقينًا لهذه الحلقة. لا ترمي أبدًا. */
export async function withImdbEpisode(identity, opts = {}) {
  if (identity?.kind !== 'anime' || identity.externalIds?.imdb) return identity;
  const anilist = Number(identity.externalIds?.anilist);
  const episode = Number(identity.episode);
  if (!(anilist > 0)) return identity;
  const m = await mapping(anilist, opts);
  if (!m?.imdb) return identity;
  if (identity.format === 'MOVIE') return { ...identity, externalIds: { ...identity.externalIds, imdb: m.imdb } };
  const hit = m.episodes[String(episode)];
  if (!hit || hit[1] !== episode) return identity;
  return { ...identity, season: hit[0], externalIds: { ...identity.externalIds, imdb: m.imdb } };
}

export const _resetAnimeImdb = () => memory.clear();
