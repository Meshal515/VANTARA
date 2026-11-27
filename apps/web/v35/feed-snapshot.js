/** A feed keeps its entry snapshot; background data waits for user refresh. */
export function createFeedSnapshot({ key = (item) => item.id } = {}) {
  let items = [];
  let latest = [];
  const api = {
    get items() { return items; },
    get pending() { const seen = new Set(items.map(key)); return latest.filter((item) => !seen.has(key(item))).length; },
    accept(incoming, { refresh = false, append = false, prune = false } = {}) {
      latest = [...new Map(incoming.map((item) => [key(item), item])).values()];
      if (refresh || !items.length) items = [...latest];
      else {
        const known = new Map(latest.map((item) => [key(item), item]));
        items = items.filter(item => !prune || known.has(key(item))).map((item) => known.get(key(item)) ?? item);
        if (append) {
          const seen = new Set(items.map(key));
          items.push(...latest.filter((item) => !seen.has(key(item))));
        }
      }
      return items;
    },
    refresh() { return api.accept(latest, { refresh: true }); },
  };
  return api;
}

/**
 * سياسة نتائج البحث (لا الخلاصة): قبل أن يلمس المستخدم القائمة تتبع آخر ترتيب بالصلة كاملًا؛ بعد اللمس يُلحق
 * الجديد في آخرها فقط. لا تجميد لأول دفعة خلف زر «نتائج جديدة» (بلاغ «بوروتو» 27 نوفمبر).
 */
export function acceptSearchResults(snapshot, items, { touched = false } = {}) {
  return snapshot.accept(items, touched ? { append: true } : { refresh: true });
}
