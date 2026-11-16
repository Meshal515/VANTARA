/**
 * «الحلقة 3» نفس الحلقة في كل المصادر التي تُجمع سيرفراتها في قائمة واحدة — نفس قاعدة Android
 * (EpisodeAlign.kt). بلاغ المالك (16 نوفمبر 2026، Tatsuki Fujimoto 17-26): مصادر ترتّب قصص العمل
 * بترتيبات مختلفة، فكان تغيير السيرفر يغيّر الحلقة.
 *
 * أول مصدر يحدد هوية الحلقة باسمها. مصدر لاحق اسم حلقته بنفس الرقم مختلف بوضوح (بنفس الكتابة)
 * تُؤخذ منه الحلقة التي تحمل الاسم نفسه، وإن لم توجد لا تُخلط سيرفراته. الأسماء العامة
 * («الحلقة 3») واللغات المختلفة ليست دليلًا: يبقى الرقم كما هو.
 */
const GENERIC = new Set(['episode', 'ep', 'eps', 'e', 'part', 'pt', 'final', 'end', 'the', 'and', 'of', 'a', 'an', 'sub', 'dub', 'raw', 'hd', 'fhd', 'uncensored', 'special', 'ova', 'ona',
  'الحلقة', 'حلقة', 'الحلقه', 'حلقه', 'مترجمة', 'مترجم', 'مدبلجة', 'مدبلج', 'الأخيرة', 'الاخيرة', 'اون', 'لاين']);
const SAME = 0.5;
const split = (text) => String(text ?? '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

export function episodeWords(name, workTitle = null) {
  const work = new Set(split(workTitle));
  return new Set(split(name).filter((w) => w.length >= 2 && !GENERIC.has(w) && !work.has(w)));
}
const meaningful = (words) => [...words].reduce((n, w) => n + w.length, 0) >= 4;
export const identifiesEpisode = (name, workTitle = null) => meaningful(episodeWords(name, workTitle));
function script(text) {
  const s = String(text ?? '').toLowerCase();
  const latin = (s.match(/[a-z]/g) ?? []).length, arabic = (s.match(/[؀-ۿ]/g) ?? []).length;
  return !latin && !arabic ? 'other' : latin >= arabic ? 'latin' : 'arabic';
}
function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** ← {use: episode, realigned} | {skip: true} | null (لا حلقة). */
export function alignEpisode(anchorName, picked, episodes, workTitle = null) {
  if (!picked) return null;
  const anchor = anchorName ? episodeWords(anchorName, workTitle) : null;
  if (!anchor || !meaningful(anchor)) return { use: picked, realigned: false };
  const mine = episodeWords(picked.name, workTitle);
  if (!meaningful(mine) || script(picked.name) !== script(anchorName)) return { use: picked, realigned: false };
  if (similarity(anchor, mine) >= SAME) return { use: picked, realigned: false };
  let best = null, score = 0;
  for (const e of episodes ?? []) {
    if (e === picked) continue;
    const s = similarity(anchor, episodeWords(e.name, workTitle));
    if (s >= SAME && s > score) { best = e; score = s; }
  }
  return best ? { use: best, realigned: true } : { skip: true };
}

/** قائمة فيلم: حلقة واحدة، أو نسخ بلا ترقيم/بنفس الرقم. رقمان مختلفان فأكثر = مسلسل أو مجموعة أفلام. */
export function movieListing(episodes = []) {
  if (episodes.length <= 1) return true;
  return new Set(episodes.map((e) => Number(e.number)).filter((n) => Number.isFinite(n) && n > 0)).size <= 1;
}
