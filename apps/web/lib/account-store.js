/** Account recovery copies never share localStorage's small string quota.
 * Each IndexedDB record commits the mirror AND its cursor in one transaction.
 * Android also keeps an AtomicFile copy outside WebView storage. Neither copy
 * is deleted when the other fails, and records are always scoped to an account.
 */
// Capacitor 6 receives every JS→native call through WebMessageListener, which parses the whole
// message (JSONTokener) on Android's main thread — the thread that drives WebView touch and fling.
// A full account mirror is large, so writing it there mid-scroll stopped the reader for 150–250ms
// (Debug APK stall report). When IndexedDB already committed the record, the Android copy waits for
// a calm moment: no scroll/touch for NATIVE_CALM_MS, latest record per account+kind only, never
// longer than NATIVE_MAX_DEFER_MS, and at once when the app is hidden. Without IndexedDB the
// Android file is the only copy and is written immediately, as before.
const NATIVE_CALM_MS = 1_500;
const NATIVE_MAX_DEFER_MS = 60_000;
const INTERACTIONS = ['scroll', 'touchstart', 'touchmove', 'wheel', 'pointerdown'];

export function createAccountStore({ page = globalThis.document } = {}) {
  let opening;
  const database = () => opening ??= new Promise((resolve) => {
    if (!globalThis.indexedDB) return resolve(null);
    try {
      const request = indexedDB.open('vantara-account-recovery', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('snapshot');
        request.result.createObjectStore('queue');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  async function idb(kind, userId, value) {
    const db = await database();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(kind, value === undefined ? 'readonly' : 'readwrite');
        const store = transaction.objectStore(kind);
        const request = value === undefined ? store.get(userId) : store.put(value, userId);
        transaction.oncomplete = () => resolve(value === undefined ? request.result ?? null : true);
        transaction.onerror = transaction.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  const plugin = () => globalThis.Capacitor?.Plugins?.AccountBackup;
  async function native(kind, userId, value) {
    const backup = plugin();
    if (!backup) return null;
    try {
      if (value === undefined) {
        const result = await backup.read({ userId, kind });
        const parsed = result?.value ? JSON.parse(result.value) : null;
        return parsed?.userId === userId ? parsed : null;
      }
      await backup.write({ userId, kind, value: JSON.stringify(value) });
      return true;
    } catch { return null; }
  }
  let lastInteraction = 0;
  const deferred = new Map();
  let calmTimer = null;
  const sendDeferred = (key) => {
    const entry = deferred.get(key);
    if (!entry) return;
    deferred.delete(key);
    void native(entry.kind, entry.userId, entry.record);
  };
  const flushDeferred = () => {
    clearTimeout(calmTimer);
    calmTimer = null;
    for (const key of [...deferred.keys()]) sendDeferred(key);
  };
  const checkCalm = () => {
    calmTimer = null;
    const now = Date.now();
    const quietFor = now - lastInteraction;
    for (const [key, entry] of [...deferred]) {
      if (quietFor >= NATIVE_CALM_MS || now - entry.since >= NATIVE_MAX_DEFER_MS) sendDeferred(key);
    }
    if (deferred.size) calmTimer = setTimeout(checkCalm, Math.max(100, NATIVE_CALM_MS - quietFor));
  };
  if (page?.addEventListener) {
    const interacted = () => { lastInteraction = Date.now(); };
    for (const type of INTERACTIONS) page.addEventListener(type, interacted, { capture: true, passive: true });
    page.addEventListener('visibilitychange', () => { if (page.visibilityState === 'hidden') flushDeferred(); });
    globalThis.addEventListener?.('pagehide', flushDeferred);
  }
  function deferNative(kind, userId, record) {
    const key = `${kind}\n${userId}`;
    deferred.set(key, { kind, userId, record, since: deferred.get(key)?.since ?? Date.now() });
    calmTimer ??= setTimeout(checkCalm, Math.max(0, NATIVE_CALM_MS - (Date.now() - lastInteraction)));
  }
  async function read(kind, userId) {
    if (!userId) return null;
    sendDeferred(`${kind}\n${userId}`);
    const [primary, backup] = await Promise.all([idb(kind, userId), native(kind, userId)]);
    // The most recently committed copy wins; failed writes leave older copies.
    return [primary, backup].filter((row) => row?.userId === userId)
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0] ?? null;
  }
  async function write(kind, userId, value) {
    if (!userId) return false;
    const record = { ...value, userId, savedAt: Date.now() };
    if (!plugin()) return Boolean(await idb(kind, userId, record));
    if (await idb(kind, userId, record)) {
      deferNative(kind, userId, record);
      return true;
    }
    // IndexedDB failed: the Android file is the only durable copy. A deferred older record for
    // this key is superseded, never sent after this one.
    deferred.delete(`${kind}\n${userId}`);
    return Boolean(await native(kind, userId, record));
  }
  return { read, write };
}
