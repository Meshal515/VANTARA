/**
 * The canonical classification for route validity and the episode server sheet.
 * runtimeReady is NOT a transport type: native direct sources also report it.
 */
export const isCloudStreamRoute = (r) => String(r?.sourceId ?? '').startsWith('addon|cs3|');

export const isTorrentRoute = (r) => r?.type === 'torrent' || Boolean(r?.infoHash || r?.magnet) ||
  (String(r?.sourceId ?? '').startsWith('addon|') && !isCloudStreamRoute(r)) ||
  // Legacy native-route callers without a source identity still identify
  // their torrent runtime by the readiness field. Named direct/CS3 sources
  // never use that fallback, so runtimeReady cannot hide their video rows.
  (r?.sourceId == null && r?.runtimeReady != null);
