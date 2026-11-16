// قياس محرك libtorrent على loopback (ليس سربًا حقيقيًا): زمن أول بايت بعد قفز ومعدل النقل.
//   node tools/torrent-host/loopback-bench.mjs <vantara-torrent> [--piece=262144] [--list-only] [--gap=2000]
// --list-only: يمر بمسار list_only ثم الإضافة كما في services عند غياب fileIdx؛ --gap: مهلة اختيار المستخدم.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import net from 'node:net';
const [bin, ...args] = process.argv.slice(2);
const opt = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const pieceSize = Number(opt('piece', 1048576)), gap = Number(opt('gap', 0)), listOnly = args.includes('--list-only');
const port = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const H = { authorization: 'Basic ' + Buffer.from('bench:bench').toString('base64') };
const dir = await mkdtemp(join(tmpdir(), 'vantara-bench-')); await mkdir(join(dir, 'seed'));
const size = 64 * 1024 * 1024; await writeFile(join(dir, 'seed', 'clip.mp4'), randomBytes(size));
const [SP, AP, LP] = [await port(), await port(), await port()];
const seeder = spawn(bin, [`--seed=${join(dir, 'seed', 'clip.mp4')}`, `--listen-port=${SP}`, `--piece-size=${pieceSize}`], { stdio: ['ignore', 'pipe', 'inherit'] });
const magnet = await new Promise(r => { let o = ''; seeder.stdout.on('data', c => { o += c; if (o.includes('\n')) r(o.split('\n')[0].trim()); }); });
const engine = spawn(bin, [`--api-port=${AP}`, `--listen-port=${LP}`, `--dir=${join(dir, 'cache')}`, '--allow-private-peers'], { env: { ...process.env, RQBIT_HTTP_BASIC_AUTH_USERPASS: 'bench:bench' }, stdio: 'inherit' });
try {
  let ready = false;
  for (let i = 0; i < 250 && !ready; i++) { try { ready = (await fetch(`http://127.0.0.1:${AP}/`, { headers: H })).ok; } catch { await new Promise(r => setTimeout(r, 20)); } }
  if (!ready) throw new Error('engine not ready');
  if (listOnly) await (await fetch(`http://127.0.0.1:${AP}/torrents?list_only=true`, { method: 'POST', body: magnet, headers: H })).json();
  if (gap) await new Promise(r => setTimeout(r, gap));
  const add = await (await fetch(`http://127.0.0.1:${AP}/torrents?only_files=0`, { method: 'POST', body: magnet, headers: H })).json();
  const rows = [];
  for (const [label, from, len] of [['seek 50% (64KB)', size / 2, 65536], ['continue (4MB)', size / 2 + 65536, 4 << 20], ['seek 80% (16MB)', Math.floor(size * 0.8), 16 << 20]]) {
    const t0 = performance.now(); const r = await fetch(`http://127.0.0.1:${AP}/torrents/${add.id}/stream/0`, { headers: { ...H, Range: `bytes=${from}-${from + len - 1}` } });
    const reader = r.body.getReader(); let first = null, got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; first ??= performance.now() - t0; got += value.length; }
    const ms = performance.now() - t0;
    rows.push({ step: label, firstByteMs: Math.round(first), totalMs: Math.round(ms), MBps: +(got / 1048576 / (ms / 1000)).toFixed(1) });
  }
  console.log(JSON.stringify({ pieceSize, listOnly, gap, rows }));
} finally { seeder.kill(); engine.kill(); await new Promise(r => setTimeout(r, 300)); await rm(dir, { recursive: true, force: true }); }
