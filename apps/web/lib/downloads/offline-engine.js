/**
 * محرك القارئ «المحمّل أولًا»: نفس واجهة محرك المصادر (`pages`, `pageImage`) لكنه يقرأ أي فصل جاهز على
 * الجهاز من مخزن التنزيلات، ويترك الباقي للمصدر.
 *
 * قبل هذا كان الفصل المحمّل لا يُقرأ من الجهاز إلا إذا فُتح العمل من «على الجهاز». فتحتَه من المكتبة أو
 * البحث أو التحديثات (المسار المعتاد) ⇒ يطلبه القارئ من الإنترنت، وبلا اتصال يفشل كل فصل «نزّلته». هكذا
 * يعمل Mihon: الفصل المنزَّل يُقرأ من القرص أينما فتحته.
 *
 * - المطابقة بالمصدر نفسه ورابط الفصل (`request` / `request.active` للتنزيل الذي أكمل من نسخة بديلة).
 * - صفحة محفوظة تالفة أو مفقودة: تُجلب من المصدر بنفس ترتيبها (إن وُجد اتصال)، لا فجوة في الفصل.
 * - روابط Blob تبقى ما بقيت الجلسة لأن القارئ يحفظ الرابط لصفحات يعود إليها.
 */

const LOCAL_MARK = '__vantaraLocal';

const sameChapter = (a, b) => Boolean(a && b) && String(a.url ?? '') !== '' && String(a.url) === String(b.url ?? '');

/** العنصر الجاهز على الجهاز لهذا الفصل من هذا المصدر، أو null. */
export function readyItemFor(items, sourceId, chapter) {
  for (const item of items ?? []) {
    if (item?.state !== 'ready' || item.kind !== 'manga') continue;
    const r = item.request ?? {};
    const routes = [r.active, { sourceId: r.sourceId, chapter: r.chapter }];
    if (routes.some((x) => x?.sourceId === sourceId && sameChapter(x.chapter, chapter))) return item;
  }
  return null;
}

/**
 * @param {{ pages: Function, pageImage: Function }} engine محرك المصادر
 * @param {() => Promise<{ manager: { list: () => any[] }, store: { getPage: Function } } | null>} downloads
 */
export function withDownloads(engine, downloads) {
  const urls = new Map();
  const online = new Map();
  const ctx = () => Promise.resolve().then(downloads).catch(() => null);

  async function localItem(sourceId, chapter) {
    const c = await ctx();
    if (!c?.manager) return null;
    const item = readyItemFor(c.manager.list(), sourceId, chapter);
    return item ? { item, store: c.store } : null;
  }

  /** قائمة صفحات المصدر نفسه (مرة لكل فصل): احتياط صفحة محفوظة تالفة. */
  function onlinePages(sourceId, chapter) {
    const key = `${sourceId}|${chapter?.url ?? ''}`;
    let p = online.get(key);
    if (!p) {
      p = Promise.resolve().then(() => engine.pages(sourceId, chapter));
      p.catch(() => online.delete(key));
      online.set(key, p);
    }
    return p;
  }

  return {
    ...engine,
    downloadsAware: true,
    async pages(sourceId, chapter) {
      const hit = await localItem(sourceId, chapter);
      if (!hit) return engine.pages(sourceId, chapter);
      const total = Number(hit.item.pagesTotal ?? hit.item.pages ?? 0);
      if (!(total > 0)) return engine.pages(sourceId, chapter);
      const refs = Array.isArray(hit.item.pageRefs) && hit.item.pageRefs.length === total ? hit.item.pageRefs : null;
      return Array.from({ length: total }, (_, index) => ({
        index,
        url: refs?.[index]?.url ?? '',
        imageUrl: refs?.[index]?.imageUrl ?? null,
        [LOCAL_MARK]: { itemId: hit.item.id, sourceId, chapter },
      }));
    },
    async pageImage(sourceId, page) {
      const local = page?.[LOCAL_MARK];
      if (!local) return engine.pageImage(sourceId, page);
      const key = `${local.itemId}#${page.index}`;
      if (urls.has(key)) return { src: urls.get(key), local: true };
      const c = await ctx();
      const stored = await c?.store?.getPage(local.itemId, page.index).catch(() => null);
      if (stored?.data && stored.data.byteLength > 0 && (stored.bytes == null || stored.data.byteLength === stored.bytes)) {
        const src = URL.createObjectURL(new Blob([stored.data], { type: stored.type || 'image/jpeg' }));
        urls.set(key, src);
        return { src, local: true };
      }
      // الصفحة المحفوظة مفقودة: من المصدر بنفس الترتيب
      const list = await onlinePages(local.sourceId, local.chapter);
      const remote = list?.[page.index];
      if (!remote) throw Object.assign(new Error('صفحة غير محفوظة على الجهاز'), { code: 'LOCAL_PAGE_MISSING' });
      return engine.pageImage(local.sourceId, remote);
    },
  };
}
