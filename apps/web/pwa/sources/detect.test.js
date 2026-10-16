import { describe, expect, it } from 'vitest';
import { createStore } from '../cache/store.js';
import { createRegistry } from './registry.js';
import { configVariants, detectEngine, siteDef, siteLabel, siteOrigin } from './detect.js';

const madaraPage = '<html><head><title>مانجا ليك – اقرأ المانجا</title><link rel="stylesheet" href="/wp-content/plugins/wp-manga/assets/css/style.css"></head><body><div class="c-blog-post"></div><script>var manga = {"ajax_url":"/wp-admin/admin-ajax.php"};</script></body></html>';
const themesiaPage = '<html><head><meta property="og:site_name" content="Lava Scans"><title>Lava</title></head><body><div class="listupd"><div class="bsx"></div></div><script src="/wp-content/themes/mangareader/assets/js/ts_reader.js"></script></body></html>';
const zeistPage = '<html><head><title>Yokai Team</title><script src="https://www.blogger.com/static/v1/widgets.js"></script></head><body><div id="zeistmanga"></div></body></html>';

describe('adding a manga site by its address', () => {
  it('recognises the theme each Arabic manga site is built on', () => {
    expect(detectEngine(madaraPage)).toBe('madara');
    expect(detectEngine(themesiaPage)).toBe('mangathemesia');
    expect(detectEngine(zeistPage)).toBe('zeistmanga');
    expect(detectEngine('<html><body>shop</body></html>')).toBe(null);
  });

  it('normalises what the user types and names the site from the page', () => {
    expect(siteOrigin('mangalek.net/manga/x')).toBe('https://mangalek.net');
    expect(siteOrigin('HTTP://WWW.Lavascans.com/')).toBe('https://www.lavascans.com');
    expect(() => siteOrigin('https://user:pw@x.com')).toThrow();
    expect(() => siteOrigin('localhost')).toThrow();
    expect(siteLabel(madaraPage, 'mangalek.net')).toBe('مانجا ليك');
    expect(siteLabel(themesiaPage, 'lavascans.com')).toBe('Lava Scans');
  });

  it('tries the known listing modes and the work path each site actually uses', () => {
    const serie = '<a href="https://hizomanga.net/serie/one/">1</a><a href="/serie/two/">2</a><a href="/manga/x/">x</a>';
    expect(configVariants('madara', serie, 'hizomanga.net')).toEqual([{ mangaSubString: 'serie' }, { mangaSubString: 'serie', listing: 'archive' }]);
    expect(configVariants('madara', '<a href="/manga/a/">a</a>', 'x.com')).toEqual([{}, { listing: 'archive' }]);
    expect(configVariants('mangathemesia', '<a href="/series/a/">a</a><a href="/series/b/">b</a>', 'x.com')).toEqual([{ mangaDir: '/series' }, {}]);
    expect(configVariants('zeistmanga', '', 'x.blogspot.com')).toEqual([{}]);
  });

  it('an unknown theme is explained, not added', () => {
    expect(() => siteDef({ origin: 'https://shop.test', html: '<html></html>' })).toThrow(/قالب/);
    expect(siteDef({ origin: 'https://mangalek.net', html: madaraPage })).toMatchObject({ id: 'user.mangalek.net', engine: 'madara', domain: 'mangalek.net', content: 'manga', user: true });
  });

  it('a site is added only after the full probe passes, survives bundle updates, and can be removed', async () => {
    let works = true;
    const madara = {
      kind: 'madara', content: 'manga',
      create: () => ({
        search: async () => (works ? { mangas: [{ url: '1', title: 'One' }], hasNextPage: false } : { mangas: [], hasNextPage: false }),
        popular: async () => (works ? { mangas: [{ url: '1', title: 'One' }], hasNextPage: false } : { mangas: [], hasNextPage: false }),
        series: async () => ({ manga: { url: '1', title: 'One' }, chapters: [{ url: 'c1', name: '1' }] }),
        pages: async () => [{ index: 0, url: 'x', imageUrl: 'https://img.test/1.jpg' }],
      }),
    };
    const fetch = { text: async () => ({ status: 200, text: madaraPage }) };
    const store = createStore({ indexedDB: null });
    const r = createRegistry({ engines: { madara }, store, ctx: { fetch } });
    await r.init([]);
    works = false;
    await expect(r.addSite('mangalek.net')).rejects.toThrow(/فارغ/);
    expect(r.userSites()).toEqual([]);
    works = true;
    const added = await r.addSite('https://mangalek.net/');
    expect(added).toMatchObject({ id: 'user.mangalek.net', engine: 'madara', label: 'مانجا ليك' });
    expect(r.list('manga').map((d) => d.id)).toEqual(['user.mangalek.net']);
    // تحديث تعريفات الحزمة لا يمسح مواقع المستخدم
    const again = createRegistry({ engines: { madara }, store, ctx: { fetch } });
    await again.init([]);
    expect(again.userSites().map((s) => s.id)).toEqual(['user.mangalek.net']);
    expect(again.source('user.mangalek.net')).toBeTruthy();
    await again.removeUser('user.mangalek.net');
    expect(again.list('manga')).toEqual([]);
  });

  it('the browser build explains that it only opens listed sites', async () => {
    const store = createStore({ indexedDB: null });
    const fetch = { text: async () => { throw Object.assign(new Error('host_not_allowed'), { code: 'host_not_allowed' }); } };
    const r = createRegistry({ engines: {}, store, ctx: { fetch } });
    await r.init([]);
    await expect(r.addSite('newsite.com')).rejects.toThrow(/التطبيق أو برنامج الويندوز/);
  });
});
