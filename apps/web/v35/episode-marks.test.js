import { describe, expect, it } from 'vitest';
import { applyLocalMarks, changedKeys, cinemaEpisodeKey, cinemaLocalKey, seenFrom, selectEpisodes, syncOps } from './episode-marks.js';
import { createAnimeAccount } from './anime-account.js';

describe('selectEpisodes', () => {
  it('حلقة واحدة، ونطاق بأي ترتيب، وكل ما قبلها، والموسم كله', () => {
    expect(selectEpisodes('one', { a: 7, total: 12 })).toEqual([7]);
    expect(selectEpisodes('range', { a: 9, b: 4, total: 12 })).toEqual([4, 5, 6, 7, 8, 9]);
    expect(selectEpisodes('upto', { a: 3, total: 12 })).toEqual([1, 2, 3]);
    expect(selectEpisodes('season', { total: 5 })).toEqual([1, 2, 3, 4, 5]);
  });
  it('يقصّ على حدود الموسم ويقبل مدخلات نصية', () => {
    expect(selectEpisodes('range', { a: '0', b: '99', total: 4 })).toEqual([1, 2, 3, 4]);
    expect(selectEpisodes('one', { a: 'x', total: 4 })).toEqual([1]);
    expect(selectEpisodes('season', { total: 0 })).toEqual([]);
    expect(selectEpisodes('nope', { total: 4 })).toEqual([]);
  });
  it('موسم طويل (1180 حلقة) بلا مشكلة', () => {
    expect(selectEpisodes('season', { total: 1180 })).toHaveLength(1180);
  });
});

describe('applyLocalMarks: لا يُفقد تقدم موجود', () => {
  it('التعليم يضع done ويُبقي موضع التوقف والمدة', () => {
    const eps = { 3: { position: 120_000, duration: 1_400_000, done: false, at: 5 } };
    expect(applyLocalMarks(eps, ['1', '2', '3'], true, 99)).toBe(3);
    expect(eps[3]).toEqual({ position: 120_000, duration: 1_400_000, done: true, at: 5 });
    expect(eps[1]).toEqual({ position: 0, duration: 0, done: true, at: 99 });
  });
  it('الإلغاء يُبقي التقدم ويحذف العلامة المجردة فقط', () => {
    const eps = { 1: { position: 0, duration: 0, done: true, at: 1 }, 2: { position: 300, duration: 900, done: true } };
    expect(applyLocalMarks(eps, ['1', '2', '4'], false)).toBe(2);
    expect(eps[1]).toBeUndefined();
    expect(eps[2]).toEqual({ position: 300, duration: 900, done: false });
  });
  it('لا يغيّر ما هو بالحالة المطلوبة أصلًا (idempotent)', () => {
    const eps = { '1:1': { position: 10, duration: 20, done: true } };
    const before = structuredClone(eps);
    expect(applyLocalMarks(eps, ['1:1'], true)).toBe(0);
    expect(eps).toEqual(before);
  });
  it('مفاتيح السينما بالموسم: موسمان لا يتداخلان', () => {
    const eps = {};
    applyLocalMarks(eps, [1, 2].map((n) => cinemaLocalKey(1, n)), true, 1);
    applyLocalMarks(eps, [1].map((n) => cinemaLocalKey(2, n)), true, 1);
    expect(Object.keys(eps).sort()).toEqual(['1:1', '1:2', '2:1']);
    applyLocalMarks(eps, [cinemaLocalKey(1, 1), cinemaLocalKey(1, 2)], false);
    expect(Object.keys(eps)).toEqual(['2:1']);
  });
});

describe('التزامن', () => {
  it('دفعات chapter.markMany بحد 2000 ومرجع العمل', () => {
    const keys = Array.from({ length: 4500 }, (_, i) => cinemaEpisodeKey('tt1', 1, i + 1));
    const ops = syncOps('cinema:tt1', keys, true);
    expect(ops.map((o) => o.payload.keys.length)).toEqual([2000, 2000, 500]);
    expect(ops[0]).toMatchObject({ op: 'chapter.markMany', payload: { seriesRef: 'cinema:tt1', read: true } });
    expect(ops[0].payload.keys[0]).toBe('cinema:tt1#ep:1:1');
  });
  it('changedKeys يرسل ما يتغيّر فقط', () => {
    const seen = new Set(['a']);
    expect(changedKeys(['a', 'b'], (k) => seen.has(k), true)).toEqual(['b']);
    expect(changedKeys(['a', 'b'], (k) => seen.has(k), false)).toEqual(['a']);
  });
  it('صف الحساب هو المرجع (يشمل الإلغاء)، وإلا سجل الجهاز القديم', () => {
    expect(seenFrom({ read: 0 }, { done: true })).toBe(false);
    expect(seenFrom({ read: 1 }, null)).toBe(true);
    expect(seenFrom(null, { done: true })).toBe(true);
    expect(seenFrom(undefined, undefined)).toBe(false);
  });
  it('تعليم ثم إلغاء نطاق في حساب الأنمي يمرّ بنفس جدول chapter_marks', () => {
    const marks = new Map();
    const ops = [];
    const sync = {
      user: { userId: 'u' },
      rows: (t, f) => (t === 'chapter_marks' ? [...marks.values()] : []).filter(f),
      row: (t, k) => marks.get(k) ?? null,
      enqueue: (op, p) => {
        ops.push(op);
        for (const k of p.keys ?? [p.chapterKey]) marks.set(`u/${k}`, { user_id: 'u', chapter_key: k, series_ref: p.seriesRef, read: p.read ? 1 : 0 });
      },
    };
    const a = createAnimeAccount(sync);
    const m = { id: 21, title: 'x' };
    expect(a.markRange(m, 1, 1180, true)).toBe(1180);
    expect(a.seenCount(21)).toBe(1180);
    expect(a.markRange(m, 1, 1180, true)).toBe(0);
    expect(a.markRange(m, 1001, 1180, false)).toBe(180);
    expect(a.seenCount(21)).toBe(1000);
    expect(ops.every((o) => o === 'chapter.markMany')).toBe(true);
  });
});
