/**
 * غلاف واحد للعمل الواحد مهما تعددت مصادره، ويُحسم قبل العرض بقاعدة ثابتة لا تتبع
 * أيّ مصدر ردّ أولًا (فلا يتبدل الغلاف بين القائمة وصفحة العمل والسجل):
 *   1. غلاف AniList الرسمي (s4.anilist.co، أو مرشح `official: 'anilist'`)، بأعلى دقة.
 *   2. غلاف MangaDex الرسمي (uploads.mangadex.org/covers)، الأصل قبل المصغرات .512/.256.
 *   3. غلاف المصادر: أوثقها (`rank(sourceId)` الأصغر أوثق) ثم أعلاها جودة.
 *   التعادل الأخير بالرابط نفسه: النتيجة واحدة أيًّا كان ترتيب المرشحين.
 * القرار مشتق من مجموعة المرشحين وحدها؛ لا يُخزَّن حقل جديد (لا تغيير لشكل البيانات).
 *
 * @typedef {{ url?: string|null, sourceId?: string|null, official?: 'anilist'|'mangadex'|null }} CoverCandidate
 */

const isUrl = (u) => typeof u === 'string' && /^(https?:)?\/\//.test(u.trim());

/** 0 = AniList رسمي، 1 = MangaDex رسمي، 2 = مصدر. */
export function coverTier(c) {
  const url = String(c?.url ?? '');
  if (c?.official === 'anilist' || /\/\/s\d+\.anilist\.co\//.test(url) || /\/\/img\.anili\.st\//.test(url)) return 0;
  if (c?.official === 'mangadex' || /\/\/uploads\.mangadex\.org\/covers\//.test(url)) return 1;
  return 2;
}

/** درجة جودة تقديرية من الرابط (الأكبر أفضل). لا شبكة. */
export function coverQuality(url) {
  const u = String(url ?? '').toLowerCase();
  if (/\/cover\/large\//.test(u)) return 3; // AniList extraLarge
  if (/\/cover\/medium\//.test(u)) return 2; // AniList large
  if (/\/cover\/small\//.test(u)) return 1;
  if (/\.(256|512)\.(jpe?g|png|webp)$/.test(u)) return u.includes('.512.') ? 2 : 1; // مصغرات MangaDex
  const wide = u.match(/[?&](?:w|width)=(\d+)/) ?? u.match(/[-_](\d{2,4})x\d{2,4}\./);
  if (wide) return Number(wide[1]) >= 500 ? 2.5 : Number(wide[1]) >= 250 ? 1.5 : 0.5;
  if (/thumb|small|mini|_s\.|-s\./.test(u)) return 0.5;
  return 2;
}

/**
 * @param {CoverCandidate[]} candidates
 * @param {{ rank?: (sourceId: string) => number }} [options]
 * @returns {string|null}
 */
export function pickCover(candidates, { rank = () => 0 } = {}) {
  let best = null;
  let bestKey = null;
  for (const c of candidates ?? []) {
    if (!c || !isUrl(c.url)) continue;
    const url = c.url.trim();
    const tier = coverTier(c);
    const trust = tier === 2 ? Number(rank(String(c.sourceId ?? ''))) || 0 : 0;
    const key = [tier, trust, -coverQuality(url), url];
    if (less(key, bestKey)) {
      best = url;
      bestKey = key;
    }
  }
  return best;
}

function less(a, b) {
  if (!b) return true;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return a[3] < b[3];
}

/** مرشحو غلاف عمل مانجا (بطاقة V35 أو عمل الفهرس) بنسخه. */
export function coverCandidates(item) {
  const out = [];
  const official = item?._metaId != null ? 'anilist' : null;
  // غلاف البطاقة نفسها يُحسب فقط إن كان رسميًا؛ غلاف بطاقة المصادر مشتق من نسخها أصلًا
  const own = { url: item?.coverImage?.extraLarge || item?.coverImage?.large, official, sourceId: null };
  if (isUrl(own.url) && coverTier(own) < 2) out.push(own);
  for (const e of item?._work?.editions ?? item?.editions ?? []) out.push({ url: e?.manga?.thumbnailUrl, sourceId: e?.sourceId });
  return out;
}
