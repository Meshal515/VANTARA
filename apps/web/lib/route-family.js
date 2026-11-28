/**
 * The canonical classification for route validity and the episode server sheet.
 * runtimeReady is NOT a transport type: native direct sources also report it.
 */
export const isCloudStreamRoute = (r) => String(r?.sourceId ?? '').startsWith('addon|cs3|');

/** رابط مباشر بإعلان صريح: نوع فيديو، أو بصمة سيرفر ليست تورنت (Debrid عبر Comet/Jackettio يرد HTTP). */
const DIRECT_TYPES = new Set(['hls', 'dash', 'mp4', 'http', 'direct', 'file']);
const directEvidence = (r) => DIRECT_TYPES.has(String(r?.type ?? '').toLowerCase()) ||
  (typeof r?.fingerprint === 'string' && r.fingerprint !== '' && !r.fingerprint.startsWith('btih:'));

export const isTorrentRoute = (r) => r?.type === 'torrent' || Boolean(r?.infoHash || r?.magnet) ||
  (typeof r?.fingerprint === 'string' && r.fingerprint.startsWith('btih:')) ||
  // إضافة Stremio بلا دليل على نوعها تبقى تورنت كما كانت؛ ودليل المباشر يغلب (AW24: روابط Debrid كانت «قيد الفحص» للأبد)
  (String(r?.sourceId ?? '').startsWith('addon|') && !isCloudStreamRoute(r) && !directEvidence(r)) ||
  // Legacy native-route callers without a source identity still identify
  // their torrent runtime by the readiness field. Named direct/CS3 sources
  // never use that fallback, so runtimeReady cannot hide their video rows.
  (r?.sourceId == null && r?.runtimeReady != null);

const sid = (r) => String(r?.sourceId ?? '');
/**
 * هوية المحرك من بيانات الطريق نفسها، بالصيغ التي يعرّفها المحرك الأصلي (AnimeEngine.RUNTIME_SOURCE_PREFIX
 * «addon|cs3|»، وإضافات Stremio «addon|…»، وإضافات Aniyomi المثبتة UserAnime «user-…»)، والنقل (تورنت) أولًا.
 * لا تصنيف بلا دليل: ما لا يطابق شيئًا هويته null ويبقى في «مباشر».
 * [own]: قسم خاص في ورقة السيرفرات بعنوانه وعلامته؛ وإلا يبقى صفه في «مباشر». محرك جديد = صف هنا، لا شرط في الورقة.
 */
export const ROUTE_ENGINES = Object.freeze([
  { id: 'torrent', title: 'تورنت', own: true, match: (r) => isTorrentRoute(r) },
  { id: 'cloudstream', title: 'CloudStream', own: true, match: (r) => isCloudStreamRoute(r) },
  { id: 'stremio', title: 'Stremio', own: false, match: (r) => sid(r).startsWith('addon|') },
  { id: 'aniyomi', title: 'Aniyomi', own: false, match: (r) => sid(r).startsWith('user-') },
]);
export const routeEngine = (r) => ROUTE_ENGINES.find((e) => e.match(r))?.id ?? null;
