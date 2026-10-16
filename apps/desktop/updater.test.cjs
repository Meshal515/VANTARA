'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validUpdate, downloadUpdate, installCommand } = require('./updater.cjs');

const bytes = Buffer.from('VANTARA installer bytes '.repeat(5000));
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const url = 'https://github.com/Meshal515/VANTARA/releases/download/windows-v0.2.5/VANTARA-0.2.5-Windows-x64-Setup.exe';
const update = { version: '0.2.5', url, sha256, size: bytes.length };
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

test('install command waits for every VANTARA process, installs silently, and relaunches only when asked', () => {
  const exe = 'C:\\Users\\مشعل\\AppData\\Local\\Programs\\VANTARA\\VANTARA.exe';
  const installer = "C:\\Users\\O'Neil\\AppData\\Roaming\\VANTARA\\updates\\VANTARA-0.2.5-Setup.exe";
  const now = installCommand({ installer, exe, relaunch: true });
  assert.equal(now.file, 'powershell.exe');
  assert.match(now.script, /Wait-Process/);
  assert.match(now.script, /-ArgumentList '\/S' -Wait/);
  assert.match(now.script, /Start-Process -FilePath 'C:\\Users\\مشعل\\AppData\\Local\\Programs\\VANTARA\\VANTARA\.exe'/);
  assert.match(now.script, /O''Neil/);
  assert.equal(Buffer.from(now.args.at(-1), 'base64').toString('utf16le'), now.script);
  const onQuit = installCommand({ installer, exe, relaunch: false });
  assert.doesNotMatch(onQuit.script, /Start-Process -FilePath 'C:\\Users\\مشعل/);
});
