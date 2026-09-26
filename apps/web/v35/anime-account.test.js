import { beforeEach, describe, expect, it } from 'vitest';
import { animeRef, createAnimeAccount, episodeKey, isAnimeRef } from './anime-account.js';

/**
 * الأنمي في حسابك.
 *
 * السؤال: هل تُحفظ القوائم وعين الحلقة في جداول الحساب نفسها (فتظهر في كل
 * أجهزتك وفي ملفك)؟ وهل «من ← إلى» عملية واحدة لا تكرر ما عُلّم؟ وهل يُرحَّل
 * سجل الجهاز القديم مرة واحدة فقط؟
 */
function fakeSync(tables = {}) {
  const ops = [];
  const data = { library: [], collections: [], completions: [], chapter_marks: [], work_views: [], works: [], ...tables };
  // طبقة متفائلة مصغّرة: ما يكفي لتُرى الكتابة قبل رجوع الخادم
  const apply = (kind, p) => {
    if (kind === 'chapter.mark') upsertMark(p.chapterKey, p.seriesRef, p.read);
    if (kind === 'chapter.markMany') {
      if (p.all && p.read === false) {
        for (const r of data.chapter_marks) if (r.series_ref === p.seriesRef) r.read = 0;
      } else {
        for (const k of p.keys) upsertMark(k, p.seriesRef, p.read);
      }
    }
    if (kind === 'library.add') data.library.push({ user_id: 'me', series_ref: p.seriesRef, removed: 0 });
    if (kind === 'readLater.set' || kind === 'favorite.set') {
      data.collections.push({ user_id: 'me', kind: kind === 'favorite.set' ? 'favorite' : 'read_later', series_ref: p.seriesRef, member: p.member ? 1 : 0 });
    }
  };
  function upsertMark(key, ref, read) {
    const row = data.chapter_marks.find((r) => r.chapter_key === key);
    if (row) row.read = read ? 1 : 0;
    else data.chapter_marks.push({ user_id: 'me', chapter_key: key, series_ref: ref, read: read ? 1 : 0 });
  }
  return {
    user: { userId: 'me' },
    ops,
    data,
    rows: (table, pred) => (pred ? (data[table] ?? []).filter(pred) : [...(data[table] ?? [])]),
    row: (table, key) => (table === 'chapter_marks' ? (data.chapter_marks.find((r) => `${r.user_id}/${r.chapter_key}` === key) ?? null) : null),
    enqueue: (kind, payload) => {
      ops.push({ kind, payload });
      apply(kind, payload);
    },
  };
}

// بيئة الاختبار بلا متصفح: تخزين محلي في الذاكرة يكفي لعلامة الترحيل
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear(),
};

const naruto = { id: 20, title: 'Naruto', posterSmall: 'https://img/20.jpg' };

describe('anime in the account', () => {
  beforeEach(() => localStorage.clear());

  it('uses the shared account tables with an anime: ref', () => {
    expect(animeRef(20)).toBe('anime:20');
    expect(episodeKey(20, 7)).toBe('anime:20#ep:7');
    expect(isAnimeRef('anime:20')).toBe(true);
    expect(isAnimeRef('ext:abc')).toBe(false);
    const sync = fakeSync();
    const a = createAnimeAccount(sync);
    a.setLibrary(naruto, true);
    a.setCollection('read_later', naruto, true);
    a.setCollection('favorite', naruto, true);
    expect(sync.ops.map((o) => o.kind)).toEqual(['library.add', 'readLater.set', 'favorite.set']);
    expect(sync.ops[0].payload).toMatchObject({ seriesRef: 'anime:20', seriesTitle: 'Naruto', coverUrl: 'https://img/20.jpg' });
    expect(a.inLibrary(20)).toBe(true);
    expect(a.inCollection('read_later', 20)).toBe(true);
    expect(a.inCollection('favorite', 20)).toBe(true);
  });

  it('marks from → to in one op and skips episodes already seen', () => {
    const sync = fakeSync();
    const a = createAnimeAccount(sync);
    a.markEpisode(naruto, 3, true);
    const changed = a.markRange(naruto, 5, 1, true); // الترتيب المعكوس يُفهم
    expect(changed).toBe(4);
    const many = sync.ops.filter((o) => o.kind === 'chapter.markMany');
    expect(many).toHaveLength(1);
    expect(many[0].payload.keys).toEqual(['anime:20#ep:1', 'anime:20#ep:2', 'anime:20#ep:4', 'anime:20#ep:5']);
    expect([1, 2, 3, 4, 5].every((n) => a.isSeen(20, n))).toBe(true);
    expect(a.seenCount(20)).toBe(5);
    expect(a.markRange(naruto, 1, 5, true)).toBe(0);
  });

  it('clears every episode of one anime', () => {
    const sync = fakeSync();
    const a = createAnimeAccount(sync);
    a.markRange(naruto, 1, 3, true);
    a.clearAll(naruto);
    expect(sync.ops.at(-1)).toMatchObject({ kind: 'chapter.markMany', payload: { seriesRef: 'anime:20', read: false, all: true } });
    expect(a.isSeen(20, 2)).toBe(false);
  });

  it('records a view once per episode, labelled as an episode', () => {
    const sync = fakeSync();
    const a = createAnimeAccount(sync);
    a.recordView(naruto, 12);
    a.recordView(naruto, 12);
    a.recordView(naruto, 13);
    const views = sync.ops.filter((o) => o.kind === 'view.add');
    expect(views).toHaveLength(2);
    expect(views[0].payload).toMatchObject({ seriesRef: 'anime:20', chapterLabel: 'الحلقة 12', chapterNumber: 12 });
  });

  it('builds a shelf from anime rows only, titles from works or views', () => {
    const sync = fakeSync({
      library: [
        { user_id: 'me', series_ref: 'anime:20', removed: 0 },
        { user_id: 'me', series_ref: 'ext:manga', removed: 0 },
        { user_id: 'me', series_ref: 'anime:21', removed: 0 },
      ],
      works: [{ series_ref: 'anime:20', title: 'Naruto', cover_url: 'c20' }],
      work_views: [{ user_id: 'me', series_ref: 'anime:21', series_title: 'One Piece', cover_url: 'c21', viewed_at: 9 }],
    });
    const shelf = createAnimeAccount(sync).shelf('library');
    expect(shelf.map((m) => m.id)).toEqual([21, 20]);
    expect(shelf[0]).toMatchObject({ title: 'One Piece', poster: 'c21' });
    expect(shelf[1]).toMatchObject({ title: 'Naruto', poster: 'c20' });
  });

  it('migrates the device list and watched episodes once', () => {
    const sync = fakeSync();
    const a = createAnimeAccount(sync);
    const list = { 20: { id: 20, title: 'Naruto' } };
    const watch = { 20: { id: 20, title: 'Naruto', episode: 3, at: 5, episodes: { 1: { done: true }, 2: { done: true }, 3: { done: false, position: 10 } } } };
    a.migrate({ list, watch });
    expect(a.inLibrary(20)).toBe(true);
    expect(a.isSeen(20, 1) && a.isSeen(20, 2)).toBe(true);
    expect(a.isSeen(20, 3)).toBe(false);
    expect(sync.ops.find((o) => o.kind === 'view.add').payload).toMatchObject({ chapterLabel: 'الحلقة 3', at: 5 });
    const before = sync.ops.length;
    a.migrate({ list, watch });
    expect(sync.ops.length).toBe(before);
  });
});
