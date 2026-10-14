import test from 'node:test';
import assert from 'node:assert/strict';
import { newerVersion, desktopUpdateFromManifest, checkDesktopUpdate } from './update-check.js';

const release = {
  format:2,versionName:'0.0.140',versionCode:140,
  desktop:{version:'0.0.140',sha256:'a'.repeat(64),size:230000000,
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
