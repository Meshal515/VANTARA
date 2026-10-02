/**
 * Team X (olympustaff) — موقع Laravel بقالبه الخاص. نفس صيغ امتداد Keiyoushi:
 * العمل `url` = "/series/<slug>"، الفصل `url` = مساره. الفصول المقفلة لا تُعرض،
 * وصفحات الفصل `canvas[data-src]` أو `img[src]` داخل `div.image_list`.
 */

import { absAttr, attr, parseHtml, pathOf, q, qa, text } from '../dom.js';

const STATUS = { مستمرة: 1, 'قادم قريبًا': 1, مكتمل: 2, متوقف: 6 };
const unthumb = (u) => String(u ?? '').replace('thumbnail_', '');

export const teamx = {
  kind: 'teamx',
  content: 'manga',
  create(def, { fetch }) {
    const base = `https://${def.domain}`;
    const get = async (url) => parseHtml((await fetch.page(url, { referer: `${base}/` })).text);
    const pageNo = (page) => (page > 1 ? `?page=${page}` : '');
    const more = (doc) => Boolean(q(doc, 'a[rel=next]'));

    async function popular(page = 1) {
      const doc = await get(`${base}/series/${pageNo(page)}`);
      const mangas = qa(doc, 'div.listupd div.bsx').map((el) => {
        const a = q(el, 'a');
        const img = q(el, 'img');
        return { url: pathOf(absAttr(a, 'href', base)), title: attr(a, 'title') || text(a), thumbnailUrl: absAttr(img, 'data-src', base) || absAttr(img, 'src', base) || null };
      });
      return { mangas: mangas.filter((m) => m.url && m.title), hasNextPage: more(doc) };
    }

    async function latest(page = 1) {
      const doc = await get(`${base}/${pageNo(page)}`);
      const mangas = qa(doc, 'div.last-chapter div.box').map((el) => {
        const a = q(el, 'div.info a');
        return { url: pathOf(absAttr(a, 'href', base)), title: text(q(a, 'h3')), thumbnailUrl: unthumb(absAttr(q(el, 'div.imgu img'), 'src', base)) || null };
      });
      return { mangas: mangas.filter((m) => m.url && m.title), hasNextPage: more(doc) };
    }

    async function search(query) {
      const doc = await get(`${base}/search?keyword=${encodeURIComponent(query.trim())}`);
      const mangas = qa(doc, 'div.tx-grid a.tx-card').map((a) => ({ url: pathOf(absAttr(a, 'href', base)), title: text(q(a, 'h3')), thumbnailUrl: unthumb(absAttr(q(a, 'img'), 'src', base)) || null }));
      return { mangas: mangas.filter((m) => m.url && m.title), hasNextPage: false };
    }

    function chaptersIn(doc) {
      return qa(doc, 'div.chapter-card')
        .filter((el) => !q(el, 'span.locked'))
        .map((el) => {
          const n = attr(el, 'data-number');
          const title = text(q(el, 'div.chapter-info div.chapter-title'));
          const plain = [n, `الفصل ${n}`, `الفصل رقم ${n}`];
          return {
            url: pathOf(absAttr(q(el, 'a'), 'href', base)),
            name: `الفصل ${n}${title && !plain.includes(title) ? ` - ${title}` : ''}`,
            dateUpload: Number(attr(el, 'data-date')) * 1000 || 0,
            chapterNumber: Number(n) || -1,
            scanlator: null,
          };
        })
        .filter((c) => c.url);
    }

    async function series(manga) {
      const url = `${base}${manga.url}`;
      const doc = await get(url);
      const info = (label) => qa(doc, '.full-list-info').find((el) => text(q(el, 'small')).includes(label));
      const chapters = chaptersIn(doc);
      const last = Math.max(1, ...qa(doc, 'ul.pagination a.page-link').map((a) => Number(text(a))).filter(Number.isFinite));
      if (last > 1) {
        const rest = await Promise.all(Array.from({ length: last - 1 }, (_, i) => get(`${url}?page=${i + 2}`).then(chaptersIn, () => [])));
        chapters.push(...rest.flat());
      }
      const author = text(info('الرسام')?.querySelectorAll('small')?.[1]);
      return {
        manga: {
          url: manga.url,
          title: text(q(doc, 'div.author-info-title h1')) || manga.title,
          thumbnailUrl: absAttr(q(doc, 'div.text-right img'), 'src', base) || manga.thumbnailUrl || null,
          description: text(q(doc, 'div.review-content')) || null,
          genre: qa(doc, 'div.review-author-info a').map(text).join(', ') || null,
          author: author && author !== 'غير معروف' ? author : null,
          artist: null,
          status: STATUS[text(info('الحالة')?.querySelectorAll('small')?.[1])] ?? 0,
          initialized: true,
        },
        chapters: [...new Map(chapters.map((c) => [c.url, c])).values()],
      };
    }

    async function pages(chapter) {
      const url = `${base}${chapter.url}`;
      const doc = await get(url);
      return qa(doc, 'div.image_list canvas[data-src], div.image_list img[src]')
        .map((el) => (el.hasAttribute('src') ? absAttr(el, 'src', url) : absAttr(el, 'data-src', url)))
        .filter((u) => /^https?:\/\//.test(u))
        .map((imageUrl, index) => ({ index, url, imageUrl }));
    }

    return {
      popular,
      latest,
      search: (query) => search(query),
      series,
      chapters: async (manga) => (await series(manga)).chapters,
      pages,
      imageReferer: (page) => page?.url || `${base}/`,
      mangaUrl: (manga) => `${base}${manga.url}`,
    };
  },
};
