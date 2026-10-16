import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { joinDesktopRelease } from './unified-windows-manifest.mjs';

test('The same stable release publishes Android and Windows with a measured hash', async t => {
  const dir=await mkdtemp(join(tmpdir(),'vantara-manifest-test-'));
  t.after(()=>rm(dir,{force:true,recursive:true}));
  const file=join(dir,'VANTARA-0.0.140-Windows-x64-Setup.exe');
  await writeFile(file,Buffer.alloc(1024,7));
  const current={format:2,versionName:'0.0.140',versionCode:140,native:'a'.repeat(24),apk:{url:'https://github.com/Meshal515/VANTARA/releases/download/stable-140/VANTARA-stable.apk',size:1,sha256:'b'.repeat(64)},web:{url:'https://github.com/Meshal515/VANTARA/releases/download/stable-140/VANTARA-web.zip',size:1,sha256:'c'.repeat(64)}};
  const base='https://github.com/Meshal515/VANTARA/releases/download/stable-140';
  const next=joinDesktopRelease(current,{installerPath:file,baseUrl:base,version:current.versionName});
  assert.equal(next.versionName,current.versionName);
  assert.equal(next.desktop.version,next.versionName);
  assert.equal(next.desktop.url,base+'/VANTARA-0.0.140-Windows-x64-Setup.exe');
  assert.equal(next.desktop.size,1024);
  assert.match(next.desktop.sha256,/^[0-9a-f]{64}$/);
  assert.deepEqual(current.desktop,undefined);
  assert.throws(()=>joinDesktopRelease(current,{installerPath:file,baseUrl:base,version:'0.0.141'}),/تطابق/);
  assert.throws(()=>joinDesktopRelease(current,{installerPath:file,baseUrl:base.replace('stable-140','stable-141'),version:'0.0.140'}),/رابط/);
});
