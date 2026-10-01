import { describe, expect, it } from 'vitest';
import { createFeedSnapshot } from './feed-snapshot.js';

describe('stable feeds', () => {
  it('queues background additions and reordered ranks while keeping visible canonical cards in place', () => {
    const feed = createFeedSnapshot();
    const first = [{ id: 'lookism', chapters: 627 }, { id: 'b' }, { id: 'c' }];
    expect(feed.accept(first)).toEqual(first);
    expect(feed.accept([{ id: 'x' }, { id: 'c' }, { id: 'lookism', chapters: 628 }, { id: 'b' }]).map((x) => x.id)).toEqual(['lookism', 'b', 'c']);
    expect(feed.items[0].chapters).toBe(628);
    expect(feed.pending).toBe(1);
    expect(feed.refresh().map((x) => x.id)).toEqual(['x', 'c', 'lookism', 'b']);
  });
  it('explicit pagination appends without moving existing cards or duplicating a canonical work', () => {
    const feed = createFeedSnapshot();
    feed.accept([{ id: 'a' }, { id: 'b' }]);
    expect(feed.accept([{ id: 'b', updated: true }, { id: 'c' }, { id: 'a' }, { id: 'c' }], { append: true }).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});
