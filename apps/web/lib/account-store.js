/** Account recovery copies never share localStorage's small string quota.
 * Each IndexedDB record commits the mirror AND its cursor in one transaction.
 * Android also keeps an AtomicFile copy outside WebView storage. Neither copy
 * is deleted when the other fails, and records are always scoped to an account.
 */
export function createAccountStore() {
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
  async function read(kind, userId) {
    if (!userId) return null;
    const [primary, backup] = await Promise.all([idb(kind, userId), native(kind, userId)]);
    // The most recently committed copy wins; failed writes leave older copies.
    return [primary, backup].filter((row) => row?.userId === userId)
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0] ?? null;
  }
  async function write(kind, userId, value) {
    if (!userId) return false;
    const record = { ...value, userId, savedAt: Date.now() };
    const copies = await Promise.all([idb(kind, userId, record), native(kind, userId, record)]);
    return copies.some(Boolean);
  }
  return { read, write };
}
