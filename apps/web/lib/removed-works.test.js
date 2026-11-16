import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRemovedAny, isRemovedKey, removeWorkEverywhere, restoreRemovedWork, setRemovedSource, workToken } from './removed-works.js';
import { normalize as cinemaWork } from './cinema-meta.js';
import { normalize as animeWork } from './anime-meta.js';

afterEach(() => setRemovedSource([]));

describe('العمل المحذوف من التطبيق', () => {
  it('البصمة ثابتة وتتجاهل ext: والمسافات، ولا تكشف المفتاح', () => {
    expect(workToken('ext:abc')).toBe(workToken(' abc '));
    expect(workToken('abc')).toMatch(/^[0-9a-f]{28}$/);
    expect(workToken('abc')).not.toContain('abc');
  });
  it('يختفي من قوائم السينما والأنمي وتفاصيلها، ويعود بالإعادة', () => {
    const rows = [{ token: workToken('cinema:tt0137523'), active: 1 }, { token: workToken('anime:21'), active: 1 }];
    setRemovedSource(() => rows);
    expect(cinemaWork({ id: 'tt0137523', name: 'Fight Club', type: 'movie' })).toBeNull();
    expect(cinemaWork({ id: 'tt0111161', name: 'Other', type: 'movie' })).not.toBeNull();
    expect(animeWork({ id: 21, title: { romaji: 'One Piece' } })).toBeNull();
    expect(isRemovedAny(['x', 'anime:21'])).toBe(true);
    rows[1] = { ...rows[1], active: 0 };
    expect(isRemovedKey('anime:21')).toBe(false);
  });
  it('الطلبات: الحذف بالبصمات والإعادة بالمفتاح', () => {
    const sync = { enqueue: vi.fn() };
    expect(removeWorkEverywhere(sync, { key: 'cinema:tt1', kind: 'cinema', keys: ['tt1'], title: 'X' })).toBe(true);
    expect(sync.enqueue).toHaveBeenCalledWith('work.remove', expect.objectContaining({ key: 'cinema:tt1', kind: 'cinema', keys: ['cinema:tt1', 'tt1'], tokens: [workToken('cinema:tt1'), workToken('tt1')] }));
    expect(removeWorkEverywhere(sync, { key: 'x', kind: 'book' })).toBe(false);
    restoreRemovedWork(sync, 'cinema:tt1');
    expect(sync.enqueue).toHaveBeenLastCalledWith('work.restore', { key: 'cinema:tt1' });
  });
});
