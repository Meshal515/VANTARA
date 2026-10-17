/**
 * «آخر ما بحثت عنه» للمانجا والأنمي.
 *
 * يُحفظ البحث النهائي وحده: ما ضغطت له «بحث»، أو بحثٌ فتحت منه عملًا. كان
 * يُحفظ كل ما توقّف عنده الكتابة لحظة فتمتلئ القائمة ببادئات الكلمة نفسها
 * («Kar»، «Karil»، «Kariel»). والحفظ نفسه يمحو بادئات الكلمة الجديدة احتياطًا.
 */

export const RECENT_MAX = 8;

const clean = (term) => String(term ?? '').trim().replace(/\s+/g, ' ');

/** القائمة بعد إضافة `term` أولها: بلا تكرار (بلا اعتبار لحالة الحروف) وبلا بادئاته. */
export function pushRecent(list, term, max = RECENT_MAX) {
  const t = clean(term);
  const prev = (Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x.trim());
  if (t.length < 2) return prev.slice(0, max);
  const low = t.toLowerCase();
  const rest = prev.filter((x) => {
    const l = clean(x).toLowerCase();
    return l !== low && !low.startsWith(l);
  });
  return [t, ...rest].slice(0, max);
}

/** يقرأ ويكتب من تخزين الجهاز؛ التخزين الممنوع لا يكسر البحث. */
export function recentStore(key, storage = globalThis.localStorage) {
  const read = () => {
    try {
      const v = JSON.parse(storage?.getItem(key) ?? '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
    } catch {
      return [];
    }
  };
  const write = (list) => {
    try {
      storage?.setItem(key, JSON.stringify(list));
    } catch {
      // ممتلئ أو ممنوع: يبقى للجلسة
    }
    return list;
  };
  return {
    list: read,
    remember: (term) => write(pushRecent(read(), term)),
    remove: (term) => write(read().filter((x) => x.toLowerCase() !== clean(term).toLowerCase())),
    clear: () => write([]),
  };
}
