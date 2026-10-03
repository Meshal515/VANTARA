/**
 * Akwam (akwam.ss): ملفات mp4 مباشرة على downet.net بجودات 1080/720/480، بلا
 * مضيف وسيط ولا حماية (CORS `*` وRange، ولا يُشترط Referer).
 *
 *   بحث /search?q=… ← بطاقات `.entry-box` (الاسم + سنة الشارة)؛ الفيلم /movie/…،
 *   والمسلسل صفحة لكل موسم /series/… («Shameless الموسم الثالث»).
 *   صفحة الموسم ← روابط /episode/<id>/…/الحلقة-N.
 *   صفحة الفيلم/الحلقة ← تبويب لكل جودة (`a[href^="#tab-"]`) فيه رابط /watch/…
 *   صفحة المشاهدة ← `<video><source src size="1080">`.
 *
 * عنوان النسخة يحمل نوعها وسنتها («فيلم Dune 2021»، «مسلسل Shameless الموسم الاول 2011»)
 * لأن مطابقة السينما (`cinema-match.js`) تحسم النوع والسنة والموسم من العنوان.
 */

import { absAttr, attr, parseHtml, pathOf, q, qa, text } from '../dom.js';
import { qualityOf } from './video-common.js';

const kindOfPath = (path) => (/^\/(?:series|episode)\//.test(String(path)) ? 'series' : 'movie');

/** بطاقات البحث والرئيسية ← نسخ بعنوان يحمل النوع والسنة. */
export function cardsOf(html, sourceId, base) {
  const out = new Map();
  for (const box of qa(parseHtml(html), '.entry-box')) {
    const a = q(box, '.entry-title a[href]') ?? q(box, '.entry-image a[href]');
    const path = pathOf(absAttr(a, 'href', base));
    if (!path || !/^\/(?:movie|series)\//.test(path) || out.has(path)) continue;
    const name = text(a) || attr(q(box, 'img'), 'alt');
    if (!name) continue;
    const year = Number(text(q(box, '.badge-secondary'))) || null;
    const img = q(box, 'img');
    const kind = kindOfPath(path);
    const title = `${kind === 'series' ? 'مسلسل' : 'فيلم'} ${name.trim()}${year && !String(name).includes(String(year)) ? ` ${year}` : ''}`;
    out.set(path, { sourceId, url: path, title, thumbnail: img ? absAttr(img, 'data-src', base) || absAttr(img, 'src', base) : null });
  }
  return [...out.values()];
}

/** حلقات صفحة الموسم، مرتّبة وبلا تكرار. */
export function episodesOf(html, sourceId, base) {
  const out = new Map();
  for (const a of qa(parseHtml(html), 'a[href*="/episode/"]')) {
    const href = absAttr(a, 'href', base);
    const path = pathOf(href);
    if (!path || out.has(path)) continue;
    let slug = '';
    try {
      slug = decodeURIComponent(path.split('/').pop());
    } catch {
      slug = '';
    }
    const n = Number(slug.match(/(\d+(?:\.\d+)?)\s*$/)?.[1]) || Number(text(a).match(/حلقة\s*(\d+(?:\.\d+)?)/)?.[1]);
    if (Number.isFinite(n) && n > 0) out.set(path, { sourceId, url: path, name: `الحلقة ${n}`, number: n });
  }
  return [...out.values()].sort((a, b) => a.number - b.number);
}

/** تبويبات الجودة في صفحة الفيلم/الحلقة: [{quality, watch}] الأعلى أولًا. */
export function qualityTabs(html, base) {
  const doc = parseHtml(html);
  const out = [];
  for (const tab of qa(doc, 'a[href^="#tab-"]')) {
    const id = attr(tab, 'href').slice(1);
    const quality = qualityOf(text(tab));
    const pane = q(doc, `#${id}`);
    const watch = pane ? absAttr(q(pane, 'a.link-show[href], a[href*="/watch/"]'), 'href', base) : null;
    if (watch && !out.some((t) => t.watch === watch)) out.push({ quality, watch });
  }
  return out.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
}

/** ملفات صفحة المشاهدة: [{url, quality}] الأعلى أولًا. */
export function sourcesOf(html, base) {
  const out = [];
  for (const s of qa(parseHtml(html), 'video source[src]')) {
    const url = absAttr(s, 'src', base);
    if (!url || out.some((x) => x.url === url)) continue;
    out.push({ url, quality: Number(attr(s, 'size')) || qualityOf(url) });
  }
  return out.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
}

export const akwam = {
  kind: 'akwam-site',
  content: 'cinema',
  create(def, { fetch }) {
    const base = `https://${def.domain}`;
    const abs = (p) => (String(p).startsWith('http') ? p : `${base}${p}`);

    return {
      async search(query) {
        const url = new URL(`${base}/search`);
        url.searchParams.set('q', query.trim());
        return cardsOf((await fetch.page(url.toString())).text, def.id, base);
      },
      async latest() {
        return cardsOf((await fetch.page(`${base}/`)).text, def.id, base);
      },
      async episodes(item) {
        if (kindOfPath(item.url) !== 'series') return [{ sourceId: def.id, url: item.url, name: item.title, number: 1 }];
        const res = await fetch.page(abs(item.url));
        return episodesOf(res.text, def.id, base);
      },
      async servers(episode) {
        const res = await fetch.page(abs(episode.url));
        const tabs = qualityTabs(res.text, base);
        if (!tabs.length) throw new Error('صفحة العمل بلا روابط مشاهدة');
        return tabs.map((t) => ({ key: `q${t.quality ?? 0}`, name: 'Akwam', quality: t.quality, variant: 'SUB', data: { watch: t.watch, page: res.url, quality: t.quality } }));
      },
      async streams(server) {
        const res = await fetch.page(server.data.watch, { referer: server.data.page });
        const files = sourcesOf(res.text, base);
        if (!files.length) throw new Error('صفحة المشاهدة بلا ملف');
        // كل صفحة مشاهدة تذكر الجودات كلها؛ السيرفر يحمل جودة تبويبه وحدها (البقية سيرفراتها)
        const want = server.data.quality;
        const own = files.filter((f) => f.quality === want);
        return (own.length ? own : files).map((f) => ({ url: f.url, referer: null, quality: f.quality ?? want ?? null, label: 'Akwam', type: /\.m3u8/.test(f.url) ? 'hls' : 'mp4' }));
      },
    };
  },
};
