/**
 * محرك Iken — مواقع Next.js بواجهة JSON مفتوحة على `api.<الدومين>` (Azora وأخواتها).
 * أنظف عائلة: لا كشط HTML إطلاقًا.
 *
 * منقول من `lib-multisrc/iken` في Keiyoushi بنفس الصيغ:
 *   العمل: `url` = "slug#id"، `memo` = {"id","slug"}
 *   الفصل: `url` = "/series/<slug>/<chapter-slug>#<id>"، `memo` = {"seriesSlug","slug","id"}
 * الفصول المقفلة (عملات/وقت/رابط مختصر) لا تُعرض، كإعداد Keiyoushi الافتراضي.
 */

import { parseHtml } from '../dom.js';

const PER_PAGE = 18;
const STATUS = { ONGOING: 1, COMING_SOON: 1, MASS_RELEASED: 1, COMPLETED: 2, CANCELLED: 5, DROPPED: 5 };

const locked = (c) => c.isLocked === true || c.isTimeLocked === true || c.isPermanentlyLocked === true || (c.chapterPurchased === false && Number(c.price ?? 0) !== 0);

export const iken = {
  kind: 'iken',
  content: 'manga',
  create(def, { fetch }) {
    const base = `https://${def.domain}`;
    const api = def.config?.apiUrl ?? `https://api.${def.domain.replace(/^www\./, '')}`;

    const toManga = (p) => ({
      url: `${p.slug}#${p.id}`,
      title: String(p.postTitle ?? '').trim(),
      thumbnailUrl: p.featuredImage || null,
      memo: JSON.stringify({ id: Number(p.id), slug: p.slug }),
    });
    const isNovel = (p) => p.isNovel === true || String(p.seriesType ?? '').toLowerCase() === 'novel';

    async function query(page, { term = '', orderBy = '' } = {}) {
      const url = new URL(`${api}/api/query`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('perPage', String(PER_PAGE));
      url.searchParams.set('searchTerm', term.trim());
      if (orderBy) {
        url.searchParams.set('orderBy', orderBy);
        url.searchParams.set('orderDirection', 'desc');
      }
      const data = await fetch.json(url.toString(), { referer: `${base}/` });
      return {
        mangas: (data.posts ?? []).filter((p) => !isNovel(p)).map(toManga).filter((m) => m.title),
        hasNextPage: Number(data.totalCount ?? 0) > page * PER_PAGE,
      };
    }

    const idsOf = (manga) => {
      const url = String(manga.url ?? '');
      let memo = {};
      try {
        memo = typeof manga.memo === 'string' ? JSON.parse(manga.memo) : manga.memo ?? {};
      } catch {
        memo = {};
      }
      return { slug: memo.slug ?? url.split('#')[0].replace(/^\/?series\//, '').replace(/\/+$/, ''), id: memo.id ?? Number(url.split('#')[1]) };
    };

    const toChapter = (c, seriesSlug) => ({
      url: `/series/${seriesSlug}/${c.slug}#${c.id}`,
      name: `${'الفصل'} ${c.number}${c.title ? ` - ${c.title}` : ''}`,
      dateUpload: Date.parse(c.createdAt ?? '') || 0,
      chapterNumber: Number(c.number) || -1,
      scanlator: null,
      memo: JSON.stringify({ seriesSlug, slug: c.slug, id: Number(c.id) }),
    });

    async function series(manga) {
      const { slug } = idsOf(manga);
      const data = await fetch.json(`${api}/api/post?postSlug=${encodeURIComponent(slug)}`, { referer: `${base}/` });
      const p = data.post;
      if (!p || isNovel(p)) throw new Error('رواية أو عمل غير موجود');
      let chapters = p.chapters ?? [];
      // التفاصيل تعيد أول الفصول وحدها أحيانًا: القائمة الكاملة من نقطتها
      if (!chapters.length || Number(data.totalChapterCount ?? 0) > chapters.length) {
        chapters = (await fetch.json(`${api}/api/chapters?postId=${p.id}`, { referer: `${base}/` }))?.post?.chapters ?? chapters;
      }
      const description = p.postContent ? parseHtml(String(p.postContent).replace(/\n/g, '<br>')).body?.textContent?.trim() : null;
      return {
        manga: {
          ...toManga(p),
          author: p.author || null,
          artist: p.artist || null,
          description: description || null,
          genre: [...new Set([{ MANGA: 'Manga', MANHUA: 'Manhua', MANHWA: 'Manhwa' }[p.seriesType], ...(p.genres ?? []).map((g) => g.name)].filter(Boolean))].join(', ') || null,
          status: STATUS[p.seriesStatus] ?? 0,
          initialized: true,
        },
        chapters: chapters.filter((c) => !locked(c)).map((c) => toChapter(c, p.slug)),
      };
    }

    async function pages(chapter) {
      let memo = {};
      try {
        memo = JSON.parse(chapter.memo ?? '{}');
      } catch {
        memo = {};
      }
      const id = memo.id ?? Number(String(chapter.url).split('#')[1]);
      if (!id) throw new Error('حدّث قائمة الفصول');
      const data = (await fetch.json(`${api}/api/chapter?chapterId=${id}`, { referer: `${base}/` }))?.chapter;
      if (!data || data.isPermanentlyLocked || data.isLockedByCoins || data.isShortLinkLocked) throw new Error('فصل مقفل');
      const url = `${base}${String(chapter.url).split('#')[0]}`;
      return [...(data.images ?? [])]
        .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9))
        .map((img, index) => ({ index, url, imageUrl: String(img.url).replace(/ /g, '%20') }));
    }

    return {
      popular: (page = 1) => query(page, { orderBy: 'totalViews' }),
      latest: (page = 1) => query(page, { orderBy: 'lastChapterAddedAt' }),
      search: (term, page = 1) => query(page, { term }),
      series,
      chapters: async (manga) => (await series(manga)).chapters,
      pages,
      imageReferer: () => `${base}/`,
      mangaUrl: (manga) => `${base}/series/${idsOf(manga).slug}`,
    };
  },
};
