import { test } from 'vitest';
import assert from 'node:assert/strict';
import { newerVersion, desktopUpdateFromManifest, checkDesktopUpdate } from './update-check.js';

const release = {
  format:2,versionName:'0.0.140',versionCode:140,
  desktop:{platform:'win32-x64',installer:'nsis',version:'0.0.140',sha256:'a'.repeat(64),size:230000000,
    url:'https://github.com/Meshal515/VANTARA/releases/download/stable-140/VANTARA-0.0.140-Windows-x64-Setup.exe'},
  changelog:['إصلاح مشغل الفيديو'],
};
test('Windows previews may migrate to one stable release channel',()=>{
  assert.equal(newerVersion('0.0.141','0.0.140'),true);
  assert.equal(newerVersion('0.0.140','0.0.140'),false);
  assert.ok(desktopUpdateFromManifest(release,'0.1.0-preview.3'));
  assert.ok(desktopUpdateFromManifest(release,'0.0.139'));
  assert.equal(desktopUpdateFromManifest(release,'0.0.140'),null);
});
test('Missing assets and mismatched metadata never offer update',()=>{
  for(const entry of [
    {...release,desktop:null},
    {...release,desktop:{...release.desktop,url:'https://evil.example/setup.exe'}},
    {...release,desktop:{...release.desktop,url:'https://github.com/Meshal515/VANTARA/releases/download/stable-139/VANTARA-0.0.140-Windows-x64-Setup.exe'}},
    {...release,desktop:{...release.desktop,sha256:'bad'}},
    {...release,desktop:{...release.desktop,size:null}},
  ])assert.equal(desktopUpdateFromManifest(entry,'0.0.139'),null);
});
test('Source must respond with a valid manifest',async()=>{
  const bridge={version:'0.1.0-preview.3',requestResource:async()=>({status:200,text:JSON.stringify(release)})};
  assert.deepEqual((await checkDesktopUpdate(bridge))?.version,'0.0.140');
  await assert.rejects(checkDesktopUpdate({...bridge,requestResource:async()=>({status:503,text:'{}'})}),/قراءة/);
});

test('Windows accepts only the matching stable platform metadata',()=>{
  for(const bad of [
    {...release,format:1}, {...release,versionName:'0.0.141'},
    {...release,desktop:{...release.desktop,platform:'android'}},
    {...release,desktop:{...release.desktop,installer:'portable'}},
  ]) assert.equal(desktopUpdateFromManifest(bad,'0.0.139'),null);
});

const windowsRelease = {format:1,product:'VANTARA',platform:'win32-x64',installer:'nsis',version:'0.2.3',sha256:'b'.repeat(64),size:240000000,
  url:'https://github.com/Meshal515/VANTARA/releases/download/windows-v0.2.3/VANTARA-0.2.3-Windows-x64-Setup.exe',notes:['الغرف والتوقيت']};
test('Windows has a dedicated versioned installer channel independent of Android latest',()=>{
  assert.equal(desktopUpdateFromManifest(windowsRelease,'0.1.0-preview.8')?.version,'0.2.3');
  assert.equal(desktopUpdateFromManifest(windowsRelease,'0.2.3'),null);
  assert.equal(desktopUpdateFromManifest(windowsRelease,'0.2.4'),null);
  for(const change of [{version:'0.2.4'},{product:'Other'},{platform:'android'},{url:windowsRelease.url+'?file=other'},{url:windowsRelease.url.replace('windows-v0.2.3','windows-v0.2.2')},{url:windowsRelease.url.replace('github.com','github.com:444')},{size:0},{sha256:''}])
    assert.equal(desktopUpdateFromManifest({...windowsRelease,...change},'0.2.2'),null);
});
test('a missing Windows asset is unavailable, never a false up-to-date result',async()=>{
  const bridge={version:'0.2.3',requestResource:async()=>({status:200,text:JSON.stringify(windowsRelease)})};
  assert.equal(await checkDesktopUpdate(bridge),null);
  await assert.rejects(checkDesktopUpdate({...bridge,requestResource:async()=>({status:200,text:JSON.stringify({format:2,versionName:'0.0.149',versionCode:149})})}),/ويندوز/);
});
