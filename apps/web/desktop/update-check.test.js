import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { newerVersion, desktopUpdateFromManifest, checkDesktopUpdate, startDesktopUpdateWatch, describeInstalled } from './update-check.js';

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
  // إصدار مجهول لا يعرض «التحديث جاهز» بعد كل تثبيت
  assert.equal(desktopUpdateFromManifest(release,'0.0.0'),null);
  assert.equal(desktopUpdateFromManifest(release,undefined),null);
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

const windowsRelease = {format:1,product:'VANTARA',platform:'win32-x64',installer:'nsis',version:'0.3.18',sha256:'b'.repeat(64),size:240000000,
  url:'https://github.com/Meshal515/VANTARA/releases/download/windows-v0.3.18/VANTARA-0.3.18-Windows-x64-Setup.exe',notes:['قناة قديمة']};
test('root cause: Stable 0.0.N never accepts the stale 0.3.x windows-channel as an "update"',async()=>{
  assert.equal(desktopUpdateFromManifest(windowsRelease,'0.0.215'),null);
  assert.equal(desktopUpdateFromManifest(windowsRelease,{version:'0.0.215',channel:'stable',build:215}),null);
  const bridge={version:'0.0.215',channel:'stable',build:215,requestResource:async({url})=>{assert.match(url,/releases\/latest\/download\/vantara-update\.json$/);return {status:200,text:JSON.stringify(windowsRelease)};}};
  await assert.rejects(checkDesktopUpdate(bridge),/غير متاح/);
});
test('Stable compares the build number so an older stable-N is never offered',()=>{
  assert.equal(desktopUpdateFromManifest(release,{version:'0.0.139',channel:'stable',build:139})?.build,140);
  assert.equal(desktopUpdateFromManifest(release,{version:'0.0.140',channel:'stable',build:140}),null);
  assert.equal(desktopUpdateFromManifest(release,{version:'0.0.141',channel:'stable',build:141}),null);
});

const debugRelease=build=>({format:3,product:'VANTARA',channel:'windows-debug',platform:'win32-x64',installer:'nsis',version:`0.4.${build}`,build,
  sha256:'c'.repeat(64),size:230000000,sourceSha:'0123456789abcdef0123456789abcdef01234567',builtAt:'2026-11-13T12:00:00Z',
  url:`https://github.com/Meshal515/VANTARA/releases/download/windows-debug-${build}/VANTARA-Debug-0.4.${build}-Windows-x64-Setup.exe`,notes:['تصفح عمودي']});
test('Debug reads only its own channel, requires a strictly newer build, and rejects Stable manifests',async()=>{
  const installed={version:'0.4.12',channel:'debug',build:12};
  assert.equal(desktopUpdateFromManifest(debugRelease(13),installed)?.build,13);
  for(const build of [12,11,1])assert.equal(desktopUpdateFromManifest(debugRelease(build),installed),null);
  assert.equal(desktopUpdateFromManifest(release,installed),null);
  for(const change of [{channel:'windows-stable'},{build:14},{version:'0.4.99'},{url:debugRelease(13).url.replace('windows-debug-13','windows-debug-12')},{format:1}])
    assert.equal(desktopUpdateFromManifest({...debugRelease(13),...change},installed),null);
  let asked=null;
  const bridge={...installed,requestResource:async({url})=>{asked=url;return {status:200,text:JSON.stringify(debugRelease(13))};}};
  assert.equal((await checkDesktopUpdate(bridge))?.version,'0.4.13');
  assert.match(asked,/windows-debug-channel\/desktop-debug\.json$/);
  await assert.rejects(checkDesktopUpdate({...bridge,requestResource:async()=>({status:200,text:JSON.stringify(release)})}),/Debug/);
  assert.equal(describeInstalled({...installed,sourceSha:'abcdef1234',builtAt:'2026-11-13T12:00:00Z'}),'VANTARA Debug 0.4.12 · بناء 12 · abcdef1 · 2026-11-13');
});
test('Settings shows the real update first; download starts only after consent, then restart or install on quit',async()=>{
  const {parseHTML}=await import('linkedom');
  const {document}=parseHTML('<html><head></head><body></body></html>');
  let listener=null,downloads=0,applied=0;
  const bridge={version:'0.4.12',channel:'debug',build:12,requestResource:async()=>({status:200,text:JSON.stringify(debugRelease(13))}),openUpdatePage:async()=>true,
    onEvent:fn=>{listener=fn;return()=>{listener=null;};},
    downloadUpdate:async()=>{downloads++;listener?.({type:'update/progress',received:120*1048576,total:230000000});return {ready:true,version:'0.4.13'};},
    applyUpdate:async()=>{applied++;return true;}};
  const watch=startDesktopUpdateWatch({bridge,doc:document});
  const result=await watch.check({force:true});
  assert.equal(result.status,'available');
  let bar=document.querySelector('[data-vantara-desktop-update]');
  assert.match(bar.textContent,/تحديث متاح: VANTARA Debug 0\.4\.13 · بناء 13/);
  assert.match(bar.textContent,/تصفح عمودي/);
  assert.equal(downloads,0,'no download before the user approves');
  const [install]=bar.querySelectorAll('button');
  assert.equal(install.textContent,'تنزيل وتثبيت');
  install.onclick();await new Promise(r=>setTimeout(r,0));
  assert.equal(downloads,1);
  bar=document.querySelector('[data-vantara-desktop-update]');
  assert.match(bar.textContent,/التحديث جاهز: VANTARA Debug 0\.4\.13/);
  const [restart,onQuit]=bar.querySelectorAll('button');
  assert.equal(restart.textContent,'أعد التشغيل وحدّث');
  restart.onclick();await new Promise(r=>setTimeout(r,0));
  assert.equal(applied,1);
  onQuit.onclick();
  assert.equal(document.querySelector('[data-vantara-desktop-update]'),null);
  await watch.check({force:true});
  assert.equal(document.querySelector('[data-vantara-desktop-update]'),null,'same version is not offered twice in one session');
  watch.close();
});
test('a portable copy or a failed download falls back to the manual installer link',async()=>{
  const {parseHTML}=await import('linkedom');
  const {document}=parseHTML('<html><head></head><body></body></html>');
  const bridge={version:'0.4.12',channel:'debug',build:12,requestResource:async()=>({status:200,text:JSON.stringify(debugRelease(13))}),openUpdatePage:async()=>true,downloadUpdate:async()=>({ready:false,manual:true})};
  const watch=startDesktopUpdateWatch({bridge,doc:document});
  await watch.check({force:true});
  document.querySelector('[data-vantara-desktop-update] button').onclick();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(document.querySelector('[data-vantara-desktop-update] button').textContent,'تحميل المثبت');
  watch.close();
});

test('Windows boot and resume never check, download or show an update', async () => {
  vi.useFakeTimers();
  const {parseHTML}=await import('linkedom');
  const {document}=parseHTML('<html><head></head><body></body></html>');
  document.visibilityState='visible';
  let queries=0,downloads=0;
  const bridge={version:'0.4.12',channel:'debug',build:12,requestResource:async()=>{queries++;return {status:200,text:JSON.stringify(debugRelease(13))};},openUpdatePage:async()=>true,
    downloadUpdate:async()=>{downloads++;return {ready:true};}};
  const watch=startDesktopUpdateWatch({bridge,doc:document});
  try {
    await watch.check();
    document.dispatchEvent(new document.defaultView.Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(4*60*60*1000);
    assert.equal(queries,0);
    assert.equal(downloads,0);
    assert.equal(document.querySelector('[data-vantara-desktop-update]'),null);
    await watch.check({force:true});
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(queries,1);
    assert.equal(downloads,0,'checking alone never downloads');
    assert.ok(document.querySelector('[data-vantara-desktop-update]'));
  } finally {watch.close();vi.useRealTimers();}
});
