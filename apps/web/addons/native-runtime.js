import { createAddonRuntime } from "./runtime.js";
import { createNativeTransport } from "./native-transport.js";
let runtime;
function nativeStore(storage = globalThis.localStorage) {
  const key = (space, k) => `vantara.addons.native|${space}|${k}`;
  return {
    async get(space, k) {
      try {
        const row = JSON.parse(storage.getItem(key(space, k)));
        return row
          ? { value: row.value, stale: row.expiresAt < Date.now() }
          : null;
      } catch {
        return null;
      }
    },
    async set(space, k, value, { ttlMs = Infinity } = {}) {
      try {
        const text = JSON.stringify({
          value,
          expiresAt: Number.isFinite(ttlMs) ? Date.now() + ttlMs : 1e15,
        });
        if (text.length > 2 * 1024 * 1024) return false;
        storage.setItem(key(space, k), text);
        return true;
      } catch {
        return false;
      }
    },
  };
}
export function getNativeAddonRuntime() {
  if (runtime) return runtime;
  const plugins = globalThis.Capacitor?.Plugins,
    transport = createNativeTransport(plugins?.AddonEngine),
    defs = [];
  const ready = (async () => {
    if (plugins.AnimeEngine) {
      const manifest = await (await fetch("/anime/sources.json")).json();
      await plugins.AnimeEngine.configure({ manifest });
      const out = await plugins.AnimeEngine.sources();
      defs.push(
        ...out.sources
          .filter((s) => s.enabled)
          .map((s) => ({
            ...s,
            label: s.name,
            content: s.content ?? "anime",
            version: 1,
          })),
      );
    }
    if (plugins.ExtensionEngine) {
      const out = await plugins.ExtensionEngine.sources();
      defs.push(
        ...out.sources
          .filter((s) => !s.filler)
          .map((s) => ({
            ...s,
            content: "manga",
            domain: null,
            version: s.version ?? 1,
          })),
      );
    }
  })();
  const def = (id) => defs.find((s) => s.id === id);
  const source = (id) => {
    const d = def(id);
    if (!d) return null;
    if (d.content === "manga") {
      const invoke = async (method, args) => {
        await plugins.ExtensionEngine.prepare({ sourceId: id });
        return plugins.ExtensionEngine[method]({ sourceId: id, ...args });
      };
      return {
        search: (query, page = 1) => invoke("search", { query, page }),
        latest: (page = 1) => invoke("latest", { page }),
        popular: (page = 1) => invoke("popular", { page }),
        series: (manga) => invoke("series", { manga }),
        pages: async (chapter) => (await invoke("pages", { chapter })).pages,
      };
    }
    const page = async (listing, page = 1, query = "") =>
      (await plugins.AnimeEngine.page({ sourceId: id, listing, page, query }))
        .page;
    return {
      search: (q, p = 1) => page("search", p, q),
      latest: (p) => page("latest", p),
      popular: (p) => page("popular", p),
      episodes: async (anime) =>
        (
          await plugins.AnimeEngine.episodes({
            anime: { ...anime, sourceId: id },
          })
        ).episodes,
    };
  };
  runtime = createAddonRuntime({
    runtime: {
      native: true,
      ready,
      registry: {
        list: () => defs,
        def,
        source,
        call: async (id, fn) => {
          const s = source(id);
          if (!s) throw new Error("المصدر غير متاح");
          return fn(s);
        },
      },
    },
    store: nativeStore(),
    transport,
  });
  runtime.nativeSubtitleProviders = () =>
    runtime.registry
      .list()
      .filter(
        (m) =>
          !m.bundled &&
          m.enabled &&
          m.protocol === "stremio" &&
          m.capabilities.includes("subtitles") &&
          !(m.configuration?.required && !m.configuration.configured) &&
          runtime.registry.health.ready(m.key, "subtitles", "apk"),
      )
      .flatMap((m) => {
        // Media3's existing descriptor treats [] as unrestricted. Project each
        // supported type without widening explicit empty Stremio rules.
        const groups = new Map();
        for (const type of ["movie", "series"]) {
          const rules = m.resources.filter(r => r.name === "subtitles" && r.types.includes(type));
          if (!rules.length) continue;
          const unrestricted = rules.some(r => r.idPrefixes == null || r.idPrefixes.includes(""));
          const prefixes = unrestricted ? [] : [...new Set(rules.flatMap(r => r.idPrefixes))].sort();
          if (!unrestricted && !prefixes.length) continue;
          const group = JSON.stringify(prefixes);
          if (!groups.has(group)) groups.set(group, { manifestUrl: runtime.registry.connection(m.key).manifestUrl, key: m.key, name: m.name, types: [], idPrefixes: prefixes });
          groups.get(group).types.push(type);
        }
        return [...groups.values()];
      });
  runtime.runtimeName = "apk";
  return runtime;
}
