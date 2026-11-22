import { beforeEach, describe, expect, it } from 'vitest';
import { chapterKeyOf, clearChapterMarks, isChapterRead, markChapter, positionFor, progressFor, _resetPending } from './reading.js';
import { createArtStore } from '../lib/art.js';

/**
 * المرحلة 1 من خطة المانجا (RD6، CV4، SY3): العمل الواحد قد يحمل أكثر من مرجع (`ext:<مفتاح قديم>` قبل الدمج
 * و`ext:<مفتاح جديد>` بعده). القراءة تتبع كل مراجع العمل، والكتابة تبقى بمرجع البطاقة الحالي.
 * لا صف يُحذف ولا يُنقل، ولا عملية مزامنة تُنتجها القراءة.
 */
const OLD = 'ext:demonic emperor';
const NEW = 'ext:magic emperor';
const refsOf = (ref) => (ref === NEW || ref === OLD ? [ref, ref === NEW ? OLD : NEW] : [ref]);
const row = (n) => ({ sourceId: 'swat', chapter: { url: `/c/${n}`, name: `الفصل ${n}`, chapterNumber: n } });

function mirrorSync(tables = {}) {
  const ops = [];
  const get = (table) => tables[table] ?? {};
  return {
    user: { userId: 'me' },
    ops,
    row: (table, id) => get(table)[id] ?? null,
    rows: (table, pred) => Object.values(get(table)).filter(pred),
    enqueue: (kind, payload) => {
      ops.push({ kind, payload });
      // مثل الطبقة المتفائلة الحقيقية (lib/optimistic.js): العلامة تظهر فورًا بوقت الجهاز
      if (kind === 'chapter.mark') (tables.chapter_marks ??= {})[`me/${payload.chapterKey}`] = { user_id: 'me', chapter_key: payload.chapterKey, series_ref: payload.seriesRef, read: payload.read ? 1 : 0, updated_at: Date.now() };
      if (kind === 'chapter.markMany' && payload.all && payload.read === false) {
        for (const r of Object.values(tables.chapter_marks ?? {})) if (r.series_ref === payload.seriesRef && r.read) Object.assign(r, { read: 0, updated_at: Date.now() });
      }
    },
  };
}
const mark = (ref, n, read, at) => {
  const key = chapterKeyOf(ref, row(n));
  return [`me/${key}`, { user_id: 'me', chapter_key: key, series_ref: ref, read: read ? 1 : 0, updated_at: at }];
};

describe('phase 1: read marks across every reference of one work (RD6)', () => {
  beforeEach(() => _resetPending());

  it('a chapter read under the old reference stays read after the card key changes', () => {
    const sync = mirrorSync({ chapter_marks: Object.fromEntries([mark(OLD, 5, true, 100)]) });
    expect(isChapterRead(sync, NEW, chapterKeyOf(NEW, row(5)), { refsOf })).toBe(true);
    expect(isChapterRead(sync, NEW, chapterKeyOf(NEW, row(6)), { refsOf })).toBe(false);
  });

  it('the newest mark wins across references: a later «unread» on the new card beats an older «read»', () => {
    const sync = mirrorSync({ chapter_marks: Object.fromEntries([mark(OLD, 5, true, 100), mark(NEW, 5, false, 200)]) });
    expect(isChapterRead(sync, NEW, chapterKeyOf(NEW, row(5)), { refsOf })).toBe(false);
  });

  it('…and a later «read» under the old reference beats an older «unread» on the new card', () => {
    const sync = mirrorSync({ chapter_marks: Object.fromEntries([mark(OLD, 5, true, 300), mark(NEW, 5, false, 200)]) });
    expect(isChapterRead(sync, NEW, chapterKeyOf(NEW, row(5)), { refsOf })).toBe(true);
  });

  it('a mark just made (optimistic, not yet confirmed by the server) wins over older rows in other references', () => {
    const sync = mirrorSync({ chapter_marks: Object.fromEntries([mark(OLD, 5, true, 300)]) });
    markChapter(sync, NEW, row(5), false);
    expect(isChapterRead(sync, NEW, chapterKeyOf(NEW, row(5)), { refsOf })).toBe(false);
  });

  it('without the keyed mirror (older sync), the session pending mark still wins first', () => {
    const rows = [Object.fromEntries([mark(OLD, 5, true, 300)])].flatMap((o) => Object.values(o));
    const sync = { user: { userId: 'me' }, rows: (t, pred) => (t === 'chapter_marks' ? rows.filter(pred) : []), enqueue: () => {} };
    expect(isChapterRead(sync, NEW, chapterKeyOf(NEW, row(5)), { refsOf })).toBe(true);
    markChapter(sync, NEW, row(5), false);
    expect(isChapterRead(sync, NEW, chapterKeyOf(NEW, row(5)), { refsOf })).toBe(false);
  });

  it('reading across references never writes: no sync operation, no row touched', () => {
    const tables = { chapter_marks: Object.fromEntries([mark(OLD, 5, true, 100)]) };
    const before = JSON.stringify(tables);
    const sync = mirrorSync(tables);
    for (let n = 1; n <= 10; n++) isChapterRead(sync, NEW, chapterKeyOf(NEW, row(n)), { refsOf });
    expect(sync.ops).toEqual([]);
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('a work with a single reference behaves exactly as before', () => {
    const sync = mirrorSync({ chapter_marks: Object.fromEntries([mark('ext:solo', 3, true, 1)]) });
    expect(isChapterRead(sync, 'ext:solo', chapterKeyOf('ext:solo', row(3)), { refsOf })).toBe(true);
    expect(isChapterRead(sync, 'ext:solo', chapterKeyOf('ext:solo', row(4)), { refsOf })).toBe(false);
  });
});

describe('phase 1: «clear all marks» covers every reference (SY3)', () => {
  beforeEach(() => _resetPending());

  it('clears read marks under the old reference too, and only references that have marks', () => {
    const sync = mirrorSync({ chapter_marks: Object.fromEntries([mark(OLD, 5, true, 1), mark(NEW, 6, true, 2)]) });
    expect(clearChapterMarks(sync, NEW, { refsOf })).toBe(2);
    expect(sync.ops.map((o) => o.payload.seriesRef).sort()).toEqual([NEW, OLD].sort());
    expect(sync.ops.every((o) => o.kind === 'chapter.markMany' && o.payload.read === false && o.payload.all === true)).toBe(true);
    expect(isChapterRead(sync, NEW, chapterKeyOf(NEW, row(5)), { refsOf })).toBe(false);
  });
});

describe('phase 1: reading position across references (RD6)', () => {
  it('server progress saved under the old reference is found for the new card', () => {
    const key = chapterKeyOf(OLD, row(9));
    const sync = mirrorSync({ progress: { [`me/${key}`]: { user_id: 'me', chapter_key: key, series_ref: OLD, page: 14, ratio: 0.6 } } });
    expect(progressFor(sync, NEW, chapterKeyOf(NEW, row(9)), { refsOf })).toMatchObject({ page: 14, ratio: 0.6 });
    expect(progressFor(sync, NEW, chapterKeyOf(NEW, row(10)), { refsOf })).toBeNull();
  });

  it('the furthest progress across references wins (the server merge rule)', () => {
    const a = chapterKeyOf(OLD, row(9));
    const b = chapterKeyOf(NEW, row(9));
    const sync = mirrorSync({ progress: {
      [`me/${a}`]: { user_id: 'me', chapter_key: a, page: 14, ratio: 0.6 },
      [`me/${b}`]: { user_id: 'me', chapter_key: b, page: 3, ratio: 0.1 },
    } });
    expect(progressFor(sync, NEW, b, { refsOf }).ratio).toBe(0.6);
  });

  it('the device position prefers the current reference, then the old one', () => {
    const positions = { [chapterKeyOf(OLD, row(9))]: { sourceId: 'swat', pages: 30, page: 12 } };
    expect(positionFor(positions, NEW, chapterKeyOf(NEW, row(9)), { refsOf })).toMatchObject({ page: 12 });
    positions[chapterKeyOf(NEW, row(9))] = { sourceId: 'swat', pages: 30, page: 20 };
    expect(positionFor(positions, NEW, chapterKeyOf(NEW, row(9)), { refsOf })).toMatchObject({ page: 20 });
  });
});

describe('phase 1: one cover decision per work across references (CV4)', () => {
  const memory = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  };

  it('a decision saved under the old reference is reused unchanged, and the original stays', () => {
    const storage = memory();
    const decided = { cover: 'https://src/cover.jpg', w: 600, h: 900, banner: 'https://src/cover.jpg', wide: false, bw: 600, bh: 900, sid: 'swat' };
    storage.setItem('vantara.art.v1', JSON.stringify({ [OLD]: decided }));
    const store = createArtStore({ storage, probe: async () => null, refsOf });
    expect(store.get(NEW)).toEqual(decided);
    expect(store.get(OLD)).toEqual(decided);
  });

  it('a work with its own decision keeps it even if an old reference has another', () => {
    const storage = memory();
    storage.setItem('vantara.art.v1', JSON.stringify({ [OLD]: { cover: 'https://a', w: 600, h: 900 }, [NEW]: { cover: 'https://b', w: 600, h: 900 } }));
    const store = createArtStore({ storage, probe: async () => null, refsOf });
    expect(store.get(NEW).cover).toBe('https://b');
  });
});

describe('phase 1 end to end on the real chain: index merge → ref aliases → marks (no injection)', () => {
  it('a mark written before two cards merged is read after the merge, through the real refsOf', async () => {
    const store = await import('../lib/manga-alias-store.js');
    const { canonicalIndex } = await import('../lib/catalog.js');
    store._reset();
    _resetPending();
    const ed = (s, t) => ({ sourceId: s, manga: { title: t, url: `/${t}` } });
    // قبل: بطاقتان، والقراءة من «Demonic Emperor»
    let index = canonicalIndex();
    index.add(ed('teamx', 'Magic Emperor'));
    index.add(ed('swat', 'Demonic Emperor'));
    const before = `ext:${index.list().find((w) => w.title === 'Demonic Emperor').key}`;
    const sync = mirrorSync({ chapter_marks: Object.fromEntries([mark(before, 5, true, 100)]) });
    // بعد: صفحة العمل تعلّمت الاسم البديل فصارت بطاقة واحدة بمفتاح آخر، والدمج يُسجَّل كما في works.js
    index = canonicalIndex({ aliases: new Map([['magic emperor', ['Demonic Emperor']]]) });
    index.add(ed('teamx', 'Magic Emperor'));
    index.add(ed('swat', 'Demonic Emperor'));
    const [work] = index.list();
    const after = `ext:${work.key}`;
    expect(after).not.toBe(before);
    store.noteRefAliases(work.keys.map((own) => [`ext:${own}`, after]));
    expect(isChapterRead(sync, after, chapterKeyOf(after, row(5)))).toBe(true);
    expect(sync.ops).toEqual([]);
  });
});

describe('phase 1: a dead cover is forgotten in every reference (CV4 regression guard)', () => {
  it('forget() drops the same dead decision from the old reference, so it is not copied back', () => {
    const m = new Map();
    const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
    const dead = { cover: 'https://src/dead.jpg', w: 600, h: 900 };
    const other = { cover: 'https://src/alive.jpg', w: 600, h: 900 };
    storage.setItem('vantara.art.v1', JSON.stringify({ [OLD]: dead, 'ext:unrelated': other }));
    const store = createArtStore({ storage, probe: async () => null, refsOf });
    expect(store.get(NEW)).toEqual(dead);
    store.forget(NEW);
    expect(store.get(NEW)).toBeNull();
    expect(store.get(OLD)).toBeNull();
    expect(store.get('ext:unrelated')).toEqual(other);
  });
});

describe('RD7: a chapter whose number reading changed keeps its old marks', () => {
  it('«Vol.3 Ch.25» marked under the old key n:3 still reads as read under its new key n:25', async () => {
    const { chapterKeyOf, isChapterRead } = await import('./reading.js');
    const row = { sourceId: 'madara', chapter: { name: 'Vol.3 Ch.25', url: '/c25', chapterNumber: -1 } };
    const key = chapterKeyOf('ext:work', row);
    expect(key).toBe('ext:work#n:25');
    const marks = [{ user_id: 'u1', chapter_key: 'ext:work#n:3', read: 1, updated_at: 5 }];
    const sync = { user: { userId: 'u1' }, rows: (t, p) => (t === 'chapter_marks' ? marks.filter(p) : []) };
    expect(isChapterRead(sync, 'ext:work', key, { refsOf: (r) => [r] })).toBe(true);
  });
});
