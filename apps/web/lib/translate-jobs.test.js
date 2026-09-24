import { describe, expect, it } from 'vitest';
import { createJob, createJobRunner, englishSources, estimateMinutes, nextWork, pickChapters, progressOf, readJobs } from './translate-jobs.js';

const row = (number, sourceId = 'weeb', lang = 'en') => ({ number, sourceId, lang, sourceLabel: 'Weeb Central', chapter: { url: `${sourceId}/${number}` } });
const keyOf = (r) => `ext:x#${r.sourceId}#${r.number}`;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

describe('choosing what to translate', () => {
  it('lists English sources only, with their chapter range', () => {
    const rows = [row(1), row(2), row(3), row(1, 'azora', 'ar'), row(5, 'other'), row(2, 'weeb')];
    expect(englishSources(rows)).toEqual([
      { sourceId: 'weeb', label: 'Weeb Central', count: 3, min: 1, max: 3 },
      { sourceId: 'other', label: 'Weeb Central', count: 1, min: 5, max: 5 },
    ]);
  });

  it('picks the chapters of one source in a range, in order, without duplicates', () => {
    const rows = [row(3), row(1), row(2), row(2), row(4), row(2, 'other'), row(2.5)];
    expect(pickChapters(rows, 'weeb', 3, 2).map((r) => r.number)).toEqual([2, 2.5, 3]);
  });
});

describe('the saved job: page by page', () => {
  it('walks chapters in order and resumes at the first page not done', () => {
    const job = createJob({ ref: 'ext:x', title: 'X', sourceId: 'weeb', rows: [row(1), row(2)], keyOf, pageCounts: { [keyOf(row(1))]: 3 }, now: 1 });
    expect(nextWork(job)).toEqual({ chapter: 0, page: 0 });
    job.chapters[0].done.push(0, 2);
    expect(nextWork(job)).toEqual({ chapter: 0, page: 1 });
    expect(nextWork(job, new Set(['0:1']))).toEqual({ chapter: 1, page: null });
    expect(progressOf(job)).toMatchObject({ done: 2, total: 3, unknown: 1, chaptersDone: 0 });
  });

  it('estimates time from the measured pace only', () => {
    expect(estimateMinutes(400, null)).toBeNull();
    expect(estimateMinutes(400, 6000)).toBe(40);
    expect(estimateMinutes(3, 1000)).toBe(1);
  });
});

function fakeDeps(over = {}) {
  const calls = [];
  const notes = [];
  const storage = memoryStorage();
  const deps = {
    storage,
    sync: {},
    keyOf,
    engine: {
      pages: async (_s, chapter) => Array.from({ length: over.pagesPer ?? 3 }, (_, i) => ({ i, chapter: chapter.url })),
      pageImage: async (_s, page) => ({ src: `file://${page.chapter}/${page.i}`, path: `/p/${page.chapter}/${page.i}` }),
    },
    translatePage: async (d, src, meta) => {
      calls.push({ src, meta, imagePath: d.imagePath });
      return over.translate ? over.translate(src, meta, calls.length) : { translated: 1, from: 'model' };
    },
    native: {
      jobProgress: async (a) => notes.push(['progress', a]),
      jobFinished: async (a) => notes.push(['finished', a]),
      jobStop: async () => notes.push(['stop']),
    },
  };
  return { deps, calls, notes, storage };
}

const until = async (check) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('the runner', () => {
  it('translates every page of every chapter, saves after each page, and announces completion', async () => {
    const { deps, calls, notes, storage } = fakeDeps();
    const runner = createJobRunner(deps);
    const job = runner.add(createJob({ ref: 'ext:x', title: 'The Breaker', sourceId: 'weeb', rows: [row(10), row(11)], keyOf, mode: 'fast' }));
    await until(() => runner.jobs()[0]?.status === 'done');
    expect(calls).toHaveLength(6);
    expect(calls[0].meta).toMatchObject({ seriesRef: 'ext:x', chapterNumber: 10, speed: 'fast', sourceLang: 'en' });
    expect(calls[0].imagePath).toMatch(/^\/p\//);
    expect(readJobs(storage)[0]).toMatchObject({ id: job.id, status: 'done' });
    expect(notes.find(([k]) => k === 'finished')[1].text).toContain('فصلين');
    expect(notes.at(-1)).toEqual(['stop']);
  });

  it('a quality job never asks for the fast engine', async () => {
    const { deps, calls } = fakeDeps({ pagesPer: 1 });
    const runner = createJobRunner(deps);
    runner.add(createJob({ ref: 'ext:x', sourceId: 'weeb', rows: [row(1)], keyOf }));
    await until(() => runner.jobs()[0]?.status === 'done');
    expect(calls[0].meta.speed).toBeUndefined();
  });

  it('stops on a blocking error, keeps what was done, and resumes from the next page after restart', async () => {
    const { deps, calls, notes, storage } = fakeDeps({
      translate: (_src, meta) => (meta.chapterNumber === 11 && meta.pageIndex === 1 ? { error: 'weekly_limit' } : { translated: 1, from: 'model' }),
    });
    const runner = createJobRunner(deps);
    runner.add(createJob({ ref: 'ext:x', title: 'X', sourceId: 'weeb', rows: [row(10), row(11)], keyOf }));
    await until(() => runner.jobs()[0]?.status === 'paused');
    const saved = readJobs(storage)[0];
    expect(saved.reason).toBe('weekly_limit');
    expect(saved.chapters[0].done.sort()).toEqual([0, 1, 2]);
    expect(notes.some(([k, a]) => k === 'finished' && a.text.includes('الخميس'))).toBe(true);

    // جلسة جديدة (التطبيق أُعيد فتحه) والأسبوع تجدد
    const before = calls.length;
    const { deps: fresh, calls: freshCalls } = fakeDeps();
    fresh.storage = storage;
    const again = createJobRunner(fresh);
    again.resume(saved.id);
    await until(() => again.jobs()[0]?.status === 'done');
    const redone = freshCalls.map((c) => `${c.meta.chapterNumber}:${c.meta.pageIndex}`);
    expect(redone).not.toContain('10:0');
    expect(redone).toContain('11:1');
    expect(before).toBeGreaterThan(0);
  });

  it('pause stops taking new pages; resumeAll continues only running jobs', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const { deps, calls, storage } = fakeDeps({ translate: async () => (await gate, { translated: 1, from: 'model' }) });
    const runner = createJobRunner(deps);
    const job = runner.add(createJob({ ref: 'ext:x', sourceId: 'weeb', rows: [row(1), row(2)], keyOf }));
    await until(() => calls.length === 3);
    runner.pause(job.id);
    release();
    await until(() => readJobs(storage)[0].chapters[0].done.length === 3);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(3);
    expect(readJobs(storage)[0].status).toBe('paused');

    const { deps: fresh, calls: freshCalls } = fakeDeps();
    fresh.storage = storage;
    createJobRunner(fresh).resumeAll();
    await new Promise((r) => setTimeout(r, 30));
    expect(freshCalls).toHaveLength(0);
  });

  it('a page that keeps failing is skipped instead of blocking the queue', async () => {
    const { deps, storage } = fakeDeps({ pagesPer: 2, translate: (src) => (src.endsWith('/1') ? { error: 'refused' } : { translated: 1, from: 'model' }) });
    const runner = createJobRunner(deps);
    runner.add(createJob({ ref: 'ext:x', sourceId: 'weeb', rows: [row(1)], keyOf }));
    await until(() => runner.jobs()[0]?.status === 'done');
    expect(readJobs(storage)[0].chapters[0]).toMatchObject({ done: [0], failed: [1] });
  });

  it('cancel removes the job and stops the service', async () => {
    const { deps, notes } = fakeDeps({ translate: () => new Promise(() => {}) });
    const runner = createJobRunner(deps);
    const job = runner.add(createJob({ ref: 'ext:x', sourceId: 'weeb', rows: [row(1)], keyOf }));
    runner.cancel(job.id);
    expect(runner.jobs()).toHaveLength(0);
    expect(notes.some(([k]) => k === 'stop')).toBe(true);
  });
});
