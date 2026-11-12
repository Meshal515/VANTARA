import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_READ_RATIO, chapterKeyOf, isChapterRead, markChapter, shouldAutoMark, _resetPending } from './reading.js';

/**
 * عين الفصل.
 *
 * السؤال: هل تعلّم قراءة ٢٠٪ من الفصل ١٧ الفصلَ ١٧ وحده؟ وهل تُلغى العلامة
 * بلمسة؟ وهل يرى القارئ علامته فورًا قبل أن يعود الخادم؟
 */
function fakeSync(rows = []) {
  const ops = [];
  return {
    user: { userId: 'me' },
    ops,
    rows: (table, pred) => (table === 'chapter_marks' ? rows.filter(pred) : []),
    enqueue: (kind, payload) => ops.push({ kind, payload }),
  };
}

const row = (n, extra = {}) => ({ sourceId: 'pkg', chapter: { url: `/c/${n}`, name: `الفصل ${n}`, chapterNumber: n }, ...extra });

describe('chapter read state', () => {
  beforeEach(() => _resetPending());

  it('keys a chapter by its number so the same chapter from two sources is one', () => {
    expect(chapterKeyOf('ext:w', row(17))).toBe(chapterKeyOf('ext:w', { ...row(17), sourceId: 'other' }));
    expect(chapterKeyOf('ext:w', row(17))).not.toBe(chapterKeyOf('ext:w', row(18)));
  });

  it('a chapter without a number is keyed by its source and url', () => {
    const a = chapterKeyOf('ext:w', { sourceId: 'pkg', chapter: { url: '/x', name: 'خاص', chapterNumber: -1 } });
    expect(a).toContain('pkg');
    expect(a).toContain('/x');
  });

  it('keys stay within the server limit even for long titles', () => {
    expect(chapterKeyOf(`ext:${'ع'.repeat(400)}`, row(1)).length).toBeLessThanOrEqual(200);
  });

  it('reads the mirror, owner rows only', () => {
    const key = chapterKeyOf('ext:w', row(3));
    const sync = fakeSync([
      { user_id: 'me', chapter_key: key, read: 1 },
      { user_id: 'friend', chapter_key: chapterKeyOf('ext:w', row(4)), read: 1 },
    ]);
    expect(isChapterRead(sync, 'ext:w', key)).toBe(true);
    expect(isChapterRead(sync, 'ext:w', chapterKeyOf('ext:w', row(4)))).toBe(false);
  });

  it('marking shows at once and sends exactly one op for that chapter', () => {
    const sync = fakeSync();
    markChapter(sync, 'ext:w', row(17), true);
    const key = chapterKeyOf('ext:w', row(17));
    expect(isChapterRead(sync, 'ext:w', key)).toBe(true);
    expect(sync.ops).toEqual([{ kind: 'chapter.mark', payload: { seriesRef: 'ext:w', chapterKey: key, read: true } }]);
    // الفصول الأخرى لا تتأثّر
    expect(isChapterRead(sync, 'ext:w', chapterKeyOf('ext:w', row(16)))).toBe(false);
  });

  it('unmarking beats an older read row in the mirror', () => {
    const key = chapterKeyOf('ext:w', row(2));
    const sync = fakeSync([{ user_id: 'me', chapter_key: key, read: 1 }]);
    markChapter(sync, 'ext:w', row(2), false);
    expect(isChapterRead(sync, 'ext:w', key)).toBe(false);
  });

  it('auto marks only after most of the chapter was actually read, once', () => {
    expect(shouldAutoMark({ ratio: 0.19, alreadyRead: false })).toBe(false);
    // 20% من الفصل تكفي: الفصل مقروء حتمًا
    expect(shouldAutoMark({ ratio: 0.2, alreadyRead: false })).toBe(true);
    expect(shouldAutoMark({ ratio: 0.9, alreadyRead: false })).toBe(true);
    expect(shouldAutoMark({ ratio: 0.8, alreadyRead: true })).toBe(false);
  });
});

// #323 U-21: نظرة على فصل قديم لا تقلب «تابع»
import { continueChapter } from './reading.js';
describe('continue point', () => {
  const ch = (n) => ({ number: n, key: `c${n}` });
  const ordered = [ch(335), ch(336), ch(337), ch(385), ch(386), ch(387)];
  const keyOf = (row, c) => row.chapter_key === c.key;
  const row = (n, ratio, at) => ({ chapter_key: `c${n}`, ratio, updated_at: at });
  it('a short look back at an older chapter keeps the furthest chapter', () => {
    expect(continueChapter([row(386, 0.4, 100), row(337, 0.05, 200)], ordered, keyOf).number).toBe(386);
  });
  it('really re-reading an older chapter (half or more) moves «continue» there', () => {
    expect(continueChapter([row(386, 0.4, 100), row(337, 0.6, 200)], ordered, keyOf).number).toBe(337);
  });
  it('the latest reading ahead of everything wins, and a finished chapter goes to the next', () => {
    expect(continueChapter([row(337, 1, 100), row(386, 0.3, 200)], ordered, keyOf).number).toBe(386);
    expect(continueChapter([row(386, 0.99, 200)], ordered, keyOf).number).toBe(387);
  });
  it('nothing usable: null', () => {
    expect(continueChapter([], ordered, keyOf)).toBeNull();
    expect(continueChapter([row(1, 0.5, 1)], ordered, keyOf)).toBeNull();
  });
});

// #323 U-29: التمرير السريع لا يعلّم الفصول مقروءة
describe('auto mark needs real reading time', () => {
  it('a 3-second fly-through of a 40-page chapter is not «read»', () => {
    expect(shouldAutoMark({ ratio: 1, alreadyRead: false, readMs: 3000, pages: 40 })).toBe(false);
  });
  it('real reading of the first fifth marks it', () => {
    expect(shouldAutoMark({ ratio: 0.2, alreadyRead: false, readMs: 30_000, pages: 40 })).toBe(true);
  });
  it('long chapters need proportionally more time (¼ s per page, at least 5 s)', () => {
    expect(shouldAutoMark({ ratio: 0.5, alreadyRead: false, readMs: 9_000, pages: 60 })).toBe(false);
    expect(shouldAutoMark({ ratio: 0.5, alreadyRead: false, readMs: 15_000, pages: 60 })).toBe(true);
    expect(shouldAutoMark({ ratio: 0.5, alreadyRead: false, readMs: 4_000, pages: 4 })).toBe(false);
  });
});
