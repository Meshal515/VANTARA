import { createDriftController, targetAt } from '../../lib/together/sync.js';

/** Bind the existing HTML video to the same millisecond room protocol as Android. */
export function createTogetherPlayer({ room, mode, mediaPrefix, video, episode, source, onEpisode, onLobby, message }) {
  const controller = createDriftController();
  let prepared = false;
  let failed = false;
  let blocked = false;
  let seekingAt = null;
  let lastReport = -Infinity;
  let lastState = null;
  let loadingEpisode = null;
  let destroyed = false;
  let scheduled = null;
  const synced = () => (room.info?.mode ?? mode) === 'sync';
  const mediaKey = () => `${mediaPrefix}#${episode()}`;
  const live = () => room.status === 'live';
  const position = () => (video.currentTime || 0) * 1000;
  const stateNow = () => failed ? 'failed' : !prepared ? 'preparing' : synced() && !room.timeline?.started ? 'ready' : video.readyState < 3 ? 'buffering' : video.paused ? 'paused' : 'playing';
  function report(force = false) {
    const now = room.clock.serverNow();
    const state = stateNow();
    if (!force && state === lastState && now - lastReport < 2000) return;
    lastState = state; lastReport = now;
    room.report({ pos: position(), at: now, state, source: source(), mediaKey: mediaKey(),
      version: { durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null },
      driftMs: synced() && prepared && room.timeline?.started ? Math.round(position() - targetAt(room.timeline, now)) : null, driftP95: controller.stats().p95 });
  }
  function play() {
    if (blocked || !video.paused) return;
    video.play().catch(() => { if (destroyed) return; blocked = true; message('اضغط «تابع معهم» للسماح بتشغيل الفيديو'); paintLobby(); });
  }
  function paintLobby() {
    onLobby({ visible: synced() && (!room.timeline?.started || blocked), prepared, blocked, host: room.isHost, connection: room.status, roster: room.roster,
      start: () => api.playPause(true), resume: () => { blocked = false; play(); paintLobby(); } });
  }
  function align(force = false) {
    const t = room.timeline;
    if (!prepared || !synced() || !live() || !t || t.media?.key !== mediaKey()) return;
    const now = room.clock.serverNow();
    if (!t.started) { if (!video.paused) video.pause(); return; }
    if (now < t.at) return;
    let ahead = 0, behind = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) {
        ahead = (video.buffered.end(i) - video.currentTime) * 1000;
        behind = (video.currentTime - video.buffered.start(i)) * 1000;
      }
    }
    const d = controller.step({ timeline: t, pos: position(), at: now, buffering: video.readyState < 3, bufferedAhead: ahead, bufferedBehind: behind });
    const seek = force && video.readyState >= 3 ? targetAt(t, now) : d.seekTo;
    if (seek != null && Math.abs(position() - seek) > 100) { video.currentTime = seek / 1000; seekingAt = now; }
    video.playbackRate = d.rate;
    if (d.playing) play(); else if (!video.paused) video.pause();
  }
  function receive({ state }) {
    clearTimeout(scheduled);
    const n = Number(/#(\d+)$/.exec(state?.media?.key ?? '')?.[1]);
    if (state?.media?.key?.startsWith(`${mediaPrefix}#`) && n > 0 && n !== episode() && loadingEpisode !== n) {
      prepared = false; failed = false; loadingEpisode = n; onEpisode(n);
    } else {
      align(true);
      if (state?.at > room.clock.serverNow()) {
        const seq = state.seq;
        scheduled = setTimeout(() => { if (!destroyed && room.timeline?.seq === seq) { align(true); report(true); } }, state.at - room.clock.serverNow());
      }
    }
    paintLobby(); report(true);
  }
  const offs = [room.on('state', receive), room.on('welcome', () => { receive({ state: room.timeline }); }),
    room.on('roster', paintLobby), room.on('connection', () => { paintLobby(); if (live()) { align(true); report(true); } }),
    room.on('room', () => { if (!synced()) video.playbackRate = 1; else align(true); paintLobby(); })];
  const timer = setInterval(() => {
    align();
    if (seekingAt != null && video.readyState >= 3) { controller.seeked(room.clock.serverNow() - seekingAt); seekingAt = null; }
    report();
  }, 500);
  const api = {
    ready() { prepared = true; failed = false; loadingEpisode = null; align(true); report(true); paintLobby(); },
    preparing() { prepared = false; failed = false; report(true); paintLobby(); },
    failed() { prepared = false; failed = true; report(true); paintLobby(); },
    playPause(playing) {
      if (!synced()) return false;
      if (!live()) { message('انتظر عودة الاتصال بالغرفة'); return true; }
      if (room.canControl && prepared) room.command(playing ? 'play' : 'pause', { pos: room.timeline?.started ? position() : 0 });
      else message(prepared ? 'بانتظار المضيف يبدأ…' : 'جاري تجهيز الفيديو…');
      return true;
    },
    seek(pos) { if (!synced()) return false; if (live() && room.canControl && prepared) room.command('seek', { pos }); else message('المضيف يتحكم بالتقديم'); return true; },
    changeEpisode(n) {
      if (!synced()) return false;
      if (!live() || !room.canControl) { message('بانتظار المضيف للحلقة التالية…'); return true; }
      room.command('load', { media: { key: `${mediaPrefix}#${n}`, kind: room.timeline?.media?.kind ?? 'anime', label: `الحلقة ${n}` }, pos: 0 });
      return true;
    },
    destroy() { destroyed = true; clearInterval(timer); clearTimeout(scheduled); for (const off of offs) off(); video.playbackRate = 1; },
  };
  paintLobby(); report(true);
  return api;
}
