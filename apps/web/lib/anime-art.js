/**
 * فن صفحة الأنمي كالمسلسلات: صورة لكل حلقة (لقطة منها) وشعار العنوان بدل النص.
 *
 * AniList لا يعطي لقطات إلا لما على Crunchyroll (`streamingEpisodes`)، وكثير من الأعمال
 * بلا شيء، فصارت الحلقات بلاطات بأرقام. ani.zip يربط AniList ← TVDB/IMDb ويعطي لكل حلقة
 * لقطتها، ومن IMDb نأخذ الشعار من metahub (نفس مصدر شعارات السينما وغرفة المشاهدة).
 * الطلب نفسه مخبّأ في `together/art.js` فلا يتكرّر بين الصفحة والغرفة.
 * لا لقطة؟ غلاف العمل. لا شعار؟ الاسم نصًا — لا تخمين.
 */
import { aniZipArt, logoOfImdb } from './together/art.js';

/** معرّف AniList رقمي فقط؛ أعمال الإضافات (`addon-…`) لا تُربط. */
export const anilistIdOf = (id) => (/^\d+$/.test(String(id ?? '')) && Number(id) > 0 ? Number(id) : null);

/**
 * صورة الحلقة: لقطة AniList، ثم لقطة ani.zip، ثم غلاف العمل (ثم بنره إن لم يكن غلاف).
 * @returns {{ src: string|null, still: boolean }}
 */
export function episodeStill(m, n, art = null) {
  const still = m?.thumbs?.[n]?.thumbnail || art?.episodes?.[String(n)]?.image || null;
  if (still) return { src: still, still: true };
  return { src: m?.poster ?? m?.posterSmall ?? m?.banner ?? null, still: false };
}

/** عنوان الحلقة: MAL أولًا (الأدق)، ثم AniList، ثم ani.zip. */
export const episodeTitleOf = (m, n, { mal = null, art = null } = {}) =>
  mal?.[n] ?? m?.thumbs?.[n]?.title ?? art?.episodes?.[String(n)]?.title ?? null;

/** شعار العنوان من IMDb العمل إن عُرف. */
export const animeLogoOf = (art) => logoOfImdb(art?.imdb ?? null);

/** فن العمل من ani.zip (مخبّأ). لا يرمي: بلا شبكة يرجع null وتبقى الصفحة كما هي. */
export async function loadAnimeArt(id, opts) {
  const anilist = anilistIdOf(id);
  if (!anilist) return null;
  try {
    const z = await aniZipArt(anilist, opts);
    return z ? { ...z, logo: animeLogoOf(z) } : null;
  } catch {
    return null;
  }
}
