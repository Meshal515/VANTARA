/**
 * MangaDex — واجهتها الرسمية المفتوحة (api.mangadex.org)، الترجمات العربية وحدها.
 * نفس صيغ امتداد Keiyoushi (`all.mangadex`) فالمكتبة واحدة مع الـAPK:
 *   العمل: `url` = "/manga/<uuid>"، الفصل: `url` = "/chapter/<uuid>".
 * الصور من خادم MangaDex@Home المعيّن لكل فصل (`/at-home/server/<id>`).
 */

const API = 'https://api.mangadex.org';
const LIMIT = 20;
const RATINGS = ['safe', 'suggestive'];
const STATUS = { ongoing: 1, completed: 2, hiatus: 6, cancelled: 5 };

const pick = (map, ...langs) => {
  if (!map || typeof map !== 'object') return '';
  for (const l of langs) if (map[l]) return map[l];
  return Object.values(map)[0] ?? '';
};
const uuidOf = (url) => String(url ?? '').split('/').filter(Boolean).pop()?.split('#')[0] ?? '';

export const mangadex = {
  kind: 'mangadex',
  content: 'manga',
  create(def, { fetch }) {
    const lang = def.config?.lang ?? 'ar';
    const site = `https://${def.domain}`;

    const coverOf = (m, size = 512) => {
      const file = m.relationships?.find((r) => r.type === 'cover_art')?.attributes?.fileName;
      return file ? `https://uploads.mangadex.org/covers/${m.id}/${file}.${size}.jpg` : null;
    };
    const titleOf = (m) => {
      const a = m.attributes ?? {};
      const alt = (a.altTitles ?? []).find((t) => t[lang])?.[lang];
      return String(pick(a.title, 'en', 'ja-ro', 'ko-ro', 'zh-ro') || alt || '').trim();
    };
    const toManga = (m) => ({ url: `/manga/${m.id}`, title: titleOf(m), thumbnailUrl: coverOf(m, 256) });

    async function list(page, order, title = '') {
      const url = new URL(`${API}/manga`);
      url.searchParams.set('limit', String(LIMIT));
      url.searchParams.set('offset', String((page - 1) * LIMIT));
      url.searchParams.append('availableTranslatedLanguage[]', lang);
      url.searchParams.append('includes[]', 'cover_art');
      for (const r of RATINGS) url.searchParams.append('contentRating[]', r);
      if (title) url.searchParams.set('title', title.trim());
      url.searchParams.set(`order[${order}]`, 'desc');
      const data = await fetch.json(url.toString());
      return { mangas: (data.data ?? []).map(toManga).filter((m) => m.title), hasNextPage: (data.offset ?? 0) + LIMIT < (data.total ?? 0) };
    }

    async function chapters(id) {
      const out = [];
      for (let offset = 0; offset < 5000; offset += 500) {
        const url = new URL(`${API}/manga/${id}/feed`);
        url.searchParams.set('limit', '500');
        url.searchParams.set('offset', String(offset));
        url.searchParams.append('translatedLanguage[]', lang);
        url.searchParams.append('includes[]', 'scanlation_group');
        for (const r of [...RATINGS, 'erotica']) url.searchParams.append('contentRating[]', r);
        url.searchParams.set('order[volume]', 'desc');
        url.searchParams.set('order[chapter]', 'desc');
        const data = await fetch.json(url.toString());
        out.push(...(data.data ?? []));
        if (offset + 500 >= (data.total ?? 0)) break;
      }
      return out
        .filter((c) => !c.attributes?.externalUrl && (c.attributes?.pages ?? 1) > 0)
        .map((c) => {
          const a = c.attributes ?? {};
          const name = [a.volume ? `مجلد ${a.volume}` : '', a.chapter ? `الفصل ${a.chapter}` : 'فصل واحد'].filter(Boolean).join(' · ') + (a.title ? ` - ${a.title}` : '');
          const group = c.relationships?.find((r) => r.type === 'scanlation_group')?.attributes?.name ?? null;
          return { url: `/chapter/${c.id}`, name, dateUpload: Date.parse(a.publishAt ?? a.readableAt ?? '') || 0, chapterNumber: Number(a.chapter) || -1, scanlator: group };
        });
    }

    async function series(manga) {
      const id = uuidOf(manga.url);
      const url = new URL(`${API}/manga/${id}`);
      for (const inc of ['author', 'artist', 'cover_art']) url.searchParams.append('includes[]', inc);
      const m = (await fetch.json(url.toString())).data;
      const a = m.attributes ?? {};
      const people = (type) => m.relationships?.filter((r) => r.type === type).map((r) => r.attributes?.name).filter(Boolean).join(', ') || null;
      return {
        manga: {
          ...toManga(m),
          thumbnailUrl: coverOf(m, 512),
          description: String(pick(a.description, lang, 'en') || '').trim() || null,
          author: people('author'),
          artist: people('artist'),
          genre: (a.tags ?? []).map((t) => pick(t.attributes?.name, 'en')).filter(Boolean).join(', ') || null,
          status: STATUS[a.status] ?? 0,
          initialized: true,
        },
        chapters: await chapters(id),
      };
    }

    async function pages(chapter) {
      const id = uuidOf(chapter.url);
      const data = await fetch.json(`${API}/at-home/server/${id}`);
      const { hash, data: files = [] } = data.chapter ?? {};
      return files.map((f, index) => ({ index, url: `${site}/chapter/${id}`, imageUrl: `${data.baseUrl}/data/${hash}/${f}` }));
    }

    return {
      popular: (page = 1) => list(page, 'followedCount'),
      latest: (page = 1) => list(page, 'latestUploadedChapter'),
      search: (query, page = 1) => list(page, 'relevance', query),
      series,
      chapters: async (manga) => (await series(manga)).chapters,
      pages,
      imageReferer: () => `${site}/`,
      mangaUrl: (manga) => `${site}/title/${uuidOf(manga.url)}`,
    };
  },
};
