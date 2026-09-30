import { describe, expect, it } from 'vitest';
import { profileTopSlots } from './profile-top.js';

describe('profile favorite positions', () => {
  const resolve = (row) => row.seriesRef;
  it('shows saved places rather than renumbering sparse favorites', () => {
    expect(profileTopSlots([{ seriesRef: 'five', position: 5 }, { seriesRef: 'one', position: 1 }, { seriesRef: 'two', position: 2 }], resolve))
      .toEqual(['one', 'two', null, null, 'five']);
  });
  it('does not turn the second choice into first place', () => {
    expect(profileTopSlots([{ seriesRef: 'two', position: 2 }], resolve)).toEqual([null, 'two', null, null, null]);
  });
  it('keeps valid positions ahead of legacy or duplicate positions', () => {
    expect(profileTopSlots([{ seriesRef: 'legacy' }, { seriesRef: 'one', position: 1 }, { seriesRef: 'duplicate', position: 1 }, { seriesRef: 'invalid', position: 9 }], resolve))
      .toEqual(['one', 'legacy', 'duplicate', 'invalid', null]);
  });
  it('limits fallback placement to five slots', () => {
    expect(profileTopSlots(Array.from({ length: 8 }, (_, i) => ({ seriesRef: String(i) })), resolve))
      .toEqual(['0', '1', '2', '3', '4']);
  });
});
