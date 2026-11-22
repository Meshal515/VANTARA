import { createAddonRuntime } from '../addons/runtime.js';
import { publicUrl } from '../addons/manifest.js';
import { LIMITS } from '../addons/contracts.js';
import { loadDesktopSources } from '../pwa/platform.js';
import { createDesktopFetcher } from './source-fetcher.js';
import { guardFetcher } from '../lib/host-breaker.js';
import { createStore, SPACES } from '../lib/idb-store.js';

/**
 * إضافات ويندوز ومخزنها (خطة التخزين، المرحلة 1): كانت الإضافات المثبتة وكاش ردودها (روابط تشغيل، ترجمات، كتالوجات)
 * كلها في localStorage بلا حذف أبدًا، فيمتلئ مع الاستعمال. الآن قاعدة IndexedDB مستقلة على قرص الجهاز كما في APK والويب:
 * مساحة `state` (الإضافات وإعداداتها) بلا انتهاء ولا تنظيف، و`source` (الكاش) بحد وانتهاء وكنس.
 */
const ADDON_SPACES = { ...SPACES, state: { ttlMs: Infinity, maxBytes: 16 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024 } };
const LEGACY_PREFIX = 'vantara.desktop.';
const MIGRATED = '__migratedFromLocalStorage.v1';
const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };

/**
 * ترحيل بلا فقد: كل مدخل `state` قديم يُنسخ للقاعدة الجديدة ثم يُقرأ ويُقارن، والنسخة القديمة **تبقى** احتياطًا (صغيرة)؛
 * الكاش القديم (`source`، `meta`) وحده يُحذف لأنه يُعاد إنشاؤه. مرة واحدة (علامة في القاعدة الجديدة)، وتُعاد إن فُقدت
 * القاعدة الجديدة فيُستعاد ما كان مثبتًا. لا يُكتب فوق مدخل موجود في الجديد.
 */
export async function migrateDesktopAddons(storage, target) {
  const report = { moved: 0, kept: 0, failed: [], dropped: 0 };
  if (!storage || !target) return report;
  if ((await target.get('state', MIGRATED).catch(() => null))?.value) return report;
  const keys = [];
  try { for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(LEGACY_PREFIX)) keys.push(k); } } catch { return report; }
  for (const key of keys) {
    const rest = key.slice(LEGACY_PREFIX.length);
    const ns = rest.slice(0, rest.indexOf('.'));
    const inner = rest.slice(ns.length + 1);
    if (ns === 'state') {
      let raw = null;
      try { raw = JSON.parse(storage.getItem(key) ?? 'null'); } catch { report.failed.push(inner); continue; }
      if (!raw || !('value' in raw)) continue;
      const existing = await target.get('state', inner).catch(() => null);
      if (existing) { report.kept++; continue; }
      const ok = await target.set('state', inner, raw.value).catch(() => false);
      const back = ok !== false ? await target.get('state', inner).catch(() => null) : null;
      if (back && same(back.value, raw.value)) report.moved++;
      else report.failed.push(inner);
    } else if (ns === 'source' || ns === 'meta') {
      try { storage.removeItem(key); report.dropped++; } catch { /* */ }
    }
  }
  // العلامة فقط إن نُقل كل شيء: فشل مدخل = يُعاد في الإقلاع التالي، والقديم باقٍ
  if (!report.failed.length) await target.set('state', MIGRATED, { at: Date.now(), moved: report.moved }).catch(() => false);
  return report;
}

/** مخزن ينتظر الترحيل قبل أي نداء: لا تُقرأ الإضافات من قاعدة لم تُملأ بعد. */
function afterMigration(target, ready) {
  const out = {};
  for (const [name, fn] of Object.entries(target)) out[name] = typeof fn === 'function' ? async (...args) => { await ready; return fn(...args); } : fn;
  return out;
}

/** تخزين دائم تحت أصل vantara://app الثابت، بلا حساب أو token ضمن النقل. */
export function createDesktopStore(storage = globalThis.localStorage) {
  const memory = new Map();
  const keyOf = (ns, key) => `vantara.desktop.${ns}.${key}`;
  return {
    async get(ns, key) {
      const id = keyOf(ns, key);
      let raw;
      try { raw = storage ? JSON.parse(storage.getItem(id) ?? 'null') : memory.get(id); }
      catch { return null; }
      return raw ? { value: raw.value, stale: raw.expiresAt != null && raw.expiresAt <= Date.now() } : null;
    },
    async set(ns, key, value, { ttlMs } = {}) {
      const id = keyOf(ns, key), entry = { value, expiresAt: Number.isFinite(ttlMs) ? Date.now() + ttlMs : null };
      try {
        if (storage) storage.setItem(id, JSON.stringify(entry));
        else memory.set(id, entry);
        return true;
      } catch { return false; }
    },
    async delete(ns, key) {
      const id = keyOf(ns, key);
      if (storage) storage.removeItem(id);
      memory.delete(id);
    },

  };
}

export function createDesktopTransport(bridge = globalThis.VantaraDesktop) {
  if (!bridge?.requestResource) throw new Error('جسر شبكة ويندوز غير متاح');
  async function text(url, { signal, json = false, limit = LIMITS.resource, timeout = 15000 } = {}) {
    if (signal?.aborted) throw new DOMException('ألغي طلب الإضافة', 'AbortError');
    const out = await bridge.requestResource({ url: publicUrl(url).href, json, limit, timeout });
    if (signal?.aborted) throw new DOMException('ألغي طلب الإضافة', 'AbortError');
    if (out.status < 200 || out.status >= 300) throw Object.assign(new Error(`الإضافة أعادت HTTP ${out.status}`), { status: out.status });
    if (typeof out.text !== 'string') throw new Error('الإضافة أعادت استجابة غير صالحة');
    return out.text;
  }
  return { text, async json(url, options = {}) {
    const raw = await text(url, { ...options, json: true });
    try { return JSON.parse(raw); } catch { throw new Error('الإضافة لم تُرجع JSON صالحًا'); }
  } };
}

export function createDesktopRuntime({ bridge = globalThis.VantaraDesktop, storage = globalThis.localStorage, definitions = null, indexedDB = globalThis.indexedDB ?? null } = {}) {
  // قبل جاهزية مصادر ويندوز: ذاكرة فقط (كاش الصفحات الأولى)، لا localStorage
  const store = createDesktopStore(null);
  const addonDb = indexedDB ? createStore({ name: 'vantara-desktop-addons', indexedDB, spaces: ADDON_SPACES }) : null;
  const addonStore = addonDb ? afterMigration(addonDb, migrateDesktopAddons(storage, addonDb).catch(() => null)) : createDesktopStore(storage);
  const fetcher=createDesktopFetcher(bridge);
  const runtime = { runtimeName:'desktop',native:false,torrentSupported:true,addonStreams:true,registry:{list:()=>[],def:()=>null,source:()=>null},store,addonStore,fetcher,ensureMedia:async()=>null };
  runtime.ready=(async()=>{
    const modules=await loadDesktopSources({VantaraDesktop:bridge});
    if(!modules)return;
    // تعذّر قراءة الحزمة ⇒ null: المصادر المثبتة تعمل من نسخها المحلية ولا يُحذف شيء (Plugin Vault)
    const bundle=definitions ? {sources:definitions,blocked:[]} : await fetch('/pwa/sources/defs.json').then(r=>r.ok?r.json():null).then(d=>Array.isArray(d?.sources)?{sources:d.sources,blocked:Array.isArray(d.blocked)?d.blocked:[]}:null).catch(()=>null);
    runtime.store=modules.createStore({name:'vantara-desktop-sources'});
    const durable={store:modules.createStore({name:'vantara-desktop-vault',spaces:{vault:{ttlMs:Infinity,maxBytes:64*1024*1024,maxEntryBytes:2*1024*1024}}}),ns:'vault'};
    const guarded=guardFetcher(fetcher);
    runtime.registry=modules.createRegistry({engines:modules.engines,store:runtime.store,durable,ctx:{fetch:guarded,hosts:modules.createHostResolver(guarded)}});
    await runtime.registry.init(bundle ? bundle.sources.map(def=>def.edge==='challenge'?{...def,edge:undefined}:def) : null,{blocked:bundle?.blocked ?? []});
  })();
  runtime.addons = createAddonRuntime({ runtime, store: addonStore, transport: createDesktopTransport(bridge) });
  // كنس الكاش المنتهي بعد أن تهدأ الشاشة الأولى (المساحة state لا تُكنس: بلا انتهاء)
  if (addonDb) setTimeout(() => { void addonStore.sweep?.().catch?.(() => {}); }, 20_000)?.unref?.();
  return runtime;
}
// صاحب سجل واحد لكل سياق renderer؛ السياقات المحقونة في الاختبارات مستقلة.
const runtimes = new WeakMap();
export function getRuntime(g = globalThis) {
  const bridge = g.VantaraDesktop;
  const existing = runtimes.get(g);
  if (existing && existing.bridge === bridge) return existing.runtime;
  const runtime = createDesktopRuntime({ bridge: bridge ?? null, storage: g.localStorage ?? null, indexedDB: g.indexedDB ?? null });
  runtimes.set(g, { bridge, runtime });
  return runtime;
}
