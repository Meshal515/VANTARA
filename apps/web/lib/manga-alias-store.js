/**
 * ذاكرة الأسماء البديلة لأعمال المانجا: مفتاح العمل ← أسماؤه الأخرى.
 *
 * مصدران: ما يُشحن مع التطبيق (`data/manga-aliases.json`، يُبنى دوريًّا من صفحات
 * الأعمال في كل المصادر)، وما يتعلّمه الجهاز من كل صفحة عمل يفتحها. منها يبني
 * الكتالوج بطاقة واحدة للعمل الواحد مهما اختلفت أسماؤه بين المصادر
 * (`canonicalIndex` في catalog.js)، ومنها تُربط المراجع القديمة بالعمل.
 */

import { saveWithRelief } from './storage-relief.js';
import { RANK, createIdentityGraph } from './work-identity.js';

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
// SY2: فشل الحفظ (تخزين ممتلئ) لا يُبتلع: سجل الدمج يربط علاماتك ومواضعك بالعمل، وضياعه بصمت يُخفيها بعد إعادة الفتح.
// يبقى في الذاكرة للجلسة، ويُعلن مرة (vantara:storage-full) فتقوله الواجهة.
export let storageFailures = 0;
const write = (key, value) => {
  // الكاش يُفسح أولًا (lib/storage-relief.js)، والإعلان فقط إن بقي ممتلئًا
  const ok = saveWithRelief(globalThis.localStorage, key, JSON.stringify(value));
  if (!ok) storageFailures++;
  return ok;
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

// ───────── المعرّف الرسمي (ID1): عنوان البطاقة ← معرّف AniList المؤكد ─────────
// بطاقتان بمعرّف واحد عمل واحد (canonicalIndex، الخطوة 5)، بحارس «مصدر يعرضهما عملين» في الدمج نفسه. ومعرّفان
// مختلفان لا يجتمعان في عمل واحد أبدًا (حارس التعارض في الفهرس وفي رسم الهوية).
const OFFICIAL_KEY = 'vantara.manga.officialIds.v1';
const MAX_OFFICIAL = 6000;
let official = read(OFFICIAL_KEY);
let officialMap = null;

/** [[مفتاح العنوان المطبَّع، معرّف AniList]] من مطابقة مؤكدة؛ يُحفظ مرة للدفعة. */
export function noteOfficialIds(pairs) {
  let changed = false;
  for (const [key, id] of pairs ?? []) {
    if (!key || !Number.isSafeInteger(id) || id <= 0 || official[key] === id) continue;
    delete official[key];
    official[key] = id;
    changed = true;
  }
  if (!changed) return false;
  const keys = Object.keys(official);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_OFFICIAL))) delete official[k];
  officialMap = null;
  write(OFFICIAL_KEY, official);
  // معرّف جديد قد يكشف دمجًا قديمًا خاطئًا: يُقطع الآن (ويبقى مسجّلًا)
  graph.invalidate();
  if (graph.heal().length) saveGraph();
  return true;
}

export function officialIdMap() {
  return officialMap ??= new Map(Object.entries(official));
}

// ───────── الأسماء المشتركة: اسم يحمله أكثر من عمل في AniList (mangaNameAmbiguous) ─────────
// لا يُدمج به بين مصدرين بلا معرّف رسمي (canonicalIndex: ambiguous). يُتعلَّم من استعلام AniList نفسه الذي يجري لكل بطاقة.
const AMBIGUOUS_KEY = 'vantara.manga.ambiguousNames.v1';
const MAX_AMBIGUOUS = 6000;
let ambiguous = read(AMBIGUOUS_KEY);
let ambiguousCache = null;
/** مفاتيح عناوين مطبَّعة ثبت أنها لأكثر من عمل. */
export function noteAmbiguousNames(keys) {
  let changed = false;
  for (const key of keys ?? []) {
    if (!key || ambiguous[key]) continue;
    ambiguous[key] = 1;
    changed = true;
  }
  if (!changed) return false;
  const all = Object.keys(ambiguous);
  for (const k of all.slice(0, Math.max(0, all.length - MAX_AMBIGUOUS))) delete ambiguous[k];
  ambiguousCache = null;
  write(AMBIGUOUS_KEY, ambiguous);
  return true;
}
export function ambiguousNames() {
  return ambiguousCache ??= new Set(Object.keys(ambiguous));
}

// ───────── رسم الهوية (الخطة ب، lib/work-identity.js) ─────────
// المراجع: عمل كان بطاقة باسمه ثم صار جزءًا من عمل قانوني. تقدّم القراءة والمكتبة محفوظة بمرجع الاسم القديم؛ لا
// تُنقل ولا تُحذف، بل تُقرأ مع العمل كله (`refsOf`). كل دمج حافة بدليلها ورتبتها، والدمج الخاطئ يُقطع حين يظهر
// تعارضه، وفصل المستخدم (ID4) حدث مسجَّل لا حذف.
//
// التخزين: سجل الدمج (REFS_KEY) بشكله القديم للحواف الفعّالة، فلا يتضاعف الحجم ويقرؤه إصدار أقدم؛ وما لا يحمله
// (الرتب، المقطوع، روابط النسخ) في IDENTITY_KEY. والفصل في SPLITS_KEY بشكله القديم.
const SPLITS_KEY = 'vantara.manga.splits.v1';
const IDENTITY_KEY = 'vantara.manga.identity.v1';
const bare = (ref) => String(ref ?? '').replace(/^ext:/, '');
const splitKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
let splits = read(SPLITS_KEY);
let graph = null;

function openGraph() {
  graph = createIdentityGraph({ officialOf: (ref) => officialIdMap().get(bare(ref)) ?? null });
  const pairs = Object.entries(splits).map(([key, value]) => {
    const cut = key.indexOf('|');
    return [`ext:${key.slice(0, cut)}`, `ext:${key.slice(cut + 1)}`, Number(value?.at) || 0];
  });
  const healed = graph.load({ refAliases: read(REFS_KEY), meta: read(IDENTITY_KEY), splits: pairs });
  if (healed.length) saveGraph();
}

function saveGraph() {
  const { refAliases, meta } = graph.dump();
  // تخزين ممتلئ يُعلن مرة: الثاني سيفشل مثله، والرسم باقٍ في الذاكرة للجلسة
  if (write(REFS_KEY, refAliases)) write(IDENTITY_KEY, meta);
}

/** رسم الهوية الحي (للقراءة والتشخيص). */
export const identityGraph = () => graph;

/** يفصل مرجعين (`ext:<مفتاح>` أو المفتاح نفسه) كانا عملًا واحدًا. */
export function splitRefs(a, b, at = Date.now()) {
  const k = splitKey(bare(a), bare(b));
  if (!bare(a) || !bare(b) || bare(a) === bare(b) || splits[k]) return false;
  splits[k] = { at };
  write(SPLITS_KEY, splits);
  graph.split(`ext:${bare(a)}`, `ext:${bare(b)}`, at);
  saveGraph();
  return true;
}
export function unsplitRefs(a, b) {
  const k = splitKey(bare(a), bare(b));
  if (!splits[k]) return false;
  delete splits[k];
  write(SPLITS_KEY, splits);
  graph.unsplit(`ext:${bare(a)}`, `ext:${bare(b)}`);
  saveGraph();
  return true;
}
export const isSplit = (a, b) => Boolean(splits[splitKey(bare(a), bare(b))]);
/** أزواج المفاتيح المفصولة («a|b» مرتبة) لحارس الفهرس. */
export function splitSet() {
  return new Set(Object.keys(splits));
}

/** `ext:demonic emperor` صار جزءًا من `ext:magic emperor`. */
export function noteRefAlias(aliasRef, canonicalRef) {
  noteRefAliases([[aliasRef, canonicalRef]]);
}

/**
 * دمج القوائم (دليل عنوان، RANK.TITLE): يُحفظ مرة للدفعة. حارس التعارض في الرسم يرفض ما يخالف معرّفًا رسميًا أو
 * فصل المستخدم، فلا يُحفظ دمج خاطئ ثم يجرّ غيره.
 */
export function noteRefAliases(pairs, { rank = RANK.TITLE, why = '' } = {}) {
  const before = graph.edges().length;
  let changed = false;
  for (const [aliasRef, canonicalRef] of pairs ?? []) {
    if (!aliasRef || !canonicalRef || aliasRef === canonicalRef) continue;
    const had = graph.sameClass(String(aliasRef), String(canonicalRef));
    if (graph.propose(String(aliasRef), String(canonicalRef), { rank, why }) && !had) changed = true;
  }
  if (changed || graph.edges().length !== before) saveGraph();
}

/**
 * دليل قوي على أن مرجعين عمل واحد (معرّف رسمي، المصدر نفسه، المستخدم). يرجع هل صارا عملًا واحدًا، ومع الرفض سببه
 * في سجل الرسم.
 */
export function proposeSameWork(a, b, { rank = RANK.SOURCE, why = '' } = {}) {
  const had = graph.sameClass(String(a), String(b));
  const ok = graph.propose(String(a), String(b), { rank, why });
  if (ok && !had) saveGraph();
  return ok;
}

/** نسخة مصدر رُبطت بعملها بدليل موثَّق: تُحفظ فتظهر في بطاقته في كل قائمة بعدها. */
export function linkEdition(key, ref, options) {
  const before = graph.editionRef(key);
  const out = graph.linkEdition(key, String(ref), options);
  if (out.ok && (before !== graph.editionRef(key) || out.merged)) saveGraph();
  return out;
}
export const editionRef = (key) => graph.editionRef(key);
/** عمل النسخة في القوائم: المكوّن الموثَّق لمرجعها، فنسخ عمل واحد ربطتها صفحات بطاقتين مختلفتين بطاقة واحدة. */
export function editionWork(key) {
  const ref = graph.editionRef(key);
  return ref ? graph.strongCanonical(ref) : null;
}

/**
 * كل مراجع العمل الواحد: المرجع نفسه أولًا، ثم بقية مراجعه بترتيب الوصول.
 * القراءة فقط تتبع العمل كله؛ الكتابة تبقى بمرجع البطاقة، فلا يُنقل ولا يُحذف صف محفوظ.
 */
export function refsOf(ref) {
  return graph.classOf(String(ref));
}

/**
 * مفتاح تجميع ثابت للعمل: أصغر مرجع فيه. لا يُعرض ولا يُخزَّن، بل يجمع بطاقات العمل الواحد في القوائم (السجل،
 * المكتبة، لقطات الأقسام) أيًّا كان مرجع كل بطاقة.
 */
export function canonicalRefOf(ref) {
  const key = String(ref ?? '');
  if (!key.startsWith('ext:')) return key;
  return graph.canonical(key);
}

/** هوية العمل الثابتة `vw:…`: واحدة لكل مراجعه، وتُحسب بالقاعدة نفسها على كل جهاز. */
export function workIdentity(ref) {
  return graph.identity(String(ref ?? ''));
}

openGraph();

/** للاختبار فقط. */
export function _reset() {
  splits = read(SPLITS_KEY);
  official = read(OFFICIAL_KEY);
  officialMap = null;
  ambiguous = read(AMBIGUOUS_KEY);
  ambiguousCache = null;
  shipped = {};
  learned = read(KEY);
  twins = read(TWINS_KEY);
  map = null;
  loading = null;
  openGraph();
}
