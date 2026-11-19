import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createTogether, LEFT_GRACE_MS } from './together.js';

/**
 * إصلاحات غرفة المشاهدة (19 نوفمبر، بلاغ المالك و#349): لوحة لا تُبنى تحت الإصبع (TG3)، وتنبيه «اشتغل الفيديو»
 * مرة لكل حلقة (WT1)، و«طلع/دخل» لا تظهر لانقطاع لحظي (WT8). الغرفة مزيّفة بالواجهة نفسها التي يستعملها الهب.
 */
function roomOf(roster) {
  const listeners = new Map();
  return {
    timeline: { media: { key: 'anime:1#3', kind: 'anime', label: 'Frieren — الحلقة 3' }, started: true, playing: true, pos: 0, at: 0, seq: 1 },
    info: { mode: 'sync', hostUserId: 'me' }, isHost: true, canControl: true, me: 'me', status: 'live', roster,
    clock: { serverNow: () => 10_000 }, close: vi.fn(), command: vi.fn(), kick: vi.fn(), giveHost: vi.fn(), setMode: vi.fn(), report: vi.fn(),
    on(e, fn) { const set = listeners.get(e) ?? new Set(); set.add(fn); listeners.set(e, set); return () => set.delete(fn); },
    emit(e, data) { for (const fn of listeners.get(e) ?? []) fn(data); },
  };
}
const member = (userId, name, extra = {}) => ({ userId, name, state: 'playing', host: userId === 'me', pos: 1000, at: 10_000, joinedAt: 1, ...extra });

function hubWith(room, extra = {}) {
  const toast = vi.fn();
  const hub = createTogether({ sync: {}, baseUrl: () => 'https://sync.test', joinRoomImpl: () => room, openMedia: vi.fn(), toast, avatarNode: () => null, ...extra });
  hub.joinByCode('ABCDEF', { media_json: JSON.stringify({ seriesRef: 'anime:1', kind: 'anime', key: 'anime:1#3' }), mode: 'sync' });
  return { hub, toast };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('WT1: «اشتغل الفيديو عند X» مرة لكل شخص في كل حلقة', () => {
  it('a pause and resume do not repeat the toast; a new episode announces again', () => {
    const room = roomOf([member('me', 'أنا'), member('f', 'منصور')]);
    const { hub, toast } = hubWith(room);
    room.emit('status', { userId: 'f', name: 'منصور', state: 'playing' });
    room.emit('status', { userId: 'f', name: 'منصور', state: 'paused' });
    room.emit('status', { userId: 'f', name: 'منصور', state: 'playing' });
    expect(toast.mock.calls.filter(([t]) => t.includes('اشتغل الفيديو عند منصور'))).toHaveLength(1);
    room.timeline = { ...room.timeline, media: { ...room.timeline.media, key: 'anime:1#4' } };
    room.emit('status', { userId: 'f', name: 'منصور', state: 'playing' });
    expect(toast.mock.calls.filter(([t]) => t.includes('اشتغل الفيديو عند منصور'))).toHaveLength(2);
    hub.leave();
  });
});

describe('WT8: انقطاع لحظي لا يُعلن «طلع» ثم «دخل»', () => {
  it('a reconnect inside the grace window is silent; a real leave is announced after it', () => {
    vi.useFakeTimers();
    const room = roomOf([member('me', 'أنا'), member('f', 'منصور')]);
    const { hub, toast } = hubWith(room);
    room.emit('left', { name: 'منصور', kicked: false });
    vi.advanceTimersByTime(2000);
    room.emit('joined', { name: 'منصور' });
    vi.advanceTimersByTime(LEFT_GRACE_MS * 2);
    expect(toast).not.toHaveBeenCalled();
    room.emit('left', { name: 'منصور', kicked: false });
    vi.advanceTimersByTime(LEFT_GRACE_MS - 1);
    expect(toast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(toast).toHaveBeenCalledWith('منصور طلع');
    hub.leave();
  });
  it('a kick is announced at once, and leaving the room cancels pending announcements', () => {
    vi.useFakeTimers();
    const room = roomOf([member('me', 'أنا'), member('f', 'منصور')]);
    const { hub, toast } = hubWith(room);
    room.emit('left', { name: 'فهد', kicked: true });
    expect(toast).toHaveBeenCalledWith('المضيف أخرج فهد');
    room.emit('left', { name: 'منصور', kicked: false });
    hub.leave();
    vi.advanceTimersByTime(LEFT_GRACE_MS * 2);
    expect(toast).toHaveBeenCalledTimes(1);
  });
});

describe('TG3: لوحة الغرفة لا تُبنى من جديد تحت الإصبع', () => {
  function openPanel(room) {
    const { document } = parseHTML('<!doctype html><html><body></body></html>');
    vi.stubGlobal('document', document);
    vi.stubGlobal('requestAnimationFrame', (fn) => fn());
    let body = null, cleanup = null;
    const { hub } = hubWith(room, { openSheet: (build) => { body = document.createElement('div'); document.body.append(body); cleanup = build(body); }, closeSheet: vi.fn() });
    hub.openPanel();
    return { hub, body: () => body, close: () => cleanup?.() };
  }
  it('position and drift update in place: the kick button stays the same element', () => {
    vi.useFakeTimers();
    const room = roomOf([member('me', 'أنا'), member('f', 'منصور', { driftMs: 120 })]);
    const p = openPanel(room);
    const kick = [...p.body().querySelectorAll('button')].find((b) => b.textContent.includes('أخرج'));
    expect(kick).toBeTruthy();
    room.roster = [member('me', 'أنا'), member('f', 'منصور', { driftMs: 340, pos: 61_000 })];
    room.emit('roster', room.roster);
    vi.advanceTimersByTime(3000);
    expect(kick.isConnected).toBe(true);
    expect(p.body().textContent).toContain('فرق 340ms');
    expect(p.body().textContent).toContain('1:01');
    p.close(); p.hub.leave();
  });
  it('a real change (state, who is in the room) still rebuilds the list', () => {
    vi.useFakeTimers();
    const room = roomOf([member('me', 'أنا'), member('f', 'منصور')]);
    const p = openPanel(room);
    const before = p.body().querySelector('.tg-row');
    room.roster = [member('me', 'أنا'), member('f', 'منصور', { state: 'buffering' })];
    room.emit('roster', room.roster);
    expect(before.isConnected).toBe(false);
    expect(p.body().querySelectorAll('.tg-row')).toHaveLength(2);
    p.close(); p.hub.leave();
  });
});
