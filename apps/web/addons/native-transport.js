import { publicUrl } from "./manifest.js";
/** الجسر الأصلي فقط؛ لا محاولة fetch ويب داخل APK. */
export function createNativeTransport(
  plugin = globalThis.Capacitor?.Plugins?.AddonEngine,
) {
  if (!plugin?.request || !plugin?.cancel)
    throw new Error("يتطلب تحديث APK الذي يدعم إضافات الترجمة");
  async function text(
    url,
    { signal, limit = 2 * 1024 * 1024, timeout = 15000 } = {},
  ) {
    const requestId = `addon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const abort = () => void plugin.cancel({ requestId }).catch(() => {});
    if (signal?.aborted)
      throw new DOMException("ألغي طلب الإضافة", "AbortError");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const out = await plugin.request({
        url: publicUrl(url).href,
        requestId,
        limit,
        timeout,
      });
      if (signal?.aborted)
        throw new DOMException("ألغي طلب الإضافة", "AbortError");
      return out.text;
    } catch (e) {
      if (signal?.aborted)
        throw new DOMException("ألغي طلب الإضافة", "AbortError");
      throw new Error("تعذر طلب الإضافة أو انتهت مهلته");
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  return {
    text,
    async json(url, options) {
      const raw = await text(url, options);
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error("الإضافة لم تُرجع JSON صالحًا");
      }
    },
  };
}
