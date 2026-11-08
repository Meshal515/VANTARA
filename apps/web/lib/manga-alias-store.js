/**
 * ذاكرة الأسماء البديلة لأعمال المانجا: مفتاح العمل ← أسماؤه الأخرى.
 *
 * مصدران: ما يُشحن مع التطبيق (`data/manga-aliases.json`، يُبنى دوريًّا من صفحات
 * الأعمال في كل المصادر)، وما يتعلّمه الجهاز من كل صفحة عمل يفتحها. منها يبني
 * الكتالوج بطاقة واحدة للعمل الواحد مهما اختلفت أسماؤه بين المصادر
 * (`canonicalIndex` في catalog.js)، ومنها تُربط المراجع القديمة بالعمل.
 */

const KEY = 'vantara.manga.aliases.v1';
const TWINS_KEY = 'vantara.manga.twins.v1';
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
// أعمال مكررة بأسماء متقاربة وأعلى فصل واحد (manga-twins.js): محفوظة فتعمل من أول قائمة
let twins = read(TWINS_KEY);
let map = null;
let loading = null;

function rebuild() {
  map = new Map();
  for (const source of [shipped, learned, twins.aliases ?? {}]) {
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

/** الأسماء من أعلى الفصول لدى الخادم. تُعاد كل ست ساعات على الأكثر. */
export function twinsAt() {
  return Number(twins.at) || 0;
}
export function setTwinAliases(aliases, at = Date.now()) {
  twins = { at, aliases: aliases ?? {} };
  write(TWINS_KEY, twins);
  rebuild();
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
  noteRefAliases([[aliasRef, canonicalRef]]);
}

/** Persist one listing's new references once, rather than serializing the
 * entire graph synchronously for every edition of thousands of works. */
export function noteRefAliases(pairs) {
  let changed = false;
  for (const [aliasRef, canonicalRef] of pairs) {
    if (!aliasRef || !canonicalRef || aliasRef === canonicalRef) continue;
    const list = refAliases[canonicalRef] ?? [];
    if (list.includes(aliasRef)) continue;
    // These references own saved progress/library rows; dropping an old name
    // would hide user data even though no server row was deleted.
    refAliases[canonicalRef] = [...list, aliasRef];
    changed = true;
  }
  if (changed) {
    reverse = null;
    write(REFS_KEY, refAliases);
  }
}

// الاتجاه العكسي (اسم قديم ← القوانين التي صار جزءًا منها)، يُبنى مرة ويُرمى عند أي تعلّم جديد.
// بلا هذا الاتجاه كانت البطاقة القديمة (من «الأكثر قراءة» أو سجلّ قبل الدمج) لا ترى تقدّم العمل القانوني،
// فيظهر العمل الواحد بطاقتين في «تابع القراءة» و«مكتبتي».
let reverse = null;
function reverseIndex() {
  if (reverse) return reverse;
  reverse = new Map();
  for (const [canonical, olds] of Object.entries(refAliases)) {
    for (const old of olds ?? []) {
      if (!reverse.has(old)) reverse.set(old, []);
      reverse.get(old).push(canonical);
    }
  }
  return reverse;
}

/**
 * كل مراجع العمل الواحد: المرجع نفسه أولًا، ثم أسماؤه القديمة، ثم ما صار هو جزءًا منه.
 * القراءة فقط تتبع الفئة كلها؛ الكتابة تبقى بمرجع البطاقة، فلا يُنقل ولا يُحذف صف محفوظ.
 */
export function refsOf(ref) {
  const refs = [ref];
  const seen = new Set(refs);
  const back = reverseIndex();
  for (let i = 0; i < refs.length; i++) {
    for (const next of [...(refAliases[refs[i]] ?? []), ...(back.get(refs[i]) ?? [])]) {
      if (!seen.has(next)) { seen.add(next); refs.push(next); }
    }
  }
  return refs;
}

/**
 * مفتاح تجميع ثابت للعمل: أصغر مرجع في فئته. لا يُعرض ولا يُخزَّن، بل يجمع بطاقات
 * العمل الواحد في القوائم (السجل، المكتبة، لقطات الأقسام) أيًّا كان مرجع كل بطاقة.
 */
export function canonicalRefOf(ref) {
  const key = String(ref ?? '');
  if (!key.startsWith('ext:')) return key;
  if (!refAliases[key] && !reverseIndex().has(key)) return key;
  return refsOf(key).reduce((min, r) => (r < min ? r : min));
}

/** للاختبار فقط. */
export function _reset() {
  shipped = {};
  learned = read(KEY);
  twins = read(TWINS_KEY);
  refAliases = read(REFS_KEY);
  reverse = null;
  map = null;
  loading = null;
}
