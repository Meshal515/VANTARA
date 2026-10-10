import { describe, expect, it } from 'vitest';
import {
  AUTOSTART_MS, createSettings, EMPTY_TTL_MS, HOST_GRACE_MS, LEAD_MS, normalizeCode, parseInvitees, positionAt, roomCode, RoomCore, versionMatch, type Out,
} from './together-core.ts';

const HOST = 'u-host';
const media = { key: 'anime:frieren:e5', kind: 'anime', label: 'Frieren 5' };
const msgs = (out: Out[]) => out.filter((o): o is Extract<Out, { msg: unknown }> => 'msg' in o);
const of = (out: Out[], t: string) => msgs(out).filter((o) => o.msg['t'] === t);

function room(input: Record<string, unknown> = {}, now = 1_000, allowed: string[] | '*' = '*') {
  const core = RoomCore.create(createSettings(input, HOST, 'ABCDEF', now, allowed), media as never, now);
  core.join({ conn: 'c-host', userId: HOST, name: 'المضيف', avatarKey: null }, now);
  return core;
}

describe('Together room core', () => {
  it('host commands are scheduled LEAD_MS ahead and carry an increasing seq', () => {
    const core = room();
    const out = core.handle('c-host', { t: 'cmd', op: 'play', pos: 12_000 }, 5_000);
    const state = of(out, 'state')[0]!.msg['state'] as { playing: boolean; pos: number; at: number; seq: number };
    expect(state).toMatchObject({ playing: true, pos: 12_000, at: 5_000 + LEAD_MS, seq: 1 });
    // بعد ثانيتين من الموعد: الموقع المرجعي تقدّم ثانيتين
    expect(positionAt(core.timeline, 5_000 + LEAD_MS + 2_000)).toBe(14_000);
    // قبل الموعد لا يُحسب تقدّم سالب
    expect(positionAt(core.timeline, 5_000)).toBe(12_000);
    const pause = of(core.handle('c-host', { t: 'cmd', op: 'pause' }, 9_000), 'state')[0]!.msg['state'] as { playing: boolean; pos: number; seq: number };
    expect(pause.playing).toBe(false);
    expect(pause.pos).toBe(12_000 + (9_000 + LEAD_MS - (5_000 + LEAD_MS)));
    expect(pause.seq).toBe(2);
  });

  it('only the host controls unless control=all', () => {
    const core = room();
    core.join({ conn: 'c-b', userId: 'u-b', name: 'دحمي', avatarKey: null }, 2_000);
    expect(of(core.handle('c-b', { t: 'cmd', op: 'play', pos: 0 }, 3_000), 'denied')).toHaveLength(1);
    expect(core.timeline.seq).toBe(0);
    core.handle('c-host', { t: 'settings', control: 'all' }, 3_000);
    expect(of(core.handle('c-b', { t: 'cmd', op: 'seek', pos: 60_000 }, 3_100), 'state')).toHaveLength(1);
    expect(core.timeline.pos).toBe(60_000);
  });

  it('announces joins to others, caps people not connections, and lets the same account reconnect', () => {
    const core = room();
    core.settings = { ...core.settings, cap: 2 };
    const out = core.join({ conn: 'c-b', userId: 'u-b', name: 'دحمي', avatarKey: 'a1' }, 2_000);
    expect(of(out, 'welcome')[0]!.to).toEqual(['c-b']);
    const joined = of(out, 'joined')[0]!;
    expect(joined).toMatchObject({ to: 'all', except: 'c-b', msg: { name: 'دحمي' } });
    // الغرفة ممتلئة لشخص ثالث
    expect(core.canJoin('u-c')).toBe(false);
    const full = core.join({ conn: 'c-c', userId: 'u-c', name: 'ثالث', avatarKey: null }, 2_100);
    expect(of(full, 'full')).toHaveLength(1);
    expect(full.some((o) => 'close' in o && o.close === 'c-c')).toBe(true);
    // نفس الحساب من اتصال جديد: يُستبدل القديم، ولا «دخل» مكرر
    expect(core.canJoin('u-b')).toBe(true);
    const again = core.join({ conn: 'c-b2', userId: 'u-b', name: 'دحمي', avatarKey: 'a1' }, 2_200);
    expect(again.some((o) => 'close' in o && o.close === 'c-b')).toBe(true);
    expect(of(again, 'joined')).toHaveLength(0);
    expect(core.members.size).toBe(2);
  });

  it('a buffering participant never changes the room timeline', () => {
    const core = room();
    core.join({ conn: 'c-b', userId: 'u-b', name: 'ب', avatarKey: null }, 2_000);
    core.handle('c-host', { t: 'cmd', op: 'play', pos: 0 }, 3_000);
    const before = { ...core.timeline };
    core.handle('c-b', { t: 'report', pos: 500, at: 4_000, state: 'buffering', source: 'torrent' }, 4_000);
    expect(core.timeline).toEqual(before);
    const roster = core.roster(4_000);
    expect(roster.find((r) => r.userId === 'u-b')).toMatchObject({ state: 'buffering', source: 'torrent' });
  });

  it('flags a different content version by duration, with tolerance', () => {
    expect(versionMatch({ durationMs: 1_440_000, pages: null }, { durationMs: 1_441_500, pages: null })).toBe(true);
    expect(versionMatch({ durationMs: 1_440_000, pages: null }, { durationMs: 1_530_000, pages: null })).toBe(false);
    expect(versionMatch({ durationMs: null, pages: 40 }, { durationMs: null, pages: 38 })).toBe(false);
    expect(versionMatch(null, { durationMs: 1, pages: null })).toBeNull();
    const core = room();
    core.join({ conn: 'c-b', userId: 'u-b', name: 'ب', avatarKey: null }, 2_000);
    core.handle('c-host', { t: 'report', pos: 0, state: 'playing', mediaKey: media.key, version: { durationMs: 1_440_000 } }, 3_000);
    core.handle('c-b', { t: 'report', pos: 0, state: 'playing', mediaKey: media.key, version: { durationMs: 1_530_000 } }, 4_100);
    const b = core.roster(4_100).find((r) => r.userId === 'u-b')!;
    expect(b.sameVersion).toBe(false);
    expect(b.sameMedia).toBe(true);
  });

  it('throttles roster broadcasts from position reports', () => {
    const core = room();
    expect(of(core.handle('c-host', { t: 'report', pos: 1, state: 'playing' }, 10_000), 'roster')).toHaveLength(1);
    expect(of(core.handle('c-host', { t: 'report', pos: 2, state: 'playing' }, 10_400), 'roster')).toHaveLength(0);
    expect(of(core.handle('c-host', { t: 'report', pos: 3, state: 'playing' }, 11_100), 'roster')).toHaveLength(1);
  });

  it('switching free → sync re-anchors the timeline at the host position', () => {
    const core = room({ mode: 'free' });
    core.handle('c-host', { t: 'cmd', op: 'play', pos: 0 }, 1_000);
    core.handle('c-host', { t: 'report', pos: 300_000, at: 50_000, state: 'playing' }, 50_000);
    core.handle('c-host', { t: 'mode', mode: 'sync' }, 51_000);
    expect(core.settings.mode).toBe('sync');
    expect(positionAt(core.timeline, 51_000)).toBe(301_000);
  });

  it('hands hosting to the oldest member after the host is away for the grace period', () => {
    const core = room();
    core.join({ conn: 'c-b', userId: 'u-b', name: 'ب', avatarKey: null }, 2_000);
    core.join({ conn: 'c-c', userId: 'u-c', name: 'ج', avatarKey: null }, 3_000);
    core.leave('c-host', 10_000);
    expect(core.nextDeadline()).toBe(10_000 + HOST_GRACE_MS);
    expect(core.tick(10_000 + HOST_GRACE_MS - 1).out).toHaveLength(0);
    const { out } = core.tick(10_000 + HOST_GRACE_MS);
    expect(of(out, 'host')[0]!.msg['userId']).toBe('u-b');
    // المضيف يعود قبل المهلة: لا انتقال
    const back = room();
    back.join({ conn: 'c-b', userId: 'u-b', name: 'ب', avatarKey: null }, 2_000);
    back.leave('c-host', 10_000);
    back.join({ conn: 'c-host2', userId: HOST, name: 'المضيف', avatarKey: null }, 20_000);
    expect(back.tick(10_000 + HOST_GRACE_MS).out).toHaveLength(0);
  });

  it('an empty room expires after its TTL', () => {
    const core = room();
    core.leave('c-host', 5_000);
    expect(core.tick(5_000 + EMPTY_TTL_MS - 1).expired).toBe(false);
    expect(core.tick(5_000 + EMPTY_TTL_MS).expired).toBe(true);
  });

  it('room codes avoid ambiguous characters and normalize case', () => {
    const code = roomCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(normalizeCode(code.toLowerCase())).toBe(code);
    expect(normalizeCode('ABC0EF')).toBeNull();
    // لا تحديد عدد: الغرفة على قدر المدعوين، والسقف 10
    expect(createSettings({ cap: 2 }, HOST, code, 0).cap).toBe(10);
  });

  it('only invited people get in; the host can add more later', () => {
    expect(parseInvitees(['u-b', 'u-b', HOST, 'ghost'], ['u-b', 'u-c', HOST], HOST)).toEqual(['u-b']);
    expect(parseInvitees('all', [], HOST)).toBe('*');
    expect(parseInvitees([], ['u-b'], HOST)).toBeNull();
    const core = room({}, 1_000, ['u-b']);
    expect(of(core.join({ conn: 'c-b', userId: 'u-b', name: 'ب', avatarKey: null }, 2_000), 'welcome')).toHaveLength(1);
    const out = core.join({ conn: 'c-c', userId: 'u-c', name: 'ج', avatarKey: null }, 2_100);
    expect(of(out, 'uninvited')).toHaveLength(1);
    expect(out.some((o) => 'close' in o && o.close === 'c-c')).toBe(true);
    expect(of(core.handle('c-b', { t: 'invite', userIds: ['u-c'] }, 2_200), 'denied')).toHaveLength(1);
    core.handle('c-host', { t: 'invite', userIds: ['u-c'] }, 2_300);
    expect(of(core.join({ conn: 'c-c2', userId: 'u-c', name: 'ج', avatarKey: null }, 2_400), 'welcome')).toHaveLength(1);
  });

  it('starts in the lobby; a late joiner after start sees started=true and goes straight in', () => {
    const core = room();
    expect(core.timeline.started).toBe(false);
    core.handle('c-host', { t: 'cmd', op: 'play', pos: 0 }, 5_000);
    expect(core.timeline.started).toBe(true);
    const late = core.join({ conn: 'c-late', userId: 'u-late', name: 'متأخر', avatarKey: null }, 65_000);
    const w = of(late, 'welcome')[0]!.msg as { state: { started: boolean; playing: boolean } };
    expect(w.state).toMatchObject({ started: true, playing: true });
    expect(positionAt(core.timeline, 65_000)).toBe(60_000 - LEAD_MS);
  });

  it('broadcasts state changes at once: preparing → ready → playing, and failed', () => {
    const core = room();
    core.join({ conn: 'c-b', userId: 'u-b', name: 'دحمي', avatarKey: null }, 2_000);
    const a = core.handle('c-b', { t: 'report', pos: 0, state: 'preparing', source: 'witanime' }, 3_000);
    expect(of(a, 'status')[0]!.msg).toMatchObject({ name: 'دحمي', state: 'preparing', source: 'witanime' });
    // نفس الحالة بعد 200ms: لا تنبيه ثانٍ
    expect(of(core.handle('c-b', { t: 'report', pos: 0, state: 'preparing' }, 3_200), 'status')).toHaveLength(0);
    expect(of(core.handle('c-b', { t: 'report', pos: 0, state: 'playing' }, 3_300), 'status')[0]!.msg).toMatchObject({ state: 'playing' });
    expect(of(core.handle('c-b', { t: 'report', pos: 0, state: 'failed', source: 'okru' }, 3_400), 'status')[0]!.msg).toMatchObject({ state: 'failed', source: 'okru' });
  });

  it('the next episode stays in the same room and starts itself when everyone is ready', () => {
    const core = room();
    core.join({ conn: 'c-b', userId: 'u-b', name: 'ب', avatarKey: null }, 2_000);
    core.handle('c-host', { t: 'cmd', op: 'play', pos: 0 }, 3_000);
    const next = { key: 'anime:frieren:e6', kind: 'anime', label: 'Frieren 6' };
    core.handle('c-host', { t: 'cmd', op: 'load', media: next }, 1_500_000);
    expect(core.timeline).toMatchObject({ started: false, autoStart: true, playing: false, pos: 0 });
    expect(core.timeline.media?.key).toBe(next.key);
    core.handle('c-host', { t: 'report', pos: 0, state: 'ready' }, 1_503_000);
    expect(core.timeline.started).toBe(false);
    const out = core.handle('c-b', { t: 'report', pos: 0, state: 'ready' }, 1_505_000);
    expect(of(out, 'state')).toHaveLength(1);
    expect(core.timeline).toMatchObject({ started: true, playing: true, at: 1_505_000 + LEAD_MS });
  });

  it('a slow participant cannot hold the next episode: it starts after the grace from host ready', () => {
    const core = room();
    core.join({ conn: 'c-b', userId: 'u-b', name: 'ب', avatarKey: null }, 2_000);
    core.handle('c-host', { t: 'cmd', op: 'load', media: { key: 'anime:x:e2', kind: 'anime', label: 'x 2' } }, 10_000);
    core.handle('c-b', { t: 'report', pos: 0, state: 'preparing' }, 10_500);
    core.handle('c-host', { t: 'report', pos: 0, state: 'ready' }, 11_000);
    expect(core.nextDeadline()).toBe(11_000 + AUTOSTART_MS);
    expect(core.tick(11_000 + AUTOSTART_MS - 1).out).toHaveLength(0);
    expect(of(core.tick(11_000 + AUTOSTART_MS).out, 'state')).toHaveLength(1);
    expect(core.timeline.started).toBe(true);
  });
});
