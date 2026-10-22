// خادم بث صغير لمحرك تورنت واحد (للفحص المقارن فقط): يقدّم ملفًا واحدًا على http://127.0.0.1:<port>/ مع Range.
//   ts-stremio : torrent-stream بإعدادات خادم Stremio (server.js v4.20.8 → enginefs.getDefaults)
//   webtorrent : WebTorrent بإعداداته الافتراضية
// الاستعمال: node torrent-engine-server.mjs <engine> <magnet> <fileIdx> <port> <dir> <node_modules>
import http from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [kind, magnet, fileIdxText, portText, dir, modules] = process.argv.slice(2);
const fileIdx = Number(fileIdxText);
const require = createRequire(join(modules, 'noop.js'));
let file = null;
const waiting = [];
const onFile = (f) => { file = f; for (const fn of waiting.splice(0)) fn(); };

if (kind === 'ts-stremio') {
  const torrentStream = require('torrent-stream');
  // نفس قيم Stremio: 35 اتصالًا، مصافحة 20 ث، مهلة الطلب 4 ث (btMaxConnections/btHandshakeTimeout/btRequestTimeout)
  const engine = torrentStream(magnet, { connections: 35, handshakeTimeout: 20000, timeout: 4000, path: dir, dht: true, tracker: true });
  engine.on('ready', () => { const f = engine.files[fileIdx]; engine.files.forEach((x) => x !== f && x.deselect()); f.select(); onFile(f); });
} else if (kind === 'webtorrent') {
  const { default: WebTorrent } = await import(pathToFileURL(join(modules, 'webtorrent', 'index.js')).href);
  const client = new WebTorrent({ utp: false });
  client.on('error', (e) => console.error('webtorrent', e.message));
  client.add(magnet, { path: dir }, (torrent) => {
    const f = torrent.files[fileIdx];
    torrent.deselect(0, torrent.pieces.length - 1, false);
    torrent.files.forEach((x) => x !== f && x.deselect());
    f.select();
    onFile(f);
  });
} else throw new Error(`unknown engine ${kind}`);

http.createServer((req, res) => {
  const serve = () => {
    const size = file.length, m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    let start = 0, end = size - 1;
    if (m) { if (m[1]) start = Number(m[1]); if (m[2]) end = Math.min(size - 1, Number(m[2])); if (!m[1] && m[2]) { start = size - Number(m[2]); end = size - 1; } }
    if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(m ? 206 : 200, { 'content-type': 'video/x-matroska', 'accept-ranges': 'bytes', 'content-length': end - start + 1, ...(m ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) });
    if (req.method === 'HEAD') return res.end();
    const stream = file.createReadStream({ start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy?.());
    stream.pipe(res);
  };
  if (file) serve(); else waiting.push(serve);
}).listen(Number(portText), '127.0.0.1');
