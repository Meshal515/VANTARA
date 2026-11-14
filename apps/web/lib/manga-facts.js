/**
 * حقائق المانجا من أكثر من مصدر (قرار المالك، 9 نوفمبر): AniList وحده كان يعطي حالة قديمة (Jujutsu Kaisen
 * «مستمر» وهي مكتملة) وتقييمًا غائبًا. هنا MyAnimeList (Jikan) وMangaDex، مجانيان بلا مفاتيح.
 *   الحالة: «مكتمل» إن قاله أي مصدر، وإلا الأغلب.
 *   التقييم: أول تقييم معروف (AniList ثم MAL) من 10.
 * الناتج محفوظ لكل عمل في الذاكرة طوال الجلسة.
 */
const MAL = { Finished: 'FINISHED', Publishing: 'RELEASING', 'On Hiatus': 'HIATUS', Discontinued: 'CANCELLED', 'Not yet published': 'NOT_YET_RELEASED' };
const MDX = { completed: 'FINISHED', ongoing: 'RELEASING', hiatus: 'HIATUS', cancelled: 'CANCELLED' };
const cache = new Map();
const get = (url, ms = 6000) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { signal: c.signal, headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null).finally(() => clearTimeout(t));
};
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * الحالة: «مكتمل» إن قاله أي مصدر (المصادر نادرًا ما تعلن الاكتمال خطأً، أما «مستمر» القديم فخطأ شائع في AniList)،
 * وإلا الأغلب، والتعادل لأول مصدر (AniList).
 */
export function voteStatus(list) {
  const known = list.filter(Boolean);
  if (!known.length) return null;
  if (known.includes('FINISHED')) return 'FINISHED';
  const count = (s) => known.filter((x) => x === s).length;
  return [...new Set(known)].sort((a, b) => count(b) - count(a))[0];
}

export function mangaFacts({ ref, title, alStatus = null, alScore = null }) {
  const key = String(ref);
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const q = encodeURIComponent(title ?? '');
      const [jk, md] = await Promise.all([
        title ? get(`https://api.jikan.moe/v4/manga?q=${q}&limit=3`) : null,
        title ? get(`https://api.mangadex.org/manga?title=${q}&limit=3`) : null,
      ]);
      const want = norm(title);
      const pick = (items, names) => items?.find((x) => names(x).some((n) => norm(n) === want)) ?? items?.[0] ?? null;
      const mal = pick(jk?.data, (x) => [x.title, x.title_english, ...(x.titles ?? []).map((t) => t.title)]);
      const mdx = pick(md?.data, (x) => [...Object.values(x.attributes?.title ?? {}), ...(x.attributes?.altTitles ?? []).flatMap((t) => Object.values(t))]);
      const status = voteStatus([alStatus, MAL[mal?.status] ?? null, MDX[mdx?.attributes?.status] ?? null]);
      const score = Number(alScore) > 0 ? Number(alScore) / 10 : Number(mal?.score) > 0 ? Number(mal.score) : null;
      return { status, score };
    })());
  }
  return cache.get(key);
}
