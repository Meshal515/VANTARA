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
