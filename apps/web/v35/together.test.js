import { describe, expect, it } from 'vitest';
import { kindLabel, positionLabel, stateLabel, statusToast, stripPeople } from './together.js';

describe('Together UI copy', () => {
  it('names the room type the way the invite card shows it', () => {
    expect(kindLabel({ kind: 'anime' }, 'sync')).toBe('مشاهدة معًا · متزامنة');
    expect(kindLabel({ kind: 'cinema' }, 'free')).toBe('مشاهدة معًا · منفصلة');
    expect(kindLabel({ kind: 'manga' }, 'sync')).toBe('قراءة معًا · متزامنة');
  });

  it('turns state changes into short alerts, and ignores the noisy ones', () => {
    expect(statusToast({ name: 'دحمي', state: 'playing' }, 'anime')).toBe('اشتغل الفيديو عند دحمي');
    expect(statusToast({ name: 'مشعل', state: 'failed', source: 'okru' }, 'anime')).toBe('تعذّر تشغيل السيرفر عند مشعل (okru)');
    expect(statusToast({ name: 'دحمي', state: 'playing' }, 'manga')).toBe('دحمي بدأ القراءة');
    expect(statusToast({ name: 'دحمي', state: 'buffering' })).toBeNull();
    expect(stateLabel('preparing', 'anime')).toBe('جاري تجهيز الحلقة…');
    expect(stateLabel('preparing', 'manga')).toBe('جاري تجهيز الفصل…');
  });

  it('shows three faces then +N, host first', () => {
    const roster = [1, 2, 3, 4, 5].map((i) => ({ userId: `u${i}`, host: i === 4, joinedAt: i }));
    const { shown, more } = stripPeople(roster);
    expect(shown.map((r) => r.userId)).toEqual(['u4', 'u1', 'u2']);
    expect(more).toBe(2);
  });

  it('labels where each person is: page + chapter for manga, clock for video', () => {
    expect(positionLabel({ pos: 11, mediaKey: 'manga:ext:solo#110' }, { kind: 'manga' }, 0)).toBe('صفحة 12 · الفصل 110');
    expect(positionLabel({ pos: 724_000, at: 1_000, state: 'playing' }, { kind: 'anime' }, 4_000)).toBe('12:07');
    expect(positionLabel({ pos: null }, { kind: 'anime' }, 0)).toBe('');
  });
});
