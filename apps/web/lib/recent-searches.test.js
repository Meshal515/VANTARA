import { describe, expect, it } from 'vitest';
import { pushRecent, recentStore } from './recent-searches.js';

describe('آخر ما بحثت عنه', () => {
  it('البحث النهائي يمحو بادئاته («Kar»، «Karie») ولا يتكرّر', () => {
    let list = [];
    list = pushRecent(list, 'Kar');
    list = pushRecent(list, 'Karie');
    list = pushRecent(list, 'Kariel');
    expect(list).toEqual(['Kariel']);
    list = pushRecent(list, 'Black Haze');
    list = pushRecent(list, 'kariel');
    expect(list).toEqual(['kariel', 'Black Haze']);
  });
  it('يتجاهل الفارغ والحرف الواحد، ويقف عند ثمانية', () => {
    expect(pushRecent(['a1'], ' ')).toEqual(['a1']);
    expect(pushRecent(['a1'], 'x')).toEqual(['a1']);
    let list = [];
    for (let i = 0; i < 12; i++) list = pushRecent(list, `w${i}x`);
    expect(list).toHaveLength(8);
    expect(list[0]).toBe('w11x');
  });
  it('المخزن يقرأ ويكتب ويحذف بلا أن يكسره تخزين تالف', () => {
    const map = new Map([['k', 'not json']]);
    const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
    const store = recentStore('k', storage);
    expect(store.list()).toEqual([]);
    store.remember('Frieren');
    store.remember('One Piece');
    expect(store.list()).toEqual(['One Piece', 'Frieren']);
    store.remove('frieren');
    expect(store.list()).toEqual(['One Piece']);
    store.clear();
    expect(store.list()).toEqual([]);
  });
});
