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
 * صورة الحلقة بأعلى دقة متاحة، ومعها بدائلها بالترتيب:
 * 1. لقطة metahub الأصلية 1920×1080 (ثم 780) حين تُطابَق الحلقة بالتاريخ (`art.hd`، loadHdStills)،
 * 2. لقطة AniList (Crunchyroll)، 3. لقطة ani.zip من TVDB (غالبًا 640×360)،
 * 4. غلاف العمل (ثم بنره). `fallbacks` تُجرَّب واحدة بعد الأخرى إن تعذّر تحميل ما قبلها.
 * @returns {{ src: string|null, still: boolean, fallbacks: string[] }}
 */
export function episodeStill(m, n, art = null) {
  const hd = art?.hd?.[String(n)] ?? null;
  const low = [m?.thumbs?.[n]?.thumbnail, art?.episodes?.[String(n)]?.image].filter(Boolean);
  const chain = [hd?.src, hd?.mid, ...low].filter(Boolean);
  if (chain.length) return { src: chain[0], still: true, fallbacks: [...new Set(chain.slice(1))] };
  return { src: m?.poster ?? m?.posterSmall ?? m?.banner ?? null, still: false, fallbacks: [] };
}

const DAY = 86400000;
const hdCache = new Map();
/** «2022-09-13» أو «2022-09-13T07:00:00.000Z» ← ميلي ثانية، أو null. */
const dayOf = (v) => {
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? t : null;
};

/**
 * لقطات الحلقات بدقة 1920×1080 من metahub (مصدر صور حلقات Cinemeta/Stremio). ترقيم حلقات
 * الأنمي يختلف بين المواقع، فلا تُعتمد صورة إلا إذا طابقت الحلقةُ في Cinemeta الموسمَ
 * والرقمَ وتاريخَ العرض (±3 أيام) كما في ani.zip؛ غير ذلك تبقى لقطة TVDB. لا يرمي.
 * @returns {Promise<Record<string, {src: string, mid: string}>>}
 */
export async function loadHdStills(art, { fetchImpl = globalThis.fetch } = {}) {
  const imdb = art?.imdb;
  if (!/^tt\d+$/.test(imdb ?? '') || !art?.episodes) return {};
  if (!hdCache.has(imdb)) {
    hdCache.set(imdb, (async () => {
      try {
        const r = await fetchImpl(`https://v3-cinemeta.strem.io/meta/series/${imdb}.json`);
        const videos = r.ok ? (await r.json())?.meta?.videos : null;
        return Array.isArray(videos) ? videos : [];
      } catch {
        hdCache.delete(imdb);
        return [];
      }
    })());
  }
  const videos = await hdCache.get(imdb);
  const out = {};
  for (const [n, e] of Object.entries(art.episodes)) {
    const a = dayOf(e.airDate);
    if (a == null) continue;
    const near = (x, span) => {
      const b = dayOf(x?.released ?? x?.firstAired);
      return b != null && Math.abs(a - b) <= span;
    };
    // الموسم والرقم والتاريخ معًا؛ وإن اختلف الترقيم (Bleach TYBW: TVDB 17 وIMDb غيره) يُقبل
    // التاريخ وحده بشرط أن تكون حلقة واحدة فقط عُرضت ذلك اليوم (حلقتان معًا = لا تخمين)
    let v = videos.find((x) => x?.season === e.season && x?.episode === e.number && near(x, 3 * DAY));
    if (!v) {
      const same = videos.filter((x) => x?.season > 0 && near(x, DAY / 2));
      if (same.length === 1) v = same[0];
    }
    const mid = typeof v?.thumbnail === 'string' && /^https:\/\/episodes\.metahub\.space\//.test(v.thumbnail) ? v.thumbnail : null;
    if (!mid) continue;
    out[n] = { src: mid.replace(/\/w\d+\.jpg$/, '/original.jpg'), mid };
  }
  return out;
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
