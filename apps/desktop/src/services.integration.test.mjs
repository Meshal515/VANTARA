import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash,randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from './services.mjs';

const binary=process.env.VANTARA_RQBIT_LINUX;
const sha = b => createHash('sha1').update(b).digest();
function encode(v) {
  if(Buffer.isBuffer(v))return Buffer.concat([Buffer.from(`${v.length}:`),v]);
  if(typeof v==='string')return encode(Buffer.from(v));
  if(typeof v==='number')return Buffer.from(`i${v}e`);
  if(Array.isArray(v))return Buffer.concat([Buffer.from('l'),...v.map(encode),Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d'),...Object.keys(v).sort().flatMap(k=>[encode(k),encode(v[k])]),Buffer.from('e')]);
}
async function availablePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function until(fn,timeout=15000){const deadline=Date.now()+timeout;let error;while(Date.now()<deadline){try{const value=await fn();if(value)return value;}catch(e){error=e;}await new Promise(r=>setTimeout(r,50));}throw error??new Error('انتهت مهلة fixture');}
async function terminate(child){if(child.exitCode!==null||child.signalCode!==null)return;await new Promise(r=>{const timer=setTimeout(()=>child.kill('SIGKILL'),1500);child.once('exit',()=>{clearTimeout(timer);r();});child.kill();});}

test('rqbit 9.0.1 الحقيقي: metadata من سرب مملوك، ملف واحد، Range عبر خدمات العميل وتنظيف', {skip:!binary,timeout:30000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vantara-owned-swarm-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const owned=Buffer.from('VANTARA owned local fixture. '.repeat(2048));
  const other=Buffer.from('UNSELECTED second owned file. '.repeat(3072));
  const pieceLength=16384,all=Buffer.concat([owned,other]),pieces=[];
  for(let i=0;i<all.length;i+=pieceLength)pieces.push(sha(all.subarray(i,i+pieceLength)));
  const info={name:'owned',files:[{length:owned.length,path:['clip.mp4']},{length:other.length,path:['other.mkv']}],'piece length':pieceLength,pieces:Buffer.concat(pieces)};
  const torrent=encode({info}),hash=sha(encode(info)).toString('hex');
  const seedOutput=join(dir,'seed');await mkdir(join(seedOutput,'owned'),{recursive:true});await writeFile(join(seedOutput,'owned','clip.mp4'),owned);await writeFile(join(seedOutput,'owned','other.mkv'),other);
  const seedApi=await availablePort(),peer=await availablePort(),backend=await availablePort(),auth=`fixture:${randomBytes(16).toString('hex')}`;
  const seed=spawn(binary,['-v','error','--http-api-listen-addr',`127.0.0.1:${seedApi}`,'--listen-ip','127.0.0.1','--listen-port',String(peer),'--disable-dht','--disable-trackers','--disable-lsd','--disable-upnp-port-forward','server','start',seedOutput,'--disable-persistence'],{env:{...process.env,RQBIT_HTTP_BASIC_AUTH_USERPASS:auth},stdio:'ignore'});
  t.after(()=>terminate(seed));
  const headers={Authorization:`Basic ${Buffer.from(auth).toString('base64')}`};
  await until(async()=>{const r=await fetch(`http://127.0.0.1:${seedApi}/`,{headers});return r.ok;});
  const added=await (await fetch(`http://127.0.0.1:${seedApi}/torrents?overwrite=true`,{method:'POST',headers:{...headers,'content-type':'application/octet-stream'},body:torrent})).json();
  assert.equal(added.id,0,JSON.stringify(added));
  await until(async()=>{const r=await(await fetch(`http://127.0.0.1:${seedApi}/torrents/0/stats/v1`,{headers})).json();return r.state==='live'&&r.finished;});
  const wrapper=join(dir,'rqbit-fixture'),player=join(dir,'mpv-fixture');
  // This adapter injects only the owned loopback peer into the real engine's
  // API query. Production has no test peer override or byte-transfer IPC.
  await writeFile(wrapper,`#!${process.execPath}\nimport http from 'node:http';import {spawn} from 'node:child_process';import fs from 'node:fs';
const args=process.argv.slice(2),index=args.indexOf('--http-api-listen-addr'),external=args[index+1].split(':').at(-1);args[index+1]='127.0.0.1:${backend}';args.unshift('--disable-dht','--disable-trackers');
const child=spawn(${JSON.stringify(binary)},args,{env:process.env,stdio:'ignore'});fs.writeFileSync(${JSON.stringify(join(dir,'backend-pid'))},String(child.pid));
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(req.method==='POST'&&u.pathname==='/torrents')u.searchParams.set('initial_peers','127.0.0.1:${peer}');fs.appendFileSync(${JSON.stringify(join(dir,'requests'))},u.pathname+u.search+'\\n');const forward=http.request('http://127.0.0.1:${backend}'+u.pathname+u.search,{method:req.method,headers:req.headers},back=>{res.writeHead(back.statusCode,back.headers);back.pipe(res);});forward.on('error',()=>{res.writeHead(503);res.end('{}');});req.pipe(forward);});server.listen(Number(external),'127.0.0.1');
process.on('SIGTERM',()=>{server.closeAllConnections();server.close();child.kill();});child.once('exit',()=>process.exit());`);
  await writeFile(player,`#!${process.execPath}\nimport net from 'node:net';import fs from 'node:fs';const args=process.argv.slice(2),socket=args.find(x=>x.startsWith('--input-ipc-server=')).slice(19);let url;
net.createServer(c=>{let buf='';c.on('data',b=>{buf+=b;while(buf.includes('\\n')){const i=buf.indexOf('\\n'),m=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);c.write(JSON.stringify({request_id:m.request_id,error:'success',data:m.command[0]==='get_property'?{w:320,h:180}:undefined})+'\\n');if(m.command[0]==='observe_property')c.write(JSON.stringify({event:'property-change',name:m.command[2],data:m.command[2]==='duration'?5:m.command[2]==='time-pos'?1:m.command[2]==='video-out-params'?{w:320,h:180}:m.command[2]==='track-list'?[]:false})+'\\n');if(m.command[0]==='loadfile'){url=m.command[1];c.write(JSON.stringify({event:'playback-restart'})+'\\n');fetch(url,{headers:{Range:'bytes=0-127'}}).then(async r=>{fs.writeFileSync(${JSON.stringify(join(dir,'range-body'))},Buffer.from(await r.arrayBuffer()));fs.writeFileSync(${JSON.stringify(join(dir,'range-status'))},String(r.status));});}}});c.write(JSON.stringify({event:'file-loaded'})+'\\n');}).listen(socket);`);
  const {chmod}=await import('node:fs/promises');await chmod(wrapper,0o755);await chmod(player,0o755);
  const events=[],userData=join(dir,'client');await mkdir(userData);
  const services=createDesktopServices({userData,binaries:{rqbit:wrapper,mpv:player},onEvent:event=>events.push(event)});t.after(()=>services.close());
  assert.deepEqual(await services.startPlayback({session:'owned',candidate:{infoHash:hash,fileIdx:0},title:'اختبار مملوك'}),{started:true});
  await until(()=>readFile(join(dir,'range-status'),'utf8'));
  assert.equal(await readFile(join(dir,'range-status'),'utf8'),'206');
  assert.deepEqual(await readFile(join(dir,'range-body')),owned.subarray(0,128));
  const paths=(await readFile(join(dir,'requests'),'utf8')).split('\n');
  assert.ok(paths.some(p=>p.includes('list_only=true')));assert.ok(paths.some(p=>p.includes('only_files=0')));
  assert.ok(events.some(e=>e.type==='playback/ready'));
  await services.stopPlayback({session:'owned'});
  const pid=Number(await readFile(join(dir,'backend-pid'),'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});

const mpvBinary=process.env.VANTARA_MPV_LINUX;
test('mpv الحقيقي يفك فيديو مؤلف وترجمة عربية ويتتبع OSC/seek/rate وينظف العمليات', {skip:!mpvBinary,timeout:25000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vantara-owned-video-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const video=join(dir,'owned.mp4');
  const ffmpeg=spawn('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','8','-c:v','mpeg4','-q:v','3','-movflags','+faststart',video],{stdio:'pipe'});
  let stderr='';ffmpeg.stderr.on('data',b=>stderr+=b);assert.equal(await new Promise(r=>ffmpeg.once('exit',r)),0,stderr);
  const contents=await readFile(video);
  const source=http.createServer((req,res)=>{
    if(req.url.endsWith('.srt')){res.setHeader('content-type','application/x-subrip');return res.end('1\n00:00:00,000 --> 00:00:08,000\nترجمة عربية مؤلفة للاختبار\n');}
    const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
    const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),contents.length-1):contents.length-1;
    if(start>=contents.length){res.writeHead(416,{'content-range':`bytes */${contents.length}`});return res.end();}
    res.writeHead(match?206:200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':end-start+1,...(match?{'content-range':`bytes ${start}-${end}/${contents.length}`}:{})});res.end(contents.subarray(start,end+1));
  });await new Promise(r=>source.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>source.close(r)));
  const {default:https}=await import('node:https'),{default:dns}=await import('node:dns/promises');
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'request',(url,options,cb)=>http.request(`http://127.0.0.1:${source.address().port}${url.pathname}`,{...options,lookup:undefined},cb));
  const wrapper=join(dir,'mpv');
  await writeFile(wrapper,`#!${process.execPath}\nimport {spawn} from 'node:child_process';import fs from 'node:fs';const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(join(dir,'args'))},JSON.stringify(args));const child=spawn(${JSON.stringify(mpvBinary)},args,{env:process.env,stdio:'ignore'});fs.writeFileSync(${JSON.stringify(join(dir,'pid'))},String(child.pid));process.on('SIGTERM',()=>{child.kill();setTimeout(()=>child.kill('SIGKILL'),300);});child.once('exit',code=>process.exit(code??0));`);
  const {chmod}=await import('node:fs/promises');await chmod(wrapper,0o755);
  const events=[];const services=createDesktopServices({userData:dir,binaries:{rqbit:binary??'/not-used',mpv:wrapper},onEvent:e=>events.push(e)});t.after(()=>services.close());
  assert.deepEqual(await services.startPlayback({session:'real-video',candidate:{url:'https://fixture.example.com/owned.mp4'},title:'فيديو VANTARA المؤلف',position:1000,pause:true}),{started:true});
  await until(()=>events.some(e=>e.type==='playback/ready'));
  const args=JSON.parse(await readFile(join(dir,'args'),'utf8')),path=args.find(x=>x.startsWith('--input-ipc-server=')).slice(19);
  const socket=net.createConnection(path);t.after(()=>socket.destroy());await new Promise((r,j)=>{socket.once('connect',r);socket.once('error',j);});
  const params=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(new Error('IPC timeout')),2000);socket.on('data',chunk=>{buffer+=chunk;for(const line of buffer.split('\n').slice(0,-1)){const message=JSON.parse(line);if(message.request_id===99){clearTimeout(timer);resolve(message.data);}}buffer=buffer.split('\n').at(-1);});socket.write(JSON.stringify({command:['get_property','video-out-params'],request_id:99})+'\n');});
  assert.equal(params.w,320);assert.equal(params.h,180);
  assert.ok(events.some(e=>e.type==='playback/state'&&e.paused===true));
  // Native pause controls must reach the room driver just like bridge calls.
  socket.write(JSON.stringify({command:['set_property','pause',false],request_id:501})+'\n');
  await until(()=>events.some(e=>e.type==='playback/pause'&&e.paused===false));
  await services.playbackCommand({session:'real-video',command:'subtitle-load',value:{url:'https://subs.example.com/arabic.srt',lang:'ara',label:'العربية المؤلفة'}});
  await until(()=>events.some(e=>e.type==='playback/subtitles'&&e.tracks.some(track=>track.lang==='ar'&&track.selected)));
  const subText=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(new Error('subtitle IPC timeout')),2000);const receive=chunk=>{buffer+=chunk;for(const line of buffer.split('\n').slice(0,-1)){const message=JSON.parse(line);if(message.request_id===100){clearTimeout(timer);socket.removeListener('data',receive);resolve(message.data);}}buffer=buffer.split('\n').at(-1);};socket.on('data',receive);socket.write(JSON.stringify({command:['get_property','sub-text'],request_id:100})+'\n');});
  assert.match(subText,/ترجمة عربية مؤلفة/);
  await services.playbackCommand({session:'real-video',command:'subtitle-load',value:{url:'https://subs.example.com/english.srt',lang:'en',label:'اختيار يدوي'}});
  await until(()=>events.findLast(e=>e.type==='playback/subtitles')?.tracks.some(track=>track.lang==='en'));
  const englishId=events.findLast(e=>e.type==='playback/subtitles').tracks.find(track=>track.lang==='en').id;
  // Another IPC client represents a native OSC/keyboard selection, outside
  // the renderer's playbackCommand path.
  socket.write(JSON.stringify({command:['set_property','sid',englishId],request_id:101})+'\n');
  await until(()=>events.findLast(e=>e.type==='playback/subtitles')?.tracks.some(track=>track.id===englishId&&track.selected));
  await services.playbackCommand({session:'real-video',command:'subtitle-load',value:{url:'https://subs.example.com/late-arabic.srt',lang:'ar',label:'عربية متأخرة'}});
  await new Promise(r=>setTimeout(r,30));
  assert.equal(events.findLast(e=>e.type==='playback/subtitles').tracks.find(track=>track.selected)?.id,englishId);
  await services.playbackCommand({session:'real-video',command:'subtitle-delay',value:500});
  await services.playbackCommand({session:'real-video',command:'subtitle-size',value:46});
  await services.playbackCommand({session:'real-video',command:'subtitle-position',value:85});
  await services.playbackCommand({session:'real-video',command:'video-fit',value:'fill'});
  await services.playbackCommand({session:'real-video',command:'speed',value:1.5});
  await services.playbackCommand({session:'real-video',command:'speed',value:1});
  await services.playbackCommand({session:'real-video',command:'subtitle-off'});
  await services.playbackCommand({session:'real-video',command:'subtitle-select',value:events.findLast(e=>e.type==='playback/subtitles'&&e.tracks.length)?.tracks[0].id});
  await until(()=>events.some(e=>e.type==='playback/progress'&&e.position>=1000&&e.duration>=7900));
  await services.playbackCommand({session:'real-video',command:'pause',value:true});
  await services.playbackCommand({session:'real-video',command:'seek',value:4000});
  await until(()=>events.some(e=>e.position>=3900));
  await until(()=>events.some(e=>e.type==='playback/seek'&&e.position>=3900));
  await services.playbackCommand({session:'real-video',command:'rate',value:0.98});
  await services.playbackCommand({session:'real-video',command:'rate',value:1});
  await services.stopPlayback({session:'real-video'});
  assert.equal(events.filter(e=>e.type==='playback/closed').length,1);
  const pid=Number(await readFile(join(dir,'pid'),'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
