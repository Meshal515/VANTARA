/**
 * VANTARA Together — عميل الغرفة: WebSocket إلى TogetherRoom في sync-worker.
 *
 * لا يعرف شيئًا عن المشغّل: يحفظ آخر خط زمني (بأعلى seq)، وقائمة الحاضرين، والساعة
 * المشتركة، ويُطلق أحداثًا. ربطه بالمشغّل أو القارئ في طبقة أعلى.
 *
 * التوكن يُرسل بروتوكولًا فرعيًا («bearer.<token>»)، لأن WebSocket المتصفح لا يضع
 * ترويسة Authorization، ولا نضعه في الرابط حتى لا يدخل سجلات الخوادم.
 */

import { createClock } from './sync.js';

const PROTOCOL = 'vantara.together';
const BURST = 8;
const BURST_GAP_MS = 150;
const RESYNC_MS = 30_000;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/**
 * ينشئ غرفة لمن اخترتهم (invite: معرّفات أو '*') ويُرجع رمزها الداخلي. الرمز لا يراه
 * أحد: بطاقة الدعوة في المجلس (عملية together.invite) هي التي تحمله للمدعوين.
 */
export async function createRoom({ baseUrl, token, invite, mode = 'sync', control = 'host', media, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/v1/together/rooms`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ invite, mode, control, media }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.code) throw Object.assign(new Error(body.error ?? 'room_failed'), { status: res.status });
  return body.code;
}

/** حال الغرفة لبطاقة الدعوة: من داخل، وهل بدأت. null = انتهت. */
export async function roomInfo({ baseUrl, token, code, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/v1/together/rooms/${encodeURIComponent(code)}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error('room_info_failed'), { status: res.status });
  return res.json();
}

/** رابط دعوة يفتح نفس الحلقة/الفصل داخل الغرفة. */
export function inviteLink(origin, code) {
  return `${String(origin).replace(/\/+$/, '')}/#together=${encodeURIComponent(code)}`;
}

export function parseInvite(hash) {
  const m = /(?:^|[#&])together=([A-Za-z0-9]{6})(?:&|$)/.exec(String(hash ?? ''));
  return m ? m[1].toUpperCase() : null;
}

/**
 * joinRoom({baseUrl, code, getToken}) ← room
 *   room.on(event, fn): welcome | state | roster | status | joined | left | host | room | presence | full | gone | uninvited | denied
 *   room.command('play'|'pause'|'seek'|'load', {pos, media})
 *   room.report({...})، room.setMode('sync'|'free')، room.settings({control})، room.invite(userIds)، room.giveHost(userId)
 *   room.clock، room.timeline، room.roster، room.info، room.me، room.isHost، room.close()
 */
export function joinRoom({
  baseUrl, code, getToken, WebSocketImpl = globalThis.WebSocket, now = () => performance.now(),
  timers = { setTimeout: (...a) => globalThis.setTimeout(...a), clearTimeout: (...a) => globalThis.clearTimeout(...a) },
}) {
  const listeners = new Map();
  const clock = createClock({ now });
  let ws = null;
  let closed = false;
  let attempt = 0;
  let pending = [];
  let timeline = null;
  let roster = [];
  let info = null;
  let me = null;
  let status = 'connecting';

  const emit = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) try { fn(payload); } catch { /* مستمع معطوب لا يوقف الغرفة */ }
  };
  const setStatus = (s) => { if (s !== status) { status = s; emit('connection', s); } };
  const later = (fn, ms) => { const id = timers.setTimeout(fn, ms); pending.push(id); return id; };
  const clearPending = () => { for (const id of pending) timers.clearTimeout(id); pending = []; };
  const send = (msg) => {
    if (ws?.readyState !== 1) return false;
    ws.send(JSON.stringify(msg));
    return true;
  };
  const ping = () => send({ t: 'ping', t0: now() });

  function connect() {
    if (closed) return;
    const token = getToken();
    const url = `${baseUrl.replace(/^http/, 'ws')}/v1/together/rooms/${encodeURIComponent(code)}/ws`;
    setStatus(attempt ? 'reconnecting' : 'connecting');
    ws = new WebSocketImpl(url, token ? [PROTOCOL, `bearer.${token}`] : [PROTOCOL]);
    ws.onopen = () => {
      attempt = 0;
      for (let i = 0; i < BURST; i++) later(ping, i * BURST_GAP_MS);
      const resync = () => { ping(); later(resync, RESYNC_MS); };
      later(resync, RESYNC_MS);
    };
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      onMessage(msg);
    };
    ws.onclose = (event) => {
      clearPending();
      ws = null;
      if (closed) return;
      // 4003 ممتلئة، 4001 دخلت من جهاز آخر، 1008/4004 لا غرفة أو لا صلاحية: لا إعادة محاولة
      if (event?.code === 4003 || event?.code === 4001 || event?.code === 4004 || event?.code === 1008) {
        closed = true;
        setStatus(event.code === 4003 ? 'full' : event.code === 4001 ? 'replaced' : 'gone');
        return;
      }
      setStatus('reconnecting');
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt++;
      later(connect, wait);
    };
  }

  function onMessage(msg) {
    switch (msg.t) {
      case 'pong':
        if (Number.isFinite(msg.t0)) clock.sample(msg.t0, msg.ts, now());
        emit('clock', clock);
        return;
      case 'welcome':
        me = msg.you;
        info = msg.room;
        roster = msg.roster ?? [];
        // تقدير أولي للساعة من رسالة الترحيب حتى تصل عينات ping
        if (!clock.ready && Number.isFinite(msg.now)) clock.sample(now(), msg.now, now());
        acceptState(msg.state, true);
        setStatus('live');
        emit('welcome', msg);
        emit('roster', roster);
        return;
      case 'state':
        acceptState(msg.state, false, msg.by);
        return;
      case 'roster':
        roster = msg.roster ?? [];
        emit('roster', roster);
        return;
      case 'room':
        info = msg.room;
        emit('room', info);
        return;
      case 'host':
        if (info) info = { ...info, hostUserId: msg.userId };
        emit('host', msg.userId);
        return;
      case 'full':
      case 'gone':
      case 'uninvited':
        // نهائي: لا إعادة محاولة، حتى لو لم يصل رمز الإغلاق
        closed = true;
        clearPending();
        try { ws?.close(1000, msg.t); } catch { /* مغلق */ }
        setStatus(msg.t);
        emit(msg.t, msg);
        return;
      case 'status':
        // «اشتغل الفيديو عند دحمي» / «تعذّر تشغيل السيرفر عند مشعل»
        emit('status', msg);
        return;
      case 'joined':
      case 'left':
      case 'denied':
        emit(msg.t, msg);
        return;
      default:
    }
  }

  function acceptState(state, force, by = null) {
    if (!state) return;
    if (!force && timeline && state.seq < timeline.seq) return;
    timeline = state;
    emit('state', { state, by });
  }

  connect();

  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    command(op, { pos, media } = {}) {
      return send({ t: 'cmd', op, ...(Number.isFinite(pos) ? { pos } : {}), ...(media ? { media } : {}) });
    },
    report(r) {
      return send({ t: 'report', ...r });
    },
    setMode(mode) { return send({ t: 'mode', mode }); },
    settings(s) { return send({ t: 'settings', ...s }); },
    giveHost(userId) { return send({ t: 'host', userId }); },
    invite(userIds) { return send({ t: 'invite', ...(userIds === '*' ? { all: true } : { userIds }) }); },
    close() {
      closed = true;
      clearPending();
      try { ws?.close(1000, 'left'); } catch { /* مغلق */ }
      setStatus('closed');
    },
    clock,
    get timeline() { return timeline; },
    get roster() { return roster; },
    get info() { return info; },
    get me() { return me; },
    get status() { return status; },
    get isHost() { return Boolean(me) && info?.hostUserId === me; },
    get canControl() { return Boolean(me) && (info?.hostUserId === me || info?.control === 'all'); },
  };
}
