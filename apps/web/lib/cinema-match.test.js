import { describe, expect, it } from 'vitest';
import { pickCopies, queriesFor, readTitle, titleScore } from './cinema-match.js';
import { normalize, seasonsOf } from './cinema-meta.js';

/**
 * السؤال: هل نجد «Inception 2010» في «فيلم Inception 2010 مترجم اون لاين»
 * ولا نأخذ «Inception 2» ولا فيلمًا بنفس الاسم من سنة أخرى؟ وهل الموسم الثاني
 * من مسلسل لا يُشغَّل من صفحة الموسم الأول؟
 */
const c = (sourceId, title, url = title) => ({ sourceId, title, url });

describe('قراءة عنوان المصدر', () => {
  it('season, year and kind', () => {
    expect(readTitle('مسلسل Dark الموسم الثاني مترجم')).toEqual({ season: 2, year: null, kind: 'series' });
    expect(readTitle('مسلسل The Office الموسم 3 كامل')).toMatchObject({ season: 3, kind: 'series' });
    expect(readTitle('Breaking Bad S05')).toMatchObject({ season: 5 });
    expect(readTitle('مسلسل Lost الموسم الحادي عشر')).toMatchObject({ season: 11 });
    expect(readTitle('فيلم Inception 2010 مترجم اون لاين')).toEqual({ season: null, year: 2010, kind: 'movie' });
    expect(readTitle('سلسلة افلام حكاية لعبة Toy Story كاملة').kind).toBe('collection');
    expect(readTitle('The Matrix Collection').kind).toBe('collection');
  });
  it('title score ignores Arabic padding, year and quality words', () => {
    expect(titleScore('Inception', 'فيلم Inception 2010 مترجم اون لاين HD')).toBe(1);
    expect(titleScore('The Dark Knight', 'فيلم The Dark Knight 2008 مترجم')).toBe(1);
    expect(titleScore('Inception', 'فيلم Bikini Inception 2015')).toBe(0.9);
    expect(titleScore('Dune: Part Two', 'فيلم Dune Part Two 2024 مترجم')).toBe(1);
    expect(titleScore('Dune', 'فيلم Dune Prophecy')).toBeLessThan(0.85 + 0.06);
  });
});

describe('اختيار النسخ', () => {
  it('movie: right year only, series pages excluded', () => {
    const works = [{ copies: [c('faselhd', 'فيلم Dune 2021 مترجم'), c('arabseed', 'فيلم Dune 1984 مترجم'), c('egydead', 'مسلسل Dune الموسم الاول')] }];
    expect(pickCopies(works, { title: 'Dune', year: 2021, type: 'movie' }).map((x) => x.sourceId)).toEqual(['faselhd']);
  });
  it('movie: an extra word is a different film unless the year matches exactly', () => {
    const works = [{ copies: [c('cimaleek', 'فيلم Toy Story 5 Part Two مترجم'), c('egydead', 'مشاهدة فيلم Toy Story 5 2026 مترجم'), c('arabseed', 'فيلم Toy Story 5 مدبلج مصري')] }];
    expect(pickCopies(works, { title: 'Toy Story 5', year: 2026, type: 'movie' }).map((x) => x.sourceId)).toEqual(['egydead', 'arabseed']);
  });
  it('series: matching season; season-less copy only for season 1', () => {
    const works = [
      { copies: [c('faselhd', 'مسلسل Dark الموسم الاول مترجم'), c('arabseed', 'مسلسل Dark الموسم الثاني مترجم')] },
      { copies: [c('cimaleek', 'مسلسل Dark مترجم')] },
    ];
    expect(pickCopies(works, { title: 'Dark', type: 'series', season: 2 }).map((x) => x.sourceId)).toEqual(['arabseed']);
    expect(pickCopies(works, { title: 'Dark', type: 'series', season: 1 }).map((x) => x.sourceId).sort()).toEqual(['cimaleek', 'faselhd']);
  });
  it('queries: as is, then without subtitle punctuation', () => {
    expect(queriesFor('Dune: Part Two')).toEqual(['Dune: Part Two', 'Dune']);
  });
});

describe('Cinemeta', () => {
  it('normalizes and orders seasons with specials last', () => {
    const m = normalize({
      id: 'tt0944947', type: 'series', name: 'Game of Thrones', imdbRating: '9.2', releaseInfo: '2011–2019',
      videos: [
        { season: 0, episode: 1, name: 'Inside' },
        { season: 1, episode: 2, name: 'Kingsroad' },
        { season: 1, episode: 1, name: 'Winter Is Coming', released: '2011-04-17T00:00:00.000Z' },
      ],
    });
    expect(m).toMatchObject({ id: 'tt0944947', type: 'series', rating: 9.2, year: 2011 });
    expect(m.seasons.map((s) => s.n)).toEqual([1, 0]);
    expect(m.seasons[0].episodes.map((e) => e.title)).toEqual(['Winter Is Coming', 'Kingsroad']);
    expect(normalize({ id: 'kitsu:1', name: 'x' })).toBeNull();
    expect(seasonsOf([])).toEqual([]);
  });
});
