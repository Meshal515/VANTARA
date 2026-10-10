import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTogetherPlayer } from './together-player.js';

function fixture(host = false, existingTimeline = null) {
  const events = new Map();
  const room = { status: 'live', me: host ? 'host' : 'guest', isHost: host, canControl: host,
    info: { mode: 'sync' }, timeline: { media: { key: 'anime:42#1', kind: 'anime' }, started: false, playing: false, pos: 0, at: 1000, seq: 0 },
    roster: [], clock: { serverNow: () => 1000 }, command: vi.fn(), report: vi.fn(),
    on: (e, fn) => { const set = events.get(e) ?? new Set(); set.add(fn); events.set(e, set); return () => set.delete(fn); },
  };
  if (existingTimeline) room.timeline = {...room.timeline, ...existingTimeline};
  const video = { currentTime: 0, duration: 1200, readyState: 4, paused: false, playbackRate: 1,
    buffered: { length: 1, start: () => 0, end: () => 1200 }, play: vi.fn(function () { this.paused = false; return Promise.resolve(); }), pause: vi.fn(function () { this.paused = true; }) };
  let episode = 1;
  const hooks = { episode: () => episode, source: () => 'local-server', onEpisode: vi.fn(n => { episode = n; }), onLobby: vi.fn(), message: vi.fn() };
  const bridge = createTogetherPlayer({ room, mode: 'sync', mediaPrefix: 'anime:42', video, ...hooks });
  const receive = state => { room.timeline = state; for (const fn of events.get('state') ?? []) fn({ state, by: 'host' }); };
  return { room, video, bridge, hooks, receive, events };
}
afterEach(() => vi.useRealTimers());
describe('web Together player uses Android room protocol', () => {
  it('reports ready and waits for the host instead of silently playing locally', () => {
    vi.useFakeTimers(); const f = fixture(); f.bridge.ready();
    expect(f.video.paused).toBe(true); expect(f.room.report).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready', mediaKey: 'anime:42#1', version: { durationMs: 1200000 } }));
    f.bridge.destroy(); expect([...f.events.values()].every(s => !s.size)).toBe(true);
  });
  it('starts, pauses and seeks from host commands, including late join', () => {
    vi.useFakeTimers(); const f = fixture();
    f.video.paused = true;
    f.receive({ ...f.room.timeline, started: true, playing: true, pos: 42000, seq: 1 }); f.bridge.ready();
    expect(f.video.currentTime).toBeCloseTo(42); expect(f.video.play).toHaveBeenCalled();
    f.receive({ ...f.room.timeline, playing: false, pos: 90000, seq: 2 });
    expect(f.video.paused).toBe(true); expect(f.video.currentTime).toBe(90); f.bridge.destroy();
  });
  it('reconciles an episode transition received before the player mounted', () => {
    vi.useFakeTimers(); const f=fixture(false,{media:{key:'anime:42#2',kind:'anime'},started:true,playing:false,pos:42000,seq:2});
    f.bridge.ready(); expect(f.hooks.onEpisode).toHaveBeenCalledOnce(); expect(f.hooks.onEpisode).toHaveBeenCalledWith(2);
    expect(f.room.report).toHaveBeenLastCalledWith(expect.objectContaining({state:'preparing'}));
    f.bridge.ready(); expect(f.video.currentTime).toBe(42); expect(f.video.paused).toBe(true); f.bridge.destroy();
  });
  it('keeps host controls on the wire and guest controls out of it', () => {
    vi.useFakeTimers(); const h = fixture(true); h.bridge.ready(); h.bridge.playPause(true); h.bridge.seek(80000);
    expect(h.room.command).toHaveBeenCalledWith('play', { pos: 0 }); expect(h.room.command).toHaveBeenCalledWith('seek', { pos: 80000 });
    const g = fixture(); g.bridge.ready(); g.bridge.playPause(true); g.bridge.seek(80000); expect(g.room.command).not.toHaveBeenCalled();
    h.bridge.destroy(); g.bridge.destroy();
  });
  it('changes episode in the same room and lets a failed guest stay independent', () => {
    vi.useFakeTimers(); const f = fixture(); f.bridge.ready(); f.bridge.failed();
    expect(f.room.report).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'failed' })); expect(f.room.command).not.toHaveBeenCalled();
    f.receive({ ...f.room.timeline, media: { key: 'anime:42#2', kind: 'anime' }, seq: 1 }); expect(f.hooks.onEpisode).toHaveBeenCalledWith(2); f.bridge.destroy();
  });
  it('does not control playback while disconnected or in separate mode', () => {
    vi.useFakeTimers(); const f = fixture(); f.room.info.mode = 'free'; f.bridge.ready(); f.bridge.seek(50000);
    expect(f.room.command).not.toHaveBeenCalled(); expect(f.video.paused).toBe(false);
    f.room.info.mode = 'sync'; f.room.status = 'reconnecting'; vi.advanceTimersByTime(2500); expect(f.video.paused).toBe(false); f.bridge.destroy();
  });
  it('applies a scheduled host command at its shared instant and cancels superseded commands', () => {
    vi.useFakeTimers(); const f = fixture(); let now = 1000; f.room.clock.serverNow = () => now;
    f.bridge.ready(); f.video.play.mockClear();
    f.receive({...f.room.timeline,started:true,playing:true,pos:2000,at:1300,seq:1});
    expect(f.video.play).not.toHaveBeenCalled();
    now=1300; vi.advanceTimersByTime(300); expect(f.video.currentTime).toBe(2); expect(f.video.play).toHaveBeenCalledOnce();
    f.receive({...f.room.timeline,playing:true,pos:4000,at:1600,seq:2});
    f.receive({...f.room.timeline,playing:false,pos:3000,at:1500,seq:3});
    now=1700;vi.advanceTimersByTime(400);expect(f.video.paused).toBe(true);expect(f.video.currentTime).toBe(3);f.bridge.destroy();
  });
});
