/**
 * RistoAnime: نفس عيّنات `RistoAnimeSiteTest.kt` (صفحات ristoanime.me الحقيقية، فحص 2026-10-03):
 * المسلسل متعدد المواسم نسخة لكل موسم بأسماء AniList، والمضيفات بلا `.html` الزائد.
 */
import { DOMParser } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';
import { setParser } from '../dom.js';
import { genericStreams } from '../hosts.js';
import { judgeAnimeCopy } from '../../../lib/anime-engine.js';
import { cardsOf, embedUrl, episodesOf, ristoanime, seasonsOf, serversOf } from './ristoanime.js';

beforeAll(() => setParser((html, type = 'text/html') => new DOMParser().parseFromString(html, type)));

const B = 'https://ristoanime.me';
const SEARCH = `<div class="BlocksHolder"><div class="MovieItem"><a href="${B}/series/all-frieren/"><div class="poster" style="background-image: url(${B}/wp-content/uploads/frieren.webp);"></div><div class="title"><p>مشاهدة انمي Sousou no Frieren</p><h4>جميع حلقات انمي Sousou no Frieren مترجمة اون لاين</h4></div></a></div></div>`;
const SERIES = `<div class="SeasonsList"><ul><li><a class="no-ajax" data-season="34548" href="javascript:void(0)">Sousou no Frieren الموسم 1</a></li><li class="active"><a class="no-ajax" data-season="34605" href="javascript:void(0)">Sousou no Frieren الموسم 2</a></li></ul></div>
<div class="EpisodesList"><a href="${B}/frieren-s2-ep-2/"> الحلقة <em>2</em> </a><a href="${B}/frieren-s2-ep-1/"> الحلقة <em>1</em> </a></div>
<script>$.ajax({url: AjaxtURL+'Single/Episodes.php',type: 'POST',dataType: 'html',data: {season: $(this).data('season') ,post_id: '27110'}})</script>`;
const S1 = `<a href="${B}/frieren-ep-28/">الحلقة<em>28</em></a><a href="${B}/frieren-ep-1/">الحلقة<em>1</em></a>`;
const WATCH = `<ul id="watch">
<li data-watch="https://vidmoly.biz/embed-exqjhwsjl0et.html" class="ISActive"><span>0</span>سيرفر 1</li>
<li data-watch="https://mega.nz/embed/uXYAwArQ#Ml.html"><span>1</span>سيرفر 1.2</li>
<li data-watch="https://sendvid.com/embed/6wbjikq0.html"><span>3</span>سيرفر 3.1</li>
<li data-watch="https://hgcloud.to/e/lvegtxhv1c7x.html"><span>7</span>سيرفر احتياطي 1</li></ul>`;

describe('ristoanime parsing', () => {
  it('cards, seasons, episodes and servers', () => {
    expect(cardsOf(SEARCH, B)).toEqual([{ url: '/series/all-frieren/', title: 'Sousou no Frieren', thumbnail: `${B}/wp-content/uploads/frieren.webp` }]);
    expect(seasonsOf(SERIES)).toEqual({ post: '27110', seasons: [{ id: '34548', n: 1, label: 'Sousou no Frieren الموسم 1' }, { id: '34605', n: 2, label: 'Sousou no Frieren الموسم 2' }] });
    expect(episodesOf(S1, 'ristoanime', B).map((e) => e.number)).toEqual([1, 28]);
    expect(serversOf(WATCH)).toEqual([
      { name: 'سيرفر 1', url: 'https://vidmoly.biz/embed-exqjhwsjl0et.html' },
      { name: 'سيرفر 3.1', url: 'https://sendvid.com/embed/6wbjikq0' },
      { name: 'سيرفر احتياطي 1', url: 'https://hgcloud.to/e/lvegtxhv1c7x' },
    ]);
    expect(embedUrl('https://www.mp4upload.com/embed-7tbwo36z43dz.html')).toBe('https://www.mp4upload.com/embed-7tbwo36z43dz.html');
  });

  it('raw media links lose their html entities (sendvid)', () => {
    const html = '<meta property="og:video" content="https://videos2.sendvid.com/a5/b7/9x54tp9v.mp4?validfrom=1&amp;validto=2&amp;rate=3">';
    expect(genericStreams(html, 'https://sendvid.com/embed/x')).toEqual(['https://videos2.sendvid.com/a5/b7/9x54tp9v.mp4?validfrom=1&validto=2&rate=3']);
  });
});

describe('ristoanime engine', () => {
  const routes = { [`${B}/?s=frieren`]: SEARCH, [`${B}/series/all-frieren/`]: SERIES };
  const asked = [];
  const fetch = {
    page: async (url, opts = {}) => {
      asked.push([url, opts.form ?? null]);
      if (url.endsWith('/Ajaxt/Single/Episodes.php')) return { status: 200, url, text: S1 };
      if (url.endsWith('/watch/')) return { status: 200, url, text: WATCH };
      return { status: 200, url, text: routes[url] ?? '' };
    },
  };
  const src = ristoanime.create({ id: 'ristoanime', domain: 'ristoanime.me' }, { fetch, hosts: { resolve: async () => [] } });

  it('a multi-season series is one copy per season, named so the AniList judge tells them apart', async () => {
    const items = await src.search('frieren');
    expect(items.map((i) => i.title)).toEqual(['Sousou no Frieren', 'Sousou no Frieren Season 2']);
    // الموسم الأول لا يُقبل نسخةً للثاني، والعكس
    expect(judgeAnimeCopy(items[0], ['Sousou no Frieren']).ok).toBe(true);
    expect(judgeAnimeCopy(items[1], ['Sousou no Frieren']).ok).toBe(false);
    expect(judgeAnimeCopy(items[1], ['Sousou no Frieren 2nd Season']).ok).toBe(true);
    expect(judgeAnimeCopy(items[0], ['Sousou no Frieren 2nd Season']).ok).toBe(false);
    const eps = await src.episodes(items[0]);
    expect(asked.at(-1)).toEqual([`${B}/wp-content/themes/TopAnime/Ajaxt/Single/Episodes.php`, { season: '34548', post_id: '27110' }]);
    expect(eps.map((e) => e.number)).toEqual([1, 28]);
    const servers = await src.servers(eps[0]);
    expect(asked.at(-1)[0]).toBe(`${B}/frieren-ep-1/watch/`);
    expect(servers).toHaveLength(3);
  });
});
