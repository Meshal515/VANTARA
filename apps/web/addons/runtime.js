import { isNative, webPlugin } from "../pwa/platform.js";
import { createAddonCache } from "./cache.js";
import { createAddonRegistry } from "./registry.js";
import { createTransport } from "./transport.js";
import { createBundledAdapter } from "./adapters/bundled.js";
import { createRemoteAdapter } from "./adapters/remote.js";
import { createStremioAdapter } from "./adapters/stremio.js";
import { assessAddon, supportedCapabilities } from "./assessment.js";
import { catalogExtras, matchesStremioResource } from "./stremio-model.js";
import { publicUrl } from "./manifest.js";
import { plainObject } from "./contracts.js";

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
  function adapter(key, { diagnostic = false } = {}) {
    if (key.startsWith("core|")) {
      const sourceDef = r.registry.def(key.slice(5));
      if (!sourceDef) throw new Error("المصدر غير متاح");
      return createBundledAdapter({ sourceDef, engine: r.registry });
    }
    const c = registry.connection(key);
    if (c.manifest.configuration?.required && !c.manifest.configuration.configured)
      throw Object.assign(new Error("تحتاج الإضافة إلى إعداد قبل الاستخدام"), { code: "CONFIG_REQUIRED" });
    const raw =
      c.manifest.protocol === "stremio"
        ? createStremioAdapter({ ...c, transport })
        : createRemoteAdapter({ ...c, transport });
    const out = {};
    for (const [method, fn] of Object.entries(raw)) {
      out[method] = async (...args) => {
        const cap = method === "request" ? args[0] : { series: "details" }[method] ?? method;
        if (!supportedCapabilities(c.manifest, runtimeName).includes(cap))
          throw Object.assign(new Error("هذه القدرة غير مدعومة في هذه المنصة"), { code: "UNSUPPORTED_RESOURCE" });
        const input = JSON.stringify(args, (k, v) =>
            k === "signal" || typeof v === "function" ? undefined : v,
          ),
          cacheKey = `${key}@${c.manifest.version}@${c.cacheEpoch}`;
        const started = Date.now();
        try {
          const hit = diagnostic ? null : await cache.get(cacheKey, cap, input).catch(() => null);
          if (hit != null) return hit;
          if (!registry.health.allow(key, cap, runtimeName, { manual: diagnostic }))
            throw Object.assign(
              new Error("الإضافة في فترة تبريد بعد أعطال متكررة"),
              { name: "CooldownError" },
            );
          const result = await fn(...args);
          if (c.manifest.protocol !== "stremio" && (
            ["home", "search"].includes(cap) && !Array.isArray(result?.items ?? result?.mangas) ||
            cap === "details" && !plainObject(result?.item ?? result?.manga)
          )) throw Object.assign(new Error("الإضافة أعادت بيانات غير صالحة"), { code: "INVALID_RESPONSE" });
          if (cap === "subtitles" && (!Array.isArray(result) || result.some((x) => {
            try { publicUrl(x?.url); return false; } catch { return true; }
          }))) throw Object.assign(new Error("الإضافة أعادت بيانات ترجمة غير صالحة"), { code: "INVALID_RESPONSE" });
          const items = Array.isArray(result) ? result : result?.items ?? result?.mangas ?? result?.chapters ?? result?.episodes ?? result?.pages;
          const usable = cap === "streams"
            ? Array.isArray(result) && result.some((x) => x.url && x.type !== "dash" && (!x.status || x.status === "RESOLVED"))
            : !Array.isArray(items) || items.length > 0;
          const evidence = { version: c.manifest.version, cacheEpoch: c.cacheEpoch };
          if (usable)
            registry.health.success(
              key,
              cap,
              runtimeName,
              Date.now() - started,
              evidence,
            );
          else
            registry.health.empty(
              key,
              cap,
              runtimeName,
              Date.now() - started,
              evidence,
            );
          if (usable && !diagnostic)
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
          if (error.code === "CONFIG_REQUIRED")
            registry.health.configuration(key, cap, runtimeName, Date.now() - started, { version: c.manifest.version, cacheEpoch: c.cacheEpoch });
          else if (error.name === "AbortError" || ["UNSUPPORTED_RESOURCE", "REQUIRED_EXTRA", "INVALID_EXTRA"].includes(error.code))
            registry.health.releaseProbe(key, cap, runtimeName);
          else if (error.name !== "CooldownError")
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
              { version: c.manifest.version, cacheEpoch: c.cacheEpoch },
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
          !x.bundled && x.enabled && x.compatibility?.[runtimeName] !== false &&
          !(x.configuration?.required && !x.configuration.configured),
      );
  function def(id) {
    if (!id.startsWith("addon|")) return r.registry.def(id);
    const m = external().find((x) => `addon|${x.key}` === id && x.contentTypes.some((t) => ["manga", "anime", "movie", "series"].includes(t)));
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
    if (m.protocol === "stremio" && !m.capabilities.some((c) => ["catalog", "meta", "streams"].includes(c))) return null;
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
          c.extra?.some((x) => x.name === "search") && !c.extra.some((x) => x.isRequired && x.name !== "search"),
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
        // Catalog/meta facets enumerate works; only stream providers own routes.
        if (!m.capabilities.includes("streams")) return [];
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
        if (!m.capabilities.includes("streams")) return [];
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
          .filter(() => runtimeName !== "apk")
          .filter((m) =>
            m.capabilities.some((c) =>
              ["search", "streams", "pages"].includes(c),
            ),
          )
          .map((m) => def(`addon|${m.key}`))
          .filter((d) => d && (!content || d.content === content)),
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
  async function diagnose(key, { signal, sample } = {}) {
    await ready;
    if (signal?.aborted) throw new DOMException("ألغي فحص الإضافة", "AbortError");
    const addon = registry.list().find((x) => x.key === key);
    if (!addon) throw new Error("الإضافة غير موجودة");
    const checks = [];
    const initial = assessAddon(addon, runtimeName);
    if (["disabled", "configuration", "unsupported", "builtin"].includes(initial.level))
      return { checks: [{ capability: "addon", state: initial.level, message: initial.detail }], assessment: initial };
    const supported = supportedCapabilities(addon, runtimeName);
    const a = adapter(key, { diagnostic: true });
    let catalogItems = [];
    const check = async (capability, run) => {
      if (!run) { checks.push({ capability, state: "untested", message: "يتطلب الفحص هوية أو مرشحًا متاحًا؛ لم يُرسل طلب" }); return; }
      try {
        if (signal?.aborted) throw new DOMException("ألغي فحص الإضافة", "AbortError");
        const result = await run();
        const h = registry.health.state(key, capability, runtimeName);
        const unsupported = capability === "streams" && Array.isArray(result) && result.length > 0 && result.every((x) => x.status === "UNSUPPORTED" || x.type === "dash");
        checks.push({ capability, state: unsupported ? "unsupported" : h.state === "empty" ? "empty" : "passed", message: unsupported ? "استجابت الخدمة؛ صيغ التشغيل المتاحة غير مدعومة في هذه المنصة" : h.state === "empty" ? "استجابة صالحة؛ لا توجد نتائج متاحة لهذا الطلب" : "استجابة فعلية صالحة؛ لا تعني جاهزية تشغيل الفيديو" });
        return result;
      } catch (error) {
        if (error.name === "AbortError" || signal?.aborted) throw new DOMException("ألغي فحص الإضافة", "AbortError");
        const unsupported = ["UNSUPPORTED_RESOURCE", "REQUIRED_EXTRA", "INVALID_EXTRA"].includes(error.code);
        const configuration = error.code === "CONFIG_REQUIRED";
        checks.push({ capability, state: configuration ? "configuration" : unsupported ? "untested" : "failed", message: configuration ? "طلبت الخدمة إكمال إعدادها قبل الاستخدام" : unsupported ? "لا توجد هوية أو مرشحات مناسبة لهذه القدرة" : error.name === "TimeoutError" ? "انتهت مهلة الفحص" : "تعذر الطلب أو أعادت الإضافة بيانات غير صالحة" });
      }
    };
    const order = { catalog: 0, meta: 1 };
    const capabilities = [...(addon.capabilities ?? [])].sort((a, b) => (order[a] ?? 2) - (order[b] ?? 2));
    for (const capability of capabilities) {
      if (!supported.includes(capability)) { checks.push({ capability, state: "unsupported", message: "هذه القدرة غير مدعومة في هذه المنصة" }); continue; }
      let run;
      if (addon.protocol === "stremio") {
        if (capability === "catalog") {
          let choice;
          for (const catalog of addon.catalogs ?? []) {
            const extra = {}; let addressable = true;
            for (const rule of catalogExtras(catalog).filter((x) => x.isRequired)) {
              const value = sample?.extra?.[rule.name] ?? rule.options?.[0];
              if (value == null || value === "") { addressable = false; break; }
              extra[rule.name] = value;
            }
            if (addressable) { choice = { catalog, extra }; break; }
          }
          if (choice) run = async () => (catalogItems = await a.catalog({ type: choice.catalog.type, id: choice.catalog.id, extra: choice.extra, signal }));
        } else if (capability === "meta") {
          const identity = sample?.id ? { id: sample.id, type: sample.type } : catalogItems.find((x) => matchesStremioResource(addon, "meta", x.type, x.id));
          if (identity && matchesStremioResource(addon, "meta", identity.type, identity.id)) run = () => a.meta({ ...identity, signal });
        } else if (["streams", "subtitles"].includes(capability)) {
          const videoId = sample?.videoId ?? sample?.id;
          if (videoId && matchesStremioResource(addon, capability === "streams" ? "stream" : capability, sample.type, videoId))
            run = () => a[capability]({ type: sample.type, videoId, extra: sample.extra, signal });
        }
      } else {
        if (capability === "home") run = () => a.home(1, { signal });
        else if (capability === "search" && sample?.query) run = () => a.search(sample.query, 1, { signal });
        else if (capability === "details" && sample?.work) run = () => a.series(sample.work, { signal });
        else if (capability === "episodes" && sample?.work) run = () => a.episodes(sample.work, { signal });
        else if (capability === "pages" && sample?.chapter) run = () => a.pages(sample.chapter, { signal });
        else if (capability === "streams" && sample?.work) run = () => a.streams(sample.work, null, { signal });
        else if (capability === "subtitles" && sample?.videoId) run = () => a.subtitles({ ...sample, signal });
      }
      await check(capability, run);
    }
    for (const _resource of addon.diagnostics?.unsupportedResources ?? [])
      checks.push({ capability: "other", state: "unsupported", message: "مورد معلن غير مدعوم في هذا الإصدار" });
    return { checks, assessment: assessAddon(registry.list().find((x) => x.key === key), runtimeName) };
  }
  return {
    registry,
    transport,
    adapter,
    sources,
    ready,
    subtitleProviders,
    diagnose,
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
