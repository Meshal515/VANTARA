/**
 * تشغيل الـPWA: جالب + كاش + سجل مصادر، نسخة واحدة للتطبيق كله.
 * يُنشأ عند أول نداء من جسر (pwa/bridges/*)، لا عند الإقلاع.
 */

import { createFetcher } from './net/fetcher.js';
import { fetchBase } from './net/endpoint.js';
import { createStore } from './cache/store.js';
import { publishConfig, requestPersistence } from './cache/images.js';
import { createRegistry } from './sources/registry.js';
import { ENGINES } from './sources/engines/index.js';
import { createHostResolver } from './sources/hosts.js';

let auth = { header: () => readToken(), refresh: null };
let runtime = null;

function readToken() {
  try {
    const token = globalThis.localStorage?.getItem('vantara.token');
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
  }
}

/** app.js يربط جلسة المزامنة (التوكن وتجديده). بدونه نقرأ التوكن المحفوظ. */
export function attachAuth(next) {
  auth = { header: next?.header ?? readToken, refresh: next?.refresh ?? null };
}

async function loadDefs() {
  const res = await fetch('/pwa/sources/defs.json', { cache: 'no-cache' }).catch(() => null);
  if (res?.ok) return (await res.json()).sources ?? [];
  // دون اتصال: القشرة المخزنة تحمل نسخة defs.json (service worker)
  return [];
}

export function getRuntime() {
  if (runtime) return runtime;
  const store = createStore();
  const fetcher = createFetcher({ auth: { header: () => auth.header(), refresh: () => auth.refresh?.() } });
  const registry = createRegistry({ engines: ENGINES, store, ctx: { fetch: fetcher, hosts: createHostResolver(fetcher) } });
  let published = null; // { grant, at, promise }

  /**
   * الإذن + إعلام الـservice worker به (للصور). كل المتصلين ينتظرون نفس
   * الكتابة: صورة لا تُطلب من الـSW قبل أن يعرف الإذن (وإلا 503).
   */
  async function ensureMedia() {
    const g = await fetcher.ensureGrant();
    if (published?.grant !== g || Date.now() - published.at > 60 * 60 * 1000) {
      published = { grant: g, at: Date.now(), promise: publishConfig({ fetchBase: fetchBase(), grant: g }) };
    }
    await published.promise;
    return g;
  }

  const ready = (async () => {
    await registry.init(await loadDefs());
    void requestPersistence();
    // الكنس والفحص بعد أن تهدأ الشاشة الأولى
    setTimeout(() => {
      void store.sweep().catch(() => {});
      void registry.verifyPending().catch(() => {});
    }, 15_000);
  })();

  runtime = { store, fetcher, registry, ready, ensureMedia };
  return runtime;
}
