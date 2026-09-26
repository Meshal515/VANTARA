import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/extension-engine.js', () => ({
  default: {
    sources: vi.fn(), latest: vi.fn(), chapters: vi.fn(),
  },
}));

import engine from '../lib/extension-engine.js';
import { browseLive } from './works.js';

describe('Latest feed', () => {
  it('shows the first source before a slow one, merges the work, and never fetches its chapters', async () => {
    engine.sources.mockResolvedValue([{ id: 'ar.fast', label: 'سريع' }, { id: 'ar.slow', label: 'بطيء' }]);
    let releaseSlow;
    const slow = new Promise((resolve) => { releaseSlow = resolve; });
    engine.latest.mockImplementation((id) => id === 'ar.fast'
      ? Promise.resolve({ mangas: [{ title: 'عمل واحد', url: '/fast', thumbnailUrl: 'https://cover/fast' }] })
      : slow);
    let firstUpdate;
    const first = new Promise((resolve) => { firstUpdate = resolve; });
    const task = browseLive({ kind: 'latest', page: 1 }, ({ items }) => {
      if (items.length) firstUpdate(items);
    });
    try {
      const partial = await Promise.race([first, new Promise((_, reject) => setTimeout(() => reject(new Error('slow source held Latest')), 600))]);
      expect(partial.map((work) => work.title.english)).toEqual(['عمل واحد']);
      expect(engine.chapters).not.toHaveBeenCalled();
    } finally {
      releaseSlow({ mangas: [{ title: 'عمل واحد', url: '/slow' }] });
    }
    const done = await task;
    expect(done.items).toHaveLength(1);
    expect(done.items[0]._work.editions).toHaveLength(2);
    expect(done.items[0]._latestChapter).toBeUndefined();
    expect(engine.chapters).not.toHaveBeenCalled();
  });
});
