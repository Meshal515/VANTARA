/**
 * تنزيل فصل مانجا: كل صفحاته بترتيبها، محفوظة في مخزن التنزيلات الدائم.
 *
 * - المصدر نفسه الذي يقرأ منه القارئ (`engine.pages` ثم `engine.pageImage`): نفس الترويسات
 *   والفك، فما يُقرأ يُنزَّل. لا مصدر ثانٍ يُخلط داخل الفصل الواحد.
 * - الاستئناف: الصفحة المحفوظة لا تُنزَّل ثانية؛ الإيقاف يبقي ما حُفظ.
 * - التوازي داخل الفصل ثلاث صفحات: يكفي لملء الخط دون حظر من مضيف الصور.
 * - الفصل لا يُعلن جاهزًا إلا وكل صفحة محفوظة وغير فارغة وصورة فعلًا، وعدد الصفحات
 *   يطابق قائمة المصدر. صفحة ناقصة = فصل لم يكتمل (لا قارئ بفجوات).
 */

import { DownloadError } from './model.js';

const PAGE_CONCURRENCY = 3;
const IMAGE_TYPES = /^image\/(?:jpeg|png|webp|gif|avif|bmp)$/i;

/** نوع الصورة من أول بايتاتها: المضيفات ترسل أحيانًا application/octet-stream. */
export function sniffImageType(bytes) {
  const b = new Uint8Array(bytes.slice ? bytes.slice(0, 12) : bytes);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/avif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return null;
}

async function defaultFetchBytes(src, signal) {
  const res = await fetch(src, { signal });
  if (!res.ok) throw new DownloadError(res.status === 404 || res.status === 410 ? 'SOURCE' : 'NETWORK', `HTTP ${res.status}`, { retryable: res.status >= 500 || res.status === 429 });
  return { bytes: await res.arrayBuffer(), type: res.headers.get('content-type') };
}

/**
 * @param {{ store: object, engine: () => ({ pages: Function, pageImage: Function }),
 *   fetchBytes?: (src: string, signal: AbortSignal) => Promise<{ bytes: ArrayBuffer, type?: string|null }> }} deps
 */
export function createMangaDriver(deps) {
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
  return {
    async run(item, ctl) {
      const engine = deps.engine();
      if (!engine?.pages || !engine?.pageImage) throw new DownloadError('UNSUPPORTED', 'محرك المانجا غير متاح هنا');
      const { sourceId, chapter } = item.request ?? {};
      if (!sourceId || !chapter) throw new DownloadError('NO_ROUTE', 'الفصل بلا مصدر');
      let list;
      try {
        list = await engine.pages(sourceId, chapter);
      } catch (error) {
        throw new DownloadError('SOURCE', String(error?.message ?? error), { retryable: true });
      }
      if (ctl.signal.aborted) return null;
      if (!Array.isArray(list) || !list.length) throw new DownloadError('SOURCE', 'الفصل بلا صفحات عند المصدر');
      const total = list.length;
      ctl.update({ pagesTotal: total, transport: 'pages', resumable: true, source: { ...item.source, sourceId } });

      let saved = 0;
      let bytes = 0;
      const missing = [];
      for (let i = 0; i < total; i++) {
        const page = await deps.store.getPage(item.id, i);
        if (page?.bytes > 0) {
          saved++;
          bytes += page.bytes;
        } else missing.push(i);
      }
      ctl.progress({ pages: saved, bytes, total: null });

      let cursor = 0;
      let failure = null;
      const worker = async () => {
        while (!failure && !ctl.signal.aborted && cursor < missing.length) {
          const index = missing[cursor++];
          try {
            const image = await engine.pageImage(sourceId, list[index]);
            if (ctl.signal.aborted) return;
            const got = await fetchBytes(image?.src ?? image, ctl.signal);
            const type = sniffImageType(got.bytes) ?? (IMAGE_TYPES.test(String(got.type ?? '')) ? got.type : null);
            if (!type || !got.bytes?.byteLength) throw new DownloadError('VERIFY', `الصفحة ${index + 1} ليست صورة`);
            await deps.store.putPage(item.id, index, { bytes: got.bytes.byteLength, type, data: got.bytes });
            saved++;
            bytes += got.bytes.byteLength;
            ctl.progress({ pages: saved, bytes });
          } catch (error) {
            if (ctl.signal.aborted) return;
            if (error?.name === 'QuotaExceededError' || /quota/i.test(String(error?.message))) failure = new DownloadError('NO_SPACE');
            else failure = error instanceof DownloadError ? error : new DownloadError('NETWORK', String(error?.message ?? error), { retryable: true });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, missing.length) }, worker));
      if (ctl.signal.aborted) return null;
      if (failure) throw failure;

      // التحقق: كل صفحة موجودة بترتيبها وغير فارغة
      ctl.update({ state: 'verifying' });
      let verifiedBytes = 0;
      for (let i = 0; i < total; i++) {
        const page = await deps.store.getPage(item.id, i);
        if (!(page?.bytes > 0) || !page.type) throw new DownloadError('VERIFY', `الصفحة ${i + 1} ناقصة`, { retryable: true });
        verifiedBytes += page.bytes;
      }
      return {
        pages: total,
        pagesTotal: total,
        bytes: verifiedBytes,
        total: verifiedBytes,
        storage: { kind: 'pages', bytes: verifiedBytes, verified: true, location: 'مخزن التطبيق' },
      };
    },

    async remove(item) {
      await deps.store.deletePages(item.id);
    },
  };
}

/** صفحات فصل محفوظ لقارئ بلا اتصال: روابط Blob بترتيبها، ودالة تحريرها عند الخروج. */
export async function localChapterPages(store, item) {
  const urls = [];
  const total = Number(item.pagesTotal ?? item.pages ?? 0);
  for (let i = 0; i < total; i++) {
    const page = await store.getPage(item.id, i);
    if (!page?.data) break;
    urls.push(URL.createObjectURL(new Blob([page.data], { type: page.type })));
  }
  return { urls, complete: urls.length === total, release: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}
