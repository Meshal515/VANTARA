import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopTogetherPlayer } from './together-player.js';

function fixture(host = false, timeline = {}) {
  const listeners = new Map();
  let now = 1000, episode = 1;
  const room = { status: 'live', me: host ? 'host' : 'guest', isHost: host, canControl: host, info: { mode: 'sync' },
    timeline: { media: { key: 'cinema:tt123#1', kind: 'cinema' }, started: false, playing: false, pos: 0, at: 1000, seq: 0, ...timeline },
    roster: [{ userId: 'host', name: 'Meshal', avatarKey: '/avatars/meshal.webp', state: 'ready', host: true }], clock: { serverNow: () => now }, report: vi.fn(), command: vi.fn(), close: vi.fn(),
    on(name, fn) { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn); },
  };
  const handOff = { room, mode: 'sync' };
  const hub = { session: handOff, openPanel: vi.fn(), leave: vi.fn(), onChange(fn) { listeners.set('hub-change', new Set([fn])); return () => listeners.get('hub-change').delete(fn); } };
  const bridge = { playbackCommand: vi.fn(async () => ({ ok: true })) };
  const hooks = { onLobby: vi.fn(), onEpisode: vi.fn(n => { episode = n; }), onDetach: vi.fn(), message: vi.fn() };
  const player = createDesktopTogetherPlayer({ together: { hub, session: handOff, mediaPrefix: 'cinema:tt123' }, bridge, session: 'mpv-session', episode: () => episode, source: () => 'سيرفر محلي', ...hooks });
  const emit = (name, data) => { for (const fn of listeners.get(name) ?? []) fn(data); };
  const state = update => { room.timeline = { ...room.timeline, ...update }; emit('state', { state: room.timeline, by: 'host' }); };
  const event = (type, data = {}) => player.progressEvent({ type: `playback/${type}`, session: 'mpv-session', ...data });
  return { player, room, hub, bridge, hooks, listeners, state, emit, event, now: value => { now = value; } };
}
afterEach(() => vi.useRealTimers());

describe('مشاهدة ويندوز المشتركة تستخدم الغرفة الأصلية بالمللي ثانية', () => {
  it('مغادرة الغرفة أو استبدال عضويتها يفصل التحكم ويزيل المؤقت دون مغادرة إضافية', () => {
    vi.useFakeTimers();
    for (const replaced of [false, true]) {
      const f = fixture(); f.event('ready'); f.bridge.playbackCommand.mockClear();
      if (replaced) { f.hub.session = {}; f.emit('hub-change'); }
      else { f.room.status = 'closed'; f.emit('connection', 'closed'); }
      f.event('ready'); f.state({ started: true, playing: true, pos: 55000 });
      expect(f.bridge.playbackCommand).not.toHaveBeenCalled();
      expect([...f.listeners.values()].every(set => !set.size)).toBe(true);
      expect(vi.getTimerCount()).toBe(0); expect(f.hub.leave).not.toHaveBeenCalled();
      expect(f.room.close).not.toHaveBeenCalled(); expect(f.hooks.onDetach).toHaveBeenCalledOnce(); f.player.close();
      expect(f.hooks.onDetach).toHaveBeenCalledOnce();
    }
  });
  it('توقف المشغل وتبلغ جاهزيته قبل بدء المضيف وتتيح فتح لوحة الغرفة', () => {
    vi.useFakeTimers(); const f = fixture();
    f.event('progress', { position: 1200, duration: 120000 }); f.event('ready');
    expect(f.bridge.playbackCommand).toHaveBeenCalledWith({ session: 'mpv-session', command: 'pause', value: true });
    expect(f.room.report).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready', pos: 1200, mediaKey: 'cinema:tt123#1', version: { durationMs: 120000 } }));
    const lobby = f.hooks.onLobby.mock.lastCall[0]; expect(lobby.visible).toBe(true); expect(lobby.roster[0].avatarKey).toBe('/avatars/meshal.webp');
    lobby.openPanel(); expect(f.hub.openPanel).toHaveBeenCalledOnce(); f.player.close();
  });
  it('يلحق الداخل المتأخر ثم يتبع توقف المضيف وتقديمه دون تحويل المللي إلى ثوان', () => {
    vi.useFakeTimers(); const f = fixture(false, { started: true, playing: true, pos: 42000, seq: 1 });
    f.event('ready');
    expect(f.bridge.playbackCommand).toHaveBeenCalledWith({ session: 'mpv-session', command: 'seek', value: 42000 });
    expect(f.bridge.playbackCommand).toHaveBeenCalledWith({ session: 'mpv-session', command: 'pause', value: false });
    f.state({ playing: false, pos: 90000, seq: 2 });
    expect(f.bridge.playbackCommand).toHaveBeenCalledWith({ session: 'mpv-session', command: 'seek', value: 90000 });
    expect(f.bridge.playbackCommand).toHaveBeenCalledWith({ session: 'mpv-session', command: 'pause', value: true }); f.player.close();
  });
  it('أزرار المضيف وأحداث التحكم الأصلية ترسل الأوامر للغرفة ولا تعيد صدى أوامرها', () => {
    vi.useFakeTimers(); const f = fixture(true); f.event('ready');
    f.hooks.onLobby.mock.lastCall[0].start(); expect(f.room.command).toHaveBeenLastCalledWith('play', { pos: 0 });
    f.state({ started: true, playing: true, pos: 0, seq: 1 });
    f.event('pause', { paused: false }); expect(f.room.command).toHaveBeenCalledTimes(1);
    f.event('pause', { paused: true }); expect(f.room.command).toHaveBeenLastCalledWith('pause', { pos: 0 });
    f.event('seek', { position: 55000 }); expect(f.room.command).toHaveBeenLastCalledWith('seek', { pos: 55000 }); f.player.close();
  });
  it('تحكم الضيف الأصلي لا يحرك الغرفة ويعود إلى وقت المضيف', () => {
    vi.useFakeTimers(); const f = fixture(false, { started: true, playing: true, pos: 40000, seq: 1 }); f.event('ready');
    f.event('seek', { position: 80000 });
    expect(f.room.command).not.toHaveBeenCalled();
    expect(f.bridge.playbackCommand).toHaveBeenLastCalledWith({ session: 'mpv-session', command: 'seek', value: 40000 }); f.player.close();
  });
  it('تنفذ أوامر المضيف المجدولة عند لحظة الغرفة وتلغي القديم', () => {
    vi.useFakeTimers(); const f = fixture(); f.event('ready'); f.bridge.playbackCommand.mockClear();
    f.state({ started: true, playing: true, pos: 2000, at: 1300, seq: 1 }); expect(f.bridge.playbackCommand).not.toHaveBeenCalled();
    f.now(1300); vi.advanceTimersByTime(300); expect(f.bridge.playbackCommand).toHaveBeenCalledWith({ session: 'mpv-session', command: 'seek', value: 2000 });
    f.state({ playing: true, pos: 4000, at: 1600, seq: 2 }); f.state({ playing: false, pos: 3000, at: 1500, seq: 3 });
    f.now(1700); vi.advanceTimersByTime(400); expect(f.bridge.playbackCommand).toHaveBeenCalledWith({ session: 'mpv-session', command: 'seek', value: 3000 }); f.player.close();
  });
  it('تبديل الحلقة ينتظر جاهزية سيرفر الشخص في الغرفة نفسها', () => {
    vi.useFakeTimers(); const f = fixture(); f.event('ready'); f.state({ media: { key: 'cinema:tt123#2', kind: 'cinema' }, started: true, playing: true, pos: 12000, seq: 1 });
    expect(f.hooks.onEpisode).toHaveBeenCalledWith(2); expect(f.room.report).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'preparing' }));
    f.event('ready'); expect(f.bridge.playbackCommand).toHaveBeenCalledWith({ session: 'mpv-session', command: 'seek', value: 12000 });
    expect(f.hub.leave).not.toHaveBeenCalled(); f.player.close();
  });
  it('لا يزامن حين ينقطع الاتصال أو في الوضع المنفصل ويحذف المستمعات دون مغادرة الغرفة', () => {
    vi.useFakeTimers(); const f = fixture(); f.room.info.mode = 'free'; f.event('ready'); f.bridge.playbackCommand.mockClear();
    f.event('pause', { paused: true }); f.event('seek', { position: 80000 }); expect(f.room.command).not.toHaveBeenCalled();
    f.room.info.mode = 'sync'; f.room.status = 'reconnecting'; vi.advanceTimersByTime(2500); expect(f.bridge.playbackCommand).not.toHaveBeenCalled();
    f.player.close(); expect([...f.listeners.values()].every(set => !set.size)).toBe(true); expect(f.room.close).not.toHaveBeenCalled(); expect(f.hub.leave).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('يتجاهل أحداث جلسة أخرى ويبلغ فشل السيرفر دون إيقاف باقي الغرفة', () => {
    vi.useFakeTimers(); const f = fixture(); f.player.progressEvent({ type: 'playback/progress', session: 'other', position: 99999 }); f.event('ready');
    expect(f.room.report).toHaveBeenLastCalledWith(expect.objectContaining({ pos: 0 })); f.event('error');
    expect(f.room.report).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'failed' })); expect(f.room.command).not.toHaveBeenCalled(); f.player.close();
  });
  it('لا يقفز أثناء التحميل ويلحق بعد زواله ثم يرسل سرعة تصحيح محدودة', () => {
    vi.useFakeTimers(); const f = fixture(false, { started: true, playing: true, pos: 40000, seq: 1 }); f.event('ready');
    f.event('state', { position: 40000, buffering: true }); f.bridge.playbackCommand.mockClear();
    f.state({ pos: 90000, seq: 2 }); expect(f.bridge.playbackCommand.mock.calls.filter(([c]) => c.command === 'seek')).toHaveLength(0);
    f.event('state', { position: 40000, buffering: false });
    f.now(1500); vi.advanceTimersByTime(500); f.now(2000); vi.advanceTimersByTime(500);
    expect(f.bridge.playbackCommand.mock.calls.some(([c]) => c.command === 'seek' && c.value >= 90000)).toBe(true);
    f.player.close();
  });
  it('يرجع لموضع الغرفة بعد عودة الاتصال ويحد سرعة التصحيح بنطاق MPV', () => {
    vi.useFakeTimers(); const f = fixture(false, { started: true, playing: true, pos: 40000, seq: 1 }); f.event('ready');
    f.room.status = 'reconnecting'; f.event('progress', { position: 10000 }); f.bridge.playbackCommand.mockClear();
    f.room.status = 'live'; f.emit('connection', 'live');
    expect(f.bridge.playbackCommand).toHaveBeenCalledWith({ session: 'mpv-session', command: 'seek', value: 40000 });
    for (let i = 1; i <= 5; i++) { f.now(1000 + i * 500); f.event('progress', { position: 40500 + i * 500 }); vi.advanceTimersByTime(500); }
    const rates = f.bridge.playbackCommand.mock.calls.filter(([c]) => c.command === 'rate').map(([c]) => c.value);
    expect(rates.length).toBeGreaterThan(0); expect(rates.every(rate => rate >= 0.95 && rate <= 1.05)).toBe(true);
    f.room.status='closed';f.emit('connection','closed');
    expect(f.bridge.playbackCommand).toHaveBeenLastCalledWith({session:'mpv-session',command:'rate',value:1});
    expect(f.hooks.onDetach).toHaveBeenCalledOnce();f.player.close();
  });
});
