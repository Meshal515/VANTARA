import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let store;
let aliases;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', undefined);
  aliases = await import('./manga-alias-store.js');
  store = await import('./chapter-store.js');
});

const edition = (sourceId, numbers) => ({ sourceId, manga: { title: 'Title', url: '/title' },
  chapters: numbers.map((n) => ({ chapterNumber: n, name: `Chapter ${n}`, url: `/chapter/${n}` })),
});

describe('chapter caches survive canonical manga regrouping', () => {
  it('reads the former reference cache and leaves the original entry available', async () => {
    const editions = [edition('ar.one', [1, 2])];
    await store.writeWork('ext:old', { editions, detail: { description: 'Saved description' } });
    aliases.noteRefAlias('ext:old', 'ext:new');
    expect((await store.readWork('ext:new')).editions).toEqual(editions);
    expect((await store.readWork('ext:old')).editions).toEqual(editions);
  });

  it('keeps chapter editions from current and transitively renamed work references', async () => {
    await store.writeWork('ext:oldest', { editions: [edition('ar.one', [1, 2])], detail: { description: 'Saved' } });
    await store.writeWork('ext:middle', { editions: [edition('en.two', [1, 2, 3])] });
    await store.writeWork('ext:new', { editions: [edition('ar.one', [2, 3])] });
    aliases.noteRefAlias('ext:oldest', 'ext:middle');
    aliases.noteRefAlias('ext:middle', 'ext:new');
    const cached = await store.readWork('ext:new');
    expect(cached.editions).toHaveLength(2);
    expect(cached.editions.find((e) => e.sourceId === 'ar.one').chapters.map((c) => c.chapterNumber).sort()).toEqual([1, 2, 3]);
    expect(cached.editions.find((e) => e.sourceId === 'en.two').chapters).toHaveLength(3);
    expect(cached.detail.description).toBe('Saved');
  });
});
