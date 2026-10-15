import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHolePuncher } from './torrent-window.mjs';

// ويندوز حقيقي (NTFS): المساحة الفعلية على القرص بعد التفريغ تنزل، والحجم المنطقي والبيانات اللاحقة باقية،
// والملف مفتوح للكتابة عند عملية أخرى (كما يفتحه rqbit) أثناء التفريغ.
const MiB = 1024 * 1024;
function allocatedBytes(path) {
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class C{[DllImport("kernel32.dll",CharSet=CharSet.Unicode)]public static extern uint GetCompressedFileSizeW(string p,out uint h);}';$h=0;$l=[C]::GetCompressedFileSizeW($env:VANTARA_PATH,[ref]$h);[Console]::Out.Write(([uint64]$h -shl 32) + $l)`;
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, VANTARA_PATH: path } }).toString().trim());
}

test('تفريغ نطاق على NTFS يحرّر المساحة والملف مفتوح للكتابة', { skip: process.platform !== 'win32', timeout: 120000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'vantara-ntfs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'film.mkv');
  const writer = await open(file, 'w+');
  t.after(() => writer.close().catch(() => {}));
  await writer.write(Buffer.alloc(64 * MiB, 7), 0, 64 * MiB, 0);
  await writer.sync();
  const before = allocatedBytes(file);
  assert.ok(before >= 64 * MiB, `قبل: ${before}`);
  const puncher = createHolePuncher('win32');
  t.after(() => puncher.close());
  assert.equal(await puncher.punch(file, 0, 48 * MiB), true);
  const after = allocatedBytes(file);
  assert.ok(after <= 20 * MiB, `بعد التفريغ على القرص ${after}`);
  assert.equal((await stat(file)).size, 64 * MiB);
  const data = await readFile(file);
  assert.equal(data[0], 0);
  assert.equal(data[60 * MiB], 7);
  // تفريغ ثانٍ (نفس العملية الدائمة) يعمل
  assert.equal(await puncher.punch(file, 48 * MiB, 8 * MiB), true);
});
