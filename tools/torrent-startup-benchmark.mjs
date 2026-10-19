// Owned local swarm + actual mpv rendered-window evidence. Never imported by the app.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

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
async function until(fn,timeout=30000){const deadline=performance.now()+timeout;let last;while(performance.now()<deadline){try{const value=await fn();if(value)return value;}catch(e){last=e;}await sleep(25);}throw last??new Error('Benchmark deadline exceeded');}
async function port(){const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function terminate(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;await new Promise(r=>{const timer=setTimeout(()=>child.kill('SIGKILL'),1500);child.once('exit',()=>{clearTimeout(timer);r();});child.kill();});}
async function command(binary,args,{env=process.env,maxBytes=20*1024*1024}={}){
  return new Promise((resolveCommand,reject)=>{const child=nativeSpawn(binary,args,{env,stdio:['ignore','pipe','pipe'],windowsHide:true});const out=[],err=[];let size=0;
    child.stdout.on('data',b=>{size+=b.length;if(size>maxBytes){child.kill();reject(new Error('Command output limit'));}out.push(b);});child.stderr.on('data',b=>err.push(b));child.once('error',reject);child.once('exit',code=>code===0?resolveCommand(Buffer.concat(out)):reject(new Error(`${basename(binary)} exited ${code}: ${Buffer.concat(err).toString().slice(-2000)}`)));});
}
async function json(api,path,options={}){const response=await fetch(api+path,{...options,signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`HTTP ${response.status}: ${await response.text()}`);return response.json();}
async function ipc(path){
  const socket=await until(()=>new Promise((r,j)=>{const s=net.createConnection(path);s.once('connect',()=>r(s));s.once('error',j);}));let id=0,buffer='';const pending=new Map();
  socket.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const n=buffer.indexOf('\n'),line=buffer.slice(0,n);buffer=buffer.slice(n+1);let m;try{m=JSON.parse(line);}catch{continue;}const p=pending.get(m.request_id);if(p){pending.delete(m.request_id);clearTimeout(p.timer);m.error==='success'?p.resolve(m.data):p.reject(new Error(m.error));}}});
  return {socket,send:command=>new Promise((resolveIPC,reject)=>{const request_id=++id,timer=setTimeout(()=>{pending.delete(request_id);reject(new Error('mpv IPC deadline'));},3000);pending.set(request_id,{resolve:resolveIPC,reject,timer});socket.write(JSON.stringify({command,request_id})+'\n');}),close(){socket.destroy();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('IPC closed'));}pending.clear();}};
}
async function diskBytes(directory){let logical=0,allocated=0,files=0;try{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory()){const c=await diskBytes(path);logical+=c.logicalBytes;allocated+=c.allocatedBytes??0;files+=c.files;}else if(entry.isFile()){const s=await fs.stat(path);logical+=s.size;allocated+=(s.blocks??0)*512;files++;}}}catch{}return {logicalBytes:logical,allocatedBytes:process.platform==='win32'?null:allocated,files};}
async function snapshotModule(entry,directory){
  const base=dirname(entry),modules=[];const visited=new Set();
  async function copy(file){if(visited.has(file))return;visited.add(file);const rel=relative(base,file);assert.ok(!rel.startsWith('..'),'Runtime import outside source folder');const data=await fs.readFile(file),target=join(directory,rel);await fs.mkdir(dirname(target),{recursive:true});await fs.writeFile(target,data);modules.push({path:rel,sha256:sha(data,'sha256').toString('hex')});for(const m of data.toString().matchAll(/from\s+['"](\.[^'"]+)['"]/g))await copy(resolve(dirname(file),m[1]));}
  await copy(entry);return {entry:join(directory,basename(entry)),modules};
}
async function replayState(userData,fixture,trim=false){
  const states=[];for(const file of await fs.readdir(userData)){if(!/^torrent-replay-root-v1-[a-f0-9]+\.json$/.test(file))continue;const pointer=JSON.parse(await fs.readFile(join(userData,file),'utf8')),prefix=`.vantara-torrent-cache-${sha(userData,'sha256').toString('hex').slice(0,20)}-replay-v1-`;assert.ok(pointer.namespace.startsWith(prefix)&&basename(pointer.namespace)===pointer.namespace,'Unexpected benchmark replay namespace');const directory=join(pointer.root,pointer.namespace),index=JSON.parse(await fs.readFile(join(directory,'index.json'),'utf8'));
    for(const entry of index.entries){if(entry.descriptor.infoHash!==fixture.infoHash||entry.descriptor.fileIdx!==0)continue;
      if(trim){const head=entry.extents.find(e=>e.start===0);if(head){assert.match(head.file,/^extent-[a-f0-9-]{36}\.bin$/);const bytes=await fs.readFile(join(directory,head.file));assert.equal(sha(bytes,'sha256').toString('hex'),head.sha256);const retained=bytes.subarray(0,Math.min(bytes.length,256*1024));await fs.writeFile(join(directory,head.file),retained);for(const old of entry.extents)if(old!==head){assert.match(old.file,/^extent-[a-f0-9-]{36}\.bin$/);await fs.unlink(join(directory,old.file)).catch(()=>{});}head.length=retained.length;head.sha256=sha(retained,'sha256').toString('hex');entry.extents=[head];await fs.writeFile(join(directory,'index.json'),JSON.stringify(index));}}
      states.push({directory,fileLength:entry.descriptor.fileLength,cachedBytes:entry.extents.reduce((sum,e)=>sum+e.length,0),ranges:entry.extents.map(e=>({start:e.start,length:e.length}))});
    }
  }return {entries:states,partialFixtureTrimmed:trim,available:states.length>0};
}
async function processMetrics(children){
  if(process.platform!=='linux')return {available:false,reason:'Process CPU/RSS collection implemented for Linux only'};
  const rows=[];for(const {child,role} of children){try{const text=await fs.readFile(`/proc/${child.pid}/stat`,'utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' '),status=await fs.readFile(`/proc/${child.pid}/status`,'utf8');rows.push({role,pid:child.pid,cpuTicks:Number(fields[11])+Number(fields[12]),rssBytes:Number(/VmRSS:\s+(\d+)/.exec(status)?.[1]??0)*1024});}catch{}}
  return {available:true,cpuTickUnit:'OS scheduler ticks; not converted to seconds',processes:rows};
}
async function fixture(folder,kind,paddingMiB,ffmpeg,fixturesFrom){
  const name=`authored-${kind}.${kind==='mkv'?'mkv':'mp4'}`,path=join(folder,name);
  if(fixturesFrom)await fs.copyFile(join(resolve(fixturesFrom),name),path);
  else {
    await command(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-t','24','-c:v','mpeg4','-q:v','3',...(kind==='mp4'?['-movflags','+faststart']:[]),path]);
    if(kind==='late-moov'&&paddingMiB){const source=await fs.readFile(path);let offset=0,moov=-1;while(offset+8<=source.length){const size=source.readUInt32BE(offset),type=source.toString('ascii',offset+4,offset+8);if(type==='moov'){moov=offset;break;}if(size<8)break;offset+=size;}assert.ok(moov>0,'Expected trailing moov');const size=paddingMiB*1024*1024,free=Buffer.alloc(size);free.writeUInt32BE(size);free.write('free',4);await fs.writeFile(path,Buffer.concat([source.subarray(0,moov),free,source.subarray(moov)]));}
  }
  const bytes=await fs.readFile(path),pieceLength=256*1024,pieces=[];for(let n=0;n<bytes.length;n+=pieceLength)pieces.push(sha(bytes.subarray(n,n+pieceLength)));
  const info={name,length:bytes.length,'piece length':pieceLength,pieces:Buffer.concat(pieces)},torrent=encode({info});
  return {name,path,kind,bytes:bytes.length,infoHash:sha(encode(info)).toString('hex'),fileIdx:0,pieceLength,torrent,syntheticPaddingBytes:kind==='late-moov'?paddingMiB*1024*1024:0};
}
function parse(argv){const options={runs:5,kinds:'mp4,late-moov,mkv',modes:'cold,warm,restart,partial,newsource,nocache',stableSeconds:2,paddingMiB:32,timeoutMs:45000};for(let i=0;i<argv.length;i++){assert.ok(argv[i].startsWith('--'),`Unexpected ${argv[i]}`);const key=argv[i].slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());options[key]=argv[++i];}for(const key of ['runs','stableSeconds','paddingMiB','timeoutMs'])options[key]=Number(options[key]);for(const key of ['serviceModule','rqbit','mpv'])assert.ok(options[key],`--${key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())} is required`);assert.ok(options.runs>=1&&options.runs<=100);return options;}

export async function main(argv=process.argv.slice(2)){
  const options=parse(argv),root=resolve(options.output??await fs.mkdtemp(join(tmpdir(),'vantara-torrent-benchmark-')));await fs.mkdir(root,{recursive:true});
  const rqbit=resolve(options.rqbit),mpv=resolve(options.mpv),ffmpeg=options.ffmpeg??'ffmpeg',serviceModule=resolve(options.serviceModule),children=[],proxies=[],results=[];
  const nativeEnv={...process.env,...(options.libraryPath?{LD_LIBRARY_PATH:options.libraryPath}:{})};let display;
  const track=(child,role)=>{children.push({child,role});return child;};
  let active=null;
  const report={schemaVersion:1,startedAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,serviceModule,serviceSha256:sha(await fs.readFile(serviceModule),'sha256').toString('hex'),rqbitSha256:sha(await fs.readFile(rqbit),'sha256').toString('hex'),mpvSha256:sha(await fs.readFile(mpv),'sha256').toString('hex'),options:{...options,output:root},evidence:'Actual mpv screenshot-to-file window; Linux virtual X display is not a physical Windows display',network:'Owned loopback peer only; DHT/trackers/LSD/UPnP disabled in benchmark adapter',runs:results};
  try{
    const snapshot=await snapshotModule(serviceModule,join(root,'module-snapshot'));report.sourceModules=snapshot.modules;
    if(process.platform==='linux'&&!nativeEnv.DISPLAY){assert.ok(options.xvfb,'--xvfb required when DISPLAY is absent');const n=100+Math.floor(Math.random()*500);display=track(nativeSpawn(options.xvfb,[`:${n}`,'-screen','0','1024x768x24','-nolisten','tcp'],{env:nativeEnv,stdio:'ignore'}),'xvfb');nativeEnv.DISPLAY=`:${n}`;await until(()=>fs.stat(`/tmp/.X11-unix/X${n}`));}
    const seedFolder=join(root,'seed');await fs.mkdir(seedFolder,{recursive:true});const fixtures=[];for(const kind of options.kinds.split(','))fixtures.push(await fixture(seedFolder,kind,options.paddingMiB,ffmpeg,options.fixturesFrom));
    report.fixtures=fixtures.map(({torrent,path,...f})=>f);
    const newSources=[];for(const f of fixtures){const bytes=await fs.readFile(f.path),name='newsource-'+f.name,pieces=[];for(let i=0;i<bytes.length;i+=f.pieceLength)pieces.push(sha(bytes.subarray(i,i+f.pieceLength)));const info={name,length:bytes.length,'piece length':f.pieceLength,pieces:Buffer.concat(pieces)};await fs.copyFile(f.path,join(seedFolder,name));newSources.push({...f,name,infoHash:sha(encode(info)).toString('hex'),torrent:encode({info})});}
    const seedPort=await port(),peer=await port(),seedApi=`http://127.0.0.1:${seedPort}`,seedAuth=`fixture:${randomBytes(16).toString('hex')}`,headers={Authorization:`Basic ${Buffer.from(seedAuth).toString('base64')}`};
    const seed=track(nativeSpawn(rqbit,['-v','error','--http-api-listen-addr',`127.0.0.1:${seedPort}`,'--listen-ip','127.0.0.1','--listen-port',String(peer),'--disable-dht','--disable-trackers','--disable-lsd','--disable-upnp-port-forward',...(options.seedUploadBps?['--ratelimit-upload',String(options.seedUploadBps)]:[]),'server','start',seedFolder,'--disable-persistence'],{env:{...nativeEnv,RQBIT_HTTP_BASIC_AUTH_USERPASS:seedAuth},stdio:'ignore'}),'seed');
    await until(()=>json(seedApi,'/',{headers}));for(const f of [...fixtures,...newSources]){const added=await json(seedApi,'/torrents?is_url=false&overwrite=true',{method:'POST',headers,body:f.torrent});await until(async()=>{const s=await json(seedApi,`/torrents/${added.id}/stats/v1`,{headers});return s.finished;});}
    cp.spawn=(binary,args,spawnOptions)=>{
      if(resolve(String(binary))===rqbit&&active){
        const run=active,index=args.indexOf('--http-api-listen-addr'),external=Number(args[index+1].split(':').at(-1)),backend=run.backend;
        const rewritten=[...args];rewritten[index+1]=`127.0.0.1:${backend}`;rewritten.unshift('--disable-dht','--disable-trackers','--disable-upnp-port-forward');
        const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://owned');if(req.method==='POST'&&url.pathname==='/torrents')url.searchParams.set('initial_peers',`127.0.0.1:${peer}`);const row={atMs:performance.now()-run.startedAt,method:req.method,path:url.pathname,query:url.search,range:req.headers.range??null};run.http.push(row);
          const forward=http.request({hostname:'127.0.0.1',port:backend,path:url.pathname+url.search,method:req.method,headers:req.headers},back=>{row.headersMs=performance.now()-run.startedAt;row.status=back.statusCode;res.writeHead(back.statusCode,back.headers);back.once('data',()=>{row.firstBodyMs=performance.now()-run.startedAt;});back.pipe(res);});forward.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});res.on('close',()=>forward.destroy());req.pipe(forward);});server.listen(external,'127.0.0.1');proxies.push(server);run.proxy=server;
        return track(nativeSpawn(binary,rewritten,{...spawnOptions,env:{...spawnOptions.env,...(options.libraryPath?{LD_LIBRARY_PATH:options.libraryPath}:{}),...{}}}),'rqbit');
      }
      if(resolve(String(binary))===mpv&&active){const log=createWriteStream(join(active.directory,'mpv.log'));active.mpvIpc=args.find(a=>a.startsWith('--input-ipc-server=')).slice(19);const child=track(nativeSpawn(binary,args,{...spawnOptions,env:{...spawnOptions.env,...nativeEnv},stdio:['ignore','ignore','pipe']}),'mpv');child.stderr.pipe(log);run.mpvPid=child.pid;child.once('exit',(code,signal)=>{run.mpvExit={code,signal};});child.once('error',error=>{run.mpvError={code:error.code,message:error.message.slice(0,300)};});return child;}
      return nativeSpawn(binary,args,spawnOptions);
    };syncBuiltinESMExports();
    const {createDesktopServices}=await import(pathToFileURL(snapshot.entry));
    const modes=options.modes.split(',');
    for(const f of fixtures)for(let trial=0;trial<options.runs;trial++){
      const userData=join(root,`profile-${f.kind}-${trial}`);await fs.mkdir(userData,{recursive:true});let services;
      const create=mode=>createDesktopServices({userData,binaries:{rqbit,mpv},dnsOverHttps:false,...(options.disableReplay==='true'||mode==='nocache'?{replayCache:false}:{}),onEvent:event=>{if(active)active.events.push({...event,atMs:performance.now()-active.startedAt});}});
      for(const mode of modes){
        const source=mode==='newsource'?newSources.find(n=>n.kind===f.kind):f;
        if(!services||['restart','partial','newsource','nocache'].includes(mode)){await services?.close();services=null;}
        const cacheBefore=await replayState(userData,source,mode==='partial');if(!services)services=create(mode);
        const directory=join(root,`${f.kind}-${trial}-${mode}`);await fs.mkdir(directory,{recursive:true});const session=`bench-${f.kind}-${trial}-${mode}`,run={fixture:f.kind,trial,mode,infoHash:source.infoHash,fileIdx:source.fileIdx,logicalFileBytes:source.bytes,cacheBefore,directory,startedAt:performance.now(),events:[],http:[],backend:await port(),ok:false};active=run;results.push(run);let connection;
        console.log(JSON.stringify({event:'run-start',fixture:f.kind,trial,mode,infoHash:source.infoHash}));
        try{
          const start=services.startPlayback({session,candidate:{infoHash:source.infoHash,fileIdx:0},title:'VANTARA authored benchmark'});start.catch(error=>{run.startPlaybackError=String(error?.message??error).slice(0,500);});
          await until(()=>run.mpvIpc,options.timeoutMs);connection=await ipc(run.mpvIpc);
          const screenshot=join(directory,'first-rendered.png');
          const proof=await until(async()=>{const params=await connection.send(['get_property','video-out-params']);if(!(params?.w>0&&params?.h>0))return;await connection.send(['screenshot-to-file',screenshot,'window']);const atMs=performance.now()-run.startedAt;const rgb=await command(ffmpeg,['-v','error','-i',screenshot,'-vf','scale=64:36','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);const pixels=framePixels(rgb);return pixels.nonblack?{atMs,pixels,params}:null;},options.timeoutMs);
          run.firstRenderedMs=proof.atMs;run.renderedProof={...proof,screenshot,sha256:sha(await fs.readFile(screenshot),'sha256').toString('hex')};await start;
          const before=await connection.send(['get_property','time-pos']);await sleep(options.stableSeconds*1000);const after=await connection.send(['get_property','time-pos']);assert.ok(after>before+options.stableSeconds*.6,`Playback did not progress: ${before} → ${after}`);run.stablePlayback={fromSeconds:before,toSeconds:after,observedSeconds:options.stableSeconds};
          run.seeks=[];for(const target of [12,2]){const at=performance.now();await services.playbackCommand({session,command:'seek',value:target*1000});await until(async()=>Math.abs((await connection.send(['get_property','time-pos']))-target)<1.5,10000);run.seeks.push({targetSeconds:target,settledMs:performance.now()-at});}
          run.resources=await processMetrics(children.filter(({role,child})=>['mpv','rqbit'].includes(role)&&child.exitCode===null));run.storageDuring=await diskBytes(userData);run.ok=true;
        }catch(error){run.error=String(error.stack??error);try{run.mpvLogTail=(await fs.readFile(join(directory,'mpv.log'),'utf8')).slice(-2400);}catch{}process.exitCode=1;}
        finally{connection?.close();await services.stopPlayback({session}).catch(()=>{});if(run.proxy){run.proxy.closeAllConnections();await new Promise(r=>run.proxy.close(r));delete run.proxy;}run.storageAfter=await diskBytes(userData);run.elapsedMs=performance.now()-run.startedAt;delete run.startedAt;delete run.mpvIpc;delete run.backend;await fs.writeFile(join(directory,'run.json'),JSON.stringify(run,null,2));await fs.writeFile(join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({event:'run-end',fixture:f.kind,trial,mode,ok:run.ok,firstRenderedMs:run.firstRenderedMs,error:run.error?.split('\n')[0],mpvExit:run.mpvExit,mpvError:run.mpvError,mpvLogTail:run.ok?undefined:run.mpvLogTail,startPlaybackError:run.startPlaybackError,eventsTail:run.ok?undefined:run.events.slice(-12).map(({type,stage,message,atMs})=>({type,stage,message,atMs}))}));}
      }
      await services?.close();active=null;
    }
    report.summaries=[];for(const f of fixtures)for(const mode of modes)report.summaries.push({fixture:f.kind,mode,...summarize(results.filter(r=>r.fixture===f.kind&&r.mode===mode))});
  }finally{cp.spawn=nativeSpawn;syncBuiltinESMExports();for(const server of proxies){server.closeAllConnections();server.close();}await Promise.all(children.map(({child})=>terminate(child)));report.finishedAt=new Date().toISOString();await fs.writeFile(join(root,'results.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify({event:'complete',results:join(root,'results.json'),summaries:report.summaries}));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error);process.exitCode=1;});
