/**
 * TukTuk Cinema. نفس `TukTukSite.kt`:
 *   بحث /?s=… (`.Block--Item > a`)؛ الحلقات `.episodes--list--side a` بأرقام `<em>`؛
 *   السيرفرات `li.server--item[data-link]` مرمّزة: ما قبل `0REL0Y&` معكوسًا ثم base64.
 */

import { absAttr, attr, parseHtml, pathOf, q, qa, text } from '../dom.js';
import { episodeNumber, foldCards, kindOf, variantOf } from './video-common.js';

function b64(s) {
  try {
    const t = String(s).trim();
    const out = atob(t.padEnd(Math.ceil(t.length / 4) * 4, '=')).trim();
    return out.startsWith('http') ? out : null;
  } catch {
    return null;
  }
}

/** `decodeLink` في setup.js الموقع. */
export function decodeLink(value) {
  const part = String(value).replace(/&amp;/g, '&').split('0REL0Y&')[0];
  return b64([...part].reverse().join(''));
}

export const tuktuk = {
  kind: 'tuktuk-site',
  content: 'cinema',
  create(def, { fetch, hosts }) {
    const base = `https://${def.domain}`;
    const abs = (p) => (String(p).startsWith('http') ? p : `${base}${p}`);

    function search(html) {
      const cards = qa(parseHtml(html), '.Block--Item > a[href]').map((a) => {
        const img = q(a, 'img');
        return { href: absAttr(a, 'href', base), title: attr(a, 'title') || text(q(a, 'h2, h3')), thumb: img ? absAttr(img, 'data-src', base) || absAttr(img, 'src', base) : null };
      });
      return foldCards(cards, def.id);
    }

    return {
      async search(query) {
        const url = new URL(`${base}/`);
        url.searchParams.set('s', query.trim());
        return search((await fetch.page(url.toString())).text);
      },
      async latest() {
        return search((await fetch.page(`${base}/`)).text);
      },
      async episodes(item) {
        if (kindOf(item.title) !== 'series') return [{ sourceId: def.id, url: item.url, name: item.title, number: 1 }];
        const res = await fetch.page(abs(item.url));
        const out = new Map();
        for (const a of qa(parseHtml(res.text), '.episodes--list--side a[href]')) {
          const n = Number(text(q(a, 'em'))) || episodeNumber(attr(a, 'title'));
          const path = pathOf(absAttr(a, 'href', res.url));
          if (Number.isFinite(n) && n > 0 && path) out.set(path, { sourceId: def.id, url: path, name: `الحلقة ${n}`, number: n });
        }
        const list = [...out.values()].sort((a, b) => a.number - b.number);
        if (list.length) return list;
        const n = episodeNumber(item.title);
        return n ? [{ sourceId: def.id, url: item.url, name: `الحلقة ${n}`, number: n }] : [];
      },
      async servers(episode) {
        const res = await fetch.page(abs(episode.url));
        const doc = parseHtml(res.text);
        const variant = variantOf(episode.name);
        const list = qa(doc, '.watch--servers--list li.server--item[data-link]')
          .map((li) => ({ name: text(li).replace('⭐', '').trim() || 'TukTuk', url: decodeLink(attr(li, 'data-link')) }))
          .filter((s) => s.url);
        const crypt = b64(attr(q(doc, 'iframe[data-crypt]'), 'data-crypt'));
        if (crypt && !list.some((s) => s.url === crypt)) list.push({ name: 'TukTuk', url: crypt });
        return [...new Map(list.map((s) => [s.url, s])).values()].map((s) => ({ key: `t${s.url.length}${s.name}`, name: s.name, quality: null, variant, data: { url: s.url, page: res.url } }));
      },
      streams: (server, onStreams) => hosts.resolve(server.data.url, server.data.page, 0, onStreams),
    };
  },
};
