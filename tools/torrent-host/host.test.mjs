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

/**
 * وسيط TCP يحد السرعة فعلًا: libtorrent يعفي الاتصال المحلي من upload_rate_limit، فبلا وسيط تصل القطع كلها قبل أن
 * يتصادم قارئان ولا يُختبر شيء. دلو رموز بدقة 10ms لكل اتجاه، وتأخير [delayMs] في اتجاه واحد.
 */
function throttleProxy(target, bps, delayMs) {
  // عدّادات للتشخيص: كم اتصالًا وصل، وكم بايتًا عبر في كل اتجاه (يميّز عطل الوسيط من عطل المحرك)
  const stats = { connections: 0, upstreamErrors: 0, toSeeder: 0, toEngine: 0 };
  const server = net.createServer(client => {
    stats.connections++;
    const upstream = net.connect(target, '127.0.0.1');
    const pipe = (from, to, key) => {
      const queue = []; let budget = 0, ended = false;
      const timer = setInterval(() => {
        budget = Math.min(budget + bps / 100, bps / 10);
        const now = Date.now();
        while (queue.length && queue[0].at <= now && budget >= 1) {
          const n = Math.min(queue[0].buf.length, Math.floor(budget));
          to.write(queue[0].buf.subarray(0, n)); budget -= n; stats[key] += n;
          if (n === queue[0].buf.length) queue.shift(); else queue[0].buf = queue[0].buf.subarray(n);
        }
        if (ended && !queue.length) { clearInterval(timer); to.end(); }
      }, 10);
      from.on('data', buf => queue.push({ buf, at: Date.now() + delayMs }));
      from.on('end', () => { ended = true; });
      from.on('close', () => { ended = true; });
      from.on('error', () => { clearInterval(timer); to.destroy(); });
    };
    upstream.on('connect', () => { pipe(client, upstream, 'toSeeder'); pipe(upstream, client, 'toEngine'); });
    upstream.on('error', () => { stats.upstreamErrors++; client.destroy(); });
    client.on('error', () => upstream.destroy());
  });
  server.stats = stats;
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('libtorrent host: two concurrent readers (head and tail, like prewarmEdges) both finish without starving each other', { skip, timeout: 180000 }, async t => {
  // التسخين في ويندوز يقرأ أول الملف وآخره معًا. كان كل قارئ يضع النافذة على موضعه وحده: قطعة الآخر تصير «لا تُنزَّل»
  // (وضع التركيز) أو أدنى أولوية بلا موعد، وwaitPiece لا يعيد الأولويات، فيعلق.
  // الحكم ببصمة التجويع لا بالزمن: قطعة ينتظرها قارئ ولم تُطلب من الشبكة أصلًا (blocks = -1) أكثر من 4 ث. الزمن الكلي
  // يتأثر ببطء قرص مشغّل CI في ويندوز (read_piece بمتوسط 294ms وأقصى 808ms في البناء 82، وRC-T7)، فلا يميّز السببين.
  // عينات لينكس قبل الإصلاح: «w=120 لمدة 11.2 ث blk=-1» و«w=3 لمدة 4.1 ث blk=-1»؛ بعده أطول blk=-1 كان 143ms.
  const { base, magnet, data } = await fixture(t);
  const seedPeer = magnet.match(/x\.pe=127\.0\.0\.1(?:%3A|:)(\d+)/i);
  assert.ok(seedPeer, `the seeder magnet names its loopback peer: ${magnet}`);
  const proxy = await throttleProxy(Number(seedPeer[1]), 2 * 1024 * 1024, 40);
  t.after(() => proxy.close());
  const viaProxy = magnet.replace(seedPeer[0], seedPeer[0].replace(seedPeer[1], String(proxy.address().port)));
  const added = await request(base, '/torrents?only_files=0', { method: 'POST', body: viaProxy, timeout: 30000 });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const head = 8 * 1024 * 1024, tail = 2 * 1024 * 1024;
  const started = performance.now();
  const starved = [];
  let reading = true, maxRead = 0;
  const snapshots = [];
  const sampler = (async () => {
    while (reading) {
      await sleep(250);
      const d = (await request(base, `/torrents/${added.body.id}/diag`, { timeout: 5000 }).catch(() => null))?.body;
      if (!d?.waiting) continue;
      maxRead = Math.max(maxRead, d.reads?.max_ms ?? 0);
      snapshots.push(`${Math.round(performance.now() - started)}ms rate=${d.rate_bps} peers=${d.peers} pieces=${d.pieces} state=${d.state} paused=${d.paused} finished=${d.finished} peer_states=${JSON.stringify(d.peer_states)} waiting=${JSON.stringify(d.waiting)} readers=${JSON.stringify(d.readers)}`);
      if (d.waiting.piece >= 0 && d.waiting.ms > 4000 && d.waiting.blocks === -1) starved.push(`piece ${d.waiting.piece} waited ${d.waiting.ms}ms unrequested`);
    }
  })();
  const timed = range => request(base, `/torrents/${added.body.id}/stream/0`, { headers: { Range: range }, raw: true, timeout: 120000 })
    .then(r => ({ r, ms: Math.round(performance.now() - started) }), error => ({ error: error.message, ms: Math.round(performance.now() - started) }));
  const [first, last] = await Promise.all([timed(`bytes=0-${head - 1}`), timed(`bytes=${data.length - tail}-${data.length - 1}`)])
    .finally(() => { reading = false; });
  await sampler;
  // الدليل قبل الحكم: حالة الطلبين، والوسيط، وآخر لقطات المحرك (كل قارئ: قطعته، نُزّلت؟، قراءتها جارية؟، أولويتها)
  t.diagnostic(`head ${first.error ?? 'ok'} ${first.ms}ms (${first.r?.body.length ?? 0}B), tail ${last.error ?? 'ok'} ${last.ms}ms (${last.r?.body.length ?? 0}B), network ideal ≈ ${Math.round((head + tail) / (2 * 1024 * 1024) * 1000)}ms, slowest piece read from disk ${maxRead}ms`);
  t.diagnostic(`proxy ${JSON.stringify(proxy.stats)}`);
  for (const line of snapshots.slice(-6)) t.diagnostic(line);
  assert.equal(first.error, undefined, 'head read finished');
  assert.equal(last.error, undefined, 'tail read finished');
  assert.ok(first.r.body.equals(data.subarray(0, head)), 'head bytes exact');
  assert.ok(last.r.body.equals(data.subarray(data.length - tail)), 'tail bytes exact');
  assert.deepEqual(starved, [], 'a reader waited on a piece nobody requested');
});

test('libtorrent host: a reader paused between pieces keeps its next piece wanted while another reader finishes (no false «finished»)', { skip, timeout: 150000 }, async t => {
  // جذر البناءين 85 و86: قارئ الرأس كان يرسل قطعة نزّلها (send يحجبه المستقبِل)، وموضعه المسجّل هو تلك القطعة المنزّلة،
  // فقارئ الذيل في وضع التركيز يجعل قطعته التالية «لا تُنزَّل». اكتمل الذيل فصار كل المطلوب منزّلًا: libtorrent أعلن
  // الانتهاء (state=4) وقطع الباذر (كلاهما يرفع فقط)، ثم انتظر الرأس القطعة 4 بلا مشارك 120 ث. هنا المستقبِل يتوقف عمدًا
  // عن القراءة حتى يكتمل الذيل (ويندوز يتأخر في send فتتسع هذه الفجوة؛ لينكس يضيّقها فينجح الاختبار الأول مصادفة).
  const { base, magnet, data } = await fixture(t);
  const seedPeer = magnet.match(/x\.pe=127\.0\.0\.1(?:%3A|:)(\d+)/i);
  const proxy = await throttleProxy(Number(seedPeer[1]), 2 * 1024 * 1024, 40);
  t.after(() => proxy.close());
  const viaProxy = magnet.replace(seedPeer[0], seedPeer[0].replace(seedPeer[1], String(proxy.address().port)));
  const added = await request(base, '/torrents?only_files=0', { method: 'POST', body: viaProxy, timeout: 30000 });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  // الرأس حتى بداية الذيل: بقية مداه لم تُنزَّل حين يُحجب (كالقطعة 4 في ويندوز)، فإعلان الانتهاء خطأ لا اكتمال
  const id = added.body.id, tail = 2 * 1024 * 1024, head = data.length - tail;
  let resume;
  const released = new Promise(r => { resume = r; });
  const headDone = new Promise((resolve, reject) => {
    const req = http.request(new URL(`/torrents/${id}/stream/0`, base), { headers: { Authorization: `Basic ${Buffer.from(auth).toString('base64')}`, Range: `bytes=0-${head - 1}`, 'x-req-timeout-ms': '120000' } }, res => {
      const chunks = [];
      res.once('data', c => { chunks.push(c); res.pause(); released.then(() => res.resume()); res.on('data', d => chunks.push(d)); });
      res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    });
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
    req.on('error', reject); req.end();
  });
  // الرأس محجوب في send: موضعه المسجّل قطعة منزّلة ولم يمر عليه شيء ثانية (ذاكرة المقبس امتلأت)، كما في ويندوز
  let blocked = null;
  for (const until = Date.now() + 30000; Date.now() < until && !blocked; await sleep(200)) {
    const r = (await request(base, `/torrents/${id}/diag`, { timeout: 5000 }).catch(() => null))?.body?.readers?.[0];
    if (r?.have === 1 && r.reading === 0 && r.ms > 1000) blocked = r;
  }
  assert.ok(blocked, 'the head reader blocks in send on a downloaded piece');
  t.diagnostic(`head reader blocked on piece ${blocked.piece}`);
  const last = await request(base, `/torrents/${id}/stream/0`, { headers: { Range: `bytes=${data.length - tail}-${data.length - 1}` }, raw: true, timeout: 60000 });
  assert.ok(last.body.equals(data.subarray(data.length - tail)), 'tail bytes exact');
  await sleep(2000); // تُغلق قراءة الذيل ويستقر المحرك والرأس ما زال متوقفًا
  const during = (await request(base, `/torrents/${id}/diag`, { timeout: 5000 })).body;
  t.diagnostic(`while the head reader is paused: state=${during.state} finished=${during.finished} peers=${during.peers} pieces=${during.pieces} readers=${JSON.stringify(during.readers)} proxy=${JSON.stringify(proxy.stats)}`);
  resume();
  const started = performance.now();
  const body = await Promise.race([headDone, sleep(45000).then(() => null)]);
  t.diagnostic(`head after release: ${body ? `${Math.round(performance.now() - started)}ms` : 'stuck 45s'}`);
  assert.equal(during.finished, 0, 'the torrent is not «finished» while an open reader still needs pieces');
  assert.ok(body && body.equals(data.subarray(0, head)), 'head read finishes with exact bytes after the pause');
});

test('libtorrent host: a jump keeps deadlines only on pieces a reader waits for (not the edges, not a closed reader), so their queued blocks cannot hold the new position', { skip, timeout: 120000 }, async t => {
  // جذر متابعة 16MB في ويندوز (23.6 ث ثم 6.2 ث بالخيار B): الطرفان بموعد في كل إعادة ترتيب، وقارئ الرأس المغلق يبقى
  // موعده؛ libtorrent لا يلغي طلبات قطعة ذات موعد (cancel_non_critical) ولا يطلب للحرجة من مشارك طابوره فوق 2 ث، فكتل
  // موضع المتابعة انتظرت خلف 6–12MB من الرأس والذيل عند كل مشارك (/diag: 2–8 طلبات للقطعة المنتظرة لثانيتين)
  const { base, magnet, data } = await fixture(t);
  const seedPeer = magnet.match(/x\.pe=127\.0\.0\.1(?:%3A|:)(\d+)/i);
  const proxy = await throttleProxy(Number(seedPeer[1]), 64 * 1024, 40);
  t.after(() => proxy.close());
  const viaProxy = magnet.replace(seedPeer[0], seedPeer[0].replace(seedPeer[1], String(proxy.address().port)));
  const added = await request(base, '/torrents?only_files=0', { method: 'POST', body: viaProxy, timeout: 30000 });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const id = added.body.id, piece = 262144, pieces = data.length / piece, edges = [pieces - 2, pieces - 1];
  const open = (from) => {
    const req = http.request(new URL(`/torrents/${id}/stream/0`, base), { headers: { Authorization: `Basic ${Buffer.from(auth).toString('base64')}`, Range: `bytes=${from}-` } }, res => { res.on('data', () => {}); res.on('error', () => {}); });
    req.on('error', () => {}); req.end();
    return req;
  };
  const diag = async () => (await request(base, `/torrents/${id}/diag`, { timeout: 5000 })).body;
  const until = async (ok, what) => { for (const end = Date.now() + 15000; Date.now() < end; await sleep(100)) { const d = await diag(); if (ok(d)) return d; } throw new Error(what + ': ' + JSON.stringify(await diag())); };
  const head = open(0);
  const first = await until(d => d.readers.length === 1 && d.deadlines.length > 0, 'head reader registered');
  // أول فتح: الذيل يُجلب مع الرأس (المشغّل يقرأ الفهرس قبل أول إطار)
  assert.ok(edges.every(p => first.deadlines.includes(p)), `first open keeps the edges: ${first.deadlines}`);
  const midPiece = Math.floor(pieces / 2);
  const mid = open(midPiece * piece + 1000);
  const jumped = await until(d => d.readers.length === 2 && d.window_start === midPiece, 'jump reader is primary');
  t.diagnostic(`after the jump: deadlines=${jumped.deadlines} readers=${JSON.stringify(jumped.readers)}`);
  assert.ok(jumped.deadlines.includes(midPiece), 'the jump position has a deadline');
  assert.ok(!edges.some(p => jumped.deadlines.includes(p)), `edges nobody waits for lose their deadline at a jump: ${jumped.deadlines}`);
  // القارئ الأحدث فتحًا يقود ولو واصل الرأس القراءة (آخر نشاط كان يعيد النافذة إلى الرأس)
  const leads = [];
  for (let i = 0; i < 15; i++, await sleep(100)) leads.push((await diag()).window_start);
  assert.ok(leads.every(w => w === midPiece), `the newest reader keeps the window while the head reader streams: ${leads}`);
  const headPiece = jumped.readers.find(r => r.piece < midPiece)?.piece;
  assert.ok(jumped.deadlines.some(p => p < midPiece), 'the open head reader still has its next piece');
  head.destroy();
  const closed = await until(d => d.readers.length === 1, 'head reader dropped');
  await sleep(300);
  const after = await diag();
  t.diagnostic(`after the head reader closed (it was at ${headPiece}): deadlines=${after.deadlines}`);
  assert.ok(after.deadlines.every(p => p >= midPiece), `a closed reader keeps no deadline: ${after.deadlines} (closed at ${JSON.stringify(closed.readers)})`);
  mid.destroy();
});

test('libtorrent host: after pause then start, the same peers reconnect in seconds (min_reconnect_time), and idle keeps them connected', { skip, timeout: 120000 }, async t => {
  // جذر التسخين والدفء: pause يقطع المشاركين، وlibtorrent لا يعيد الاتصال بالمشارك نفسه قبل min_reconnect_time (60 ث
  // افتراضيًا)، والمتتبع يعيدهم أنفسهم. المتابعة بعد تسخين موقوف 8 ث انتظرت 53–56 ث في المحاكي
  const { base, magnet, data } = await fixture(t);
  const seedPeer = magnet.match(/x\.pe=127\.0\.0\.1(?:%3A|:)(\d+)/i);
  const proxy = await throttleProxy(Number(seedPeer[1]), 512 * 1024, 30);
  t.after(() => proxy.close());
  const viaProxy = magnet.replace(seedPeer[0], seedPeer[0].replace(seedPeer[1], String(proxy.address().port)));
  const added = await request(base, '/torrents?only_files=0', { method: 'POST', body: viaProxy, timeout: 30000 });
  const id = added.body.id;
  const head = await request(base, `/torrents/${id}/stream/0`, { headers: { Range: 'bytes=0-65535' }, raw: true, timeout: 30000 });
  assert.ok(head.body.equals(data.subarray(0, 65536)));
  const peers = async () => (await request(base, `/torrents/${id}/diag`, { timeout: 5000 })).body.peers;
  const readAt = async (fraction) => {
    const at = Math.floor(data.length * fraction), t0 = performance.now();
    const r = await request(base, `/torrents/${id}/stream/0`, { headers: { Range: `bytes=${at}-${at + 65535}` }, raw: true, timeout: 60000 });
    assert.ok(r.body.equals(data.subarray(at, at + 65536)), 'exact bytes');
    return performance.now() - t0;
  };
  await request(base, `/torrents/${id}/pause`, { method: 'POST', body: '' });
  await sleep(1500);
  await request(base, `/torrents/${id}/start`, { method: 'POST', body: '' });
  const afterPause = await readAt(0.75);
  t.diagnostic(`first bytes after pause/start: ${Math.round(afterPause)}ms`);
  assert.ok(afterPause < 15000, `the same peer reconnects in seconds, not after min_reconnect_time: ${Math.round(afterPause)}ms`);
  // خامل متصل (التسخين انتهى، أو الدفء بعد الإغلاق): المشارك باقٍ، والقراءة التالية تبدأ بلا إعادة اتصال
  assert.equal((await request(base, `/torrents/${id}/idle`, { method: 'POST', body: '' })).status, 200);
  await sleep(1500);
  assert.ok(await peers() > 0, 'idle keeps the peers connected');
  const afterIdle = await readAt(0.5);
  t.diagnostic(`first bytes after idle: ${Math.round(afterIdle)}ms`);
  assert.ok(afterIdle < 15000, `idle resumes in seconds: ${Math.round(afterIdle)}ms`);
});

test('libtorrent host: written blocks are tracked from libtorrent before a piece verifies, and settle when it does (option B, step 1)', { skip, timeout: 120000 }, async t => {
  // ويندوز: الخادم يسلّم القطع الموثقة كاملة فقط، فـ6.5KB من فهرس MKV تنتظر قطعة 16MB (bench: 7.2 ث من 10.3 حتى أول صورة).
  // الخطوة 1 من الخيار B كما في أندرويد: كتل كل قطعة غير موثقة كما أعلنها libtorrent بعد كتابتها (block_finished_alert)،
  // تُمحى عند تحققها. السرب مقيد السرعة فتُرى القطع جزئية
  const { base, magnet, data } = await fixture(t);
  const seedPeer = magnet.match(/x\.pe=127\.0\.0\.1(?:%3A|:)(\d+)/i);
  const proxy = await throttleProxy(Number(seedPeer[1]), 1024 * 1024, 40);
  t.after(() => proxy.close());
  const viaProxy = magnet.replace(seedPeer[0], seedPeer[0].replace(seedPeer[1], String(proxy.address().port)));
  const added = await request(base, '/torrents?only_files=0', { method: 'POST', body: viaProxy, timeout: 30000 });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const read = request(base, `/torrents/${added.body.id}/stream/0`, { headers: { Range: `bytes=0-${8 * 1024 * 1024 - 1}` }, raw: true, timeout: 60000 });
  let sawPartial = null;
  for (const until = Date.now() + 30000; Date.now() < until && !sawPartial; await sleep(100)) {
    const d = (await request(base, `/torrents/${added.body.id}/diag`, { timeout: 5000 }).catch(() => null))?.body;
    if (d?.early?.written_blocks > 0) sawPartial = d.early;
  }
  t.diagnostic(`partial pieces while downloading: ${JSON.stringify(sawPartial)}`);
  assert.ok(sawPartial, 'blocks written before their piece verified are seen');
  assert.equal(sawPartial.verified_only, 0);
  const body = (await read).body;
  assert.ok(body.equals(data.subarray(0, 8 * 1024 * 1024)), 'exact bytes');
  // طوال التنزيل وبعده: لا قطعة تحققت وبقيت في السجل (تُمحى عند piece_finished)، ولا فشل
  let worst = 0, last = null;
  for (const until = Date.now() + 4000; Date.now() < until; await sleep(150)) {
    last = (await request(base, `/torrents/${added.body.id}/diag`, { timeout: 5000 })).body.early;
    worst = Math.max(worst, last.stale);
  }
  t.diagnostic(`after the read: ${JSON.stringify(last)}, worst stale ${worst}`);
  assert.equal(worst, 0, 'a verified piece never stays in the written-blocks record');
  assert.equal(last.failures, 0);
});

test('libtorrent host: early bytes arrive before their piece verifies, exact; a hash failure stops early reads and is reported for recovery', { skip, timeout: 120000 }, async t => {
  // الخطوة 2 من الخيار B: أول قطع الطلب من كتلها المكتوبة (لا انتظار القطعة الموثقة كاملة)، وفشل تحقق قطعة سُلّم منها مبكرًا
  // يجعل التورنت موثقًا فقط ويُعلَن في /stats/v1 فيعيد التطبيق تحميل mpv من الموضع. ما بعده موثق فقط وصحيح
  const { base, magnet, data } = await fixture(t);
  const seedPeer = magnet.match(/x\.pe=127\.0\.0\.1(?:%3A|:)(\d+)/i);
  const proxy = await throttleProxy(Number(seedPeer[1]), 1024 * 1024, 40);
  t.after(() => proxy.close());
  const viaProxy = magnet.replace(seedPeer[0], seedPeer[0].replace(seedPeer[1], String(proxy.address().port)));
  const added = await request(base, '/torrents?only_files=0', { method: 'POST', body: viaProxy, timeout: 30000 });
  const id = added.body.id;
  // الفشل أثناء القراءة نفسها، لحظة وجود قطعة سُلّم منها ولم تتحقق بعد (لا بعد أن يتحقق كل شيء)
  const reading = request(base, `/torrents/${id}/stream/0`, { headers: { Range: `bytes=0-${8 * 1048576 - 1}` }, raw: true, timeout: 60000 });
  let failed = null;
  for (const until = Date.now() + 20000; Date.now() < until && !failed; await sleep(20)) {
    const d = (await request(base, `/torrents/${id}/diag`, { timeout: 5000 }).catch(() => null))?.body;
    if (d?.early?.pending > 0) {
      const r = await request(base, `/torrents/${id}/test-hash-fail`, { method: 'POST' });
      if (r.status === 200) failed = r.body;
    }
  }
  assert.ok(failed, 'a piece served before verification was still pending when the failure arrived');
  const after = (await request(base, `/torrents/${id}/stats/v1`)).body.vantara;
  t.diagnostic(`hash failure on piece ${failed.piece} while reading: ${JSON.stringify(after)}`);
  assert.equal(after.early_failures, 1, 'reported for the app to reload mpv at the position');
  assert.equal(after.verified_only, true);
  const body = (await reading).body;
  assert.ok(body.equals(data.subarray(0, 8 * 1048576)), 'the read finishes with exact bytes (verified after the failure)');
  const last = (await request(base, `/torrents/${id}/stats/v1`)).body.vantara;
  assert.ok(last.early_bytes - after.early_bytes <= 1048576, `at most the span already in flight is early after the failure (${last.early_bytes - after.early_bytes})`);
  const more = await request(base, `/torrents/${id}/stream/0`, { headers: { Range: `bytes=${16 * 1048576}-${17 * 1048576 - 1}` }, raw: true, timeout: 60000 });
  assert.ok(more.body.equals(data.subarray(16 * 1048576, 17 * 1048576)));
  assert.equal((await request(base, `/torrents/${id}/stats/v1`)).body.vantara.early_bytes, last.early_bytes, 'a new reader after the failure gets verified bytes only');
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
