import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ runtime: null, play: vi.fn() }));
vi.mock('../runtime.js', () => ({ getRuntime: () => state.runtime }));
vi.mock('../../lib/capabilities.js', () => ({ supports: () => true }));
vi.mock('../player/player.js', () => ({ openPlayer: state.play }));
const { AnimeEngine } = await import('./anime.js');
const def = { id: 'test-video', label: 'Video', content: 'anime' };
const episode = { sourceId: def.id, url: '/episode/1', number: 1 };
const copy = { sourceId: def.id, url: '/work', title: 'Work' };
const stream = (quality) => ({ url: `https://cdn.test/${quality}.mp4`, type: 'mp4', quality });
const server = (name) => ({ key: name, name, data: { url: `https://${name}.test/embed/1` } });
const sessions = [];
let src;
beforeEach(() => {
  vi.useFakeTimers();
  state.play.mockClear();
  src = { search: async () => [copy], episodes: async () => [episode], servers: async () => [server('fast'), server('dead')], streams: async (sv) => sv.name === 'fast' ? [stream(720)] : new Promise(() => {}) };
  state.runtime = {
    ready: Promise.resolve(),
    registry: { source: () => src, def: () => def, call: async (_id, f) => f(src) },
    store: { cached: async (_area, _key, fn) => ({ value: await fn() }) },
    ensureMedia: async () => {}, fetcher: { mediaUrl: (u) => u },
  };
  vi.stubGlobal('fetch', async () => new Response(null, { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1/200000000' } }));
});
afterEach(async () => {
  for (const session of sessions.splice(0)) await AnimeEngine.closeSession({ session });
  vi.useRealTimers(); vi.unstubAllGlobals();
});
const prepare = async () => { const s = await AnimeEngine.prepare({ copies: [copy], episode: 1 }); sessions.push(s.session); await vi.advanceTimersByTimeAsync(0); return s.session; };

describe('resolver readiness and user choice', () => {
  it('publishes a ready server while a dead backup is still pending, without opening the player', async () => {
    const session = await prepare();
    const snap = await AnimeEngine.routes({ session });
    expect(snap.done).toBe(false);
    expect(snap.routes.find((r) => r.server === 'fast')).toMatchObject({ state: 'READY', probed: true });
    expect(snap.routes.find((r) => r.server === 'dead').state).toBe('RESOLVING');
    expect(await AnimeEngine.best({ session, waitMs: 1 })).toMatchObject({ candidate: expect.any(String) });
    expect(state.play).not.toHaveBeenCalled();
    await AnimeEngine.play({ session, candidate: (await AnimeEngine.best({ session })).candidate });
    expect(state.play).toHaveBeenCalledTimes(1);
  });
  it('does not publish late callbacks after a resolver deadline completes preparation', async () => {
    let callback;
    src.servers = async () => [server('fast')];
    src.streams = async (_server, accept) => { callback = accept; return new Promise(() => {}); };
    const session = await prepare();
    await vi.advanceTimersByTimeAsync(45000);
    expect((await AnimeEngine.routes({ session })).done).toBe(true);
    callback([stream(480)]); await vi.advanceTimersByTimeAsync(0);
    expect((await AnimeEngine.routes({ session })).routes.some((r) => r.state === 'READY')).toBe(false);
  });
  it('exposes the first validated quality while another quality is still being checked', async () => {
    let finish;
    src.streams = async (sv) => sv.name === 'fast' ? [stream(1080), stream(480)] : new Promise(() => {});
    vi.stubGlobal('fetch', async (url) => {
      if (url.includes('480')) await new Promise((r) => { finish = r; });
      return new Response(null, { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1/200000000' } });
    });
    const session = await prepare();
    expect((await AnimeEngine.routes({ session })).routes.some((r) => r.state === 'READY' && r.quality === 1080)).toBe(true);
    expect(state.play).not.toHaveBeenCalled();
    finish(); await vi.advanceTimersByTimeAsync(0);
    const routes = (await AnimeEngine.routes({ session })).routes.filter((r) => r.state === 'READY');
    expect(routes.map((r) => r.quality).sort()).toEqual([1080, 480]);
    const selected = await AnimeEngine.pick({ session, route: routes.find((r) => r.quality === 480).id });
    expect(selected.candidate).toBeTruthy();
    expect(selected.candidate).not.toBe((await AnimeEngine.pick({ session, route: routes.find((r) => r.quality === 1080).id })).candidate);
  });
});

describe('diagnostic verdicts', () => {
  it('zero streams is RESOLVER_EMPTY and reports every discovered server with its host', async () => {
    src.servers = async () => ['one', 'two', 'three', 'four'].map(server);
    src.streams = async () => [];
    const { steps } = await AnimeEngine.diagnose({ sourceId: def.id });
    const playback = steps.filter((s) => s.label.startsWith('تشغيل'));
    expect(playback).toHaveLength(4);
    expect(playback.every((s) => s.state === 'fail' && s.detail.includes('RESOLVER_EMPTY'))).toBe(true);
    expect(playback[0].detail).toContain('one.test');
  });
});
