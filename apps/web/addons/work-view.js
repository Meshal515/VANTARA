import { readTitle } from "../lib/cinema-match.js";
import { normalizeWork } from "./identity.js";
import { toV35Work } from "../v35/works.js";
/** المصدر الذي اختاره الشخص نسخة صريحة؛ لا بحث بالاسم لتغييرها من تحت اختياره. */
export function sourceWorkModel(item, { addon, episodes = [] }) {
  const single = addon.contentTypes.length === 1 ? addon.contentTypes[0] : null;
  let proven = null;
  if (addon.bundled) {
    proven = readTitle(item.title ?? item.name).kind;
    // These paths belong to the bundled Akwam parser, not arbitrary addon URLs.
    if (addon.sourceId === "akwam") {
      const path = (() => { try { return new URL(item.url).pathname; } catch { return ""; } })();
      proven ??= /^\/movie\//.test(path) ? "movie" : /^\/series\//.test(path) ? "series" : null;
    }
  }
  const type = item.type ?? single ?? proven;
  if (!addon.contentTypes.includes(type)) throw new Error("نوع العمل غير مؤكد؛ لم يحدد المصدر فيلمًا أم مسلسلًا");
  const title = item.title ?? item.name ?? "عمل",
    id = item.id ?? item.url,
    sourceId = addon.sourceId ?? `addon|${addon.key}`;
  const work = normalizeWork(
    { ...item, id, title },
    { addonKey: addon.key, type },
  );
  const copy = {
    ...item,
    url: item.url ?? String(id),
    id: String(id),
    title,
    sourceId,
    type,
    externalIds: work.externalIds,
  };
  if (type === "manga")
    return toV35Work({
      key: work.canonicalId,
      title,
      thumbnailUrl: item.thumbnailUrl ?? item.thumbnail ?? item.poster,
      editions: [{ sourceId, manga: copy }],
      aliases: [],
    });
  const base = {
    id:
      type !== "anime" && work.externalIds.imdb
        ? work.externalIds.imdb
        : type === "anime" && /^\d+$/.test(work.externalIds.anilist ?? "")
          ? Number(work.externalIds.anilist)
          : `addon-${encodeURIComponent(normalizeWork({ id: String(id), title }, { addonKey: addon.key, type }).canonicalId)}`,
    title,
    externalIds: work.externalIds,
    canonicalId: work.canonicalId,
    description: item.description ?? null,
    genres: item.genres ?? [],
    poster: item.poster ?? item.thumbnail ?? null,
    background: item.background ?? item.poster ?? item.thumbnail ?? null,
    _sourceCopy: copy,
  };
  if (type === "anime")
    return {
      ...base,
      cover: base.poster,
      banner: base.background,
      episodes: episodes.length,
      aired: episodes.length,
      synonyms: [],
      status: null,
      year: null,
      idMal: null,
    };
  const seasons = [...new Set(episodes.map((e) => e.season ?? 1))].map((n) => ({
    n,
    episodes: episodes
      .filter((e) => (e.season ?? 1) === n)
      .map((e) => ({
        n: e.number,
        name: e.name ?? null,
        thumb: e.thumbnail ?? null,
      })),
  }));
  return {
    ...base,
    type,
    seasons: type === "series" ? seasons : null,
    runtime: null,
    year: null,
    rating: null,
    released: null,
  };
}

/** Provider-local references carry provider and work IDs, never a title-only lookup. */
export async function restoreSourceWork(ref, { addons, title = null, cover = null, signal } = {}) {
  const local = String(ref).replace(/^(?:anime|cinema):/, "").replace(/:\d+$/, "");
  if (!local.startsWith("addon-")) throw new Error("مرجع الإضافة غير صالح");
  let identity;
  try { identity = decodeURIComponent(local.slice(6)); } catch { throw new Error("مرجع الإضافة غير صالح"); }
  const match = /^(movie|series|anime)\|provider:([^:|]+):([^|]+)\|s(\d*)\|p(\d*)$/.exec(identity);
  if (!match) throw new Error("مرجع الإضافة غير صالح");
  const [, type, encodedKey, encodedId] = match;
  const key = decodeURIComponent(encodedKey), id = decodeURIComponent(encodedId);
  const addon = addons.registry.list().find(a => a.key === key && a.enabled && a.contentTypes.includes(type));
  if (!addon) throw new Error("ثبّت أو فعّل إضافة هذا العمل لفتحه");
  const source = addons.sources.source(addon.sourceId ?? `addon|${key}`);
  if (!source) throw new Error("مصدر العمل غير متاح");
  let item = { id, url: id, type, title: title ?? "عمل", poster: cover };
  const adapter = addons.adapter(key);
  if (addon.protocol === "stremio" && addon.capabilities?.includes("meta") !== false && adapter.meta)
    item = { ...item, ...await adapter.meta({ type, id, signal }) };
  else if (!addon.bundled && addon.capabilities?.includes("details") && adapter.series) {
    const details = await adapter.series(item, { signal });
    const data = details.work ?? details.series ?? details;
    if (data.id != null && String(data.id) !== id) throw new Error("الإضافة أعادت عملًا مختلفًا");
    item = { ...item, ...data, id, url: id, type };
  }
  const episodes = await source.episodes(item, { signal });
  const restored = sourceWorkModel(item, { addon, episodes });
  // External IDs discovered later must not change an already saved provider reference.
  return { ...restored, id: local };
}
