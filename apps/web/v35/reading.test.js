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

  it('auto marks at 20 percent of the chapter, once', () => {
    expect(AUTO_READ_RATIO).toBe(0.2);
    expect(shouldAutoMark({ ratio: 0.19, alreadyRead: false })).toBe(false);
    expect(shouldAutoMark({ ratio: 0.2, alreadyRead: false })).toBe(true);
    expect(shouldAutoMark({ ratio: 0.8, alreadyRead: true })).toBe(false);
  });
});
