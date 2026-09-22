/**
 * «فريم» في الواجهة — التقاط صفحات من القارئ، وبناء ما يُرسل، وفتحه عند الصديق.
 *
 * ما يُرسل مراجع لا صور (انظر `packages/domain/src/frames.ts`): الصديق يجلب
 * الصفحات من المصدر بمحرّكه. لذلك يحمل الفريم العمل والفصل بالحقول التي
 * يحتاجها المحرّك ليطلب الفصل نفسه، ومنها `memo` كما خرج من المصدر.
 *
 * الحدّ نفسه في الخادم: عشر صفحات. هنا يُرفض الالتقاط الحادي عشر صراحةً بدل
 * أن يقصّه الخادم بصمت فيصل للصديق غير ما أرسلته.
 */

export const MAX_FRAME_PAGES = 10;

export function createFrameCapture(max = MAX_FRAME_PAGES) {
  const pages = new Map();
  return {
    /** @returns {'added' | 'removed' | 'full'} */
    toggle(page) {
      if (pages.has(page.index)) {
        pages.delete(page.index);
        return 'removed';
      }
      if (pages.size >= max) return 'full';
      pages.set(page.index, { index: page.index, url: page.url ?? '', imageUrl: page.imageUrl ?? null });
      return 'added';
    },
    has: (index) => pages.has(index),
    list: () => [...pages.values()],
    clear: () => pages.clear(),
    get size() {
      return pages.size;
    },
  };
}

export function buildFramePayload({ toId, sourceId, manga, chapter, pages, message }) {
  const text = typeof message === 'string' ? message.trim() : '';
  return {
    toId,
    sourceId,
    work: {
      url: manga.url,
      title: manga.title ?? '',
      thumbnailUrl: manga.thumbnailUrl ?? null,
      memo: manga.memo ?? '',
    },
    chapter: {
      url: chapter.url,
      name: chapter.name ?? '',
      chapterNumber: chapter.chapterNumber ?? -1,
      scanlator: chapter.scanlator ?? null,
      memo: chapter.memo ?? '',
    },
    pages: pages.map((p) => ({ index: p.index, url: p.url ?? '', imageUrl: p.imageUrl ?? null })),
    ...(text ? { message: text } : {}),
  };
}

/**
 * الصفحة التي يقرؤها الآن: التي تغطّي منتصف الشاشة، وإلا الأقرب إليه.
 *
 * المنتصف لا الأعلى: صفحة مانهوا طويلة تبدأ فوق الشاشة وهي ما يُقرأ فعلًا.
 */
export function pageAtViewport(rects, viewportHeight) {
  if (!rects.length) return -1;
  const middle = viewportHeight / 2;
  let best = -1;
  let bestDistance = Infinity;
  rects.forEach((r, i) => {
    if (r.top <= middle && r.bottom >= middle) {
      best = i;
      bestDistance = -1;
      return;
    }
    if (bestDistance < 0) return;
    const d = Math.min(Math.abs(r.top - middle), Math.abs(r.bottom - middle));
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

export function frameIdFromLink(link) {
  if (typeof link !== 'string' || !link.startsWith('vantara://frame/')) return null;
  try {
    return decodeURIComponent(link.slice('vantara://frame/'.length)) || null;
  } catch {
    return null;
  }
}

/**
 * صفحات الفريم عند الصديق: من قائمة الفصل الحديثة بترتيب المرسل.
 *
 * كثير من المصادر يوقّع روابط صوره بمهلة، فالمحفوظ وقت الإرسال قد انتهى.
 * القائمة الحديثة أصدق؛ والمحفوظ بديلٌ حين تتعذّر القائمة أو تقصر.
 */
export function resolveFramePages(stored, fresh) {
  const byIndex = new Map((fresh ?? []).map((p) => [p.index, p]));
  return stored.map((p) => byIndex.get(p.index) ?? p);
}
