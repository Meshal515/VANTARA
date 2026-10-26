import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowsStableChannel } from './windows-stable-channel.mjs';
import { readFileSync } from 'node:fs';
import { desktopUpdateFromManifest, newerVersion } from '../apps/web/desktop/update-check.js';
const release = code => {
  const version=`0.4.${code}`,base=`https://github.com/Meshal515/VANTARA/releases/download/stable-${code}`;
  const item=name=>({url:`${base}/${name}`,size:100,sha256:'a'.repeat(64)});
  return {format:2,versionCode:code,versionName:version,native:'a'.repeat(24),apk:item('VANTARA-stable.apk'),web:item('VANTARA-web.zip'),desktop:{...item(`VANTARA-${version}-Windows-x64-Setup.exe`),version,platform:'win32-x64',installer:'nsis'}};
};
test('legacy clients receive a genuinely newer unified version only after Windows is ready',()=>{
  const next=release(214),prior={format:1,product:'VANTARA',version:'0.3.18'};
  assert.equal(windowsStableChannel(next,prior),next);
  assert.equal(newerVersion(next.versionName, prior.version), true);
  for (const installed of ['0.3.18', '0.0.209', '0.0.210', '0.0.213']) {
    assert.equal(desktopUpdateFromManifest(next, installed)?.version, '0.4.214');
  }
  assert.equal(desktopUpdateFromManifest(next, '0.4.214'), null);
  assert.throws(()=>windowsStableChannel({...next,desktop:null},prior),/not published/);
});
test('Windows promotion is serialized across releases and follows installer verification',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/windows-stable-companion.yml',import.meta.url),'utf8');
  assert.match(workflow,/group: windows-stable-publish\s+cancel-in-progress: false/);
  assert.match(workflow,/needs: \[resolve, build, verify\]/);
  const verified=workflow.indexOf('cmp "$installer"');
  const promotion=workflow.indexOf('node tools/windows-stable-channel.mjs');
  assert.ok(verified>0 && promotion>verified);
  assert.ok(workflow.indexOf('gh release upload windows-channel')>promotion);
});
test('channel never regresses, and repeated promotion preserves immutable Windows identity',()=>{
  assert.throws(()=>windowsStableChannel(release(214),release(215)),/rollback/);
  assert.equal(windowsStableChannel(release(214),release(214)).versionCode,214);
  const changed=release(214);changed.desktop.sha256='b'.repeat(64);
  assert.throws(()=>windowsStableChannel(changed,release(214)),/immutable/);
});
