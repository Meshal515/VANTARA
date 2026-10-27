import { createAddonRuntime } from "./runtime.js";
import { createNativeTransport } from "./native-transport.js";
import { createStore, SPACES } from "../lib/idb-store.js";
let runtime;
// كانت الإضافات في APK تُحفظ في localStorage، ومعها كل رد بث وترجمة بمفتاح خاص لكل حلقة لا يُحذف أبدًا،
// فيمتلئ localStorage المشترك مع الوقت ويُرفض حفظ الإضافات. الآن IndexedDB بحدود وكنس، وما في
// localStorage يُنقل مرة عند أول قراءة ثم يُحذف، وردود الكاش القديمة تُحذف دون نقل.
const LEGACY = "vantara.addons.native|";
const ADDON_SPACES = { ...SPACES, state: { ttlMs: Infinity, maxBytes: 16 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024 } };
export function nativeStore(storage = globalThis.localStorage, store = createStore({ name: "vantara-addons", spaces: ADDON_SPACES })) {
  const legacy = (space, k) => `${LEGACY}${space}|${k}`;
  const drop = (k) => { try { storage?.removeItem?.(k); } catch { /* يُعاد في المرة القادمة */ } };
  let cleaned = false;
  const cleanCache = () => {
    if (cleaned) return;
    cleaned = true;
    // ردود الكاش لها حد 30MB وتُكنس بعد هدوء الشاشة؛ مساحة الإضافات المثبتة لا تُكنس أبدًا
    setTimeout(() => void store.sweep({ ns: "source" }).catch(() => {}), 15_000);
    if (!storage) return;
    try {
      const old = [];
      for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(`${LEGACY}source|`)) old.push(k); }
      old.forEach(drop);
    } catch { /* localStorage غير متاح */ }
  };
  return {
    failure: () => store.failure(),
    async get(space, k) {
      cleanCache();
      const hit = await store.get(space, k);
      if (hit || space !== "state") return hit;
      let row = null;
      try { row = JSON.parse(storage?.getItem(legacy(space, k))); } catch { return null; }
      if (!row) return null;
      if (await store.set(space, k, row.value)) drop(legacy(space, k));
      return { value: row.value, stale: false };
    },
    async set(space, k, value, options) {
      cleanCache();
      const ok = await store.set(space, k, value, options);
      if (ok && space === "state") drop(legacy(space, k));
      return ok;
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
      out.push(...anime.sources.filter((s) => s.enabled).map((s) => ({ ...s, label: s.name, content: s.content ?? "anime", version: s.version ?? 1, ...(String(s.id).startsWith("user-") ? { user: true } : {}) })));
    }
    if (plugins.ExtensionEngine) {
      const manga = await plugins.ExtensionEngine.sources().catch(() => ({ sources: [] }));
      // إضافات التكملة المشحونة مخفية؛ ما ثبّته المستخدم يظهر بأي لغة كان
      out.push(...manga.sources.filter((s) => !s.filler || s.user).map((s) => ({ ...s, content: "manga", domain: s.domain ?? null, version: s.version ?? 1 })));
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
