import { boundedItems } from "../contracts.js";
import { publicUrl } from "../manifest.js";
import { normalizeStreams } from "../streams.js";
export function createStremioAdapter({ manifest, manifestUrl, transport }) {
  const endpoint = publicUrl(manifestUrl);
  function resource(name, type, id, extra = {}) {
    const rules = manifest.resources.filter((r) => r.name === name);
    if (
      !rules.some(
        (r) =>
          (r.types ?? manifest.types).includes(type) &&
          (name === "catalog" ||
            !(r.idPrefixes ?? manifest.idPrefixes).length ||
            (r.idPrefixes ?? manifest.idPrefixes).some((p) =>
              id.startsWith(p),
            )),
      )
    )
      throw new Error("هذه القدرة أو هوية العمل غير مدعومة من الإضافة");
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
    return transport.json(resource(name, type, id, extra), {
      signal,
      timeout:
        name === "stream"
          ? 45000
          : name === "catalog" || name === "meta"
            ? 30000
            : 15000,
    });
  }
  async function catalog({ type, id, extra = {}, signal }) {
    const out = await request("catalog", { type, id, extra, signal });
    return boundedItems(out.metas);
  }
  async function meta({ type, id, signal }) {
    const out = await request("meta", { type, id, signal });
    if (
      !out.meta ||
      out.meta.id !== id ||
      (out.meta.type && out.meta.type !== type)
    )
      throw new Error("الإضافة أعادت تفاصيل عمل مختلف");
    return out.meta;
  }
  async function streams({ type, videoId, signal, onResult }) {
    const out = await request("stream", { type, id: videoId, signal });
    const list = normalizeStreams(out.streams, { addonKey: manifest.key });
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
    return boundedItems(out.subtitles);
  }
  return { catalog, meta, streams, subtitles };
}
