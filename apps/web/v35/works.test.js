import { describe, expect, it } from 'vitest';
import { STATUS_BY_SMANGA, detailFields, editionRows, isFiller, localizeFiller, seriesRefOf, sourceLabel, sourceRank, toV35Work } from './works.js';
import { mergeChapters } from '../lib/catalog.js';

/**
 * أعمال المحرّك بشكل v35.
 *
 * واجهة v35 كُتبت على `Media` من AniList (`title.english`، `coverImage`،
 * `genres`، `status`…). المصدر هنا مصادرنا العربية لا AniList، فالمحوّل يبني
 * نفس الشكل من نفس الحقائق — ولا يخترع ما لم يقله المصدر (تقييم، شعبية).
 */
describe('v35 work shape', () => {
  const work = {
    key: 'ون بيس',
    title: 'ون بيس',
    thumbnailUrl: 'https://c/one-piece.webp',
    editions: [{ sourceId: 'pkg.teamx', label: 'Team X', manga: { url: '/m/1', title: 'ون بيس' } }],
  };

  it('carries title, cover and editions the way v35 cards read them', () => {
    const w = toV35Work(work);
    expect(w.id).toBe(seriesRefOf(work));
    expect(w.title.english).toBe('ون بيس');
    expect(w.coverImage.large).toBe('https://c/one-piece.webp');
    expect(w.bannerImage).toBe('https://c/one-piece.webp');
    expect(w._work).toBe(work);
  });

  it('never invents a score or popularity the source did not give', () => {
    const w = toV35Work(work);
    expect(w.averageScore).toBeNull();
    expect(w.popularity).toBeNull();
  });

  it('series refs are stable for the same title and differ between works', () => {
    expect(seriesRefOf(work)).toBe(seriesRefOf({ ...work, editions: [] }));
    expect(seriesRefOf(work)).not.toBe(seriesRefOf({ ...work, key: 'ناروتو' }));
    expect(seriesRefOf(work).startsWith('ext:')).toBe(true);
  });

  it('maps tachiyomi status codes to v35 statuses', () => {
    expect(STATUS_BY_SMANGA[1]).toBe('RELEASING');
    expect(STATUS_BY_SMANGA[2]).toBe('FINISHED');
    expect(STATUS_BY_SMANGA[6]).toBe('HIATUS');
    expect(STATUS_BY_SMANGA[5]).toBe('CANCELLED');
  });

  it('details fill genres, status, staff and description from the source', () => {
    const d = detailFields({
      description: 'قصة القراصنة',
      genre: 'أكشن, مغامرة ,  ',
      status: 1,
      author: 'أودا',
      artist: 'أودا',
    });
    expect(d.description).toBe('قصة القراصنة');
    expect(d.genres).toEqual(['أكشن', 'مغامرة']);
    expect(d.status).toBe('RELEASING');
    expect(d.staff.edges.map((e) => e.role)).toEqual(['Story', 'Art']);
  });

  it('a source without details leaves the fields empty, not guessed', () => {
    const d = detailFields({});
    expect(d.genres).toEqual([]);
    expect(d.status).toBeNull();
    expect(d.staff.edges).toEqual([]);
  });
});

/**
 * العربي أولًا. عملٌ عنده 22 فصلًا بالعربي و72 بالإنجليزي: الفصول 1–22 عربية
 * دائمًا، و23–72 تملؤها الإنجليزية، ونزول الفصل العربي 23 بعدها يغلبها.
 * خطأٌ هنا يقلب العمل فوق تحت، فالقاعدة مختبرة رقمًا رقمًا.
 */
describe('English fills only what Arabic lacks', () => {
  const chapters = (from, to, tag) => Array.from({ length: to - from + 1 }, (_, i) => ({ name: `${tag} ${from + i}`, chapterNumber: from + i, url: `/${tag}/${from + i}` }));
  const english = { sourceId: 'eu.kanade.tachiyomi.extension.all.mangadex@en', label: 'MangaDex', chapters: chapters(1, 72, 'en') };
  const arabic = (to) => ({ sourceId: 'eu.kanade.tachiyomi.extension.ar.teamx', label: 'Team X', chapters: chapters(1, to, 'ar') });
  const from = (list, n) => list.find((c) => c.number === n).sourceId;

  it('filler ids are recognised and always rank after every Arabic source', () => {
    expect(isFiller(english.sourceId)).toBe(true);
    expect(isFiller('eu.kanade.tachiyomi.extension.all.mangadex')).toBe(false);
    expect(sourceRank(english.sourceId)).toBeGreaterThan(sourceRank('some.unknown.arabic.source'));
  });

  it('Arabic 1–22 stay Arabic even though English has more chapters; 23–72 come from English', () => {
    const merged = mergeChapters([english, arabic(22)], { rank: sourceRank });
    expect(merged).toHaveLength(72);
    for (let n = 1; n <= 22; n += 1) expect(from(merged, n)).toBe(arabic(22).sourceId);
    for (let n = 23; n <= 72; n += 1) expect(from(merged, n)).toBe(english.sourceId);
  });

  it('an Arabic chapter released later replaces the English one with the same number', () => {
    const merged = mergeChapters([english, arabic(30)], { rank: sourceRank });
    expect(from(merged, 23)).toBe(arabic(30).sourceId);
    expect(from(merged, 30)).toBe(arabic(30).sourceId);
    expect(from(merged, 31)).toBe(english.sourceId);
    expect(merged).toHaveLength(72);
  });

  it('an English chapter reads as «الفصل 23», with no source name, and keeps its language for translation', () => {
    const row = localizeFiller(mergeChapters([english, arabic(22)], { rank: sourceRank })).find((c) => c.number === 23);
    expect(row.chapter.name).toBe('الفصل 23');
    expect(row.chapter.originalName).toBe('en 23');
    expect(row.label).toBeNull();
    expect(row.lang).toBe('en');
    const ar = localizeFiller(mergeChapters([english, arabic(22)], { rank: sourceRank })).find((c) => c.number === 5);
    expect(ar.chapter.name).toBe('ar 5');
  });

  it('with no English edition nothing changes', () => {
    expect(mergeChapters([arabic(22)], { rank: sourceRank })).toHaveLength(22);
  });

  it('several English sources: the better one fills each chapter, and all stay after Arabic', () => {
    const weeb = { sourceId: 'eu.kanade.tachiyomi.extension.en.weebcentral@en', label: 'Weeb Central', chapters: chapters(1, 60, 'wc') };
    const here = { sourceId: 'eu.kanade.tachiyomi.extension.en.mangahere@en', label: 'Mangahere', chapters: chapters(1, 80, 'mh') };
    const ids = [weeb, english, here].map((e) => e.sourceId);
    expect(ids.map(sourceRank)).toEqual([...ids.map(sourceRank)].sort((a, b) => a - b));
    for (const id of ids) expect(sourceRank(id)).toBeGreaterThan(sourceRank('some.unknown.arabic.source'));
    const merged = mergeChapters([here, english, weeb, arabic(22)], { rank: sourceRank });
    expect(merged).toHaveLength(80);
    expect(from(merged, 22)).toBe(arabic(22).sourceId);
    expect(from(merged, 23)).toBe(weeb.sourceId);
    expect(from(merged, 61)).toBe(english.sourceId);
    expect(from(merged, 75)).toBe(here.sourceId);
  });

  it('you can switch to an English source: its chapters read «الفصل N», labelled English, and still get translated', () => {
    const work = { _editions: [arabic(22), english] };
    const rows = editionRows(work, english.sourceId);
    expect(rows).toHaveLength(72);
    const first = rows.find((r) => r.number === 1);
    expect(first.chapter.name).toBe('الفصل 1');
    expect(first.label).toBe('MangaDex · إنجليزي');
    expect(first.lang).toBe('en');
    expect(sourceLabel({ sourceId: arabic(22).sourceId, label: 'Team X' })).toBe('Team X');
  });
});
