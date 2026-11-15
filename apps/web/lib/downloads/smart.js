/**
 * «التحميل الذكي»: أي سيرفر يُنزَّل منه، بترتيب يزن ما يهم الملف المحفوظ لا التشغيل الفوري.
 *
 * التشغيل يفضّل ما يبدأ أسرع؛ التنزيل يفضّل ما يكتمل سليمًا:
 *   1. الجودة الحقيقية واكتمال الملف (الدقة المعلنة ثم ما يكشفه الفحص: الحجم والترميز).
 *   2. استقرار المصدر وسرعته (الفحص نجح، زمن الرد).
 *   3. دعم الاستئناف (Range للملف المباشر، مقاطع HLS، قطع التورنت).
 *   4. توافق الملف مع المشغّل (MP4/MKV/HLS نعم، DASH لاحقًا، صفحات الويب لا).
 *
 * الوضع اليدوي لا يمر من هنا: سيرفر اختاره المستخدم يُلتزم به، وإن تعذّر يفشل بسببه
 * ولا يُستبدل بغيره دون إذنه. ولا تُخلط روابط مصدرين داخل عملية واحدة.
 */

/** الحاويات التي يحفظها محرك التنزيل الأصلي ويشغّلها Media3/mpv من القرص. */
export const SAVABLE = new Set(['MP4', 'MKV', 'WEBM', 'HLS', 'TORRENT']);

const QUALITY_SCORE = (q) => {
  const v = Number(q);
  if (!Number.isFinite(v) || v <= 0) return 0.35; // مجهولة: لا نعاقبها كأنها 360p ولا نرفعها كأنها 1080p
  if (v >= 2000) return 0.92; // 4K: ممتاز لكن ثقيل على التخزين والجهاز، 1080p يسبقه افتراضيًا
  if (v >= 1000) return 1;
  if (v >= 700) return 0.8;
  if (v >= 480) return 0.55;
  return 0.3;
};

/** السيرفر الجاهز وحده يُنزَّل منه؛ «يُجهَّز» ينتظر و«تعذّر» يُستبعد. */
export function isDownloadReady(route) {
  return route?.state === 'READY' && route.probed !== false;
}

export function isTorrent(route) {
  return route?.type === 'torrent';
}

/**
 * درجة سيرفر للتنزيل (0..~3). `platform.torrent`: هل يحفظ هذا الجهاز تورنت كاملًا.
 * `prefer.quality`: الجودة المطلوبة من الورقة (null = الأفضل المتاح).
 */
export function scoreRoute(route, { platform = {}, prefer = {} } = {}) {
  if (!isDownloadReady(route)) return -Infinity;
  if (isTorrent(route) && !platform.torrent) return -Infinity;
  const q = Number(route.quality);
  let quality = QUALITY_SCORE(q);
  if (prefer.quality && Number.isFinite(q)) quality = 1 - Math.min(1, Math.abs(q - prefer.quality) / 1500);
  const probed = route.probed === true ? 0.5 : 0.2;
  const latency = Number.isFinite(route.probeMs) ? Math.max(0, 0.3 - Math.min(0.3, route.probeMs / 10000)) : 0.1;
  // التورنت يكمل ويستأنف بالقطع، لكنه يعتمد على المشاركين: يأتي بعد المباشر الجيد لا قبله
  const transport = isTorrent(route) ? 0.25 : 0.4;
  const variant = prefer.variant && route.variant === prefer.variant ? 0.3 : route.variant === 'UNKNOWN' ? 0.1 : 0;
  return quality * 1.5 + probed + latency + transport + variant;
}

/** ترتيب الجاهز للتنزيل: الأعلى درجة أولًا، والتعادل لأقل زمن رد. */
export function rankRoutes(routes, opts = {}) {
  return (routes ?? [])
    .map((r) => ({ r, s: scoreRoute(r, opts) }))
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => b.s - a.s || (a.r.probeMs ?? Infinity) - (b.r.probeMs ?? Infinity))
    .map((x) => x.r);
}

/**
 * حكم فحص المرشّح قبل الحفظ (من المحرك الأصلي: HEAD/أول بايتات). يرجع null إن صلح،
 * أو رمز سبب عدم الدعم: لا نبدأ تنزيل ما نعرف أنه لن يُحفظ سليمًا.
 */
export function unsupportedReason(info) {
  if (!info) return 'NO_ROUTE';
  if (info.drm) return 'DRM';
  const c = String(info.container ?? '').toUpperCase();
  if (c === 'DASH') return 'UNSUPPORTED';
  if (c === 'HTML' || c === 'PAGE') return 'UNSUPPORTED';
  if (c && !SAVABLE.has(c) && c !== 'UNKNOWN') return 'UNSUPPORTED';
  return null;
}

/**
 * مانجا: أي نسخة (مصدر) يُنزَّل منها الفصل. الوضوح والاكتمال قبل السرعة:
 * نسخة فيها الفصل نفسه برقمه، بلغة المستخدم المفضلة، ومن مصدر صفحاته كاملة تاريخيًا.
 */
export function rankMangaRows(rows, { language = 'ar', health = () => null } = {}) {
  return (rows ?? [])
    .map((row) => {
      const h = health(row.sourceId) ?? {};
      const lang = String(row.lang ?? row.language ?? '').toLowerCase();
      const langScore = lang === language ? 1 : lang ? 0.3 : 0.5;
      const ok = Number(h.ok ?? 0);
      const fail = Number(h.fail ?? 0);
      const reliability = ok + fail > 0 ? ok / (ok + fail) : 0.6;
      const scanlated = row.chapter?.scanlator ? 0.1 : 0;
      return { row, s: langScore * 1.2 + reliability + scanlated };
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.row);
}
