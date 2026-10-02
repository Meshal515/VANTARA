/**
 * WitAnime على منصته الجديدة (Laravel + Livewire). نفس `WitAnimeSite.kt`:
 *
 *   بحث       /search?q=…               بطاقات ← /anime/… أو /movie/…
 *   الحلقات   صفحة العمل: روابط /watch/<slug>/<n>
 *   السيرفرات POST <sourcesUrl> (CSRF) ← لكل سيرفر رمز ←
 *             POST /watch/stream-source/<t> ثم GET /watch/stream-gate/<t> ← 302 إلى المشغّل
 *
 * الموقع يحدّ الطلبات (~18 في الدقيقة لكل مسار)، فالبوابات تُفتح واحدة واحدة.
 */

import { absAttr, attr, parseHtml, pathOf, q, qa, text } from '../dom.js';
import { qualityOf } from './video-common.js';

const WORK = /^\/(anime|movie)\/[^/]+\/?$/;
const TOKEN = /^[a-f0-9]{64}$/;
const QUALITY_ORDER = ['4K', 'FHD', 'HD', 'SD'];

export const witanime = {
  kind: 'witanime-site',
  content: 'anime',
  create(def, { fetch, hosts }) {
    const base = `https://${def.domain}`;
    const abs = (p) => (String(p).startsWith('http') ? p : `${base}${p}`);
    let gateQueue = Promise.resolve();

    function cards(html) {
      const out = new Map();
      for (const a of qa(parseHtml(html), 'a[href]')) {
        const path = pathOf(absAttr(a, 'href', base));
        if (!WORK.test(path)) continue;
        const img = q(a, 'img');
        if (!img) continue;
        const title = text(q(a, 'h3')) || attr(img, 'alt');
        if (!title || out.has(path)) continue;
        out.set(path, { sourceId: def.id, url: path, title, thumbnail: absAttr(img, 'src', base) || null });
      }
      return [...out.values()];
    }

    async function post(path, csrf, referer) {
      const res = await fetch.page(abs(path), { method: 'POST', body: '', referer, xhr: true, headers: { accept: 'application/json', 'x-csrf-token': csrf } });
      return res.text;
    }

    return {
      async search(query) {
        const url = new URL(`${base}/search`);
        url.searchParams.set('q', query.trim());
        return cards((await fetch.page(url.toString())).text);
      },
      async latest() {
        return cards((await fetch.page(`${base}/`)).text);
      },
      async episodes(item) {
        const slug = item.url.replace(/\/+$/, '').split('/').pop();
        if (item.url.startsWith('/movie/')) return [{ sourceId: def.id, url: `/watch/movie/${slug}`, name: item.title, number: 1 }];
        const doc = parseHtml((await fetch.page(abs(item.url))).text);
        const prefix = `/watch/${slug}/`;
        const out = new Map();
        for (const a of qa(doc, `a[href*="${prefix}"]`)) {
          const path = pathOf(absAttr(a, 'href', base));
          if (!path.startsWith(prefix)) continue;
          const n = Number(path.slice(prefix.length).replace(/\/+$/, ''));
          if (!Number.isFinite(n)) continue;
          out.set(path, { sourceId: def.id, url: path, name: `الحلقة ${n}`, number: n });
        }
        return [...out.values()].sort((a, b) => a.number - b.number);
      },
      async servers(episode) {
        const watch = abs(episode.url);
        const page = (await fetch.page(watch)).text;
        const csrf = attr(q(parseHtml(page), 'meta[name=csrf-token]'), 'content');
        if (!csrf) throw new Error('لا رمز CSRF في صفحة الحلقة');
        const sourcesUrl = page.match(/sourcesUrl:\s*'([^']+)'/)?.[1]?.replace(/\\\//g, '/') ?? `${episode.url.replace(/\/+$/, '')}/sources`;
        let players = {};
        try {
          players = JSON.parse(await post(sourcesUrl, csrf, watch)).players ?? {};
        } catch {
          players = {};
        }
        const out = [];
        for (const [quality, list] of Object.entries(players).sort((a, b) => rank(a[0]) - rank(b[0]))) {
          for (const p of list ?? []) {
            if (!TOKEN.test(String(p?.token ?? ''))) continue;
            const label = String(p.label ?? '');
            out.push({
              key: p.token.slice(0, 16),
              name: label,
              quality: qualityOf(quality),
              variant: p.version === 'dub' ? 'DUB' : 'SUB',
              unsupported: /mega/i.test(label),
              data: { token: p.token, csrf, watch },
            });
          }
        }
        return out;
        function rank(k) {
          const i = QUALITY_ORDER.indexOf(k);
          return i < 0 ? 99 : i;
        }
      },
      async streams(server) {
        const { token, csrf, watch } = server.data;
        // البوابات متتابعة: حدود الموقع، ونفس جلسة الكوكي
        const embed = await (gateQueue = gateQueue.catch(() => {}).then(async () => {
          await post(`/watch/stream-source/${token}`, csrf, watch);
          let url = abs(`/watch/stream-gate/${token}`);
          for (let hop = 0; hop < 5; hop += 1) {
            const res = await fetch.text(url, { referer: watch, follow: false });
            const next = res.location ?? metaRefresh(res.text, res.url);
            if (!next) return null;
            if (new URL(next).hostname !== def.domain && !new URL(next).hostname.endsWith(`.${def.domain}`)) return next;
            url = next;
          }
          return null;
        }));
        if (!embed) throw new Error('البوابة لم تحوّل إلى مشغّل');
        return hosts.resolve(embed, watch);
      },
    };
  },
};

function metaRefresh(html, base) {
  const content = qa(parseHtml(html), 'meta[http-equiv]').find((m) => /refresh/i.test(attr(m, 'http-equiv')))?.getAttribute('content');
  const target = content?.match(/url\s*=\s*(.+)$/i)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (!target) return null;
  try {
    return new URL(target, base).toString();
  } catch {
    return null;
  }
}
