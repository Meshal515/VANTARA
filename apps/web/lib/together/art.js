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
const inflight = new Map();
export function aniZipArt(anilistId, { fetchImpl = globalThis.fetch, now = Date.now(), depth = 0 } = {}) {
  const key = `az4-${anilistId}`;
  const hit = cached(key, now);
  if (hit) return Promise.resolve(hit);
  // صفحة العمل وغرفة المشاهدة قد تطلبانه معًا: طلب واحد للاثنين
  if (!inflight.has(key)) inflight.set(key, aniZip(anilistId, fetchImpl, now, depth).finally(() => inflight.delete(key)));
  return inflight.get(key);
}
async function aniZip(anilistId, fetchImpl, now, depth) {
  const key = `az4-${anilistId}`;
  const r = await fetchImpl(`https://api.ani.zip/mappings?anilist_id=${anilistId}`);
  // 404: عمل جديد لم يصل ani.zip بعد — يبقى له Cinemeta والسلسلة أدناه
  const d = r.ok ? await r.json() : null;
  const episodes = {};
  for (const [n, e] of Object.entries(d?.episodes ?? {})) {
    if (!/^\d+$/.test(n)) continue;
    const title = e?.title?.ar ?? e?.title?.en ?? e?.title?.['x-jat'] ?? null;
    // وصف الحلقة وتاريخها ومدتها وتقييمها لورقة السيرفرات (server-sheet.js)
    const rating = Number.parseFloat(e?.rating);
    episodes[n] = {
      image: typeof e?.image === 'string' ? e.image : null,
      // ترقيم TVDB للحلقة (موسم/رقم): به تُطابق صورها عالية الدقة من metahub (anime-art.js)
      season: Number.isInteger(e?.seasonNumber) ? e.seasonNumber : null,
      number: Number.isInteger(e?.episodeNumber) ? e.episodeNumber : null,
      title,
      overview: typeof e?.overview === 'string' && e.overview.trim() ? e.overview.trim() : null,
      airDate: e?.airDate ?? e?.airdate ?? null,
      runtime: Number(e?.runtime ?? e?.length) || null,
      rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    };
  }
  // خلفية TVDB الدعائية التي يرفقها ani.zip نفسه (حتى لعمل بلا IMDb). «Clearlogo» هناك لا
  // يُعتمد: كثيرًا ما يكون أيقونة مربعة بخلفية لا شعارًا شفافًا — الشعار من metahub وحده
  const image = (type) => (Array.isArray(d?.images) ? d.images : []).find((i) => i?.coverType === type && /^https:\/\//.test(i?.url ?? ''))?.url ?? null;
  let imdb = /^tt\d+$/.test(d?.mappings?.imdb_id ?? '') ? d.mappings.imdb_id : null;
  let fanart = image('Fanart');
  // فشل عابر (429، انقطاع) في البحث عن IMDb لا يُحفظ 3 أيام: الفتح التالي يعيد المحاولة
  let settled = true;
  if (!imdb) {
    // اسم العمل وسنته وعلاقاته من AniList (طلب واحد)، حتى لو لم يعرفه ani.zip
    const info = await anilistInfo(anilistId, fetchImpl).catch(() => undefined);
    if (info === undefined) settled = false;
    // جديد بلا IMDb في ani.zip: Cinemeta (مصدر Stremio) يعرفه بالاسم والسنة.
    // موسم/جزء/فيلم تكميلي («Gachiakuta Season 2»): فن السلسلة نفسها من الجزء السابق أو
    // العمل الأم في علاقات AniList — ربط مؤكد بالسلسلة لا تخمين بالاسم.
    // الطريقان معًا لا بالتتابع؛ نتيجة Cinemeta تُقدَّم كما كانت
    const ups = !(depth < 4 && info) ? [] : info.ups.map((id) => aniZipArt(id, { fetchImpl, now, depth: depth + 1 }).catch(() => undefined));
    imdb = await imdbFromCinemeta(searchSpec(d, info), fetchImpl).catch(() => null);
    for (const up of imdb ? [] : ups) {
      const z = await up;
      if (z === undefined) settled = false;
      if (!z?.imdb) continue;
      imdb = z.imdb;
      fanart ??= z.fanart ?? null;
      break;
    }
  }
  if (!d && !imdb) return null;
  const data = { imdb, fanart, episodes };
  if (settled) remember(key, data, now);
  return data;
}

/** اسم العمل وسنته ونوعه، وأجزاؤه الأعلى (العمل الأم ثم السابق) من AniList. */
async function anilistInfo(anilistId, fetchImpl) {
  const r = await fetchImpl('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: 'query($id:Int){Media(id:$id){title{english romaji} format seasonYear startDate{year} relations{edges{relationType node{id type}}}}}',
      variables: { id: Number(anilistId) },
    }),
  });
  // 429/5xx: عابر (undefined عند المستدعي)؛ 404 وما شابه: لا معلومات
  if (r?.status === 429 || r?.status >= 500) throw new Error(`anilist ${r.status}`);
  if (!r?.ok) return null;
  const m = (await r.json())?.data?.Media;
  if (!m) return null;
  const edges = m.relations?.edges ?? [];
  // ALTERNATIVE: نسخة أخرى من القصة نفسها (فيلم تجميعي لموسم مثلًا)
  const ups = ['PARENT', 'PREQUEL', 'ALTERNATIVE'].flatMap((t) => edges.filter((e) => e?.relationType === t && e?.node?.type === 'ANIME').map((e) => e.node.id));
  return { title: m.title ?? {}, format: m.format ?? null, year: m.startDate?.year ?? m.seasonYear ?? null, ups };
}

/** ما يُبحث به في Cinemeta: الأسماء (إنجليزي ثم روماجي) والسنة والنوع. */
const searchSpec = (d, info) => ({
  names: [...new Set([d?.titles?.en, info?.title?.english, d?.titles?.['x-jat'], info?.title?.romaji].filter((t) => typeof t === 'string' && t.trim()))],
  year: info?.year ?? (Number.parseInt(String(d?.episodes?.['1']?.airDate ?? d?.episodes?.['1']?.airdate ?? ''), 10) || null),
  movie: info?.format === 'MOVIE' || d?.episodeCount === 1,
});

const normTitle = (t) => String(t ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * IMDb العمل من بحث Cinemeta: اسم مطابق حرفًا (بعد التطبيع) وسنة العرض ±1.
 * لا تطابق صريح = لا شيء (لا أقرب نتيجة). الفيلم يُبحث في الأفلام أولًا.
 */
export async function imdbFromCinemeta({ names = [], year = null, movie = false } = {}, fetchImpl = globalThis.fetch) {
  const types = movie ? ['movie', 'series'] : ['series', 'movie'];
  // كل البحوث معًا لا واحدًا بعد الآخر (كانت حتى أربع رحلات متتالية قبل أن يظهر بنر عمل جديد)؛
  // الترتيب نفسه يحسم: الاسم الأول والنوع الأول أولًا
  const tries = names.flatMap((name) => types.map((type) => ({ name, type })));
  const found = await Promise.all(tries.map(async ({ name, type }) => {
    try {
      const r = await fetchImpl(`https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(name)}.json`);
      if (!r?.ok) return null;
      const metas = (await r.json())?.metas ?? [];
      const exact = metas.filter((m) => /^tt\d+$/.test(m?.id ?? '') && normTitle(m.name) === normTitle(name));
      const fits = year ? exact.filter((m) => Math.abs((Number.parseInt(m.releaseInfo, 10) || 0) - year) <= 1) : exact.length === 1 ? exact : [];
      return fits[0]?.id ?? null;
    } catch {
      return null;
    }
  }));
  return found.find(Boolean) ?? null;
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
      const z = await aniZipArt(anilist, { fetchImpl, now });
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
