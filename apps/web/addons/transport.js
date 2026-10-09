import { publicUrl } from "./manifest.js";
import { LIMITS } from "./contracts.js";
/** لا VANTARA auth، ولا cookies، ولا redirects تلقائية من manifest مضاف. */
export function createTransport({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  async function text(
    url,
    { signal, limit = LIMITS.resource, timeout = timeoutMs, json = false } = {},
  ) {
    const u = publicUrl(url);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, timeout);
    let reader;
    try {
      const res = await fetchImpl(u.href, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: { accept: json ? "application/json, application/vnd.api+json" : "text/plain" },
        signal: controller.signal,
      });
      if (res.url && new URL(res.url).origin !== u.origin)
        throw new Error("redirect");
      if (!res.ok)
        throw Object.assign(new Error(`HTTP ${res.status}`), {
          status: res.status,
        });
      if (Number(res.headers.get("content-length") ?? 0) > limit)
        throw new RangeError("حجم");
      if (
        json &&
        res.headers.get("content-type") &&
        !/application\/(?:[^;]+\+)?json/i.test(res.headers.get("content-type"))
      )
        throw new Error("content type");
      reader = res.body?.getReader();
      if (!reader) throw new Error("body");
      let size = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new RangeError("حجم");
        chunks.push(value);
      }
      const data = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        data.set(chunk, at);
        at += chunk.length;
      }
      return new TextDecoder().decode(data);
    } catch (e) {
      if (e instanceof RangeError)
        throw new Error("حجم نتيجة الإضافة أكبر من الحد");
      if (controller.signal.aborted)
        throw new DOMException(
          timedOut ? "انتهت مهلة الإضافة" : "ألغي طلب الإضافة",
          timedOut ? "TimeoutError" : "AbortError",
        );
      if (e.status)
        throw Object.assign(new Error(`الإضافة أعادت HTTP ${e.status}`), {
          status: e.status,
        });
      throw new Error(
        "تعذّر الاتصال بالإضافة؛ قد تكون CORS أو حماية أو إعادة توجيه غير مسموحة",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      await reader?.cancel().catch(() => {});
    }
  }
  async function json(url, options = {}) {
    const raw = await text(url, { ...options, json: true });
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("الإضافة لم تُرجع JSON صالحًا");
    }
  }
  return { text, json };
}
