/** Edition identity, separate from title similarity. Numbers in a title are not interchangeable. */
export function animeTitle(raw) {
  let base = String(raw ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) - (c <= '٩' ? 0x660 : 0x6f0)))
    .replace(/[أإآٱ]/g, 'ا').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let season = null, part = null;
  const ordinal = { الاول: 1, الثاني: 2, الثالث: 3, الرابع: 4, الخامس: 5, السادس: 6, السابع: 7, الثامن: 8, التاسع: 9, العاشر: 10 };
  const number = token => ordinal[token] ?? Number(token);
  base = base.replace(/(?:^|\s)(?:season|s|الموسم|موسم)\s*(\d{1,2}|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)(?=\s|$)/gu, (_, n) => { season = number(n); return ' '; })
    .replace(/(?:^|\s)(\d{1,2})(?:st|nd|rd|th)\s+season(?=\s|$)/g, (_, n) => { season = Number(n); return ' '; })
    .replace(/(?:^|\s)(?:part|cour|الجزء|جزء)\s*(\d{1,2}|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)(?=\s|$)/gu, (marker, n) => {
      // Arabic catalogues commonly call a season "الجزء"; when a season is
      // already explicit it identifies the part within that season instead.
      if (/جزء/u.test(marker) && season == null) season = number(n);
      else part = number(n);
      return ' ';
    });
  const roman = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  base = base.trim().replace(/\s+(ii|iii|iv|v|vi|vii|viii|ix|x)$/g, (_, n) => { season ??= roman[n]; return ''; });
  const movie = /(?:^|\s)(?:movie|movies|film|فيلم|الفيلم)(?=\s|$)/u.test(base);
  base = base.replace(/(?:^|\s)(?:movie|movies|film|فيلم|الفيلم)(?=\s|$)/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = base.split(' ');
  if (season == null && words.length > 1 && words.at(-2) !== 'no' && /^\d{1,2}$/.test(words.at(-1))) {
    season = Number(words.pop()); base = words.join(' ');
  }
  return { base, season, part, movie };
}
