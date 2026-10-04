import { validateManifest, publicUrl } from "./manifest.js";
import { LIMITS } from "./contracts.js";
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
  const view = (row) => ({
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
        health.state(row.manifest.key, c, runtimeName),
      ]),
    ),
  });
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
  async function inspect(url, { signal } = {}) {
    url = String(url).replace(/^stremio:\/\//i, "https://");
    publicUrl(url);
    const raw = await transport.json(url, { signal, limit: LIMITS.manifest });
    const checked = validateManifest(raw, { origin: new URL(url).origin });
    if (checked.errors.length)
      throw new Error(`manifest غير متوافق: ${checked.errors.join(", ")}`);
    const preview = {
      manifest: checked.manifest,
      compatibility: checked.compatibility,
    };
    previews.set(preview, { url, raw });
    return preview;
  }
  async function install(preview) {
    await ready;
    const hidden = previews.get(preview);
    if (!hidden) throw new Error("عاين رابط الإضافة أولًا");
    const m = preview.manifest;
    if (!entries.has(m.key) && entries.size >= 100)
      throw new Error("الحد الأقصى 100 إضافة مثبتة");
    if (entries.has(m.key) && sessions)
      throw new Error("انتظر انتهاء الجلسة قبل استبدال نسخة الإضافة");
    const before = entries.get(m.key);
    entries.set(m.key, {
      manifest: m,
      manifestRaw: hidden.raw,
      url: hidden.url,
      enabled: true,
      installedAt: clock(),
      cacheEpoch: crypto.randomUUID(),
      staged: null,
      previous: null,
    });
    previews.delete(preview);
    try {
      await save();
    } catch (e) {
      if (before) entries.set(m.key, before);
      else entries.delete(m.key);
      throw e;
    }
    return view(entries.get(m.key));
  }
  function row(key) {
    const r = entries.get(key);
    if (!r) throw new Error("إضافة خارجية غير مثبتة");
    return r;
  }
  async function pin(key, value) {
    if (!entries.has(key) && !coreAdapters.some((c) => c.key === key))
      throw new Error("الإضافة غير موجودة");
    pins.set(JSON.stringify([profileKey, key]), Boolean(value));
    if ((await store.set("state", "addons.pins.v1", [...pins])) === false)
      throw new Error("تعذر حفظ الترتيب");
  }
  async function enable(key, value) {
    row(key).enabled = Boolean(value);
    await save();
  }
  async function remove(key) {
    row(key);
    entries.delete(key);
    await save();
  }
  async function stage(key) {
    const r = row(key),
      p = await inspect(r.url),
      h = previews.get(p);
    if (p.manifest.key !== key) throw new Error("معرف التحديث تغير");
    r.staged = { manifest: p.manifest, manifestRaw: h.raw, url: h.url };
    await save();
  }
  async function activateStaged(key) {
    const r = row(key);
    if (sessions || !r.staged) return false;
    r.previous = {
      manifest: r.manifest,
      manifestRaw: r.manifestRaw,
      url: r.url,
    };
    Object.assign(r, r.staged, { staged: null, cacheEpoch: crypto.randomUUID() });
    await save();
    return true;
  }
  async function rollback(key) {
    const r = row(key);
    if (sessions || !r.previous)
      throw new Error("لا توجد نسخة سابقة قابلة للرجوع الآن");
    const prev = r.previous;
    if (
      validateManifest(prev.manifestRaw, { origin: new URL(prev.url).origin })
        .errors.length
    )
      throw new Error("النسخة السابقة غير متوافقة");
    Object.assign(r, prev, { previous: null, staged: null, cacheEpoch: crypto.randomUUID() });
    await save();
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
