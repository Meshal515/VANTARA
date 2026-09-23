/**
 * فصول الأعمال محفوظةً على الجهاز.
 *
 * فتح العمل كان يعني انتظار كل المصادر: الأسرع يردّ بـ36 فصلًا فيظهر كأنه
 * العدد النهائي، ثم يصل الـ600 بعد ثوانٍ. هنا آخر ما عرفناه عن كل عمل (نسخه
 * وفصول كل نسخة وتفاصيله) يُعرض فورًا، والمصادر تُسأل في الخلفية وتضيف ما جدّ.
 *
 * IndexedDB لا localStorage: فصول عمل واحد من عدة مصادر مئات الكيلوبايت.
 * وعند غيابه (متصفح خاص) يعمل كل شيء بلا كاش — أبطأ لا أقل.
 */

const DB = 'vantara-chapters';
const STORE = 'works';
const MAX_WORKS = 200;
/** قوائم الرئيسية والاستكشاف: آخر ما رأيته يُعرض قبل أن تردّ المصادر. */
const KV = 'kv';

let opening = null;
function db() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = () => {
        const names = req.result.objectStoreNames;
        if (!names.contains(STORE)) req.result.createObjectStore(STORE);
        if (!names.contains(KV)) req.result.createObjectStore(KV);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run(mode, fn, store = STORE) {
  return db().then(
    (d) =>
      d &&
      new Promise((resolve) => {
        try {
          const tx = d.transaction(store, mode);
          const out = fn(tx.objectStore(store));
          tx.oncomplete = () => resolve(out?.result ?? null);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** @returns {Promise<{ editions: object[], detail: object|null, at: number, discoveredAt: number }|null>} */
export function readWork(id) {
  return run('readonly', (s) => s.get(id)).catch(() => null);
}

export async function writeWork(id, value) {
  await run('readwrite', (s) => s.put({ ...value, at: Date.now() }, id)).catch(() => null);
  // سقف بسيط: كل مئتي كتابة تقريبًا يُقصّ الأقدم
  if (Math.random() < 0.02) void prune();
}

async function prune() {
  const d = await db();
  if (!d) return;
  const all = await run('readonly', (s) => s.getAll());
  const keys = await run('readonly', (s) => s.getAllKeys());
  if (!all || !keys || keys.length <= MAX_WORKS) return;
  const order = keys.map((k, i) => [k, all[i]?.at ?? 0]).sort((a, b) => a[1] - b[1]);
  await run('readwrite', (s) => {
    for (const [k] of order.slice(0, keys.length - MAX_WORKS)) s.delete(k);
  });
}

export function readKv(key) {
  return run('readonly', (s) => s.get(key), KV).catch(() => null);
}
export function writeKv(key, value) {
  return run('readwrite', (s) => s.put({ value, at: Date.now() }, key), KV).catch(() => null);
}
