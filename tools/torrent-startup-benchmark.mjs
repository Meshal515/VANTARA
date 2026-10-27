// Owned local swarm + actual mpv rendered-window evidence. Never imported by the app.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { assessRealtimePlayback, verifyByteRange } from './torrent-validation.mjs';

const nativeSpawn=cp.spawn;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=(bytes,algorithm='sha1')=>createHash(algorithm).update(bytes).digest();
function encode(v){
  if(Buffer.isBuffer(v))return Buffer.concat([Buffer.from(`${v.length}:`),v]);
  if(typeof v==='string')return encode(Buffer.from(v));
  if(typeof v==='number')return Buffer.from(`i${v}e`);
  if(Array.isArray(v))return Buffer.concat([Buffer.from('l'),...v.map(encode),Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'),...Object.keys(v).sort().flatMap(k=>[encode(k),encode(v[k])]),Buffer.from('e')]);
}
export function framePixels(rgb){
  let lit=0,sum=0;
  for(let i=0;i+2<rgb.length;i+=3){const max=Math.max(rgb[i],rgb[i+1],rgb[i+2]);sum+=max;if(max>40)lit++;}
  const pixels=Math.floor(rgb.length/3);
  return {nonblack:pixels>0&&lit/pixels>0.15,litFraction:pixels?lit/pixels:0,meanMaxChannel:pixels?sum/pixels:0};
}
export function summarize(rows){
  const values=rows.filter(r=>r.ok&&Number.isFinite(r.firstRenderedMs)).map(r=>r.firstRenderedMs).sort((a,b)=>a-b),n=values.length;
  return {successful:n,failed:rows.length-n,minMs:values[0]??null,medianMs:n?(values[Math.floor((n-1)/2)]+values[Math.ceil((n-1)/2)])/2:null,p95Ms:n?values[Math.ceil(n*.95)-1]:null,maxMs:values.at(-1)??null};
}
export function playbackHasActuallyStarted({position, paused, buffering}={}) {
  // A rendered still/screenshot does not certify video playback. Never count
  // paused or paused-for-cache mpv output as a running stream.
  return Number.isFinite(position)&&position>0.05&&paused===false&&buffering===false;
}
export function assessPlaybackProgress(sample){
  // Backwards-compatible report helper. Host baselines are diagnostics only.
  const minimumSeconds=sample.observedSeconds*.9;
  return {kind:'realtime',minimumSeconds,passed:sample.observedSeconds>0&&sample.toSeconds-sample.fromSeconds>=minimumSeconds};
}

async function until(fn,timeout=30000){const deadline=performance.now()+timeout;let last;while(performance.now()<deadline){try{const value=await fn();if(value)return value;}catch(e){last=e;}await sleep(25);}throw last??new Error('Benchmark deadline exceeded');}
async function port(){const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const p=s.address().port;await new Promise(r=>s.close(r));return p;}
export async function createUtpFixtureRelay(targetPort){
  assert.ok(Number.isSafeInteger(targetPort)&&targetPort>0&&targetPort<=65535,'Invalid owned peer port');
  const relay=dgram.createSocket('udp4'),clients=new Map();
  relay.on('error',()=>{});
  await new Promise((r,j)=>{relay.once('error',j);relay.bind(0,'127.0.0.1',r);});
  const relayPort=relay.address().port;
  const tcpRejected=await new Promise(resolveTCP=>{
    const socket=net.createConnection({host:'127.0.0.1',port:relayPort});
    const finish=answer=>{socket.destroy();resolveTCP(answer);};
    socket.once('connect',()=>finish(false));socket.once('error',error=>finish(error.code==='ECONNREFUSED'));socket.setTimeout(500,()=>finish(false));
  });
  if(!tcpRejected){relay.close();throw new Error('UDP-only fixture unexpectedly has a TCP listener');}
  relay.on('message',(bytes,from)=>{
    const key=`${from.address}:${from.port}`;let outgoing=clients.get(key);
    if(!outgoing){
      if(clients.size>=16){const [old,socket]=clients.entries().next().value;clients.delete(old);socket.close();}
      outgoing=dgram.createSocket('udp4');clients.set(key,outgoing);outgoing.on('error',()=>{});
      outgoing.on('message',reply=>relay.send(reply,from.port,from.address,()=>{}));
    }
    outgoing.send(bytes,targetPort,'127.0.0.1',()=>{});
  });
  return {port:relayPort,proof:{tcpConnectRejected:true,transport:'UDP-only relay to owned loopback seeder'},close:async()=>{
    for(const socket of clients.values())socket.close();clients.clear();await new Promise(r=>relay.close(r));
  }};
}
async function terminate(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;await new Promise(r=>{const timer=setTimeout(()=>child.kill('SIGKILL'),1500);child.once('exit',()=>{clearTimeout(timer);r();});child.kill();});}
async function command(binary,args,{env=process.env,maxBytes=20*1024*1024}={}){
  return new Promise((resolveCommand,reject)=>{const child=nativeSpawn(binary,args,{env,stdio:['ignore','pipe','pipe'],windowsHide:true});const out=[],err=[];let size=0;
    child.stdout.on('data',b=>{size+=b.length;if(size>maxBytes){child.kill();reject(new Error('Command output limit'));}out.push(b);});child.stderr.on('data',b=>err.push(b));child.once('error',reject);child.once('exit',code=>code===0?resolveCommand(Buffer.concat(out)):reject(new Error(`${basename(binary)} exited ${code}: ${Buffer.concat(err).toString().slice(-2000)}`)));});
}
async function json(api,path,options={}){const response=await fetch(api+path,{...options,signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`HTTP ${response.status}: ${await response.text()}`);return response.json();}
async function ipc(path){
  const socket=await until(()=>new Promise((r,j)=>{const s=net.createConnection(path);s.once('connect',()=>r(s));s.once('error',j);}));let id=0,buffer='';const pending=new Map();
  socket.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const n=buffer.indexOf('\n'),line=buffer.slice(0,n);buffer=buffer.slice(n+1);let m;try{m=JSON.parse(line);}catch{continue;}const p=pending.get(m.request_id);if(p){pending.delete(m.request_id);clearTimeout(p.timer);m.error==='success'?p.resolve(m.data):p.reject(new Error(m.error));}}});
  return {socket,send:command=>new Promise((resolveIPC,reject)=>{const request_id=++id,timer=setTimeout(()=>{pending.delete(request_id);reject(new Error('mpv IPC deadline'));},command[0]==='screenshot-to-file'?20000:3000);pending.set(request_id,{resolve:resolveIPC,reject,timer});socket.write(JSON.stringify({command,request_id})+'\n');}),close(){socket.destroy();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('IPC closed'));}pending.clear();}};
}
async function playerStatus(connection){
  const names=['time-pos','pause','paused-for-cache','speed','hwdec-current','current-vo','video-params','video-out-params','container-fps','estimated-vf-fps','decoder-frame-drop-count','frame-drop-count','vo-delayed-frame-count','demuxer-cache-state'];
  return Object.fromEntries(await Promise.all(names.map(async name=>[name,await connection.send(['get_property',name]).catch(()=>null)])));
}
async function localPlayerProbe(mpv,file,root,nativeEnv){
  const results=[];
  for(const [label,args] of [['default',[]],['d3d11-gpu',['--vo=gpu','--gpu-api=d3d11']],['d3d11-next',['--vo=gpu-next','--gpu-api=d3d11']]]){
    const pipe=process.platform==='win32'?`\\\\.\\pipe\\vantara-probe-${randomBytes(8).toString('hex')}`:join(root,`probe-${label}.sock`);
    const row={label,args};results.push(row);let connection,child;
    try{
      child=nativeSpawn(mpv,['--no-config','--idle=yes','--terminal=no','--force-window=yes','--hwdec=auto-safe','--ao=null',`--input-ipc-server=${pipe}`,`--log-file=${join(root,`local-${label}.log`)}`,...args],{env:nativeEnv,stdio:'ignore'});
      connection=await ipc(pipe);await connection.send(['loadfile',file]);
      await until(async()=>{const p=await connection.send(['get_property','video-params']);return p?.w>0;},15000);
      await until(async()=>{const p=await playerStatus(connection);return playbackHasActuallyStarted({position:p['time-pos'],paused:p.pause,buffering:p['paused-for-cache']});},6000);
      row.before=await playerStatus(connection);const started=performance.now(),samples=[];
      while(!samples.length||performance.now()-started<10000){const p=await playerStatus(connection);samples.push({atSeconds:(performance.now()-started)/1000,position:p['time-pos'],paused:p.pause,buffering:p['paused-for-cache'],droppedFrames:p['frame-drop-count'],delayedFrames:p['vo-delayed-frame-count']});await sleep(250);}
      row.after=await playerStatus(connection);samples.push({atSeconds:(performance.now()-started)/1000,position:row.after['time-pos'],paused:row.after.pause,buffering:row.after['paused-for-cache'],droppedFrames:row.after['frame-drop-count'],delayedFrames:row.after['vo-delayed-frame-count']});row.observedSeconds=(performance.now()-started)/1000;
      row.realtimeAcceptance=assessRealtimePlayback(samples,{seconds:10,fps:row.after['container-fps']??24});row.samples=samples;

    }catch(error){row.error=String(error.message);}finally{connection?.close();await terminate(child);}
    row.softwareAdapter=/Using a software adapter/.test(await fs.readFile(join(root,`local-${label}.log`),'utf8').catch(()=>''));
  }
  await fs.writeFile(join(root,'local-player-probe.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({event:'local-player-probe',results:results.map(r=>({label:r.label,error:r.error,before:r.before?.['time-pos'],after:r.after?.['time-pos'],vo:r.after?.['current-vo'],hwdec:r.after?.['hwdec-current'],softwareAdapter:r.softwareAdapter,realtimeAcceptance:r.realtimeAcceptance}))}));
  return results;
}
async function diskBytes(directory){let logical=0,allocated=0,files=0;try{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory()){const c=await diskBytes(path);logical+=c.logicalBytes;allocated+=c.allocatedBytes??0;files+=c.files;}else if(entry.isFile()){const s=await fs.stat(path);logical+=s.size;allocated+=(s.blocks??0)*512;files++;}}}catch{}return {logicalBytes:logical,allocatedBytes:process.platform==='win32'?null:allocated,files};}
async function snapshotModule(entry,directory){
  const base=dirname(entry),modules=[];const visited=new Set();
  async function copy(file){if(visited.has(file))return;visited.add(file);const rel=relative(base,file);assert.ok(!rel.startsWith('..'),'Runtime import outside source folder');const data=await fs.readFile(file),target=join(directory,rel);await fs.mkdir(dirname(target),{recursive:true});await fs.writeFile(target,data);modules.push({path:rel,sha256:sha(data,'sha256').toString('hex')});for(const m of data.toString().matchAll(/from\s+['"](\.[^'"]+)['"]/g))await copy(resolve(dirname(file),m[1]));}
  await copy(entry);return {entry:join(directory,basename(entry)),modules};
}
async function replayState(userData,fixture,trim=false,corrupt=false){
  const states=[];for(const file of await fs.readdir(userData)){if(!/^torrent-replay-root-v1-[a-f0-9]+\.json$/.test(file))continue;const pointer=JSON.parse(await fs.readFile(join(userData,file),'utf8')),prefix=`.vantara-torrent-cache-${sha(userData,'sha256').toString('hex').slice(0,20)}-replay-v1-`;assert.ok(pointer.namespace.startsWith(prefix)&&basename(pointer.namespace)===pointer.namespace,'Unexpected benchmark replay namespace');const directory=join(pointer.root,pointer.namespace),index=JSON.parse(await fs.readFile(join(directory,'index.json'),'utf8'));
    for(const entry of index.entries){if(entry.descriptor.infoHash!==fixture.infoHash||entry.descriptor.fileIdx!==0)continue;
      if(trim){const head=entry.extents.find(e=>e.start===0);if(head){assert.match(head.file,/^extent-[a-f0-9-]{36}\.bin$/);const bytes=await fs.readFile(join(directory,head.file));assert.equal(sha(bytes,'sha256').toString('hex'),head.sha256);const retained=bytes.subarray(0,Math.min(bytes.length,256*1024));await fs.writeFile(join(directory,head.file),retained);for(const old of entry.extents)if(old!==head){assert.match(old.file,/^extent-[a-f0-9-]{36}\.bin$/);await fs.unlink(join(directory,old.file)).catch(()=>{});}head.length=retained.length;head.sha256=sha(retained,'sha256').toString('hex');entry.extents=[head];await fs.writeFile(join(directory,'index.json'),JSON.stringify(index));}}
      if(corrupt&&entry.extents.length){const file=join(directory,entry.extents[0].file);assert.match(entry.extents[0].file,/^extent-[a-f0-9-]{36}\.bin$/);const bytes=await fs.readFile(file);bytes[0]^=255;await fs.writeFile(file,bytes);}
      states.push({directory,fileLength:entry.descriptor.fileLength,cachedBytes:entry.extents.reduce((sum,e)=>sum+e.length,0),ranges:entry.extents.map(e=>({start:e.start,length:e.length}))});
    }
  }return {entries:states,partialFixtureTrimmed:trim,corruptedFixture:corrupt,available:states.length>0};
}
async function processMetrics(children){
  if(process.platform==='win32'){
    const active=children.filter(({child})=>Number.isSafeInteger(child.pid)&&child.pid>0);
    if(!active.length)return {available:false,reason:'No live benchmark child processes'};
    try{
      // Only Node-assigned integer PIDs enter the script; no paths, titles,
      // torrents or user-controlled shell text. Sampling follows timing/seek checks.
      const ids=active.map(({child})=>child.pid).join(',');
      const script=`$taskProcessIds=@(${ids}); $taskRows=@(Get-Process -Id $taskProcessIds -ErrorAction SilentlyContinue | ForEach-Object { [PSCustomObject]@{pid=$_.Id;cpuSeconds=$_.TotalProcessorTime.TotalSeconds;rssBytes=$_.WorkingSet64;peakRssBytes=$_.PeakWorkingSet64} }); ConvertTo-Json -InputObject $taskRows -Compress`;
      const data=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000}));
      const rows=(Array.isArray(data)?data:[data]).filter(row=>row&&Number.isSafeInteger(row.pid)&&Number.isFinite(row.rssBytes)&&Number.isFinite(row.cpuSeconds));
      return {available:rows.length>0,cpuUnit:'seconds since process start; reused engine totals are cumulative',processes:rows.map(row=>({...row,role:active.find(({child})=>child.pid===row.pid)?.role??'unknown'}))};
    }catch{return {available:false,reason:'Windows process sampler failed'};}
  }
  if(process.platform!=='linux')return {available:false,reason:'Process CPU/RSS collection implemented for Linux only'};
  const rows=[];for(const {child,role} of children){try{const text=await fs.readFile(`/proc/${child.pid}/stat`,'utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' '),status=await fs.readFile(`/proc/${child.pid}/status`,'utf8');rows.push({role,pid:child.pid,cpuTicks:Number(fields[11])+Number(fields[12]),rssBytes:Number(/VmRSS:\s+(\d+)/.exec(status)?.[1]??0)*1024});}catch{}}
  return {available:true,cpuTickUnit:'OS scheduler ticks; not converted to seconds',processes:rows};
}
async function fixture(folder,kind,paddingMiB,ffmpeg,fixturesFrom,pieceLength,audio=false){
  const name=`authored-${kind}.${kind==='mkv'?'mkv':'mp4'}`,path=join(folder,name);
  if(fixturesFrom)await fs.copyFile(join(resolve(fixturesFrom),name),path);
  else {
    await command(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24',...(audio?['-f','lavfi','-i','sine=frequency=440:sample_rate=48000']:[]),'-t','24','-c:v','mpeg4','-q:v','3',...(audio?['-c:a','aac','-b:a','96k']:[]),...(kind==='mp4'?['-movflags','+faststart']:[]),path]);
    if(kind==='late-moov'&&paddingMiB){const source=await fs.readFile(path);let offset=0,moov=-1;while(offset+8<=source.length){const size=source.readUInt32BE(offset),type=source.toString('ascii',offset+4,offset+8);if(type==='moov'){moov=offset;break;}if(size<8)break;offset+=size;}assert.ok(moov>0,'Expected trailing moov');const size=paddingMiB*1024*1024,free=Buffer.alloc(size);free.writeUInt32BE(size);free.write('free',4);await fs.writeFile(path,Buffer.concat([source.subarray(0,moov),free,source.subarray(moov)]));}
  }
  const bytes=await fs.readFile(path),pieces=[];for(let n=0;n<bytes.length;n+=pieceLength)pieces.push(sha(bytes.subarray(n,n+pieceLength)));
  const info={name,length:bytes.length,'piece length':pieceLength,pieces:Buffer.concat(pieces)},torrent=encode({info});
  return {name,path,kind,bytes:bytes.length,infoHash:sha(encode(info)).toString('hex'),fileIdx:0,pieceLength,torrent,syntheticPaddingBytes:kind==='late-moov'?paddingMiB*1024*1024:0};
}
function parse(argv){const options={runs:5,kinds:'mp4,late-moov,mkv',modes:'cold,warm,restart,partial,newsource,nocache',stableSeconds:2,firstMotionTimeoutMs:6000,paddingMiB:32,pieceLength:256*1024,torrentWarmup:'container',timeoutMs:45000};for(let i=0;i<argv.length;i++){assert.ok(argv[i].startsWith('--'),`Unexpected ${argv[i]}`);const key=argv[i].slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());options[key]=argv[++i];}for(const key of ['runs','stableSeconds','firstMotionTimeoutMs','paddingMiB','pieceLength','timeoutMs'])options[key]=Number(options[key]);for(const key of ['serviceModule','rqbit','mpv'])assert.ok(options[key],`--${key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())} is required`);assert.ok(options.runs>=1&&options.runs<=100);assert.ok(Number.isFinite(options.firstMotionTimeoutMs)&&options.firstMotionTimeoutMs>=1000&&options.firstMotionTimeoutMs<=15000,'Invalid first motion deadline');assert.ok(['demand','both','container'].includes(options.torrentWarmup),'--torrent-warmup must be demand, both or container');assert.ok(Number.isSafeInteger(options.pieceLength)&&options.pieceLength>=16384&&options.pieceLength<=16*1024*1024&&(options.pieceLength&(options.pieceLength-1))===0,'--piece-length must be a power of two from 16 KiB to 16 MiB');return options;}

export async function main(argv=process.argv.slice(2)){
  const options=parse(argv),root=resolve(options.output??await fs.mkdtemp(join(tmpdir(),'vantara-torrent-benchmark-')));await fs.mkdir(root,{recursive:true});
  const torrentBackend=options.torrentBackend??'rqbit';
  assert.ok(['rqbit','libtorrent'].includes(torrentBackend),'Unsupported benchmark backend');
  if(torrentBackend==='libtorrent')assert.ok(options.libtorrentPython&&options.libtorrentScript,'Explicit native runtime and script required');
  const seedEngine=options.seedEngine??'rqbit';assert.ok(['rqbit','libtorrent'].includes(seedEngine),'Unsupported seeder');
  if(seedEngine==='libtorrent')assert.ok(options.libtorrentPython,'Explicit native runtime required for seeder');
  assert.ok(['both','utp','utp-closed-tcp'].includes(options.seedTransport??'both'),'Unsupported fixture seed transport');
  assert.ok(['both','utp'].includes(options.nativeTransport??'both'),'Unsupported fixture native transport');
  assert.ok(['tcp','utp','both'].includes(options.rqbitTransport??'tcp'),'Unsupported fixture rqbit transport');
  if(options.seedTransport?.startsWith('utp'))assert.equal(seedEngine,'libtorrent','uTP-only fixture requires libtorrent seeder');
  assert.ok(['optional','mse'].includes(options.seedEncryption??'optional'),'Unsupported fixture encryption');
  if(options.seedEncryption==='mse')assert.equal(seedEngine,'libtorrent','MSE fixture requires libtorrent seeder');
  const rqbit=resolve(options.rqbit),mpv=resolve(options.mpv),ffmpeg=options.ffmpeg??'ffmpeg',serviceModule=resolve(options.serviceModule),children=[],proxies=[],udpRelays=[],results=[];
  const nativeEnv={...process.env,...(options.libraryPath?{LD_LIBRARY_PATH:options.libraryPath}:{})};let display;
  const track=(child,role)=>{children.push({child,role});return child;};
  let active=null;
  const report={schemaVersion:1,serviceHostPid:process.pid,validation:options.engineOnly==='true'?'verified bytes only; IPC stand-in is NOT MPV/video evidence':'real MPV playback',torrentBackend,startedAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,serviceModule,serviceSha256:sha(await fs.readFile(serviceModule),'sha256').toString('hex'),rqbitSha256:sha(await fs.readFile(rqbit),'sha256').toString('hex'),mpvSha256:options.engineOnly==='true'?null:sha(await fs.readFile(mpv),'sha256').toString('hex'),options:{...options,output:root},evidence:options.engineOnly==='true'?'SHA256 and exact Range bytes through production desktop proxy; no decoder':'Actual lossless mpv screenshot-to-file window (PNG compression 0); Linux virtual X display is not a physical Windows display',network:'Owned loopback peer only; DHT/trackers/LSD/UPnP disabled in benchmark adapter',runs:results};
  try{
    const snapshot=await snapshotModule(serviceModule,join(root,'module-snapshot'));report.sourceModules=snapshot.modules;
    if(options.engineOnly!=='true'&&process.platform==='linux'&&!nativeEnv.DISPLAY){assert.ok(options.xvfb,'--xvfb required when DISPLAY is absent');const n=100+Math.floor(Math.random()*500);display=track(nativeSpawn(options.xvfb,[`:${n}`,'-screen','0','1024x768x24','-nolisten','tcp'],{env:nativeEnv,stdio:'ignore'}),'xvfb');nativeEnv.DISPLAY=`:${n}`;await until(()=>fs.stat(`/tmp/.X11-unix/X${n}`));}
    const seedFolder=join(root,'seed');await fs.mkdir(seedFolder,{recursive:true});const fixtures=[];for(const kind of options.kinds.split(','))fixtures.push(await fixture(seedFolder,kind,options.paddingMiB,ffmpeg,options.fixturesFrom,options.pieceLength,options.fixtureAudio==='true'));
    if(options.probeLocal==='true')report.localPlayerProbe=await localPlayerProbe(mpv,fixtures[0].path,root,nativeEnv);
    report.fixtures=fixtures.map(({torrent,path,...f})=>f);
    const newSources=[];for(const f of fixtures){const bytes=await fs.readFile(f.path),name='newsource-'+f.name,pieces=[];for(let i=0;i<bytes.length;i+=f.pieceLength)pieces.push(sha(bytes.subarray(i,i+f.pieceLength)));const info={name,length:bytes.length,'piece length':f.pieceLength,pieces:Buffer.concat(pieces)};await fs.copyFile(f.path,join(seedFolder,name));newSources.push({...f,name,infoHash:sha(encode(info)).toString('hex'),torrent:encode({info})});}
    const seedPort=await port(),seedApi=`http://127.0.0.1:${seedPort}`,seedAuth=`fixture:${randomBytes(16).toString('hex')}`,headers={Authorization:`Basic ${Buffer.from(seedAuth).toString('base64')}`};let peer=await port();
    if(seedEngine==='libtorrent'){
      const manifest=[];for(const f of [...fixtures,...newSources]){const file=join(root,`${f.infoHash}.torrent`);await fs.writeFile(file,f.torrent);manifest.push(file);}
      const manifestPath=join(root,'seed-manifest.json'),ready=join(root,'seed-ready');await fs.writeFile(manifestPath,JSON.stringify(manifest));
      track(nativeSpawn(resolve(options.libtorrentPython),['-I',fileURLToPath(new URL('./libtorrent-fixture-seeder.py',import.meta.url)),'--seed-dir',seedFolder,'--manifest',manifestPath,'--ready',ready,'--listen-port',String(peer),'--transport',options.seedTransport?.startsWith('utp')?'utp':'both','--encryption',options.seedEncryption??'optional'],{env:nativeEnv,stdio:'ignore'}),'seed');
      await until(()=>fs.stat(ready));
      report.seedSettings=JSON.parse(await fs.readFile(ready,'utf8'));
    }else{
      track(nativeSpawn(rqbit,['-v','error','--http-api-listen-addr',`127.0.0.1:${seedPort}`,'--listen-ip','127.0.0.1','--listen-port',String(peer),'--disable-dht','--disable-trackers','--disable-lsd','--disable-upnp-port-forward',...(options.seedUploadBps?['--ratelimit-upload',String(options.seedUploadBps)]:[]),'server','start',seedFolder,'--disable-persistence'],{env:{...nativeEnv,RQBIT_HTTP_BASIC_AUTH_USERPASS:seedAuth},stdio:'ignore'}),'seed');
      await until(()=>json(seedApi,'/',{headers}));for(const f of [...fixtures,...newSources]){const added=await json(seedApi,'/torrents?is_url=false&overwrite=true',{method:'POST',headers,body:f.torrent});await until(async()=>{const s=await json(seedApi,`/torrents/${added.id}/stats/v1`,{headers});return s.finished;});}
    }
    if(options.seedTransport==='utp-closed-tcp'){
      const relay=await createUtpFixtureRelay(peer);udpRelays.push(relay);peer=relay.port;report.transportProof=relay.proof;
    }
    cp.spawn=(binary,args,spawnOptions)=>{
      if(torrentBackend==='libtorrent'&&resolve(String(binary))===resolve(options.libtorrentPython)&&active){
        // The shipped CLI always blocks private peers. Only this excluded test
        // adapter admits the authored loopback seeder, just like rqbit below.
        const scriptIndex=args.indexOf(resolve(options.libtorrentScript));
        assert.ok(scriptIndex>=0,'Expected isolated native backend script');
        const rewritten=[...args];rewritten[scriptIndex]=fileURLToPath(new URL('./libtorrent-fixture-server.py',import.meta.url));
        rewritten.push('--backend-script',resolve(options.libtorrentScript),'--fixture-peer',String(peer),'--transport',options.nativeTransport??'both','--peer-kind',seedEngine);
        return track(nativeSpawn(binary,rewritten,{...spawnOptions,env:{...spawnOptions.env,...(options.libraryPath?{LD_LIBRARY_PATH:options.libraryPath}:{})}}),'libtorrent');
      }
      if(resolve(String(binary))===rqbit&&active){
        const run=active,index=args.indexOf('--http-api-listen-addr'),external=Number(args[index+1].split(':').at(-1)),backend=run.backend;
        const rewritten=[...args];rewritten[index+1]=`127.0.0.1:${backend}`;rewritten.unshift('--disable-dht','--disable-trackers','--disable-upnp-port-forward');
        if(['utp','both'].includes(options.rqbitTransport))rewritten.unshift('--experimental-enable-utp-listen',...(options.rqbitTransport==='utp'?['--disable-tcp-connect','--disable-tcp-listen']:[]));
        const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://owned');if(req.method==='POST'&&url.pathname==='/torrents')url.searchParams.set('initial_peers',`127.0.0.1:${peer}`);const row={atMs:performance.now()-run.startedAt,method:req.method,path:url.pathname,query:url.search,range:req.headers.range??null};run.http.push(row);
          const forward=http.request({hostname:'127.0.0.1',port:backend,path:url.pathname+url.search,method:req.method,headers:req.headers},back=>{row.headersMs=performance.now()-run.startedAt;row.status=back.statusCode;res.writeHead(back.statusCode,back.headers);res.flushHeaders();const haves=[];back.on('data',b=>{row.bodyBytes=(row.bodyBytes??0)+b.length;if(url.pathname.endsWith('/haves'))haves.push(b);});back.once('end',()=>{row.completedMs=performance.now()-run.startedAt;if(haves.length){const bits=Buffer.concat(haves);row.havePieces=[];for(let i=0;i<bits.length*8;i++)if(bits[i>>3]&(128>>(i&7)))row.havePieces.push(i);}});back.once('data',()=>{row.firstBodyMs=performance.now()-run.startedAt;});back.pipe(res);});forward.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});res.on('close',()=>forward.destroy());req.pipe(forward);});server.listen(external,'127.0.0.1');proxies.push(server);run.proxy=server;
        return track(nativeSpawn(binary,rewritten,{...spawnOptions,env:{...spawnOptions.env,...(options.libraryPath?{LD_LIBRARY_PATH:options.libraryPath}:{}),...{}}}),'rqbit');
      }
      if(resolve(String(binary))===mpv&&active&&options.engineOnly==='true'){
        const run=active,child=track(nativeSpawn(process.execPath,[fileURLToPath(new URL('./torrent-byte-consumer.mjs',import.meta.url)),...args],{env:nativeEnv,stdio:['ignore','pipe','pipe']}),'byte-consumer');
        let buffer='';child.stdout.on('data',b=>{buffer+=b;while(buffer.includes('\n')){const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const m=JSON.parse(line);if(m.byteStreamURL)run.byteStreamURL=m.byteStreamURL;}catch{}}});return child;
      }
      if(resolve(String(binary))===mpv&&active){const run=active;const log=createWriteStream(join(run.directory,'mpv.log'));active.mpvIpc=args.find(a=>a.startsWith('--input-ipc-server=')).slice(19);const child=track(nativeSpawn(binary,[...args,`--log-file=${join(run.directory,'mpv-native.log')}`,'--msg-level=all=info',...(options.verifyAudio==='true'?['--ao=null']:[])],{...spawnOptions,env:{...spawnOptions.env,...nativeEnv},stdio:['ignore','ignore','pipe']}),'mpv');child.stderr.pipe(log);run.mpvPid=child.pid;child.once('exit',(code,signal)=>{run.mpvExit={code,signal};});child.once('error',error=>{run.mpvError={code:error.code,message:error.message.slice(0,300)};});return child;}
      return nativeSpawn(binary,args,spawnOptions);
    };syncBuiltinESMExports();
    const {createDesktopServices}=await import(pathToFileURL(snapshot.entry));
    const modes=options.modes.split(',');
    for(const f of fixtures)for(let trial=0;trial<options.runs;trial++){
      const userData=join(root,`profile-${f.kind}-${trial}`);await fs.mkdir(userData,{recursive:true});let services;
      const create=mode=>createDesktopServices({userData,torrentBackend,binaries:{rqbit,mpv,...(torrentBackend==='libtorrent'?{libtorrentPython:resolve(options.libtorrentPython),libtorrentScript:resolve(options.libtorrentScript)}:{})},dnsOverHttps:false,torrentWarmup:options.torrentWarmup,...(options.disableReplay==='true'||mode==='nocache'?{replayCache:false}:{}),onEvent:event=>{if(active)active.events.push({...event,atMs:performance.now()-active.startedAt});}});
      for(const mode of modes){
        const source=mode==='newsource'?newSources.find(n=>n.kind===f.kind):f;
        if(!services||['restart','partial','corrupt','newsource','nocache'].includes(mode)){await services?.close();services=null;}
        const cacheBefore=await replayState(userData,source,mode==='partial',mode==='corrupt');if(!services)services=create(mode);
        const directory=join(root,`${f.kind}-${trial}-${mode}`);await fs.mkdir(directory,{recursive:true});const session=`bench-${f.kind}-${trial}-${mode}`,run={fixture:f.kind,trial,mode,infoHash:source.infoHash,fileIdx:source.fileIdx,logicalFileBytes:source.bytes,cacheBefore,directory,startedAt:performance.now(),events:[],http:[],backend:await port(),ok:false};active=run;results.push(run);let connection;
        console.log(JSON.stringify({event:'run-start',fixture:f.kind,trial,mode,infoHash:source.infoHash}));
        try{
          const start=services.startPlayback({session,candidate:{infoHash:source.infoHash,fileIdx:0},title:'VANTARA authored benchmark'});start.catch(error=>{run.startPlaybackError=String(error?.message??error).slice(0,500);});
          if(options.engineOnly==='true'){
            await until(()=>run.byteStreamURL,options.timeoutMs);await start;
            const bytes=await fs.readFile(source.path);run.byteProof=[];
            const read=async(begin,end,label)=>{const at=performance.now();const r=await fetch(run.byteStreamURL,{headers:{Range:`bytes=${begin}-${end}`},signal:AbortSignal.timeout(options.timeoutMs)});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes ${begin}-${end}/${bytes.length}`);const payload=Buffer.from(await r.arrayBuffer());verifyByteRange(bytes,begin,end,payload);const elapsedMs=performance.now()-at;run.byteProof.push({label,start:begin,end,bytes:payload.length,elapsedMs,sha256:sha(payload,'sha256').toString('hex')});return {payload,elapsedMs};};
            await read(0,Math.min(bytes.length-1,262143),'first useful verified range');run.firstByteMs=performance.now()-run.startedAt;
            await read(Math.floor(bytes.length*.8),Math.min(bytes.length-1,Math.floor(bytes.length*.8)+262143),'seek forward');
            await read(131072,Math.min(bytes.length-1,393215),'seek backward / sparse boundary');
            const flow=await read(0,bytes.length-1,'sequential complete SHA256');
            run.throughput={bytes:bytes.length,seconds:flow.elapsedMs/1000,bitsPerSecond:bytes.length*8000/flow.elapsedMs,requiredBitsPerSecond:Number(options.requiredBitrate??0)};
            assert.ok(run.throughput.bitsPerSecond>=run.throughput.requiredBitsPerSecond,'Verified byte flow is below required 4K bitrate');
            run.resources=await processMetrics(children.filter(({role,child})=>['rqbit','libtorrent'].includes(role)&&child.exitCode===null));run.ok=true;continue;
          }
          await until(()=>run.mpvIpc,options.timeoutMs);connection=await ipc(run.mpvIpc);
          // Preserve lossless pixels without blocking playback on 4K PNG compression.
          await connection.send(['set_property','screenshot-png-compression',0]);
          const screenshot=join(directory,'first-rendered.png');
          const proof=await until(async()=>{const params=await connection.send(['get_property','video-out-params']);if(!(params?.w>0&&params?.h>0))return;await connection.send(['screenshot-to-file',screenshot,'window']);const atMs=performance.now()-run.startedAt;const rgb=await command(ffmpeg,['-v','error','-i',screenshot,'-vf','scale=64:36','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);const pixels=framePixels(rgb);return pixels.nonblack?{atMs,pixels,params}:null;},options.timeoutMs);
          run.firstRenderedMs=proof.atMs;run.renderedProof={...proof,decodedParams:await connection.send(['get_property','video-params']),screenshot,sha256:sha(await fs.readFile(screenshot),'sha256').toString('hex')};await start;
          if(options.verifyAudio==='true'){
            run.audioEvidence=await until(async()=>{const params=await connection.send(['get_property','audio-params']).catch(()=>null);return params?.samplerate>0?{params,sink:'null (decoded PCM; physical speaker output not measured)'}:null;},5000);
          }
          // mpv may decode a frame while still paused for cache; don't sample
          // playback rate inside that initial buffer wait. Never waive the rate
          // threshold: require actual forward motion within a separate,
          // bounded startup limit or fail the case.
          const proofStart=performance.now();
          const startedMotion=await until(async()=>{
            const [position,paused,buffering]=await Promise.all([
              connection.send(['get_property','time-pos']),
              connection.send(['get_property','pause']),
              connection.send(['get_property','paused-for-cache'])
            ]);
            if(!playbackHasActuallyStarted({position,paused,buffering}))return null;
            return {position,paused,buffering};
          },options.firstMotionTimeoutMs);
          run.firstMovingFrameMs=performance.now()-run.startedAt;
          run.firstMotionWaitMs=performance.now()-proofStart;
          const before=startedMotion.position;
          const stableStarted=performance.now(),samples=[];
          const sample=async()=>{const p=await playerStatus(connection);return {atSeconds:(performance.now()-stableStarted)/1000,position:p['time-pos'],buffering:p['paused-for-cache'],paused:p.pause,droppedFrames:p['frame-drop-count'],delayedFrames:p['vo-delayed-frame-count'],decoderDroppedFrames:p['decoder-frame-drop-count']};};
          samples.push(await sample());
          while((performance.now()-stableStarted)/1000<samples[0].atSeconds+options.stableSeconds){await sleep(250);samples.push(await sample());}
          const assessment=assessRealtimePlayback(samples,{seconds:options.stableSeconds,fps:await connection.send(['get_property','container-fps'])});
          run.stablePlayback={fromSeconds:samples[0].position,toSeconds:samples.at(-1).position,...assessment,samples};run.realtimePlaybackVerified=assessment.passed;
          run.validationScope='real rendered frame, absolute wall-clock playback, frame loss, buffering and seeks';
          assert.ok(assessment.passed,`Playback did not sustain real time: ${JSON.stringify(assessment)}`);
          run.seeks=[];for(const target of [12,2]){const at=performance.now();await services.playbackCommand({session,command:'seek',value:target*1000});await until(async()=>Math.abs((await connection.send(['get_property','time-pos']))-target)<1.5,10000);const settledMs=performance.now()-at;await until(async()=>{const p=await playerStatus(connection);return p['time-pos']>=target+.25&&p['paused-for-cache']===false&&p.pause===false;},6000);run.seeks.push({targetSeconds:target,settledMs,motionVerifiedMs:performance.now()-at});}
          run.resources=await processMetrics(children.filter(({role,child})=>['mpv','rqbit','libtorrent'].includes(role)&&child.exitCode===null));run.storageDuring=await diskBytes(userData);run.ok=true;
        }catch(error){run.error=String(error.stack??error);if(connection)run.playerStatus=await playerStatus(connection).catch(()=>null);try{run.mpvLogTail=(await fs.readFile(join(directory,'mpv-native.log'),'utf8')).slice(-6000);}catch{}process.exitCode=1;}
        finally{connection?.close();await services.stopPlayback({session}).catch(()=>{});if(run.proxy){run.proxy.closeAllConnections();await new Promise(r=>run.proxy.close(r));delete run.proxy;}run.storageAfter=await diskBytes(userData);run.elapsedMs=performance.now()-run.startedAt;delete run.startedAt;delete run.mpvIpc;delete run.backend;delete run.byteStreamURL;await fs.writeFile(join(directory,'run.json'),JSON.stringify(run,null,2));await fs.writeFile(join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({event:'run-end',fixture:f.kind,trial,mode,ok:run.ok,firstRenderedMs:run.firstRenderedMs,error:run.error?.split('\n')[0],mpvExit:run.mpvExit,mpvError:run.mpvError,mpvLogTail:run.ok?undefined:run.mpvLogTail,startPlaybackError:run.startPlaybackError,
          // Bound diagnostics to non-identifying player status + verified-piece counters.
          // This distinguishes slow decoding from torrent starvation without recording URLs, accounts or peers' IPs.
          playerEvidence:run.ok?undefined:run.playerStatus&&Object.fromEntries(['time-pos','pause','paused-for-cache','hwdec-current','current-vo','decoder-frame-drop-count','frame-drop-count','demuxer-cache-state'].map(k=>[k,run.playerStatus[k]])),
          pieceEvidence:run.ok?undefined:run.events.filter(e=>e.type==='playback/diagnostic'&&e.stage==='torrent-sample').slice(-3).map(e=>({elapsedMs:e.elapsedMs,speedBytes:e.speedBytes,checkedPieces:e.checkedPieces,requestedPiece:e.requestedPiece,cacheBytesRead:e.cacheBytesRead})),eventsTail:run.ok?undefined:run.events.slice(-12).map(({type,stage,message,atMs})=>({type,stage,message,atMs}))}));}
      }
      await services?.close();active=null;
    }
    report.summaries=[];for(const f of fixtures)for(const mode of modes)report.summaries.push({fixture:f.kind,mode,...summarize(results.filter(r=>r.fixture===f.kind&&r.mode===mode).map(r=>options.engineOnly==='true'?{...r,firstRenderedMs:r.firstByteMs}:r))});
  }finally{cp.spawn=nativeSpawn;syncBuiltinESMExports();for(const server of proxies){server.closeAllConnections();server.close();}await Promise.all(children.map(({child})=>terminate(child)));await Promise.all(udpRelays.map(relay=>relay.close()));report.finishedAt=new Date().toISOString();await fs.writeFile(join(root,'results.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({event:'complete',results:join(root,'results.json'),summaries:report.summaries}));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error);process.exitCode=1;});
