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

it('indexes provider editions saved before upgrading the chapter database', async () => {
  const source = edition('ar.addon#123', [1, 2]);
  const providerRef = 'ext:manga|provider:addon:123|s|p';
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('vantara-chapters', 2);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('works').put({ editions: [source] }, providerRef);
      request.result.createObjectStore('kv');
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  expect((await store.readWork('ext:title', { sourceTitle: 'title' })).localSourceEditions).toEqual([source]);
  expect((await store.readWork(providerRef)).editions).toEqual([source]);
});

it('CST1: pruning keeps the newest 200 works and never loads every stored work at once', async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
  const store = await import('./chapter-store.js');
  const now = vi.spyOn(Date, 'now');
  for (let i = 0; i < 230; i++) { now.mockReturnValue(1_000 + i); await store.writeWork(`ext:w${i}`, { editions: [] }); }
  now.mockRestore();
  const { IDBObjectStore } = await import('fake-indexeddb');
  const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
  await store.prune();
  expect(getAll).not.toHaveBeenCalled();
  expect(await store.readWork('ext:w0')).toBeNull();
  expect(await store.readWork('ext:w229')).not.toBeNull();
  getAll.mockRestore();
  vi.unstubAllGlobals();
});
