/**
 * قارئ المانجا على ما في الجهاز: نفس واجهة محرك المصادر (`pages`, `pageImage`) لكن من مخزن
 * التنزيلات، فيفتح القارئ نفسه بلا شبكة ولا مصدر. صفوف الفصول تحمل كائن الفصل الأصلي ورقمه،
 * فالتقدّم يُحفظ بمفتاح الفصل نفسه ويُكمل عبر الأجهزة كأي قراءة.
 */

export const LOCAL_PREFIX = 'local:';

export function localRows(items) {
  return items.map((item) => ({
    sourceId: `${LOCAL_PREFIX}${item.id}`,
    chapter: { ...(item.request?.chapter ?? {}), url: item.request?.chapter?.url ?? item.unit.key },
    number: item.unit.number,
    label: item.unit.title ?? null,
    local: true,
  }));
}

export function createLocalMangaEngine(store, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const urls = new Map();
  const itemOf = (sourceId) => byId.get(String(sourceId).slice(LOCAL_PREFIX.length));
  return {
    local: true,
    async pages(sourceId) {
      const item = itemOf(sourceId);
      if (!item) throw new Error('الفصل لم يعد على الجهاز');
      const total = Number(item.pagesTotal ?? item.pages ?? 0);
      return Array.from({ length: total }, (_, index) => ({ index, itemId: item.id }));
    },
    async pageImage(_sourceId, page) {
      const key = `${page.itemId}#${page.index}`;
      if (urls.has(key)) return { src: urls.get(key) };
      const stored = await store.getPage(page.itemId, page.index);
      if (!stored?.data) throw new Error('صفحة غير محفوظة');
      const src = URL.createObjectURL(new Blob([stored.data], { type: stored.type }));
      urls.set(key, src);
      return { src };
    },
    release() {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    },
  };
}
