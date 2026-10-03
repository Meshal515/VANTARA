/**
 * Shahiid Anime (ووردبريس). نفس `ShahiidSite.kt`:
 *   بحث /?s=… ← `.one-poster .wrap-poster`؛ صفحة المسلسل تقود لأول موسم؛
 *   السيرفرات `a.buttosn[data-frameserver]` ← admin-ajax codecanal ← iframe المشغّل.
 */

import { absAttr, attr, parseHtml, pathOf, q, qa, text } from '../dom.js';
import { variantOf } from './video-common.js';

const EPISODE = /(?:الحلقة|حلقة)\s*(\d+(?:\.\d+)?)/;
const LATIN = /[A-Za-z0-9][A-Za-z0-9 :;'’!?.,&\-()]*[A-Za-z0-9!?)]/g;
const NOISE = /(^|\s)(أنمي|انمي|مترجم|مترجمة|اون لاين|أون لاين|مدبلج|الملصق الرسمي ل)(?=\s|$)/g;
const DEAD = new Set(['tunepk']);

export function cleanTitle(raw) {
  const latin = [...String(raw).matchAll(LATIN)].map((m) => m[0].trim()).filter((s) => /\p{L}/u.test(s)).sort((a, b) => b.length - a.length)[0];
  if (latin && latin.length >= 2) return latin;
  return String(raw).replace(NOISE, ' ').replace(/\s+/g, ' ').trim() || String(raw).trim();
}

export const shahiid = {
  kind: 'shahiid-site',
  content: 'anime',
  create(def, { fetch, hosts }) {
    const base = `https://${def.domain}`;
    const abs = (p) => (String(p).startsWith('http') ? p : `${base}${p}`);

    function search(html) {
      const out = new Map();
      for (const card of qa(parseHtml(html), '.one-poster .wrap-poster')) {
        const link = q(card, 'h2 a[href]') ?? q(card, 'a[href]');
        const path = pathOf(absAttr(link, 'href', base));
        const raw = text(q(card, 'h2')) || attr(q(card, 'img'), 'alt');
        if (!path || !raw || out.has(path)) continue;
        out.set(path, { sourceId: def.id, url: path, title: cleanTitle(raw), thumbnail: absAttr(q(card, 'img'), 'src', base) || null });
      }
      return [...out.values()];
    }

    function episodesIn(html, pageUrl) {
      const out = new Map();
      for (const a of qa(parseHtml(html), 'a[href*="/episodes/"]')) {
        const m = text(a).match(EPISODE);
        if (!m) continue;
        const path = pathOf(absAttr(a, 'href', pageUrl));
        if (path) out.set(path, { sourceId: def.id, url: path, name: `الحلقة ${Number(m[1])}`, number: Number(m[1]) });
      }
      return [...out.values()].sort((a, b) => a.number - b.number);
    }

    function firstSeason(html, pageUrl) {
      const doc = parseHtml(html);
      const urls = [...qa(doc, 'option[value*="/seasons/"]').map((o) => absAttr(o, 'value', pageUrl)), ...qa(doc, 'a[href*="/seasons/"]').map((a) => absAttr(a, 'href', pageUrl))];
      return (
        urls.find((u) => {
          try {
            const segs = new URL(u).pathname.split('/').filter(Boolean);
            return segs.length === 2 && segs[0] === 'seasons' && segs[1] !== 'page' && segs[1] !== 'feed';
          } catch {
            return false;
          }
        }) ?? null
      );
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
        const res = await fetch.page(abs(item.url));
        const direct = episodesIn(res.text, res.url);
        if (direct.length) return direct;
        const season = firstSeason(res.text, res.url);
        if (season) {
          const s = await fetch.page(season, { referer: res.url });
          const list = episodesIn(s.text, s.url);
          if (list.length) return list;
        }
        return res.text.includes('data-frameserver') ? [{ sourceId: def.id, url: item.url, name: item.title, number: 1 }] : [];
      },
      async servers(episode) {
        const res = await fetch.page(abs(episode.url));
        const variant = variantOf(episode.name);
        const seen = new Set();
        const out = [];
        for (const a of qa(parseHtml(res.text), 'a.buttosn[data-frameserver][data-post]')) {
          const name = text(a) || 'Shahiid';
          if (DEAD.has(name.toLowerCase().replace(/\s/g, ''))) continue;
          const post = attr(a, 'data-post');
          if (seen.has(post)) continue;
          seen.add(post);
          out.push({ key: `s${post}`, name, quality: null, variant, data: { post, frame: attr(a, 'data-frameserver'), serv: attr(a, 'data-serv'), page: res.url } });
        }
        return out;
      },
      async streams(server, onStreams) {
        const { post, frame, serv, page } = server.data;
        const url = new URL(`${base}/wp-admin/admin-ajax.php`);
        url.searchParams.set('action', 'codecanal_ajax_request');
        url.searchParams.set('post', post);
        url.searchParams.set('frameserver', frame);
        url.searchParams.set('serv', serv);
        const html = (await fetch.page(url.toString(), { referer: page })).text;
        let embed = attr(q(parseHtml(html), 'iframe[src]'), 'src');
        if (embed.startsWith('//')) embed = `https:${embed}`;
        if (!embed.startsWith('http')) throw new Error('الموقع لم يُرجع مشغّلًا');
        return hosts.resolve(embed, page, 0, onStreams);
      },
    };
  },
};
