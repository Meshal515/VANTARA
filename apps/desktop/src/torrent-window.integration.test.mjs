import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from './services.mjs';

// rqbit الحقيقي + سرب مملوك محلي: النافذة المتحركة تحرّر القرص فعلًا، والرجوع يعيد البيانات صحيحة.
const binary = process.env.VANTARA_RQBIT_LINUX;
const MiB = 1024 * 1024;
const sha = (b) => createHash('sha1').update(b).digest();
function encode(v) {
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(`${v.length}:`), v]);
  if (typeof v === 'string') return encode(Buffer.from(v));
  if (typeof v === 'number') return Buffer.from(`i${v}e`);
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(encode), Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'), ...Object.keys(v).sort().flatMap((k) => [encode(k), encode(v[k])]), Buffer.from('e')]);
}
async function availablePort() { const s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function until(fn, timeout = 30000) { const deadline = Date.now() + timeout; let error; while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { error = e; } await new Promise((r) => setTimeout(r, 100)); } throw error ?? new Error('انتهت مهلة fixture'); }
async function terminate(child) { if (child.exitCode !== null || child.signalCode !== null) return; await new Promise((r) => { const t = setTimeout(() => child.kill('SIGKILL'), 1500); child.once('exit', () => { clearTimeout(t); r(); }); child.kill(); }); }
async function findFile(dir, name) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { const f = await findFile(p, name).catch(() => null); if (f) return f; }
    else if (entry.name === name) return p;
  }
  return null;
}

test('النافذة المتحركة: يُفرَّغ ما خلف المشاهدة من القرص، والرجوع يعيد بناء التورنت ببيانات صحيحة', { skip: !binary || process.platform !== 'linux', timeout: 90000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'vantara-window-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const film = randomBytes(24 * MiB);
  const pieceLength = 256 * 1024, pieces = [];
  for (let i = 0; i < film.length; i += pieceLength) pieces.push(sha(film.subarray(i, i + pieceLength)));
  const info = { name: 'film.mkv', length: film.length, 'piece length': pieceLength, pieces: Buffer.concat(pieces) };
  const torrent = encode({ info }), hash = sha(encode(info)).toString('hex');
  const seedOutput = join(dir, 'seed'); await mkdir(seedOutput, { recursive: true }); await writeFile(join(seedOutput, 'film.mkv'), film);
  const seedApi = await availablePort(), peer = await availablePort(), backend = await availablePort(), auth = `fixture:${randomBytes(16).toString('hex')}`;
  const seed = spawn(binary, ['-v', 'error', '--http-api-listen-addr', `127.0.0.1:${seedApi}`, '--listen-ip', '127.0.0.1', '--listen-port', String(peer), '--disable-dht', '--disable-trackers', '--disable-lsd', '--disable-upnp-port-forward', 'server', 'start', seedOutput, '--disable-persistence'], { env: { ...process.env, RQBIT_HTTP_BASIC_AUTH_USERPASS: auth }, stdio: 'ignore' });
  t.after(() => terminate(seed));
  const headers = { Authorization: `Basic ${Buffer.from(auth).toString('base64')}` };
  await until(async () => (await fetch(`http://127.0.0.1:${seedApi}/`, { headers })).ok);
  await (await fetch(`http://127.0.0.1:${seedApi}/torrents?overwrite=true`, { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: torrent })).json();
  await until(async () => { const r = await (await fetch(`http://127.0.0.1:${seedApi}/torrents/0/stats/v1`, { headers })).json(); return r.state === 'live' && r.finished; });

  const wrapper = join(dir, 'rqbit-fixture'), player = join(dir, 'mpv-fixture');
  // نفس محوّل الاختبار الموجود: يضيف القرين المملوك فقط إلى طلب الإضافة (كل إضافة، بما فيها إعادة البناء).
  await writeFile(wrapper, `#!${process.execPath}\nimport http from 'node:http';import {spawn} from 'node:child_process';
const args=process.argv.slice(2),index=args.indexOf('--http-api-listen-addr'),external=args[index+1].split(':').at(-1);args[index+1]='127.0.0.1:${backend}';args.unshift('--disable-dht','--disable-trackers');
const child=spawn(${JSON.stringify(binary)},args,{env:process.env,stdio:'ignore'});
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(req.method==='POST'&&u.pathname==='/torrents')u.searchParams.set('initial_peers','127.0.0.1:${peer}');const forward=http.request('http://127.0.0.1:${backend}'+u.pathname+u.search,{method:req.method,headers:req.headers},back=>{res.writeHead(back.statusCode,back.headers);back.pipe(res);});forward.on('error',()=>{res.writeHead(503);res.end('{}');});req.pipe(forward);});server.listen(Number(external),'127.0.0.1');
process.on('SIGTERM',()=>{server.closeAllConnections();server.close();child.kill();});child.once('exit',()=>process.exit());`);
  // مشغّل وهمي: يقرأ الفيلم كله عبر الوكيل، ثم يعلن أنه عند الثانية 95 من 100.
  await writeFile(player, `#!${process.execPath}\nimport net from 'node:net';import fs from 'node:fs';const args=process.argv.slice(2),socket=args.find(x=>x.startsWith('--input-ipc-server=')).slice(19);
let conn;const send=o=>conn&&conn.write(JSON.stringify(o)+'\\n');
net.createServer(c=>{conn=c;let buf='';c.on('data',b=>{buf+=b;while(buf.includes('\\n')){const i=buf.indexOf('\\n'),m=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);
  const data=m.command[0]==='get_property'?(m.command[1]==='demuxer-cache-state'?{'fw-bytes':0}:{w:320,h:180}):undefined;
  send({request_id:m.request_id,error:'success',data});
  if(m.command[0]==='observe_property'){const n=m.command[2];send({event:'property-change',name:n,data:n==='duration'?100:n==='time-pos'?0:n==='video-out-params'?{w:320,h:180}:n==='track-list'?[]:false});}
  if(m.command[0]==='loadfile'){const url=m.command[1];fs.writeFileSync(${JSON.stringify(join(dir, 'url'))},url);send({event:'playback-restart'});
    fetch(url,{headers:{Range:'bytes=0-'}}).then(async r=>{const body=Buffer.from(await r.arrayBuffer());fs.writeFileSync(${JSON.stringify(join(dir, 'read.tmp'))},body);fs.renameSync(${JSON.stringify(join(dir, 'read.tmp'))},${JSON.stringify(join(dir, 'read'))});send({event:'property-change',name:'time-pos',data:95});});}
}});}).listen(socket);`);
  await chmod(wrapper, 0o755); await chmod(player, 0o755);

  const events = [], userData = join(dir, 'client'); await mkdir(userData);
  const limits = { behindSeconds: 5, minBehindBytes: 256 * 1024, minEvictBytes: 256 * 1024, pauseBelowFree: 1, resumeAboveFree: 2, hardFloorFree: 0, starvingAheadSeconds: 1 };
  const services = createDesktopServices({ userData, binaries: { rqbit: wrapper, mpv: player }, onEvent: (e) => events.push(e), windowTickMs: 300, windowLimits: limits });
  t.after(() => services.close());
  assert.deepEqual(await services.startPlayback({ session: 'window', candidate: { infoHash: hash }, title: 'نافذة' }), { started: true });

  // 1) المشغّل قرأ الفيلم كاملًا وصحيحًا عبر الوكيل
  const read = await until(() => readFile(join(dir, 'read')).catch(() => null), 60000);
  assert.equal(Buffer.compare(read, film), 0, 'بيانات البث تطابق الأصل');

  // 2) ما خلف الثانية 90 (95 ناقص 5 ث) فُرّغ من القرص فعلًا والحجم المنطقي باقٍ
  const file = await until(() => findFile(userData, 'film.mkv'));
  const after = await until(async () => { const s = await stat(file); return s.blocks * 512 < film.length / 2 ? s : null; }, 20000);
  assert.equal(after.size, film.length, 'الحجم المنطقي ثابت');
  assert.ok(after.blocks * 512 < film.length / 2, `على القرص ${after.blocks * 512} من ${film.length}`);
  const cache = events.filter((e) => e.type === 'playback/cache').at(-1);
  assert.ok(cache.evictedBytes > 20 * MiB, `فُرّغ ${cache.evictedBytes}`);

  // 3) رجوع لبداية الفيلم: يعاد البناء ولا تصل أصفار
  const url = await readFile(join(dir, 'url'), 'utf8');
  const back = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
  assert.equal(back.status, 206);
  const head = Buffer.from(await back.arrayBuffer());
  assert.equal(Buffer.compare(head, film.subarray(0, 65536)), 0, 'البداية صحيحة بعد إعادة البناء');
  assert.ok(events.some((e) => e.type === 'playback/retrying' && /أعاد|نعيد/.test(e.message)));

  // 4) الإغلاق يحذف ملفات الجلسة
  await services.stopPlayback({ session: 'window' });
  assert.equal(await findFile(userData, 'film.mkv'), null, 'لا يبقى شيء بعد الإغلاق');
});
