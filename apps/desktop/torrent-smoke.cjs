// وضع إثبات صريح (سطر أوامر فقط): تشغيل تورنت حقيقي داخل VANTARA المثبّت نفسه — Electron الحقيقي
// ونافذة الفيديو المدمجة وmpv المرفق ومحرك libtorrent المرفق (vantara-torrent.exe). الباذر هو المحرك
// نفسه في وضع --seed على loopback بملف fixture مؤلف؛ لا شبكة عامة ولا محتوى خارجي.
//
// يقيس: من الضغط إلى أول إطار، أن المحرك libtorrent لا rqbit، أن التشغيل يتقدم فعلًا، والقفز يعمل.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const net=require('node:net');

async function until(fn,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,80));}throw new Error('انتهت مهلة إثبات التورنت المدمج');}
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});

async function runEmbeddedTorrentSmoke({window,videoHost,native,fixture,reportPath,setServices,publish}) {
  const report={platform:process.platform,engine:null,fallback:false,ready:false,progressed:false,seeked:false,cleanup:false,stages:[]};
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vantara-torrent-proof-'));
  const seedDir=path.join(dir,'seed');await fs.mkdir(seedDir,{recursive:true});
  const clip=path.join(seedDir,path.basename(fixture));await fs.copyFile(fixture,clip);
  const host=path.join(native,'vantara-torrent.exe');
  const seedPort=await freePort();
  const seeder=spawn(host,[`--seed=${clip}`,`--listen-port=${seedPort}`,'--piece-size=262144'],{stdio:['ignore','pipe','ignore'],windowsHide:true});
  let services;
  try{
    report.stage='seed';
    const magnet=await Promise.race([
      new Promise((resolve,reject)=>{let out='';seeder.stdout.on('data',c=>{out+=c;if(out.includes('\n'))resolve(out.split('\n')[0].trim());});seeder.once('exit',code=>reject(new Error(`seeder exited ${code}`)));}),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('seeder timeout')),30000)),
    ]);
    const infoHash=/btih:([a-f0-9]{40})/.exec(magnet)?.[1];
    if(!infoHash)throw new Error('seeder magnet invalid');
    const {createDesktopServices}=await import('./src/services.mjs'),events=[];
    services=createDesktopServices({userData:path.join(dir,'profile'),binaries:{libtorrent:host,rqbit:path.join(native,'rqbit.exe'),mpv:path.join(native,'mpv.exe')},
      videoHost,inputConf:path.join(__dirname,'native-host/input.conf'),torrentMetadataStrategy:'direct-index',torrentTestPeer:`127.0.0.1:${seedPort}`,replayCache:false,
      onEvent:event=>{events.push(event);if(event.type==='playback/stage')report.stages.push(event.stage+(event.engine?`:${event.engine}`:''));publish(event);}});
    await setServices(services);
    await window.loadURL('vantara://app/desktop/video-smoke.html');window.show();window.focus();
    await until(()=>window.webContents.executeJavaScript('window.VantaraVideoSmokeReady===true'));
    report.stage='start-playback';
    const t0=performance.now();
    await services.startPlayback({session:'torrent-proof',candidate:{infoHash,fileIdx:0},title:'تورنت VANTARA المؤلف'});
    await until(()=>events.some(e=>e.type==='playback/ready'&&e.session==='torrent-proof'));
    report.clickToReadyMs=Math.round(performance.now()-t0);report.ready=true;
    report.engine=report.stages.find(s=>s.startsWith('engine-ready:'))?.split(':')[1]??null;
    report.fallback=report.stages.some(s=>s.startsWith('engine-fallback'));
    report.embedded=events.some(e=>e.type==='playback/ready'&&e.embedded);
    report.stage='progress';
    const start=events.filter(e=>e.type==='playback/state'&&Number.isFinite(e.position)).at(-1)?.position??0;
    await until(()=>events.some(e=>e.type==='playback/state'&&e.position>=start+1000&&!e.paused),30000);
    report.progressed=true;
    report.stage='seek';
    const duration=events.filter(e=>Number.isFinite(e.duration)&&e.duration>0).at(-1)?.duration??0;
    const target=Math.max(0,Math.floor(duration*0.6));
    const seekAt=performance.now();
    await services.playbackCommand({session:'torrent-proof',command:'seek',value:target});
    await until(()=>events.some(e=>e.type==='playback/state'&&e.position>=target-500&&performance.now()>seekAt),30000);
    report.seekMs=Math.round(performance.now()-seekAt);report.seeked=true;
    // التقطعات: انتقال buffering من false إلى true بعد أول إطار (لا يشمل التحميل الأول)
    let stalls=0,buffering=false,afterReady=false;
    for(const e of events){if(e.type==='playback/ready')afterReady=true;if(afterReady&&e.type==='playback/state'){if(e.buffering&&!buffering)stalls++;buffering=!!e.buffering;}}
    report.stalls=stalls;
    report.fileBytes=(await fs.stat(clip)).size;
    report.stage='stop';
    await services.stopPlayback({session:'torrent-proof'});
    report.cleanup=true;report.stage='complete';
    report.transport='loopback libtorrent seeder; real Electron, embedded HWND, bundled mpv and vantara-torrent.exe';
  }catch(error){report.error=error.message;}
  finally{
    seeder.kill();
    await services?.close().catch(()=>{});
    await fs.writeFile(reportPath,JSON.stringify(report,null,2));
    await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
  if(report.error)throw new Error(report.error);
}
module.exports={runEmbeddedTorrentSmoke};
