/**
 * فن العمل من Kitsu بهويته المؤكدة: ربط Kitsu برقم AniList نفسه (mappings)، لا بتشابه العنوان. مصدر رسمي
 * ثانٍ بجانب AniList في قرار الفن الواحد (lib/art.js)، فيُختار الأعلى جودة بين الاثنين بالقواعد نفسها.
 *
 * القياس (Chainsaw Man): غلاف «large» عند Kitsu 550×780 بوزن 84KB مقابل 460×650 و160KB عند AniList، وبنره 3360×800
 * بوزن 111KB مقابل 1900×400. أعلى جودة وأخف معًا. واجهة Kitsu تسمح بالطلب من التطبيق والمتصفح (CORS: *).
 */

const API = 'https://kitsu.io/api/edge/mappings';
const cache = new Map();

/** أكبر نسخة مقيسة الأبعاد من صورة Kitsu (large أولًا: أخف بكثير من original بالمقاس المعروض نفسه). */
function pick(image) {
  if (!image || typeof image !== 'object') return null;
  const dims = image.meta?.dimensions ?? {};
  for (const size of ['large', 'medium', 'small']) {
    const url = image[size];
    const d = dims[size];
    if (typeof url === 'string' && url && d?.width > 0 && d?.height > 0) return { url, width: d.width, height: d.height };
  }
  return typeof image.original === 'string' && image.original ? { url: image.original, width: null, height: null } : null;
}

/**
 * @param {number|string} anilistId رقم العمل في AniList (من مطابقته المؤكدة)
 * @returns {Promise<{ cover: {url:string,width:number|null,height:number|null}|null, banner: {url:string,width:number|null,height:number|null}|null }|null>}
 */
export function kitsuArt(anilistId, { kind = 'manga', fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const id = Number(anilistId);
  if (!Number.isInteger(id) || id <= 0 || typeof fetchImpl !== 'function') return Promise.resolve(null);
  const key = `${kind}:${id}`;
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), timeoutMs);
    try {
      const url = `${API}?filter[externalSite]=anilist/${kind}&filter[externalId]=${id}&include=item`;
      const res = await fetchImpl(url, { headers: { Accept: 'application/vnd.api+json' }, signal: controller?.signal });
      if (!res.ok) throw new Error(`kitsu_${res.status}`);
      const body = await res.json();
      // الربط نفسه يجب أن يخص هذا الرقم وهذا النوع: لا يُقبل عنصر آخر
      const map = (body?.data ?? []).find((m) => m?.attributes?.externalSite === `anilist/${kind}` && String(m?.attributes?.externalId) === String(id));
      const itemId = map?.relationships?.item?.data?.id;
      const item = (body?.included ?? []).find((x) => x?.id === itemId && x?.type === kind);
      if (!item) return null;
      const cover = pick(item.attributes?.posterImage);
      const banner = pick(item.attributes?.coverImage);
      return cover || banner ? { cover, banner } : null;
    } finally {
      clearTimeout(timer);
    }
  })().catch(() => { cache.delete(key); return null; });
  cache.set(key, job);
  return job;
}

/** للاختبارات. */
export function _resetKitsu() { cache.clear(); }
