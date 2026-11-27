// جلسة تشغيل حقيقية عبر خدمات سطح المكتب نفسها (createDesktopServices): محرك vantara-torrent، وباذر مقيد السرعة،
// وmpv حقيقي، ثم «تقرير الذهب» من أحداثها كما يصنعه التطبيق. لا بيانات مصنوعة: الأحداث كلها من الجلسة.
// node tools/torrent-host/deeptrace-session.mjs <vantara-torrent> <mpv> <video.mkv> [pieceKB=2048] [startSec=0] [bps=2097152]
// بلا شاشة: mpv عبر غلاف يضيف --vo=null --ao=null (الفك كامل، الرسم لا يُقاس أصلًا: «غير مقاسة»)
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { createDesktopServices } from '../../apps/desktop/src/services.mjs';
import { goldReport } from '../../apps/web/lib/deeptrace.js';

const [host, mpv, video, pieceKB = '2048', startSec = '0', bps = String(2 << 20)] = process.argv.slice(2);
if (!host || !mpv || !video) { console.error('usage: deeptrace-session.mjs <vantara-torrent> <mpv> <video> [pieceKB] [startSec] [bps]'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
// وسيط يقيد السرعة ويؤخر (loopback لا يخضع لحد libtorrent: CLAUDE.md)
function throttle(target, rate, delay) {
  const server = net.createServer((client) => {
    const up = net.connect(target, '127.0.0.1');
    const pipe = (from, to) => { const q = []; let budget = 0, ended = false;
      const t = setInterval(() => { budget = Math.min(budget + rate / 100, rate / 10); const now = Date.now();
        while (q.length && q[0].at <= now && budget >= 1) { const n = Math.min(q[0].b.length, Math.floor(budget)); to.write(q[0].b.subarray(0, n)); budget -= n; if (n === q[0].b.length) q.shift(); else q[0].b = q[0].b.subarray(n); }
        if (ended && !q.length) { clearInterval(t); to.end(); } }, 10);
      from.on('data', (b) => q.push({ b, at: Date.now() + delay })); from.on('end', () => { ended = true; }); from.on('error', () => { clearInterval(t); to.destroy(); }); };
    up.on('connect', () => { pipe(client, up); pipe(up, client); }); up.on('error', () => client.destroy()); client.on('error', () => up.destroy());
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const dir = await mkdtemp(join(tmpdir(), 'deeptrace-'));
await mkdir(join(dir, 'seed'), { recursive: true });
await mkdir(join(dir, 'profile'), { recursive: true });
const clip = join(dir, 'seed', 'episode.mkv');
await copyFile(video, clip);
const seedPort = await freePort();
const seeder = spawn(host, [`--seed=${clip}`, `--listen-port=${seedPort}`, `--piece-size=${Number(pieceKB) * 1024}`], { stdio: ['ignore', 'pipe', 'ignore'] });
const magnet = await new Promise((res) => { let o = ''; seeder.stdout.on('data', (c) => { o += c; if (o.includes('\n')) res(o.split('\n')[0].trim()); }); });
const infoHash = /btih:([a-f0-9]{40})/i.exec(magnet)[1];
const proxy = await throttle(seedPort, Number(bps), 60);
const wrapper = join(dir, 'mpv');
await writeFile(wrapper, `#!/bin/sh\nexec ${JSON.stringify(mpv)} "$@" --vo=null --ao=null --force-window=no\n`);
await chmod(wrapper, 0o755);
const events = [];
const services = createDesktopServices({ userData: join(dir, 'profile'), binaries: { libtorrent: host, rqbit: join(dir, 'missing-rqbit'), mpv: wrapper },
  torrentMetadataStrategy: 'direct-index', torrentTestPeer: `127.0.0.1:${proxy.address().port}`, replayCache: false, onEvent: (e) => events.push({ ...e, at: performance.now() }) });
const tapAt = performance.now();
let outcome = 'ready';
try {
  await services.startPlayback({ session: 'trace', candidate: { infoHash, fileIdx: 0 }, title: 'DeepTrace', position: Number(startSec) * 1000 });
  for (const end = Date.now() + 90000; Date.now() < end && !events.some((e) => e.type === 'playback/diagnostic' && e.stage === 'playback-advancing'); await sleep(100));
  if (!events.some((e) => e.type === 'playback/ready')) outcome = 'no-frame';
  await sleep(1500);  // تفصيل انتظار آخر الطلبات يُجلب بعد أول بايت (خارج المسار الحرج)
} catch (e) { outcome = `error: ${e.message}`; }
// كما يجمعها player.js (addTrace): المرحلة وزمنها بساعة الخدمات وحقولها الرقمية
const trace = events.filter((e) => e.type === 'playback/diagnostic').map((e) => {
  const detail = {};
  for (const [k, v] of Object.entries(e)) if (!['type', 'stage', 'elapsedMs', 'session', 'mode', 'waitMs', 'at'].includes(k) && Number.isFinite(v)) detail[k] = v;
  return { stage: e.stage, ms: e.elapsedMs, ...(e.mode ? { mode: e.mode } : {}), ...(Number.isFinite(e.waitMs) ? { waitMs: e.waitMs } : {}), ...(Object.keys(detail).length ? { detail } : {}) };
});
const opened = events.find((e) => e.type === 'playback/preparing')?.at;
const tapMs = opened != null ? Math.max(0, opened - tapAt) : 0;
console.log(`# الجلسة: قطع ${pieceKB}KB، من ${startSec} ث، باذر ${(Number(bps) / 1048576).toFixed(1)}MB/s · ${outcome}\n`);
console.log(goldReport({ tapMs, trace, app: { version: 'local', channel: 'linux-session', build: null, sourceSha: process.env.GIT_SHA ?? null } }));
if (process.env.TRACE_OUT) await writeFile(process.env.TRACE_OUT, JSON.stringify({ tapMs, trace }, null, 2));
await services.close().catch(() => {});
seeder.kill(); proxy.close();
await sleep(300);
await rm(dir, { recursive: true, force: true }).catch(() => {});
process.exit(0);
