/**
 * «آخر التحديثات» للمانجا من الخادم نفسه: كانت المواقع العربية (عدا TeamX وMangaDex)
 * لا تصل الخط الزمني إلا حين يكون جوال مفتوحًا ويمسح، فتنزل الفصول دفعات بعد ساعات.
 * هنا يقرأ الخادم صفحة «آخر التحديثات» لكل موقع بالتناوب (ثلاثة كل دقيقة)، ويبلّغ أعلى
 * فصلين لكل عمل. مفتاح العمل هو نفسه عند التطبيق (`ext:` + العنوان الموحّد) فيلتقي الحدث
 * بما يرسله الجوال لا بنسخة ثانية.
 *
 * الحلّ بالتعابير لا بشجرة DOM: خطة الخادم المجانية تعطي ملّي ثوانيَ قليلة من المعالج
 * لكل تشغيل، والقوائم 40–200 كيلوبايت.
 */
import { decodeEntities, normalizeTitle, parseChapterNumber } from '../../../apps/web/lib/catalog.js';
import { adultGenre, adultTitle } from '../../../apps/web/lib/adult-filter.js';

export type SiteUnit = { number: number; publishedAt?: number };
export type SiteWork = { title: string; url: string; cover: string | null; units: SiteUnit[] };
type Kind = 'madara' | 'madara-archive' | 'iken' | 'swat';
export type Site = { id: string; kind: Kind; base: string; sub?: string };

/** المصادر نفسها التي يقرؤها التطبيق والويب (معرّفات الإضافات كما هي). */
export const MANGA_SITES: Site[] = [
  { id: 'eu.kanade.tachiyomi.extension.ar.mangalek', kind: 'madara', base: 'https://mangalik.net' },
  { id: 'eu.kanade.tachiyomi.extension.ar.azora', kind: 'iken', base: 'https://azorafly.com' },
  { id: 'eu.kanade.tachiyomi.extension.ar.mangaswat', kind: 'swat', base: 'https://meshmanga.com' },
  { id: 'eu.kanade.tachiyomi.extension.ar.manga3asq', kind: 'madara-archive', base: 'https://3asq.online' },
  { id: 'eu.kanade.tachiyomi.extension.ar.hizomanga', kind: 'madara', base: 'https://hizomanga.net', sub: 'serie' },
  { id: 'eu.kanade.tachiyomi.extension.ar.mangastarz', kind: 'madara', base: 'https://starzmanga.com' },
  { id: 'eu.kanade.tachiyomi.extension.ar.mangaspark', kind: 'madara', base: 'https://sparkmanga.net' },
  { id: 'eu.kanade.tachiyomi.extension.ar.mangalink', kind: 'madara', base: 'https://link-manga.net' },
  { id: 'eu.kanade.tachiyomi.extension.ar.mangalionz', kind: 'madara', base: 'https://manga-lionz.org' },
];

const strip = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const pathOf = (href: string, base: string) => {
  try {
    const u = new URL(href, base);
    return u.pathname + u.search;
  } catch {
    return '';
  }
};
const top = (units: SiteUnit[]) => units.filter((u) => Number.isFinite(u.number) && u.number >= 0 && u.number <= 100_000).slice(0, 2);

/** بطاقات Madara (قائمة admin-ajax أو صفحة الأرشيف): العنوان والرابط والغلاف وآخر فصلين. */
export function madaraCards(html: string, base: string): SiteWork[] {
  const blocks = html.split(/<div\b[^>]*class=["'][^"']*\bpage-item-detail\b[^"']*["'][^>]*>/i).slice(1);
  const out: SiteWork[] = [];
  for (const block of blocks) {
    // شارة «18+» في بطاقة Madara (manga-title-badges … adult): محتوى للكبار لا يُبلَّغ
    if (/class=["'][^"']*\bmanga-title-badges\b[^"']*\badult\b/i.test(block)) continue;
    const titleArea = /class=["'][^"']*\bpost-title\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:h3|h5|div)>/i.exec(block)?.[1] ?? '';
    // 3asq وأمثاله يضعون قبل رابط العمل شارة («18+») ترتبط بموقع آخر: رابط العمل على نفس الموقع
    const host = new URL(base).hostname;
    const links = [...titleArea.matchAll(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)];
    const sameSite = (href: string) => { try { return new URL(href, base).hostname === host; } catch { return false; } };
    const chosen = links.find((m) => sameSite(m[2]!) && !/\btarget=/i.test(m[1]! + m[3]!)) ?? links.find((m) => sameSite(m[2]!));
    const link = chosen ? [chosen[0], chosen[2], chosen[4]] : null;
    if (!link) continue;
    const title = strip(link[2]!);
    const url = pathOf(link[1]!, base);
    if (!title || !url || adultTitle(title)) continue;
    const img = /<img\b[^>]*>/i.exec(block)?.[0] ?? '';
    const src = /\b(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i.exec(img)?.[1] ?? null;
    const units: SiteUnit[] = [];
    for (const m of block.matchAll(/class=["'][^"']*\bchapter\b[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      let n = parseChapterNumber(strip(m[2]!));
      if (n < 0) n = parseChapterNumber(decodeURIComponent(m[1]!.replace(/\/+$/, '').split('/').pop() ?? ''));
      if (n >= 0 && !units.some((u) => u.number === n)) units.push({ number: n });
    }
    if (units.length) out.push({ title, url, cover: src && /^https?:\/\//.test(src) ? src : null, units: top(units) });
  }
  return out;
}

type IkenPost = { id?: number; slug?: string; postTitle?: string; featuredImage?: string; isNovel?: boolean; seriesType?: string; genres?: Array<{ name?: string }>; chapters?: Array<{ number?: number; createdAt?: string; isLocked?: boolean }> };
/** Iken (Azora): JSON بتاريخ رفع دقيق لكل فصل. */
export function ikenWorks(body: { posts?: IkenPost[] }, now: number): SiteWork[] {
  return (body.posts ?? []).filter((p) => p.postTitle && p.slug && p.isNovel !== true && String(p.seriesType ?? '').toLowerCase() !== 'novel'
    && !adultGenre((p.genres ?? []).map((g) => g?.name ?? '')) && !adultTitle(p.postTitle)).map((p) => ({
    title: String(p.postTitle).trim(),
    url: `${p.slug}#${p.id}`,
    cover: p.featuredImage && /^https?:\/\//.test(p.featuredImage) ? p.featuredImage : null,
    // الفصل المقفل (عملات أو وقت) لا يُقرأ في التطبيق: لا يُعلن تحديثًا
    units: top((p.chapters ?? []).filter((c) => c.isLocked !== true).map((c) => {
      const at = Date.parse(c.createdAt ?? '');
      return { number: Number(c.number), ...(Number.isFinite(at) && at <= now ? { publishedAt: at } : {}) };
    })),
  })).filter((w) => w.units.length);
}

type SwatSerie = { serie_id?: number; title?: string; genres?: Array<{ name?: string }>; poster?: { medium?: string }; chapters?: Array<{ chapter?: string; created_at?: string }> };
/** MangaSwat (meshmanga): `/series/releases/` JSON بتاريخ الرفع. */
export function swatWorks(body: { results?: SwatSerie[] }, now: number): SiteWork[] {
  return (body.results ?? []).filter((s) => s.title && s.serie_id && !adultGenre((s.genres ?? []).map((g) => g?.name ?? '')) && !adultTitle(s.title)).map((s) => ({
    title: String(s.title).trim(),
    url: String(s.serie_id),
    cover: s.poster?.medium && /^https?:\/\//.test(s.poster.medium) ? s.poster.medium : null,
    units: top((s.chapters ?? []).map((c) => {
      const at = Date.parse(c.created_at ?? '');
      return { number: parseChapterNumber(String(c.chapter ?? '')), ...(Number.isFinite(at) && at <= now ? { publishedAt: at } : {}) };
    })),
  })).filter((w) => w.units.length);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MADARA_FORM = () => new URLSearchParams({
  action: 'madara_load_more', page: '0', template: 'madara-core/content/content-archive',
  'vars[paged]': '1', 'vars[template]': 'archive', 'vars[posts_per_page]': '20', 'vars[post_type]': 'wp-manga',
  'vars[post_status]': 'publish', 'vars[orderby]': 'meta_value_num', 'vars[meta_key]': '_latest_update',
  'vars[order]': 'DESC', 'vars[manga_archives_item_layout]': 'big_thumbnail',
});

/** صفحة «آخر التحديثات» لموقع واحد. يرمي خطأ إن لم يرجع الموقع أي عمل (حجب أو تغيّر قالب). */
export async function readSite(site: Site, fetchImpl: typeof fetch, now: number): Promise<SiteWork[]> {
  const get = async (url: string, init: RequestInit = {}) => {
    const r = await fetchImpl(url, { ...init, headers: { 'User-Agent': UA, Referer: `${site.base}/`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };
  let works: SiteWork[];
  if (site.kind === 'madara') {
    const r = await get(`${site.base}/wp-admin/admin-ajax.php`, { method: 'POST', body: MADARA_FORM(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' } });
    works = madaraCards(await r.text(), site.base);
  } else if (site.kind === 'madara-archive') {
    works = madaraCards(await (await get(`${site.base}/${site.sub ?? 'manga'}/?m_orderby=latest`)).text(), site.base);
  } else if (site.kind === 'iken') {
    const api = `https://api.${new URL(site.base).hostname.replace(/^www\./, '')}`;
    works = ikenWorks(await (await get(`${api}/api/query?page=1&perPage=24&searchTerm=&orderBy=lastChapterAddedAt&orderDirection=desc`)).json() as { posts?: IkenPost[] }, now);
  } else {
    works = swatWorks(await (await get(`${site.base}/v2/api/v2/series/releases/?page=1`)).json() as { results?: SwatSerie[] }, now);
  }
  if (!works.length) throw new Error('empty listing');
  return works;
}

/** تقرير Update Engine لعمل من موقع (نفس شكل تقرير التطبيق). */
export function siteReport(site: Site, w: SiteWork) {
  const key = normalizeTitle(w.title);
  if (!key) return null;
  return {
    work: `ext:${key}`, section: 'manga', kind: 'chapter', title: w.title, cover: w.cover,
    source: { s: site.id, u: w.url, t: w.title }, units: w.units,
  };
}
