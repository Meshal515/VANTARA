/** Small atomic session record, independent of localStorage's string quota.
 * This contains only server-issued credentials; never a PIN or device identity.
 * A durable signed-out record prevents an older copy restoring a logged-out user.
 */
export const SESSION_RECORD_KEY = 'vantara.session.v1';

export function sessionRecord(value) {
  if (!value || !Number.isSafeInteger(value.savedAt) || value.savedAt < 0) return null;
  if (value.signedOut === true) return { signedOut: true, savedAt: value.savedAt };
  if ((value.token !== null && (typeof value.token !== 'string' || !value.token)) || typeof value.user?.userId !== 'string') return null;
  return { token: value.token, user: value.user, pinGrant: value.token && typeof value.pinGrant === 'string' ? value.pinGrant : null, savedAt: value.savedAt };
}

export function storedSession() {
  try { return sessionRecord(JSON.parse(localStorage.getItem(SESSION_RECORD_KEY) || 'null')); }
  catch { return null; }
}

export function createSessionStore() {
  let opening;
  let writes = Promise.resolve();
  const database = () => opening ??= new Promise(resolve => {
    if (!globalThis.indexedDB) return resolve(null);
    try {
      const request = indexedDB.open('vantara-session', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('session');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  async function access(value) {
    const db = await database();
    if (!db) return value === undefined ? null : false;
    return new Promise(resolve => {
      try {
        const transaction = db.transaction('session', value === undefined ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('session');
        const request = value === undefined ? store.get('current') : store.put(value, 'current');
        transaction.oncomplete = () => resolve(value === undefined ? sessionRecord(request.result) : true);
        transaction.onerror = transaction.onabort = () => resolve(value === undefined ? null : false);
      } catch { resolve(value === undefined ? null : false); }
    });
  }
  return {
    read: () => writes.then(() => access()),
    write(value) {
      const captured = sessionRecord(value);
      if (!captured) return Promise.resolve(false);
      const saved = writes.then(() => access(captured));
      writes = saved.catch(() => false);
      return saved;
    },
  };
}
