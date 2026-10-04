/**
 * جسر المانجا للـPWA: نفس واجهة إضافة `ExtensionEngine` الأصلية في الـAPK
 * (`lib/extension-engine.js` يناديها كما هي)، لكن المصادر هنا محركات ويب
 * (pwa/sources) عبر جالب الويب، والكاش في IndexedDB.
 *
 * أشكال الردود مطابقة للأصلية: `{ sources }`، `{ mangas, hasNextPage, page }`،
 * `{ manga, chapters, count }`، `{ pages, count }`، `{ path }` للصور.
 */

import { publicUrl } from '../../addons/manifest.js';
import { getRuntime } from '../runtime.js';
import { imageSrc } from '../cache/images.js';
import { checkListing, checkPages, checkSeries } from '../sources/contract.js';
import { supports } from '../../lib/capabilities.js';

const MIN = 60 * 1000;
const TTL = { search: 30 * MIN, popular: 20 * MIN, latest: 10 * MIN, catalogue: 20 * MIN, genre: 30 * MIN, series: 30 * MIN, pages: 7 * 24 * 60 * MIN };

const keyOf = (...parts) => parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('|');
const cacheId=(registry,id)=>id.startsWith("addon|") ? `${id}@${registry.def(id)?.manifest.version}@${registry.def(id)?.manifest.cacheEpoch ?? "legacy-v2"}` : id;
const mangaKey = (m) => m?.memo ? `${m.url}#${m.memo}` : String(m?.url ?? '');

async function rt() {
  const r = getRuntime();
  await r.ready;
  await r.addons?.ready;
  return r.addons ? { ...r, registry: r.addons.sources } : r;
}

async function listing(kind, { sourceId, page = 1, query = '', names = null }) {
  const { registry, store } = await rt();
  if (registry.cooling(sourceId)) throw Object.assign(new Error('المصدر يرتاح قليلًا بعد أعطال متتالية'), { code: 'cooling' });
  const { value } = await store.cached('source', keyOf(cacheId(registry,sourceId), kind, query || names || '', page), () =>
    registry.call(sourceId, async (source) => {
      const out =
        kind === 'search' ? await source.search(query, page)
        : kind === 'popular' ? await source.popular(page)
        : kind === 'genre' ? await (source.genre ? source.genre(names, page) : { mangas: [], hasNextPage: false })
        : kind === 'catalogue' ? await (source.catalogue ? source.catalogue(page) : source.latest(page))
        : await source.latest(page);
      return checkListing(out);
    }), { ttlMs: TTL[kind] });
  return { ...value, page };
}

async function series(sourceId, manga, { fresh = false } = {}) {
  const { registry, store } = await rt();
  const { value } = await store.cached('meta', keyOf(cacheId(registry,sourceId), 'series', mangaKey(manga)), () =>
    registry.call(sourceId, async (source) => checkSeries(await source.series(manga))), { ttlMs: TTL.series, fresh });
  return value;
}

export const MangaEngine = {
  async sources() {
    const { registry } = await rt();
    return {
      sources: (supports('mangaWebSources') ? registry.list('manga') : []).map((d) => ({
        id: d.id,
        label: d.label,
        lib: 1.6,
        version: `web-${d.version}`,
        warning: d.warning ?? 'SAFE',
        names: d.names ?? [d.label],
        lang: d.lang ?? 'ar',
        ready: true,
        web: true,
      })),
    };
  },
  async prepare({ sourceId }) {
    const { registry } = await rt();
    const def = registry.def(sourceId);
    if (!def) throw new Error('المصدر غير متاح في نسخة الويب');
    return { ok: true, name: def.label, lang: def.lang ?? 'ar', baseUrl: `https://${def.domain}` };
  },
  popular: (args) => listing('popular', args),
  latest: (args) => listing('latest', args),
  catalogue: (args) => listing('catalogue', args),
  search: (args) => listing('search', args),
  genre: (args) => listing('genre', args),
  async series({ sourceId, manga }) {
    const out = await series(sourceId, manga);
    return { manga: out.manga, chapters: out.chapters, count: out.chapters.length };
  },
  async chapters({ sourceId, manga }) {
    const out = await series(sourceId, manga);
    return { chapters: out.chapters, count: out.chapters.length };
  },
  async pages({ sourceId, chapter }) {
    const { registry, store } = await rt();
    const { value } = await store.cached('meta', keyOf(cacheId(registry,sourceId), 'pages', chapter?.url, chapter?.memo ?? ''), () =>
      registry.call(sourceId, async (source) => checkPages(await source.pages(chapter))), { ttlMs: TTL.pages });
    return { pages: value, count: value.length };
  },
  async image({ sourceId, page }) {
    const r = await rt();
    if(sourceId?.startsWith("addon|"))return {path:publicUrl(page?.imageUrl ?? page?.url).href,bytes:0,cached:false};
    await r.ensureMedia();
    const source = r.registry.source(sourceId);
    const referer = source?.imageReferer?.(page) ?? null;
    const url = page?.imageUrl ?? page?.url;
    return { path: imageSrc(url, referer, r.fetcher), bytes: 0, contentType: null, cached: false, sourceUrl: url };
  },
  async cover({ sourceId, url }) {
    const r = await rt();
    if(sourceId?.startsWith("addon|"))return {path:publicUrl(url).href,cached:false};
    await r.ensureMedia().catch(() => null);
    const def = sourceId ? r.registry.def(sourceId) : null;
    return { path: imageSrc(url, def ? `https://${def.domain}/` : null, r.fetcher), cached: false };
  },
  async clearImageCache() {
    const { clearImageCache } = await import('../cache/images.js');
    // الحجم بالبايت لا يُعرف من كاش المتصفح؛ العدد يكفي للواجهة
    return { freedBytes: 0, cleared: await clearImageCache() };
  },
};
