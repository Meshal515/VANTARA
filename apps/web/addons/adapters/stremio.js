import { LIMITS, plainObject } from "../contracts.js";
import { publicUrl } from "../manifest.js";
import { normalizeStreams } from "../streams.js";
import { catalogExtras, matchesStremioResource, safeStremioString, StremioError } from "../stremio-model.js";
export function createStremioAdapter({ manifest, manifestUrl, transport }) {
  const endpoint = publicUrl(manifestUrl);
  function resource(name, type, id, extra = {}) {
    if (manifest.configuration?.required && !manifest.configuration.configured)
      throw new StremioError("CONFIG_REQUIRED", name);
    if (!matchesStremioResource(manifest, name, type, id)) throw new StremioError("UNSUPPORTED_RESOURCE", name);
    if (!plainObject(extra) || Object.keys(extra).length > 50 || Object.entries(extra).some(([key, value]) =>
      !safeStremioString(key, 80) || (value != null && (!["string", "number", "boolean"].includes(typeof value) || String(value).length > 2000 || (typeof value === "number" && !Number.isFinite(value)))))) throw new StremioError("INVALID_EXTRA", name);
    if (name === "catalog") {
      const catalog = manifest.catalogs.find((c) => c.type === type && c.id === id);
      for (const rule of catalogExtras(catalog)) {
        const value = extra[rule.name];
        if (rule.isRequired && (value == null || String(value).trim() === "")) throw new StremioError("REQUIRED_EXTRA", name);
        if (value != null && rule.options?.length && !rule.options.includes(String(value))) throw new StremioError("INVALID_EXTRA", name);
      }
    }
    const url = new URL(endpoint);
    url.hash = "";
    const args = new URLSearchParams(
      Object.entries(extra)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    url.pathname =
      endpoint.pathname.replace(/\/manifest\.json\/?$/, "") +
      `/${name}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${args ? "/" + args : ""}.json`;
    return url.href;
  }
  async function request(name, { type, id, extra = {}, signal }) {
    const url = resource(name, type, id, extra);
    let out;
    try {
      out = await transport.json(url, { signal, timeout: name === "stream" ? 45000 : name === "catalog" || name === "meta" ? 30000 : 15000 });
    } catch (error) {
      if (error?.name === "AbortError") throw new StremioError("ABORTED", name, { name: "AbortError" });
      if (error?.name === "TimeoutError") throw new StremioError("TIMEOUT", name, { name: "TimeoutError" });
      const status = typeof error?.status === "number" && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined;
      throw new StremioError(status ? `HTTP_${status}` : "REQUEST_FAILED", name, { status });
    }
    if (!plainObject(out)) throw new StremioError("INVALID_RESPONSE", name);
    const code = out.error ?? out.err ?? out.code;
    if (code === "config_required" || code?.code === "config_required") throw new StremioError("CONFIG_REQUIRED", name);
    if (code != null) throw new StremioError("PROVIDER_ERROR", name);
    return out;
  }
  function items(value, resource, transform = (item) => item) {
    if (!Array.isArray(value) || value.length > LIMITS.items) throw new StremioError("INVALID_RESPONSE", resource);
    const result = value.filter(plainObject).map(transform).filter(Boolean);
    if (value.length && !result.length) throw new StremioError("INVALID_RESPONSE", resource);
    return result;
  }
  async function catalog({ type, id, extra = {}, signal }) {
    const out = await request("catalog", { type, id, extra, signal });
    return items(out.metas, "catalog", (item) => safeStremioString(item.id, 2000) && safeStremioString(item.name, 500) && (item.type == null || safeStremioString(item.type)) ? { ...item, type: item.type ?? type } : null);
  }
  async function meta({ type, id, signal }) {
    const out = await request("meta", { type, id, signal });
    if (
      !plainObject(out.meta) ||
      out.meta.id !== id ||
      (out.meta.type && out.meta.type !== type)
    )
      throw new StremioError("INVALID_RESPONSE", "meta");
    if (out.meta.videos != null && (!Array.isArray(out.meta.videos) || out.meta.videos.length > LIMITS.items)) throw new StremioError("INVALID_RESPONSE", "meta");
    return { ...out.meta, ...(out.meta.videos ? { videos: out.meta.videos.filter((video) => plainObject(video) && safeStremioString(video.id, 2000)) } : {}) };
  }
  async function streams({ type, videoId, signal, onResult }) {
    const out = await request("stream", { type, id: videoId, signal });
    const entries = items(out.streams, "stream", (item) =>
      ["url", "infoHash", "ytId", "externalUrl", "nzbUrl"].some((key) => typeof item[key] === "string" && item[key].trim().length) ||
      ["rarUrls", "zipUrls", "7zipUrls", "tgzUrls", "tarUrls"].some((key) => Array.isArray(item[key]) && item[key].length) ? item : null);
    const list = normalizeStreams(entries, { addonKey: manifest.key });
    onResult?.(list);
    return list;
  }
  async function subtitles({ type, videoId, extra = {}, signal }) {
    const out = await request("subtitles", {
      type,
      id: videoId,
      extra,
      signal,
    });
    return items(out.subtitles, "subtitles", (item) => {
      if (!safeStremioString(item.id) || !safeStremioString(item.lang, 80)) return null;
      try { return { ...item, url: publicUrl(item.url).href }; } catch { return null; }
    });
  }
  return { catalog, meta, streams, subtitles };
}
