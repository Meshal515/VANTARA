/**
 * EgyDead (egydead.live). نفس مسار إضافة الـAPK (`ar.egydead` + قاعدة البيان):
 *   بحث /?s=… ← `li.movieItem > a[title]`: الفيلم بسنته في العنوان، والمسلسل صفحة
 *   لكل موسم /season/… («مسلسل Shameless الموسم الثالث مترجم كامل»)؛ صفحات الحلقات
 *   المفردة تُطوى في موسمها، وصفحات التجميع (/serie/ «جميع مواسم»، /assembly/
 *   «سلسلة أفلام») ليست عملًا واحدًا فتُترك.
 *   صفحة الموسم ← `.EpsList a` («حلقه N»).
 *   صفحة الفيلم/الحلقة بطلب POST `View=1` ← `ul.serversList li[data-link]`
 *   (أو `.mob-servers`) ← مضيفات مستقلة (StreamHG، EarnVids، Mixdrop، Dood…) ← hosts.
 */

import { absAttr, attr, parseHtml, pathOf, q, qa, text } from '../dom.js';
import { episodeNumber, variantOf } from './video-common.js';

const EPISODE = /\s*(?:الحلقة|حلقة|حلقه)\s*\d+.*$/;
const kindOfPath = (path) => (/^\/(?:season|episode)\//.test(String(path)) ? 'series' : 'movie');

/** بطاقات البحث ← نسخ: الأفلام وصفحات المواسم، والحلقات المفردة تُطوى في موسمها. */
export function cardsOf(html, sourceId, base) {
  const out = new Map();
  const folded = new Map();
  for (const a of qa(parseHtml(html), 'li.movieItem > a[href]')) {
    const path = pathOf(absAttr(a, 'href', base));
    const title = (attr(a, 'title') || text(q(a, '.BottomTitle, h1'))).trim();
    if (!path || !title || /^\/(?:serie|assembly)\//.test(path) || /^جميع\s+مواسم|سلسلة\s+افلام/.test(title)) continue;
    const img = q(a, 'img');
    const thumbnail = img ? absAttr(img, 'data-src', base) || absAttr(img, 'src', base) : null;
    if (path.startsWith('/episode/')) {
      const name = title.replace(EPISODE, '').trim();
      if (name && !folded.has(name)) folded.set(name, { sourceId, url: path, title: name, thumbnail });
      continue;
    }
    if (!out.has(path)) out.set(path, { sourceId, url: path, title, thumbnail });
  }
  const seasons = new Set([...out.values()].map((c) => c.title.replace(/\s*مترجم(?:ة)?\s*كامل(?:ة)?\s*$/, '').trim()));
  for (const [name, c] of folded) if (!seasons.has(name)) out.set(c.url, c);
  return [...out.values()];
}

/** حلقات صفحة الموسم، أو حلقات القائمة الجانبية في صفحة حلقة. */
export function episodesOf(html, sourceId, base) {
  const out = new Map();
  for (const a of qa(parseHtml(html), '.EpsList a[href], .episodes-list a[href*="/episode/"]')) {
    const path = pathOf(absAttr(a, 'href', base));
    const n = Number(text(a).match(/(\d+(?:\.\d+)?)/)?.[1]) || episodeNumber(attr(a, 'title'));
    if (path && Number.isFinite(n) && n > 0 && !out.has(path)) out.set(path, { sourceId, url: path, name: `الحلقة ${n}`, number: n });
  }
  return [...out.values()].sort((a, b) => a.number - b.number);
}

/** سيرفرات المشاهدة: [{name, url}] بلا تكرار. */
export function serversOf(html, base) {
  const doc = parseHtml(html);
  const list = qa(doc, 'ul.serversList li[data-link], .mob-servers li[data-link]').map((li) => ({
    name: (text(q(li, 'p')) || text(li)).trim() || 'EgyDead',
    url: absAttr(li, 'data-link', base),
  }));
  return [...new Map(list.filter((s) => s.url?.startsWith('http')).map((s) => [s.url, s])).values()];
}

export const egydead = {
  kind: 'egydead-site',
  content: 'cinema',
  create(def, { fetch, hosts }) {
    let base = `https://${def.domain}`;
    const abs = (p) => (String(p).startsWith('http') ? p : `${base}${p}`);
    const page = async (url, options) => {
      const res = await fetch.page(url, options);
      base = new URL(res.url).origin;
      return res;
    };

    return {
      async search(query) {
        const url = new URL(`${base}/`);
        url.searchParams.set('s', query.trim());
        const res = await page(url.toString());
        return cardsOf(res.text, def.id, base);
      },
      async latest() {
        const res = await page(`${base}/`);
        return cardsOf(res.text, def.id, base);
      },
      async episodes(item) {
        if (kindOfPath(item.url) !== 'series') return [{ sourceId: def.id, url: item.url, name: item.title, number: 1 }];
        const res = await page(abs(item.url));
        const list = episodesOf(res.text, def.id, base);
        if (list.length) return list;
        const n = episodeNumber(item.title);
        return n ? [{ sourceId: def.id, url: item.url, name: `الحلقة ${n}`, number: n }] : [];
      },
      async servers(episode) {
        const watch = abs(episode.url);
        const res = await page(watch, { form: { View: 1 }, referer: watch });
        const variant = variantOf(episode.name);
        return serversOf(res.text, base).map((s) => ({ key: `e${s.url.length}${s.name}`, name: s.name, quality: null, variant, data: { url: s.url, page: res.url } }));
      },
      streams: (server) => hosts.resolve(server.data.url, server.data.page),
    };
  },
};
