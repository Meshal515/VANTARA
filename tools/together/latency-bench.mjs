// قياس زمن استجابة المشاهدة المشتركة مرحلةً مرحلة، بالكود الحقيقي: منطق الغرفة في الخادم (RoomCore من
// together-core.ts)، وعميل الغرفة (room.js) بساعته المشتركة، ومزامنة مشغّل ويندوز (together-player.js).
// الشبكة: اتصال لكل مستخدم بتأخير ذهاب وتأخير إياب مستقلين (وتذبذب)، والمشغّل mpv محاكى يطبّق الأوامر بعد
// زمن تنفيذ ثابت ويطلق أحداثه كالأصلي. لا خادم Cloudflare حقيقي ولا أجهزة: المقصود تحديد أين يذهب الزمن.
//
// node --experimental-strip-types tools/together/latency-bench.mjs [oneWayMs=70] [jitterMs=15] [runs=5]
import { RoomCore, createSettings } from '../../services/sync-worker/src/together-core.ts';
import { joinRoom } from '../../apps/web/lib/together/room.js';
import { createDesktopTogetherPlayer } from '../../apps/web/desktop/together-player.js';

const ONE_WAY = Number(process.argv[2] ?? 70), JITTER = Number(process.argv[3] ?? 15), RUNS = Number(process.argv[4] ?? 5);
const MPV_APPLY_MS = 12; // IPC من العملية الرئيسية إلى mpv وتطبيق الخاصية
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lat = () => Math.max(1, ONE_WAY + (Math.random() * 2 - 1) * JITTER);
const t = () => performance.now();

// ── خادم الغرفة: نفس TogetherRoom.apply (الإرسال قبل الحفظ، والكل يستلم بما فيهم المرسل) ──
const core = RoomCore.create(createSettings({ mode: 'sync' }, 'host', 'ABCDEF', Date.now(), '*'), { key: 'anime:1#1', kind: 'anime', label: 'الحلقة 1' }, Date.now());
const conns = new Map();
const trace = [];
// OLD=1: يحاكي الخادم المنشور مع Stable (proto 1): كل أمر مختوم بـ«وصوله + 300ms» وبلا proto في الترحيب
const OLD = process.env.OLD === '1';
function legacy(msg) {
  if (!OLD) return msg;
  if (msg.t === 'welcome') { const { proto, ...rest } = msg; return rest; }
  if (msg.t === 'state' && msg.state && !(msg.state.at - Date.now() > 1000)) return { ...msg, state: { ...msg.state, at: Date.now() + 300 } };
  return msg;
}
function apply(out) {
  for (const o0 of out) { const o = 'msg' in o0 ? { ...o0, msg: legacy(o0.msg) } : o0;
    if ('close' in o) { conns.get(o.close)?.serverClose(o.code, o.reason); continue; }
    const targets = o.to === 'all' ? [...conns.keys()] : o.to;
    for (const c of targets) if (c !== o.except) conns.get(c)?.deliver(JSON.stringify(o.msg));
  }
}
let connSeq = 0;
class FakeSocket {
  constructor(url, protocols) {
    this.readyState = 0;
    this.user = String(protocols.find((p) => p.startsWith('bearer.'))).slice(7);
    this.conn = `c${++connSeq}`;
    setTimeout(() => {
      this.readyState = 1; conns.set(this.conn, this);
      this.onopen?.();
      // الترقية تصل الخادم بعد ذهاب
      setTimeout(() => apply(core.join({ conn: this.conn, userId: this.user, name: this.user, avatarKey: null }, Date.now())), lat());
    }, lat() * 2);
  }
  send(data) {
    if (this.readyState !== 1) return;
    const msg = JSON.parse(data);
    if (msg.t === 'cmd') trace.push({ k: 'sent', op: msg.op, at: t() });
    setTimeout(() => {
      if (!conns.has(this.conn)) return;
      if (msg.t === 'cmd') trace.push({ k: 'server', op: msg.op, at: t() });
      apply(core.handle(this.conn, msg, Date.now()));
    }, lat());
  }
  deliver(data) { setTimeout(() => { if (this.readyState === 1) { const m = JSON.parse(data); if (m.t === 'state' || m.t === 'welcome') trace.push({ k: 'recv', user: this.user, seq: m.state.seq, at: t(), welcome: m.t === 'welcome' }); this.onmessage?.({ data }); } }, lat()); }
  serverClose(code, reason) { conns.delete(this.conn); this.readyState = 3; setTimeout(() => this.onclose?.({ code, reason }), lat()); }
  close() { conns.delete(this.conn); this.readyState = 3; apply(core.leave(this.conn, Date.now())); }
}

// ── mpv محاكى لكل مستخدم: الموضع يتقدم بالوقت إن كان يعمل، والأوامر تُطبّق بعد MPV_APPLY_MS ──
function fakeMpv(user, playerRef) {
  const s = { paused: true, pos: 0, since: t(), rate: 1 };
  const pos = () => s.paused ? s.pos : s.pos + (t() - s.since) * s.rate;
  const event = (type, extra) => playerRef.current?.progressEvent({ type: `playback/${type}`, session: user, position: Math.round(pos()), duration: 1440000, paused: s.paused, buffering: false, ...extra });
  const bridge = {
    async playbackCommand({ command, value }) {
      const issued = t();
      await sleep(MPV_APPLY_MS);
      if (command === 'pause') { s.pos = pos(); s.since = t(); s.paused = value; trace.push({ k: 'apply', user, cmd: value ? 'pause' : 'play', at: t(), issued }); event('pause', { paused: value }); }
      if (command === 'seek') { s.pos = value; s.since = t(); trace.push({ k: 'apply', user, cmd: 'seek', at: t(), issued, value }); event('seek', { position: value }); }
      if (command === 'rate') { s.pos = pos(); s.since = t(); s.rate = value; }
      return { ok: true };
    },
  };
  const tick = setInterval(() => event('progress'), 250);
  return { bridge, pos, s, stop: () => clearInterval(tick) };
}

function member(user) {
  const room = joinRoom({ baseUrl: 'http://bench', code: 'ABCDEF', getToken: () => user, WebSocketImpl: FakeSocket });
  const ref = { current: null };
  const mpv = fakeMpv(user, ref);
  const session = { room, mode: 'sync' };
  const hub = { session, openPanel() {}, onChange: () => () => {} };
  ref.current = createDesktopTogetherPlayer({ together: { hub, session, mediaPrefix: 'anime:1' }, bridge: mpv.bridge, session: user, episode: () => 1, source: () => 'bench' });
  return { user, room, mpv, player: ref.current };
}

const host = member('host'), guest = member('guest');
await sleep(2500); // ترحيب + 8 عينات ساعة
for (const m of [host, guest]) m.player.progressEvent({ type: 'playback/ready', session: m.user });
await sleep(300);
host.player.playPause(true); // «ابدأ» بعدّ ثلاث ثوانٍ
await sleep(4200);

const ops = [
  ['pause', () => host.player.playPause(false), 'pause'],
  ['resume', () => host.player.playPause(true), 'play'],
  ['seek +30s', () => host.player.seek(host.mpv.pos() + 30000), 'seek'],
  ['seek −10s', () => host.player.seek(host.mpv.pos() - 10000), 'seek'],
];
const rows = [];
for (let run = 0; run < RUNS; run++) {
  for (const [name, act, cmd] of ops) {
    trace.length = 0;
    const press = t();
    act();
    await sleep(1600);
    const first = (user) => trace.find((e) => e.k === 'apply' && e.user === user && e.cmd === cmd);
    const sent = trace.find((e) => e.k === 'sent'), server = trace.find((e) => e.k === 'server'), recv = trace.find((e) => e.k === 'recv' && e.user === 'guest');
    const h = first('host'), g = first('guest');
    rows.push({ name, host: h ? h.at - press : null, sent: sent ? sent.at - press : null, server: server ? server.at - press : null, recv: recv ? recv.at - press : null, guestIssue: g ? g.issued - press : null, guest: g ? g.at - press : null });
    await sleep(800);
  }
}
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : '—'; };
console.log(`${OLD ? 'خادم قديم (Stable، تأجيل 300ms) · ' : 'خادم جديد · '}شبكة: ذهاب ${ONE_WAY}ms ±${JITTER} لكل اتجاه · mpv ${MPV_APPLY_MS}ms · ${RUNS} مرات لكل أمر (الوسيط بالمللي ثانية من الضغطة)`);
console.log('الأمر'.padEnd(12), 'المضيف ينفّذ', 'أُرسل', 'وصل الخادم', 'وصل الصديق', 'الصديق يأمر mpv', 'الصديق ينفّذ');
for (const [name] of ops) {
  const r = rows.filter((x) => x.name === name);
  console.log(name.padEnd(12), String(med(r.map((x) => x.host))).padStart(12), String(med(r.map((x) => x.sent))).padStart(5), String(med(r.map((x) => x.server))).padStart(10), String(med(r.map((x) => x.recv))).padStart(10), String(med(r.map((x) => x.guestIssue))).padStart(15), String(med(r.map((x) => x.guest))).padStart(12));
}
// العودة بعد انقطاع: يغلق اتصال الصديق، وكم حتى يعود متزامنًا (أمر mpv يقرّبه من موضع المضيف)
trace.length = 0;
const cut = t();
for (const [c, s] of conns) if (s.user === 'guest') { conns.delete(c); s.readyState = 3; s.onclose?.({ code: 1006 }); }
await sleep(6000);
const back = trace.find((e) => e.k === 'recv' && e.user === 'guest' && e.welcome);
console.log('عودة بعد انقطاع: الصديق رجع للغرفة بحالتها بعد', back ? Math.round(back.at - cut) : '—', 'ms');
const resync = trace.find((e) => e.k === 'apply' && e.user === 'guest' && back && e.at >= back.at);
console.log('ونفّذ أول تصحيح لموضعه بعد', resync ? Math.round(resync.at - cut) : 'لا حاجة (كان متزامنًا)', resync ? 'ms' : '');
console.log('فرق الموضع النهائي بين المضيف والصديق:', Math.round(Math.abs(host.mpv.pos() - guest.mpv.pos())), 'ms');
for (const m of [host, guest]) { m.mpv.stop(); m.player.close(); m.room.close(); }
process.exit(0);
