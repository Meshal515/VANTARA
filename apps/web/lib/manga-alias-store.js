/**
 * ذاكرة الأسماء البديلة لأعمال المانجا: مفتاح العمل ← أسماؤه الأخرى.
 *
 * مصدران: ما يُشحن مع التطبيق (`data/manga-aliases.json`، يُبنى دوريًّا من صفحات
 * الأعمال في كل المصادر)، وما يتعلّمه الجهاز من كل صفحة عمل يفتحها. منها يبني
 * الكتالوج بطاقة واحدة للعمل الواحد مهما اختلفت أسماؤه بين المصادر
 * (`canonicalIndex` في catalog.js)، ومنها تُربط المراجع القديمة بالعمل.
 */

const KEY = 'vantara.manga.aliases.v1';
const REFS_KEY = 'vantara.manga.refAliases.v1';
const MAX_LEARNED = 4000;

const read = (key) => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null') ?? {};
  } catch {
    return {};
  }
};
const write = (key, value) => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // تخزين ممتلئ: الذاكرة للجلسة تكفي
  }
};

let shipped = {};
let learned = read(KEY);
let map = null;
let loading = null;

function rebuild() {
  map = new Map();
  for (const source of [shipped, learned]) {
    for (const [key, names] of Object.entries(source)) {
      const prev = map.get(key) ?? [];
      map.set(key, [...new Set([...prev, ...(names ?? [])])]);
    }
  }
  return map;
}

/** يحمّل الأسماء المشحونة مرة (بلا انتظار عند كل قائمة). */
export function loadAliases(fetchImpl = globalThis.fetch) {
  loading ??= (async () => {
    try {
      const res = await fetchImpl(new URL('../data/manga-aliases.json', import.meta.url));
      if (res.ok) shipped = (await res.json())?.aliases ?? {};
    } catch {
      // بلا ملف مشحون: ما تعلّمه الجهاز يكفي
    }
    rebuild();
    return map;
  })();
  return loading;
}

/** الخريطة الحالية (فارغة قبل التحميل؛ القائمة التالية تستفيد). */
export function aliasMap() {
  return map ?? rebuild();
}

/** ما قالته صفحة عمل عن أسمائه الأخرى. */
export function learnAliases(key, names) {
  const clean = [...new Set((names ?? []).filter((n) => typeof n === 'string' && n.trim()))].slice(0, 20);
  if (!key || !clean.length) return;
  const prev = learned[key] ?? [];
  if (clean.every((n) => prev.includes(n))) return;
  learned[key] = [...new Set([...prev, ...clean])];
  const keys = Object.keys(learned);
  if (keys.length > MAX_LEARNED) for (const k of keys.slice(0, keys.length - MAX_LEARNED)) delete learned[k];
  write(KEY, learned);
  rebuild();
}

// ───────── المراجع: عمل كان بطاقة باسمه ثم صار جزءًا من عمل قانوني ─────────
// تقدّم القراءة والمكتبة محفوظة بمرجع الاسم القديم؛ لا تُنقل ولا تُحذف، بل تُقرأ
// مع العمل القانوني (`refsOf`).

let refAliases = read(REFS_KEY);

/** `ext:demonic emperor` صار جزءًا من `ext:magic emperor`. */
export function noteRefAlias(aliasRef, canonicalRef) {
  if (!aliasRef || !canonicalRef || aliasRef === canonicalRef) return;
  const list = refAliases[canonicalRef] ?? [];
  if (list.includes(aliasRef)) return;
  refAliases[canonicalRef] = [...list, aliasRef].slice(-10);
  write(REFS_KEY, refAliases);
}

/** كل مراجع العمل: القانوني أولًا ثم أسماؤه القديمة. */
export function refsOf(ref) {
  return [ref, ...(refAliases[ref] ?? [])];
}

/** للاختبار فقط. */
export function _reset() {
  shipped = {};
  learned = read(KEY);
  refAliases = read(REFS_KEY);
  map = null;
  loading = null;
}
