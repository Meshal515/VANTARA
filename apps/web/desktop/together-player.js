import { createDriftController, targetAt } from '../lib/together/sync.js';

/** MPV يتبع جلسة الغرفة الأصلية؛ المواضع والأوامر كلها بالمللي ثانية. */
export function createDesktopTogetherPlayer({ together, bridge, session, episode, source = () => null, onEpisode = () => {}, onDetach = () => {}, onLobby = () => {}, message = () => {} }) {
  const room = together.session.room;
  const controller = createDriftController();
  const native = { position: 0, duration: null, paused: null, buffering: false, rate: 1 };
  const expected = { pause: [], seek: [] };
  let prepared = false, failed = false, closed = false, loadingEpisode = null, scheduled = null;
  // Local media timelines can differ by an intro or recap, even when the room clock is exact.
  let videoOffsetMs = 0;
  const localToRoom = value => Math.max(0,Math.round(value-videoOffsetMs));
  const clampLocal = value => Math.max(0, Math.min(native.duration ?? Infinity, Math.round(value)));
  const localTarget = (timeline, at) => clampLocal(targetAt(timeline, at, videoOffsetMs));
  let lastReport = -Infinity, lastState = null;
  const synced = () => (room.info?.mode ?? together.session.mode) === 'sync';
  const live = () => room.status === 'live';
  const key = () => `${together.mediaPrefix}#${episode()}`;
  const stateNow = () => failed ? 'failed' : !prepared ? 'preparing' : synced() && !room.timeline?.started ? 'ready' : native.buffering ? 'buffering' : native.paused ? 'paused' : 'playing';

  function command(command, value) {
    if (closed) return;
    const pending = expected[command];
    const entry = { value, until: room.clock.serverNow() + 2500 };
    if (pending) { pending.push(entry); if (pending.length > 8) pending.shift(); }
    try {
      Promise.resolve(bridge.playbackCommand({ session, command, value })).catch(() => {
        if (pending) { const index = pending.indexOf(entry); if (index >= 0) pending.splice(index, 1); }
        if (!closed) message('تعذّر تطبيق أمر الغرفة على المشغل');
      });
    } catch { if (!closed) message('تعذّر تطبيق أمر الغرفة على المشغل'); }
  }
  function echoed(kind, value) {
    const pending = expected[kind];
    const now = room.clock.serverNow();
    while (pending.length && pending[0].until < now) pending.shift();
    const index = pending.findIndex(e => kind === 'seek' ? Math.abs(e.value - value) < 1000 : e.value === value);
    if (index < 0) return false;
    pending.splice(0, index + 1);
    return true;
  }
  function pause(value) {
    if (native.paused === value) return;
    native.paused = value; command('pause', value);
  }
  function report(force = false) {
    if (closed) return;
    const now = room.clock.serverNow(), state = stateNow();
    if (!force && state === lastState && now - lastReport < 2000) return;
    lastReport = now; lastState = state;
    room.report({ pos: localToRoom(native.position), at: now, state, source: source(), mediaKey: key(),
      version: { durationMs: native.duration }, driftMs: synced() && prepared && room.timeline?.started ? Math.round(native.position - localTarget(room.timeline, now)) : null,
      driftP95: controller.stats().p95 });
  }
  function lobby() {
    if (closed) return;
    onLobby({ visible: synced() && (!room.timeline?.started || !prepared), prepared, blocked: false, host: room.isHost, connection: room.status, videoOffsetMs, setVideoOffset: ms => api.setVideoOffset(ms),
      roster: room.roster, start: () => api.playPause(true), openPanel: () => together.hub.openPanel() });
  }
  function align(force = false) {
    const t = room.timeline, now = room.clock.serverNow();
    if (closed || !prepared || !synced() || !live() || !t || t.media?.key !== key()) return;
    if (!t.started) { pause(true); return; }
    if (now < t.at) return;
    if (native.buffering) return;
    const decision = controller.step({ timeline: t, pos: native.position, at: now, buffering: native.buffering, offsetMs: videoOffsetMs, durationMs: native.duration });
    const seek = force && !native.buffering ? localTarget(t, now) : decision.seekTo;
    if (seek != null && Math.abs(native.position - seek) > 100) { native.position = Math.round(seek); command('seek', native.position); }
    const rate = Math.max(0.95, Math.min(1.05, decision.rate));
    if (native.rate !== rate) { native.rate = rate; command('rate', rate); }
    pause(!decision.playing);
  }
  function receive({ state }) {
    if (closed) return;
    clearTimeout(scheduled); scheduled = null;
    const number = Number(/#(\d+)$/.exec(state?.media?.key ?? '')?.[1]);
    if (state?.media?.key?.startsWith(`${together.mediaPrefix}#`) && number > 0 && number !== episode()) {
      if (loadingEpisode !== number) { prepared = false; failed = false; loadingEpisode = number; videoOffsetMs=0; native.duration = null; onEpisode(number); }
    } else {
      align(true);
      if (state?.at > room.clock.serverNow()) {
        const seq = state.seq;
        scheduled = setTimeout(() => { scheduled = null; if (!closed && room.timeline?.seq === seq) { align(true); report(true); lobby(); } }, state.at - room.clock.serverNow());
      }
    }
    lobby(); report(true);
  }
  function detach() { if (closed) return; api.close(); onDetach(); }
  const offs = [room.on('state', receive), room.on('welcome', () => receive({ state: room.timeline })), room.on('roster', lobby),
    room.on('connection', () => { if (room.status === 'closed') return detach(); if (live()) { align(true); report(true); } lobby(); }),
    room.on('room', () => { if (synced()) align(true); else if (native.rate !== 1) { native.rate = 1; command('rate', 1); } lobby(); report(true); })];
  if (together.hub.onChange) offs.push(together.hub.onChange(() => { if (together.hub.session !== together.session) detach(); }));
  const timer = setInterval(() => { align(); report(); }, 500);
  const api = {
    ready() { if (closed) return; prepared = true; failed = false; loadingEpisode = null; receive({ state: room.timeline }); },
    preparing() { prepared = false; failed = false; report(true); lobby(); },
    failed() { prepared = false; failed = true; report(true); lobby(); },
    playPause(playing) {
      if (closed || !synced()) return false;
      if (!live()) { message('انتظر عودة الاتصال بالغرفة'); return true; }
      if (room.canControl && prepared) room.command(playing ? 'play' : 'pause', { pos: room.timeline?.started ? localToRoom(native.position) : 0 });
      else { message(prepared ? 'المضيف يتحكم بالتشغيل' : 'جاري تجهيز الفيديو…'); align(true); }
      return true;
    },
    seek(position) {
      if (closed || !synced()) return false;
      if (live() && room.canControl && prepared) room.command('seek', { pos: localToRoom(position) });
      else { message('المضيف يتحكم بالتقديم'); align(true); }
      return true;
    },
    getVideoOffset() { return videoOffsetMs; },
    setVideoOffset(value) {
      if (closed || !synced() || !Number.isFinite(value) || Math.abs(value) > 120000) return false;
      videoOffsetMs = Math.round(value / 250) * 250;
      // Never move the shared room clock: each client compensates only for its own source.
      if (prepared && live() && room.timeline?.started) align(true);
      lobby();report(true);
      return true;
    },
    progressEvent(event) {
      if (closed || event?.session !== session) return;
      if (event.type === 'playback/ready') return api.ready();
      if (event.type === 'playback/error') return api.failed();
      const wasBuffering = native.buffering;
      if (Number.isFinite(event.position) && event.position >= 0) native.position = event.position;
      if (Number.isFinite(event.duration) && event.duration > 0) native.duration = Math.round(event.duration);
      if (typeof event.buffering === 'boolean') native.buffering = event.buffering;
      if (typeof event.paused === 'boolean') native.paused = event.paused;
      if (wasBuffering && !native.buffering) align(true);
      if (event.type === 'playback/pause' && typeof event.paused === 'boolean' && !echoed('pause', event.paused)) api.playPause(!event.paused);
      if (event.type === 'playback/seek' && Number.isFinite(event.position) && !echoed('seek', event.position)) api.seek(event.position);
      report();
    },
    close() {
      if (closed) return;
      if (native.rate !== 1) command('rate', 1);
      closed = true; clearInterval(timer); clearTimeout(scheduled); for (const off of offs) off();
      onLobby({ visible: false, prepared: false, roster: room.roster, host: room.isHost, connection: room.status });
    },
  };
  lobby(); report(true);
  return api;
}
