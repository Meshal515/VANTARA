import { isNative, webPlugin } from "../pwa/platform.js";
import { createAddonCache } from "./cache.js";
import { createAddonRegistry } from "./registry.js";
import { createTransport } from "./transport.js";
import { createBundledAdapter } from "./adapters/bundled.js";
import { createRemoteAdapter } from "./adapters/remote.js";
import { createStremioAdapter } from "./adapters/stremio.js";

const section = (m) =>
  m.contentTypes.includes("manga")
    ? "manga"
    : m.contentTypes.includes("anime")
      ? "anime"
      : "cinema";
export function createAddonRuntime({
  runtime: r,
  transport = createTransport(),
  store = r?.addonStore ?? r?.store,
} = {}) {
  if (!store) throw new Error("مخزن الإضافات غير متاح");
  const runtimeName = r.native ? "apk" : "pwa";
  const core = [],
    registry = createAddonRegistry({
      store,
      transport,
      coreAdapters: core,
      runtimeName,
    });
  const ready = Promise.all([r.ready, registry.ready]).then(() => {
    core.push(
      ...r.registry.list().map((d) => ({
        key: `core|${d.id}`,
        sourceId: d.id,
        name: d.label,
        version: String(d.version),
        contentTypes:
          d.content === "cinema" ? ["movie", "series"] : [d.content],
        capabilities:
          d.content === "manga"
            ? ["home", "search", "details", "chapters", "pages"]
            : ["search", "details", "episodes", "streams"],
        permissions: { networkHosts: [d.domain] },
        bundled: true,
      })),
    );
  });
  const cache = createAddonCache({ store });
  function adapter(key) {
    if (key.startsWith("core|")) {
      const sourceDef = r.registry.def(key.slice(5));
      if (!sourceDef) throw new Error("المصدر غير متاح");
      return createBundledAdapter({ sourceDef, engine: r.registry });
    }
    const c = registry.connection(key);
    const raw =
      c.manifest.protocol === "stremio"
        ? createStremioAdapter({ ...c, transport })
        : createRemoteAdapter({ ...c, transport });
    const out = {};
    for (const [method, fn] of Object.entries(raw)) {
      out[method] = async (...args) => {
        const cap = { series: "details" }[method] ?? method;
        const input = JSON.stringify(args, (k, v) =>
            k === "signal" || typeof v === "function" ? undefined : v,
          ),
          cacheKey = `${key}@${c.manifest.version}@${c.cacheEpoch}`;
        const started = Date.now();
        try {
          const hit = await cache.get(cacheKey, cap, input).catch(() => null);
          if (hit != null) return hit;
          if (!registry.health.allow(key, cap, runtimeName))
            throw Object.assign(
              new Error("الإضافة في فترة تبريد بعد أعطال متكررة"),
              { name: "CooldownError" },
            );
          const result = await fn(...args);
          const usable =
            cap !== "streams" ||
            (Array.isArray(result) &&
              result.some(
                (x) => x.url && (!x.status || x.status === "RESOLVED"),
              ));
          if (usable)
            registry.health.success(
              key,
              cap,
              runtimeName,
              Date.now() - started,
            );
          else
            registry.health.failure(
              key,
              cap,
              runtimeName,
              "RESOLVER_EMPTY",
              Date.now() - started,
            );
          if (usable)
            await cache
              .set(
                cacheKey,
                cap,
                input,
                result,
                cap === "streams"
                  ? {
                      expiresAt: Math.min(
                        ...result.map((x) => x.expiresAt ?? 0),
                      ),
                    }
                  : {},
              )
              .catch(() => {});
          return result;
        } catch (error) {
          if (!["AbortError", "CooldownError"].includes(error.name))
            registry.health.failure(
              key,
              cap,
              runtimeName,
              error.name === "TimeoutError"
                ? "TIMEOUT"
                : error.status
                  ? `HTTP_${error.status}`
                  : "request_failure",
              Date.now() - started,
            );
          throw error;
        }
      };
    }
    return out;
  }
  const external = () =>
    registry
      .list()
      .filter(
        (x) =>
          !x.bundled && x.enabled && x.compatibility?.[runtimeName] !== false,
      );
  function def(id) {
    if (!id.startsWith("addon|")) return r.registry.def(id);
    const m = external().find((x) => `addon|${x.key}` === id);
    return m
      ? {
          id,
          label: m.name,
          content: section(m),
          version: m.version,
          domain: m.permissions.networkHosts[0],
          engine: "remote-addon",
          manifest: m,
        }
      : null;
  }
  function source(id) {
    if (!id.startsWith("addon|")) return r.registry.source(id);
    const d = def(id);
    if (!d) return null;
    const m = d.manifest,
      a = adapter(m.key);
    if (m.protocol !== "stremio")
      return {
        ...a,
        latest: a.home,
        popular: a.home,
        catalogue: a.home,
        servers: async (ep) => [
          {
            key: ep.id ?? ep.url,
            name: m.name,
            url: ep.id ?? ep.url,
            addon: true,
          },
        ],
        imageReferer: () => null,
      };
    const typeOf = (w) =>
      w.type ?? (m.types.includes("series") ? "series" : "movie");
    return {
      async search(query) {
        const catalogs = m.catalogs.filter((c) =>
          c.extra?.some((x) => x.name === "search"),
        );
        const out = [];
        for (const c of catalogs)
          out.push(
            ...(
              await a.catalog({
                type: c.type,
                id: c.id,
                extra: { search: query },
              })
            ).map((x) => ({
              id: x.id,
              url: x.id,
              title: x.name,
              thumbnail: x.poster,
              type: x.type ?? c.type,
            })),
          );
        return out;
      },
      async episodes(work, { signal } = {}) {
        const type = typeOf(work);
        if (!m.capabilities.includes("meta")) {
          const id = work.id ?? work.url;
          if (type === "movie")
            return [
              {
                url: id,
                name: "الفيلم",
                number: 1,
                type,
                externalIds: work.externalIds,
              },
            ];
          if (
            Number.isInteger(work.requestedSeason) &&
            Number.isInteger(work.episode)
          )
            return [
              {
                url: `${id}:${work.requestedSeason}:${work.episode}`,
                name: `الحلقة ${work.episode}`,
                number: work.episode,
                season: work.requestedSeason,
                type,
                externalIds: work.externalIds,
              },
            ];
          throw new Error(
            "لا توفر الإضافة تفاصيل حلقات؛ افتح العمل بهويته الأصلية",
          );
        }
        const meta = await a.meta({ type, id: work.id ?? work.url, signal });
        if (type === "movie")
          return [
            {
              url: meta.id,
              name: meta.name ?? "الفيلم",
              number: 1,
              type,
              workId: meta.id,
              externalIds: { imdb: /^tt\d+$/.test(meta.id) ? meta.id : null },
            },
          ];
        return (meta.videos ?? [])
          .filter(
            (x) =>
              work.requestedSeason == null || x.season === work.requestedSeason,
          )
          .map((x) => ({
            url: x.id,
            name: x.name ?? `الحلقة ${x.episode}`,
            number: x.episode,
            season: x.season,
            type,
            workId: meta.id,
            externalIds: { imdb: /^tt\d+$/.test(meta.id) ? meta.id : null },
          }));
      },
      async servers(ep) {
        return [
          {
            key: ep.url,
            name: m.name,
            url: ep.url,
            type: ep.type,
            episode: ep,
            addon: true,
          },
        ];
      },
      async streams(server, onResult, { signal } = {}) {
        const list = await a.streams({
          type: server.type,
          videoId: server.url,
          signal,
        });
        const usable = list
          .filter((x) => x.status === "RESOLVED" && x.type !== "dash")
          .map((x) => ({
            ...x,
            identity: {
              kind: server.type,
              externalIds: server.episode.externalIds,
              season: server.episode.season,
              episode: server.episode.number,
              videoId: server.url,
              addonKey: m.key,
            },
          }));
        onResult?.(usable);
        return usable;
      },
    };
  }
  const sources = {
    list(content) {
      return [
        ...r.registry.list(content),
        ...external()
          .filter((m) =>
            m.capabilities.some((c) =>
              ["search", "streams", "pages"].includes(c),
            ),
          )
          .map((m) => def(`addon|${m.key}`))
          .filter((d) => !content || d.content === content),
      ];
    },
    def,
    source,
    async call(id, fn) {
      if (!id.startsWith("addon|")) return r.registry.call(id, fn);
      const s = source(id);
      if (!s) throw new Error("الإضافة معطلة أو غير متاحة");
      return fn(s);
    },
    cooling: (id) => (id.startsWith("addon|") ? false : r.registry.cooling(id)),
  };
  function subtitleProviders() {
    return external()
      .filter(
        (m) =>
          m.capabilities.includes("subtitles") &&
          registry.health.ready(m.key, "subtitles", runtimeName),
      )
      .map((m) => ({
        key: m.key,
        name: m.name,
        origin: m.key.split("|")[0],
        healthy:
          registry.health.state(m.key, "subtitles", runtimeName).state ===
          "healthy",
        subtitles: (input) => adapter(m.key).subtitles(input),
      }));
  }
  return {
    registry,
    transport,
    adapter,
    sources,
    ready,
    subtitleProviders,
    runtimeName,
  };
}
export async function getAddonRuntime(r) {
  if (r?.addons) return r.addons;
  if (isNative())
    return (await import("./native-runtime.js")).getNativeAddonRuntime();
  const gate = webPlugin("AddonFabric");
  if (!gate) throw new Error("جسر الإضافات غير متاح");
  return (await gate.runtime()).getRuntime().addons;
}
