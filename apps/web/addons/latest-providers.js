/**
 * محوّلات «الأحدث» لكل محرك (خطة 27 نوفمبر، المرحلة 4). عقد واحد لكل مصدر مثبت ومفعّل، بلا أسماء مواقع:
 *
 *   { key, family, section, lang, name, host,
 *     latest(page)  → { items: [{ ref, title, cover, url }], hasNext }   // طلب واحد لصفحة «الأحدث»
 *     units(ref)    → [{ number, season, publishedAt? }] }               // يُنادى فقط بعد أن يقول حدث «نزل»
 *
 * - Mihon: `ExtensionEngine.latest` (أندرويد) و`latest` في Suwayomi (ويندوز) عبر `lib/extension-engine.js`.
 * - Aniyomi وCloudStream: `AnimeEngine.page` بقسم يختاره المصدر نفسه: `latest` إن أعلنه، وإلا قسم يعلن اسمه أنه
 *   الأحدث (آخر/أحدث/جديد/Latest/Recent/New)، وإلا القسم الأول من صفحته الرئيسية.
 * - VANTARA ADD-ON مستقبلًا يكفيه هذا العقد، ويعطي `units` مباشرة في عناصر `latest` فلا طلب ثانٍ.
 *
 * لا يطلب شيئًا بنفسه عند الإنشاء: الطلب الوحيد الدوري هو `latest(1)`، و`units` للانتشار بعد الكشف فقط.
 */
import { chapterNumberOf } from '../lib/catalog.js';

const LATEST_NAME = /(?:\blatest\b|\brecent|\bnew\b|\bupdated?\b|آخر|اخر|أحدث|احدث|جديد|الحلقات الجديدة|المضاف حديث)/i;
const hostOf = (v) => { try { return new URL(/^https?:/i.test(String(v)) ? String(v) : `https://${v}`).hostname.toLowerCase(); } catch { return null; } };
const sectionOf = (content) => (content === 'manga' ? 'manga' : content === 'cinema' ? 'cinema' : 'anime');

/** يختار قسم «الأحدث» من أقسام المصدر كما يعلنها هو. */
export function pickLatestSection(sections = []) {
  if (!Array.isArray(sections) || !sections.length) return null;
  return sections.find((s) => s?.key === 'latest')?.key
    ?? sections.find((s) => typeof s?.name === 'string' && LATEST_NAME.test(s.name))?.key
    ?? sections.find((s) => String(s?.key).startsWith('section:'))?.key
    ?? null;
}

/** محوّلات المانجا: كل مصدر مثبت ومرئي يعلن «الأحدث». */
export function mangaProviders({ engine, sources }) {
  return (sources ?? []).filter((s) => s?.id && s.supportsLatest !== false && !s.filler).map((s) => ({
    key: s.id, family: 'manga', section: 'manga', lang: s.lang ?? null, name: s.name ?? s.id, host: hostOf(s.domain ?? s.baseUrl),
    async latest(page = 1) {
      const out = await engine.latest(s.id, page);
      return {
        items: (out?.mangas ?? []).filter((m) => m?.url && m?.title).map((m) => ({ ref: m, title: m.title, cover: m.thumbnailUrl ?? m.thumbnail_url ?? null, url: m.url })),
        hasNext: Boolean(out?.hasNextPage),
      };
    },
    async units(ref) {
      // fresh: ويندوز والويب يخزّنان قائمة الفصول 30 دقيقة؛ الكاشف يحتاج الحالية (الطلب لمرشح فعلي فقط)
      const chapters = await engine.chapters(s.id, ref, { fresh: true });
      return (chapters ?? []).map((c) => ({ number: chapterNumberOf(c), season: null, ...(Number(c?.dateUpload) > 0 ? { publishedAt: Number(c.dateUpload) } : {}) })).filter((u) => Number.isFinite(u.number) && u.number >= 0); // غير المرقّم (-1) لا ينشئ حدثًا
    },
  }));
}

/** محوّلات الأنمي والسينما (Aniyomi وCloudStream) عبر محرك الأنمي الأصلي. */
export async function animeProviders({ plugin }) {
  if (typeof plugin?.sources !== 'function' || typeof plugin?.page !== 'function') return [];
  const list = (await plugin.sources())?.sources ?? [];
  const out = [];
  for (const s of list) {
    if (!s?.id || s.enabled === false || s.loadError) continue;
    let listing = null;
    try { listing = pickLatestSection((await plugin.sections?.({ sourceId: s.id }))?.sections); } catch { /* مصدر بلا أقسام معلنة */ }
    if (!listing) continue;
    out.push({
      key: s.id, family: String(s.id).startsWith('addon|cs3|') ? 'cloudstream' : 'aniyomi', section: sectionOf(s.content), lang: s.lang ?? null, name: s.name ?? s.id, host: hostOf(s.domain), listing,
      async latest(page = 1) {
        const r = (await plugin.page({ sourceId: s.id, listing, page }))?.page;
        return { items: (r?.items ?? []).filter((a) => a?.url && a?.title).map((a) => ({ ref: a, title: a.title, cover: a.thumbnail ?? null, url: a.url })), hasNext: Boolean(r?.hasNext) };
      },
      async units(ref) {
        const eps = (await plugin.episodes({ anime: ref }))?.episodes ?? [];
        return eps.filter((e) => Number.isFinite(e?.number) && e.number >= 0 && !e.filler).map((e) => ({ number: e.number, season: Number.isInteger(ref?.requestedSeason) ? ref.requestedSeason : null, ...(e.date > 0 ? { publishedAt: e.date } : {}) }));
      },
    });
  }
  return out;
}
