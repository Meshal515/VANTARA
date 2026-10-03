/**
 * OkAnime (ww3.okanime.xyz، Laravel + Alpine). فحص حي 2026-10-03:
 *   بحث GET /api/search?q=… ← JSON [{name, slug, poster, type}] بأسماء روماجي
 *   (نفس أسماء AniList: «Shingeki no Kyojin Season 2»، «Jujutsu Kaisen 2nd Season»).
 *   صفحة العمل /anime/<slug> ← `a.ep-compact-btn` إلى /episode/<slug>-episode-N؛
 *   المسلسل الطويل يعرض نافذة منها فقط (One Piece: 360 من 1180)، والرابط ثابت الصيغة
 *   فيُكمَل الناقص حتى أعلى رقم ظهر.
 *   صفحة الحلقة ← `a.ep-link[data-server]` والرابط في setServer('…') أو activeUrl === '…'،
 *   والجودة في data-umami-event-quality ← hosts.
 */

import { parseHtml, qa, attr, absAttr, pathOf } from '../dom.js';
import { variantOf, qualityOf } from './video-common.js';

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');

/** حلقات صفحة العمل، مكمّلة حتى أعلى رقم بنفس صيغة الرابط. */
export function episodesOf(html, slug, sourceId, base) {
  const seen = new Map();
  for (const a of qa(parseHtml(html), 'a[href*="/episode/"]')) {
    const path = pathOf(absAttr(a, 'href', base));
    const n = Number(path?.match(/-episode-(\d+(?:\.\d+)?)\/?$/)?.[1]);
    if (path && path.startsWith(`/episode/${slug}-episode-`) && Number.isFinite(n) && n > 0) seen.set(n, path);
  }
  const max = Math.max(0, ...[...seen.keys()].filter(Number.isInteger));
  for (let n = 1; n <= max; n++) if (!seen.has(n)) seen.set(n, `/episode/${slug}-episode-${n}`);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([n, url]) => ({ sourceId, url, name: `الحلقة ${n}`, number: n }));
}

/** سيرفرات المشاهدة: [{name, url, quality}] من نص الصفحة الخام (سمات Alpine). */
export function serversOf(html) {
  const out = new Map();
  for (const m of String(html).matchAll(/<a\b[^>]*\bep-link\b[^>]*>/g)) {
    const tag = decode(m[0]);
    const name = tag.match(/data-server="([^"]+)"/)?.[1];
    if (!name || /\bdata-umami-event="download"/.test(tag)) continue;
    const url = tag.match(/setServer\('([^']+)'\)/)?.[1] ?? tag.match(/activeUrl === '([^']+)'/)?.[1];
    if (!url?.startsWith('http') || /mega\.nz/i.test(url) || out.has(url)) continue;
    const q = tag.match(/data-umami-event-quality="([^"]+)"/)?.[1] ?? tag.match(/matchesQuality\('([^']+)'\)/)?.[1];
    out.set(url, { name, url, quality: qualityOf(q) });
  }
  return [...out.values()].sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
}

export const okanime = {
  kind: 'okanime-site',
  content: 'anime',
  create(def, { fetch, hosts }) {
    const base = `https://${def.domain}`;
    const abs = (p) => (String(p).startsWith('http') ? p : `${base}${p}`);
    const item = (x) => ({ sourceId: def.id, url: `/anime/${x.slug}`, title: String(x.name ?? x.slug).trim(), thumbnail: x.poster ?? null });

    return {
      async search(query) {
        const url = new URL(`${base}/api/search`);
        url.searchParams.set('q', query.trim());
        const list = await fetch.json(url.toString(), { headers: { accept: 'application/json' } });
        return (Array.isArray(list) ? list : []).filter((x) => x?.slug).map(item);
      },
      async latest() {
        const res = await fetch.page(`${base}/`);
        const seen = new Map();
        for (const a of qa(parseHtml(res.text), 'a[href*="/anime/"]')) {
          const path = pathOf(absAttr(a, 'href', base));
          const slug = path?.match(/^\/anime\/([^/]+)\/?$/)?.[1];
          const title = attr(a, 'title') || attr(a.querySelector?.('img'), 'alt');
          if (slug && title && !seen.has(slug)) seen.set(slug, item({ slug, name: title }));
        }
        return [...seen.values()];
      },
      async episodes(it) {
        const slug = String(it.url).match(/^\/anime\/([^/]+)/)?.[1];
        const res = await fetch.page(abs(it.url));
        return episodesOf(res.text, slug, def.id, base);
      },
      async servers(episode) {
        const res = await fetch.page(abs(episode.url));
        const variant = variantOf(episode.name);
        return serversOf(res.text).map((s) => ({ key: `o${s.url.length}${s.name}`, name: s.name, quality: s.quality, variant, data: { url: s.url, page: res.url } }));
      },
      streams: (server) => hosts.resolve(server.data.url, server.data.page),
    };
  },
};
