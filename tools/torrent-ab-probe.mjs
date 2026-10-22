// فحص مقارن على ويندوز، على أسراب Torrentio حقيقية: كم ثانية حتى أول إطار؟
//   A) مسار التطبيق الكامل (services.mjs: rqbit + الوكيل + نافذة التورنت + mpv)، بلا إعادة فتح عند 45 ث
//   B) rqbit وحده + mpv مباشرة على رابط بثه (يعزل المحرك عن طبقاتنا)
//   C) peerflix (torrent-stream، أساس محرك Stremio) + mpv
// النتيجة تقول أين الفرق: في المحرك (B مقابل C) أم في طبقاتنا (A مقابل B). أداة تشخيص فقط.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { createDesktopServices, mergeTrackers, PUBLIC_TRACKERS } from '../apps/desktop/src/services.mjs';

const [native, reportPath, peerflixBin] = process.argv.slice(2);
const rqbit = join(native, 'rqbit.exe'), mpv = join(native, 'mpv.exe');
const BUDGET = 150_000;
const report = { started: new Date().toISOString(), candidates: [], runs: [] };
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
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
const magnetOf = (c) => `magnet:?xt=urn:btih:${c.infoHash}${mergeTrackers(c.trackers, PUBLIC_TRACKERS).map((t) => `&tr=${encodeURIComponent(t)}`).join('')}`;

/** mpv بلا نافذة: يخرج بعد أول إطار مفكوك. الزمن من t0. */
function mpvFirstFrame(url, t0) {
  return new Promise((resolve) => {
    const child = spawn(mpv, ['--no-config', '--vo=null', '--ao=null', '--frames=1', '--network-timeout=150', '--msg-level=all=warn', url], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let log = ''; const keep = (d) => { log = (log + d).slice(-600); }; child.stdout.on('data', keep); child.stderr.on('data', keep);
    const timer = setTimeout(() => { kill(child); resolve({ ms: null, error: 'لا إطار خلال المهلة', mpvLog: log }); }, BUDGET);
    child.once('exit', (code) => { clearTimeout(timer); resolve(code === 0 ? { ms: Date.now() - t0 } : { ms: null, error: `mpv خرج ${code}`, mpvLog: log }); });
  });
}
async function headersOf(url) {
  try { const r = await fetch(url, { headers: { Range: 'bytes=0-' } }); const h = Object.fromEntries(['content-type', 'content-length', 'content-range', 'accept-ranges'].map((k) => [k, r.headers.get(k)])); r.body?.cancel(); return { status: r.status, ...h }; }
  catch (e) { return { error: e.message }; }
}
async function firstByte(url, t0) {
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(url, { headers: { Range: 'bytes=0-0' } }); if (r.ok || r.status === 206) { await r.arrayBuffer(); return Date.now() - t0; } } catch {}
    await sleep(250);
  }
  return null;
}

async function runApp(c) {
  const events = [];
  const svc = createDesktopServices({ userData: await mkdtemp(join(tmpdir(), 'ab-app-')), binaries: { rqbit, mpv }, onEvent: (e) => events.push({ t: Date.now(), ...e }), firstFrameRecoveryMs: BUDGET, firstFrameFailureMs: 60000 });
  const t0 = Date.now(), session = `ab-${c.infoHash.slice(0, 6)}`;
  let ready = null, error = null;
  const done = new Promise((resolve) => {
    const iv = setInterval(() => {
      const r = events.find((e) => e.session === session && e.type === 'playback/ready'), f = events.find((e) => e.session === session && e.type === 'playback/error');
      if (r || f || Date.now() - t0 > BUDGET) { clearInterval(iv); ready = r ? r.t - t0 : null; error = f?.message ?? (r ? null : 'لا إطار خلال المهلة'); resolve(); }
    }, 100);
  });
  svc.startPlayback({ session, candidate: { infoHash: c.infoHash, fileIdx: c.fileIdx, sources: c.trackers.map((t) => `tracker:${t}`) }, title: 'ab', position: 0 }).catch((e) => { error ??= e.message; });
  await done;
  const stages = events.filter((e) => e.session === session && e.type === 'playback/stage').map((e) => `${e.stage}@${e.t - t0}`);
  // التتبّع الداخلي (startup-trace): أين تذهب الثواني بين تشغيل mpv وأول إطار
  const brief = (e) => [e.stage, Math.round(e.elapsedMs), ...['rangeStart', 'rangeEnd', 'waitMs', 'connectedPeers', 'speedBytes', 'checkedBytes', 'requestedPiece', 'bytes', 'cursor'].filter((k) => e[k] != null).map((k) => `${k}=${Math.round(e[k])}`)].join(':');
  const trace = events.filter((e) => e.type === 'playback/diagnostic').map(brief).slice(0, 120).join(' ');
  const peers = Math.max(0, ...events.filter((e) => Number.isFinite(e.peers)).map((e) => e.peers));
  await svc.stopPlayback({ session }).catch(() => {}); await svc.close().catch(() => {});
  return { engine: 'app', ms: ready, error, stages: stages.join('>'), peers, trace };
}

async function runRqbit(c) {
  const dir = await mkdtemp(join(tmpdir(), 'ab-rq-')), api = await freePort(), listen = await freePort();
  const child = spawn(rqbit, ['-v', 'error', '--http-api-listen-addr', `127.0.0.1:${api}`, '--disable-lsd', '--listen-port', String(listen), 'server', 'start', dir, '--disable-persistence'], { stdio: 'ignore', windowsHide: true });
  const base = `http://127.0.0.1:${api}`, t0 = Date.now();
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/')).ok) break; } catch {} await sleep(100); }
    const added = await (await fetch(`${base}/torrents?overwrite=true&only_files=${c.fileIdx}`, { method: 'POST', body: magnetOf(c) })).json();
    const metaMs = Date.now() - t0;
    const url = `${base}/torrents/${added.id}/stream/${c.fileIdx}`;
    const [frame, byte, head] = await Promise.all([mpvFirstFrame(url, t0), firstByte(url, t0), headersOf(url)]);
    let peers = null; try { peers = (await (await fetch(`${base}/torrents/${added.id}/stats/v1`)).json()).live?.snapshot?.peer_stats?.live ?? null; } catch {}
    return { engine: 'rqbit', ms: frame.ms, error: frame.error ?? null, mpvLog: frame.mpvLog, head, metaMs, firstByteMs: byte, peers };
  } catch (e) { return { engine: 'rqbit', ms: null, error: e.message }; }
  finally { kill(child); await sleep(1500); }
}

async function runPeerflix(c) {
  if (!peerflixBin) return { engine: 'peerflix', ms: null, error: 'peerflix غير مثبت' };
  const port = await freePort(), t0 = Date.now();
  const child = spawn(process.execPath, [peerflixBin, magnetOf(c), '--index', String(c.fileIdx), '--port', String(port), '--quiet', '--path', await mkdtemp(join(tmpdir(), 'ab-pf-'))], { stdio: 'ignore', windowsHide: true });
  try {
    const url = `http://127.0.0.1:${port}/`;
    const byte = await firstByte(url, t0);
    const frame = byte == null ? { ms: null, error: 'لم يبدأ الخادم' } : await mpvFirstFrame(url, t0);
    return { engine: 'peerflix', ms: frame.ms, error: frame.error ?? null, mpvLog: frame.mpvLog, firstByteMs: byte };
  } finally { kill(child); await sleep(1500); }
}

const pools = [];
try { const s = await torrentio('movie/tt0111161'); pools.push(...pick(s, 'فيلم 1080p x264', (x) => /1080p/i.test(x.title) && !/x265|hevc|265/i.test(x.title), 1), ...pick(s, 'فيلم 1080p x265', (x) => /1080p/i.test(x.title) && /x265|hevc/i.test(x.title), 1)); } catch (e) { report.candidates.push({ error: `فيلم: ${e.message}` }); }
try { const s = await torrentio('series/tt0903747:1:1'); pools.push(...pick(s, 'مسلسل حلقة', (x) => (sizeGb(x) ?? 9) < 4, 1)); } catch (e) { report.candidates.push({ error: `مسلسل: ${e.message}` }); }
try { const s = await torrentio('series/kitsu:46474:1'); pools.push(...pick(s, 'أنمي حلقة', (x) => (sizeGb(x) ?? 9) < 3, 2)); } catch (e) { report.candidates.push({ error: `أنمي: ${e.message}` }); }
try { const s = await torrentio('series/kitsu:11061:1'); pools.push(...pick(s, 'أنمي HxH', (x) => (sizeGb(x) ?? 9) < 3, 1)); } catch (e) { report.candidates.push({ error: `أنمي2: ${e.message}` }); }
report.candidates.push(...pools); await save();

for (const [i, c] of pools.entries()) {
  // ترتيب متناوب حتى لا يستفيد محرك واحد دائمًا من سرب «دافئ»
  const order = i % 2 ? [runPeerflix, runRqbit, runApp] : [runApp, runRqbit, runPeerflix];
  for (const run of order) {
    const r = await run(c);
    report.runs.push({ label: c.label, title: c.title, seeds: c.seeds, sizeGb: c.sizeGb, ...r });
    console.log('AB', JSON.stringify(report.runs.at(-1))); await save();
  }
}
report.finished = new Date().toISOString(); await save();
process.exit(0);
