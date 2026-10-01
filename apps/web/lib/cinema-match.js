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

/**
 * النسخ المطابقة من نتائج المحرك (أعمال مدموجة أو نسخ مسطّحة)، الأقوى أولًا.
 * `season`: للمسلسل؛ نسخة بلا رقم موسم تُقبل للموسم الأول فقط.
 */
export function pickCopies(works, { title, year = null, type = 'movie', season = null }, minScore = 0.85) {
  const copies = works.flatMap((w) => w.copies ?? [w]);
  const seen = new Set();
  const out = [];
  for (const c of copies) {
    const key = `${c.sourceId}|${c.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const info = readTitle(c.title);
    if (info.kind && info.kind !== type) continue;
    const score = titleScore(title, c.title);
    if (score < minScore) continue;
    if (type === 'movie' && year && info.year && Math.abs(info.year - year) > 1) continue;
    if (type === 'series' && season != null) {
      const s = info.season ?? (c.seasonNumber > 0 ? c.seasonNumber : null);
      if (s != null ? s !== season : season !== 1) continue;
    }
    out.push({ copy: c, score: score + (info.year && year && info.year === year ? 0.05 : 0) });
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.copy);
}

/** نصوص البحث في المصادر: العنوان كما هو، ثم بلا علامات ولا ما بعد النقطتين. */
export function queriesFor(title) {
  const t = String(title ?? '').trim();
  const plain = t.replace(/[:–—-].*$/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return [...new Set([t, plain].filter(Boolean))];
}
