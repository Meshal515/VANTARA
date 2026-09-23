import { describe, expect, it } from 'vitest';
import { STATUS_BY_SMANGA, detailFields, seriesRefOf, toV35Work } from './works.js';

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
