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

function harness({ sha = pinned.sha256, javaExits = false, healthyAfter = 2, exitIf = () => false } = {}) {
  const root = tmp();
  const spawned = [];
  let health = 0, refused = false;
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
    refused = exitIf(args);
    return fakeChild((child) => {
      child.stdout.emit('data', `started with ${args.find((a) => a.includes('authPassword'))}\n`);
      if (javaExits || exitIf(args)) { child.exitCode = 1; child.emit('exit', 1); }
    });
  };
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url: String(url), auth: init.headers?.authorization ?? null, cookie: init.headers?.cookie ?? null });
    if (String(url) === pinned.url) return new Response(zipBytes, { headers: { 'content-length': String(zipBytes.length) } });
    if (String(url).endsWith('/api/v1/settings/about')) {
      health += 1;
      const headers = new Headers();
      headers.append('set-cookie', 'JSESSIONID=node0abc; Path=/; HttpOnly');
      headers.append('set-cookie', 'suwayomi-basic-csrf=tok-1; Path=/; HttpOnly; SameSite=Strict');
      return new Response('{}', { status: !refused && health >= healthyAfter ? 200 : 503, headers });
    }
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
  assert.deepEqual([...new Set(h.progress)], ['download', 'extract', 'installed', 'starting', 'running']);
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

test('the JVM bytecode verifier is never switched off (a widened run crashed the JVM on real Windows)', () => {
  const args = launchArgs({ dataDir: 'd', port: 1, password: 'p' });
  assert.equal(args.some((a) => /BytecodeVerification|Xverify|noverify|UnlockDiagnosticVMOptions/.test(a)), false);
});

test('file uploads carry the engine session and CSRF cookies (new Suwayomi answers 401 without them)', async () => {
  const h = harness();
  await h.runtime.start();
  const form = new FormData();
  form.append('operations', '{}');
  await h.runtime.request('/api/graphql', { method: 'POST', body: form });
  const upload = h.requests.filter((r) => r.url.endsWith('/api/graphql')).at(-1);
  assert.equal(upload.cookie, 'JSESSIONID=node0abc; suwayomi-basic-csrf=tok-1');
  // ردود غير متوقعة لا تُدخل كوكيز أخرى
  assert.doesNotMatch(upload.cookie, /Path|HttpOnly/);
  await h.runtime.close();
});

// ---------- طبقة التحويل (engine-tools/VantaraExtensionJar) ----------
function convertHarness({ said = '{"ok":true,"classes":55,"retargeted":14,"addedCtors":11,"unresolved":0}', writes = true, toolJar } = {}) {
  const root = tmp();
  const runs = [];
  const spawn = (file, args, options) => {
    assert.ok(args.includes('VantaraExtensionJar'), 'only the converter runs here');
    runs.push({ file, args, options, input: fs.readFileSync(args.at(-2)) });
    return fakeChild((child) => {
      if (writes) fs.writeFileSync(args.at(-1), 'converted-jar');
      child.stdout.emit('data', 'kotlin-logging: initializing...\n');
      child.stdout.emit('data', `${said}\n`);
      child.emit('exit', 0);
    });
  };
  const runtime = createSuwayomiRuntime({ root, platform: 'win32', fetch: async () => new Response(zipBytes), spawn: (file, args, options) => {
    if (String(file).endsWith('tar.exe')) return fakeChild((child) => {
      const dir = path.join(args[args.indexOf('-C') + 1], pinned.folder);
      fs.mkdirSync(path.join(dir, 'jre', 'bin'), { recursive: true }); fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'jre', 'bin', 'java.exe'), 'java'); fs.writeFileSync(path.join(dir, 'bin', 'Suwayomi-Server.jar'), 'jar');
      child.emit('exit', 0);
    });
    return spawn(file, args, options);
  }, tar: 'C:\\Windows\\System32\\tar.exe', pinned, ...(toolJar ? { toolJar } : {}) });
  return { root, runtime, runs };
}

test('convert: the engine JRE runs the shipped tool with the engine jar, inside a work folder removed afterwards', async () => {
  const h = convertHarness();
  const out = await h.runtime.convert(Buffer.from('signed-apk'));
  assert.equal(String(out.jar), 'converted-jar');
  assert.deepEqual(out.report, { ok: true, classes: 55, retargeted: 14, addedCtors: 11, unresolved: 0 });
  const [run] = h.runs;
  assert.ok(run.file.endsWith(path.join('jre', 'bin', 'java.exe')));
  assert.equal(String(run.input), 'signed-apk');
  const cp = run.args[run.args.indexOf('-cp') + 1].split(path.delimiter);
  assert.ok(cp[0].endsWith(path.join('bin', 'Suwayomi-Server.jar')));
  assert.equal(cp[1], require('./suwayomi-runtime.cjs').TOOL_JAR);
  assert.ok(run.args.some((a) => a.startsWith('-Djava.io.tmpdir=') && a.includes(`${path.sep}convert-`)));
  assert.equal(run.options.windowsHide, true);
  assert.ok(!run.args.some((a) => /Xverify|BytecodeVerification|noverify/i.test(a)), 'the converter runs with the JVM verifier on');
  assert.deepEqual(fs.readdirSync(h.root).filter((n) => n.startsWith('convert-')), []);
});

test('convert: a refusal from the tool is an Arabic error with its reason, and nothing is left behind', async () => {
  const h = convertHarness({ said: '{"ok":false,"error":"IllegalStateException: APK بلا classes.dex"}', writes: false });
  await assert.rejects(h.runtime.convert(Buffer.from('x')), (e) => e.code === 'ENGINE_CONVERT' && /classes\.dex/.test(e.message));
  assert.deepEqual(fs.readdirSync(h.root).filter((n) => n.startsWith('convert-')), []);
});

test('convert: a tool jar that does not match its manifest is never run', async () => {
  const dir = tmp();
  const toolJar = path.join(dir, 'vantara-extension-jar.jar');
  fs.writeFileSync(toolJar, 'tampered');
  fs.copyFileSync(require('./suwayomi-runtime.cjs').TOOL_JAR.replace(/\.jar$/, '.json'), path.join(dir, 'vantara-extension-jar.json'));
  const h = convertHarness({ toolJar });
  await assert.rejects(h.runtime.convert(Buffer.from('x')), (e) => e.code === 'ENGINE_CONVERT');
  assert.equal(h.runs.length, 0);
});
