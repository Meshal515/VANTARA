/**
 * EgyDead: عيّنات مطابقة لصفحات tv10.egydead.live الحقيقية (فحص 2026-10-03):
 * صفحة لكل موسم، والحلقات المفردة تُطوى فيه، وصفحات التجميع ليست عملًا.
 */
import { DOMParser } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';
import { setParser } from '../dom.js';
import { readTitle } from '../../../lib/cinema-match.js';
import { cardsOf, egydead, episodesOf, serversOf } from './egydead.js';

beforeAll(() => setParser((html, type = 'text/html') => new DOMParser().parseFromString(html, type)));

const B = 'https://tv10.egydead.live';
const card = (href, title) => `<li class="movieItem"><a href="${B}${href}" title="${title}"><img src="${B}/wp-content/uploads/x.jpg"><h1 class="BottomTitle">${title}</h1></a></li>`;
const SEARCH = [
  card('/serie/all-shameless/', 'جميع مواسم مسلسل Shameless 2011 مترجم كامل'),
  card('/assembly/dune-collection/', 'سلسلة افلام Dune مترجمة كاملة'),
  card('/season/shameless-s3/', 'مسلسل Shameless الموسم الثالث مترجم كامل'),
  card('/episode/shameless-s3-e12/', 'مسلسل Shameless الموسم الثالث الحلقة 12 الاخيرة'),
  card('/episode/dune-prophecy-6/', 'مسلسل Dune Prophecy الحلقة 6 مترجمة'),
  card('/episode/dune-prophecy-5/', 'مسلسل Dune Prophecy الحلقة 5 مترجمة'),
  card('/watch-dune-part-1-2021/', 'مشاهدة فيلم Dune Part 1 2021 مترجم'),
].join('');
const SEASON = `<div class="EpsList">
  <li><a href="${B}/episode/shameless-s3-e12/" title="مسلسل Shameless الموسم الثالث الحلقة 12 الاخيرة"> حلقه 12 </a></li>
  <li><a href="${B}/episode/shameless-s3-e1/" title="مسلسل Shameless الموسم الثالث الحلقة 1"> حلقه 1 </a></li>
</div>`;
const WATCH = `<ul class="serversList"><li data-link="https://hgcloud.to/e/vhipmjhf4oaa"><p>StreamHG</p></li><li data-link="https://mixdrop.top/e/eng9wxx0uqdjgo9"><p>Mixdrop</p></li></ul>
<div class="mob-servers"><ul><li data-link="https://hgcloud.to/e/vhipmjhf4oaa"><span><p>StreamHG</p></span></li><li data-link="https://playmogo.com/e/0a9mkfs6nxup"><span><p>DoodStream</p></span></li></ul></div>`;

describe('egydead parsing', () => {
  it('movies and season pages are copies; collections are not; lone episodes fold into a series', () => {
    const items = cardsOf(SEARCH, 'egydead', B);
    expect(items.map((i) => [i.url, i.title])).toEqual([
      ['/season/shameless-s3/', 'مسلسل Shameless الموسم الثالث مترجم كامل'],
      ['/watch-dune-part-1-2021/', 'مشاهدة فيلم Dune Part 1 2021 مترجم'],
      ['/episode/dune-prophecy-6/', 'مسلسل Dune Prophecy'],
    ]);
    expect(readTitle(items[0].title)).toMatchObject({ season: 3, kind: 'series' });
    expect(readTitle(items[1].title)).toMatchObject({ year: 2021, kind: 'movie' });
  });

  it('season page lists its episodes; servers are unique hosts', () => {
    expect(episodesOf(SEASON, 'egydead', B).map((e) => e.number)).toEqual([1, 12]);
    expect(serversOf(WATCH, B)).toEqual([
      { name: 'StreamHG', url: 'https://hgcloud.to/e/vhipmjhf4oaa' },
      { name: 'Mixdrop', url: 'https://mixdrop.top/e/eng9wxx0uqdjgo9' },
      { name: 'DoodStream', url: 'https://playmogo.com/e/0a9mkfs6nxup' },
    ]);
  });
});

describe('egydead engine', () => {
  it('asks the watch page with View=1 and hands each host to the resolver', async () => {
    const asked = [];
    const fetch = {
      page: async (url, opts = {}) => {
        asked.push([url, opts.form ?? null]);
        return { status: 200, url, text: url.endsWith('/season/shameless-s3/') ? SEASON : WATCH };
      },
    };
    const resolved = [];
    const hosts = { resolve: async (url, ref) => (resolved.push([url, ref]), [{ url: `${url}.m3u8`, type: 'hls' }]) };
    const src = egydead.create({ id: 'egydead', domain: 'tv10.egydead.live' }, { fetch, hosts });
    const eps = await src.episodes({ url: '/season/shameless-s3/', title: 'مسلسل Shameless الموسم الثالث مترجم كامل' });
    const servers = await src.servers(eps[0]);
    expect(asked.at(-1)).toEqual([`${B}/episode/shameless-s3-e1/`, { View: 1 }]);
    expect(servers.map((s) => s.name)).toEqual(['StreamHG', 'Mixdrop', 'DoodStream']);
    await src.streams(servers[0]);
    expect(resolved).toEqual([['https://hgcloud.to/e/vhipmjhf4oaa', `${B}/episode/shameless-s3-e1/`]]);
  });
});
