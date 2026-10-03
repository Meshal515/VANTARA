/**
 * Akwam: نفس عيّنات `AkwamSiteTest.kt` (صفحات akwam.ss الحقيقية، فحص 2026-10-03)،
 * والمسار كاملًا: بحث ← حلقات الموسم ← تبويبات الجودة ← ملف mp4 مباشر بجودة سيرفره.
 */
import { DOMParser } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';
import { setParser } from '../dom.js';
import { readTitle } from '../../../lib/cinema-match.js';
import { akwam, cardsOf, episodesOf, qualityTabs, sourcesOf } from './akwam.js';

beforeAll(() => setParser((html, type = 'text/html') => new DOMParser().parseFromString(html, type)));

const B = 'https://akwam.ss';
const SEARCH = `
<div class="entry-box entry-box-1"><div class="entry-image"><a href="${B}/movie/4819/dune" class="box"><picture><img src="https://img.downet.net/thumb/178x260/placeholder.png" data-src="https://img.downet.net/thumb/178x260/uploads/dune.jpg" alt="Dune"/></picture></a></div>
  <div class="entry-body"><h3 class="entry-title font-size-14 m-0"><a href="${B}/movie/4819/dune"class="text-white">Dune</a></h3>
  <div><span class="badge badge-pill badge-secondary ml-1">2021</span><span class="badge badge-pill badge-light ml-1">خيال علمي</span></div></div></div>
<div class="entry-box entry-box-1"><div class="entry-image"><a href="${B}/series/1112/shameless" class="box"><img data-src="https://img.downet.net/thumb/178x260/uploads/s1.jpg" alt="x"/></a></div>
  <h3 class="entry-title"><a href="${B}/series/1112/shameless">Shameless الموسم لاول</a></h3><span class="badge badge-pill badge-secondary">2011</span></div>
<div class="entry-box"><h3 class="entry-title"><a href="${B}/person/1/x">شخص</a></h3></div>`;
const EP = (id, n) => `${B}/episode/${id}/shameless-%D8%A7%D9%84%D9%85%D9%88%D8%B3%D9%85-%D9%84%D8%A7%D9%88%D9%84/%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9-${n}`;
const SEASON = `<a href="${EP(17490, 2)}">حلقة 2 : مسلسل Shameless الموسم لاول</a><a href="${EP(17489, 1)}">حلقة 1 : مسلسل Shameless الموسم لاول Pilot</a><a href="${EP(17489, 1)}"><img></a>`;
const MOVIE = `
<ul class="header-tabs"><li><a href="#tab-3">480p</a></li><li><a href="#tab-5" class="selected">1080p</a></li><li><a href="#tab-4">720p</a></li></ul>
<div class="tab-content quality" id="tab-5"><a href="${B}/watch/101/4819/dune" class="link-btn link-show">مشاهدة</a><a href="${B}/download/101/4819/dune" class="link-download">تحميل</a></div>
<div class="tab-content quality" id="tab-4"><a href="${B}/watch/102/4819/dune" class="link-btn link-show">مشاهدة</a></div>
<div class="tab-content quality" id="tab-3"><a href="${B}/watch/103/4819/dune" class="link-btn link-show">مشاهدة</a></div>`;
const F1080 = 'https://s301d4.downet.net/download/1791103374/def/Dune.2021.1080p.Bluray.AKWAM.mp4';
const F720 = 'https://s302d6.downet.net/download/1791103374/abc/Dune.2021.720p.Bluray.AKWAM.mp4';
const WATCH = `<video id="player" controls>
  <source
      src="${F720}"
      type="video/mp4"
      size="720"
  />
  <source src="${F1080}" type="video/mp4" size="1080"/>
</video>`;

describe('akwam parsing', () => {
  it('search cards carry kind and year, one card per season page', () => {
    const items = cardsOf(SEARCH, 'akwam', B);
    expect(items.map((i) => i.title)).toEqual(['فيلم Dune 2021', 'مسلسل Shameless الموسم لاول 2011']);
    expect(items[0]).toMatchObject({ url: '/movie/4819/dune', thumbnail: 'https://img.downet.net/thumb/178x260/uploads/dune.jpg' });
    // مطابقة السينما تقرأ منها النوع والسنة والموسم (حتى «لاول» بلا ألف)
    expect(readTitle(items[0].title)).toEqual({ season: null, year: 2021, kind: 'movie' });
    expect(readTitle(items[1].title)).toEqual({ season: 1, year: 2011, kind: 'series' });
  });

  it('season page lists its episodes in order', () => {
    expect(episodesOf(SEASON, 'akwam', B).map((e) => [e.number, e.name])).toEqual([[1, 'الحلقة 1'], [2, 'الحلقة 2']]);
  });

  it('quality tabs point at watch pages, highest first; watch page gives direct files', () => {
    expect(qualityTabs(MOVIE, B)).toEqual([
      { quality: 1080, watch: `${B}/watch/101/4819/dune` },
      { quality: 720, watch: `${B}/watch/102/4819/dune` },
      { quality: 480, watch: `${B}/watch/103/4819/dune` },
    ]);
    expect(sourcesOf(WATCH, B)).toEqual([{ url: F1080, quality: 1080 }, { url: F720, quality: 720 }]);
  });
});

describe('akwam engine', () => {
  const routes = { [`${B}/search?q=dune`]: SEARCH, [`${B}/movie/4819/dune`]: MOVIE, [`${B}/series/1112/shameless`]: SEASON, [`${B}/watch/101/4819/dune`]: WATCH, [`${B}/watch/102/4819/dune`]: WATCH };
  const fetch = { page: async (url) => ({ status: 200, url, text: routes[url] ?? '' }) };
  const src = akwam.create({ id: 'akwam', domain: 'akwam.ss' }, { fetch });

  it('movie: one episode, a server per quality, each server its own file', async () => {
    const [item] = await src.search('dune');
    const [ep] = await src.episodes(item);
    const servers = await src.servers(ep);
    expect(servers.map((s) => s.quality)).toEqual([1080, 720, 480]);
    expect(await src.streams(servers[0])).toEqual([{ url: F1080, referer: null, quality: 1080, label: 'Akwam', type: 'mp4' }]);
    expect((await src.streams(servers[1])).map((s) => s.url)).toEqual([F720]);
  });

  it('series: the season page gives the episodes', async () => {
    const eps = await src.episodes({ url: '/series/1112/shameless', title: 'مسلسل Shameless الموسم لاول 2011' });
    expect(eps.map((e) => e.number)).toEqual([1, 2]);
  });
});
