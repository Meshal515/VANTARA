/**
 * فن الغرفة: بنر الحلقة وشعار العمل وعنوان الحلقة لشاشة «مشاهدة معًا».
 *
 * ما تعرفه صفحة العمل يُرسل مع الدعوة (`banner`، `logo`، `episodeTitle`). ما ينقص
 * يُكمَّل هنا: الأنمي من ani.zip (AniList ← IMDb ← صورة الحلقة وعنوانها) والشعار من
 * metahub بمعرّف IMDb (نفس مصدر شعارات Stremio). كله مجاني ويسمح بالطلب من المتصفح.
 * لا شعار؟ الاسم الطبيعي يظهر بدلًا منه — لا تخمين.
 */

const CACHE_PREFIX = 'vantara.tgart.';
const TTL_MS = 3 * 24 * 60 * 60_000;

export const logoOfImdb = (imdb) => (/^tt\d+$/.test(imdb ?? '') ? `https://images.metahub.space/logo/medium/${imdb}/img` : null);

/** نوع العمل بكلمة: أنمي / مسلسل / فيلم / مانجا. */
export function mediaKind(media) {
  if (media?.kind === 'manga') return 'مانجا';
  if (media?.kind === 'anime') return 'أنمي';
  if (media?.format === 'movie' || (media?.kind === 'cinema' && media?.season == null && !(media?.episode > 0))) return 'فيلم';
  return 'مسلسل';
}

/** «الحلقة 5» أو «م2 · الحلقة 5» أو «فيلم». */
export function episodeLine(media, episode = media?.episode) {
  if (media?.kind === 'manga') return episode != null ? `الفصل ${episode}` : '';
  if (mediaKind(media) === 'فيلم') return 'فيلم';
  const n = Number(episode);
  if (!(n > 0)) return '';
  return media?.season ? `م${media.season} · الحلقة ${n}` : `الحلقة ${n}`;
}

function cached(key, now) {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return now - v.at >= 0 && now - v.at < TTL_MS ? v.data : null;
  } catch { return null; }
}
function remember(key, data, now) {
  try { globalThis.localStorage?.setItem(CACHE_PREFIX + key, JSON.stringify({ at: now, data })); } catch { /* اختياري */ }
}

/** مختصر ani.zip لعمل واحد: IMDb وصور الحلقات وعناوينها (بلا بقية الرد الكبير). */
async function aniZip(anilistId, fetchImpl, now) {
  const key = `az-${anilistId}`;
  const hit = cached(key, now);
  if (hit) return hit;
  const r = await fetchImpl(`https://api.ani.zip/mappings?anilist_id=${anilistId}`);
  if (!r.ok) return null;
  const d = await r.json();
  const episodes = {};
  for (const [n, e] of Object.entries(d?.episodes ?? {})) {
    if (!/^\d+$/.test(n)) continue;
    const title = e?.title?.ar ?? e?.title?.en ?? e?.title?.['x-jat'] ?? null;
    episodes[n] = { image: typeof e?.image === 'string' ? e.image : null, title };
  }
  const data = { imdb: d?.mappings?.imdb_id ?? null, episodes };
  remember(key, data, now);
  return data;
}

/**
 * @returns {Promise<{banner: string|null, logo: string|null, title: string, episodeTitle: string|null}>}
 */
export async function resolveArt(media, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const art = {
    banner: media?.banner ?? null,
    logo: media?.logo ?? null,
    title: media?.title ?? media?.label ?? '',
    episodeTitle: media?.episodeTitle ?? null,
  };
  try {
    const anilist = media?.kind === 'anime' ? Number(/^anime:(\d+)/.exec(media.seriesRef ?? '')?.[1]) : null;
    if (anilist > 0 && (!art.logo || !art.banner || !art.episodeTitle)) {
      const z = await aniZip(anilist, fetchImpl, now);
      const e = z?.episodes?.[String(media.episode)];
      art.logo ??= logoOfImdb(z?.imdb);
      art.banner ??= e?.image ?? null;
      art.episodeTitle ??= e?.title ?? null;
    }
    if (!art.logo && media?.kind === 'cinema') art.logo = logoOfImdb(/(tt\d+)/.exec(media.seriesRef ?? '')?.[1]);
  } catch {
    // بلا شبكة: البنر والغلاف الذي جاء مع الدعوة يكفيان
  }
  art.banner ??= media?.cover ?? null;
  return art;
}
