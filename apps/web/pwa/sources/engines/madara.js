/**
 * محرك Madara (قالب ووردبريس للمانجا) — عائلة واحدة تخدم أغلب المصادر العربية.
 *
 * منقول من سلوك `lib-multisrc/madara` في Keiyoushi (lib 1.6) بنفس الصيغ، فالعمل
 * المحفوظ من الـAPK يفتح هنا والعكس:
 *   - العمل: `url` = رقم المنشور إن عُرف وإلا مساره، و`memo` = {"path": …}.
 *   - الفصل: `url` = اسمه في الرابط (slug)، و`memo` = {"mangaPath": …}.
 * ويقبل الصيغ القديمة أيضًا (رابط كامل أو مسار في `url`).
 *
 * الإعداد (من تعريف المصدر، بيانات لا كود):
 *   listing      'ajax' (madara_load_more) | 'archive' (صفحات /manga/ وبحث HTML)
 *   chapterMode  'page' | 'adminAjax' | 'mangaAjax' | 'paginated' | 'query'
 *   mangaSubString، pageSize، pageSelector، archiveUrlSelector، descriptionSelector، statusSelector
 * وإن رجع وضع الفصول المحدد فارغًا، تُجرّب الأوضاع الأخرى (موقع غيّر قالبه لا يكسرنا).
 */

import { q, qa, absAttr, attr, imageOf, ownText, parseHtml, pathOf, resolve, text } from '../dom.js';
import { parseDate } from '../dates.js';
import { decryptCryptoJs } from '../crypto.js';

const COMPLETED = ['completed', 'complete', 'مكتملة', 'مكتمل', 'منتهية', 'منتهي', 'end'];
const ONGOING = ['ongoing', 'on going', 'updating', 'مستمرة', 'مستمر', 'جارية', 'جاري', 'يصدر'];
const HIATUS = ['on hold', 'hiatus', 'متوقف', 'متوقفة'];
const CANCELLED = ['canceled', 'cancelled', 'ملغي', 'ملغية'];

export function statusOf(value) {
  const v = String(value ?? '').toLowerCase();
  if (COMPLETED.some((w) => v.includes(w))) return 2;
  if (ONGOING.some((w) => v.includes(w))) return 1;
  if (HIATUS.some((w) => v.includes(w))) return 6;
  if (CANCELLED.some((w) => v.includes(w))) return 5;
  return 0;
}

export function readMemo(memo) {
  if (!memo) return {};
  if (typeof memo === 'object') return memo;
  try {
    const parsed = JSON.parse(memo);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const DEFAULTS = {
  listing: 'ajax',
  chapterMode: 'page',
  mangaSubString: 'manga',
  pageSize: 25,
  archiveSelector: 'div.page-item-detail, .manga__item, .c-tabs-item__content',
  searchCardSelector: '.c-tabs-item__content',
  archiveUrlSelector: '.post-title a',
  titleSelector: 'div.post-title h3, div.post-title h1, #manga-title > h1',
  authorSelector: 'div.author-content > a, div.manga-authors > a',
  artistSelector: 'div.artist-content > a',
  statusSelector: 'div.summary-content',
  descriptionSelector: 'div.description-summary div.summary__content, div.summary_content div.post-content_item > h5 + div, div.summary_content div.manga-excerpt',
  thumbnailSelector: 'div.summary_image img',
  genreSelector: 'div.genres-content a',
  tagSelector: 'div.tags-content a',
  chapterSelector: 'li.wp-manga-chapter',
  chapterDateSelector: 'span.chapter-release-date',
  pageSelector: 'div.page-break img, li.blocks-gallery-item img, .reading-content .text-left img',
};

const CHAPTER_MODES = ['page', 'mangaAjax', 'adminAjax', 'paginated', 'query'];

export const madara = {
  kind: 'madara',
  content: 'manga',
  create(def, { fetch }) {
    const cfg = { ...DEFAULTS, ...(def.config ?? {}) };
    const base = `https://${def.domain}`;
    const xhr = { xhr: true, referer: `${base}/` };

    const mangaPathOf = (manga) => {
      const memo = readMemo(manga?.memo);
      if (memo.path) return memo.path;
      const url = String(manga?.url ?? '');
      if (/^https?:\/\//.test(url)) return pathOf(url);
      if (url && !/^\d+$/.test(url)) return url.startsWith('/') ? url : `/${url}`;
      return null;
    };

    const postIdOf = (manga) => {
      const url = String(manga?.url ?? '');
      if (/^\d+$/.test(url)) return url;
      const id = readMemo(manga?.memo).id;
      return id ? String(id) : null;
    };

    function mangaMemo(path, genres = []) {
      return JSON.stringify(genres.length ? { path, genres } : { path });
    }

    function archiveManga(el, id) {
      const link = q(el, cfg.archiveUrlSelector) ?? q(el, '.post-title a') ?? q(el, 'a[href]');
      const href = absAttr(link, 'href', base);
      if (!href) return null;
      const path = pathOf(href);
      return {
        url: id || path,
        title: text(link),
        thumbnailUrl: imageOf(q(el, 'img'), base) || null,
        memo: mangaMemo(path),
      };
    }

    function parseArchive(doc) {
      const out = [];
      for (const el of qa(doc, cfg.archiveSelector)) {
        const id = attr(el, 'data-post-id') || attr(q(el, '[data-post-id]'), 'data-post-id');
        const m = archiveManga(el, id);
        if (m?.title) out.push(m);
      }
      return dedupe(out);
    }

    const dedupe = (list) => [...new Map(list.map((m) => [mangaPathOf(m) ?? m.url, m])).values()];

    async function ajaxList(page, mode, query = '') {
      const form = {
        action: 'madara_load_more',
        page: String(page - 1),
        template: cfg.ajaxTemplate ?? 'madara-core/content/content-archive',
        'vars[paged]': '1',
        'vars[template]': 'archive',
        'vars[posts_per_page]': String(cfg.pageSize),
        'vars[post_type]': 'wp-manga',
        'vars[post_status]': 'publish',
        'vars[manga_archives_item_layout]': 'big_thumbnail',
      };
      if (cfg.filterNonManga !== false) {
        form['vars[meta_query][0][key]'] = '_wp_manga_chapter_type';
        form['vars[meta_query][0][value]'] = 'manga';
      }
      const sort = (key) => {
        form['vars[orderby]'] = 'meta_value_num';
        form['vars[meta_key]'] = key;
        form['vars[order]'] = 'DESC';
      };
      if (mode === 'popular') sort('_wp_manga_views');
      else if (mode === 'latest') sort('_latest_update');
      else if (query) form['vars[s]'] = query;
      const res = await fetch.page(`${base}/wp-admin/admin-ajax.php`, { form, ...xhr });
      const mangas = parseArchive(parseHtml(res.text));
      return { mangas, hasNextPage: mangas.length >= cfg.pageSize };
    }

    async function archivePage(page, order, query = '') {
      const url = new URL(`${base}/${cfg.mangaSubString}/${page > 1 ? `page/${page}/` : ''}`);
      if (order) url.searchParams.set('m_orderby', order);
      if (query) url.searchParams.set('s', query);
      const doc = parseHtml((await fetch.page(url.toString(), { referer: `${base}/` })).text);
      return { mangas: parseArchive(doc), hasNextPage: Boolean(q(doc, 'div.nav-previous, a.nextpostslink, #navigation-ajax')) };
    }

    async function htmlSearch(page, query) {
      const url = new URL(`${base}/${page > 1 ? `page/${page}/` : ''}`);
      url.searchParams.set('s', query);
      url.searchParams.set('post_type', 'wp-manga');
      const doc = parseHtml((await fetch.page(url.toString(), { referer: `${base}/` })).text);
      const archived = parseArchive(doc);
      if (archived.length) return { mangas: archived, hasNextPage: Boolean(q(doc, 'div.nav-previous, a.nextpostslink')) };
      // بطاقات البحث بلا رقم منشور: المسار هو الرابط (الـAPK يقبله أيضًا)
      const cards = qa(doc, cfg.searchCardSelector)
        .map((el) => archiveManga(el, ''))
        .filter((m) => m?.title);
      return { mangas: dedupe(cards), hasNextPage: Boolean(q(doc, 'div.nav-previous, a.nextpostslink')) };
    }

    const listing = (page, mode, query) => {
      if (cfg.listing === 'archive') {
        if (mode === 'search') return htmlSearch(page, query);
        return archivePage(page, mode === 'popular' ? 'views' : 'latest');
      }
      return ajaxList(page, mode, query);
    };

    async function detailsDocument(manga) {
      const path = mangaPathOf(manga);
      const id = postIdOf(manga);
      if (path) {
        const res = await fetch.text(resolve(path, base), { referer: `${base}/` });
        if (res.status >= 200 && res.status < 300) return { doc: parseHtml(res.text), url: res.url };
      }
      if (!id) throw new Error('عمل بلا رابط ولا رقم');
      const res = await fetch.page(`${base}/?p=${id}`, { referer: `${base}/` });
      return { doc: parseHtml(res.text), url: res.url };
    }

    function documentPostId(doc) {
      return (
        attr(q(doc, '[id^=manga-chapters-holder]'), 'data-id') ||
        attr(q(doc, 'input.rating-post-id'), 'value') ||
        attr(q(doc, 'a[data-post]'), 'data-post') ||
        (attr(q(doc, 'link[rel=shortlink]'), 'href').match(/[?&]p=(\d+)/)?.[1] ?? '')
      );
    }

    function parseDetails(doc, pageUrl, previous) {
      const path = pathOf(pageUrl) || mangaPathOf(previous);
      const id = documentPostId(doc);
      const titleEl = q(doc, cfg.titleSelector);
      const description = (() => {
        const el = q(doc, cfg.descriptionSelector);
        if (!el) return null;
        const ps = qa(el, 'p').map(text).filter(Boolean);
        return ps.length ? ps.join('\n\n') : text(el) || null;
      })();
      const statusEls = qa(doc, cfg.statusSelector);
      const genres = qa(doc, cfg.genreSelector).map((a) => {
        const p = pathOf(absAttr(a, 'href', base));
        return { name: text(a), slug: p.replace(/\/+$/, '').split('/').pop() ?? '', path: p };
      });
      const tags = qa(doc, cfg.tagSelector).map(text);
      const keepUrl = previous?.url && !/^\d+$/.test(String(previous.url)) ? previous.url : null;
      return {
        url: id || keepUrl || path,
        title: ownText(titleEl) || text(titleEl) || previous?.title || '',
        thumbnailUrl: imageOf(q(doc, cfg.thumbnailSelector), base) || previous?.thumbnailUrl || null,
        author: qa(doc, cfg.authorSelector).map(text).filter((t) => !/updating/i.test(t)).join(', ') || null,
        artist: qa(doc, cfg.artistSelector).map(text).filter((t) => !/updating/i.test(t)).join(', ') || null,
        description,
        genre: [...new Set([...genres.map((g) => g.name), ...tags].filter(Boolean))].join(', ') || null,
        status: statusOf(statusEls.length ? text(statusEls[statusEls.length - 1]) : ''),
        initialized: true,
        memo: mangaMemo(path, genres.filter((g) => g.slug)),
      };
    }

    function parseChapters(doc, mangaPath) {
      const out = [];
      for (const li of qa(doc, cfg.chapterSelector)) {
        const a = q(li, 'a[href]');
        const href = absAttr(a, 'href', base);
        if (!href) continue;
        const slug = pathOf(href).split('?')[0].replace(/\/+$/, '').split('/').pop();
        if (!slug) continue;
        const dateText = attr(q(li, 'img:not(.thumb)'), 'alt') || attr(q(li, 'span a'), 'title') || text(q(li, cfg.chapterDateSelector));
        out.push({
          url: slug,
          name: text(a),
          dateUpload: parseDate(dateText),
          chapterNumber: -1,
          scanlator: null,
          memo: JSON.stringify({ mangaPath }),
        });
      }
      return [...new Map(out.map((c) => [c.url, c])).values()];
    }

    async function chaptersBy(mode, mangaPath, id, doc) {
      const ajaxUrl = `${base}${mangaPath.replace(/\/+$/, '')}/ajax/chapters/`;
      switch (mode) {
        case 'page':
          return doc ? parseChapters(doc, mangaPath) : [];
        case 'adminAjax':
          if (!id) return [];
          return parseChapters(parseHtml((await fetch.page(`${base}/wp-admin/admin-ajax.php`, { form: { action: 'manga_get_chapters', manga: id }, ...xhr })).text), mangaPath);
        case 'mangaAjax':
          return parseChapters(parseHtml((await fetch.page(ajaxUrl, { method: 'POST', body: '', ...xhr })).text), mangaPath);
        case 'paginated': {
          const all = [];
          let last = null;
          for (let page = 1; page <= 60; page += 1) {
            const res = await fetch.text(`${ajaxUrl}?t=${page}`, { method: 'POST', body: '', ...xhr });
            if (res.status === 404) break;
            const list = parseChapters(parseHtml(res.text), mangaPath);
            if (!list.length || list[list.length - 1].url === last) break;
            all.push(...list);
            last = list[list.length - 1].url;
          }
          return all;
        }
        case 'query': {
          const slug = mangaPath.replace(/\/+$/, '').split('/').pop();
          return parseChapters(parseHtml((await fetch.page(`${base}/index.php`, { form: { 'manga-core': slug, manga_ajax: '1', maction: 'get_chapters' }, ...xhr })).text), mangaPath);
        }
        default:
          return [];
      }
    }

    /** الوضع المحدد أولًا، ثم البقية: قالب تغيّر لا يترك العمل بلا فصول. */
    async function fetchChapters(mangaPath, id, doc) {
      const order = [cfg.chapterMode, ...CHAPTER_MODES.filter((m) => m !== cfg.chapterMode && m !== 'paginated' && m !== 'query')];
      let lastError = null;
      for (const mode of order) {
        try {
          const list = await chaptersBy(mode, mangaPath, id, doc);
          if (list.length) return list;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) throw lastError;
      return [];
    }

    async function series(manga) {
      const { doc, url } = await detailsDocument(manga);
      const details = parseDetails(doc, url, manga);
      const path = readMemo(details.memo).path;
      const chapters = await fetchChapters(path, documentPostId(doc) || postIdOf(manga), doc);
      return { manga: details, chapters };
    }

    function chapterUrlOf(chapter) {
      const url = String(chapter?.url ?? '');
      if (/^https?:\/\//.test(url)) return url;
      if (url.includes('/')) return resolve(url, base);
      const mangaPath = readMemo(chapter?.memo).mangaPath;
      if (!mangaPath) throw new Error('حدّث قائمة الفصول');
      return `${base}${mangaPath.replace(/\/+$/, '')}/${url}/`;
    }

    async function pages(chapter) {
      const chapterUrl = chapterUrlOf(chapter);
      let res = await fetch.page(chapterUrl, { referer: `${base}/` });
      let doc = parseHtml(res.text);
      if (q(doc, '#single-pager')) {
        const listUrl = new URL(chapterUrl);
        listUrl.searchParams.set('style', 'list');
        res = await fetch.page(listUrl.toString(), { referer: chapterUrl });
        doc = parseHtml(res.text);
      }
      const protector = q(doc, '#chapter-protector-data');
      if (protector) {
        const src = attr(protector, 'src');
        const script = src.startsWith('data:text/javascript;base64,') ? atob(src.split(',')[1]) : protector.textContent;
        const password = script.split("wpmangaprotectornonce='")[1]?.split("';")[0] ?? '';
        const encrypted = (script.split("chapter_data='")[1]?.split("';")[0] ?? '').replace(/\\\//g, '/');
        const raw = await decryptCryptoJs(JSON.parse(encrypted), password);
        const list = JSON.parse(JSON.parse(raw));
        return list.map((imageUrl, index) => ({ index, url: chapterUrl, imageUrl }));
      }
      // محدد المصدر أولًا، ثم أشكال Madara المعروفة: قالب تحدّث لا يترك الفصل فارغًا
      for (const selector of [cfg.pageSelector, 'img.wp-manga-chapter-img', '.reading-content img']) {
        const list = qa(doc, selector)
          .map((img) => imageOf(img, chapterUrl))
          .filter((u) => /^https?:\/\//.test(u));
        if (list.length) return list.map((imageUrl, index) => ({ index, url: chapterUrl, imageUrl }));
      }
      return [];
    }

    return {
      popular: (page = 1) => listing(page, 'popular'),
      latest: (page = 1) => listing(page, 'latest'),
      search: (query, page = 1) => listing(page, 'search', query),
      series,
      chapters: async (manga) => (await series(manga)).chapters,
      pages,
      /** مضيفات الصور تشترط صفحة الفصل مرجعًا. */
      imageReferer: (page) => page?.url || `${base}/`,
      mangaUrl: (manga) => resolve(mangaPathOf(manga) ?? `/?p=${postIdOf(manga)}`, base),
    };
  },
};
