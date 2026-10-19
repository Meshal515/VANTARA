const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const binary=process.env.VANTARA_VIDEO_HOST_BINARY;
test('Windows clipboard contains an actual CF_HDROP file usable by external apps',{skip:process.platform!=='win32'||!binary},async t=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'vantara-share-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=join(dir,'لحظة owned.mp4');await fs.writeFile(file,'owned clipboard test');
 await run(binary,['--copy-file',file],{windowsHide:true,shell:false});
 const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; @(Get-Clipboard -Format FileDropList | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.FullName } }) | ConvertTo-Json -Compress"],{windowsHide:true,shell:false});
 const value=JSON.parse(stdout.replace(/^\uFEFF/,''));
 // CF_HDROP may canonicalize the Windows 8.3 short temp path (RUNNER~1)
 // to its long name (runneradmin). Verify file identity and REAL bytes,
 // not the caller's particular path spelling.
 const items=Array.isArray(value)?value:[value];
 assert.equal(items.length,1);
 assert.equal(await fs.realpath(items[0]),await fs.realpath(file));
 assert.equal(await fs.readFile(items[0],'utf8'),'owned clipboard test');
});
test('bundled Windows MPV encodes the selected owned fixture without a separate ffmpeg executable',{skip:process.platform!=='win32'||!process.env.VANTARA_MPV_BINARY,timeout:30000},async t=>{
 const {createMomentExporter}=await import('./src/moment-export.mjs');
 const dir=await fs.mkdtemp(join(tmpdir(),'vantara-windows-encode-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const source=join(__dirname,'../../android/app/src/androidTest/assets/addon-torrent-proof.mp4');
 const exporter=createMomentExporter({mpv:process.env.VANTARA_MPV_BINARY,videosDir:join(dir,'Videos')});
 const result=await exporter.exportClip({url:source,startMs:1250,endMs:3750,filename:'owned-clip.mp4',action:'save'});
 assert.equal(result.saved,true);assert.equal(result.endMs-result.startMs,2500);
 const contents=await fs.readFile(result.path);assert.ok(contents.length>32&&contents.length<=16*1024**2);assert.ok(contents.includes(Buffer.from('ftyp')));
 assert.deepEqual(await fs.readdir(join(dir,'Videos','VANTARA')),[result.filename]);
});
