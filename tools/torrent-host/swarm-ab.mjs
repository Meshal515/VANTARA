// مقارنة libtorrent (vantara-torrent) وrqbit على أسراب حقيقية ومحتوى قانوني (أفلام Blender بترخيص CC-BY).
// المحركان يعرضان الواجهة المحلية نفسها، فالقياس متطابق: بارد في كل جولة (مجلد ومنافذ جديدة)، والترتيب
// يتناوب كي لا يستفيد محرك من سرب «دافئ». النتيجة مؤشر ظروف الشبكة وقتها، لا وعد زمني ثابت.
//
//   node tools/torrent-host/swarm-ab.mjs --libtorrent=PATH --rqbit=PATH --report=out.json [--rounds=2]
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { engineArgs, libtorrentArgs, mergeTrackers } from '../../apps/desktop/src/services.mjs';

const opt = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const engines = { libtorrent: opt('libtorrent'), rqbit: opt('rqbit') };
const reportPath = opt('report') ?? 'swarm-ab.json';
const rounds = Number(opt('rounds') ?? 2);
// مصادر قانونية مشهورة البذر (WebTorrent/Blender Foundation، CC-BY 3.0)
const SOURCES = [
  { label: 'Sintel (CC-BY)', infoHash: '08ada5a7a6183aae1e09d831df6748d566095a10', name: 'Sintel' },
  { label: 'Big Buck Bunny (CC-BY)', infoHash: 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c', name: 'Big Buck Bunny' },
  { label: 'Tears of Steel (CC-BY)', infoHash: '209c8226b299b308beaf2b9cd3fb49212dbd13ec', name: 'Tears of Steel' },
];
const WEBTORRENT_TRACKERS = ['udp://tracker.leechers-paradise.org:6969', 'udp://tracker.coppersurfer.tk:6969', 'udp://explodie.org:6969', 'udp://tracker.opentrackr.org:1337/announce'];
const BUDGET_MS = 90_000;
const auth = `ab:${Math.random().toString(36).slice(2)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const H = { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` };

function call(base, path, { method = 'GET', body, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, base), { method, headers: { ...H, 'x-req-timeout-ms': String(timeout), 'content-type': 'text/plain' } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject);
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json, text }); });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end(body);
  });
}
/** يقرأ [from, from+len) ويعيد زمن أول بايت وزمن الإكمال (أو null عند انتهاء المهلة). */
function readRange(url, from, len, timeout) {
  return new Promise(resolve => {
    const t0 = performance.now(); let first = null, got = 0;
    const req = http.get(url, { headers: { ...H, Range: `bytes=${from}-${from + len - 1}` } }, res => {
      res.on('data', c => { first ??= performance.now() - t0; got += c.length; });
      res.on('end', () => resolve({ firstByteMs: first == null ? null : Math.round(first), totalMs: Math.round(performance.now() - t0), bytes: got }));
      res.on('error', () => resolve({ firstByteMs: first, totalMs: null, bytes: got }));
    });
    req.setTimeout(timeout, () => { req.destroy(); resolve({ firstByteMs: first == null ? null : Math.round(first), totalMs: null, bytes: got, timedOut: true }); });
    req.on('error', () => resolve({ firstByteMs: null, totalMs: null, bytes: got, error: true }));
  });
}

async function measure(kind, source) {
  const dir = await mkdtemp(join(tmpdir(), `ab-${kind}-`));
  const apiPort = await port(); let listenPort = await port(); while (listenPort === apiPort) listenPort = await port();
  const args = kind === 'libtorrent' ? libtorrentArgs({ apiPort, listenPort, dir: join(dir, 'cache'), stateDir: join(dir, 'state') }) : engineArgs({ apiPort, listenPort, dir: join(dir, 'cache'), dhtPersistence: false });
  const child = spawn(engines[kind], args, { env: { ...process.env, RQBIT_HTTP_BASIC_AUTH_USERPASS: auth }, stdio: 'ignore', windowsHide: true });
  const base = `http://127.0.0.1:${apiPort}`;
  const row = { engine: kind, source: source.label };
  try {
    const started = performance.now();
    for (let i = 0; ; i++) { try { if ((await call(base, '/', { timeout: 1000 })).status === 200) break; } catch {} if (i > 300) throw new Error('engine not ready'); await sleep(50); }
    row.engineReadyMs = Math.round(performance.now() - started);
    const magnet = `magnet:?xt=urn:btih:${source.infoHash}&dn=${encodeURIComponent(source.name)}${mergeTrackers(WEBTORRENT_TRACKERS).map(t => `&tr=${encodeURIComponent(t)}`).join('')}`;
    const t0 = performance.now();
    const meta = await call(base, '/torrents?list_only=true', { method: 'POST', body: magnet, timeout: BUDGET_MS });
    if (meta.status !== 200) throw new Error(`metadata HTTP ${meta.status}`);
    row.metadataMs = Math.round(performance.now() - t0);
    const files = meta.json.details.files;
    const index = files.map((f, i) => [f, i]).filter(([f]) => /\.(mp4|mkv|webm|m4v)$/i.test(f.name)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
    if (index == null) throw new Error('no video file');
    row.file = files[index].name; row.fileBytes = files[index].length;
    const added = await call(base, `/torrents?only_files=${index}`, { method: 'POST', body: magnet, timeout: BUDGET_MS });
    if (added.status !== 200) throw new Error(`add HTTP ${added.status}`);
    const url = `${base}/torrents/${added.json.id}/stream/${index}`;
    row.head4MB = await readRange(url, 0, 4 << 20, BUDGET_MS);
    row.clickToFirstByteMs = row.head4MB.firstByteMs == null ? null : Math.round(row.metadataMs + row.head4MB.firstByteMs);
    row.seek50pct4MB = await readRange(url, Math.floor(files[index].length / 2), 4 << 20, BUDGET_MS);
    const ok = r => r.totalMs != null && r.bytes === 4 << 20;
    row.headMBps = ok(row.head4MB) ? +(4 / (row.head4MB.totalMs / 1000)).toFixed(2) : null;
    row.seekMBps = ok(row.seek50pct4MB) ? +(4 / (row.seek50pct4MB.totalMs / 1000)).toFixed(2) : null;
    const stats = await call(base, `/torrents/${added.json.id}/stats/v1`, { timeout: 5000 }).catch(() => null);
    row.peers = stats?.json?.live?.snapshot?.peer_stats?.live ?? null;
  } catch (error) { row.error = error.message; }
  finally { child.kill(); await sleep(500); await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  return row;
}

const report = { started: new Date().toISOString(), platform: process.platform, budgetMs: BUDGET_MS, note: 'Real public swarms of CC-BY films; indicative of network conditions at run time.', runs: [] };
for (let round = 0; round < rounds; round++) {
  for (const source of SOURCES) {
    const order = round % 2 === 0 ? ['libtorrent', 'rqbit'] : ['rqbit', 'libtorrent'];
    for (const kind of order) {
      if (!engines[kind]) continue;
      const row = { round, ...(await measure(kind, source)) };
      report.runs.push(row);
      console.log(JSON.stringify(row));
      await writeFile(reportPath, JSON.stringify(report, null, 2));
    }
  }
}
const summary = {};
for (const kind of Object.keys(engines)) {
  const rows = report.runs.filter(r => r.engine === kind && !r.error);
  const median = list => { const v = list.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  summary[kind] = { ok: rows.length, failed: report.runs.filter(r => r.engine === kind && r.error).length,
    medianClickToFirstByteMs: median(rows.map(r => r.clickToFirstByteMs)), medianHeadMBps: median(rows.map(r => r.headMBps)), medianSeekMBps: median(rows.map(r => r.seekMBps)) };
}
report.summary = summary;
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
