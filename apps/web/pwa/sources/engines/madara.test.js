import { DOMParser } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';
import { setParser } from '../dom.js';
import { parseDate } from '../dates.js';
import { decryptCryptoJs, md5Hex } from '../crypto.js';
import { madara, readMemo, statusOf } from './madara.js';

beforeAll(() => setParser((html, type = 'text/html') => new DOMParser().parseFromString(html, type)));

/** جالب وهمي: يرد بحسب «METHOD url» ويسجّل ما طُلب. */
function fakeFetch(routes) {
  const asked = [];
  const text = async (url, opts = {}) => {
    const method = opts.method ?? (opts.form || opts.body !== undefined ? 'POST' : 'GET');
    asked.push({ method, url, form: opts.form, referer: opts.referer });
    const key = `${method} ${url}`;
    const hit = routes[key] ?? routes[url];
    if (hit === undefined) return { status: 404, url, text: '', challenge: 'none' };
    const body = typeof hit === 'function' ? hit(opts) : hit;
    return { status: 200, url: body.url ?? url, text: body.text ?? body, challenge: 'none' };
  };
  return { asked, fetch: { text, page: text, json: async (u, o) => JSON.parse((await text(u, o)).text) } };
}

const ARCHIVE = `
<div class="page-item-detail" data-post-id="185951">
  <div class="item-thumb"><a href="https://site.test/manga/solo-swordmaster/"><img data-src="https://site.test/wp-content/uploads/solo-175x238.jpg" src="data:image/gif;base64,x"></a></div>
  <div class="post-title"><h3><a href="https://site.test/manga/solo-swordmaster/">Solo Swordmaster</a></h3></div>
</div>
<div class="page-item-detail"><div data-post-id="200"></div><div class="post-title"><a href="https://site.test/manga/other/">Other</a></div></div>`;

const DETAILS = `
<html><head><link rel="shortlink" href="https://site.test/?p=185951"></head><body>
<div class="post-title"><h1>Solo Swordmaster <span class="hot">HOT</span></h1></div>
<div class="summary_image"><img data-src="https://site.test/cover.jpg"></div>
<div class="author-content"><a>Updating</a><a>Kim</a></div>
<div class="genres-content"><a href="https://site.test/manga-genre/action/">أكشن</a></div>
<div class="post-content_item"><div class="summary-content">مستمرة</div></div>
<div class="description-summary"><div class="summary__content"><p>سطر أول</p><p>سطر ثان</p></div></div>
<div id="manga-chapters-holder" data-id="185951"></div>
</body></html>`;

const CHAPTERS = `
<ul><li class="wp-manga-chapter"><a href="https://site.test/manga/solo-swordmaster/chapter-2/">2</a><span class="chapter-release-date"><i>منذ 3 أيام</i></span></li>
<li class="wp-manga-chapter"><a href="https://site.test/manga/solo-swordmaster/chapter-1/">1</a><span class="chapter-release-date"><i>14 سبتمبر، 2026</i></span></li></ul>`;

const READER = `<div class="reading-content"><div class="page-break"><img data-src=" https://cdn.site.test/1.webp "></div><div class="page-break"><img src="https://cdn.site.test/2.webp"></div></div>`;

describe('madara engine', () => {
  it('lists with madara_load_more and keeps the APK id format (post id + memo path)', async () => {
    const { fetch, asked } = fakeFetch({ 'POST https://site.test/wp-admin/admin-ajax.php': ARCHIVE });
    const src = madara.create({ domain: 'site.test', config: {} }, { fetch });
    const out = await src.search('solo', 1);
    expect(out.mangas.map((m) => [m.url, m.title])).toEqual([['185951', 'Solo Swordmaster'], ['200', 'Other']]);
    expect(readMemo(out.mangas[0].memo)).toEqual({ path: '/manga/solo-swordmaster/' });
    expect(out.mangas[0].thumbnailUrl).toBe('https://site.test/wp-content/uploads/solo-175x238.jpg');
    expect(asked[0].form).toMatchObject({ action: 'madara_load_more', 'vars[s]': 'solo', page: '0' });
  });

  it('reads details, then falls back to the ajax chapter list when the page has none', async () => {
    const { fetch, asked } = fakeFetch({
      'GET https://site.test/manga/solo-swordmaster/': DETAILS,
      'POST https://site.test/manga/solo-swordmaster/ajax/chapters/': CHAPTERS,
    });
    const src = madara.create({ domain: 'site.test', config: {} }, { fetch });
    const { manga, chapters } = await src.series({ url: '185951', memo: '{"path":"/manga/solo-swordmaster/"}', title: 'x' });
    expect(manga).toMatchObject({ url: '185951', title: 'Solo Swordmaster', author: 'Kim', status: 1, description: 'سطر أول\n\nسطر ثان', thumbnailUrl: 'https://site.test/cover.jpg' });
    expect(manga.genre).toBe('أكشن');
    expect(chapters.map((c) => c.url)).toEqual(['chapter-2', 'chapter-1']);
    expect(readMemo(chapters[0].memo)).toEqual({ mangaPath: '/manga/solo-swordmaster/' });
    expect(chapters[1].dateUpload).toBe(Date.UTC(2026, 8, 14));
    expect(asked.some((a) => a.url.endsWith('/ajax/chapters/'))).toBe(true);
  });

  it('opens a work saved by the old format (a full url instead of an id)', async () => {
    const { fetch } = fakeFetch({ 'GET https://site.test/manga/solo-swordmaster/': DETAILS + CHAPTERS });
    const src = madara.create({ domain: 'site.test', config: {} }, { fetch });
    const { chapters } = await src.series({ url: 'https://old-domain.test/manga/solo-swordmaster/', title: 'x' });
    expect(chapters).toHaveLength(2);
  });

  it('builds page images from the chapter slug and gives the chapter as referer', async () => {
    const { fetch } = fakeFetch({ 'GET https://site.test/manga/solo-swordmaster/chapter-1/': READER });
    const src = madara.create({ domain: 'site.test', config: {} }, { fetch });
    const pages = await src.pages({ url: 'chapter-1', memo: '{"mangaPath":"/manga/solo-swordmaster/"}' });
    expect(pages).toEqual([
      { index: 0, url: 'https://site.test/manga/solo-swordmaster/chapter-1/', imageUrl: 'https://cdn.site.test/1.webp' },
      { index: 1, url: 'https://site.test/manga/solo-swordmaster/chapter-1/', imageUrl: 'https://cdn.site.test/2.webp' },
    ]);
    expect(src.imageReferer(pages[0])).toBe('https://site.test/manga/solo-swordmaster/chapter-1/');
  });

  it('decrypts the chapter protector (CryptoJS AES) like the APK', async () => {
    // نشفّر قائمة صور كما يفعل الموقع ثم نتحقق أن المحرك يفكّها
    const password = 'nonce123';
    const salt = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const enc = new TextEncoder();
    const md5 = (bytes) => Uint8Array.from(md5Hex(bytes).match(/../g), (h) => parseInt(h, 16));
    let derived = new Uint8Array(0);
    let prev = new Uint8Array(0);
    while (derived.length < 48) {
      prev = md5(new Uint8Array([...prev, ...enc.encode(password), ...salt]));
      derived = new Uint8Array([...derived, ...prev]);
    }
    const key = await crypto.subtle.importKey('raw', derived.slice(0, 32), { name: 'AES-CBC' }, false, ['encrypt']);
    const plain = JSON.stringify(JSON.stringify(['https://cdn.site.test/a.jpg']));
    const ct = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: derived.slice(32, 48) }, key, enc.encode(plain)))));
    const s = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await decryptCryptoJs({ ct, s }, password)).toBe(plain);

    const html = `<script id="chapter-protector-data">var wpmangaprotectornonce='${password}';var chapter_data='${JSON.stringify({ ct, s }).replace(/\//g, '\\/')}';</script>`;
    const { fetch } = fakeFetch({ 'GET https://site.test/manga/x/c-1/': html });
    const pages = await madara.create({ domain: 'site.test', config: {} }, { fetch }).pages({ url: 'c-1', memo: '{"mangaPath":"/manga/x/"}' });
    expect(pages.map((p) => p.imageUrl)).toEqual(['https://cdn.site.test/a.jpg']);
  });

  it('md5 matches the reference vectors', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });

  it('maps Arabic and English status words', () => {
    expect(statusOf('مكتملة')).toBe(2);
    expect(statusOf('OnGoing')).toBe(1);
    expect(statusOf('متوقف')).toBe(6);
    expect(statusOf('?')).toBe(0);
  });
});

describe('chapter dates', () => {
  const now = Date.UTC(2026, 9, 2, 12);
  it('reads relative, ISO and month-name dates in both languages', () => {
    expect(parseDate('منذ 3 أيام', now)).toBe(now - 3 * 864e5);
    expect(parseDate('2 hours ago', now)).toBe(now - 2 * 36e5);
    expect(parseDate('اليوم', now)).toBe(Date.UTC(2026, 9, 2));
    expect(parseDate('2026-09-14', now)).toBe(Date.UTC(2026, 8, 14));
    expect(parseDate('١٤ سبتمبر، ٢٠٢٦', now)).toBe(Date.UTC(2026, 8, 14));
    expect(parseDate('September 14, 2026', now)).toBe(Date.UTC(2026, 8, 14));
    expect(parseDate('14 أيلول 2026', now)).toBe(Date.UTC(2026, 8, 14));
    expect(parseDate('???', now)).toBe(0);
  });
  // مانجا ليك تكتب أحدث فصولها «ساعتين ago» و«ساعة ago»: كانت 0 فيصير أحدث فصل بلا
  // تاريخ، وأول مشاهدة لعمله خط أساس صامت لا يظهر في «آخر التحديثات»
  it('reads Arabic dual and number-less relative dates as Mangalek prints its newest chapters', () => {
    expect(parseDate('ساعتين ago', now)).toBe(now - 2 * 36e5);
    expect(parseDate('ساعة ago', now)).toBe(now - 36e5);
    expect(parseDate('4 ساعات ago', now)).toBe(now - 4 * 36e5);
    expect(parseDate('منذ يومين', now)).toBe(now - 2 * 864e5);
    expect(parseDate('دقيقتين ago', now)).toBe(now - 2 * 6e4);
    expect(parseDate('منذ أسبوعين', now)).toBe(now - 14 * 864e5);
    expect(parseDate('منذ شهرين', now)).toBe(now - 60 * 864e5);
  });
});
