// قياس جدولة الكتل (0004) قبل وبعد بنفس الظروف: ثلاثة باذرين (vantara-torrent --seed) كل واحد خلف وسيط بسرعة وزمن رحلة
// مختلفين (سريع، متوسط، بطيء يحتجز كتلًا)، وhint-bench بتلميح القراءة وبلا تلميح، لكل حجم قطعة وكل موضع داخلها.
// node hint-bench.mjs <vantara-torrent> <hint-bench> [rounds=2] [sizesKB=512,1024,4096,8192,16384] [offsets=0,0.25,0.5,0.9] [tail=0|1]
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const [host, bench, rounds = '2', sizesArg = '512,1024,4096,8192,16384', offsetsArg = '0,0.25,0.5,0.9', tailArg = '0'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const PEERS = [{ bps: 2 << 20, delay: 40 }, { bps: 512 << 10, delay: 80 }, { bps: 64 << 10, delay: 120 }];

function throttle(target, bps, delayMs) {
  const server = net.createServer((client) => {
    const upstream = net.connect(target, '127.0.0.1');
    const pipe = (from, to) => {
      const queue = []; let budget = 0, ended = false;
      const timer = setInterval(() => {
        budget = Math.min(budget + bps / 100, bps / 10);
        const now = Date.now();
        while (queue.length && queue[0].at <= now && budget >= 1) {
          const n = Math.min(queue[0].buf.length, Math.floor(budget));
          to.write(queue[0].buf.subarray(0, n)); budget -= n;
          if (n === queue[0].buf.length) queue.shift(); else queue[0].buf = queue[0].buf.subarray(n);
        }
        if (ended && !queue.length) { clearInterval(timer); to.end(); }
      }, 10);
      from.on('data', (buf) => queue.push({ buf, at: Date.now() + delayMs }));
      from.on('end', () => { ended = true; });
      from.on('close', () => { ended = true; });
      from.on('error', () => { clearInterval(timer); to.destroy(); });
    };
    upstream.on('connect', () => { pipe(client, upstream); pipe(upstream, client); });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server)));
}

async function swarm(dir, pieceKB) {
  const size = Math.max(48 << 20, pieceKB * 1024 * 8);
  const seedDir = join(dir, 'seed'); await mkdir(seedDir, { recursive: true });
  const file = join(seedDir, 'episode.mkv');
  await writeFile(file, randomBytes(size));
  const seeders = [], proxies = [];
  let magnet = null;
  for (const peer of PEERS) {
    const port = await freePort();
    const proc = spawn(host, [`--seed=${file}`, `--listen-port=${port}`, `--piece-size=${pieceKB * 1024}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    const line = await new Promise((res, rej) => { let out = ''; proc.stdout.on('data', (c) => { out += c; if (out.includes('\n')) res(out.split('\n')[0].trim()); }); proc.once('exit', (c) => rej(new Error(`seeder ${c}`))); });
    const hash = line.match(/btih:([a-f0-9]{40})/i)[1];
    if (magnet && !magnet.includes(hash)) throw new Error('seeders produced different info hashes');
    const proxy = await throttle(port, peer.bps, peer.delay);
    seeders.push(proc); proxies.push(proxy);
    magnet = (magnet ?? line.replace(/&x\.pe=[^&]+/g, '')) + `&x.pe=127.0.0.1:${proxy.address().port}`;
  }
  return { file, magnet, close: async () => { for (const s of seeders) s.kill(); for (const p of proxies) p.close(); await sleep(300); } };
}

const run = (args) => new Promise((res) => execFile(bench, args, { timeout: 150000 }, (error, stdout) => {
  try { res(JSON.parse(stdout.trim().split('\n').pop())); } catch { res({ error: String(error?.message ?? 'no output'), stdout }); }
}));

const sizes = sizesArg.split(',').map(Number), offsets = offsetsArg.split(',').map(Number);
for (const kb of sizes) {
  const dir = await mkdtemp(join(tmpdir(), 'hint-bench-'));
  const s = await swarm(dir, kb);
  try {
    for (const off of offsets) for (let r = 0; r < Number(rounds); r++) for (const hints of r % 2 ? [1, 0] : [0, 1]) {
      const save = join(dir, `dl-${off}-${r}-${hints}`); await mkdir(save, { recursive: true });
      const out = await run([s.magnet, save, s.file, String(off), String(hints), tailArg]);
      console.log(JSON.stringify({ pieceKB: kb, round: r, ...out }));
      await rm(save, { recursive: true, force: true });
    }
  } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
}
process.exit(0);
