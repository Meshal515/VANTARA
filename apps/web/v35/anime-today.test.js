import { describe, expect, it } from 'vitest';
import { airingStatus, defaultPick, initialPick, lineupOrder, readTodayMemory, writeTodayMemory } from './anime-today.js';

describe('today banner memory (ready from the first frame)', () => {
  const store = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
  };
  it('round-trips the resolved banner and ignores corrupt storage', () => {
    const s = store();
    expect(readTodayMemory(s)).toBeNull();
    writeTodayMemory({ for: 7, id: 9, src: 'https://a/b.jpg', logo: 'https://a/l.png', at: 1 }, s);
    expect(readTodayMemory(s)).toEqual({ for: 7, id: 9, src: 'https://a/b.jpg', logo: 'https://a/l.png', at: 1 });
    s.setItem('vantara.anime.todayHero.v1', '{bad');
    expect(readTodayMemory(s)).toBeNull();
    expect(readTodayMemory({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
  });
  it('starts with the remembered pick only for the same default and only if it airs today', () => {
    const order = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(initialPick(order, order[1], { for: 2, id: 3, src: 'x' })).toEqual({ m: order[2], memory: { for: 2, id: 3, src: 'x' } });
    expect(initialPick(order, order[0], { for: 2, id: 3, src: 'x' })).toEqual({ m: order[0], memory: null });
    expect(initialPick(order, order[1], { for: 2, id: 99, src: 'x' })).toEqual({ m: order[1], memory: null });
    expect(initialPick(order, order[1], null)).toEqual({ m: order[1], memory: null });
  });
});

const H = 3600_000;
const now = Date.UTC(2026, 10, 7, 14, 27); // 5:27 م بتوقيت مكة
const at = (h, m = 0) => Date.UTC(2026, 10, 7, h - 3, m);

describe('today banner (owner spec)', () => {
  it('orders the lineup farthest-upcoming first, then the nearest, then aired newest first', () => {
    const items = [at(16), at(17), at(17, 30), at(18), at(19, 30)].map((airingAt, i) => ({ id: i, airingAt }));
    expect(lineupOrder(items, now).map((m) => m.airingAt)).toEqual([at(19, 30), at(18), at(17, 30), at(17), at(16)]);
  });
  it('labels each episode by distance: later, soon, now (≤5 min), aired', () => {
    expect(airingStatus(now - 60_000, now)).toMatchObject({ kind: 'aired', text: 'نزلت' });
    expect(airingStatus(now + 3 * 60_000, now)).toMatchObject({ kind: 'now', text: 'ينزل الآن' });
    expect(airingStatus(now + 33 * 60_000, now)).toMatchObject({ kind: 'soon', text: 'بعد 33 دقيقة' });
    expect(airingStatus(now + 2 * H, now)).toMatchObject({ kind: 'later', text: 'بعد ساعتين', short: 'بعد ساعتين' });
    expect(airingStatus(now + 10 * H + 15 * 60_000, now).short).toBe('بعد 10 س');
    expect(airingStatus(now + 19 * H + 19 * 60_000, now).text).toBe('بعد 19 ساعة و19 د');
  });
  it('defaults to the nearest upcoming episode, or the latest aired when nothing is left today', () => {
    const items = [at(16), at(17), at(17, 30), at(18)].map((airingAt, i) => ({ id: i, airingAt }));
    expect(defaultPick(lineupOrder(items, now), now).airingAt).toBe(at(17, 30));
    const late = Date.UTC(2026, 10, 7, 20, 0);
    expect(defaultPick(lineupOrder(items, late), late).airingAt).toBe(at(18));
  });
});
