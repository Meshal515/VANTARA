import { describe, expect, it } from 'vitest';
import { createLocator, createMemory, createMetrics, summarize } from './cinema-fast.js';

const store = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};
const copy = (sourceId, title, url = `/${sourceId}/${title}`) => ({ sourceId, url, title });

/** مصادر وهمية بأزمنة رد مختلفة: كل مصدر يرد بعد زمنه، و`done` بعد أبطئهم. */
function fakeSearch(plan) {
  const calls = [];
  const searchStream = (query, content, onHit) => {
    calls.push(query);
    let cancelled = false;
    const timers = [];
    const done = new Promise((resolve) => {
      const list = plan[query] ?? [];
      if (!list.length) return resolve(true);
      let left = list.length;
      for (const hit of list) {
        timers.push(setTimeout(() => {
          if (!cancelled) onHit({ ms: hit.after, error: null, skipped: false, ...hit });
          if (--left === 0) resolve(true);
        }, hit.after));
      }
    });
    return { done, cancel: () => { cancelled = true; for (const t of timers) clearTimeout(t); } };
  };
  return { searchStream, calls };
}
const match = (items, { title }) => items.filter((c) => c.title.toLowerCase() === title.toLowerCase());
const queries = (t) => [t, `${t} alt`];

describe('createLocator — أول نسخة تفوز', () => {
  it('resolves on the fastest matching source without waiting for the slowest', async () => {
    const { searchStream } = fakeSearch({
      Dune: [
        { sourceId: 'fast', items: [copy('fast', 'Dune')], after: 5 },
        { sourceId: 'slow', items: [copy('slow', 'Dune')], after: 80 },
      ],
    });
    const locate = createLocator({ searchStream, queries, match });
    const t0 = Date.now();
    const h = locate({ key: 'k', title: 'Dune', type: 'movie' });
    const first = await h.first;
    expect(Date.now() - t0).toBeLessThan(60);
    expect(first.copies.map((c) => c.sourceId)).toEqual(['fast']);
    // المتأخر يصل للمشترك بعد الأولى
    const late = await new Promise((r) => h.onCopies(r));
    expect(late.map((c) => c.sourceId)).toEqual(['slow']);
    const done = await h.done;
    expect(done.copies).toHaveLength(2);
    expect(done.sources.fast.matchAt).toBeLessThan(done.sources.slow.matchAt);
  });

  it('ignores non-matching results and keeps them for «near» picks', async () => {
    const { searchStream, calls } = fakeSearch({
      Dune: [{ sourceId: 'a', items: [copy('a', 'Dune Part Two')], after: 2 }],
      'Dune alt': [],
    });
    const locate = createLocator({ searchStream, queries, match, near: (seen) => seen });
    const h = locate({ key: 'k', title: 'Dune', type: 'movie' });
    const found = await h.first;
    expect(found.copies).toEqual([]);
    expect(found.near.map((c) => c.title)).toEqual(['Dune Part Two']);
    // الاستعلام البديل سُئل لأن الأول لم يطابق
    expect(calls).toEqual(['Dune', 'Dune alt']);
  });

  it('does not ask the fallback query once the first one matched', async () => {
    const { searchStream, calls } = fakeSearch({ Dune: [{ sourceId: 'a', items: [copy('a', 'Dune')], after: 1 }] });
    const h = createLocator({ searchStream, queries, match })({ key: 'k', title: 'Dune', type: 'movie' });
    await h.done;
    expect(calls).toEqual(['Dune']);
  });

  it('starts from the copy that worked last time, before any source answers', async () => {
    const memory = createMemory(store());
    memory.remember('k', [copy('b', 'Dune'), copy('a', 'Dune')], copy('a', 'Dune'));
    const { searchStream } = fakeSearch({ Dune: [{ sourceId: 'c', items: [copy('c', 'Dune')], after: 30 }] });
    const h = createLocator({ searchStream, queries, match, memory })({ key: 'k', title: 'Dune', type: 'movie' });
    expect(h.found.fast).toBe(true);
    const first = await h.first;
    expect(first.copies.map((c) => c.sourceId)).toEqual(['a', 'b']); // الناجحة أولًا
    const late = await new Promise((r) => h.onCopies(r));
    expect(late.map((c) => c.sourceId)).toEqual(['c']);
  });

  it('retries once after a pause when no source answered at all', async () => {
    let n = 0;
    const searchStream = (q, c, onHit) => {
      n++;
      if (n >= 3) onHit({ sourceId: 'a', items: [copy('a', 'Dune')], ms: 1 });
      return { done: Promise.resolve(true), cancel() {} };
    };
    const waits = [];
    const h = createLocator({ searchStream, queries, match, wait: async (ms) => waits.push(ms) })({ key: 'k', title: 'Dune', type: 'movie' });
    const found = await h.done;
    expect(waits).toHaveLength(1);
    expect(found.copies).toHaveLength(1);
  });

  it('cancel settles first and done immediately', async () => {
    const { searchStream } = fakeSearch({ Dune: [{ sourceId: 'a', items: [copy('a', 'Dune')], after: 500 }] });
    const h = createLocator({ searchStream, queries, match })({ key: 'k', title: 'Dune', type: 'movie' });
    h.cancel();
    expect((await h.first).copies).toEqual([]);
    expect((await h.done).done).toBe(true);
  });
});

describe('createMemory', () => {
  it('forgets after its time and keeps the winner first', () => {
    let now = 0;
    const memory = createMemory(store(), { now: () => now, ttl: 1000 });
    memory.remember('k', [copy('a', 'X'), copy('b', 'X')], copy('b', 'X'));
    expect(memory.copies('k').map((c) => c.sourceId)).toEqual(['b', 'a']);
    now = 2000;
    expect(memory.copies('k')).toBeNull();
  });

  it('remembers the working server per work and per source', () => {
    const memory = createMemory(store());
    memory.remember('k', [copy('a', 'X')]);
    expect(memory.server('k')).toBeNull();
    memory.rememberServer('k', { sourceId: 'a', server: 'Streamwish' });
    expect(memory.server('k')).toMatchObject({ sourceId: 'a', server: 'Streamwish' });
    // عمل آخر من نفس المصدر يرث آخر سيرفر نجح فيه على الجهاز
    memory.remember('k2', [copy('a', 'Y')]);
    expect(memory.server('k2')).toEqual({ sourceId: 'a', server: 'Streamwish' });
  });
});

describe('createMetrics', () => {
  it('measures first result, first match, first ready and first playable', () => {
    let now = 0;
    const metrics = createMetrics(store(), { clock: () => now });
    const run = metrics.start({ key: 'k', title: 'Dune', kind: 'movie' });
    now = 900;
    run.hit({ sourceId: 'a', items: [copy('a', 'Dune')], ms: 850 }, { matched: 1, at: 900 });
    now = 1000;
    run.prepared();
    now = 1800;
    run.route({ id: 'a|1', sourceId: 'a', state: 'RESOLVING' });
    now = 2500;
    run.route({ id: 'a|1', sourceId: 'a', state: 'READY' });
    now = 2900;
    run.route({ id: 'a|1', sourceId: 'a', state: 'READY', probed: true });
    run.route({ id: 'a|2', sourceId: 'a', state: 'UNAVAILABLE' });
    run.hit({ sourceId: 'b', items: [], ms: 12000, error: 'لم يرد خلال 12 ثانية' }, { at: 12000 });
    run.save();
    const [saved] = metrics.runs();
    expect(saved).toMatchObject({ ttfs: 900, ttfm: 900, ttfr: 2500, ttfp: 2900, sourcesOk: 1, servers: 2, playable: 1, failRate: 0.5 });
    expect(saved.sources.a).toMatchObject({ searchMs: 850, serversMs: 800, readyMs: 2500, playableMs: 2900 });
    const per = metrics.sources();
    expect(per[0]).toMatchObject({ id: 'a', searchMs: 850, successRate: 1 });
    expect(per[1]).toMatchObject({ id: 'b', successRate: 0, topError: 'لم يرد خلال 12 ثانية' });
  });

  it('does not report extracted but unprobed links as a successful source or a first playable time', () => {
    const metrics = createMetrics(store());
    const run = metrics.start({ key: 'k', title: 'Dune', kind: 'movie' });
    run.route({ id: 'a|1', sourceId: 'a', state: 'READY' });
    run.save();
    expect(metrics.runs()[0]).toMatchObject({ sourcesOk: 0, playable: 0, ttfp: null });
    expect(metrics.sources()[0]).toMatchObject({ firstPlayableMs: null, successRate: 0 });
  });
  it('saves a run once and keeps only the latest runs', () => {
    const metrics = createMetrics(store(), { keep: 3 });
    for (let i = 0; i < 5; i++) {
      const r = metrics.start({ key: `k${i}`, title: `T${i}`, kind: 'movie' });
      r.save();
      r.save();
      expect(r.saved).toBe(true);
    }
    expect(metrics.runs().map((r) => r.key)).toEqual(['k4', 'k3', 'k2']);
  });

  it('a link that failed its probe does not count as playable', () => {
    const s = summarize({ key: 'k', sources: {}, routes: { a: { state: 'READY', probed: false }, b: { state: 'READY', probed: null } } });
    expect(s.playable).toBe(0);
    expect(s.failRate).toBe(0.5);
  });
});
