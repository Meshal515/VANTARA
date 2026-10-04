import { publicUrl } from "./manifest.js";
import { plainObject, boundedItems } from "./contracts.js";
export function normalizeStreams(raw, { addonKey, now = Date.now() } = {}) {
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
    if (s.infoHash) return { ...base, reason: "رابط تورنت يحتاج خدمة تحولّه إلى رابط فيديو مباشر؛ تشغيل PWA الحالي لا يدعمه" };
    if (s.externalUrl) return { ...base, reason: "هذه النتيجة تفتح موقعًا خارجيًا ولا توفر رابط فيديو مباشرًا" };
    if (s.ytId || s.nzbUrl || s.archiveUrl || s.behaviorHints?.notWebReady)
      return base;
    let url;
    try {
      url = publicUrl(s.url);
    } catch {
      return { ...base, reason: "رابط الفيديو غير مسموح" };
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
            const n = Number(url.searchParams.get(k));
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
    const needsHeaders =
      s.behaviorHints?.proxyHeaders?.request ||
      s.behaviorHints?.proxyHeaders?.response ||
      (s.headers && Object.keys(s.headers).length > 0);
    return {
      ...base,
      url: url.href,
      type:
        s.type === "hls" || /\.m3u8(?:\?|$)/i.test(url.href)
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
          : needsHeaders
            ? "UNSUPPORTED"
            : "RESOLVED",
      reason: needsHeaders
        ? "هذا Stream يتطلب رؤوس HTTP لا يدعمها تشغيل PWA الحالي"
        : expiresAt && expiresAt <= now
          ? "انتهت صلاحية الرابط"
          : null,
    };
  });
}
