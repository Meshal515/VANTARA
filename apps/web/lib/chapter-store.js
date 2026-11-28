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

import { normalizeTitle } from './catalog.js';
import { refsOf } from './manga-alias-store.js';

const DB = 'vantara-chapters';
const STORE = 'works';
const SOURCE_TITLES = 'sourceTitles';
const MAX_WORKS = 200;
/** قوائم الرئيسية والاستكشاف: آخر ما رأيته يُعرض قبل أن تردّ المصادر. */
const KV = 'kv';

let opening = null;
function sourceTitles(id, work) {
  if (!String(id).startsWith('ext:manga|') || !Array.isArray(work?.editions)) return [];
  return [...new Set(work.editions.filter((e) => e?.chapters?.length)
    .map((e) => normalizeTitle(e.manga?.title)).filter(Boolean))];
}

function db() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 3);
      req.onupgradeneeded = () => {
        const names = req.result.objectStoreNames;
        const existed = names.contains(STORE);
        const works = existed ? req.transaction.objectStore(STORE) : req.result.createObjectStore(STORE);
        if (!names.contains(KV)) req.result.createObjectStore(KV);
        works.createIndex(SOURCE_TITLES, SOURCE_TITLES, { multiEntry: true });
        if (existed) {
          const records = works.openCursor();
          records.onsuccess = () => {
            const cursor = records.result;
            if (!cursor) return;
            const titles = sourceTitles(cursor.primaryKey, cursor.value);
            if (titles.length) cursor.update({ ...cursor.value, sourceTitles: titles });
            cursor.continue();
          };
        }
      };
      req.onsuccess = () => {
        const connection = req.result;
        connection.onversionchange = () => { connection.close(); opening = null; };
        resolve(connection);
      };
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
export async function readWork(id, { sourceTitle = '' } = {}) {
  const [matches, indexed] = await Promise.all([
    Promise.all(refsOf(id).map((ref) => run('readonly', (s) => s.get(ref)).catch(() => null))),
    sourceTitle ? run('readonly', (s) => s.index(SOURCE_TITLES).getAll(sourceTitle)) : null,
  ]);
  const caches = matches.filter(Boolean);
  const localSourceEditions = (indexed ?? []).flatMap((work) => work.editions ?? [])
    .filter((edition) => edition?.chapters?.length && normalizeTitle(edition.manga?.title) === sourceTitle);
  if (caches.length < 2) {
    return localSourceEditions.length ? { ...caches[0], localSourceEditions } : caches[0] ?? null;
  }
  const editions = new Map();
  for (const cached of caches) for (const edition of cached.editions ?? []) {
    const key = JSON.stringify([edition.sourceId, edition.manga?.url ?? '']);
    const prior = editions.get(key);
    if (!prior) { editions.set(key, edition); continue; }
    const chapters = new Map();
    // The current reference wins duplicate chapter metadata; former caches
    // complete gaps while every original IndexedDB entry stays untouched.
    for (const chapter of [...(prior.chapters ?? []), ...(edition.chapters ?? [])]) {
      const identity = chapter.url || JSON.stringify([chapter.chapterNumber, chapter.name]);
      if (!chapters.has(identity)) chapters.set(identity, chapter);
    }
    editions.set(key, { ...edition, ...prior, manga: { ...edition.manga, ...prior.manga }, chapters: [...chapters.values()] });
  }
  return {
    ...caches[caches.length - 1], ...caches[0],
    editions: [...editions.values()],
    localSourceEditions,
    detail: caches.find((c) => c.detail)?.detail ?? null,
    // An older contributing cache must still trigger the usual refresh.
    at: Math.min(...caches.map((c) => c.at ?? 0)),
    discoveredAt: Math.min(...caches.map((c) => c.discoveredAt ?? 0)),
  };
}

export async function writeWork(id, value) {
  const titles = sourceTitles(id, value);
  await run('readwrite', (s) => s.put({ ...value, ...(titles.length ? { sourceTitles: titles } : {}), at: Date.now() }, id)).catch(() => null);
  // سقف بسيط: كل مئتي كتابة تقريبًا يُقصّ الأقدم
  if (Math.random() < 0.02) void prune();
}

// CST1: كان التقليم يقرأ كل الأعمال بفصولها في الذاكرة دفعة واحدة (getAll) ليعرف الأقدم. الآن: العدد أولًا (رخيص)، ولا
// شيء إن لم يتجاوز السقف؛ وإلا مؤشر يمر سجلًا سجلًا ويحفظ المفتاح ووقته فقط.
export async function prune() {
  const d = await db();
  if (!d) return;
  const count = await run('readonly', (s) => s.count());
  if (!(count > MAX_WORKS)) return;
  const order = [];
  await run('readonly', (s) => {
    const cursor = s.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      order.push([c.key, c.value?.at ?? 0]);
      c.continue();
    };
    return null;
  });
  if (order.length <= MAX_WORKS) return;
  order.sort((a, b) => a[1] - b[1]);
  await run('readwrite', (s) => {
    for (const [k] of order.slice(0, order.length - MAX_WORKS)) s.delete(k);
  });
}

export function readKv(key) {
  return run('readonly', (s) => s.get(key), KV).catch(() => null);
}
export function writeKv(key, value) {
  return run('readwrite', (s) => s.put({ value, at: Date.now() }, key), KV).catch(() => null);
}
