// مقارنة libtorrent (vantara-torrent) وrqbit على أسراب حقيقية ومحتوى قانوني (أفلام Blender بترخيص CC-BY).
// المحركان يعرضان الواجهة المحلية نفسها، فالقياس متطابق: بارد في كل جولة (مجلد ومنافذ جديدة)، والترتيب
// يتناوب كي لا يستفيد محرك من سرب «دافئ». النتيجة مؤشر ظروف الشبكة وقتها، لا وعد زمني ثابت.
//
//   node tools/torrent-host/swarm-ab.mjs --libtorrent=PATH --rqbit=PATH --report=out.json [--rounds=2]
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { torrentFacts } from './torrent-file.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { engineArgs, libtorrentArgs, mergeTrackers } from '../../apps/desktop/src/services.mjs';

const opt = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const engines = { libtorrent: opt('libtorrent'), rqbit: opt('rqbit') };
// تجارب إعداد واحد لكل مرة: --lt-variant=الاسم|إعدادات settings_pack|نافذة (يتكرر). تُشغَّل كمحرك مستقل «lt:الاسم»
// بنفس ملف libtorrent ومتغيرات بيئة فقط؛ الافتراضي (libtorrent) بلا أي تغيير للمقارنة.
const variants = new Map();
for (const a of process.argv.filter(x => x.startsWith('--lt-variant='))) {
  // الاسم|إعدادات settings_pack|نافذة|متغيرات بيئة إضافية (KEY=VAL;KEY=VAL)، مثل VANTARA_LT_READAHEAD=1
  const [name, settings = '', window = '', extra = ''] = a.slice('--lt-variant='.length).split('|');
  const env = Object.fromEntries(extra.split(';').filter(Boolean).map(kv => kv.split('=')));
  variants.set(`lt:${name}`, { settings, window, env });
  engines[`lt:${name}`] = engines.libtorrent;
}
const isLt = kind => kind === 'libtorrent' || kind.startsWith('lt:');
const reportPath = opt('report') ?? 'swarm-ab.json';
const rounds = Number(opt('rounds') ?? 2);
// strong (Ubuntu/Debian) أو cc-by (أفلام Blender) أو all؛ السير الأساسي يكتفي بـcc-by حتى لا يطول
const which = opt('sources') ?? 'all';
// مصادر قانونية مشهورة البذر (WebTorrent/Blender Foundation، CC-BY 3.0)
const SOURCES = [
  { label: 'Sintel (CC-BY)', infoHash: '08ada5a7a6183aae1e09d831df6748d566095a10', name: 'Sintel' },
  { label: 'Big Buck Bunny (CC-BY)', infoHash: 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c', name: 'Big Buck Bunny' },
  { label: 'Tears of Steel (CC-BY)', infoHash: '209c8226b299b308beaf2b9cd3fb49212dbd13ec', name: 'Tears of Steel' },
];
// أسراب قوية قانونية للمقارنة العادلة مع قياس الـAPK (11–14MB/s على سرب 866 باذرًا): ملف التورنت الرسمي لأحدث
// إصدار يُجلب وقت التشغيل وتُحسب بصمته (infohash) منه، فلا بصمة محفوظة تتقادم.
const STRONG = [
  { label: 'Ubuntu desktop (latest)', listing: 'https://releases.ubuntu.com/noble/', pattern: /ubuntu-[\d.]+-desktop-amd64\.iso\.torrent/g },
  { label: 'Debian netinst (latest)', listing: 'https://cdimage.debian.org/debian-cd/current/amd64/bt-cd/', pattern: /debian-[\d.]+-amd64-netinst\.iso\.torrent/g },
];
const WEBTORRENT_TRACKERS = ['udp://tracker.leechers-paradise.org:6969', 'udp://tracker.coppersurfer.tk:6969', 'udp://explodie.org:6969', 'udp://tracker.opentrackr.org:1337/announce'];
// --quick: فرز سريع — أول 4MB فقط بحد 45 ث (بداية التشغيل هي المشكلة)؛ القياس الكامل للإعداد الفائز فقط
const quick = process.argv.includes('--quick');
const BUDGET_MS = quick ? 45_000 : 90_000;
const auth = `ab:${Math.random().toString(36).slice(2)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const H = { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` };

async function resolveStrong({ label, listing, pattern }) {
  const html = await (await fetch(listing)).text();
  const files = [...new Set(html.match(pattern) ?? [])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!files.length) throw new Error(`${label}: no torrent in ${listing}`);
  const file = files.at(-1);
  const facts = torrentFacts(Buffer.from(await (await fetch(new URL(file, listing))).arrayBuffer()));
  return { label: `${label}: ${facts.name}`, infoHash: facts.infoHash, name: facts.name, trackers: facts.trackers };
}

function call(base, path, { method = 'GET', body, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, base), { method, headers: { ...H, 'x-req-timeout-ms': String(timeout), 'content-type': 'text/plain' } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject);
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json, text }); });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end(body);
  });
}
/**
 * يقرأ [from, from+len) ويعيد زمن أول بايت وزمن الإكمال. لا يُحسب إلا رد 206 بـContent-Range المطلوب:
 * rqbit يرد 500 «invalid state: initializing» (~156 بايت) حتى يفتح ملف التورنت، والتطبيق يعيد المحاولة
 * (services.mjs) فنفعل مثله هنا والزمن من أول محاولة؛ وإلا كان نص الخطأ يُقاس كأنه بيانات الفيلم.
 */
async function readRange(url, from, len, timeout, meter = {}) {
  const t0 = performance.now(); let attempts = 0, last = null;
  while (performance.now() - t0 < timeout) {
    attempts++;
    const left = Math.max(1000, timeout - (performance.now() - t0));
    const r = await readOnce(url, from, len, left, t0, meter);
    if (r.status === 206 || r.timedOut || r.error) return { ...r, attempts };
    last = r;
    await sleep(250);
  }
  return { ...(last ?? {}), firstByteMs: null, totalMs: null, bytes: 0, timedOut: true, attempts };
}
function readOnce(url, from, len, timeout, t0, meter = {}) {
  return new Promise(resolve => {
    let first = null, got = 0, status = null, contentRange = null; const body = [];
    const req = http.get(url, { headers: { ...H, Range: `bytes=${from}-${from + len - 1}` } }, res => {
      status = res.statusCode; contentRange = res.headers['content-range'] ?? null;
      res.on('data', c => { if (status === 206) { first ??= performance.now() - t0; got += c.length; meter.bytes = (meter.bytes ?? 0) + c.length; } else if (body.length < 4) body.push(c); });
      res.on('end', () => resolve(status === 206
        ? { status, contentRange, firstByteMs: first == null ? null : Math.round(first), totalMs: Math.round(performance.now() - t0), bytes: got }
        : { status, contentRange, firstByteMs: null, totalMs: null, bytes: 0, engineError: Buffer.concat(body).toString('utf8').slice(0, 200) }));
      res.on('error', () => resolve({ status, contentRange, firstByteMs: first, totalMs: null, bytes: got, error: true }));
    });
    req.setTimeout(timeout, () => { req.destroy(); resolve({ status, contentRange, firstByteMs: first == null ? null : Math.round(first), totalMs: null, bytes: got, timedOut: true }); });
    req.on('error', () => resolve({ status, firstByteMs: null, totalMs: null, bytes: got, error: true }));
  });
}

async function measure(kind, source) {
  // اسم المجلد بلا «:» (ويندوز يرفضه في المسارات: تشغيل التجارب الأول سقط عند lt:utp)
  const dir = await mkdtemp(join(tmpdir(), `ab-${kind.replace(/[^\w-]/g, '_')}-`));
  const apiPort = await port(); let listenPort = await port(); while (listenPort === apiPort) listenPort = await port();
  const args = isLt(kind) ? libtorrentArgs({ apiPort, listenPort, dir: join(dir, 'cache'), stateDir: join(dir, 'state') }) : engineArgs({ apiPort, listenPort, dir: join(dir, 'cache'), dhtPersistence: false });
  const v = variants.get(kind);
  const child = spawn(engines[kind], args, { env: { ...process.env, RQBIT_HTTP_BASIC_AUTH_USERPASS: auth, ...(v?.settings ? { VANTARA_LT_SETTINGS: v.settings } : {}), ...(v?.window ? { VANTARA_LT_WINDOW: v.window } : {}), ...(v?.env ?? {}) }, stdio: 'ignore', windowsHide: true });
  const base = `http://127.0.0.1:${apiPort}`;
  const row = { engine: kind, source: source.label };
  let sampler = null;
  try {
    const started = performance.now();
    for (let i = 0; ; i++) { try { if ((await call(base, '/', { timeout: 1000 })).status === 200) break; } catch {} if (i > 300) throw new Error('engine not ready'); await sleep(50); }
    row.engineReadyMs = Math.round(performance.now() - started);
    const magnet = `magnet:?xt=urn:btih:${source.infoHash}&dn=${encodeURIComponent(source.name)}${mergeTrackers([...(source.trackers ?? []), ...WEBTORRENT_TRACKERS]).map(t => `&tr=${encodeURIComponent(t)}`).join('')}`;
    const t0 = performance.now();
    const meta = await call(base, '/torrents?list_only=true', { method: 'POST', body: magnet, timeout: BUDGET_MS });
    if (meta.status !== 200) throw new Error(`metadata HTTP ${meta.status}`);
    row.metadataMs = Math.round(performance.now() - t0);
    const files = meta.json.details.files;
    const byLength = files.map((f, i) => [f, i]).sort((a, b) => b[0].length - a[0].length);
    const index = (byLength.find(([f]) => /\.(mp4|mkv|webm|m4v)$/i.test(f.name)) ?? byLength[0])?.[1];
    if (index == null) throw new Error('no file');
    row.file = files[index].name; row.fileBytes = files[index].length;
    const added = await call(base, `/torrents?only_files=${index}`, { method: 'POST', body: magnet, timeout: BUDGET_MS });
    if (added.status !== 200) throw new Error(`add HTTP ${added.status}`);
    const url = `${base}/torrents/${added.json.id}/stream/${index}`;
    // خط زمني كل ثانية: ما وصل للقارئ فعلًا مقابل سرعة تنزيل المحرك والمشاركين والقطعة المنتظرة (libtorrent: /diag)
    const meter = { bytes: 0, phase: 'head' }, addedAt = performance.now(), timeline = [];
    const diagPath = isLt(kind) ? `/torrents/${added.json.id}/diag` : `/torrents/${added.json.id}/stats/v1`;
    sampler = setInterval(async () => {
      const at = Math.round(performance.now() - addedAt), delivered = meter.bytes, phase = meter.phase;
      const d = await call(base, diagPath, { timeout: 900 }).catch(() => null);
      const j = d?.json ?? {};
      timeline.push(isLt(kind)
        ? { at, phase, delivered, rate: j.rate_bps ?? null, peers: j.peers ?? null, unchokedUs: j.unchoked_us ?? null, sending: j.sending ?? null, pieces: j.pieces ?? null, waiting: j.waiting ?? null, reads: j.reads ?? null, swaps: j.swaps ?? null }
        : { at, phase, delivered, rate: j.live?.download_speed?.mbps != null ? Math.round(j.live.download_speed.mbps * 1048576) : null, peers: j.live?.snapshot?.peer_stats?.live ?? null });
    }, 1000);
    row.timeline = timeline;
    row.head4MB = await readRange(url, 0, 4 << 20, BUDGET_MS, meter);
    row.clickToFirstByteMs = row.head4MB.firstByteMs == null ? null : Math.round(row.metadataMs + row.head4MB.firstByteMs);
    // سرعة مستمرة تقارن بمتوسط قياس الـAPK: 32MB بعد أول 4MB مباشرة (قراءة تسلسلية كالمشغل)
    meter.phase = 'sustained';
    row.sustained32MB = quick ? { skipped: true } : await readRange(url, 4 << 20, 32 << 20, 120_000, meter);
    row.sustainedMBps = row.sustained32MB.status === 206 && row.sustained32MB.bytes === 32 << 20 && row.sustained32MB.totalMs ? +(32 / (row.sustained32MB.totalMs / 1000)).toFixed(2) : null;
    meter.phase = 'seek';
    row.seek50pct4MB = quick ? { skipped: true } : await readRange(url, Math.floor(files[index].length / 2), 4 << 20, BUDGET_MS, meter);
    clearInterval(sampler);
    // خلاصة مرحلة البداية: متوسط سرعة تنزيل المحرك مقابل ما وصل للقارئ في الثواني نفسها
    const headSamples = timeline.filter(s => s.phase === 'head' && Number.isFinite(s.rate));
    const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    row.headEngineMBps = headSamples.length ? +(mean(headSamples.map(s => s.rate)) / 1048576).toFixed(2) : null;
    row.headPeers = headSamples.length ? Math.round(mean(headSamples.map(s => s.peers ?? 0))) : null;
    row.headUnchokedUs = headSamples.length && headSamples[0].unchokedUs != null ? Math.round(mean(headSamples.map(s => s.unchokedUs ?? 0))) : null;
    // زمن قراءة القرص (read_piece) آخر عينة: متوسطه وأقصاه، وكم قطعة كان القارئ ينتظر قطعة غير منزّلة
    const lastReads = [...timeline].reverse().find(s => s.reads)?.reads;
    row.readAvgMs = lastReads?.avg_ms ?? null; row.readMaxMs = lastReads?.max_ms ?? null; row.readCount = lastReads?.count ?? null;
    row.headWaitingSamples = headSamples.filter(s => (s.waiting?.piece ?? -1) >= 0).length;
    // صحيح فقط إن كان 206 بالمدى المطلوب بالضبط وبالطول كاملًا
    const exact = (r, from) => r.status === 206 && r.totalMs != null && r.bytes === 4 << 20 && r.contentRange?.startsWith(`bytes ${from}-${from + (4 << 20) - 1}/`);
    const ok = r => exact(r, r === row.head4MB ? 0 : Math.floor(files[index].length / 2));
    row.headMBps = ok(row.head4MB) ? +(4 / (row.head4MB.totalMs / 1000)).toFixed(2) : null;
    row.seekMBps = ok(row.seek50pct4MB) ? +(4 / (row.seek50pct4MB.totalMs / 1000)).toFixed(2) : null;
    const stats = await call(base, `/torrents/${added.json.id}/stats/v1`, { timeout: 5000 }).catch(() => null);
    row.peers = stats?.json?.live?.snapshot?.peer_stats?.live ?? null;
  } catch (error) { row.error = error.message; }
  finally { clearInterval(sampler); child.kill(); await sleep(500); await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  return row;
}

const report = { started: new Date().toISOString(), platform: process.platform, budgetMs: BUDGET_MS, note: 'Real public swarms of CC-BY films; indicative of network conditions at run time.', runs: [] };
const strong = [];
for (const s of which === 'cc-by' ? [] : STRONG) { try { strong.push(await resolveStrong(s)); } catch (error) { report.runs.push({ source: s.label, error: `resolve: ${error.message}` }); } }
const chosen = [...strong, ...(which === 'strong' ? [] : SOURCES)];
report.sources = chosen.map(({ label, infoHash }) => ({ label, infoHash }));
for (let round = 0; round < rounds; round++) {
  for (const source of chosen) {
    // كل المحركات (الأساسي، الاحتياطي، تجارب الإعداد) بترتيب ينعكس كل جولة: لا يستفيد محرك دائمًا من سرب سخّنه غيره
    const all = Object.keys(engines).filter(k => engines[k]);
    const order = round % 2 === 0 ? all : [...all].reverse();
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
const median = list => { const v = list.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const strongLabels = new Set(strong.map(s => s.label));
for (const kind of Object.keys(engines)) {
  for (const [group, pick] of [['strong', r => strongLabels.has(r.source)], ['cc-by', r => !strongLabels.has(r.source)]]) {
    const all = report.runs.filter(r => r.engine === kind && pick(r)), rows = all.filter(r => !r.error);
    summary[`${kind}/${group}`] = { ok: rows.filter(r => r.head4MB?.status === 206).length, failed: all.length - rows.length,
      medianClickToFirstByteMs: median(rows.map(r => r.clickToFirstByteMs)), medianHeadMBps: median(rows.map(r => r.headMBps)),
      medianSustainedMBps: median(rows.map(r => r.sustainedMBps)), medianSeekMBps: median(rows.map(r => r.seekMBps)),
      medianHeadEngineMBps: median(rows.map(r => r.headEngineMBps)), medianHeadPeers: median(rows.map(r => r.headPeers)), medianHeadUnchokedUs: median(rows.map(r => r.headUnchokedUs)), medianReadAvgMs: median(rows.map(r => r.readAvgMs)), medianReadMaxMs: median(rows.map(r => r.readMaxMs)) };
  }
}
report.summary = summary;
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
