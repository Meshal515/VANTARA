/**
 * غلاف عمل المانجا وبنره في صفحة العمل: يُحسم كله في الخفاء ثم يظهر مرة واحدة، فلا يتبدل غلاف أو بنر أمام القارئ.
 *
 * الأولوية (قرار المالك، 12 نوفمبر):
 *   1. المصدر الرئيسي (AniList): الغلاف بأعلى دقة، والبنر العريض الحقيقي.
 *   2. غلاف المصادر والإضافات المثبتة لا يُختار إلا إن كان أعلى جودة فعلًا (بالبكسلات بعد التحميل لا بالرابط).
 *   3. صورة متحركة (GIF) بجودة عالية تتقدم على ثابتة بجودة مقاربة؛ متحركة رديئة لا أولوية لها.
 *   البنر: الحقيقي إن وُجد بعرض كافٍ، وإلا أعلى الأغلفة جودةً (ولو اختلف عن الغلاف الطولي).
 * ما حُسم لعمل يُحفظ على الجهاز، فالفتحة التالية تبدأ منه فورًا.
 */

const KEY = 'vantara.manga.art.v2';
const MAX = 1500;
/**
 * قاعدة البنر في «الملف» (قرار المالك): البنر صورة عريضة مختلفة الشكل عن الغلاف، بجودة عالية فقط:
 * عرض 1200 بكسل فأكثر ونسبة 1.6:1 فأعرض. ما لا يحقق ذلك لا يُعرض بنرًا، ويحل محله أعلى الأغلفة جودة (طبيعي).
 */
export const BANNER_MIN_WIDTH = 1200;
export const BANNER_MIN_RATIO = 1.6;
/** صورة متحركة بهذا العرض فأكثر تُعد عالية الجودة. */
export const GIF_MIN_WIDTH = 400;
/** غلاف مصدر يتقدم على الرسمي فقط إن زادت بكسلاته بهذه النسبة. */
export const SOURCE_MARGIN = 1.3;

let store = null;
function load(storage) {
  if (store) return store;
  try { store = JSON.parse(storage?.getItem(KEY) ?? '{}') ?? {}; } catch { store = {}; }
  return store;
}
export function cachedArt(key, storage = globalThis.localStorage) {
  return key ? load(storage)[key] ?? null : null;
}
export function rememberArt(key, art, storage = globalThis.localStorage) {
  if (!key || !art?.cover) return;
  const all = load(storage);
  delete all[key];
  all[key] = { cover: art.cover, banner: art.banner ?? null, wide: Boolean(art.wide) };
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete all[k];
  try { storage?.setItem(KEY, JSON.stringify(all)); } catch { /* تسريع لا حقيقة */ }
}
/** للاختبارات. */
export function _resetArt() { store = null; }

const isGif = (url) => /\.gif(?:$|[?#])/i.test(String(url ?? ''));

/**
 * درجة صورة محمّلة: بكسلاتها، ومضاعفة للمتحركة العالية الجودة (تتقدم على ثابتة مقاربة)، ونصف للمتحركة الرديئة.
 * @param {{ url: string, width: number, height: number }} m
 */
export function artScore(m) {
  const area = (m?.width || 0) * (m?.height || 0);
  if (!area) return 0;
  if (isGif(m.url)) return m.width >= GIF_MIN_WIDTH ? area * 2 : area * 0.5;
  return area;
}

/**
 * يختار الغلاف من صور محمّلة: الرسمي ما لم يتفوق مصدر بوضوح (SOURCE_MARGIN)، ثم الأعلى درجة بين المصادر.
 * @param {{ url: string, width: number, height: number, official?: boolean }[]} loaded
 */
export function chooseCover(loaded) {
  const ok = (loaded ?? []).filter((m) => m && artScore(m) > 0);
  if (!ok.length) return null;
  const official = ok.filter((m) => m.official).sort((a, b) => artScore(b) - artScore(a))[0] ?? null;
  const source = ok.filter((m) => !m.official).sort((a, b) => artScore(b) - artScore(a))[0] ?? null;
  if (official && (!source || artScore(source) <= artScore(official) * SOURCE_MARGIN)) return official;
  return source ?? official;
}

/**
 * البنر: الحقيقي العريض إن تحمّل بعرض كافٍ، وإلا أعلى غلاف جودةً.
 * @returns {{ url: string, wide: boolean }|null}
 */
export function chooseBanner(banner, loadedCovers) {
  if (banner && banner.width >= BANNER_MIN_WIDTH && banner.width / banner.height >= BANNER_MIN_RATIO) return { url: banner.url, wide: true };
  const best = [...(loadedCovers ?? [])].filter((m) => artScore(m) > 0).sort((a, b) => artScore(b) - artScore(a))[0];
  return best ? { url: best.url, wide: false } : null;
}

/** يحمّل صورة في الخفاء ويعيد أبعادها، أو null عند الفشل أو انتهاء المهلة. */
export function probe(url, timeoutMs = 8000, ImageImpl = globalThis.Image) {
  if (!url || typeof ImageImpl !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new ImageImpl();
    let done = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => end(null), timeoutMs);
    img.decoding = 'async';
    img.onload = () => end(img.naturalWidth > 0 ? { url, width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => end(null);
    img.src = url;
  });
}

/**
 * يحسم غلاف العمل وبنره قبل أي عرض.
 * @param {{ official: Promise<{cover?: string|null, banner?: string|null}|null>, sources: string[], wideHint?: string|null, deadlineMs?: number, probeImpl?: Function }} o
 * @returns {Promise<{ cover: string|null, banner: string|null, wide: boolean }>}
 */
export async function resolveArt({ official, sources = [], wideHint = null, deadlineMs = 6000, probeImpl = probe }) {
  const start = Date.now();
  const left = () => Math.max(500, deadlineMs - (Date.now() - start));
  // الرسمي والمصادر تُجلب معًا: لا ينتظر أحدهما الآخر
  const sourceProbes = [...new Set(sources.filter(Boolean))].slice(0, 4).map((url) => probeImpl(url, left()));
  const off = await Promise.race([official.catch(() => null), new Promise((r) => setTimeout(() => r(null), left()))]);
  const officialCover = off?.cover ? probeImpl(off.cover, left()).then((m) => m && { ...m, official: true }) : Promise.resolve(null);
  const bannerUrl = off?.banner || wideHint || null;
  const bannerProbe = bannerUrl ? probeImpl(bannerUrl, left()) : Promise.resolve(null);
  const [oc, b, ...src] = await Promise.all([officialCover, bannerProbe, ...sourceProbes]);
  const covers = [oc, ...src].filter(Boolean);
  const cover = chooseCover(covers);
  const banner = chooseBanner(b, covers);
  return { cover: cover?.url ?? null, banner: banner?.url ?? null, wide: Boolean(banner?.wide) };
}
