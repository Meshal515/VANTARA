/**
 * محتوى الكبار لا يظهر في VANTARA أبدًا: هنتاي، سمت، بويز لاف/BL، غيرلز لاف/GL، ياوي ويوري،
 * +18. شرط المالك: يُحذف لا يُغطّى. والإيتشي يبقى (قرار المالك).
 *
 * دليلان: **التصنيف** (من القائمة إن حملته، أو من صفحة العمل حين تُفتح؛ وما كشفته الصفحة
 * يُحفظ على الجهاز فيختفي العمل من كل القوائم وآخر التحديثات بعدها)، و**العنوان** للكلمات
 * التي لا تحتمل معنى آخر (Hentai، NSFW، +18…). «Yuri» في عنوان قد يكون اسم شخصية، فالتصنيف
 * وحده يحكم عليه.
 */

const fold = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[’'`]/g, '').replace(/[_\-–—]+/g, ' ').replace(/\s+/g, ' ').trim();

/** تصنيفات تحجب العمل (مطابقة كاملة للوسم بعد التطبيع). */
const ADULT_GENRES = new Set([
  'hentai', 'smut', 'erotica', 'erotic', 'pornographic', 'porn', 'adult', 'adults only', '18+', '+18', 'r18', 'r 18', 'nsfw', 'mature 18+',
  'yaoi', 'yuri', 'shounen ai', 'shonen ai', 'shoujo ai', 'shojo ai', 'boys love', 'boy love', 'boys love (bl)', 'bl', 'girls love', 'girl love', 'gl',
  'lolicon', 'shotacon', 'sexual violence', 'sexual content', 'uncensored',
  'هنتاي', 'ياوي', 'يوري', 'شونين اي', 'شونين أي', 'شوجو اي', 'شوجو أي', 'بويز لاف', 'جيرلز لاف',
  'للكبار', 'للبالغين', 'بالغين', 'كبار', 'إباحي', 'اباحي', 'جنسي', 'محتوى جنسي', 'منحرف', '+١٨', '١٨+',
]);

/** كلمات في العنوان لا تحتمل إلا محتوى الكبار. */
const ADULT_TITLE = /(?:^|[^\p{L}\p{N}])(?:hentai|nsfw|r[\s-]?18|18\s?\+|\+\s?18|uncensored|smut|yaoi|هنتاي|للكبار)(?=$|[^\p{L}\p{N}])/iu;

const tags = (genre) =>
  (Array.isArray(genre) ? genre : String(genre ?? '').split(/[,،;|/·•]/))
    .map((g) => fold(typeof g === 'string' ? g : g?.name ?? ''))
    .filter(Boolean);

export const adultGenre = (genre) => tags(genre).some((t) => ADULT_GENRES.has(t));
export const adultTitle = (title) => ADULT_TITLE.test(String(title ?? ''));
/** نسخة عمل من مصدر (SManga): بتصنيفها أو بعنوانها. */
export const adultManga = (manga) => Boolean(manga) && (adultGenre(manga.genre ?? manga.genres) || adultTitle(manga.title));

// ───────── ما كشفته صفحات الأعمال: محفوظ على الجهاز بمفتاح العمل ─────────
const KEY = 'vantara.manga.adult.v1';
const blocked = (() => {
  try {
    return new Set(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]'));
  } catch {
    return new Set();
  }
})();
export const isBlockedKey = (key) => Boolean(key) && (blocked.has(String(key).replace(/^ext:/, '')) || isHiddenKey(key));
export function blockKey(key) {
  const k = String(key ?? '').replace(/^ext:/, '');
  if (!k || blocked.has(k)) return;
  blocked.add(k);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...blocked].slice(-5000)));
  } catch {
    // تخزين ممتلئ: الحجب للجلسة يكفي
  }
}

// ───────── أعمال حذفها صاحب الحساب بنفسه («حذف العمل»)، وأرشيفها لإعادتها ─────────
let currentUser = () => null;
let hiddenFor = null;
const hiddenKey = () => {
  const id = currentUser();
  return `vantara.works.hidden.v1.${id ? `user.${encodeURIComponent(id)}` : 'guest'}`;
};
let hiddenCache = null;
const hiddenMap = () => {
  if (hiddenFor !== hiddenKey()) { hiddenFor = hiddenKey(); hiddenCache = null; }
  if (hiddenCache) return hiddenCache;
  try {
    hiddenCache = JSON.parse(globalThis.localStorage?.getItem(hiddenKey()) ?? '{}') ?? {};
  } catch {
    hiddenCache = {};
  }
  return hiddenCache;
};
const saveHidden = () => {
  try {
    globalThis.localStorage?.setItem(hiddenKey(), JSON.stringify(hiddenMap()));
  } catch {
    // تخزين ممتلئ: الحذف للجلسة يكفي
  }
};
const norm = (k) => String(k ?? '').replace(/^ext:/, '');
/** الأرشيف خاص بكل حساب على الجهاز: `userOf()` يرجع الحساب الحالي. */
export function setHiddenUser(userOf) {
  currentUser = typeof userOf === 'function' ? userOf : () => userOf;
}
export const isHiddenKey = (key) => Boolean(key) && Object.values(hiddenMap()).some((h) => h.keys?.includes(norm(key)));
/** يخفي العمل من كل القوائم والبحث وآخر التحديثات. */
export function hideWork({ id, keys = [], title = '', cover = null }) {
  const all = [...new Set([id, ...keys].filter(Boolean).map(norm))];
  if (!all.length) return;
  hiddenMap()[all[0]] = { keys: all, title, cover, at: Date.now() };
  saveHidden();
}
export function restoreWork(id) {
  delete hiddenMap()[id];
  saveHidden();
}
/** [{id, title, cover, at}] الأحدث أولًا. */
export const hiddenWorks = () => Object.entries(hiddenMap()).map(([id, h]) => ({ id, ...h })).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
