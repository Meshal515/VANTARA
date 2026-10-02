/**
 * عائلات المانجا الجديدة: الصيغ (url/memo) مطابقة لامتدادات Keiyoushi في الـAPK،
 * فالعمل المحفوظ من منصة يفتح في الأخرى، والمسار الكامل يعمل على عيّنات حقيقية الشكل.
 */
import { DOMParser } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';
import { setParser } from '../dom.js';
import { zeistmanga } from './zeistmanga.js';
import { mangathemesia } from './mangathemesia.js';
import { iken } from './iken.js';
import { mangadex } from './mangadex.js';
import { mangaswat } from './mangaswat.js';
import { teamx } from './teamx.js';

beforeAll(() => setParser((html, type = 'text/html') => new DOMParser().parseFromString(html, type)));

function fakeFetch(routes) {
  const asked = [];
  const text = async (url, opts = {}) => {
    asked.push(url);
    const hit = Object.entries(routes).find(([k]) => (k.endsWith('*') ? url.startsWith(k.slice(0, -1)) : url === k))?.[1];
    if (hit === undefined) return { status: 404, url, text: '', challenge: 'none' };
    const body = typeof hit === 'function' ? hit(url, opts) : hit;
    return { status: 200, url, text: typeof body === 'string' ? body : JSON.stringify(body), challenge: 'none' };
  };
  return { asked, fetch: { text, page: text, json: async (u, o) => JSON.parse((await text(u, o)).text) } };
}

const entry = (title, href, terms, extra = {}) => ({ title: { $t: title }, link: [{ rel: 'alternate', href }], category: terms.map((term) => ({ term })), ...extra });

describe('zeistmanga (Blogger)', () => {
  const B = 'https://blog.test';
  it('searches inside the Series label and keeps post paths as urls', async () => {
    const { fetch, asked } = fakeFetch({
      [`${B}/feeds/posts/default/-/Series*`]: { feed: { entry: [entry('Blue Lock', `${B}/2023/05/blue-lock.html`, ['Series'], { 'media$thumbnail': { url: 'https://bp.test/s72-c/cover.jpg' } }), entry('Novel X', `${B}/2023/01/x.html`, ['Series', 'Novel'])] } },
    });
    const src = zeistmanga.create({ domain: 'blog.test', config: {} }, { fetch });
    const out = await src.search('blue lock');
    expect(out.mangas).toEqual([{ url: '/2023/05/blue-lock.html', title: 'Blue Lock', thumbnailUrl: 'https://bp.test/w600/cover.jpg' }]);
    expect(asked[0]).toContain('q=label%3ASeries+blue%20lock');
  });

  it('finds the chapter feed (clwd.run) and the pages, falling back to the post feed', async () => {
    const page = `<div class="grid gtc-235fr"><img src="${B}/c.jpg"><div id="synopsis">قصة</div><span data-status>Ongoing</span></div><div id="clwd"><script>clwd.run('Blue Lock');</script></div>`;
    const { fetch } = fakeFetch({
      [`${B}/2023/05/blue-lock.html`]: page,
      [`${B}/feeds/posts/default/-/Chapter/Blue%20Lock*`]: { feed: { 'openSearch$totalResults': { $t: '1' }, entry: [entry('الفصل 1', `${B}/2023/05/ch1.html`, ['Chapter', 'Blue Lock'], { published: { $t: '2023-05-01T10:00:00.000+03:00' } })] } },
      [`${B}/2023/05/ch1.html`]: `<script>var x = {"postId": "123456789012"}</script>`,
      [`${B}/feeds/posts/default/123456789012?alt=json`]: { entry: { content: { $t: '<div class="separator"><img src="https://bp.test/img/1.jpg"></div><div class="separator"><img src="https://bp.test/img/2.jpg"></div>' } } },
    });
    const src = zeistmanga.create({ domain: 'blog.test', config: {} }, { fetch });
    const { manga, chapters } = await src.series({ url: '/2023/05/blue-lock.html', title: 'Blue Lock' });
    expect(manga.description).toBe('قصة');
    expect(manga.status).toBe(1);
    expect(JSON.parse(manga.memo).feedUrl.category).toBe('Chapter');
    expect(chapters).toMatchObject([{ url: '/2023/05/ch1.html', name: 'الفصل 1' }]);
    expect(chapters[0].dateUpload).toBe(Date.parse('2023-05-01T07:00:00.000Z'));
    expect((await src.pages(chapters[0])).map((p) => p.imageUrl)).toEqual(['https://bp.test/img/1.jpg', 'https://bp.test/img/2.jpg']);
  });
});

describe('mangathemesia', () => {
  const B = 'https://mt.test';
  it('lists, reads chapters and decodes ts_reader pages', async () => {
    const reader = `ts_reader.run({"sources":[{"images":["https://img.test/1.jpg","/2.jpg"]}]})`;
    const { fetch } = fakeFetch({
      [`${B}/manga/?title=solo&page=1`]: `<div class="listupd"><div class="bs"><div class="bsx"><a href="${B}/manga/solo/" title="Solo"><img src="${B}/s.jpg"></a></div></div></div>`,
      [`${B}/manga/solo/`]: `<div class="bigcontent"><h1 class="entry-title">Solo</h1><div class="entry-content" itemprop="description">قصة</div><div class="mgen"><a>أكشن</a></div></div><div id="chapterlist"><ul><li><a href="${B}/solo-chapter-2/"><span class="chapternum">الفصل 2</span><span class="chapterdate">September 14, 2026</span></a></li></ul></div><script>var post_id = 77;</script>`,
      [`${B}/solo-chapter-2/`]: `<div id="readerarea"></div><script src="data:text/javascript;base64,${btoa(reader)}"></script>`,
    });
    const src = mangathemesia.create({ domain: 'mt.test', config: {} }, { fetch });
    const { mangas } = await src.search('solo');
    expect(mangas).toEqual([{ url: '/manga/solo/', title: 'Solo', thumbnailUrl: `${B}/s.jpg` }]);
    const { manga, chapters } = await src.series(mangas[0]);
    expect(manga).toMatchObject({ title: 'Solo', description: 'قصة', genre: 'أكشن', memo: '{"postId":"77"}' });
    expect(chapters).toMatchObject([{ url: '/solo-chapter-2/', name: 'الفصل 2' }]);
    expect((await src.pages(chapters[0])).map((p) => p.imageUrl)).toEqual(['https://img.test/1.jpg', `${B}/2.jpg`]);
  });
});

describe('iken (JSON API)', () => {
  it('keeps "slug#id" and hides locked chapters', async () => {
    const A = 'https://api.iken.test/api';
    const { fetch } = fakeFetch({
      [`${A}/query*`]: { totalCount: 1, posts: [{ id: 9, slug: 'solo', postTitle: 'Solo', featuredImage: 'https://s.test/c.png' }] },
      [`${A}/post?postSlug=solo`]: { totalChapterCount: 2, post: { id: 9, slug: 'solo', postTitle: 'Solo', seriesStatus: 'ONGOING', seriesType: 'MANHWA', genres: [{ name: 'اكشن' }], chapters: [] } },
      [`${A}/chapters?postId=9`]: { post: { chapters: [{ id: 2, slug: 'chapter-2', number: 2, createdAt: '2026-10-01T13:00:00Z', isLocked: true, price: 50 }, { id: 1, slug: 'chapter-1', number: 1, createdAt: '2026-09-01T13:00:00Z', price: 0 }] } },
      [`${A}/chapter?chapterId=1`]: { chapter: { images: [{ url: 'https://s.test/b 2.jpg', order: 2 }, { url: 'https://s.test/a.jpg', order: 1 }] } },
    });
    const src = iken.create({ domain: 'iken.test', config: {} }, { fetch });
    const { mangas } = await src.search('solo');
    expect(mangas[0]).toMatchObject({ url: 'solo#9', title: 'Solo' });
    const { manga, chapters } = await src.series(mangas[0]);
    expect(manga).toMatchObject({ status: 1, genre: 'Manhwa, اكشن' });
    expect(chapters).toMatchObject([{ url: '/series/solo/chapter-1#1', chapterNumber: 1 }]);
    expect((await src.pages(chapters[0])).map((p) => p.imageUrl)).toEqual(['https://s.test/a.jpg', 'https://s.test/b%202.jpg']);
  });
});

describe('mangadex', () => {
  it('uses /manga/<uuid> and /chapter/<uuid>, Arabic only, skipping external chapters', async () => {
    const { fetch, asked } = fakeFetch({
      'https://api.mangadex.org/manga?*': { total: 1, offset: 0, data: [{ id: 'm1', attributes: { title: { en: 'One Piece' } }, relationships: [{ type: 'cover_art', attributes: { fileName: 'c.jpg' } }] }] },
      'https://api.mangadex.org/manga/m1?*': { data: { id: 'm1', attributes: { title: { en: 'One Piece' }, description: { ar: 'قصة', en: 'story' }, status: 'ongoing', tags: [] }, relationships: [{ type: 'author', attributes: { name: 'Oda' } }] } },
      'https://api.mangadex.org/manga/m1/feed*': { total: 2, data: [{ id: 'c2', attributes: { chapter: '2', externalUrl: 'https://x.test', pages: 0 } }, { id: 'c1', attributes: { chapter: '1', volume: '1', pages: 3, publishAt: '2026-01-01T00:00:00Z' } }] },
      'https://api.mangadex.org/at-home/server/c1': { baseUrl: 'https://node.test', chapter: { hash: 'h', data: ['1.png', '2.png'] } },
    });
    const src = mangadex.create({ domain: 'mangadex.org', config: { lang: 'ar' } }, { fetch });
    const { mangas } = await src.search('one piece');
    expect(mangas[0]).toEqual({ url: '/manga/m1', title: 'One Piece', thumbnailUrl: 'https://uploads.mangadex.org/covers/m1/c.jpg.256.jpg' });
    expect(asked[0]).toContain('availableTranslatedLanguage%5B%5D=ar');
    const { manga, chapters } = await src.series(mangas[0]);
    expect(manga).toMatchObject({ description: 'قصة', author: 'Oda', status: 1 });
    expect(chapters).toMatchObject([{ url: '/chapter/c1', name: 'مجلد 1 · الفصل 1' }]);
    expect((await src.pages(chapters[0])).map((p) => p.imageUrl)).toEqual(['https://node.test/data/h/1.png', 'https://node.test/data/h/2.png']);
  });
});

describe('mangaswat and teamx', () => {
  it('mangaswat: numeric work id, /chapters/<id>/<slug>/ chapters, follows pagination', async () => {
    const A = 'https://swat.test/v2/api/v2';
    const { fetch } = fakeFetch({
      [`${A}/series/?search=solo&page=1`]: { next: null, results: [{ id: 5, title: 'Solo', poster: { medium: 'https://swat.test/p.webp' } }] },
      [`${A}/series/5/`]: { title: 'Solo', poster: { medium: 'https://swat.test/p.webp' }, status: { name: 'completed' }, genres: [{ name: 'مغامرات' }] },
      [`${A}/chapters/?serie=5&order_by=-order&page_size=200`]: { next: 'http://swat.test/v2/api/v2/chapters/?page=2', results: [{ id: 11, slug: '2', chapter: '2', created_at: '2026-01-02T00:00:00Z' }] },
      'https://swat.test/v2/api/v2/chapters/?page=2': { next: null, results: [{ id: 10, slug: '1', chapter: '1', created_at: '2026-01-01T00:00:00Z' }] },
      [`${A}/chapters/10/`]: { images: [{ image: 'https://swat.test/1.webp' }] },
    });
    const src = mangaswat.create({ domain: 'swat.test', config: {} }, { fetch });
    const { mangas } = await src.search('solo');
    expect(mangas[0].url).toBe('5');
    const { manga, chapters } = await src.series(mangas[0]);
    expect(manga.status).toBe(2);
    expect(chapters.map((c) => c.url)).toEqual(['/chapters/11/2/', '/chapters/10/1/']);
    expect((await src.pages(chapters[1]))[0].imageUrl).toBe('https://swat.test/1.webp');
  });

  it('teamx: hides locked chapters and reads canvas pages', async () => {
    const B = 'https://tx.test';
    const { fetch } = fakeFetch({
      [`${B}/search?keyword=solo`]: `<div class="tx-grid"><a class="tx-card" href="${B}/series/solo"><img src="${B}/thumbnail_c.jpg"><h3>Solo</h3></a></div>`,
      [`${B}/series/solo`]: `<div class="author-info-title"><h1>Solo</h1></div><div class="review-content">قصة</div><div class="full-list-info"><small>الحالة</small><small>مكتمل</small></div>
        <div class="chapter-card" data-number="2" data-date="1700000000"><a href="${B}/series/solo/2"></a><span class="locked"></span></div>
        <div class="chapter-card" data-number="1" data-date="1600000000"><a href="${B}/series/solo/1"></a><div class="chapter-info"><div class="chapter-title">البداية</div></div></div>`,
      [`${B}/series/solo/1`]: `<div class="image_list"><canvas data-src="${B}/p1.webp"></canvas><img src="${B}/p2.webp"></div>`,
    });
    const src = teamx.create({ domain: 'tx.test', config: {} }, { fetch });
    const { mangas } = await src.search('solo');
    expect(mangas[0]).toEqual({ url: '/series/solo', title: 'Solo', thumbnailUrl: `${B}/c.jpg` });
    const { manga, chapters } = await src.series(mangas[0]);
    expect(manga).toMatchObject({ status: 2, description: 'قصة' });
    expect(chapters).toEqual([{ url: '/series/solo/1', name: 'الفصل 1 - البداية', dateUpload: 1600000000000, chapterNumber: 1, scanlator: null }]);
    expect((await src.pages(chapters[0])).map((p) => p.imageUrl)).toEqual([`${B}/p1.webp`, `${B}/p2.webp`]);
  });
});
