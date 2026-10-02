/**
 * محرك ZeistManga — قالب Blogger للمانجا. موقع واحد = مدونة: الأعمال والفصول
 * منشورات بتصنيفات، وكل شيء من خلاصة Blogger JSON المفتوحة (`/feeds/posts/default`)
 * بلا كشط هش، إلا صفحة العمل نفسها (الوصف واسم خلاصة الفصول) وصفحة الفصل (الصور).
 *
 * منقول من `lib-multisrc/zeistmanga` في Keiyoushi بنفس الصيغ:
 *   العمل: `url` = مسار المنشور (/2024/01/slug.html)، `memo` = {"feedUrl": {url,old,new,category}}
 *   الفصل: `url` = مسار منشور الفصل.
 *
 * الإعداد (لكل موقع، بيانات لا كود):
 *   mangaCategory ('Series')، chapterCategory ('Chapter')، feedLabelSelector
 *   (عنصر يحمل اسم الخلاصة في data-label)، popular (false = الأحدث بدل الرائج)،
 *   detailsSelector، descriptionSelector، genreSelector، statusSelector، pageSelector.
 */

import { absAttr, attr, imageOf, parseHtml, pathOf, q, qa, text } from '../dom.js';
import { parseDate } from '../dates.js';
import { statusOf } from './madara.js';

const DEFAULTS = {
  mangaCategory: 'Series',
  chapterCategory: 'Chapter',
  excluded: ['Anime', 'Novel', 'Novela'],
  popular: true,
  popularSelector: 'div.PopularPosts div.grid > figure',
  detailsSelector: '.grid.gtc-235fr',
  descriptionSelector: '#synopsis',
  genreSelector: 'div.mt-15 > a[rel=tag]',
  statusSelector: 'span[data-status]',
  pageSelector: 'div.check-box div.separator',
  feedLabelSelector: null,
  pageSize: 20,
};

const termsOf = (entry) => (entry?.category ?? []).map((c) => c.term);
const linkOf = (entry) => (entry?.link ?? []).find((l) => l.rel === 'alternate')?.href ?? '';
/** صور Blogger المصغّرة (s72-c) ⇒ عرض 600. */
const bigThumb = (url) => String(url ?? '').replace(/\/s.+?-c\//, '/w600/').replace(/=s(?!.*=s).+?-c$/, '=w600');

export const zeistmanga = {
  kind: 'zeistmanga',
  content: 'manga',
  create(def, { fetch }) {
    const cfg = { ...DEFAULTS, ...(def.config ?? {}) };
    const base = `https://${def.domain}`;

    const feed = (path, params = {}) => {
      const url = new URL(`${base}/feeds/posts/default${path ? `/-/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`);
      url.searchParams.set('alt', 'json');
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      return url;
    };

    function entryManga(entry) {
      const href = linkOf(entry);
      if (!href) return null;
      const thumb = entry['media$thumbnail']?.url ? bigThumb(entry['media$thumbnail'].url) : imageOf(q(parseHtml(entry.content?.$t ?? ''), 'img'), base);
      return { url: pathOf(href), title: String(entry.title?.$t ?? '').trim(), thumbnailUrl: thumb || null };
    }

    function listing(data) {
      const entries = (data?.feed?.entry ?? []).filter((e) => termsOf(e).includes(cfg.mangaCategory) && !termsOf(e).some((t) => cfg.excluded.includes(t)));
      const mangas = entries.map(entryManga).filter((m) => m?.title);
      const hasNextPage = mangas.length > cfg.pageSize;
      return { mangas: hasNextPage ? mangas.slice(0, cfg.pageSize) : mangas, hasNextPage };
    }

    const startIndex = (page) => cfg.pageSize * (page - 1) + 1;

    async function latest(page = 1) {
      const url = feed(cfg.mangaCategory, { orderby: 'published', 'max-results': cfg.pageSize + 1, 'start-index': startIndex(page) });
      return listing(await fetch.json(url.toString()));
    }

    async function popular(page = 1) {
      if (!cfg.popular || page > 1) return latest(page);
      const doc = parseHtml((await fetch.page(`${base}/`)).text);
      const mangas = qa(doc, cfg.popularSelector)
        .map((el) => {
          const a = q(el, 'figcaption > a') ?? q(el, 'a[href]');
          return { url: pathOf(absAttr(a, 'href', base)), title: text(a), thumbnailUrl: imageOf(q(el, 'img'), base) || null };
        })
        .filter((m) => m.url && m.title);
      return mangas.length ? { mangas, hasNextPage: false } : latest(page);
    }

    async function search(query, page = 1) {
      // `q=label:Series+…` كما يبنيها Keiyoushi: البحث داخل تصنيف الأعمال وحده
      const url = feed(cfg.mangaCategory, { 'max-results': cfg.pageSize + 1, 'start-index': startIndex(page) });
      const raw = `${url.toString()}&q=${encodeURIComponent(`label:${cfg.mangaCategory}`)}+${encodeURIComponent(query.trim())}`;
      return listing(await fetch.json(raw));
    }

    /** اسم خلاصة الفصول من صفحة العمل (ثلاثة أشكال للقالب، ثم اسم العمل). */
    function chapterFeedUrl(doc, title) {
      const label = cfg.feedLabelSelector ? attr(q(doc, cfg.feedLabelSelector), 'data-label') : '';
      if (label) return feed(`${cfg.chapterCategory}/${label}`).toString();
      const clwd = q(doc, '#clwd > script')?.textContent ?? '';
      const run = clwd.match(/clwd\.run\(["'](.*?)["']\)/)?.[1];
      if (run) return feed(`${cfg.chapterCategory}/${run}`).toString();
      const old = attr(q(doc, '#myUL > script'), 'src').match(/([^']+)\?/)?.[1];
      if (old) return `${base}${pathOf(new URL(old, base).toString()).split('?')[0]}?alt=json`;
      const latestLabel = (q(doc, '#latest > script')?.textContent ?? '').match(/label\s*=\s*'([^']+)'/)?.[1];
      if (latestLabel) return feed(latestLabel).toString();
      return feed(`${cfg.chapterCategory}/${title}`).toString();
    }

    async function chaptersFrom(feedUrl) {
      const all = [];
      const pageSize = 150;
      for (let start = 1; start < 5000; start += pageSize) {
        const url = new URL(feedUrl);
        url.searchParams.set('start-index', String(start));
        url.searchParams.set('max-results', String(pageSize));
        const data = await fetch.json(url.toString());
        const entries = data?.feed?.entry ?? [];
        all.push(...entries);
        const total = Number(data?.feed?.['openSearch$totalResults']?.$t ?? 0);
        if (!entries.length || all.length >= total) break;
      }
      return all
        .filter((e) => termsOf(e).includes(cfg.chapterCategory))
        .map((e) => ({
          url: pathOf(linkOf(e)),
          name: String(e.title?.$t ?? '').trim(),
          dateUpload: Date.parse(e.published?.$t ?? e.updated?.$t ?? '') || parseDate(e.published?.$t ?? '') || 0,
          chapterNumber: -1,
          scanlator: null,
        }))
        .filter((c) => c.url && c.name);
    }

    async function series(manga) {
      const res = await fetch.page(new URL(manga.url, base).toString());
      const doc = parseHtml(res.text);
      const box = q(doc, cfg.detailsSelector) ?? doc;
      const title = manga.title || attr(q(doc, "meta[property='og:title']"), 'content').split('-')[0].trim();
      const feedUrl = chapterFeedUrl(doc, title);
      const details = {
        url: manga.url,
        title,
        thumbnailUrl: imageOf(q(box, 'img'), base) || manga.thumbnailUrl || null,
        description: text(q(box, cfg.descriptionSelector)) || attr(q(doc, "meta[property='og:description']"), 'content') || null,
        genre: qa(box, cfg.genreSelector).map(text).filter(Boolean).join(', ') || null,
        author: text(q(box, 'span#author')) || null,
        artist: text(q(box, 'span#artist')) || null,
        status: statusOf(text(q(box, cfg.statusSelector))),
        initialized: true,
        memo: JSON.stringify({ feedUrl: { url: feedUrl, old: false, new: false, category: cfg.chapterCategory } }),
      };
      return { manga: details, chapters: await chaptersFrom(feedUrl) };
    }

    const imagesIn = (root, url, selectors) => {
      for (const selector of selectors) {
        const list = qa(root, selector)
          .map((img) => imageOf(img, url))
          .filter((u) => /^https?:\/\//.test(u) && !/\/s\d{2,3}(-c)?\//.test(u));
        if (list.length) return [...new Set(list)];
      }
      return [];
    };

    async function pages(chapter) {
      const url = new URL(chapter.url, base).toString();
      const html = (await fetch.page(url, { referer: `${base}/` })).text;
      const doc = parseHtml(html);
      const fromPage = imagesIn(doc, url, [`${cfg.pageSelector} img`, '#reader div.separator img', 'div.check-box img', '#reader img', '.post-body div.separator img', '.post-body img']);
      if (fromPage.length) return fromPage.map((imageUrl, index) => ({ index, url, imageUrl }));
      // قالب يرسم الصور بسكربت: نفس المنشور من خلاصته (رقمه في الصفحة)
      const postId = html.match(/["']?postId["']?\s*[:=]\s*["']?(\d{8,})/)?.[1] ?? attr(q(doc, "meta[itemprop='postId']"), 'content');
      if (!postId) return [];
      const entry = (await fetch.json(`${base}/feeds/posts/default/${postId}?alt=json`))?.entry;
      const fromFeed = imagesIn(parseHtml(entry?.content?.$t ?? ''), url, ['div.separator img', 'img']);
      return fromFeed.map((imageUrl, index) => ({ index, url, imageUrl }));
    }

    return {
      popular,
      latest,
      search,
      series,
      chapters: async (manga) => (await series(manga)).chapters,
      pages,
      imageReferer: () => `${base}/`,
      mangaUrl: (manga) => new URL(manga.url, base).toString(),
    };
  },
};
