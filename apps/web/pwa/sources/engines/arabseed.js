/**
 * ArabSeed (MySeed). نفس `ArabSeedSite.kt`:
 *   بحث /find/?word=… (حلقات الموسم عمل واحد)؛ الحلقات `ul.episodes__list a`؛
 *   <العمل>/watch/ ← الجودات + CSRF ← POST /get__quality__servers/ ← السيرفرات؛
 *   المباشر /vids.php ← iframe بوابة ← mp4؛ و`/vid/?id=<base64>` رابط المشغّل نفسه.
 */

import { absAttr, attr, parseHtml, pathOf, q, qa, text } from '../dom.js';
import { episodeNumber, foldCards, kindOf, variantOf } from './video-common.js';
import { genericStreams } from '../hosts.js';

export function unwrapVid(url) {
  try {
    const u = new URL(url);
    if (!u.pathname.replace(/\/+$/, '').endsWith('/vid')) return url;
    const id = u.searchParams.get('id');
    const decoded = id ? atob(id.padEnd(Math.ceil(id.length / 4) * 4, '=')).trim() : '';
    return decoded.startsWith('http') ? decoded : url;
  } catch {
    return url;
  }
}

function server(li, fallbackQuality = null) {
  const index = Number(attr(li, 'data-server'));
  const quality = Number(attr(li, 'data-qu')) || fallbackQuality;
  if (!Number.isFinite(index) || !quality) return null;
  const direct = attr(li, 'data-direct-arabseed') === '1';
  const name = (attr(li, 'data-server-name') || text(li)).trim();
  return { index, quality, label: direct ? 'MySeed' : name || `سيرفر ${index}`, link: attr(li, 'data-link') || null, direct };
}

export function watchPage(html) {
  const csrf = html.match(/['"]csrf__token['"]\s*:\s*['"]([A-Za-z0-9]+)['"]/)?.[1];
  if (!csrf) return null;
  const doc = parseHtml(html);
  const servers = qa(doc, 'li[data-post][data-server]').map((li) => server(li)).filter(Boolean);
  const postId = attr(q(doc, 'li[data-post][data-server]'), 'data-post') || html.match(/psot_id['"]?\s*:\s*['"]?(\d+)/)?.[1] || attr(q(doc, '[data-post-id]'), 'data-post-id');
  if (!postId) return null;
  const qualities = [...new Set(qa(doc, 'li[data-quality]').map((li) => Number(attr(li, 'data-quality'))).filter(Boolean))];
  const active = Number(attr(q(doc, 'li.active[data-quality]'), 'data-quality')) || servers[0]?.quality || null;
  return { csrf, postId, qualities: qualities.length ? qualities : [active].filter(Boolean), active, servers };
}

export function qualityServers(body, quality) {
  let o;
  try {
    o = JSON.parse(body);
  } catch {
    return [];
  }
  if (o?.type !== 'success') return [];
  const doc = parseHtml(o.html ?? '');
  const list = qa(doc, 'li[data-server]').map((li) => server(li, quality)).filter(Boolean);
  const first = o.server || null;
  if (!first) return list;
  const activeIndex = Number(attr(q(doc, 'li.active[data-server]'), 'data-server')) || list[0]?.index;
  return list.map((s) => (s.link == null && s.index === activeIndex ? { ...s, link: first } : s));
}

export const arabseed = {
  kind: 'arabseed-site',
  content: 'cinema',
  create(def, { fetch, hosts }) {
    const base = `https://${def.domain}`;
    const abs = (p) => (String(p).startsWith('http') ? p : `${base}${p}`);
    const post = async (path, form, referer) => (await fetch.page(abs(path), { form, referer, xhr: true, headers: { accept: 'application/json' } })).text;

    function search(html) {
      const cards = qa(parseHtml(html), '.item__contents a.movie__block[href], .item__contents > a[href]').map((a) => {
        const img = q(a, 'img');
        return { href: absAttr(a, 'href', base), title: attr(a, 'title') || text(q(a, 'h3')), thumb: img ? absAttr(img, 'data-src', base) || absAttr(img, 'src', base) : null };
      });
      return foldCards(cards, def.id);
    }

    return {
      async search(query) {
        const url = new URL(`${base}/find/`);
        url.searchParams.set('word', query.trim());
        return search((await fetch.page(url.toString())).text);
      },
      async latest() {
        return search((await fetch.page(`${base}/`)).text);
      },
      async episodes(item) {
        if (kindOf(item.title) !== 'series') return [{ sourceId: def.id, url: item.url, name: item.title, number: 1 }];
        const res = await fetch.page(abs(item.url));
        const out = new Map();
        for (const a of qa(parseHtml(res.text), 'ul.episodes__list a[href]')) {
          const n = Number(text(q(a, '.epi__num b'))) || Number(text(a).match(/(\d+(?:\.\d+)?)/)?.[1]);
          const path = pathOf(absAttr(a, 'href', res.url));
          if (Number.isFinite(n) && n > 0 && path) out.set(path, { sourceId: def.id, url: path, name: `الحلقة ${n}`, number: n });
        }
        const list = [...out.values()].sort((a, b) => a.number - b.number);
        if (list.length) return list;
        const n = episodeNumber(item.title);
        return n ? [{ sourceId: def.id, url: item.url, name: `الحلقة ${n}`, number: n }] : [];
      },
      async servers(episode) {
        const watch = `${abs(episode.url).replace(/\/+$/, '')}/watch/`;
        const res = await fetch.page(watch, { referer: abs(episode.url) });
        const info = watchPage(res.text);
        if (!info) throw new Error('صفحة المشاهدة بلا رمز أو معرّف');
        const variant = variantOf(episode.name);
        const lists = await Promise.all(
          info.qualities.map(async (qn) =>
            qn === info.active && info.servers.length
              ? info.servers
              : qualityServers(await post('/get__quality__servers/', { post_id: info.postId, quality: qn, csrf_token: info.csrf }, res.url).catch(() => '{}'), qn),
          ),
        );
        return lists
          .flat()
          .sort((a, b) => Number(b.direct) - Number(a.direct) || b.quality - a.quality)
          .map((s) => ({ key: `q${s.quality}s${s.index}`, name: s.label, quality: s.quality, variant, data: { ...s, postId: info.postId, csrf: info.csrf, watch: res.url } }));
      },
      async streams(server) {
        const s = server.data;
        let link = s.link;
        if (!link) {
          const body = await post('/get__watch__server/', { post_id: s.postId, quality: s.quality, server: s.index, csrf_token: s.csrf }, s.watch);
          try {
            const o = JSON.parse(body);
            link = o?.type === 'success' ? o.server : null;
          } catch {
            link = null;
          }
        }
        if (!link) throw new Error('الموقع لم يُرجع رابط السيرفر');
        const target = unwrapVid(abs(link));
        if (!new URL(target).pathname.endsWith('/vids.php')) return hosts.resolve(target, s.watch);
        // المباشر: /vids.php ← iframe البوابة ← رابط الملف (البوابة تتحقق من الصفحة الأم)
        const shell = await fetch.page(target, { referer: s.watch });
        const gate = absAttr(q(parseHtml(shell.text), 'iframe[src]'), 'src', target);
        if (!gate) return hosts.resolve(target, s.watch);
        const g = await fetch.page(gate, { referer: `${base}/` });
        const found = genericStreams(g.text, g.url);
        if (!found.length) return hosts.resolve(gate, `${base}/`);
        const origin = `${new URL(g.url).origin}/`;
        return found.slice(0, 2).map((url) => ({ url, referer: origin, quality: s.quality, label: 'MySeed', type: /\.m3u8/.test(url) ? 'hls' : 'mp4' }));
      },
    };
  },
};
