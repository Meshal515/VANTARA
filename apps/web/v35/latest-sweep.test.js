import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectLatestChapters, latestBoundary } from './works.js';
import { connectUpdates, flush, noteListed, observeMangaChapters } from '../lib/update-engine.js';

/** Latest scans audit stationary works, resume deeper pages, and retry failed
 * chapter payloads without depending on the work staying in the listing. */
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
    expect(pagesRead).toEqual([1, 2, 3, 4]);
    expect(new Set(fetched).size).toBe(100);
    expect(fetched.filter((u) => u.startsWith('/manga/new'))).toHaveLength(64);
    // الأقدم أولًا: ترتيب الاكتشاف على الخادم يتبع ترتيب القائمة
    expect(fetched.filter(u => u.startsWith('/manga/new'))[0]).toBe('/manga/new63/');
    expect(fetched.at(-1)).toBe('/manga/new0/');
    expect(vouched).toHaveLength(64);
    expect(vouched.every(([, since]) => since === prev.at)).toBe(true);
    expect(entries).toHaveLength(100);
    expect(known.cursors[SOURCE.id].nextPage).toBe(5);
    expect(known.cursors[SOURCE.id].keys.slice(0, 2)).toEqual(['/manga/new0/', '/manga/new1/']);
  });

  it('audits unchanged works as well as works that moved up', async () => {
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
    expect(same.fetched.sort()).toEqual(keys.map(k => manga(k).url).sort());
    expect(same.vouched).toEqual([]);

    const moved = await run(['w17', ...keys.filter((k) => k !== 'w17')]);
    expect(moved.pages).toEqual([1]);
    expect(moved.vouched).toEqual(['/manga/w17/']);
    expect(moved.fetched.sort()).toEqual(keys.map(k => manga(k).url).sort());
  });

  it('a first sweep covers available pages and vouches nothing', async () => {
    const pages = [];
    const vouched = [];
    const { entries } = await collectLatestChapters([SOURCE], 1, {
      latest: (id, p) => { pages.push(p); return paged(Array.from({ length: 60 }, (_, i) => manga(`a${i}`)))(id, p); },
      chapters: async () => chapterRows(3),
      listed: (_id, m) => vouched.push(m.url),
      now: NOW,
    });
    expect(pages).toEqual([1, 2, 3]);
    expect(entries).toHaveLength(60);
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
    expect(Object.keys(retry)).toHaveLength(27);
    expect(retry['/manga/n0/'].manga.url).toBe('/manga/n0/');
    const vouched = [];
    await collectLatestChapters([SOURCE], 1, {
      known: first.known,
      latest: paged(order.map(manga)),
      chapters: async () => chapterRows(1),
      listed: (_id, m, since) => vouched.push([m.url, since]),
      now: NOW + 10 * MIN,
    });
    expect(vouched.filter(([url]) => url.includes('/n')).sort()).toEqual(['n0', 'n1', 'n2', 'n3'].map(k => [manga(k).url, prev.at]));
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

it('resumes beyond the four-page budget and preserves failed work even when it leaves the listing', async () => {
  const all = Array.from({ length: 140 }, (_, i) => manga(`burst${i}`));
  const fetched = new Set();
  let known = { initialized: true, cursors: { [SOURCE.id]: { at: NOW - MIN, keys: ['/old1', '/old2'] } } };
  for (let pass = 0; pass < 3; pass++) {
    const result = await collectLatestChapters([SOURCE], 1, { known, latest: paged(all), chapters: async (_id, m) => { fetched.add(m.url); return chapterRows(1); }, now: NOW + pass * MIN });
    known = result.known;
  }
  expect(fetched.size).toBe(140);
  const first = await collectLatestChapters([SOURCE], 1, { latest: paged([manga('failed')]), chapters: async () => { throw new Error('offline'); }, now: NOW });
  const retry = await collectLatestChapters([SOURCE], 1, { known: first.known, latest: paged([manga('other')]), chapters: async (_id,m) => { fetched.add(m.url); return chapterRows(2); }, now: NOW + MIN });
  expect(retry.entries.some(e => e.manga.url === '/manga/failed/')).toBe(true);
});

it('finds a new chapter in an unchanged listing below the three head works', async () => {
  const all = Array.from({ length: 25 }, (_, i) => manga(`unchanged${i}`));
  const before = { initialized: true, cursors: { [SOURCE.id]: { at: NOW - MIN, keys: all.map(m => m.url) } } };
  const result = await collectLatestChapters([SOURCE], 1, { known: before, latest: paged(all), chapters: async (_id,m) => chapterRows(m.url.includes('17') ? 2 : 1), now: NOW });
  expect(result.entries.some(e => e.manga.url === '/manga/unchanged17/' && e.chapter.chapterNumber === 2)).toBe(true);
});

it('measures scan capacity with three workers and one-second chapter responses', async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const list = Array.from({ length: 6 }, (_, i) => ({ id: `capacity${i}`, label: `Source ${i}` }));
  const rows = Array.from({ length: 100 }, (_, i) => manga(`capacity-work${i}`));
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  let completedAt;
  const job = collectLatestChapters(list, 1, {
    concurrency: 3,
    latest: async (_id, p) => { await wait(200); return paged(rows)(_id,p); },
    chapters: async () => { await wait(1000); return chapterRows(1); },
  }).then(result => { completedAt = Date.now(); return result; });
  await vi.runAllTimersAsync();
  const result = await job;
  expect(result.entries).toHaveLength(600);
  expect(result.diagnostics).toMatchObject({ pages: 24, chapterRequests: 600, failedPages: 0, failedChapters: 0 });
  expect(completedAt - start).toBe(201600);
  vi.useRealTimers();
});

it('does not lose chapters from a successful early page when a later listing page fails', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => manga(`page-failure${i}`));
  const first = await collectLatestChapters([SOURCE], 1, {
    latest: async (id,p) => { if (p===2) throw new Error('offline'); return paged(rows)(id,p); },
    chapters: async () => chapterRows(1), now: NOW,
  });
  expect(first.entries).toHaveLength(25);
  expect(first.known.cursors[SOURCE.id].nextPage).toBe(2);
  expect(first.diagnostics.failedPages).toBe(1);
  const second = await collectLatestChapters([SOURCE], 1, { known: first.known, latest: paged(rows), chapters: async () => chapterRows(1), now: NOW + MIN });
  expect(second.entries).toHaveLength(60);
});

it('cleans successful listing and chapter deadlines after the scan', async () => {
  vi.useFakeTimers();
  await collectLatestChapters([SOURCE], 1, { latest: paged([manga('timers')]), chapters: async () => chapterRows(1) });
  expect(vi.getTimerCount()).toBe(0);
  vi.clearAllTimers(); vi.useRealTimers();
});
