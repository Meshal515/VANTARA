import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectLatestChapters, latestBoundary } from './works.js';
import { connectUpdates, flush, noteListed, observeMangaChapters } from '../lib/update-engine.js';

/**
 * «آخر التحديثات» ناقصة: مانجا ليك يرفع 64 عملًا في قائمته، وVANTARA يُظهر بضعة.
 * المسح كان يقرأ الصفحة الأولى وحدها (25 عملًا) واحدًا واحدًا في سكون الرئيسية،
 * وما لم يُجلب فصله لا يصل الخادم أبدًا. هنا: كل ما صعد منذ المسح السابق يُجلب
 * فصله (حتى 4 صفحات)، وما لم يتحرك لا يُطلب ثانية.
 */
const NOW = Date.UTC(2026, 9, 9, 18);
const MIN = 60_000;
const SOURCE = { id: 'eu.kanade.tachiyomi.extension.ar.mangalek', label: 'Mangalek' };
const manga = (k) => ({ url: `/manga/${k}/`, title: `Work ${k}` });
const paged = (all, size = 25) => async (_id, p) => ({ mangas: all.slice((p - 1) * size, p * size), hasNextPage: all.length > p * size });
const chapterRows = (n) => [{ url: `/c/${n}`, name: `${n}`, chapterNumber: n, dateUpload: 0 }];

describe('Latest sweep: every work that moved up survives', () => {
  it('a 64-work burst across three pages reaches the Update Engine in full, each vouched by the list', async () => {
    const old = Array.from({ length: 80 }, (_, i) => `old${i}`);
    const fresh = Array.from({ length: 64 }, (_, i) => `new${i}`);
    const prev = { at: NOW - 20 * MIN, keys: old.map((k) => manga(k).url) };
    const pagesRead = [];
    const fetched = [];
    const vouched = [];
    const latest = paged([...fresh, ...old].map(manga));
    const { entries, known } = await collectLatestChapters([SOURCE], 1, {
      known: { initialized: true, workChapters: {}, observed: {}, lastUpdate: {}, cursors: { [SOURCE.id]: prev } },
      latest: (id, p) => { pagesRead.push(p); return latest(id, p); },
      chapters: async (_id, m) => { fetched.push(m.url); return chapterRows(Number(m.url.match(/\d+/)[0]) + 1); },
      listed: (_id, m, since) => vouched.push([m.url, since]),
      now: NOW,
    });
    expect(pagesRead).toEqual([1, 2, 3]);
    expect(new Set(fetched).size).toBe(64);
    expect(fetched.every((u) => u.startsWith('/manga/new'))).toBe(true);
    // الأقدم أولًا: ترتيب الاكتشاف على الخادم يتبع ترتيب القائمة
    expect(fetched[0]).toBe('/manga/new63/');
    expect(fetched.at(-1)).toBe('/manga/new0/');
    expect(vouched).toHaveLength(64);
    expect(vouched.every(([, since]) => since === prev.at)).toBe(true);
    expect(entries).toHaveLength(64);
    expect(known.cursors[SOURCE.id].at).toBe(NOW);
    expect(known.cursors[SOURCE.id].keys.slice(0, 2)).toEqual(['/manga/new0/', '/manga/new1/']);
  });

  it('an unchanged list costs one page and the head only; a work that moved up is fetched and vouched', async () => {
    const keys = Array.from({ length: 25 }, (_, i) => `w${i}`);
    const prev = { at: NOW - 10 * MIN, keys: keys.map((k) => manga(k).url) };
    const base = { initialized: true, workChapters: {}, observed: {}, lastUpdate: {}, cursors: { [SOURCE.id]: prev } };
    const run = async (order) => {
      const pages = [];
      const fetched = [];
      const vouched = [];
      await collectLatestChapters([SOURCE], 1, {
        known: base,
        latest: (id, p) => { pages.push(p); return paged(order.map(manga))(id, p); },
        chapters: async (_id, m) => { fetched.push(m.url); return chapterRows(1); },
        listed: (_id, m) => vouched.push(m.url),
        now: NOW,
      });
      return { pages, fetched, vouched };
    };
    const same = await run(keys);
    expect(same.pages).toEqual([1]);
    expect(same.fetched.sort()).toEqual(['/manga/w0/', '/manga/w1/', '/manga/w2/']);
    expect(same.vouched).toEqual([]);

    const moved = await run(['w17', ...keys.filter((k) => k !== 'w17')]);
    expect(moved.pages).toEqual([1]);
    expect(moved.vouched).toEqual(['/manga/w17/']);
    expect(moved.fetched.sort()).toEqual(['/manga/w0/', '/manga/w1/', '/manga/w17/']);
  });

  it('a first sweep reads one page and vouches nothing (it cannot know when those works changed)', async () => {
    const pages = [];
    const vouched = [];
    const { entries } = await collectLatestChapters([SOURCE], 1, {
      latest: (id, p) => { pages.push(p); return paged(Array.from({ length: 60 }, (_, i) => manga(`a${i}`)))(id, p); },
      chapters: async () => chapterRows(3),
      listed: (_id, m) => vouched.push(m.url),
      now: NOW,
    });
    expect(pages).toEqual([1]);
    expect(entries).toHaveLength(25);
    expect(vouched).toEqual([]);
  });

  it('a sweep cut short keeps the vouched works it did not reach for the next sweep', async () => {
    const keys = Array.from({ length: 25 }, (_, i) => `w${i}`);
    const prev = { at: NOW - 10 * MIN, keys: keys.map((k) => manga(k).url) };
    let budget = 2;
    const order = ['n0', 'n1', 'n2', 'n3', ...keys];
    const first = await collectLatestChapters([SOURCE], 1, {
      known: { initialized: true, cursors: { [SOURCE.id]: prev } },
      latest: paged(order.map(manga)),
      chapters: async () => { budget -= 1; return chapterRows(1); },
      listed: () => {},
      shouldContinue: () => budget > 0,
      now: NOW,
    });
    const retry = first.known.cursors[SOURCE.id].retry;
    expect(Object.keys(retry).sort()).toEqual(['/manga/n0/', '/manga/n1/']);
    const vouched = [];
    await collectLatestChapters([SOURCE], 1, {
      known: first.known,
      latest: paged(order.map(manga)),
      chapters: async () => chapterRows(1),
      listed: (_id, m, since) => vouched.push([m.url, since]),
      now: NOW + 10 * MIN,
    });
    expect(vouched.sort()).toEqual([['/manga/n0/', prev.at], ['/manga/n1/', prev.at]]);
  });

  it('boundary: the first old work confirmed by the next old one in the same order', () => {
    const prev = ['a', 'b', 'c', 'd', 'e'];
    expect(latestBoundary(['x', 'y', 'a', 'b', 'c'], prev)).toBe(2);
    expect(latestBoundary(['c', 'a', 'b', 'd'], prev)).toBe(1);
    expect(latestBoundary(['a', 'b', 'c'], prev)).toBe(0);
    expect(latestBoundary(['x', 'y', 'z'], prev)).toBe(-1);
    // عمل قديم وحيد في آخر الصفحة لا يكفي حدًّا: الصفحة التالية تُقرأ
    expect(latestBoundary(['x', 'y', 'c'], prev)).toBe(-1);
  });
});

describe('Update Engine probe carries the list testimony', () => {
  afterEach(() => vi.useRealTimers());
  it('a chapter fetch right after noteListed reports `listed`; any other fetch does not', async () => {
    const sent = [];
    connectUpdates(async (_path, { body }) => { sent.push(...body.works); return { status: 200 }; });
    const since = Date.now() - 10 * MIN;
    noteListed('src', manga('a'), since);
    observeMangaChapters('src', manga('a'), chapterRows(12));
    observeMangaChapters('src', manga('b'), chapterRows(4));
    await flush();
    expect(sent.find((w) => w.work === 'ext:work a')?.listed).toBe(since);
    expect(sent.find((w) => w.work === 'ext:work b')).not.toHaveProperty('listed');
  });
});
