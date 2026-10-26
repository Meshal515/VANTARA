'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validUpdate, downloadUpdate, installCommand, attemptFailed } = require('./updater.cjs');

const bytes = Buffer.from('VANTARA installer bytes '.repeat(5000));
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const url = 'https://github.com/Meshal515/VANTARA/releases/download/windows-v0.2.5/VANTARA-0.2.5-Windows-x64-Setup.exe';
const update = { version: '0.2.5', url, sha256, size: bytes.length };

test('main process refuses old Windows lineage and enforces Stable order independently',()=>{
  const {assertForwardUpdate}=require('./updater.cjs');
  assert.throws(()=>assertForwardUpdate(update,'0.0.209'),/القديمة/);
  const stable={...update,version:'0.4.214',url:'https://github.com/Meshal515/VANTARA/releases/download/stable-214/VANTARA-0.4.214-Windows-x64-Setup.exe'};
  assert.equal(assertForwardUpdate(stable,'0.0.213').version,'0.4.214');
  assert.equal(assertForwardUpdate(stable,'0.3.18').version,'0.4.214');
  assert.throws(()=>assertForwardUpdate(stable,'0.4.214'),/أقدم/);
  assert.throws(()=>assertForwardUpdate(stable,'0.4.215'),/أقدم/);
  assert.throws(()=>assertForwardUpdate({...stable,version:'0.4.215'},'0.0.209'),/هوية/);
  assert.throws(()=>assertForwardUpdate(stable,'0.0.0'),/معروف/);
});
const fetchOf = (body, status = 200) => async () => new Response(body, { status });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vantara-update-'));

test('only the official published installer is accepted', () => {
  assert.equal(validUpdate(update).url, url);
  for (const bad of [url.replace('github.com', 'evil.com'), url + '?x=1', url.replace('Meshal515', 'other'), url.replace('Setup.exe', 'Setup.msi'), 'http://github.com/Meshal515/VANTARA/releases/download/windows-v0.2.5/VANTARA-0.2.5-Windows-x64-Setup.exe'])
    assert.throws(() => validUpdate({ ...update, url: bad }));
  assert.throws(() => validUpdate({ ...update, sha256: 'x' }));
  assert.throws(() => validUpdate({ ...update, size: 0 }));
});

test('downloads, verifies the hash, reports progress and reuses a verified file', async () => {
  const dir = tmp();
  const progress = [];
  const file = await downloadUpdate({ update, dir, fetch: fetchOf(bytes), onProgress: (p) => progress.push(p) });
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.deepEqual(progress.at(-1), { received: bytes.length, total: bytes.length });
  let fetched = false;
  assert.equal(await downloadUpdate({ update, dir, fetch: async () => { fetched = true; throw new Error('no'); } }), file);
  assert.equal(fetched, false);
});

test('a tampered or truncated download is rejected and leaves nothing runnable', async () => {
  const dir = tmp();
  const tampered = Buffer.from(bytes); tampered[10] ^= 1;
  await assert.rejects(downloadUpdate({ update, dir, fetch: fetchOf(tampered) }), /بصمة/);
  await assert.rejects(downloadUpdate({ update, dir, fetch: fetchOf(bytes.subarray(0, 100)) }), /ناقص/);
  await assert.rejects(downloadUpdate({ update, dir, fetch: fetchOf(Buffer.concat([bytes, bytes])) }), /أكبر/);
  await assert.rejects(downloadUpdate({ update, dir, fetch: fetchOf('', 404) }), /404/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('install command runs the NSIS installer itself (no PowerShell) over the running folder, relaunching only when asked', () => {
  const exe = 'C:\\Users\\مشعل\\AppData\\Local\\Programs\\VANTARA\\VANTARA.exe';
  const installer = "C:\\Users\\O'Neil Smith\\AppData\\Roaming\\VANTARA\\updates\\VANTARA-0.2.5-Setup.exe";
  const now = installCommand({ installer, exe, relaunch: true });
  assert.equal(now.file, installer);
  assert.deepEqual(now.args, ['/S /UPDATE /RELAUNCH /D=C:\\Users\\مشعل\\AppData\\Local\\Programs\\VANTARA']);
  assert.equal(now.options.windowsVerbatimArguments, true);
  assert.equal(now.options.argv0, `"${installer}"`);
  assert.equal(now.options.detached, true);
  assert.doesNotMatch(JSON.stringify(now), /powershell|EncodedCommand|Bypass/i);
  assert.deepEqual(installCommand({ installer, exe, relaunch: false }).args, ['/S /UPDATE /D=C:\\Users\\مشعل\\AppData\\Local\\Programs\\VANTARA']);
  assert.deepEqual(installCommand({ installer, exe, relaunch: true, interactive: true }).args, ['/UPDATE /RELAUNCH /D=C:\\Users\\مشعل\\AppData\\Local\\Programs\\VANTARA']);
  assert.throws(() => installCommand({ installer, exe: 'C:\\bad"dir\\VANTARA.exe', relaunch: true }));
});

test('an update that did not take effect is detected, so the next attempt is visible instead of looping silently', () => {
  assert.equal(attemptFailed({ version: '0.3.0' }, '0.2.9'), true);
  assert.equal(attemptFailed({ version: '0.3.0' }, '0.3.0'), false);
  assert.equal(attemptFailed({ version: '0.3.0' }, '0.3.1'), false);
  assert.equal(attemptFailed(null, '0.2.9'), false);
  assert.equal(attemptFailed({ version: 7 }, '0.2.9'), false);
});

test('a new download keeps the attempt record that drives the visible retry', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'attempt.json'), '{"version":"0.2.5"}');
  fs.writeFileSync(path.join(dir, 'VANTARA-0.2.4-Setup.exe'), 'old');
  await downloadUpdate({ update, dir, fetch: fetchOf(bytes) });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['VANTARA-0.2.5-Setup.exe', 'attempt.json']);
});
