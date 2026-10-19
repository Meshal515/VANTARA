import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createMomentExporter,validateMomentExport} from './moment-export.mjs';

test('export request accepts only a bounded selected range and safe generated MP4 name',()=>{
  const base={session:'source',startMs:1250,endMs:3750,filename:'لحظة',action:'save'};
  assert.deepEqual(validateMomentExport(base),{...base,filename:'لحظة.mp4'});
  for(const patch of [{url:'https://other.test/video'},{path:'C:\\other.mp4'},{candidate:{}},{startMs:-1},{endMs:Infinity},{endMs:71251},{endMs:1250},{startMs:0.5},{action:'open'},{filename:'../escape'},{filename:'CON'},{exportHandle:0}])assert.throws(()=>validateMomentExport({...base,...patch}));
});

test('selected range is encoded privately then atomically saved; share hands off the actual MP4',async t=>{
  const dir=await fs.mkdtemp(join(tmpdir(),'vantara-clip-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const executable=join(dir,'encoder');
  await fs.writeFile(executable,`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(join(dir,'args'))},JSON.stringify(args)+'\\n');const o=args.find(a=>a.startsWith('--o='));if(o)fs.writeFileSync(o.slice(4),Buffer.concat([Buffer.from('0000ftypisom'),Buffer.alloc(1024)]));else console.log(args.find(a=>a.startsWith('--term-playing-msg=')).slice(19).split('$')[0]+(args.at(-1).endsWith('clip.mp4')?'2.500000':'8.000000'));`);await fs.chmod(executable,0o755);
  const shared=[];const exporter=createMomentExporter({mpv:executable,videosDir:join(dir,'Videos'),shareFile:async file=>shared.push(file)});
  const value=await exporter.exportClip({url:'http://127.0.0.1:12345/secret/0',startMs:1250,endMs:3750,filename:'لحظة.mp4',action:'share'});
  assert.equal(value.saved,true);assert.equal(value.shareStatus,'clipboard');assert.deepEqual(shared,[value.path]);assert.equal((await fs.stat(value.path)).size,1036);assert.equal(join(dir,'Videos','VANTARA',value.filename),value.path);
  const calls=(await fs.readFile(join(dir,'args'),'utf8')).trim().split('\n').map(JSON.parse);const args=calls.find(a=>a.some(x=>x.startsWith('--o=')));
  assert.ok(args.includes('--start=1.25'));assert.ok(args.includes('--length=2.5'));assert.ok(args.includes('--ovc=libx264'));assert.ok(args.includes('--oac=aac'));assert.ok(args.includes('--hr-seek=yes'));
  assert.deepEqual((await fs.readdir(join(dir,'Videos','VANTARA'))),[value.filename]);
});

const mpv=process.env.VANTARA_MPV_LINUX;
test('real MPV exports only the selected owned frames with H.264/AAC and a bounded duration',{skip:!mpv,timeout:30000},async t=>{
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);
  const dir=await fs.mkdtemp(join(tmpdir(),'vantara-real-moment-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const source=join(dir,'owned.mp4');
  await run('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=red:s=160x90:r=24:d=1.25','-f','lavfi','-i','color=blue:s=160x90:r=24:d=2.5','-f','lavfi','-i','color=green:s=160x90:r=24:d=4.25','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=8','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-map','3:a','-c:v','libx264','-c:a','aac',source]);
  const exporter=createMomentExporter({mpv,videosDir:join(dir,'Videos')});
  const saved=await exporter.exportClip({url:source,startMs:1250,endMs:3750,filename:'owned.mp4',action:'save'});
  const probe=JSON.parse((await run('/usr/bin/ffprobe',['-v','error','-show_entries','stream=codec_name:format=duration','-of','json',saved.path])).stdout);
  assert.ok(Math.abs(Number(probe.format.duration)-2.5)<=0.1);assert.deepEqual(probe.streams.map(x=>x.codec_name).sort(),['aac','h264']);
  const {stdout:frames}=await run('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-i',saved.path,'-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:10*1024*1024});
  const size=160*90*3;assert.ok(frames.length>=size*59);
  for(const offset of [0,frames.length-size]){assert.ok(frames[offset]<30,'selected first/last frame must not include red before the range');assert.ok(frames[offset+2]>200,'selected first/last frame must be blue');}
  await assert.rejects(exporter.exportClip({url:source,startMs:7500,endMs:8500,filename:'overshoot.mp4',action:'save'}),/تتجاوز/);
  assert.deepEqual(await fs.readdir(join(dir,'Videos','VANTARA')),[saved.filename]);
});

test('cancellation waits for native encoder exit and leaves no partial export',async t=>{
  const dir=await fs.mkdtemp(join(tmpdir(),'vantara-cancel-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const binary=join(dir,'encoder');const pidFile=join(dir,'pid');
  await fs.writeFile(binary,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>setTimeout(()=>process.exit(),150));setInterval(()=>{},1000);`);await fs.chmod(binary,0o755);
  const controller=new AbortController();const exporter=createMomentExporter({mpv:binary,videosDir:dir});const pending=exporter.exportClip({url:'http://127.0.0.1/source',startMs:0,endMs:1000,filename:'cancel.mp4',action:'save',signal:controller.signal});
  const pid=await new Promise(resolve=>{const timer=setInterval(async()=>{try{const pid=Number(await fs.readFile(pidFile,'utf8'));clearInterval(timer);resolve(pid);}catch{}},10);});
  controller.abort();await assert.rejects(pending,/أُلغي/);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});

test('encoder failure or oversized output leaves no completed or partial files',async t=>{
  const dir=await fs.mkdtemp(join(tmpdir(),'vantara-failed-export-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const mode of ['failure','oversized']) {
    const binary=join(dir,mode);await fs.writeFile(binary,`#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2),o=args.find(a=>a.startsWith('--o='));if(o){fs.writeFileSync(o.slice(4),'partial');if(${JSON.stringify(mode)}==='failure')process.exit(2);fs.truncateSync(o.slice(4),17*1024*1024);}else console.log(args.find(a=>a.startsWith('--term-playing-msg=')).slice(19).split('$')[0]+'8.000000');`);await fs.chmod(binary,0o755);
    const videos=join(dir,mode+'-Videos'),exporter=createMomentExporter({mpv:binary,videosDir:videos});
    await assert.rejects(exporter.exportClip({url:'http://127.0.0.1/source',startMs:0,endMs:1000,filename:'failed.mp4',action:'save'}),/تصدير|صالح/);
    assert.deepEqual(await fs.readdir(join(videos,'VANTARA')),[]);
  }
});
