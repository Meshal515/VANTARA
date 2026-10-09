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
it.each([null,720])('publishes a master labelled %s immediately and its real levels in background without autoplay', async (quality) => {
 let release;
 state.runtime.fetcher.ensureGrant=async()=> 'grant';
 src.servers=async()=>[server('fast')]; src.streams=async()=>[{url:'https://cdn.test/master.m3u8',type:'hls',quality}];
 vi.stubGlobal('fetch',async (url,options)=>{
  if(!options?.headers?.range) { await new Promise(r=>{release=r;}); return new Response('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\n1080.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720.m3u8',{headers:{'content-type':'application/vnd.apple.mpegurl'}}); }
  return new Response('#EXTM3U',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 });
 const session=await prepare();
 expect((await AnimeEngine.routes({session})).routes.some(r=>r.state==='READY')).toBe(true);
 expect(release).toBeTypeOf('function'); release(); await vi.advanceTimersByTimeAsync(0);
 expect((await AnimeEngine.routes({session})).routes.filter(r=>r.state==='READY').map(r=>r.quality)).toEqual(quality === null ? [null,1080,720] : [720,1080]); expect(state.play).not.toHaveBeenCalled();
});
it('never reuses season-one addon episodes for season two with the same work URL',async()=>{
 const cache=new Map();state.runtime.store.cached=async(_area,key,fn)=>{if(!cache.has(key))cache.set(key,await fn());return {value:cache.get(key)};};
 state.runtime.registry.def=()=>({...def,manifest:{version:'1.0.0'}});
 src.episodes=async c=>[{url:`https://addon.test/${c.requestedSeason}/1`,number:1,season:c.requestedSeason}];
 src.servers=async ep=>[server(`season-${ep.season}`)];src.streams=async()=>[stream(720)];
 for(const season of [1,2]){const p=await AnimeEngine.prepare({copies:[{...copy,sourceId:'addon|demo',requestedSeason:season}],episode:1});sessions.push(p.session);await vi.advanceTimersByTimeAsync(0);expect((await AnimeEngine.routes({session:p.session})).routes[0].server).toBe(`season-${season}`);}
});
it('matches both season and episode when a remote response includes all seasons',async()=>{
 const used=[];src.episodes=async()=>[{url:'s1e1',number:1,season:1},{url:'s2e1',number:1,season:2}];src.servers=async ep=>{used.push(ep.url);return [server('fast')];};src.streams=async()=>[stream(720)];
 const p=await AnimeEngine.prepare({copies:[{...copy,sourceId:'addon|demo',requestedSeason:2}],episode:1});sessions.push(p.session);await vi.advanceTimersByTimeAsync(0);expect(used).toEqual(['s2e1']);
});
it.each([{status:'EXPIRED',reason:'expired'},{status:'UNSUPPORTED',reason:'headers'},{status:'RESOLVED',type:'dash',reason:'dash'}])('never marks rejected Remote stream $reason READY',async rejected=>{
 src.servers=async()=>[server('fast')];src.streams=async()=>[{...stream(1080),addonKey:'demo',...rejected}];const session=await prepare();
 const routes=(await AnimeEngine.routes({session})).routes;expect(routes.some(r=>r.state==='READY')).toBe(false);expect(routes[0].reason).not.toContain('RESOLVER_EMPTY');expect(state.play).not.toHaveBeenCalled();
});
it('retains the effective addon copy and season for the next episode',async()=>{
 const {nextEpisodeCopies}=await import('../../addons/video.js');
 src.episodes=async c=>[{url:`s${c.requestedSeason}e${c.episode}`,number:c.episode,season:c.requestedSeason}];const used=[];src.servers=async ep=>{used.push(ep.url);return [server('fast')];};src.streams=async()=>[stream(720)];
 const first=await AnimeEngine.prepare({copies:[{...copy,sourceId:'addon|demo',type:'series',requestedSeason:2,episode:1}],episode:1});sessions.push(first.session);await vi.advanceTimersByTimeAsync(0);
 const second=await AnimeEngine.prepare({copies:nextEpisodeCopies(first.copies,2,{kind:'series',season:2}),episode:2});sessions.push(second.session);await vi.advanceTimersByTimeAsync(0);expect(used).toEqual(['s2e1','s2e2']);expect(state.play).not.toHaveBeenCalled();
});
it('preserves addon subtitle matching metadata through preparation without autoplay',async()=>{
 src.servers=async()=>[server('fast')];
 src.streams=async()=>[{...stream(1080),addonKey:'demo',filename:'actual.mkv',videoHash:'0123456789abcdef',videoSize:12345}];
 const session=await prepare();const {candidate}=await AnimeEngine.best({session});
 await AnimeEngine.play({session,candidate});expect(state.play.mock.calls[0][0].sessionOf(session).cands.get(candidate)).toMatchObject({filename:'actual.mkv',videoHash:'0123456789abcdef',videoSize:12345});
});
it('retains the friendly provider label in ready and rejected routes without autoplay', async () => {
  const session = await prepare();
  const routes = (await AnimeEngine.routes({ session })).routes;
  expect(routes.length).toBeGreaterThan(0);
  expect(routes.every(r => r.sourceName === 'Video')).toBe(true);
  expect(state.play).not.toHaveBeenCalled();
});
it('uses the active PWA episode for cached Kitsu copies and later extension',async()=>{
 const used=[];
 src.episodes=async c=>[{url:`kitsu:12:${c.identity.episode}`,number:c.identity.episode}];
 src.servers=async ep=>{used.push(ep.url);return [server('fast')];};src.streams=async()=>[stream(1080)];
 const stale={...copy,sourceId:'addon|demo',episode:1,identity:{kind:'anime',format:'TV',episode:1,externalIds:{kitsu:'12'}}};
 const first=await AnimeEngine.prepare({copies:[stale],episode:2});sessions.push(first.session);await vi.advanceTimersByTimeAsync(0);
 const second=await AnimeEngine.prepare({copies:[],episode:3});sessions.push(second.session);await AnimeEngine.extend({session:second.session,copies:[stale]});await vi.advanceTimersByTimeAsync(0);
 expect(used).toEqual(['kitsu:12:2','kitsu:12:3']);expect(state.play).not.toHaveBeenCalled();
});
