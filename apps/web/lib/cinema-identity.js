/**
 * هوية عمل السينما: معرّف IMDb ونوعه، لا اسمه.
 *
 * «Shameless» اسمٌ لا هوية: يحمله مسلسل 2011 (tt1586680)، ومسلسل 2004
 * البريطاني (tt0377260)، والروسي 2017 (tt4393622، اسمه في التفاصيل
 * «Besstydniki»)، وفيلم 2012 (tt1927068). لذلك:
 *   - المسار والذاكرة ومفاتيح المصادر كلها بالمعرّف (`playKey`).
 *   - التفاصيل تُدمج مع ما ضغطه الشخص بنفس المعرّف فقط، والاسم الذي رآه في
 *     البطاقة يبقى اسم الصفحة؛ اسم التفاصيل المختلف يصير اسمًا بديلًا.
 *   - مطابقة المصادر تعرف إخوة الاسم (أعمال بنفس الاسم والنوع) وسنواتهم،
 *     فلا تقفز من عمل إلى آخر يحمل اسمه.
 */
import { titleScore } from './cinema-match.js';

/** مفتاح العمل الثابت: النوع والمعرّف. الاسم لا يدخل فيه أبدًا. */
export const workKey = (m) => `${m?.type ?? '?'}:${m?.id ?? ''}`;

/** ما قبل النقطتين: «Dune» من «Dune: Part One». */
const short = (t) => String(t ?? '').replace(/\s*[:–—].*$/, '');
/** نفس الاسم تمامًا، أو اسم النتيجة قبل النقطتين («Dune: Part One» أخٌ لـ«Dune» 1984). */
const sameName = (name, other) => titleScore(name, other) === 1 || titleScore(name, short(other)) === 1;

const uniq = (xs) => [...new Set(xs.map((x) => String(x ?? '').trim()).filter(Boolean))];

/** كل أسماء العمل المعروفة: الظاهر أولًا. */
export const namesOf = (m) => uniq([m?.title, ...(m?.aliases ?? [])]);

/**
 * تفاصيل Cinemeta فوق العمل الذي ضُغط. معرّف مختلف = ليس العمل نفسه (null).
 * ما ينقص التفاصيل (ملصق، خلفية، سنة) يُؤخذ من البطاقة، والاسم الظاهر يبقى.
 */
export function mergeWork(clicked, full) {
  if (!full) return null;
  if (clicked?.id && String(full.id) !== String(clicked.id)) return null;
  if (clicked?.type && full.type && clicked.type !== full.type) return null;
  const title = clicked?.title || full.title;
  return {
    ...full,
    title,
    aliases: uniq([full.title, ...(full.aliases ?? []), ...(clicked?.aliases ?? []), clicked?.title]).filter((n) => n !== title),
    poster: full.poster ?? clicked?.poster ?? null,
    background: full.background ?? clicked?.background ?? null,
    year: full.year ?? clicked?.year ?? null,
  };
}

/** سنة كل موسم من تاريخ أول حلقة عُرضت فيه. */
export function seasonYears(m) {
  const out = {};
  for (const s of m?.seasons ?? []) {
    const first = s.episodes?.map((e) => e.released).filter(Number.isFinite).sort((a, b) => a - b)[0];
    if (first) out[s.n] = new Date(first).getUTCFullYear();
  }
  return out;
}

/**
 * إخوة الاسم من نتائج بحث Cinemeta (مرتبة بالشهرة): أعمال من النوع نفسه
 * يطابق اسمُها أحد أسماء هذا العمل تمامًا.
 */
export function namesakes(m, results = []) {
  const names = namesOf(m);
  return results.filter((r) => r && r.type === m.type && names.some((n) => sameName(n, r.title)));
}

/**
 * معايير المطابقة لعمل محدد الهوية (تُمرَّر إلى pickCopies/judgeCopy).
 * `results`: نتائج بحث Cinemeta باسم العمل؛ بدونها لا نعرف إخوة الاسم فيبقى
 * السلوك كما كان (العمل يُعامل كالأشهر).
 */
export function matchCriteria(m, { season = null, results = null } = {}) {
  const names = namesOf(m);
  const base = {
    title: names[0] ?? '',
    aliases: names.slice(1),
    year: m.year ?? null,
    endYear: m.endYear ?? null,
    type: m.type,
    season: m.type === 'series' ? season : null,
    seasonYears: m.type === 'series' ? seasonYears(m) : {},
    // ما قبل النقطتين («Dune» من «Dune: Part One») اسمٌ ضعيف: بسنته فقط
    weakAliases: uniq(names.map(short)).filter((n) => !names.includes(n)),
  };
  if (!results) return base;
  // أسماء أعمال أخرى من النوع نفسه: نسخة تحمل اسم أحدها حرفيًا ليست لهذا العمل
  const otherTitles = [...new Set(results.filter((r) => r && r.type === m.type && r.id !== m.id).map((r) => r.title).filter((t) => t && !names.some((n) => titleScore(n, t) === 1)))];
  base.otherTitles = otherTitles;
  const same = namesakes(m, results);
  const others = same.filter((r) => r.id !== m.id);
  if (!others.length) return { ...base, primary: true, sharedNames: [], namesakeYears: [] };
  const sharedNames = names.filter((n) => others.some((r) => sameName(n, r.title)));
  return {
    ...base,
    primary: same[0]?.id === m.id,
    sharedNames,
    namesakeYears: uniq(others.map((r) => r.year)).map(Number).filter(Number.isFinite),
  };
}
