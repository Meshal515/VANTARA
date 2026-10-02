/**
 * كاش البيانات للـPWA (IndexedDB): بيانات الأعمال، ردود المصادر، صحة المصادر.
 *
 * كل مدخل في «مساحة» (namespace) لها مدة صلاحية افتراضية وحدّ حجم:
 *
 *   meta     تفاصيل الأعمال والفصول والحلقات      يوم      40 MB
 *   source   ردود المصادر الخام (بحث، قوائم)       ساعات    30 MB
 *   health   صحة المصادر وآخر نسخة سليمة           أسبوع    2 MB
 *   state    إعدادات صغيرة دائمة (الإذن، التسجيل)   بلا نهاية 1 MB
 *
 * قواعد الصخرة:
 *   - المنتهي لا يُحذف فورًا: `cached()` يرجعه حين تفشل الشبكة (stale-if-error)،
 *     فالتطبيق يفتح على آخر ما رآه بلا اتصال.
 *   - تجاوز الحد ⇒ يُطرد الأقدم استعمالًا (LRU) حتى 80% من الحد.
 *   - قاعدة تالفة أو لا تفتح ⇒ تُحذف وتُبنى من جديد مرة واحدة، وإن فشلت
 *     يعمل الكاش في الذاكرة (لا تنهار شاشة لأن التخزين معطوب).
 *   - مدخل لا يُقرأ (JSON تالف، شكل غريب) ⇒ يُحذف ويُعامل كغياب.
 */

const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

export const SPACES = Object.freeze({
  meta: { ttlMs: DAY, maxBytes: 40 * MB },
  source: { ttlMs: 6 * 60 * 60 * 1000, maxBytes: 30 * MB },
  health: { ttlMs: 7 * DAY, maxBytes: 2 * MB },
  state: { ttlMs: Infinity, maxBytes: 1 * MB },
});

const STORE = 'entries';
const DB_VERSION = 1;
/** المنتهي يبقى قابلًا للاستعمال عند الفشل هذه المدة، ثم يُكنس. */
const STALE_GRACE_MS = 30 * DAY;
/** تحديث «آخر استعمال» على القرص مرة كل عشر دقائق للمدخل، لا مع كل قراءة. */
const TOUCH_EVERY_MS = 10 * 60 * 1000;

const idOf = (ns, key) => `${ns}\u0000${key}`;

function sizeOf(value) {
  try {
    return JSON.stringify(value)?.length * 2 || 0;
  } catch {
    return Infinity;
  }
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    tx.onerror = () => reject(tx.error);
  });
}

/** كاش في الذاكرة بنفس الواجهة: البديل حين لا يعمل IndexedDB. */
function memoryBackend() {
  const map = new Map();
  return {
    kind: 'memory',
    async get(id) {
      return map.get(id) ?? null;
    },
    async put(entry) {
      map.set(entry.id, entry);
    },
    async delete(id) {
      map.delete(id);
    },
    async all(ns) {
      return [...map.values()].filter((e) => !ns || e.ns === ns);
    },
    async clear(ns) {
      for (const [id, e] of map) if (!ns || e.ns === ns) map.delete(id);
    },
  };
}

function idbBackend(db) {
  const store = (mode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    kind: 'indexeddb',
    db,
    async get(id) {
      return (await req(store('readonly').get(id))) ?? null;
    },
    async put(entry) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      await done(tx);
    },
    async delete(id) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      await done(tx);
    },
    async all(ns) {
      const s = store('readonly');
      return ns ? req(s.index('ns').getAll(ns)) : req(s.getAll());
    },
    async clear(ns) {
      const tx = db.transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      if (!ns) s.clear();
      else {
        const keys = await req(s.index('ns').getAllKeys(ns));
        for (const k of keys) s.delete(k);
      }
      await done(tx);
    },
  };
}

function openDb(factory, name) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('indexeddb_open_timeout'));
      }
    }, 4000);
    let request;
    try {
      request = factory.open(name, DB_VERSION);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('ns', 'ns');
      }
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) return void request.result.close();
      settled = true;
      const db = request.result;
      // تبويب آخر يرفع النسخة: نغلق ليمرّ، ونعيد الفتح عند أول طلب
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(request.error ?? new Error('indexeddb_open_failed'));
      }
    };
    request.onblocked = () => {
      // تبويب قديم يمسك القاعدة: المهلة تحسم
    };
  });
}

function deleteDb(factory, name) {
  return new Promise((resolve) => {
    try {
      const r = factory.deleteDatabase(name);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * @param {{ name?: string, indexedDB?: IDBFactory|null, now?: () => number, spaces?: typeof SPACES, onRecover?: (why: string) => void }} [opts]
 */
export function createStore({ name = 'vantara-pwa', indexedDB = globalThis.indexedDB ?? null, now = () => Date.now(), spaces = SPACES, onRecover = () => {} } = {}) {
  let backendPromise = null;
  const lastTouch = new Map();

  async function connect() {
    if (!indexedDB) return memoryBackend();
    try {
      return idbBackend(await openDb(indexedDB, name));
    } catch (first) {
      // قاعدة تالفة أو نسخة غريبة: تُمسح وتُبنى من جديد مرة واحدة
      onRecover(`reset:${first?.name ?? first?.message ?? 'open'}`);
      await deleteDb(indexedDB, name);
      try {
        return idbBackend(await openDb(indexedDB, name));
      } catch (second) {
        onRecover(`memory:${second?.name ?? second?.message ?? 'open'}`);
        return memoryBackend();
      }
    }
  }

  function backend() {
    backendPromise ??= connect();
    return backendPromise;
  }

  /** نداء على القاعدة، وإن وجدها مغلقة (Safari بعد الخلفية) يعيد الفتح مرة. */
  async function run(fn) {
    const b = await backend();
    try {
      return await fn(b);
    } catch (error) {
      if (b.kind !== 'indexeddb') throw error;
      const name = error?.name ?? '';
      if (name === 'InvalidStateError' || name === 'TransactionInactiveError' || name === 'UnknownError' || /closing|closed/i.test(String(error?.message))) {
        try {
          b.db.close();
        } catch {
          // مغلقة أصلًا
        }
        backendPromise = null;
        return fn(await backend());
      }
      throw error;
    }
  }

  const spaceOf = (ns) => {
    const s = spaces[ns];
    if (!s) throw new Error(`unknown cache space: ${ns}`);
    return s;
  };

  /**
   * المدخل ومعه هل انتهت صلاحيته. `null` إن لم يوجد أو كان تالفًا.
   * @returns {Promise<{ value: any, stale: boolean, storedAt: number } | null>}
   */
  async function get(ns, key) {
    spaceOf(ns);
    const id = idOf(ns, key);
    let entry;
    try {
      entry = await run((b) => b.get(id));
    } catch {
      return null;
    }
    if (!entry) return null;
    if (typeof entry !== 'object' || entry.ns !== ns || !('value' in entry) || typeof entry.expiresAt !== 'number') {
      void run((b) => b.delete(id)).catch(() => {});
      return null;
    }
    const t = now();
    if (t - (entry.accessedAt ?? 0) > TOUCH_EVERY_MS && t - (lastTouch.get(id) ?? 0) > TOUCH_EVERY_MS) {
      lastTouch.set(id, t);
      void run((b) => b.put({ ...entry, accessedAt: t })).catch(() => {});
    }
    return { value: entry.value, stale: t >= entry.expiresAt, storedAt: entry.createdAt ?? 0 };
  }

  async function set(ns, key, value, { ttlMs } = {}) {
    const space = spaceOf(ns);
    const bytes = sizeOf(value);
    // مدخل وحده أكبر من ربع المساحة لا يستحق أن يطرد غيره
    if (!Number.isFinite(bytes) || bytes > space.maxBytes / 4) return false;
    const t = now();
    const ttl = ttlMs ?? space.ttlMs;
    const entry = { id: idOf(ns, key), ns, key, value, bytes, createdAt: t, accessedAt: t, expiresAt: Number.isFinite(ttl) ? t + ttl : Number.MAX_SAFE_INTEGER };
    try {
      await run((b) => b.put(entry));
      return true;
    } catch (error) {
      if (error?.name === 'QuotaExceededError') {
        // القرص ممتلئ: نكنس هذه المساحة بقوة ونحاول مرة
        await sweep({ ns, target: 0.5 }).catch(() => {});
        try {
          await run((b) => b.put(entry));
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  async function remove(ns, key) {
    try {
      await run((b) => b.delete(idOf(ns, key)));
    } catch {
      // غائب أصلًا
    }
  }

  async function clear(ns) {
    try {
      await run((b) => b.clear(ns));
    } catch {
      // الكنس القادم يكمل
    }
  }

  /**
   * يكنس: المنتهي منذ أكثر من مهلة السماح، ثم الأقدم استعمالًا حتى `target`
   * من حد المساحة. يرجع عدد المحذوف.
   */
  async function sweep({ ns = null, target = 0.8 } = {}) {
    let removed = 0;
    const t = now();
    for (const name of ns ? [ns] : Object.keys(spaces)) {
      const { maxBytes } = spaces[name];
      let entries;
      try {
        entries = await run((b) => b.all(name));
      } catch {
        continue;
      }
      const doomed = new Set(entries.filter((e) => typeof e?.expiresAt !== 'number' || t - e.expiresAt > STALE_GRACE_MS).map((e) => e.id));
      let total = entries.filter((e) => !doomed.has(e.id)).reduce((s, e) => s + (e.bytes || 0), 0);
      if (total > maxBytes * target || target < 0.8) {
        const live = entries.filter((e) => !doomed.has(e.id)).sort((a, b) => (a.accessedAt ?? 0) - (b.accessedAt ?? 0));
        for (const e of live) {
          if (total <= maxBytes * target) break;
          doomed.add(e.id);
          total -= e.bytes || 0;
        }
      }
      for (const id of doomed) {
        try {
          await run((b) => b.delete(id));
          removed += 1;
        } catch {
          // يُعاد في الكنس القادم
        }
      }
    }
    return removed;
  }

  async function usage() {
    const out = {};
    for (const name of Object.keys(spaces)) {
      const entries = await run((b) => b.all(name)).catch(() => []);
      out[name] = { count: entries.length, bytes: entries.reduce((s, e) => s + (e.bytes || 0), 0) };
    }
    return out;
  }

  /**
   * القاعدة الذهبية: طازج ⇒ من الكاش. منتهٍ أو غائب ⇒ من الشبكة ويُخزَّن.
   * الشبكة فشلت ولدينا قديم ⇒ القديم (مع `stale: true`). لا شيء ⇒ يرمي الخطأ.
   * طلبات متزامنة لنفس المفتاح تشترك في جلب واحد.
   */
  const inflight = new Map();
  async function cached(ns, key, loader, { ttlMs, fresh = false } = {}) {
    const hit = fresh ? null : await get(ns, key);
    if (hit && !hit.stale) return { value: hit.value, stale: false, source: 'cache' };
    const id = idOf(ns, key);
    if (!inflight.has(id)) {
      inflight.set(
        id,
        (async () => {
          try {
            const value = await loader();
            await set(ns, key, value, { ttlMs });
            return { value, stale: false, source: 'network' };
          } finally {
            inflight.delete(id);
          }
        })(),
      );
    }
    try {
      return await inflight.get(id);
    } catch (error) {
      const old = hit ?? (fresh ? await get(ns, key) : null);
      if (old) return { value: old.value, stale: true, source: 'cache', error };
      throw error;
    }
  }

  return { get, set, delete: remove, clear, sweep, usage, cached, backendKind: async () => (await backend()).kind };
}
