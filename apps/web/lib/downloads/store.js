/**
 * مخزن التنزيلات المحلي (IndexedDB): بيان العناصر، صفحات المانجا، وفن الأعمال.
 *
 * ليس كاشًا: لا مدة صلاحية ولا طرد تلقائي. ما يُحذف هنا يُحذف بطلب المستخدم وحده.
 * IndexedDB في WebView وElectron يسكن بيانات التطبيق لا مجلد الكاش، والمتصفح يُطلب منه
 * التخزين الدائم (`navigator.storage.persist`) كي لا يُخليه عند ضيق المساحة.
 *
 * ملفات الفيديو لا تسكن هنا: محرك المنصة الأصلي يكتبها في مجلد التنزيلات الدائم،
 * وهنا وصفها ومسارها فقط.
 */

const DB = 'vantara-downloads';
const VERSION = 1;
const ITEMS = 'items';
const PAGES = 'pages';
const ART = 'art';

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    tx.onerror = () => reject(tx.error);
  });
}

/** مخزن في الذاكرة بنفس الواجهة: للاختبارات، أو متصفح بلا IndexedDB (لا يُعلن فيه التنزيل). */
export function memoryStore() {
  const items = new Map();
  const pages = new Map();
  const art = new Map();
  return {
    kind: 'memory',
    persistent: false,
    async allItems() { return [...items.values()].map((v) => structuredClone(v)); },
    async putItem(item) { items.set(item.id, structuredClone(item)); },
    async deleteItem(id) { items.delete(id); },
    async putPage(id, index, page) { pages.set(`${id}#${index}`, page); },
    async getPage(id, index) { return pages.get(`${id}#${index}`) ?? null; },
    async hasPage(id, index) { return pages.has(`${id}#${index}`); },
    async deletePages(id) { for (const k of [...pages.keys()]) if (k.startsWith(`${id}#`)) pages.delete(k); },
    async pageBytes(id) { let n = 0; for (const [k, v] of pages) if (k.startsWith(`${id}#`)) n += v.bytes ?? 0; return n; },
    async putArt(key, value) { art.set(key, value); },
    async getArt(key) { return art.get(key) ?? null; },
    async deleteArt(prefix) { for (const k of [...art.keys()]) if (k.startsWith(prefix)) art.delete(k); },
  };
}

/** يفتح مخزن IndexedDB، أو يرجع null إن تعذّر (الواجهة تقول إن التنزيل غير متاح هنا). */
export async function openStore({ indexedDB: idb = globalThis.indexedDB, name = DB } = {}) {
  if (!idb) return null;
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const open = idb.open(name, VERSION);
      open.onupgradeneeded = () => {
        const d = open.result;
        if (!d.objectStoreNames.contains(ITEMS)) d.createObjectStore(ITEMS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(PAGES)) d.createObjectStore(PAGES);
        if (!d.objectStoreNames.contains(ART)) d.createObjectStore(ART);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('blocked'));
    });
  } catch {
    return null;
  }
  let persistent = false;
  try {
    persistent = Boolean(await globalThis.navigator?.storage?.persist?.());
  } catch {
    persistent = false;
  }
  const one = async (store, mode, fn) => {
    const tx = db.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    const value = out && typeof out.onsuccess !== 'undefined' ? await req(out) : out;
    await txDone(tx);
    return value;
  };
  const keysWithPrefix = (store, prefix) => one(store, 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)));
  return {
    kind: 'indexeddb',
    persistent,
    allItems: () => one(ITEMS, 'readonly', (s) => s.getAll()),
    putItem: (item) => one(ITEMS, 'readwrite', (s) => s.put(item)),
    deleteItem: (id) => one(ITEMS, 'readwrite', (s) => s.delete(id)),
    putPage: (id, index, page) => one(PAGES, 'readwrite', (s) => s.put(page, `${id}#${String(index).padStart(5, '0')}`)),
    getPage: (id, index) => one(PAGES, 'readonly', (s) => s.get(`${id}#${String(index).padStart(5, '0')}`)).then((v) => v ?? null),
    hasPage: (id, index) => one(PAGES, 'readonly', (s) => s.count(`${id}#${String(index).padStart(5, '0')}`)).then((n) => n > 0),
    deletePages: async (id) => {
      const tx = db.transaction(PAGES, 'readwrite');
      tx.objectStore(PAGES).delete(IDBKeyRange.bound(`${id}#`, `${id}#￿`));
      await txDone(tx);
    },
    pageBytes: async (id) => {
      const keys = await keysWithPrefix(PAGES, `${id}#`);
      let n = 0;
      for (const k of keys) n += (await one(PAGES, 'readonly', (s) => s.get(k)))?.bytes ?? 0;
      return n;
    },
    putArt: (key, value) => one(ART, 'readwrite', (s) => s.put(value, key)),
    getArt: (key) => one(ART, 'readonly', (s) => s.get(key)).then((v) => v ?? null),
    deleteArt: async (prefix) => {
      const tx = db.transaction(ART, 'readwrite');
      tx.objectStore(ART).delete(IDBKeyRange.bound(prefix, `${prefix}￿`));
      await txDone(tx);
    },
  };
}
