import { validateManifest, publicUrl } from "./manifest.js";
import { LIMITS } from "./contracts.js";
import { assertBoundedData, canonicalData, manifestEndpoint, parseAddonImport } from "./import.js";
import { assessAddon } from "./assessment.js";
import { createHealth } from "./health.js";
const STORAGE = "addons.v1";
export function createAddonRegistry({
  store,
  transport,
  clock = Date.now,
  coreAdapters = [],
  runtimeName = "pwa",
}) {
  let healthWrite = Promise.resolve();
  const flushHealth = () => healthWrite;
  const entries = new Map(),
    previews = new WeakMap(),
    health = createHealth({
      clock,
      onChange: () => {
        const rows = health.snapshot();
        healthWrite = healthWrite
          .then(() => store.set("state", "addons.health.v1", rows))
          .catch(() => {});
      },
    });
  let mutations = Promise.resolve();
  const mutate = fn => {
    const pending = mutations.then(async () => { await ready; return fn(); });
    mutations = pending.catch(() => {});
    return pending;
  };
  let sessions = 0,
    profileKey = "local";
  const pins = new Map();
  const pinned = (key) => pins.get(JSON.stringify([profileKey, key])) ?? false;
  const ready = (async () => {
    const savedPins = await store
      .get("state", "addons.pins.v1")
      .catch(() => null);
    for (const pair of (Array.isArray(savedPins?.value)
      ? savedPins.value
      : []
    ).slice(-5000))
      if (
        Array.isArray(pair) &&
        typeof pair[0] === "string" &&
        typeof pair[1] === "boolean"
      )
        pins.set(...pair);
    const savedHealth = await store
      .get("state", "addons.health.v1")
      .catch(() => null);
    health.restore(savedHealth?.value);
    const saved = await store.get("state", STORAGE).catch(() => null);
    for (const row of Array.isArray(saved?.value) ? saved.value : []) {
      try {
        assertBoundedData(row.manifestRaw);
        const checked = validateManifest(row.manifestRaw, {
          origin: publicUrl(row.url).origin,
        });
        if (!checked.errors.length)
          entries.set(checked.manifest.key, {
            ...row,
            manifest: checked.manifest,
          });
      } catch {
        /* سجل إضافة تالف لا يعطل core */
      }
    }
  })();
  const save = async () => {
    if ((await store.set("state", STORAGE, [...entries.values()])) === false)
      throw new Error("تعذر حفظ الإضافات؛ مساحة التخزين غير كافية");
  };
  const view = (row) => { const addon = ({
    ...structuredClone({ ...row.manifest, baseUrl: undefined }),
    enabled: row.enabled,
    cacheEpoch: row.cacheEpoch ?? "legacy-v2",
    installedAt: row.installedAt,
    pinned: pinned(row.manifest.key),
    stagedVersion: row.staged?.manifest.version ?? null,
    stagedCapabilities: row.staged?.manifest.capabilities ?? [],
    stagedHosts: row.staged?.manifest.permissions.networkHosts ?? [],
    previousVersion: row.previous?.manifest.version ?? null,
    bundled: false,
    health: Object.fromEntries(
      row.manifest.capabilities.map((c) => [
        c,
        structuredClone(health.state(row.manifest.key, c, runtimeName)),
      ]),
    ),
  });
    addon.assessment = assessAddon(addon, runtimeName, clock());
    return addon;
  };
  function list(filter = {}) {
    return [
      ...coreAdapters.map((c) => ({
        ...c,
        bundled: true,
        official: true,
        enabled: true,
        pinned: pinned(c.key),
      })),
      ...entries.values().map(view),
    ]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned))
      .filter(
        (a) =>
          (!filter.content || a.contentTypes?.includes(filter.content)) &&
          (!filter.capability || a.capabilities?.includes(filter.capability)),
      );
  }
  function previewRaw(raw, url) {
    // Public preview objects are editable DOM data, never installation authority.
    assertBoundedData(raw);
    const privateRaw = structuredClone(raw);
    const checked = validateManifest(privateRaw, { origin: new URL(url).origin });
    if (checked.errors.length)
      throw new Error(`بيانات الإضافة غير متوافقة (${checked.errors.join(", ")})`);
    const preview = { manifest: structuredClone(checked.manifest), compatibility: structuredClone(checked.compatibility) };
    previews.set(preview, { url, raw: privateRaw });
    return preview;
  }
  async function inspect(url, { signal } = {}) {
    url = manifestEndpoint(url);
    const raw = await transport.json(url, { signal, limit: LIMITS.manifest });
    return previewRaw(raw, url);
  }
  async function inspectData(text, { serviceUrl, signal } = {}) {
    const parsed = parseAddonImport(text, { serviceUrl });
    const results = new Array(parsed.length);
    let next = 0;
    // Limit parallel manifest fetches; preserve bundle order and individual errors.
    await Promise.all(Array.from({ length: Math.min(4, parsed.length) }, async () => {
      while (next < parsed.length) {
        if (signal?.aborted) throw new DOMException("ألغي الاستيراد", "AbortError");
        const i = next++, item = parsed[i];
        if (item.error) { results[i] = item; continue; }
        try {
          const preview = item.raw ? previewRaw(item.raw, item.url) : await inspect(item.url, { signal });
          results[i] = { name: preview.manifest.name, preview };
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          results[i] = { name: item.name, error: e.message };
        }
      }
    }));
    return results;
  }
  function install(preview) {
    return mutate(async () => {
      const hidden = previews.get(preview);
      if (!hidden) throw new Error("عاين الإضافة أولًا");
      const checked = validateManifest(hidden.raw, { origin: new URL(hidden.url).origin });
      if (checked.errors.length) throw new Error("بيانات الإضافة غير متوافقة");
      const m = checked.manifest, before = entries.get(m.key);
      if (before && before.url === hidden.url && canonicalData(before.manifestRaw) === canonicalData(hidden.raw)) {
        previews.delete(preview);
        return view(before);
      }
      if (!before && entries.size >= 100) throw new Error("الحد الأقصى 100 إضافة مثبتة");
      if (before && sessions) throw new Error("انتظر انتهاء الجلسة قبل استبدال نسخة الإضافة");
      const next = {
        manifest: m, manifestRaw: structuredClone(hidden.raw), url: hidden.url,
        enabled: before?.enabled ?? true, installedAt: before?.installedAt ?? clock(),
        cacheEpoch: crypto.randomUUID(), staged: null,
        previous: before ? { manifest: before.manifest, manifestRaw: before.manifestRaw, url: before.url } : null,
      };
      entries.set(m.key, next);
      try { await save(); }
      catch (e) { if (before) entries.set(m.key, before); else entries.delete(m.key); throw e; }
      previews.delete(preview);
      health.reset(m.key);
      return view(next);
    });
  }
  function configurationUrl(key) {
    const r = row(key);
    // Setup never leaks configured path/query tokens; installing the returned
    // configured link is a separate preview/permissions step.
    return new URL('/configure', new URL(r.url).origin).href;
  }
  function row(key) {
    const r = entries.get(key);
    if (!r) throw new Error("إضافة خارجية غير مثبتة");
    return r;
  }
  function pin(key, value) {
    const pinKey = JSON.stringify([profileKey, key]);
    return mutate(async () => {
      if (!entries.has(key) && !coreAdapters.some((c) => c.key === key)) throw new Error("الإضافة غير موجودة");
      const before = pins.get(pinKey);
      pins.set(pinKey, Boolean(value));
      try {
        if ((await store.set("state", "addons.pins.v1", [...pins])) === false) throw new Error("تعذر حفظ الترتيب");
      } catch (e) { if (before === undefined) pins.delete(pinKey); else pins.set(pinKey, before); throw e; }
    });
  }
  function enable(key, value) {
    return mutate(async () => {
      const r = row(key), before = r.enabled;
      r.enabled = Boolean(value);
      try { await save(); } catch (e) { r.enabled = before; throw e; }
    });
  }
  function remove(key) {
    return mutate(async () => {
      const before = row(key);
      entries.delete(key);
      try { await save(); } catch (e) { entries.set(key, before); throw e; }
      health.reset(key);
    });
  }
  function stage(key) {
    return mutate(async () => {
      const r = row(key), p = await inspect(r.url), h = previews.get(p);
      if (p.manifest.key !== key) throw new Error("معرف التحديث تغير");
      previews.delete(p);
      if (canonicalData(r.manifestRaw) === canonicalData(h.raw)) return { changed: false };
      const before = r.staged;
      r.staged = { manifest: structuredClone(p.manifest), manifestRaw: h.raw, url: h.url };
      try { await save(); } catch (e) { r.staged = before; throw e; }
      return { changed: true };
    });
  }
  function activateStaged(key) {
    return mutate(async () => {
      const r = row(key);
      if (sessions || !r.staged) return false;
      const checked = validateManifest(r.staged.manifestRaw, { origin: publicUrl(r.staged.url).origin });
      if (checked.errors.length || checked.manifest.key !== key)
        throw new Error("النسخة الجديدة غير متوافقة");
      const before = structuredClone(r);
      r.previous = { manifest: r.manifest, manifestRaw: r.manifestRaw, url: r.url };
      Object.assign(r, r.staged, { manifest: checked.manifest, staged: null, cacheEpoch: crypto.randomUUID() });
      try { await save(); } catch (e) { entries.set(key, before); throw e; }
      health.reset(key);
      return true;
    });
  }
  function rollback(key) {
    return mutate(async () => {
      const r = row(key);
      if (sessions || !r.previous) throw new Error("لا توجد نسخة سابقة قابلة للرجوع الآن");
      const prev = r.previous;
      const checked = validateManifest(prev.manifestRaw, { origin: publicUrl(prev.url).origin });
      if (checked.errors.length || checked.manifest.key !== key)
        throw new Error("النسخة السابقة غير متوافقة");
      const before = structuredClone(r);
      Object.assign(r, prev, { manifest: checked.manifest, previous: null, staged: null, cacheEpoch: crypto.randomUUID() });
      try { await save(); } catch (e) { entries.set(key, before); throw e; }
      health.reset(key);
    });
  }
  function snapshot() {
    sessions++;
    let released = false;
    return {
      addons: list().filter((a) => a.enabled),
      release() {
        if (!released) {
          released = true;
          sessions--;
        }
      },
    };
  }
  function connection(key) {
    const r = row(key);
    if (!r.enabled) throw new Error("الإضافة معطلة");
    return { manifest: structuredClone(r.manifest), manifestUrl: r.url, cacheEpoch: r.cacheEpoch ?? "legacy-v2" };
  }
  return {
    ready,
    runtimeName,
    flushHealth,
    pin,
    setProfile(key) {
      profileKey = String(key ?? "local").slice(0, 160);
    },
    list,
    inspect,
    inspectData,
    configurationUrl,
    install,
    enable,
    remove,
    stage,
    activateStaged,
    rollback,
    snapshot,
    connection,
    health,
  };
}
