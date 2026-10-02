/**
 * MangaSwat (meshmanga) — واجهة Django REST مفتوحة (`/v2/api/v2`).
 * نفس صيغ امتداد Keiyoushi: العمل `url` = رقمه، الفصل `url` = "/chapters/<id>/<slug>/".
 */

const STATUS = { ongoing: 1, completed: 2 };

export const mangaswat = {
  kind: 'mangaswat',
  content: 'manga',
  create(def, { fetch }) {
    const base = `https://${def.domain}`;
    const api = `${base}/v2/api/v2`;
    const opts = { referer: `${base}/` };

    const toManga = (m) => ({ url: String(m.id ?? m.serie_id), title: String(m.title ?? '').trim(), thumbnailUrl: m.poster?.medium ?? null });
    async function list(path) {
      const data = await fetch.json(`${api}${path}`, opts);
      return { mangas: (data.results ?? []).map(toManga).filter((m) => m.title && m.url !== 'undefined'), hasNextPage: Boolean(data.next) };
    }

    async function series(manga) {
      const id = String(manga.url).replace(/\D+/g, '');
      const d = await fetch.json(`${api}/series/${id}/`, opts);
      const chapters = [];
      let next = `${api}/chapters/?serie=${id}&order_by=-order&page_size=200`;
      for (let guard = 0; next && guard < 30; guard += 1) {
        const page = await fetch.json(next, opts);
        chapters.push(...(page.results ?? []));
        next = page.next ? page.next.replace(/^http:/, 'https:') : null;
      }
      return {
        manga: {
          url: id,
          title: d.title ?? manga.title,
          thumbnailUrl: d.poster?.medium ?? manga.thumbnailUrl ?? null,
          description: d.story ?? null,
          genre: (d.genres ?? []).map((g) => g.name).join(', ') || null,
          author: d.author?.name ?? null,
          artist: d.artist?.name ?? null,
          status: STATUS[d.status?.name] ?? 0,
          initialized: true,
        },
        chapters: chapters.map((c) => ({
          url: `/chapters/${c.id}/${c.slug}/`,
          name: String(c.chapter ?? '').trim() || `الفصل ${c.slug}`,
          dateUpload: Date.parse(c.created_at ?? '') || 0,
          chapterNumber: -1,
          scanlator: null,
          memo: JSON.stringify({ id: c.id, slug: c.slug }),
        })),
      };
    }

    async function pages(chapter) {
      const id = String(chapter.url).replace(/^\/chapters\//, '').split('/')[0];
      const data = await fetch.json(`${api}/chapters/${id}/`, opts);
      return (data.images ?? []).map((p, index) => ({ index, url: `${base}/chapter/${id}`, imageUrl: p.image }));
    }

    return {
      popular: (page = 1) => list(`/series/?order_by=-followers_count&page=${page}`),
      latest: (page = 1) => list(`/series/releases/?page=${page}`),
      search: (query, page = 1) => list(`/series/?search=${encodeURIComponent(query.trim())}&page=${page}`),
      series,
      chapters: async (manga) => (await series(manga)).chapters,
      pages,
      imageReferer: () => `${base}/`,
      mangaUrl: (manga) => `${base}/series/${manga.url}`,
    };
  },
};
