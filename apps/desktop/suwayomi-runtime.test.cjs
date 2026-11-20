'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createSuwayomiRuntime, launchArgs, PINNED } = require('./suwayomi-runtime.cjs');

const zipBytes = Buffer.from('pretend-zip '.repeat(1000));
const pinned = { ...PINNED, sha256: crypto.createHash('sha256').update(zipBytes).digest('hex') };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vantara-engine-'));

function fakeChild(onStart) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.exitCode = null; child.killed = false; child.pid = 4242;
  child.kill = () => { child.killed = true; child.exitCode = 0; setImmediate(() => child.emit('exit', 0)); return true; };
  setImmediate(() => onStart(child));
  return child;
}

function harness({ sha = pinned.sha256, javaExits = false, healthyAfter = 2 } = {}) {
  const root = tmp();
  const spawned = [];
  let health = 0;
  const spawn = (file, args, options) => {
    spawned.push({ file, args, options });
    if (String(file).endsWith('tar.exe')) {
      return fakeChild((child) => {
        const into = args[args.indexOf('-C') + 1];
        const dir = path.join(into, pinned.folder);
        fs.mkdirSync(path.join(dir, 'jre', 'bin'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'jre', 'bin', 'java.exe'), 'java');
        fs.writeFileSync(path.join(dir, 'bin', 'Suwayomi-Server.jar'), 'jar');
        child.emit('exit', 0);
      });
    }
    return fakeChild((child) => {
      child.stdout.emit('data', `started with ${args.find((a) => a.includes('authPassword'))}\n`);
      if (javaExits) { child.exitCode = 1; child.emit('exit', 1); }
    });
  };
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url: String(url), auth: init.headers?.authorization ?? null });
    if (String(url) === pinned.url) return new Response(zipBytes, { headers: { 'content-length': String(zipBytes.length) } });
    if (String(url).endsWith('/api/v1/settings/about')) { health += 1; return new Response('{}', { status: health >= healthyAfter ? 200 : 503 }); }
    return new Response('ok');
  };
  const progress = [];
  const runtime = createSuwayomiRuntime({ root, platform: 'win32', fetch, spawn, tar: 'C:\\Windows\\System32\\tar.exe', pinned: { ...pinned, sha256: sha }, healthIntervalMs: 5, startTimeoutMs: 2000, idleStopMs: 0, onProgress: (p) => progress.push(p.stage) });
  return { root, runtime, spawned, requests, progress };
}

test('the engine listens on loopback only, with BASIC auth, and without its web UI, tray or browser', () => {
  const args = launchArgs({ dataDir: 'C:\\Users\\u\\AppData\\Roaming\\VANTARA\\suwayomi\\data', port: 41234, password: 'vsecret' });
  const prop = (k) => args.find((a) => a.startsWith(`-Dsuwayomi.tachidesk.config.server.${k}=`))?.split('=').slice(1).join('=');
  assert.equal(prop('ip'), '"127.0.0.1"');
  assert.equal(prop('port'), '41234');
  assert.equal(prop('authMode'), '"BASIC_AUTH"');
  assert.equal(prop('authPassword'), '"vsecret"');
  for (const off of ['webUIEnabled', 'initialOpenInBrowserEnabled', 'systemTrayEnabled', 'kcefEnabled']) assert.equal(prop(off), 'false', off);
  assert.equal(prop('rootDir'), 'C:\\Users\\u\\AppData\\Roaming\\VANTARA\\suwayomi\\data');
  assert.deepEqual(args.slice(-2), ['-jar', path.join('bin', 'Suwayomi-Server.jar')]);
});

test('install: pinned download, SHA-256 verified, only jre and bin extracted, then started with a fresh secret', async () => {
  const h = harness();
  assert.equal(h.runtime.installed(), false);
  const endpoint = await h.runtime.start();
  assert.equal(h.runtime.installed(), true);
  const tar = h.spawned.find((s) => s.file.endsWith('tar.exe'));
  assert.deepEqual(tar.args.slice(-2), [`${pinned.folder}/jre`, `${pinned.folder}/bin`]);
  const java = h.spawned.find((s) => s.file.endsWith('java.exe'));
  assert.equal(java.options.windowsHide, true);
  assert.match(endpoint.base, /^http:\/\/127\.0\.0\.1:\d+$/);
  const password = java.args.find((a) => a.includes('authPassword')).split('=').slice(1).join('=').replace(/"/g, '');
  assert.match(password, /^v[0-9a-f]{48}$/);
  assert.equal(endpoint.auth, `Basic ${Buffer.from(`vantara:${password}`).toString('base64')}`);
  assert.deepEqual([...new Set(h.progress)], ['download', 'extract', 'installed', 'running']);
  // السر لا يُكتب في سجل المحرك، ولا يبقى ملف التنزيل
  assert.doesNotMatch(fs.readFileSync(path.join(h.root, 'engine.log'), 'utf8'), new RegExp(password));
  assert.equal(fs.existsSync(path.join(h.root, 'downloads')), false);
  await h.runtime.request('/api/graphql');
  assert.equal(h.requests.at(-1).auth, endpoint.auth);
  await assert.rejects(h.runtime.request('//evil.example/x'), /مسار غير صالح/);
  await h.runtime.close();
});

test('a download whose SHA-256 differs is refused and leaves no engine behind', async () => {
  const h = harness({ sha: 'f'.repeat(64) });
  await assert.rejects(h.runtime.install(), /بصمة محرك الإضافات لا تطابق/);
  assert.equal(h.runtime.installed(), false);
  assert.equal(h.spawned.length, 0);
  assert.equal(fs.existsSync(path.join(h.root, 'engine')), false);
});

test('an engine that exits during start reports it in Arabic; other platforms do not install', async () => {
  const h = harness({ javaExits: true, healthyAfter: 99 });
  await assert.rejects(h.runtime.start(), /توقف المحرك عند الإقلاع/);
  const other = createSuwayomiRuntime({ root: tmp(), platform: 'linux' });
  await assert.rejects(other.install(), /متاح في ويندوز/);
});
