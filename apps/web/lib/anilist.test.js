import { describe, expect, it, vi } from 'vitest';
import { createAnilistGate } from './anilist.js';

const URL = 'https://graphql.anilist.co';
function rig({ limit = 30, respond } = {}) {
  let t = 1_000_000;
  const timers = [];
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push(JSON.parse(init.body).q);
    const r = respond?.(calls.length, t) ?? { status: 200 };
    const headers = new Headers({ 'x-ratelimit-limit': String(limit), ...(r.headers ?? {}) });
    return new Response(JSON.stringify({ data: { n: calls.length } }), { status: r.status, headers });
  });
  const gate = createAnilistGate({ fetchImpl, now: () => t, timer: (fn, ms) => timers.push({ at: t + ms, fn }) });
  const advance = async (ms) => {
    t += ms;
    for (const job of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (job.at <= t) job.fn();
      else timers.push(job);
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  const ask = (q, priority) => gate.anilistFetch(URL, { method: 'POST', body: JSON.stringify({ q }) }, { priority });
  return { gate, ask, advance, calls, fetchImpl };
}

describe('one AniList gate for the whole app (AniList allows 30 a minute)', () => {
  it('background requests never use the margin kept for what the person just tapped', async () => {
    const { ask, calls, gate } = rig();
    await ask('learn-the-limit', 'user');
    calls.length = 0;
    const bg = Array.from({ length: 40 }, (_, i) => ask(`cover${i}`).catch((e) => e));
    await new Promise((r) => setTimeout(r, 0));
    // 30 − 1 هامش − 6 للمستخدم − 1 مستعمل = 22 للخلفية في هذه الدقيقة
    expect(calls).toHaveLength(22);
    const tap = await ask('open-anime', 'user');
    expect(tap.status).toBe(200);
    expect(calls.at(-1)).toBe('open-anime');
    expect(gate.state().queued).toBe(18);
    void bg;
  });

  it('a 429 pauses everyone until AniList reopens, and the person\'s request is retried instead of failing', async () => {
    const { ask, advance, calls } = rig({ respond: (n) => (n === 1 ? { status: 429, headers: { 'retry-after': '10' } } : { status: 200 }) });
    const pending = ask('search', 'user');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['search']);
    await advance(5_000);
    expect(calls).toHaveLength(1);
    await advance(6_000);
    expect((await pending).status).toBe(200);
    expect(calls).toEqual(['search', 'search']);
  });

  it('background requests that waited too long are dropped with a clear reason, not left blocking', async () => {
    const { ask, advance } = rig({ limit: 12 });
    await ask('learn-the-limit', 'user');
    const all = Array.from({ length: 6 }, (_, i) => ask(`bg${i}`).then(() => 'ok', (e) => e.code));
    await advance(30_000);
    const out = await Promise.all(all);
    expect(out.filter((x) => x === 'ok').length).toBeGreaterThan(0);
    expect(out).toContain('anilist_busy');
  });

  it('the same query in flight is sent once and shared', async () => {
    const { ask, calls } = rig();
    const [a, b] = await Promise.all([ask('same', 'user'), ask('same', 'user')]);
    expect(calls).toEqual(['same']);
    expect(await a.json()).toEqual(await b.json());
  });

  it('before AniList has told its limit nothing is held back (the first answer arrives within a second)', async () => {
    const { ask, calls } = rig();
    await Promise.all(Array.from({ length: 5 }, (_, i) => ask(`early${i}`)));
    expect(calls).toHaveLength(5);
  });

  it('other hosts pass straight through', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'));
    const gate = createAnilistGate({ fetchImpl });
    await gate.anilistFetch('https://api.jikan.moe/v4/x');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
