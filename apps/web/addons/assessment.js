const RECENT = 7 * 86400000;
const state = (level, label, detail) => ({ level, label, detail });
// These are data-only request adapters. A stream response is not first-frame
// evidence; its HTTP/torrent route is checked by the playback runtime separately.
export const STREMIO_NATIVE_CAPABILITIES = ["catalog", "meta", "streams", "subtitles"];
export function supportedCapabilities(addon, runtimeName = "pwa") {
  if (addon.compatibility?.[runtimeName] === false) return [];
  if (runtimeName === "apk" && !addon.bundled)
    return (addon.capabilities ?? []).filter((cap) =>
      (addon.compatibility?.apkCapabilities ?? (addon.protocol === "stremio" ? STREMIO_NATIVE_CAPABILITIES : [])).includes(cap));
  return addon.capabilities ?? [];
}
export function assessAddon(addon, runtimeName = "pwa", now = Date.now()) {
  if (addon.bundled) return state("builtin", "مدمج", "مصدر أصلي في VANTARA");
  if (addon.enabled === false) return state("disabled", "معطلة", "يمكن تفعيل الإضافة من التفاصيل");
  if (addon.configuration?.required && !addon.configuration.configured)
    return state("configuration", "تحتاج إعدادًا", "أكمل إعداد الخدمة ثم استورد رابطها المعدّ");
  const caps = supportedCapabilities(addon, runtimeName);
  if (!caps.length) return state("unsupported", "غير مدعومة", "لا توجد قدرات مدعومة في هذه المنصة");
  const evidence = caps.map((cap) => {
    const h = addon.health?.[cap];
    return h && (h.version == null || h.version === addon.version) && (h.cacheEpoch == null || h.cacheEpoch === addon.cacheEpoch) ? h : undefined;
  });
  if (evidence.some((h) => h?.state === "configuration"))
    return state("configuration", "تحتاج إعدادًا", "طلبت الخدمة إكمال إعدادها قبل الاستخدام");
  if (evidence.some((h) => h && ["failed", "cooling"].includes(h.state)))
    return state("broken", "تواجه مشكلة", "فشل طلب فعلي لإحدى القدرات؛ افتح التفاصيل لإعادة الفحص");
  if (evidence.every((h) => {
    const at = h && Object.prototype.hasOwnProperty.call(h, "functionalSuccessAt") ? h.functionalSuccessAt : h?.lastSuccessAt;
    return h && ["healthy", "empty"].includes(h.state) &&
      h.version === addon.version && h.cacheEpoch === addon.cacheEpoch &&
      Number.isFinite(at) && at <= now && now - at <= RECENT;
  }))
    return state("stable", "مستقرة", "استجابت كل القدرات المدعومة بنجاح خلال آخر 7 أيام");
  return state("candidate", "مرشحة", "الأدلة الوظيفية الحديثة غير مكتملة؛ التثبيت لا يثبت توفر المحتوى");
}
