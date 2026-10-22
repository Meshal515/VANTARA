// فحص المحركات على ويندوز، على أسراب Torrentio حقيقية: كم ثانية حتى أول إطار مفكوك؟
//   app        : مسار التطبيق الكامل (services.mjs: rqbit + الوكيل + mpv)
//   stremio    : خادم Stremio الحقيقي (server.js) + mpv على رابطه
//   app+prewarm: التطبيق بعد تجهيز مسبق 15 ث (الزمن من الضغط على تشغيل)
// كل محرك يبدأ باردًا (مجلد جديد، عملية جديدة) والترتيب يتناوب حتى لا يستفيد محرك واحد من سرب «دافئ».
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createDesktopServices, mergeTrackers, PUBLIC_TRACKERS } from '../apps/desktop/src/services.mjs';

const [native, reportPath, stremioServer, modules] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const rqbit = join(native, 'rqbit.exe'), mpv = join(native, 'mpv.exe');
const BUDGET = 90_000;
const report = { started: new Date().toISOString(), candidates: [], runs: [] };
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const portOpen = (port) => new Promise((resolve) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); resolve(true); }); s.on('error', () => resolve(false)); });
const kill = (child) => { try { spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); } catch { child.kill(); } };

async function torrentio(path) {
  const r = await fetch(`https://torrentio.strem.fun/stream/${path}.json`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Torrentio ${r.status}`);
  return (await r.json()).streams ?? [];
}
const seeds = (s) => Number(/👤\s*(\d+)/.exec(s.title ?? '')?.[1] ?? 0);
const sizeGb = (s) => { const m = /💾\s*([\d.]+)\s*(GB|MB)/.exec(s.title ?? ''); return m ? Number(m[1]) / (m[2] === 'MB' ? 1024 : 1) : null; };
const pick = (streams, label, test = () => true, n = 1) => streams.filter((s) => s.infoHash && Number.isInteger(s.fileIdx) && test(s)).sort((a, b) => seeds(b) - seeds(a)).slice(0, n)
  .map((s) => ({ label, title: (s.title ?? '').split('\n')[0].slice(0, 80), seeds: seeds(s), sizeGb: sizeGb(s), infoHash: s.infoHash, fileIdx: s.fileIdx,
    trackers: (s.sources ?? []).filter((x) => x.startsWith('tracker:')).map((x) => x.slice(8)) }));
const trackersOf = (c) => mergeTrackers(c.trackers, PUBLIC_TRACKERS);
const magnetOf = (c) => `magnet:?xt=urn:btih:${c.infoHash}${trackersOf(c).map((t) => `&tr=${encodeURIComponent(t)}`).join('')}`;

/** mpv بلا نافذة: يخرج بعد أول إطار مفكوك. الزمن من t0. */
function mpvFirstFrame(url, t0) {
  return new Promise((resolve) => {
    const child = spawn(mpv, ['--no-config', '--vo=null', '--ao=null', '--frames=1', '--network-timeout=90', '--msg-level=all=warn', url], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let log = ''; const keep = (d) => { log = (log + d).slice(-400); }; child.stdout.on('data', keep); child.stderr.on('data', keep);
    const timer = setTimeout(() => { kill(child); resolve({ ms: null, error: 'لا إطار خلال المهلة', mpvLog: log }); }, BUDGET);
    child.once('exit', (code) => { clearTimeout(timer); resolve(code === 0 ? { ms: Date.now() - t0 } : { ms: null, error: `mpv خرج ${code}`, mpvLog: log }); });
  });
}
async function firstByte(url, t0) {
  while (Date.now() - t0 < BUDGET) {
    try { const r = await fetch(url, { headers: { Range: 'bytes=0-0' } }); if (r.ok || r.status === 206) { await r.arrayBuffer(); return Date.now() - t0; } await r.body?.cancel(); } catch {}
    await sleep(200);
  }
  return null;
}
/** يشغّل خادمًا ثم mpv على رابطه؛ أول بايت يُقاس بالتوازي. */
async function external(engine, url, start) {
  const t0 = Date.now(), child = start();
  try {
    const [frame, byte] = await Promise.all([(async () => { const port = Number(new URL(url).port); while (!(await portOpen(port)) && Date.now() - t0 < BUDGET) await sleep(100); return mpvFirstFrame(url, t0); })(), firstByte(url, t0)]);
    return { engine, ms: frame.ms, error: frame.error ?? null, mpvLog: frame.mpvLog, firstByteMs: byte };
  } finally { kill(child); await sleep(2000); }
}

async function runApp(c, { prewarmMs = 0 } = {}) {
  const events = [];
  const svc = createDesktopServices({ userData: await mkdtemp(join(tmpdir(), 'en-app-')), binaries: { rqbit, mpv }, onEvent: (e) => events.push({ t: Date.now(), ...e }), firstFrameRecoveryMs: BUDGET, firstFrameFailureMs: 60000 });
  // التطبيق الحقيقي ينشئ الخدمات عند فتحه، قبل أي ضغط على تشغيل بوقت طويل
  await sleep(6000);
  const candidate = { infoHash: c.infoHash, fileIdx: c.fileIdx, sources: c.trackers.map((t) => `tracker:${t}`) };
  // التجهيز المسبق: صفحة العمل تعرف أفضل تورنت، والمستخدم يقرأ الصفحة قبل الضغط على تشغيل
  if (prewarmMs) { await svc.prewarmTorrent({ candidate }); await sleep(prewarmMs); }
  const t0 = Date.now(), session = `en-${c.infoHash.slice(0, 6)}`;
  let ready = null, error = null;
  await new Promise((resolve) => {
    svc.startPlayback({ session, candidate, title: 'probe', position: 0 }).catch((e) => { error ??= e.message; });
    const iv = setInterval(() => {
      const r = events.find((e) => e.session === session && e.type === 'playback/ready'), f = events.find((e) => e.session === session && e.type === 'playback/error');
      if (r || f || Date.now() - t0 > BUDGET) { clearInterval(iv); ready = r ? r.t - t0 : null; error = f?.message ?? (r ? null : 'لا إطار خلال المهلة'); resolve(); }
    }, 100);
  });
  const brief = (e) => [e.stage, Math.round(e.elapsedMs), ...['rangeStart', 'waitMs', 'connectedPeers', 'speedBytes', 'checkedBytes', 'requestedPiece', 'status'].filter((k) => e[k] != null).map((k) => `${k}=${Math.round(e[k])}`)].join(':');
  const trace = events.filter((e) => e.type === 'playback/diagnostic').map(brief).slice(0, 80).join(' ');
  await svc.stopPlayback({ session }).catch(() => {}); await svc.close().catch(() => {});
  return { engine: prewarmMs ? `app+prewarm${prewarmMs / 1000}s` : 'app', ms: ready, error, trace };
}
async function runStremio(c) {
  if (!stremioServer) return { engine: 'stremio', ms: null, error: 'server.js غير موجود' };
  const appPath = await mkdtemp(join(tmpdir(), 'en-st-'));
  const query = [...trackersOf(c).map((t) => `tracker:${t}`), `dht:${c.infoHash}`].map((s) => `tr=${encodeURIComponent(s)}`).join('&');
  return external('stremio', `http://127.0.0.1:11470/${c.infoHash}/${c.fileIdx}?${query}`, () =>
    spawn(process.execPath, [stremioServer], { stdio: 'ignore', windowsHide: true, cwd: appPath, env: { ...process.env, APP_PATH: appPath, NO_CORS: '1' } }));
}
const local = (engine) => async (c) => {
  const port = await freePort(), dir = await mkdtemp(join(tmpdir(), `en-${engine}-`));
  return external(engine, `http://127.0.0.1:${port}/v`, () =>
    spawn(process.execPath, [join(here, 'torrent-engine-server.mjs'), engine, magnetOf(c), String(c.fileIdx), String(port), dir, modules], { stdio: 'ignore', windowsHide: true }));
};

const pools = [];
try { const s = await torrentio('movie/tt0111161'); pools.push(...pick(s, 'فيلم 1080p x264', (x) => /1080p/i.test(x.title) && !/x265|hevc|265/i.test(x.title), 1), ...pick(s, 'فيلم 1080p x265', (x) => /1080p/i.test(x.title) && /x265|hevc/i.test(x.title), 1)); } catch (e) { report.candidates.push({ error: `فيلم: ${e.message}` }); }
try { const s = await torrentio('series/tt0903747:1:1'); pools.push(...pick(s, 'مسلسل حلقة', (x) => (sizeGb(x) ?? 9) < 4, 1)); } catch (e) { report.candidates.push({ error: `مسلسل: ${e.message}` }); }
try { const s = await torrentio('series/kitsu:46474:1'); pools.push(...pick(s, 'أنمي حلقة', (x) => (sizeGb(x) ?? 9) < 3, 2)); } catch (e) { report.candidates.push({ error: `أنمي: ${e.message}` }); }
report.candidates.push(...pools); await save();

// القياس السابق: torrent-stream وWebTorrent أبطأ من التطبيق ومن Stremio في كل الحالات، فخرجا من الفحص
const runAppPrewarmed = (c) => runApp(c, { prewarmMs: 15000 });
const engines = [runApp, runAppPrewarmed, runStremio];
for (const [i, c] of pools.entries()) {
  const order = engines.map((_, k) => engines[(k + i) % engines.length]);
  for (const run of order) {
    let r; try { r = await run(c); } catch (e) { r = { engine: run.name, ms: null, error: e.message }; }
    report.runs.push({ label: c.label, title: c.title, seeds: c.seeds, sizeGb: c.sizeGb, ...r });
    console.log('RUN', JSON.stringify(report.runs.at(-1))); await save();
  }
}
report.finished = new Date().toISOString(); await save();
process.exit(0);
