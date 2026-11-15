// اختبار تكامل حقيقي لمحرك libtorrent (vantara-torrent): باذر محلي على loopback + المحرك + بث Range.
// يتطلب الملف التنفيذي المبني: VANTARA_TORRENT_HOST_BINARY=/path/vantara-torrent node --test tools/torrent-host/host.test.mjs
// بلا المتغير يُتخطى (CI يبنيه على لينكس وويندوز ثم يشغّل هذا الاختبار).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';

const binary = process.env.VANTARA_TORRENT_HOST_BINARY;
const skip = binary ? false : 'VANTARA_TORRENT_HOST_BINARY غير محدد';
const auth = 'vantara:test-secret';
const port = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function request(base, path, { method = 'GET', body, headers = {}, raw = false, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, base), { method, headers: { Authorization: `Basic ${Buffer.from(auth).toString('base64')}`, 'x-req-timeout-ms': String(timeout), ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject);
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // JSON فقط حين يعلنه المحرك: رسالة خطأ نصية لا تُسقط الاختبار قبل التحقق المقصود
        const json = /application\/json/i.test(res.headers['content-type'] ?? '');
        let body = raw ? buf : buf.toString('utf8');
        if (!raw && json && buf.length) { try { body = JSON.parse(body); } catch { /* يبقى نصًا ويظهر في رسالة الفشل */ } }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', reject); req.end(body);
  });
}

/** جاهزية صريحة: فشل واضح إن خرج المحرك أو لم يجب خلال 10 ث، لا متابعة صامتة. */
async function waitReady(base, engine, ms = 10000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    if (engine.exitCode != null) throw new Error(`المحرك خرج قبل الجاهزية (${engine.exitCode})`);
    try { const r = await request(base, '/', { timeout: 500 }); if (r.status === 200 && r.body?.engine === 'libtorrent') return r.body; last = `HTTP ${r.status}`; }
    catch (error) { last = error.message; }
    await sleep(50);
  }
  throw new Error(`المحرك لم يصبح جاهزًا خلال ${ms}ms: ${last}`);
}
const haveBits = (buf, count) => Array.from({ length: count }, (_, i) => ((buf[i >> 3] >> (7 - (i & 7))) & 1) === 1);

async function fixture(t, size = 24 * 1024 * 1024, { seedRate = 0 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'vantara-torrent-'));
  const seedDir = join(dir, 'seed'), cache = join(dir, 'cache');
  await import('node:fs/promises').then(fs => fs.mkdir(seedDir, { recursive: true }));
  const data = randomBytes(size);
  await writeFile(join(seedDir, 'clip.mp4'), data);
  const seedPort = await port();
  const seeder = spawn(binary, [`--seed=${join(seedDir, 'clip.mp4')}`, `--listen-port=${seedPort}`, '--piece-size=262144'], { env: { ...process.env, VANTARA_SEED_RATE: String(seedRate) }, stdio: ['ignore', 'pipe', 'inherit'] });
  const magnet = await new Promise((resolve, reject) => {
    let out = ''; seeder.stdout.on('data', c => { out += c; const line = out.split('\n')[0]; if (out.includes('\n')) resolve(line.trim()); });
    seeder.once('exit', code => reject(new Error(`seeder exited ${code}`)));
  });
  const apiPort = await port(); let listenPort = await port(); while (listenPort === apiPort || listenPort === seedPort) listenPort = await port();
  const engine = spawn(binary, [`--api-port=${apiPort}`, `--listen-port=${listenPort}`, `--dir=${cache}`, `--state-dir=${join(dir, 'state')}`, '--allow-private-peers', `--parent-pid=${process.pid}`],
    { env: { ...process.env, RQBIT_HTTP_BASIC_AUTH_USERPASS: auth }, stdio: ['ignore', 'ignore', 'inherit'] });
  const base = `http://127.0.0.1:${apiPort}`;
  t.after(async () => { seeder.kill(); engine.kill(); await sleep(300); await rm(dir, { recursive: true, force: true }); });
  await waitReady(base, engine);
  return { base, magnet, data, cache, engine, dir };
}

test('libtorrent host: metadata, managed add, full and seek Range reads return exact verified bytes', { skip, timeout: 120000 }, async t => {
  const { base, magnet, data, cache } = await fixture(t);
  const hash = createHash('sha256');
  assert.equal((await request(base, '/', { headers: { Authorization: 'Basic d3Jvbmc=' } })).status, 401, 'auth is enforced');
  const meta = await request(base, '/torrents?list_only=true', { method: 'POST', body: magnet, timeout: 30000 });
  assert.equal(meta.status, 200);
  assert.equal(meta.body.id, null);
  assert.equal(meta.body.details.files.length, 1);
  assert.equal(meta.body.details.files[0].name, 'clip.mp4');
  assert.equal(meta.body.details.files[0].length, data.length);
  assert.equal(meta.body.details.total_pieces, data.length / 262144);
  const added = await request(base, '/torrents?only_files=0', { method: 'POST', body: magnet });
  assert.equal(added.status, 200);
  assert.ok(Number.isSafeInteger(added.body.id));
  assert.equal(added.body.details.output_folder, added.body.output_folder);
  assert.ok(added.body.output_folder.startsWith(cache));
  // قفز إلى المنتصف أولًا (مثل mpv بعد استئناف): أول بايت يصل والبيانات مطابقة
  const mid = Math.floor(data.length / 2) + 12345;
  const t0 = performance.now();
  const seek = await request(base, `/torrents/${added.body.id}/stream/0`, { headers: { Range: `bytes=${mid}-${mid + 999999}` }, raw: true });
  assert.equal(seek.status, 206);
  assert.equal(seek.headers['content-range'], `bytes ${mid}-${mid + 999999}/${data.length}`);
  assert.ok(seek.body.equals(data.subarray(mid, mid + 1000000)), 'seek bytes match the seeded file');
  const firstSeekMs = performance.now() - t0;  // زمن طلب القفز وحده، بعد الإضافة
  const full = await request(base, `/torrents/${added.body.id}/stream/0`, { raw: true });
  assert.equal(full.status, 200);
  assert.equal(full.headers['content-type'], 'video/mp4');
  assert.equal(createHash('sha256').update(full.body).digest('hex'), hash.update(data).digest('hex'), 'full stream equals the seeded file');
  const tail = await request(base, `/torrents/${added.body.id}/stream/0`, { headers: { Range: 'bytes=-4096' }, raw: true });
  assert.ok(tail.body.equals(data.subarray(data.length - 4096)));
  assert.equal((await request(base, `/torrents/${added.body.id}/stream/0`, { headers: { Range: `bytes=${data.length}-` }, raw: true })).status, 416);
  const stats = await request(base, `/torrents/${added.body.id}/stats/v1`);
  assert.equal(stats.body.engine, 'libtorrent');
  assert.equal(stats.body.live.snapshot.downloaded_and_checked_bytes, data.length);
  const haves = await request(base, `/torrents/${added.body.id}/haves`, { raw: true });
  assert.equal(Number(haves.headers['x-bitfield-len']), data.length / 262144);
  assert.ok([...haves.body].every(b => b === 0xff), 'every piece verified');
  await readFile(join(added.body.output_folder, 'clip.mp4'));
  assert.equal((await request(base, `/torrents/${added.body.id}/delete`, { method: 'POST', body: '' })).status, 200);
  await sleep(500);
  await assert.rejects(readFile(join(added.body.output_folder, 'clip.mp4')), /ENOENT/, 'delete removes the session file');
  assert.equal((await request(base, `/torrents/${added.body.id}/stats/v1`)).status, 404);
  t.diagnostic(`seek request alone: ${Math.round(firstSeekMs)}ms on loopback`);
});

test('libtorrent host: after a seek, pieces at the read position arrive before earlier pieces (priority order, not timing)', { skip, timeout: 120000 }, async t => {
  // باذر محدود 1MB/s وملف 32MB بقطع 256KB (128 قطعة): لو نزّل المحرك بترتيب الملف لما وصل 75% قبل ~24 ث.
  // لا نحكم بالزمن (يختلف في CI)؛ نحكم بحقل القطع لحظة اكتمال القراءة: ما قبل موضع القفز شبه فارغ.
  const { base, magnet, data } = await fixture(t, 32 * 1024 * 1024, { seedRate: 1024 * 1024 });
  const added = await request(base, '/torrents?only_files=0', { method: 'POST', body: magnet, timeout: 30000 });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const pieces = added.body.details.total_pieces, pieceLength = data.length / pieces;
  const at = Math.floor(data.length * 0.75), seekPiece = Math.floor(at / pieceLength);
  const seek = await request(base, `/torrents/${added.body.id}/stream/0`, { headers: { Range: `bytes=${at}-${at + pieceLength - 1}` }, raw: true });
  assert.ok(seek.body.equals(data.subarray(at, at + pieceLength)), 'seek bytes are exact');
  const haves = await request(base, `/torrents/${added.body.id}/haves`, { raw: true });
  const bits = haveBits(haves.body, pieces);
  assert.equal(bits[seekPiece], true, 'the requested piece is verified');
  // ما بين رأس الملف (قطعة 0 مطلوبة كطرف فهرس) والقفز: لم يُطلب، فيجب أن يكون شبه فارغ
  const before = bits.slice(1, seekPiece);
  const downloadedBefore = before.filter(Boolean).length;
  t.diagnostic(`pieces before seek downloaded: ${downloadedBefore}/${before.length}; at seek: ${bits[seekPiece]}`);
  assert.ok(downloadedBefore <= Math.ceil(before.length * 0.1), `engine fetched ${downloadedBefore}/${before.length} pieces behind the read position first`);
});

test('libtorrent host: /diag reports engine rate, peers and the piece the reader waits on', { skip, timeout: 120000 }, async t => {
  const { base, magnet, data } = await fixture(t, 32 * 1024 * 1024, { seedRate: 1024 * 1024 });
  const added = await request(base, '/torrents?only_files=0', { method: 'POST', body: magnet, timeout: 30000 });
  assert.equal(added.status, 200);
  const read = request(base, `/torrents/${added.body.id}/stream/0`, { headers: { Range: `bytes=0-${data.length - 1}` }, raw: true });
  await sleep(1500);
  const diag = await request(base, `/torrents/${added.body.id}/diag`);
  t.diagnostic(`diag mid-read: ${JSON.stringify(diag.body)}`);
  assert.equal(diag.status, 200);
  for (const key of ['rate_bps', 'total_rate_bps', 'peers', 'seeds', 'unchoked_us', 'sending', 'pieces', 'partial', 'window_start', 'window', 'waiting', 'swaps']) assert.ok(key in diag.body, key);
  assert.equal(diag.body.window, 12, 'APK window by default');
  // الباذر على loopback: libtorrent يعفي الشبكة المحلية من حد السرعة فقد يكتمل الملف ويُغلق الاتصال قبل القراءة
  assert.ok(diag.body.peers >= 1 || diag.body.pieces > 0, 'connected to the seeder or already downloaded from it');
  assert.ok(diag.body.window_start >= 0, 'the reader set its window');
  for (const key of ['piece', 'ms', 'blocks', 'finished', 'writing', 'requested', 'peers', 'speeds']) assert.ok(key in diag.body.waiting, `waiting.${key}`);
  for (const key of ['in_flight', 'last_ms', 'avg_ms', 'max_ms', 'count', 'readahead']) assert.ok(key in diag.body.reads, `reads.${key}`);
  assert.equal(diag.body.reads.readahead, Number(process.env.VANTARA_LT_READAHEAD ?? 0), 'readahead off by default');
  // محرك القرص المختار فعلًا (القياس يثبت أي واحد قيس)؛ بلا المتغير يبقى اختيار libtorrent الافتراضي
  assert.equal(diag.body.disk_io, process.env.VANTARA_LT_DISK || 'default', 'disk_io reported');
  assert.ok((await read).body.equals(data));
  // التسليم المباشر (VANTARA_LT_DIRECT=1): البايتات أعلاه مطابقة، والقطع سُلّمت فعلًا من الملف بعد مطابقة SHA-1
  const after = await request(base, `/torrents/${added.body.id}/diag`);
  const direct = process.env.VANTARA_LT_DIRECT === '1';
  assert.equal(after.body.reads.direct, direct ? 1 : 0, 'direct flag reported');
  if (direct) assert.ok(after.body.reads.direct_hits > 0, `direct path served pieces: ${JSON.stringify(after.body.reads)}`);
  else assert.equal(after.body.reads.direct_hits, 0, 'direct path off by default');
});

test('libtorrent host exits when its parent process disappears (no orphaned engine)', { skip, timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vantara-torrent-parent-'));
  const apiPort = await port(), listenPort = await port();
  const parent = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)']);
  const engine = spawn(binary, [`--api-port=${apiPort}`, `--listen-port=${listenPort}`, `--dir=${dir}`, '--allow-private-peers', `--parent-pid=${parent.pid}`], { stdio: 'ignore' });
  const exited = new Promise(resolve => engine.once('exit', resolve));
  await sleep(800);
  parent.kill('SIGKILL');
  const result = await Promise.race([exited.then(() => 'exited'), sleep(5000).then(() => 'alive')]);
  if (result === 'alive') engine.kill('SIGKILL');
  await rm(dir, { recursive: true, force: true });
  assert.equal(result, 'exited');
});
