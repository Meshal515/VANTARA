import { publicUrl } from "./manifest.js";
import { plainObject, boundedItems } from "./contracts.js";
const cleanText = (value, max = 2000) => typeof value === "string" ? value.replace(/[\x00-\x1f]/g, " ").slice(0, max) : null;
function requestHeaders(value) {
  if (value == null) return {};
  if (!plainObject(value) || Object.keys(value).length > 32) throw new Error("headers");
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]{1,80}$/i.test(key) || typeof val !== "string" || val.length > 8192 || /[\x00-\x1f\x7f]/.test(val) ||
      /^(host|connection|content-length|transfer-encoding|proxy-authorization|proxy-connection)$/i.test(key)) throw new Error("headers");
    out[key] = val;
  }
  return out;
}
function torrentFields(stream) {
  let magnet = null, infoHash = stream.infoHash;
  if (typeof stream.url === "string" && stream.url.startsWith("magnet:")) {
    const uri = new URL(stream.url);
    if (stream.url.length > 16000) throw new Error("magnet");
    const hash = uri.searchParams.getAll("xt").map(x => /^urn:btih:([a-f\d]{40})$/i.exec(x)?.[1]).find(Boolean);
    if (!hash || infoHash && String(infoHash).toLowerCase() !== hash.toLowerCase()) throw new Error("magnet");
    infoHash = hash;
    magnet = stream.url;
  }
  if (typeof infoHash !== "string" || !/^[a-f\d]{40}$/i.test(infoHash) || stream.fileIdx != null && (!Number.isSafeInteger(stream.fileIdx) || stream.fileIdx < 0)) throw new Error("torrent");
  const sources = (Array.isArray(stream.sources) ? stream.sources : []).slice(0, 100).filter(x => typeof x === "string" && x.length <= 2000 && !/[\x00-\x1f]/.test(x) && /^(tracker:(?:https?|udp):\/\/|dht:[a-f\d]{40}$)/i.test(x));
  return { infoHash: infoHash.toLowerCase(), magnet, fileIdx: stream.fileIdx ?? null, sources };
}
export function normalizeStreams(raw, { addonKey, now = Date.now(), runtimeName = "pwa", torrentSupported = false } = {}) {
  return boundedItems(raw).map((s, index) => {
    const base = {
      id: `${addonKey}|${index}`,
      addonKey,
      quality: null,
      hdr: null,
      subtitles: [],
      status: "UNSUPPORTED",
      reason: "نوع Stream غير مدعوم على هذه المنصة",
    };
    if (!plainObject(s)) return { ...base, reason: "بيانات Stream غير صالحة" };
    if (s.externalUrl) return { ...base, reason: "هذه النتيجة تفتح موقعًا خارجيًا ولا توفر رابط فيديو مباشرًا" };
    const native = runtimeName === "apk";
    const torrent = s.infoHash != null || typeof s.url === "string" && s.url.startsWith("magnet:");
    if (s.ytId || s.nzbUrl || s.archiveUrl || (!native && s.behaviorHints?.notWebReady && !torrent))
      return base;
    let url, torrentData;
    try {
      if (torrent) torrentData = torrentFields(s);
      else url = publicUrl(s.url);
    } catch {
      return { ...base, reason: torrent ? "بيانات التورنت غير صالحة" : "رابط الفيديو غير مسموح" };
    }
    const hint = String(s.name ?? "") + " " + String(s.title ?? "");
    const quality =
      Number.isInteger(s.quality) && s.quality >= 144 && s.quality <= 4320
        ? s.quality
        : (() => {
            const m = /\b(2160|1440|1080|720|480|360)p?\b/i.exec(hint);
            return m ? Number(m[1]) : /\b4k\b/i.test(hint) ? 2160 : null;
          })();
    const expiresAt = Number.isFinite(s.expiresAt)
      ? s.expiresAt
      : (() => {
          for (const k of ["expires", "exp", "e"]) {
            const n = Number(url?.searchParams.get(k));
            if (n > 1000000000 && n < 100000000000) return n * 1000;
          }
          return null;
        })();
    const subtitles = (Array.isArray(s.subtitles) ? s.subtitles : [])
      .slice(0, 100)
      .flatMap((t, i) => {
        try {
          return [
            {
              id: String(t.id ?? i),
              url: publicUrl(t.url).href,
              lang: String(t.lang ?? t.language ?? "und"),
              label: String(t.label ?? t.lang ?? "ترجمة"),
            },
          ];
        } catch {
          return [];
        }
      });
    let headers;
    try { headers = { ...requestHeaders(s.headers), ...requestHeaders(s.behaviorHints?.proxyHeaders?.request) }; }
    catch { return { ...base, reason: "رؤوس الفيديو غير صالحة" }; }
    const needsHeaders = Object.keys(headers).length > 0 || Boolean(s.behaviorHints?.proxyHeaders?.response);
    const responseHeaders = s.behaviorHints?.proxyHeaders?.response;
    const needsResponseTransform = native && responseHeaders != null &&
      (!plainObject(responseHeaders) || Object.keys(responseHeaders).some(key => !/^access-control-/i.test(key)));
    const unavailableTorrent = torrent && !(native && torrentSupported);
    const unsupported = unavailableTorrent || needsResponseTransform || (!native && needsHeaders);
    return {
      ...base,
      ...(torrentData ?? { url: url.href }),
      name: cleanText(s.name, 160),
      title: cleanText(s.title ?? s.description),
      headers: native ? headers : {},
      type:
        torrent ? "torrent" : s.type === "hls" || /\.m3u8(?:\?|$)/i.test(url.href)
          ? "hls"
          : s.type === "dash" || /\.mpd(?:\?|$)/i.test(url.href)
            ? "dash"
            : "mp4",
      quality,
      qualitySource: quality ? "advertised" : null,
      hdr: s.hdr === true || /\bHDR(?:10|10\+)?\b/i.test(hint) ? true : null,
      filename: typeof (s.filename ?? s.behaviorHints?.filename) === "string" ? (s.filename ?? s.behaviorHints.filename).slice(0, 2000) : null,
      videoHash: /^[a-fA-F0-9]{16}$/.test(s.behaviorHints?.videoHash ?? "") ? s.behaviorHints.videoHash : null,
      videoSize: Number.isSafeInteger(s.behaviorHints?.videoSize) && s.behaviorHints.videoSize > 0 ? s.behaviorHints.videoSize : null,
      duration: Number.isFinite(s.duration) ? s.duration : null,
      fps: Number.isFinite(s.fps) ? s.fps : null,
      subtitles,
      expiresAt,
      status:
        expiresAt && expiresAt <= now
          ? "EXPIRED"
          : unsupported
            ? "UNSUPPORTED"
            : "RESOLVED",
      reason: unavailableTorrent
        ? native ? "محرك التورنت غير متاح في هذه النسخة؛ استخدم رابطًا مباشرًا أو حدّث APK" : "تشغيل التورنت المباشر يحتاج APK أو خدمة تحولّه إلى فيديو مباشر"
        : needsResponseTransform ? "هذه النتيجة تحتاج تعديل استجابة الفيديو غير المدعوم في المشغل الحالي"
        : !native && needsHeaders
        ? "هذا Stream يتطلب رؤوس HTTP لا يدعمها تشغيل PWA الحالي"
        : expiresAt && expiresAt <= now
          ? "انتهت صلاحية الرابط"
          : null,
    };
  });
}
