import { createAddonRuntime } from '../addons/runtime.js';
import { publicUrl } from '../addons/manifest.js';
import { LIMITS } from '../addons/contracts.js';
import { loadDesktopSources } from '../pwa/platform.js';
import { createDesktopFetcher } from './source-fetcher.js';

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

export function createDesktopRuntime({ bridge = globalThis.VantaraDesktop, storage = globalThis.localStorage, definitions = null } = {}) {
  const store = createDesktopStore(storage);
  const fetcher=createDesktopFetcher(bridge);
  const runtime = { runtimeName:'desktop',native:false,torrentSupported:true,addonStreams:true,registry:{list:()=>[],def:()=>null,source:()=>null},store,addonStore:store,fetcher,ensureMedia:async()=>null };
  runtime.ready=(async()=>{
    const modules=await loadDesktopSources({VantaraDesktop:bridge});
    if(!modules)return;
    const defs=definitions ?? await fetch('/pwa/sources/defs.json').then(r=>r.ok?r.json():{sources:[]}).then(d=>d.sources ?? []).catch(()=>[]);
    runtime.store=modules.createStore({name:'vantara-desktop-sources'});
    runtime.registry=modules.createRegistry({engines:modules.engines,store:runtime.store,ctx:{fetch:fetcher,hosts:modules.createHostResolver(fetcher)}});
    await runtime.registry.init(defs.map(def=>def.edge==='challenge'?{...def,edge:undefined}:def));
  })();
  runtime.addons = createAddonRuntime({ runtime, store, transport: createDesktopTransport(bridge) });
  return runtime;
}
// صاحب سجل واحد لكل سياق renderer؛ السياقات المحقونة في الاختبارات مستقلة.
const runtimes = new WeakMap();
export function getRuntime(g = globalThis) {
  const bridge = g.VantaraDesktop;
  const existing = runtimes.get(g);
  if (existing && existing.bridge === bridge) return existing.runtime;
  const runtime = createDesktopRuntime({ bridge: bridge ?? null, storage: g.localStorage ?? null });
  runtimes.set(g, { bridge, runtime });
  return runtime;
}
