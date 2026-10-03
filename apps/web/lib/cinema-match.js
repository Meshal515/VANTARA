/**
 * مطابقة عمل Cinemeta (عنوان إنجليزي + سنة + موسم) بنسخه في المصادر العربية.
 *
 * عناوين المصادر محشوّة: «فيلم Inception 2010 مترجم اون لاين»، «مسلسل Dark
 * الموسم الثاني مترجم». نطابق الكلمات اللاتينية بعد حذف الحشو، ونقرأ السنة
 * والموسم، ونستبعد الفيلم إن طلبنا مسلسلًا والعكس.
 */

const ORDINALS = {
  الاول: 1, الأول: 1, الثاني: 2, الثالث: 3, الرابع: 4, الخامس: 5, السادس: 6, السابع: 7, الثامن: 8, التاسع: 9, العاشر: 10,
  'الحادي عشر': 11, 'الثاني عشر': 12, 'الثالث عشر': 13, 'الرابع عشر': 14, 'الخامس عشر': 15,
};
const NOISE = new Set([
  'the', 'a', 'an', 'and', 'of', 'hd', 'fhd', 'uhd', '4k', 'web', 'dl', 'webdl', 'webrip', 'bluray', 'brrip', 'hdrip', 'dvdrip',
  'online', 'watch', 'full', 'movie', 'film', 'series', 'tv', 'season', 'episode', 'part', 'complete', 'arabic', 'subbed', 'dubbed',
  '480p', '720p', '1080p', '2160p',
]);

const fold = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '');

const latinWords = (s) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !NOISE.has(w));

/** {season, year, kind} من عنوان المصدر. */
export function readTitle(title) {
  const t = String(title ?? '').replace(/[أإآ]/g, 'ا').replace(/ـ/g, '');
  let season = null;
  const num = t.match(/الموسم\s*(\d{1,2})/) ?? t.match(/season\s*(\d{1,2})/i) ?? t.match(/\bS(\d{1,2})(?:E\d+)?\b/i);
  if (num) season = Number(num[1]);
  else {
    const after = t.match(/الموسم\s+(ال\S+(?:\s+عشر)?)/);
    if (after) season = ORDINALS[after[1]] ?? null;
  }
  const y = t.match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/);
  // «سلسلة أفلام X كاملة» صفحة تجميع لا عمل واحد
  if (/سلسلة\s+افلام|\bcollection\b/i.test(t)) return { season: null, year: y ? Number(y[1]) : null, kind: 'collection' };
  const kind = /(^|\s)فيلم(\s|$)/.test(t) ? 'movie' : /(^|\s)(مسلسل|الموسم|الحلقة)(\s|$)/.test(t) || season ? 'series' : null;
  return { season, year: y ? Number(y[1]) : null, kind };
}

/** 0..1: تطابق الكلمات اللاتينية (بلا السنة ولا رقم الموسم). */
export function titleScore(wanted, sourceTitle) {
  const strip = (words) => words.filter((w) => !/^(19|20)\d{2}$/.test(w) && !/^s\d{1,2}(e\d+)?$/.test(w));
  const a = strip(latinWords(wanted));
  const b = strip(latinWords(sourceTitle));
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 1;
  const sb = new Set(b);
  const common = a.filter((w) => sb.has(w)).length;
  // كل كلمات المطلوب موجودة وزيادة المصدر كلمة واحدة: غالبًا نفس العمل بلاحقة
  if (common === a.length && b.length - a.length <= 1) return 0.9;
  return common / Math.max(a.length, b.length);
}

/** أفضل تطابق بين أسماء العمل (اسمه وأسماؤه البديلة) وعنوان المصدر. */
export function namesScore(names, sourceTitle) {
  let best = 0;
  for (const n of names) if (n) best = Math.max(best, titleScore(n, sourceTitle));
  return best;
}

/**
 * حكمٌ على نسخة واحدة لعمل محدد الهوية، مع سبب الرفض (لتتبّع المطابقة).
 *
 * الاسم وحده ليس هوية: «Shameless» اسم لمسلسل 2011 الأمريكي، و2004 البريطاني،
 * و2017 الروسي، وفيلم 2012. فالنسخة تُقبل بالاسم ثم بما يحدد العمل نفسه:
 *   - النوع (فيلم/مسلسل)، والموسم المطلوب.
 *   - السنة إن كتبها المصدر: سنة الفيلم (±1)، أو سنة الموسم/مدة عرض المسلسل،
 *     ولا تُقبل سنة بداية عملٍ آخر بنفس الاسم (`namesakeYears`).
 *   - نسخة بلا سنة طابقت اسمًا يحمله أكثر من عمل (`sharedNames`) تُعطى للأشهر
 *     منها وحده (`primary`)، وغيره يحتاجها باسمه الخاص أو بسنته في العنوان.
 *
 * يرجع {ok, score, reason}: reason ∈ kind | collection | title | year |
 * year-unconfirmed | season | ambiguous.
 */
export function judgeCopy(c, criteria, minScore = 0.85) {
  const { title, aliases = [], year = null, type = 'movie', season = null } = criteria;
  const info = readTitle(c.title);
  if (info.kind === 'collection') return { ok: false, score: 0, reason: 'collection' };
  if (info.kind && info.kind !== type) return { ok: false, score: 0, reason: 'kind' };
  let score = namesScore([title, ...aliases], c.title);
  // اسم ضعيف («Dune» من «Dune: Part One»): يُقبل فقط بنفس السنة مكتوبة في العنوان
  if (score < minScore && criteria.weakAliases?.length) {
    const weak = namesScore(criteria.weakAliases, c.title);
    if (weak >= minScore && year && info.year === year) score = Math.min(weak, 0.99);
  }
  if (score < minScore) return { ok: false, score, reason: 'title' };
  const others = (criteria.namesakeYears ?? []).filter((y) => y !== year);
  if (type === 'movie') {
    if (year && info.year && Math.abs(info.year - year) > 1) return { ok: false, score, reason: 'year' };
    if (info.year && info.year !== year && others.includes(info.year)) return { ok: false, score, reason: 'year' };
    // فيلم بكلمة زائدة («Dune» مقابل «Dune Part Two») غالبًا جزء آخر: لا يُقبل إلا بنفس السنة تمامًا
    if (score < 1 && !(info.year && year && info.year === year)) return { ok: false, score, reason: 'year-unconfirmed' };
  } else {
    if (info.year && !seriesYearFits(info.year, criteria, others)) return { ok: false, score, reason: 'year' };
    // مسلسل بكلمة زائدة («Dark» مقابل «Dark Hearts»، «The Office» مقابل «The Office Movers») عملٌ آخر غالبًا:
    // لا يُقبل إلا بسنة مكتوبة تطابقه
    if (score < 1 && !info.year) return { ok: false, score, reason: 'year-unconfirmed' };
    if (season != null) {
      const s = info.season ?? (c.seasonNumber > 0 ? c.seasonNumber : null);
      if (s != null ? s !== season : !c.hasSeasons && season !== 1) return { ok: false, score, reason: 'season' };
    }
  }
  if (!info.year && criteria.primary === false && criteria.sharedNames?.length) {
    const own = [title, ...aliases].filter((n) => n && !criteria.sharedNames.includes(n));
    if (namesScore(own, c.title) < minScore) return { ok: false, score, reason: 'ambiguous' };
  }
  return { ok: true, score: score + (info.year && year && info.year === year ? 0.05 : 0), reason: null };
}

/** سنة مكتوبة في عنوان نسخة مسلسل: سنة الموسم المطلوب، أو ضمن مدة عرضه وليست بداية عملٍ آخر بنفس الاسم. */
function seriesYearFits(y, { year = null, endYear = null, season = null, seasonYears = {} }, others) {
  // سنة الموسم من تواريخ الحلقات؛ تاريخ خارج مدة العرض بيانات خاطئة فيُهمل
  const sy = season != null ? seasonYears[season] : null;
  const sane = sy && (!year || (sy >= year - 1 && sy <= (endYear ?? sy) + 1));
  if (sane && Math.abs(y - sy) <= 1) return true;
  if (year && y === year) return true;
  if (others.includes(y)) return false;
  if (!year) return true;
  return y >= year - 1 && y <= (endYear ?? new Date().getFullYear()) + 1;
}

/**
 * النسخ المطابقة من نتائج المحرك (أعمال مدموجة أو نسخ مسطّحة)، الأقوى أولًا.
 * `season`: للمسلسل؛ نسخة بلا رقم موسم تُقبل للموسم الأول فقط.
 */
export function pickCopies(works, criteria, minScore = 0.85) {
  return explainCopies(works, criteria, minScore).filter((x) => x.ok).sort((a, b) => b.score - a.score).map((x) => x.copy);
}

/** كل نسخة مع حكمها (المقبول والمرفوض وسببه)، بلا تكرار. */
export function explainCopies(works, criteria, minScore = 0.85) {
  const copies = works.flatMap((w) => w.copies ?? [w]);
  const seen = new Set();
  const out = [];
  for (const c of copies) {
    const key = `${c.sourceId}|${c.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ copy: c, ...judgeCopy(c, criteria, minScore) });
  }
  return out;
}

const SEASON_WORDS = ['', 'الاول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];

/**
 * نصوص البحث في المصادر. للمسلسل «العنوان الموسم الاول» أولًا: بحث المصادر
 * بالاسم وحده يعيد غالبًا آخر المواسم فقط (Shameless: التاسع والعاشر). ثم
 * العنوان كما هو، ثم بلا علامات، ثم الأسماء البديلة بنفس الترتيب.
 */
export function queriesFor(title, { season = null, type = null, aliases = [] } = {}) {
  const out = [];
  const add = (t) => {
    const s = String(t ?? '').trim();
    if (!s) return;
    if (type === 'series' && season > 0) out.push(`${s} الموسم ${SEASON_WORDS[season] ?? season}`);
    out.push(s);
    const plain = s.replace(/[:–—-].*$/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (plain) out.push(plain);
  };
  add(title);
  for (const a of aliases) add(a);
  return [...new Set(out)];
}
