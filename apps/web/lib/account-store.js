/** Account recovery copies never share localStorage's small string quota.
 * Each IndexedDB record commits the mirror AND its cursor in one transaction.
 * Android also keeps an AtomicFile copy outside WebView storage. Neither copy
 * is deleted when the other fails, and records are always scoped to an account.
 */
// Capacitor 6 receives every JS→native call through WebMessageListener, which parses the whole
// message (JSONTokener) on Android's main thread — the thread that drives WebView touch and fling.
// A full account mirror is large, so writing it there mid-scroll stopped the reader for 150–250ms
// (Debug APK stall report). When IndexedDB already committed the record, the Android copy waits for
// a calm moment (see checkCalm), latest record per account+kind only, retried NATIVE_ATTEMPTS
// times if the bridge write fails, and at once when the app is hidden. Without IndexedDB the
// Android file is the only copy and is written immediately, as before.
const NATIVE_CALM_MS = 1_500;
const NATIVE_MAX_DEFER_MS = 60_000;
const NATIVE_OVERDUE_CALM_MS = 300;
const NATIVE_ATTEMPTS = 3;
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
  let touching = false;
  let sequence = 0;
  const deferred = new Map();
  // Highest record per key handed to the bridge: an older record is never sent after a newer one.
  const sent = new Map();
  let calmTimer = null;
  async function sendNative(key, entry) {
    const previous = sent.get(key) ?? 0;
    if (previous >= entry.seq) return true;
    sent.set(key, entry.seq);
    const saved = await native(entry.kind, entry.userId, entry.record);
    if (saved || sent.get(key) !== entry.seq) return saved;
    // Failed and nothing newer was sent: the record stays owed, retried at a later calm moment.
    sent.set(key, previous);
    if (entry.attempts + 1 < NATIVE_ATTEMPTS && !(deferred.get(key)?.seq > entry.seq)) {
      deferred.set(key, { ...entry, attempts: entry.attempts + 1 });
      scheduleCalm();
    }
    return saved;
  }
  const sendDeferred = (key) => {
    const entry = deferred.get(key);
    if (!entry) return;
    deferred.delete(key);
    void sendNative(key, entry);
  };
  const flushDeferred = () => {
    clearTimeout(calmTimer);
    calmTimer = null;
    for (const key of [...deferred.keys()]) sendDeferred(key);
  };
  // Calm = no scroll or touch event for NATIVE_CALM_MS and no finger down. A record owed longer
  // than NATIVE_MAX_DEFER_MS only needs a short pause (fling finished), never a write mid-scroll.
  const needsQuiet = (entry, now) => now - entry.since >= NATIVE_MAX_DEFER_MS ? NATIVE_OVERDUE_CALM_MS : NATIVE_CALM_MS;
  function checkCalm() {
    calmTimer = null;
    const now = Date.now();
    const quietFor = now - lastInteraction;
    if (!touching) for (const [key, entry] of [...deferred]) if (quietFor >= needsQuiet(entry, now)) sendDeferred(key);
    scheduleCalm();
  }
  function scheduleCalm() {
    if (calmTimer || !deferred.size) return;
    const now = Date.now();
    const quiet = Math.min(...[...deferred.values()].map((entry) => needsQuiet(entry, now)));
    calmTimer = setTimeout(checkCalm, Math.max(100, quiet - (now - lastInteraction)));
  }
  if (page?.addEventListener) {
    const interacted = () => { lastInteraction = Date.now(); };
    const options = { capture: true, passive: true };
    for (const type of INTERACTIONS) page.addEventListener(type, interacted, options);
    page.addEventListener('touchstart', () => { touching = true; }, options);
    for (const type of ['touchend', 'touchcancel']) page.addEventListener(type, () => { touching = false; interacted(); }, options);
    page.addEventListener('visibilitychange', () => { if (page.visibilityState === 'hidden') flushDeferred(); });
    globalThis.addEventListener?.('pagehide', flushDeferred);
  }
  async function read(kind, userId) {
    if (!userId) return null;
    // A record still owed to the Android file is already in memory: use it, do not send it now.
    const owed = deferred.get(`${kind}\n${userId}`)?.record ?? null;
    const [primary, backup] = await Promise.all([idb(kind, userId), native(kind, userId)]);
    // The most recently committed copy wins; failed writes leave older copies.
    return [primary, backup, owed].filter((row) => row?.userId === userId)
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0] ?? null;
  }
  async function write(kind, userId, value) {
    if (!userId) return false;
    const record = { ...value, userId, savedAt: Date.now() };
    const key = `${kind}\n${userId}`;
    const seq = ++sequence;
    if (!plugin()) return Boolean(await idb(kind, userId, record));
    if (await idb(kind, userId, record)) {
      if (!(deferred.get(key)?.seq > seq)) {
        deferred.set(key, { kind, userId, record, seq, attempts: 0, since: deferred.get(key)?.since ?? Date.now() });
        scheduleCalm();
      }
      return true;
    }
    // IndexedDB failed: the Android file is the only durable copy, written now. An older owed
    // record is dropped only once this newer one is saved (sendNative never sends it after).
    const saved = Boolean(await sendNative(key, { kind, userId, record, seq, attempts: NATIVE_ATTEMPTS }));
    if (saved && deferred.get(key)?.seq < seq) deferred.delete(key);
    return saved;
  }
  return { read, write };
}
