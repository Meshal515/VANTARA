import { describe, expect, it } from 'vitest';
import { alignPairs, learnedChapter, pickLessonChapter, rememberLearned } from './translate-learn.js';

const row = (number, lang, sourceId = lang) => ({ number, lang, sourceId, chapter: { url: `${sourceId}/${number}` } });

describe('lesson chapter: the latest chapter both editions have', () => {
  it('picks the highest number present in an Arabic and an English row', () => {
    const rows = [row(1, 'ar'), row(2, 'ar'), row(33, 'ar'), row(1, 'en'), row(33, 'en'), row(70, 'en')];
    const lesson = pickLessonChapter(rows);
    expect(lesson?.number).toBe(33);
    expect(lesson?.arabic.lang).toBe('ar');
    expect(lesson?.english.lang).toBe('en');
  });

  it('returns null when only one edition exists', () => {
    expect(pickLessonChapter([row(1, 'en'), row(2, 'en')])).toBeNull();
    expect(pickLessonChapter([])).toBeNull();
  });

  it('treats rows without a language as Arabic (the app only lists Arabic and English filler)', () => {
    const lesson = pickLessonChapter([row(5, undefined, 'azora'), row(5, 'en')]);
    expect(lesson?.arabic.sourceId).toBe('azora');
  });
});

describe('page alignment: spread pairs along the chapter, skip cover and credits', () => {
  it('aligns different page counts by ratio', () => {
    const pairs = alignPairs(70, 33, 5);
    expect(pairs).toHaveLength(5);
    for (const [e, a] of pairs) {
      expect(e).toBeGreaterThanOrEqual(1);
      expect(e).toBeLessThanOrEqual(68);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(31);
      expect(Math.abs(e / 69 - a / 32)).toBeLessThan(0.06);
    }
  });

  it('never repeats an index and gives up on tiny chapters', () => {
    const pairs = alignPairs(4, 4, 5);
    expect(new Set(pairs.map(([e]) => e)).size).toBe(pairs.length);
    expect(alignPairs(1, 40)).toEqual([]);
  });
});

describe('learned memory per work', () => {
  it('remembers the chapter a work was learned from', () => {
    const m = new Map();
    const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
    expect(learnedChapter('ext:x', storage)).toBeNull();
    rememberLearned('ext:x', 33, storage);
    expect(learnedChapter('ext:x', storage)).toBe(33);
  });
});
