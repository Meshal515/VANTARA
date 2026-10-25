import { createAddonRuntime } from "./runtime.js";
import { createNativeTransport } from "./native-transport.js";
let runtime;
// localStorage الكامل مشترك بين كل الشاشات؛ عند الرفض نقيس من يملؤه بدل افتراض السبب
function heaviest(storage) {
  const rows = [];
  let used = 0;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i) ?? "";
      const size = (k.length + (storage.getItem(k)?.length ?? 0)) * 2;
      used += size;
      rows.push([k.slice(0, 48), size]);
    }
  } catch { /* القياس اختياري */ }
  return { used, top: rows.sort((a, b) => b[1] - a[1]).slice(0, 3) };
}
export function nativeStore(storage = globalThis.localStorage) {
  const key = (space, k) => `vantara.addons.native|${space}|${k}`;
  let lastFailure = null;
  return {
    failure: () => lastFailure,
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
        if (text.length > 2 * 1024 * 1024) {
          lastFailure = { reason: "too_large", bytes: text.length * 2, limit: 4 * 1024 * 1024 };
          return false;
        }
        storage.setItem(key(space, k), text);
        lastFailure = null;
        return true;
      } catch (error) {
        lastFailure = error?.name === "QuotaExceededError" || /quota/i.test(String(error?.message))
          ? { reason: "quota", ...heaviest(storage) }
          : { reason: error?.name || "unknown" };
        return false;
      }
    },
  };
}
export function getNativeAddonRuntime() {
  if (runtime) return runtime;
  const plugins = globalThis.Capacitor?.Plugins ?? {},
    transport = createNativeTransport(plugins?.AddonEngine),
    defs = [];
  const features = { addonStreams: false, torrentSupported: false };
  const ready = Promise.allSettled([
    (async () => {
      if (!plugins.AnimeEngine?.capabilities) return;
      const measured = await plugins.AnimeEngine.capabilities();
      features.addonStreams = measured?.addonStreams === true;
      features.torrentSupported = features.addonStreams && measured?.torrentSupported === true;
    })(),
    (async () => {
      // تعذّر تهيئة الأنمي لا يحرم المانجا من مصادرها
      if (plugins.AnimeEngine) {
        try {
          const manifest = await (await fetch("/anime/sources.json")).json();
          await plugins.AnimeEngine.configure({ manifest });
        } catch { /* مصادر الأنمي غير متاحة الآن */ }
      }
      defs.push(...(await collect()));
    })(),
  ]);
  /** مصادر الأنمي والمانجا كما يراها المحركان الآن (المشحونة + ما ثبّته المستخدم). */
  async function collect() {
    const out = [];
    if (plugins.AnimeEngine) {
      const anime = await plugins.AnimeEngine.sources().catch(() => ({ sources: [] }));
      out.push(...anime.sources.filter((s) => s.enabled).map((s) => ({ ...s, label: s.name, content: s.content ?? "anime", version: 1, ...(String(s.id).startsWith("user-") ? { user: true } : {}) })));
    }
    if (plugins.ExtensionEngine) {
      const manga = await plugins.ExtensionEngine.sources().catch(() => ({ sources: [] }));
      // إضافات التكملة المشحونة مخفية؛ ما ثبّته المستخدم يظهر بأي لغة كان
      out.push(...manga.sources.filter((s) => !s.filler || s.user).map((s) => ({ ...s, content: "manga", domain: null, version: s.version ?? 1 })));
    }
    return out;
  }
  async function reload() {
    await ready;
    const next = await collect();
    defs.splice(0, defs.length, ...next);
  }
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
      get addonStreams() { return features.addonStreams; },
      get torrentSupported() { return features.torrentSupported; },
      ready,
      reload,
      registry: {
        list: (content) => defs.filter(d => !content || d.content === content),
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
  runtime.nativeCapabilities = () => ({ ...features });
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
