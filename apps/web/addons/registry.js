import { validateManifest, publicUrl } from "./manifest.js";
import { LIMITS } from "./contracts.js";
import { assertBoundedData, canonicalData, manifestEndpoint, parseAddonImport } from "./import.js";
import { assessAddon } from "./assessment.js";
import { createHealth } from "./health.js";
import { compareVersions, fingerprint } from "../lib/plugin-vault.js";
const STORAGE = "addons.v1";
/** حدود بصمة manifest: نفس حدود assertBoundedData وحجم manifest (contracts.js). */
const PRINT_LIMITS = Object.freeze({ bytes: 2 * LIMITS.manifest, depth: 64, nodes: 50000 });
export const DOWNGRADE_REFUSED = "DOWNGRADE_REFUSED";
/** نافذة المراقبة بعد تفعيل نسخة جديدة، وعدد أعطال العقد المتتالية التي تعيد النسخة السابقة. */
export const PROBATION_MS = 30 * 60 * 1000;
export const PROBATION_FAILS = 3;
export const OUT_OF_REPOSITORY = "لم تعد في مستودعها؛ تعمل النسخة المحفوظة على جهازك";
const printOf = async (raw) => { try { return await fingerprint(raw, PRINT_LIMITS); } catch { return null; } };
const older = (next, current) => (compareVersions(next, current) ?? 0) < 0;
const downgradeError = (next, current) => Object.assign(
  new Error(`الإصدار ${next} أقدم من المثبت ${current}؛ رُفض. للرجوع استعمل «النسخة السابقة»`),
  { code: DOWNGRADE_REFUSED },
);
// عمليًا بلا حد (Stremio المعتاد أقل من 20)؛ المساحة الفعلية تحرس نفسها: حفظ فاشل يُرجع التثبيت برسالة واضحة
const MAX_INSTALLED = 300;
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
    // سجلات محفوظة لا يقرؤها هذا الإصدار (ولا نسختها السابقة): تبقى على القرص كما هي ولا تُحذف
    dormant = [],
    // مراقبة ما بعد التفعيل: key → عدد أعطال العقد المتتالية
    probation = new Map(),
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
  const pinned = (key) => {
    const current = pins.get(JSON.stringify([profileKey, key]));
    if (current !== undefined) return current;
    return (entries.get(key)?.formerKeys ?? []).some(old => pins.get(JSON.stringify([profileKey, old])) === true);
  };
  function safeFormerKey(value, id) {
    if (typeof value !== "string") return false;
    const split = value.indexOf("|");
    try { return value === `${publicUrl(value.slice(0, split)).origin}|${id}`; } catch { return false; }
  }
  function resolveKey(key) {
    if (entries.has(key)) return key;
    return [...entries.values()].find(row => row.formerKeys?.includes(key))?.manifest.key ?? key;
  }
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
    // كل سجل يُقرأ من نسخته المحلية وحدها، ولا يحتاج مستودعه. النسخة الفاعلة تالفة (بصمتها لا
    // تطابق) أو لا يقبلها هذا الإصدار ⇒ النسخة السابقة (LKG) إن صلحت، وإلا يُحفظ السجل كما هو.
    const accept = async (slot) => {
      if (!slot?.manifestRaw || typeof slot.url !== "string") return null;
      assertBoundedData(slot.manifestRaw);
      if (slot.sha256 && (await printOf(slot.manifestRaw)) !== slot.sha256) return null;
      const checked = validateManifest(slot.manifestRaw, { origin: publicUrl(slot.url).origin });
      return checked.errors.length ? null : checked.manifest;
    };
    for (const row of (Array.isArray(saved?.value) ? saved.value : []).slice(0, MAX_INSTALLED * 2)) {
      try {
        let manifest = await accept(row).catch(() => null), next = row;
        if (!manifest && row?.previous) {
          const previous = await accept(row.previous).catch(() => null);
          if (previous && !entries.has(previous.key)) {
            manifest = previous;
            next = { ...row, ...row.previous, previous: null, staged: null, cacheEpoch: crypto.randomUUID(), activatedAt: null,
              restored: { at: clock(), from: row.manifest?.version ?? null, to: previous.version, reason: "النسخة الفاعلة تالفة أو غير متوافقة؛ عادت النسخة السابقة السليمة" } };
          }
        }
        if (!manifest || entries.has(manifest.key)) { if (row && typeof row === "object") dormant.push(row); continue; }
        entries.set(manifest.key, {
          ...next,
          manifest,
          formerKeys: (Array.isArray(next.formerKeys) ? next.formerKeys.slice(-50) : []).filter(value => safeFormerKey(value, manifest.id)),
        });
      } catch {
        /* سجل إضافة تالف لا يعطل core، ولا يُحذف من القرص */
        if (row && typeof row === "object") dormant.push(row);
      }
    }
  })();
  const mb = (n) => `${(n / 2 / 1024 / 1024).toFixed(1)}MB`;
  // السبب كما قاسه المخزن: حجم السجل، أو امتلاء القرص، أو اسم خطأ IndexedDB كما هو
  const storeFailure = (prefix) => {
    const f = store.failure?.();
    if (f?.reason === "too_large") return new Error(`${prefix}؛ سجل الإضافات ${mb(f.bytes)} أكبر من حده ${mb(f.limit)}`);
    if (f?.reason === "quota") return new Error(`${prefix}؛ مساحة التخزين في الجهاز ممتلئة`);
    return new Error(`${prefix}؛ رفض التخزين الكتابة (${f?.reason ?? "سبب غير معروف"})`);
  };
  const save = async () => {
    if ((await store.set("state", STORAGE, [...entries.values(), ...dormant])) === false)
      throw storeFailure("تعذر حفظ الإضافات");
  };
  /**
   * ختم البصمة بعد التثبيت (Plugin Vault): sha256 لنص manifest القانوني يُحسب في الخلفية ويُحفظ
   * مع السجل، فيُكشف عند الإقلاع أي تلف للنسخة على القرص ويُرجع لـLKG. لا يؤخر التثبيت نفسه.
   */
  const seal = (r) => {
    const raw = r.manifestRaw;
    void printOf(raw).then((sha) => {
      if (!sha || r.sha256 === sha) return;
      return mutate(async () => {
        if (entries.get(r.manifest.key) !== r || r.manifestRaw !== raw) return;
        r.sha256 = sha;
        if (r.previous && !r.previous.sha256) r.previous.sha256 = await printOf(r.previous.manifestRaw);
        try { await save(); } catch { /* الختم يُعاد في التثبيت التالي */ }
      });
    }).catch(() => {});
  };
  /** «لم تعد في مستودعها»: رابطها يعيد 404/410. النسخة المحلية تبقى فاعلة كما هي. */
  const noteUpstream = async (r, error) => {
    const missing = error?.status === 404 || error?.status === 410;
    const before = r.upstream ?? null;
    const next = missing ? { state: "missing", at: clock(), status: error.status, reason: OUT_OF_REPOSITORY } : null;
    if ((before?.state ?? null) === (next?.state ?? null)) return;
    r.upstream = next;
    try { await save(); } catch { r.upstream = before; }
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
    sha256: row.sha256 ?? null,
    inRepository: row.upstream?.state !== "missing",
    upstream: row.upstream ? structuredClone(row.upstream) : null,
    restored: row.restored ? structuredClone(row.restored) : null,
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
  function install(preview, { replace = true, expectedCacheEpoch, replaceKey } = {}) {
    return mutate(async () => {
      const hidden = previews.get(preview);
      if (!hidden) throw new Error("عاين الإضافة أولًا");
      const checked = validateManifest(hidden.raw, { origin: new URL(hidden.url).origin });
      if (checked.errors.length) throw new Error("بيانات الإضافة غير متوافقة");
      const m = checked.manifest, target = entries.get(m.key), before = replaceKey ? row(replaceKey) : target;
      if (replaceKey && before.manifest.id !== m.id) throw new Error("هوية الإضافة مختلفة عن الإعداد المراد استبداله");
      if (replaceKey && target && target !== before) throw new Error("يوجد إعداد مثبت على هذا المضيف؛ راجعه قبل الاستبدال");
      const beforeKey = before?.manifest.key, moved = beforeKey && beforeKey !== m.key;
      if (expectedCacheEpoch !== undefined && before?.cacheEpoch !== expectedCacheEpoch) {
        previews.delete(preview);
        return null;
      }
      if (before && replace === false) {
        previews.delete(preview);
        return view(before);
      }
      if (before && before.url === hidden.url && canonicalData(before.manifestRaw) === canonicalData(hidden.raw)) {
        previews.delete(preview);
        return view(before);
      }
      if (!before && entries.size >= MAX_INSTALLED) throw new Error(`الحد الأقصى ${MAX_INSTALLED} إضافة مثبتة`);
      if (before && sessions) throw new Error("انتظر انتهاء الجلسة قبل استبدال نسخة الإضافة");
      if (before && older(m.version, before.manifest.version)) throw downgradeError(m.version, before.manifest.version);
      const next = {
        manifest: m, manifestRaw: structuredClone(hidden.raw), url: hidden.url, sha256: null,
        ...(before && !moved ? { activatedAt: clock() } : {}),
        enabled: before?.enabled ?? true, installedAt: before?.installedAt ?? clock(),
        cacheEpoch: crypto.randomUUID(), staged: null,
        previous: before && !moved ? { manifest: before.manifest, manifestRaw: before.manifestRaw, url: before.url, sha256: before.sha256 ?? null } : null,
        formerKeys: before ? [...new Set([...(before.formerKeys ?? []), ...(moved ? [beforeKey] : [])])].filter(key => key !== m.key).slice(-50) : [],
      };
      if (moved) entries.delete(beforeKey);
      entries.set(m.key, next);
      try { await save(); }
      catch (e) { entries.delete(m.key); if (before) entries.set(beforeKey, before); throw e; }
      previews.delete(preview);
      health.reset(m.key);
      if (moved) health.reset(beforeKey);
      seal(next);
      return view(next);
    });
  }
  // Reinstallation is a fresh request to the saved (possibly secret-bearing)
  // endpoint. Never remove first or silently replace it with a public default.
  function reinstall(key, { signal } = {}) {
    return mutate(async () => {
      key = resolveKey(key);
      const before = row(key);
      const cancelled = () => {
        if (signal?.aborted) throw new DOMException("ألغي إعادة التثبيت", "AbortError");
      };
      cancelled();
      if (sessions) throw new Error("انتظر انتهاء الجلسة قبل إعادة تثبيت الإضافة");
      let raw;
      try {
        raw = await transport.json(before.url, { signal, limit: LIMITS.manifest, cache: "no-store" });
      } catch (error) {
        if (error?.name !== "AbortError") await noteUpstream(before, error);
        throw error;
      }
      cancelled();
      assertBoundedData(raw);
      const checked = validateManifest(raw, { origin: publicUrl(before.url).origin });
      if (checked.errors.length) throw new Error("بيانات إعادة التثبيت غير متوافقة؛ احتُفظ بالإضافة السابقة");
      const manifest = checked.manifest;
      if (manifest.key !== key || manifest.protocol !== before.manifest.protocol)
        throw new Error("هوية إعادة التثبيت مختلفة؛ احتُفظ بالإضافة السابقة");
      if (older(manifest.version, before.manifest.version)) throw downgradeError(manifest.version, before.manifest.version);
      if (manifest.configuration?.required && !manifest.configuration.configured)
        throw Object.assign(new Error("تحتاج الخدمة إلى إعداد؛ احتُفظ بالإضافة السابقة ورابطها"), { code: "CONFIG_REQUIRED" });
      if (manifest.baseUrl !== before.manifest.baseUrl || canonicalData([...manifest.permissions.networkHosts].sort()) !== canonicalData([...before.manifest.permissions.networkHosts].sort()))
        throw new Error("مصدر الإضافة أو صلاحيات الشبكة تغيرت؛ عاين التحديث أولًا");
      if (sessions) throw new Error("انتظر انتهاء الجلسة قبل إعادة تثبيت الإضافة");
      const next = {
        ...before,
        manifest, manifestRaw: structuredClone(raw), sha256: null, cacheEpoch: crypto.randomUUID(), staged: null,
        upstream: null, restored: null, activatedAt: clock(),
        previous: { manifest: before.manifest, manifestRaw: before.manifestRaw, url: before.url, sha256: before.sha256 ?? null },
      };
      // Publish in memory only after the complete replacement is durable.
      const replacement = [...[...entries.values()].map(entry => entry === before ? next : entry), ...dormant];
      if ((await store.set("state", STORAGE, replacement)) === false)
        throw storeFailure("تعذر حفظ إعادة التثبيت واحتُفظ بالإضافة السابقة");
      entries.set(key, next);
      probation.delete(key);
      health.reset(key);
      seal(next);
      await flushHealth();
      return view(next);
    });
  }
  function configurationUrl(key) {
    const r = row(key);
    // كما يفعل Stremio: «configure» بجانب manifest.json في مساره نفسه. إضافة على مسار فرعي
    // (site.com/addon/manifest.json) صفحتها site.com/addon/configure، وجذر الموقع يعيد 404.
    // المسار لا يذهب إلا لمضيف الإضافة نفسه، والاستعلام (?token=…) لا يُنقل.
    const u = new URL(r.url);
    u.search = '';
    u.hash = '';
    u.pathname = /\/manifest\.json$/.test(u.pathname) ? u.pathname.replace(/manifest\.json$/, 'configure') : '/configure';
    return u.href;
  }
  function row(key) {
    const r = entries.get(resolveKey(key));
    if (!r) throw new Error("إضافة خارجية غير مثبتة");
    return r;
  }
  function pin(key, value) {
    const pinKey = JSON.stringify([profileKey, key]);
    return mutate(async () => {
      if (!entries.has(resolveKey(key)) && !coreAdapters.some((c) => c.key === key)) throw new Error("الإضافة غير موجودة");
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
      key = resolveKey(key);
      const before = row(key);
      entries.delete(key);
      try { await save(); } catch (e) { entries.set(key, before); throw e; }
      health.reset(key);
    });
  }
  function stage(key) {
    return mutate(async () => {
      const r = row(key);
      let p;
      try { p = await inspect(r.url); }
      catch (error) { if (error?.name !== "AbortError") await noteUpstream(r, error); throw error; }
      const h = previews.get(p);
      await noteUpstream(r, null);
      if (p.manifest.key !== key) throw new Error("معرف التحديث تغير");
      previews.delete(p);
      if (canonicalData(r.manifestRaw) === canonicalData(h.raw)) return { changed: false };
      // لا رجوع لإصدار أقدم من المستودع (TUF): فهرس قديم أو متلاعب به لا يعيد ثغرة أُصلحت
      if (older(p.manifest.version, r.manifest.version)) return { changed: false, refused: DOWNGRADE_REFUSED, version: p.manifest.version };
      const before = r.staged;
      r.staged = { manifest: structuredClone(p.manifest), manifestRaw: h.raw, url: h.url, sha256: null };
      try { await save(); } catch (e) { r.staged = before; throw e; }
      return { changed: true };
    });
  }
  function activateStaged(key) {
    return mutate(async () => {
      key = resolveKey(key);
      key = resolveKey(key);
      const r = row(key);
      if (sessions || !r.staged) return false;
      const checked = validateManifest(r.staged.manifestRaw, { origin: publicUrl(r.staged.url).origin });
      if (checked.errors.length || checked.manifest.key !== key)
        throw new Error("النسخة الجديدة غير متوافقة");
      if (r.staged.sha256 && (await printOf(r.staged.manifestRaw)) !== r.staged.sha256)
        throw new Error("النسخة الجديدة تالفة على الجهاز؛ احتُفظ بالحالية");
      if (older(checked.manifest.version, r.manifest.version)) throw downgradeError(checked.manifest.version, r.manifest.version);
      const before = structuredClone(r);
      r.previous = { manifest: r.manifest, manifestRaw: r.manifestRaw, url: r.url, sha256: r.sha256 ?? null };
      // تبديل ذري: يُحفظ كاملًا، وأي فشل حفظ يعيد السجل كما كان
      Object.assign(r, r.staged, { manifest: checked.manifest, staged: null, cacheEpoch: crypto.randomUUID(), activatedAt: clock(), restored: null });
      try { await save(); } catch (e) { entries.set(key, before); throw e; }
      probation.delete(key);
      health.reset(key);
      seal(r);
      return true;
    });
  }
  function rollback(key, { reason = null } = {}) {
    return mutate(async () => {
      key = resolveKey(key);
      const r = row(key);
      if (sessions || !r.previous) throw new Error("لا توجد نسخة سابقة قابلة للرجوع الآن");
      const prev = r.previous;
      const checked = validateManifest(prev.manifestRaw, { origin: publicUrl(prev.url).origin });
      if (checked.errors.length || checked.manifest.key !== key)
        throw new Error("النسخة السابقة غير متوافقة");
      if (prev.sha256 && (await printOf(prev.manifestRaw)) !== prev.sha256)
        throw new Error("النسخة السابقة تالفة على الجهاز");
      const before = structuredClone(r);
      Object.assign(r, prev, { manifest: checked.manifest, previous: null, staged: null, cacheEpoch: crypto.randomUUID(), activatedAt: null,
        restored: reason ? { at: clock(), from: before.manifest.version, to: checked.manifest.version, reason } : null });
      try { await save(); } catch (e) { entries.set(key, before); throw e; }
      probation.delete(key);
      health.reset(key);
      return true;
    });
  }
  /**
   * مراقبة ما بعد التفعيل (§3.3 خطوة 6): نتيجة كل نداء حقيقي لإضافة. `structural`: عطل في عقد
   * الإضافة نفسها (بيانات مخالفة، JSON تالف)، لا عطل الموقع ولا الشبكة. ثلاثة أعطال متتالية
   * خلال نصف ساعة من تفعيل نسخة جديدة ⇒ تعود النسخة السابقة تلقائيًا ويُذكر السبب بالعربية.
   */
  function observe(key, { ok, structural = false } = {}) {
    key = resolveKey(key);
    const r = entries.get(key);
    if (!r) return Promise.resolve(false);
    if (ok) { probation.delete(key); return Promise.resolve(false); }
    if (!structural || !r.previous || !r.activatedAt || clock() - r.activatedAt > PROBATION_MS) return Promise.resolve(false);
    const fails = (probation.get(key) ?? 0) + 1;
    probation.set(key, fails);
    if (fails < PROBATION_FAILS || sessions) return Promise.resolve(false);
    const reason = `تعطّلت النسخة ${r.manifest.version} بعد تفعيلها؛ عادت النسخة السابقة ${r.previous.manifest.version} تلقائيًا`;
    return rollback(key, { reason }).catch(() => false);
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
    reinstall,
    install,
    enable,
    remove,
    stage,
    activateStaged,
    rollback,
    observe,
    snapshot,
    connection,
    resolveKey,
    health,
  };
}
