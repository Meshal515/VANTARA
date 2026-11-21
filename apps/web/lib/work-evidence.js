/**
 * أدلة ربط نسخة مصدر بعمل في صفحة العمل (الخطة ب). منطق خالص بلا شبكة ولا تخزين.
 *
 * الدرس من بلاغات المالك (21 نوفمبر):
 *  - **دمج خاطئ:** قصة زورو الجانبية أخذت فصول ون بيس (1152). السبب أن البحث قَبِل نسخة عنوانها يطابق «اسمًا بديلًا»
 *    تعلّمه الجهاز من وصف مصدر أو من أسماء AniList الفضفاضة. الاسم المتعلَّم ليس دليلًا على العمل نفسه.
 *  - **مصدر غائب:** The Savior's Bucket List ظهر من مصدر واحد، وهو موجود في مصدر عربي يعرضه بعنوانه العربي
 *    حين تبحث فيه بالاسم الإنجليزي. العنوان العربي رُفض لأنه لا يطابق حرفيًا.
 *
 * القاعدة: النسخة تُقبل بما **قاله المصدر عن نفسه** عن اسم من **أسماء العمل الموثوقة**: عنوانها نفسه، أو أسماؤها
 * البديلة في القائمة، أو رابطها، أو (بعد التحقق) أسماؤها في صفحة تفاصيلها. والأسماء الموثوقة هي عناوين نسخ العمل
 * وأسماؤه الرسمية، لا ما تعلّمه الجهاز من نصوص. وفوقها حارس المعرّف الرسمي: معرّفان مختلفان ليسا عملًا واحدًا أبدًا.
 */

import { looseKey, normalizeTitle, slugName, titleTwins } from './catalog.js';
import { aliasesFromText } from './manga-aliases.js';

const words = (key) => new Set(String(key).split(' ').filter(Boolean));
/** اسم كلماته جزء من اسم أطول للعمل («One Piece» من «One Piece: Roronoa Zoro»): اسم السلسلة الأم لا اسم هذا العمل. */
const parentName = (key, longer) => {
  const small = words(key);
  const big = words(longer);
  return small.size > 0 && small.size < big.size && [...small].every((w) => big.has(w));
};

/**
 * اسمان أحدهما جزء من الآخر بكلماته كلها ويزيد الآخر عليه: سلسلة أم وقصة جانبية أو جزء منها، لا عمل واحد
 * («One Piece» و«One Piece: Roronoa Zoro»، «Solo Leveling» و«Solo Leveling: Ragnarok»).
 */
export const isPartName = (a, b) => parentName(a, b) || parentName(b, a);

/**
 * أسماء العمل الموثوقة (مطبَّعة): عنوانه ومفتاح بطاقته، وعناوين نسخه، وأسماء نسخه البديلة كما قالتها مصادرها، وأسماؤه
 * الرسمية من AniList لبطاقة AniList، وأسماؤه في صفحة تفاصيل نسخته. الأسماء التي تعلّمها الجهاز من النصوص لا تدخل هنا
 * (تبقى أسئلة بحث فقط).
 * الاسم البديل الذي هو اسم السلسلة الأم يُستبعد: لا يجعل قصة جانبية هي السلسلة.
 */
export function ownNames(v35work, { workOfficial = null, officialOf = () => null, more = [] } = {}) {
  const main = new Set();
  const extra = new Set();
  const add = (set, raw) => {
    const key = typeof raw === 'string' ? normalizeTitle(raw) : '';
    if (key && key.replace(/\s/g, '').length >= 2) set.add(key);
  };
  const id = String(v35work?.id ?? '');
  if (id.startsWith('ext:') && id.length > 4) main.add(id.slice(4));
  for (const t of [v35work?.title?.english, v35work?.title?.romaji, v35work?.title?.native, v35work?._work?.title]) add(main, t);
  // أسماء البطاقة: عناوين نسخها كما قالتها مصادرها (canonicalIndex)
  for (const t of Array.isArray(v35work?._work?.aliases) ? v35work._work.aliases : []) add(main, t);
  // أسماء نسخة تشير إلى أعمال أخرى (مجموعة قصص تسرد قصصها) ليست أسماء هذا العمل: تُستبعد كلها، وكل اسم لعمل
  // رسمي آخر يُستبعد وحده
  const extras = (names) => {
    const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string');
    if (namesPointElsewhere(list, null, officialOf)) return;
    for (const n of list) {
      const id = officialOf(normalizeTitle(n));
      if (!Number.isSafeInteger(workOfficial) || !Number.isSafeInteger(id) || id === workOfficial) add(extra, n);
    }
  };
  for (const e of v35work?._work?.editions ?? []) {
    add(main, e?.manga?.title);
    extras(e?.manga?.altNames);
  }
  if (Number.isSafeInteger(v35work?._metaId)) extras(v35work?.synonyms);
  // ما قالته صفحة تفاصيل نسخة من نسخ العمل نفسه عن أسمائها (`more`): كلام المصدر عن نفسه
  extras(more);
  const out = new Set(main);
  for (const key of extra) if (![...main].some((m) => parentName(key, m))) out.add(key);
  return out;
}

/**
 * دليل القائمة نفسها (بلا شبكة): رتبته وما هو، أو null.
 *  exact  عنوان النسخة = اسم موثوق للعمل
 *  twin   نفس الكلمات المميِّزة (فرق إملائي فقط، titleTwins)
 *  alt    أسماء النسخة البديلة في القائمة (MangaDex) تحوي اسمًا موثوقًا بالضبط
 *  slug   رابط النسخة اسمٌ موثوق للعمل (عنوان عربي ورابط إنجليزي)
 * (و«detail» من صفحة التفاصيل، و«alias» اسم محفوظ لم تؤكده النسخة بعد: يُعرض ولا يُحفظ في الهوية.)
 */
/**
 * أسماء تشير إلى أكثر من عمل رسمي، أو إلى عمل غير هذا: ليست أسماء النسخة. مجموعة قصص قصيرة عند MangaDex تسرد أسماء
 * قصصها في أسمائها البديلة («Tatsuki Fujimoto Short Story Collection» ← «Sasaki Stopped a Bullet»، «Love Is Blind»…)،
 * فتلتصق بكل قصة لو قُبلت.
 */
export function namesPointElsewhere(names, workOfficial, officialOf = () => null) {
  const ids = new Set();
  for (const n of names ?? []) {
    const id = officialOf(normalizeTitle(n));
    if (Number.isSafeInteger(id)) ids.add(id);
  }
  // معرّف العمل معروف: أي اسم لعمل رسمي آخر يكفي. غير معروف: اسمان لعملين مختلفين
  if (Number.isSafeInteger(workOfficial)) return [...ids].some((id) => id !== workOfficial);
  return ids.size > 1;
}

export function listingEvidence(manga, own, { workOfficial = null, officialOf = () => null } = {}) {
  const key = normalizeTitle(manga?.title);
  if (!key || !own?.size) return null;
  if (own.has(key)) return 'exact';
  for (const name of own) if (titleTwins(key, name)) return 'twin';
  const alt = Array.isArray(manga?.altNames) ? manga.altNames : [];
  if (alt.some((n) => own.has(normalizeTitle(n))) && !namesPointElsewhere(alt, workOfficial, officialOf)) return 'alt';
  const slug = slugName(manga);
  if (slug) {
    const loose = looseKey(slug);
    for (const name of own) if (loose && looseKey(name) === loose) return 'slug';
  }
  return null;
}

/** أسماء النسخة من صفحة تفاصيلها: حقلها، وإلا آخر وصفها (إضافات الـAPK). */
export function detailNames(detail) {
  if (!detail) return [];
  const names = Array.isArray(detail.altNames) && detail.altNames.length ? detail.altNames : aliasesFromText(detail.description);
  return [detail.title, ...names].filter((n) => typeof n === 'string' && n.trim());
}

/** صفحة التفاصيل تقول إن من أسماء النسخة اسمًا موثوقًا للعمل؟ */
export function detailEvidence(detail, own, { workOfficial = null, officialOf = () => null } = {}) {
  if (!own?.size) return null;
  const names = detailNames(detail);
  return names.some((n) => own.has(normalizeTitle(n))) && !namesPointElsewhere(names, workOfficial, officialOf) ? 'detail' : null;
}

const STRENGTH = { exact: 6, twin: 5, alt: 4, slug: 3, detail: 2, alias: 1 };

/**
 * يختار نسخة المصدر للعمل من المقبولة، أو null. نسخة بعنوان مطابق حرفيًا تُقدَّم. وأكثر من نسخة (روابط مختلفة) بنفس
 * القوة غموضٌ: لا تُختار أيٌّ منها، فالنسخة الخاطئة أسوأ من غيابها.
 * @param {Array<{ manga: object, ev: string }>} accepted
 */
export function pickEdition(accepted) {
  const byUrl = new Map();
  for (const a of accepted ?? []) {
    const id = a?.manga?.url || normalizeTitle(a?.manga?.title);
    if (!id) continue;
    const prior = byUrl.get(id);
    if (!prior || STRENGTH[a.ev] > STRENGTH[prior.ev]) byUrl.set(id, a);
  }
  const list = [...byUrl.values()].sort((x, y) => STRENGTH[y.ev] - STRENGTH[x.ev]);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  return STRENGTH[list[0].ev] > STRENGTH[list[1].ev] ? list[0] : null;
}

/** معرّفان رسميان معروفان ومختلفان: ليسا عملًا واحدًا. */
export function officialConflict(manga, workOfficial, officialOf) {
  if (!Number.isSafeInteger(workOfficial)) return false;
  const id = officialOf(normalizeTitle(manga?.title));
  return Number.isSafeInteger(id) && id !== workOfficial;
}
