/**
 * RistoAnime (ristoanime.me، قالب TopAnime). فحص حي 2026-10-03:
 *   بحث /?s=… ← `.MovieItem > a` (رابط /series/… وعنوان `h4`)؛ صفحة المسلسل
 *   تحمل كل مواسمه: `.SeasonsList a[data-season]` وحلقات الموسم النشط في
 *   `.EpisodesList a` («الحلقة <em>N</em>»)، وبقية المواسم عبر
 *   POST Ajaxt/Single/Episodes.php {season, post_id}.
 *   الحلقة/watch/ ← `ul#watch li[data-watch]`: حتى ثمانية مضيفات مستقلة
 *   (vidmoly، sendvid، mp4upload، uqload، StreamHG، sibnet، turbovid…) ← hosts.
 *
 * هوية الأنمي موسمٌ لكل عمل (AniList)، فالمسلسل متعدد المواسم يصير نسخة لكل
 * موسم: الأول بالاسم وحده، والتالي «<الاسم> Season N» كما تكتبه AniList.
 */

import { absAttr, attr, parseHtml, pathOf, q, qa, text } from '../dom.js';
import { cleanTitle } from './shahiid.js';
import { variantOf } from './video-common.js';

const SEASON = /الموسم\s*(\d+)/;

/** رابط مضيف كما يضعه الموقع: يلحق `.html` بكل رابط، وهو صالح فقط في صيغة embed-xxx.html. */
export function embedUrl(raw) {
  const url = String(raw ?? '').trim();
  if (!url.startsWith('http')) return null;
  return /\/embed-[^/]+\.html$/i.test(url) ? url : url.replace(/\.html$/i, '');
}

/** بطاقات البحث: [{url, title}] (المسلسلات). */
export function cardsOf(html, base) {
  const out = new Map();
  for (const a of qa(parseHtml(html), '.MovieItem > a[href]')) {
    const path = pathOf(absAttr(a, 'href', base));
    const raw = text(q(a, 'h4')) || text(q(a, '.title p'));
    if (path && raw && !out.has(path)) out.set(path, { url: path, title: cleanTitle(raw), thumbnail: (attr(q(a, '.poster'), 'style') ?? '').match(/url\(([^)]+)\)/)?.[1] ?? null });
  }
  return [...out.values()];
}

/** مواسم صفحة المسلسل ورقم منشوره: {post, seasons:[{id, n, label}]}. */
export function seasonsOf(html) {
  const doc = parseHtml(html);
  const post = html.match(/post_id:\s*'(\d+)'/)?.[1] ?? null;
  const seasons = qa(doc, '.SeasonsList a[data-season]').map((a, i) => {
    const label = text(a);
    return { id: attr(a, 'data-season'), n: Number(label.match(SEASON)?.[1]) || i + 1, label };
  });
  return { post, seasons };
}

/** حلقات من قائمة (صفحة المسلسل أو رد Episodes.php). */
export function episodesOf(html, sourceId, base) {
  const out = new Map();
  for (const a of qa(parseHtml(html), 'a[href]')) {
    const n = Number(text(q(a, 'em')));
    if (!q(a, 'em') || !/الحلقة/.test(text(a)) || !Number.isFinite(n) || n <= 0) continue;
    const path = pathOf(absAttr(a, 'href', base));
    if (path && !out.has(path)) out.set(path, { sourceId, url: path, name: `الحلقة ${n}`, number: n });
  }
  return [...out.values()].sort((a, b) => a.number - b.number);
}

/** سيرفرات صفحة المشاهدة: [{name, url}] بلا تكرار، وبلا MEGA (مشفّر داخل صفحته). */
export function serversOf(html) {
  const out = new Map();
  for (const li of qa(parseHtml(html), 'ul#watch li[data-watch]')) {
    const url = embedUrl(attr(li, 'data-watch'));
    if (!url || /mega\.nz/i.test(url) || out.has(url)) continue;
    const name = text(li).replace(/^\d+\s*/, '').trim() || 'RistoAnime';
    out.set(url, { name, url });
  }
  return [...out.values()];
}

export const ristoanime = {
  kind: 'ristoanime-site',
  content: 'anime',
  create(def, { fetch, hosts }) {
    const base = `https://${def.domain}`;
    const abs = (p) => (String(p).startsWith('http') ? p : `${base}${p}`);
    const ajax = `${base}/wp-content/themes/TopAnime/Ajaxt/Single/Episodes.php`;

    /** المسلسل ← نسخة لكل موسم (يُقرأ أول أربعة مسلسلات فقط: البحث يبقى سريعًا). */
    async function expand(card) {
      const res = await fetch.page(abs(card.url)).catch(() => null);
      const { post, seasons } = res ? seasonsOf(res.text) : { post: null, seasons: [] };
      const item = { sourceId: def.id, url: card.url, title: card.title, thumbnail: card.thumbnail };
      if (seasons.length <= 1 || !post) return [item];
      return seasons.map((s) => ({ ...item, url: `${card.url}#s=${s.id}&p=${post}`, title: s.n === 1 ? card.title : `${card.title} Season ${s.n}` }));
    }

    async function search(html) {
      const cards = cardsOf(html, base);
      const head = await Promise.all(cards.slice(0, 4).map(expand));
      return [...head.flat(), ...cards.slice(4).map((c) => ({ sourceId: def.id, ...c }))];
    }

    return {
      async search(query) {
        const url = new URL(`${base}/`);
        url.searchParams.set('s', query.trim());
        return search((await fetch.page(url.toString())).text);
      },
      async latest() {
        return search((await fetch.page(`${base}/series/`)).text);
      },
      async episodes(item) {
        const [path, hash = ''] = String(item.url).split('#');
        const season = new URLSearchParams(hash);
        if (season.get('s') && season.get('p')) {
          const res = await fetch.page(ajax, { form: { season: season.get('s'), post_id: season.get('p') }, referer: abs(path), xhr: true });
          return episodesOf(res.text, def.id, base);
        }
        const res = await fetch.page(abs(path));
        return episodesOf(res.text.slice(res.text.indexOf('EpisodesList')), def.id, base);
      },
      async servers(episode) {
        const watch = `${abs(episode.url).replace(/\/+$/, '')}/watch/`;
        const res = await fetch.page(watch, { referer: abs(episode.url) });
        const variant = variantOf(episode.name);
        return serversOf(res.text).map((s) => ({ key: `r${s.url.length}${s.name}`, name: s.name, quality: null, variant, data: { url: s.url, page: res.url } }));
      },
      streams: (server) => hosts.resolve(server.data.url, `${base}/`),
    };
  },
};
