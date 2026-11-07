import { describe, expect, it } from 'vitest';
import { airingStatus, defaultPick, lineupOrder } from './anime-today.js';

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
