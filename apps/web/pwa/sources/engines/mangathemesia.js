/**
 * محرك MangaThemesia — قالب ووردبريس الثاني الأشهر للمانجا (بعد Madara).
 *
 * منقول من `lib-multisrc/mangathemesia` في Keiyoushi بنفس الصيغ:
 *   العمل: `url` = مساره (/manga/slug/)، `memo` = {"postId": …} إن عُرف
 *   الفصل: `url` = مساره (/slug-chapter-1/)
 * القوائم: `/manga/?title=…&order=popular|update&page=N`. الصفحات من
 * `#readerarea img`، أو من `ts_reader.run({...})` (نصًّا أو base64) حين يرسمها سكربت.
 *
 * الإعداد (لكل موقع): mangaDir، searchSelector، searchTitleSelector،
 * detailsSelector، titleSelector، descriptionSelector، genreSelector،
 * statusSelector، thumbnailSelector، chapterSelector، chapterNameSelector،
 * chapterDateSelector، pageSelector.
 */

import { absAttr, attr, imageOf, parseHtml, pathOf, q, qa, text } from '../dom.js';
import { parseDate } from '../dates.js';
import { statusOf } from './madara.js';

const DEFAULTS = {
  mangaDir: '/manga',
  searchSelector: '.utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx',
  searchTitleSelector: null,
  nextSelector: 'div.pagination .next, div.hpage .r',
  detailsSelector: 'div.bigcontent, div.animefull, div.main-info, div.postbody',
  titleSelector: '.entry-title, .ts-breadcrumb li:last-child span',
  descriptionSelector: '.desc, .entry-content[itemprop=description]',
  genreSelector: 'div.gnr a, .mgen a, .seriestugenre a',
  statusSelector: '.imptdt i, .tsinfo .imptdt:first-child i, .fmed b + span, span:has(b) i',
  thumbnailSelector: '.infomanga > div[itemprop=image] img, .thumb img',
  chapterSelector: 'div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)',
  chapterNameSelector: '.lch a, .chapternum',
  chapterDateSelector: '.chapterdate',
  pageSelector: 'div#readerarea img',
};

const READER_JSON = /"images"\s*:\s*(\[.*?])/s;

export const mangathemesia = {
  kind: 'mangathemesia',
  content: 'manga',
  create(def, { fetch }) {
    const cfg = { ...DEFAULTS, ...(def.config ?? {}) };
    const base = `https://${def.domain}`;

    async function list(page, { query = '', order = '' } = {}) {
      const url = new URL(`${base}${cfg.mangaDir}/`);
      if (query) url.searchParams.set('title', query.trim());
      if (order) url.searchParams.set('order', order);
      url.searchParams.set('page', String(page));
      const doc = parseHtml((await fetch.page(url.toString(), { referer: `${base}/` })).text);
      const mangas = qa(doc, cfg.searchSelector)
        .map((el) => {
          const a = q(el, 'a[href]') ?? (el.matches?.('a') ? el : null);
          const href = absAttr(a, 'href', base);
          const title = (cfg.searchTitleSelector && text(q(el, cfg.searchTitleSelector))) || attr(a, 'title') || text(q(el, '.tt, .bigor .tt, h3, h2'));
          return href ? { url: pathOf(href), title, thumbnailUrl: imageOf(q(el, 'img'), base) || null } : null;
        })
        .filter((m) => m?.title);
      return { mangas: [...new Map(mangas.map((m) => [m.url, m])).values()], hasNextPage: Boolean(q(doc, cfg.nextSelector)) };
    }

    const postIdOf = (doc) => {
      for (const s of qa(doc, 'script')) {
        const id = (s.textContent ?? '').match(/post_id\s*[:=]\s*["']?(\d+)/)?.[1] ?? (s.textContent ?? '').match(/"postId"\s*:\s*"?(\d+)/)?.[1];
        if (id) return id;
      }
      return attr(q(doc, 'link[rel=shortlink]'), 'href').match(/[?&]p=(\d+)/)?.[1] ?? null;
    };

    async function series(manga) {
      const res = await fetch.page(new URL(manga.url, base).toString(), { referer: `${base}/` });
      const doc = parseHtml(res.text);
      const box = q(doc, cfg.detailsSelector) ?? doc;
      const postId = postIdOf(doc);
      const details = {
        url: pathOf(res.url) || manga.url,
        title: text(q(box, cfg.titleSelector)) || manga.title,
        thumbnailUrl: imageOf(q(box, cfg.thumbnailSelector), base) || manga.thumbnailUrl || null,
        description: text(q(box, cfg.descriptionSelector)) || null,
        genre: qa(box, cfg.genreSelector).map(text).filter(Boolean).join(', ') || null,
        author: null,
        artist: null,
        status: statusOf(text(q(box, cfg.statusSelector))),
        initialized: true,
        ...(postId ? { memo: JSON.stringify({ postId }) } : {}),
      };
      const chapters = qa(doc, cfg.chapterSelector)
        .map((li) => {
          const a = q(li, 'a[href]');
          const href = absAttr(a, 'href', base);
          if (!href) return null;
          return {
            url: pathOf(href),
            name: text(q(li, cfg.chapterNameSelector)) || text(a),
            dateUpload: parseDate(text(q(li, cfg.chapterDateSelector))),
            chapterNumber: -1,
            scanlator: null,
          };
        })
        .filter((c) => c?.url && c.name);
      return { manga: details, chapters: [...new Map(chapters.map((c) => [c.url, c])).values()] };
    }

    async function pages(chapter) {
      const url = new URL(chapter.url, base).toString();
      const res = await fetch.page(url, { referer: `${base}/` });
      const doc = parseHtml(res.text);
      const html = qa(doc, cfg.pageSelector)
        .map((img) => imageOf(img, url))
        .filter((u) => /^https?:\/\//.test(u));
      if (html.length) return html.map((imageUrl, index) => ({ index, url, imageUrl }));
      // ts_reader.run({...}): نصًّا في الصفحة أو سكربت data:base64
      const encoded = attr(q(doc, 'script[src^="data:text/javascript;base64,dHNfcmVhZGVyLnJ1bih7"]'), 'src').split('base64,')[1];
      const source = encoded ? atob(encoded) : res.text;
      try {
        const list = JSON.parse(source.match(READER_JSON)?.[1] ?? '[]');
        return list.filter((u) => typeof u === 'string' && u).map((u, index) => ({ index, url, imageUrl: new URL(u, base).toString() }));
      } catch {
        return [];
      }
    }

    return {
      popular: (page = 1) => list(page, { order: 'popular' }),
      latest: (page = 1) => list(page, { order: 'update' }),
      search: (query, page = 1) => list(page, { query }),
      series,
      chapters: async (manga) => (await series(manga)).chapters,
      pages,
      imageReferer: (page) => page?.url || `${base}/`,
      mangaUrl: (manga) => new URL(manga.url, base).toString(),
    };
  },
};
