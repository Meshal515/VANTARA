import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices, selectTorrentFile, validateCandidate, resolvePublicURL, validateTorrentStorage, validateSubtitleText, retryableMetadataFailure, PUBLIC_TRACKERS, MAX_ANNOUNCE, mergeTrackers, initialPeers, engineArgs } from './services.mjs';
import { createTorrentReplayCache } from './torrent-replay-cache.mjs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const hash = 'a'.repeat(40);
test('HTTPS يرفض الأهداف الداخلية وكل DNS يحتوي عنوانًا داخليًا', async () => {
  for (const url of ['http://example.com/', 'https://127.0.0.1/', 'https://[::1]/', 'https://user:pass@example.com/', 'https://localhost/']) {
    await assert.rejects(resolvePublicURL(url), /رابط|داخلي/);
  }
  await assert.rejects(resolvePublicURL('https://example.com/', async () => [{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]), /داخلي/);
  const result = await resolvePublicURL('https://example.com/token?secret=1', async () => [{address:'93.184.216.34',family:4}]);
  assert.equal(result.address, '93.184.216.34');
  assert.equal(result.url.search, '?secret=1');
});
test('اختيار fileIdx صفر دقيق ولا يخمّن أكبر ملف', () => {
  const files = [{name:'small.mp4',length:10},{name:'large.mkv',length:999}];
  assert.equal(selectTorrentFile(files,{fileIdx:0}),0);
  assert.equal(selectTorrentFile(files,{filename:'large.mkv'}),1);
  assert.equal(selectTorrentFile([files[0]],{}),0);
  assert.throws(() => selectTorrentFile(files,{}), /small.mp4.*large.mkv/);
  assert.throws(() => selectTorrentFile(files,{fileIdx:2}), /fileIdx/);
  assert.equal(selectTorrentFile([{name:'movie.mkv',length:600000},{name:'movie.ar.srt',length:1000},{name:'cover.jpg',length:1200}],{}),0);
  assert.equal(selectTorrentFile([{name:'Sample/sample.mp4',length:10000},{name:'Movie.mkv',length:900000}],{}),1);
  assert.throws(()=>selectTorrentFile([{name:'S01E01.mkv',length:40000},{name:'S01E02.mkv',length:40000}],{}),/يلزم اختيار/);
});
test('اسم ملف صريح غير موجود أو ملتبس لا يتحول إلى فيلم آخر',()=>{
  assert.throws(()=>selectTorrentFile([{name:'wrong.mkv',length:10}],{filename:'requested.mkv'}),/ملف/);
  assert.equal(selectTorrentFile([{name:'A/episode.mkv',length:10},{name:'B/episode.mkv',length:10}],{filename:'B/episode.mkv'}),1);
  assert.throws(()=>selectTorrentFile([{name:'A/episode.mkv',length:10},{name:'B/episode.mkv',length:10}],{filename:'episode.mkv'}),/ملف/);
});
test('mpv uses a trusted embedded HWND and releases it after process cleanup',async t=>{
  let released=0;
  const {dir,services}=await fixture(t,'normal',{videoHost:{acquire:async()=>({windowId:'123456',close:async()=>{released++;}})}});
  await services.startPlayback({session:'embedded',candidate:{infoHash:hash,fileIdx:0}});
  const args=JSON.parse(await readFile(join(dir,'mpv-log'),'utf8'));
  assert.ok(args.includes('--wid=123456'));assert.ok(args.includes('--osc=no'));
  await services.stopPlayback({session:'embedded'});assert.equal(released,1);
});
test('مشغل Windows يطلب حتى دقيقة كاش أمامي بحد RAM ويحاول التسريع العتادي الآمن',async t=>{
  const {dir,services}=await fixture(t);
  await services.startPlayback({session:'memory-cache',candidate:{url:'https://video.example.com/test.mp4'}});
  const args=JSON.parse(await readFile(join(dir,'mpv-log'),'utf8'));
  assert.ok(args.includes('--cache-secs=60'));
  assert.ok(args.some(x=>/^--demuxer-max-bytes=(128|256|512)MiB$/.test(x)));
  assert.ok(args.some(x=>/^--demuxer-max-back-bytes=(32|64|128)MiB$/.test(x)));
  assert.ok(args.includes('--cache-on-disk=no'));
  assert.ok(args.includes('--hwdec=auto-safe'));
});
test('native stages describe metadata, one selected file, and first-frame decoding without URLs',async t=>{
  const {services,events}=await fixture(t);
  await services.startPlayback({session:'stages',candidate:{infoHash:hash,fileIdx:0}});
  const stages=events.filter(e=>e.type==='playback/stage').map(e=>e.stage);
  assert.ok(stages.includes('engine-start'));assert.ok(stages.includes('metadata'));assert.ok(stages.includes('file-selected'));assert.ok(stages.includes('first-frame'));
  assert.ok(events.filter(e=>e.type==='playback/stage').every(e=>!JSON.stringify(e).includes('http')));
});
test('تعاد محاولات metadata على أخطاء مؤقتة فقط، وليس عند بيانات غير صالحة',()=>{
  assert.equal(retryableMetadataFailure({status:503}),true);
  assert.equal(retryableMetadataFailure({status:429}),true);
  assert.equal(retryableMetadataFailure({code:'ECONNRESET'}),true);
  assert.equal(retryableMetadataFailure({status:400,message:'رفض محرك التورنت الطلب'}),false);
  assert.equal(retryableMetadataFailure({status:403}),false);
});
test('لا يقبل hashes أو headers أو magnets مخالفة للعقد', () => {
  assert.equal(validateCandidate({infoHash:hash,fileIdx:0,sources:['tracker:https://example.com/announce']}).fileIdx,0);
  for (const candidate of [{infoHash:'bad'},{infoHash:hash,fileIdx:-1},{infoHash:hash,magnet:`magnet:?xt=urn:btih:${'b'.repeat(40)}`},{url:'https://example.com/',headers:{Host:'private'}},{url:'https://example.com/',headers:{Authorization:'line\nbreak'}}]) {
    assert.throws(() => validateCandidate(candidate));
  }
});
test('المتتبّعات العامة تُدمج في magnet بعد متتبّعات الإضافة بلا تكرار وبحد أقصى', () => {
  assert.equal(PUBLIC_TRACKERS.length,12);
  const plain=new URL(validateCandidate({infoHash:hash}).magnet).searchParams.getAll('tr');
  assert.deepEqual(plain,[...PUBLIC_TRACKERS]);
  // متتبّع الإضافة أولًا؛ نسخة مكررة من العام (بشرطة أخيرة/حروف كبيرة) لا تُضاف مرتين
  const addon='https://example.com/announce',dup='UDP://tracker.opentrackr.org:1337/announce/';
  const merged=new URL(validateCandidate({infoHash:hash,magnet:`magnet:?xt=urn:btih:${hash}&tr=${encodeURIComponent(dup)}&dn=x`,sources:[`tracker:${addon}`]}).magnet);
  const tr=merged.searchParams.getAll('tr');
  assert.deepEqual(tr.slice(0,2),[dup,addon]);
  assert.equal(tr.length,2+PUBLIC_TRACKERS.length-1);
  assert.equal(merged.searchParams.get('dn'),'x');
  assert.equal(merged.searchParams.getAll('xt').length,1);
  // magnet غني بالمتتبّعات لا يتجاوز الحد بسبب القائمة العامة، ولا يُحذف منه شيء
  const many=Array.from({length:MAX_ANNOUNCE+3},(_,i)=>`udp://t${i}.example.org:80/announce`);
  assert.equal(mergeTrackers(many).length,MAX_ANNOUNCE+3);
  assert.equal(mergeTrackers(many.slice(0,40)).length,MAX_ANNOUNCE);
  // القائمة العامة تمر بنفس قواعد validateTracker
  assert.throws(()=>mergeTrackers([],['udp://10.0.0.1:80/announce']),/tracker/);
});
test('initial_peers: عناوين عامة فقط وبصيغة SocketAddr التي يقبلها rqbit', () => {
  assert.deepEqual(initialPeers(['93.184.216.34:6881','10.0.0.7:6881','127.0.0.1:1','[2a00:1450:4001::5]:51413','[fe80::1]:6881','[::ffff:1.2.3.4]:5','bad','8.8.8.8:0','8.8.8.8:70000','300.1.1.1:5','93.184.216.34:6881',5,null]),
    ['93.184.216.34:6881','[2a00:1450:4001::5]:51413']);
  assert.deepEqual(initialPeers(undefined),[]);
  assert.equal(initialPeers(Array.from({length:200},(_,i)=>`93.184.${i>>8}.${i&255}:6881`)).length,50);
});
test('سطر rqbit: خيارات 9.0.1 الصحيحة، وحفظ DHT يمكن تعطيله للمحاولة الثانية', () => {
  const on=engineArgs({apiPort:3030,listenPort:51413,dir:'C:\\cache'});
  assert.deepEqual(on,['-v','error','--http-api-listen-addr','127.0.0.1:3030','--disable-lsd','--listen-port','51413','server','start','C:\\cache','--disable-persistence']);
  const off=engineArgs({apiPort:3030,listenPort:51413,dir:'C:\\cache',dhtPersistence:false});
  assert.ok(off.includes('--disable-dht-persistence'));
  assert.ok(off.indexOf('--disable-dht-persistence')<off.indexOf('server'),'خيار عام قبل الأمر الفرعي');
  assert.throws(()=>engineArgs({apiPort:3030,listenPort:0,dir:'x'}));
});

async function fixture(t, mode='normal', serviceOptions={}) {
  const dir=await mkdtemp(join(tmpdir(),'vantara-services-test-'));
  let services;
  t.after(async() => {await services?.close();await rm(dir,{recursive:true,force:true});});
  const rqbit=join(dir,'rqbit'), mpv=join(dir,'mpv');
  if(process.platform==='win32'){
    // Windows CreateProcess does not execute extensionless Node shebang files.
    // Only these two test programs use a Node launcher; real binaries and the
    // application's process launcher retain their normal behavior.
    const nativeSpawn=cp.spawn;
    t.mock.method(cp,'spawn',(binary,args,options)=>[rqbit,mpv].includes(binary)?nativeSpawn(process.execPath,[binary,...args],options):nativeSpawn(binary,args,options));
    syncBuiltinESMExports();
    t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  }
  await writeFile(rqbit, `#!${process.execPath}\nimport http from 'node:http';import fs from 'node:fs';
const args=process.argv.slice(2),port=Number(args[args.indexOf('--http-api-listen-addr')+1].split(':').pop());
fs.appendFileSync(${JSON.stringify(join(dir,'rqbit-attempts'))},JSON.stringify(args)+'\\n');if(${JSON.stringify(mode)}==='dht-conflict'&&!args.includes('--disable-dht-persistence'))process.exit(1);
fs.writeFileSync(${JSON.stringify(join(dir,'rqbit-log'))},JSON.stringify({args,pid:process.pid,auth:process.env.RQBIT_HTTP_BASIC_AUTH_USERPASS}));
const server=http.createServer((req,res)=>{if(req.headers.authorization!=='Basic '+Buffer.from(process.env.RQBIT_HTTP_BASIC_AUTH_USERPASS).toString('base64')){res.writeHead(401);return res.end();}let body='';req.on('data',x=>body+=x);req.on('end',()=>{fs.appendFileSync(${JSON.stringify(join(dir,'requests'))},JSON.stringify({url:req.url,body})+'\\n');if(${JSON.stringify(mode)}==='initializing'&&req.url.includes('/stream/')){const f=${JSON.stringify(join(dir,'init-count'))};const n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+1));if(n<2){res.writeHead(500,{'content-type':'application/json'});return res.end('{"error_kind":"internal_error","human_readable":"with_storage_and_file: invalid state: initializing","status":500}');}res.writeHead(206,{'content-type':'video/mp4','content-length':'4','content-range':'bytes 0-3/20','accept-ranges':'bytes'});return res.end('abcd');}if(${JSON.stringify(mode)}==='headers-before-body'&&req.url.includes('/stream/')){res.writeHead(206,{'content-type':'video/mp4','content-length':'4','content-range':'bytes 0-3/20','accept-ranges':'bytes'});res.flushHeaders();const gate=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(dir,'release-stream'))})){clearInterval(gate);res.end('abcd');}},10);res.once('close',()=>clearInterval(gate));return;}if(req.url.includes('/stream/')){res.writeHead(206,{'content-type':'video/mp4','content-length':'4','content-range':'bytes 0-3/20','accept-ranges':'bytes'});return res.end('abcd');}res.setHeader('content-type','application/json');if(req.method==='POST'&&req.url.startsWith('/torrents?')){if(${JSON.stringify(mode)}==='slow')return;const u=new URL(req.url,'http://local');if(${JSON.stringify(mode)}==='transient-metadata'&&u.searchParams.has('list_only')&&!fs.existsSync(${JSON.stringify(join(dir,'metadata-once'))})){fs.writeFileSync(${JSON.stringify(join(dir,'metadata-once'))},'1');res.writeHead(503);return res.end('{}');}if(!u.searchParams.has('list_only')&&u.searchParams.get('only_files')!=='0'){res.writeHead(400);return res.end('{}');}if(${JSON.stringify(mode)}==='reject-peers'&&u.searchParams.has('initial_peers')){res.writeHead(400);return res.end('{}');}return res.end(JSON.stringify({id:u.searchParams.has('list_only')?null:0,...(u.searchParams.has('list_only')&&['peers','reject-peers'].includes(${JSON.stringify(mode)})?{seen_peers:['93.184.216.34:6881','10.0.0.7:6881','[2a00:1450:4001::5]:51413','[fe80::1]:6881','bad','8.8.8.8:0','93.184.216.34:6881']}:{}),details:{info_hash:${JSON.stringify(hash)},files:[{name:'clip.mp4',length:${mode==='oversize'?90*1024**3:mode==='unknown'?JSON.stringify('unknown'):20}},{name:'other.mkv',length:900}]}}));}if(req.url.includes('stats'))return res.end(JSON.stringify({live:{download_speed:{mbps:1},snapshot:{peer_stats:{live:3}}}}));res.end('{}');});});server.listen(port,'127.0.0.1');`);
  await writeFile(mpv, `#!${process.execPath}\nimport net from 'node:net';import fs from 'node:fs';const args=process.argv.slice(2),tracks=[],videoParams=${mode==='audio-only'?'null':'{w:320,h:180}'};let nextTrackId=0,paused=args.includes('--pause=yes'),time=2;fs.writeFileSync(${JSON.stringify(join(dir,'mpv-log'))},JSON.stringify(args));const socket=args.find(x=>x.startsWith('--input-ipc-server=')).split('=').slice(1).join('=');net.createServer(c=>{let pending='';c.on('data',b=>{pending+=b;while(pending.includes('\\n')){const i=pending.indexOf('\\n'),m=JSON.parse(pending.slice(0,i));pending=pending.slice(i+1);fs.appendFileSync(${JSON.stringify(join(dir,'commands'))},JSON.stringify(m)+'\\n');c.write(JSON.stringify({request_id:m.request_id,error:'success',data:m.command[0]==='get_property'?(m.command[1]==='track-list'?tracks:m.command[1]==='time-pos'?time:videoParams):undefined})+'\\n');if(m.command[0]==='observe_property')c.write(JSON.stringify({event:'property-change',name:m.command[2],data:m.command[2]==='duration'?60:m.command[2]==='time-pos'?time:m.command[2]==='video-out-params'?videoParams:m.command[2]==='track-list'?tracks:m.command[2]==='pause'?paused:false})+'\\n');if(m.command[0]==='set_property'&&m.command[1]==='pause'){paused=m.command[2];c.write(JSON.stringify({event:'property-change',name:'pause',data:paused})+'\\n');}if(m.command[0]==='seek'){time=m.command[1];c.write(JSON.stringify({event:'seek'})+'\\n');c.write(JSON.stringify({event:'property-change',name:'time-pos',data:time})+'\\n');c.write(JSON.stringify({event:'playback-restart'})+'\\n');}if(m.command[0]==='sub-remove'){const at=tracks.findIndex(t=>t.id===m.command[1]);if(at>=0)tracks.splice(at,1);c.write(JSON.stringify({event:'property-change',name:'track-list',data:tracks})+'\\n');}if(m.command[0]==='sub-add'){if(m.command[2]==='select')for(const track of tracks)track.selected=false;tracks.push({id:++nextTrackId,type:'sub',lang:m.command[4],title:m.command[3],selected:m.command[2]==='select'});c.write(JSON.stringify({event:'property-change',name:'track-list',data:tracks})+'\\n');}if(m.command[0]==='set_property'&&m.command[1]==='sid'){for(const track of tracks)track.selected=track.id===m.command[2];c.write(JSON.stringify({event:'property-change',name:'track-list',data:tracks})+'\\n');}if(m.command[0]==='loadfile'){c.write(JSON.stringify({event:'file-loaded'})+'\\n');if(${JSON.stringify(mode)}!=='not-decoded')c.write(JSON.stringify({event:'playback-restart'})+'\\n');}}});c.write(JSON.stringify({event:'file-loaded'})+'\\n');}).listen(socket);`);
  const {chmod}=await import('node:fs/promises');await chmod(rqbit,0o755);await chmod(mpv,0o755);
  const events=[];services=createDesktopServices({userData:dir,binaries:{rqbit,mpv},onEvent:e=>events.push(e),platform:process.platform,dnsOverHttps:false,torrentMetadataStrategy:'list-only',replayCache:false,...serviceOptions});
  return {dir,services,events,binaries:{rqbit,mpv}};
}
test('an explicit file index resolves the magnet once and never performs list_only discovery',async t=>{
  const {dir,services,events}=await fixture(t,'normal',{torrentMetadataStrategy:'direct-index'});
  await services.startPlayback({session:'single-resolution',candidate:{infoHash:hash,fileIdx:0}});
  const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(requests.filter(r=>r.url.includes('list_only=true')).length,0);
  assert.equal(requests.filter(r=>r.url.includes('only_files=0')).length,1);
  assert.ok(await hasReadyEvent(events));
});
test('torrent HTTP headers reach the player before a missing first piece is available',async t=>{
  const {dir,services,events}=await fixture(t,'headers-before-body',{torrentMetadataStrategy:'direct-index'});
  await services.startPlayback({session:'headers-before-piece',candidate:{infoHash:hash,fileIdx:0}});
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);
  const url=commands.find(m=>m.command[0]==='loadfile').command[1];
  // The engine has sent headers but deliberately cannot supply a verified byte
  // until the test releases it. A response callback must not wait for that byte.
  const response=await fetch(url,{headers:{Range:'bytes=0-3'},signal:AbortSignal.timeout(1500)});
  assert.equal(response.status,206);
  assert.equal(response.headers.get('content-range'),'bytes 0-3/20');
  assert.equal(response.headers.get('content-length'),'4');
  assert.equal(events.some(e=>e.stage==='http-first-byte'),false);
  const headers=events.find(e=>e.stage==='http-headers');
  assert.ok(headers,'headers and first body byte need separate startup timings');
  assert.equal(headers.requestId,1);
  assert.equal(headers.rangeStart,0);
  assert.equal(headers.rangeEnd,3);
  await writeFile(join(dir,'release-stream'),'1');
  assert.equal(await response.text(),'abcd');
  assert.ok(events.find(e=>e.stage==='http-first-byte').elapsedMs>=headers.elapsedMs);
});
test('rqbit 500 «initializing» is retried by the proxy and never reaches the player as video bytes',async t=>{
  const {dir,services,events}=await fixture(t,'initializing',{torrentMetadataStrategy:'direct-index'});
  await services.startPlayback({session:'engine-initializing',candidate:{infoHash:hash,fileIdx:0}});
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);
  const url=commands.find(m=>m.command[0]==='loadfile').command[1];
  const response=await fetch(url,{headers:{Range:'bytes=0-3'},signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,206);
  assert.equal(await response.text(),'abcd');
  assert.equal(await readFile(join(dir,'init-count'),'utf8'),'3');
  assert.ok(events.some(e=>e.stage==='engine-file-initializing'));
});
test('a prewarmed torrent is adopted by playback: one engine add, paused while waiting, resumed on play',async t=>{
  const {dir,services}=await fixture(t,'normal',{torrentMetadataStrategy:'direct-index'});
  const requests=async()=>(await readFile(join(dir,'requests'),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.deepEqual(await services.prewarmTorrent({candidate:{infoHash:hash,fileIdx:0}}),{prewarmed:true});
  assert.deepEqual(await services.prewarmTorrent({candidate:{infoHash:hash,fileIdx:0}}),{prewarmed:true});
  for(let i=0;i<200&&!(await requests()).some(r=>r.url.endsWith('/pause'));i++)await new Promise(r=>setTimeout(r,25));
  assert.ok((await requests()).some(r=>r.url.endsWith('/pause')),'the prewarm stops downloading after the edges');
  await services.startPlayback({session:'prewarmed',candidate:{infoHash:hash,fileIdx:0}});
  const all=await requests();
  assert.equal(all.filter(r=>r.url.startsWith('/torrents?')).length,1,'playback reuses the prewarmed engine and torrent');
  assert.ok(all.findIndex(r=>r.url.endsWith('/start'))>all.findIndex(r=>r.url.endsWith('/pause')));
});
for(const completed of [false,true])test(`adopted prewarm records replay only for its playback owner (completed=${completed})`,async t=>{
  const {dir,services}=await fixture(t,'normal',{torrentMetadataStrategy:'direct-index',replayCache:true});
  await services.prewarmTorrent({candidate:{infoHash:hash,fileIdx:0}});
  if(completed){
    for(let i=0;i<200;i++){
      const requests=(await readFile(join(dir,'requests'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(JSON.parse);
      if(requests.some(r=>r.url.endsWith('/pause')))break;
      await new Promise(r=>setTimeout(r,25));
    }
  }
  const anonymous=createTorrentReplayCache({userData:dir});
  assert.equal(await anonymous.lookup({infoHash:hash,fileIdx:0}),null,'preparation must not create a guest-owned replay');await anonymous.close();
  await services.startPlayback({session:'owned-prewarm',ownerId:'playback-owner',candidate:{infoHash:hash,fileIdx:0}});
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);
  const url=commands.find(m=>m.command[0]==='loadfile').command[1];
  const response=await fetch(url,{headers:{Range:'bytes=0-3'},signal:AbortSignal.timeout(4000)});
  assert.equal(await response.text(),'abcd');
  await services.stopPlayback({session:'owned-prewarm'});await services.close();
  const cache=createTorrentReplayCache({userData:dir,ownerId:'playback-owner'});t.after(()=>cache.close());
  const replay=await cache.lookup({infoHash:hash,fileIdx:0});
  assert.ok(replay,'adoption must retain verified replay for the next app process');
  assert.equal((await replay.read(0,4))?.toString(),'abcd');
  for(const ownerId of ['guest','other-owner']){const other=createTorrentReplayCache({userData:dir,ownerId});assert.equal(await other.lookup({infoHash:hash,fileIdx:0}),null);await other.close();}
});
test('playing a different torrent discards the prewarm instead of competing with it',async t=>{
  const {dir,services}=await fixture(t,'normal',{torrentMetadataStrategy:'direct-index'});
  const requests=async()=>(await readFile(join(dir,'requests'),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(JSON.parse);
  await services.prewarmTorrent({candidate:{infoHash:hash,fileIdx:0}});
  for(let i=0;i<200&&!(await requests()).some(r=>r.url.endsWith('/pause'));i++)await new Promise(r=>setTimeout(r,25));
  await services.startPlayback({session:'other',candidate:{url:'https://video.example.com/fixture.mp4'}});
  await services.prewarmTorrent({candidate:{infoHash:hash,fileIdx:0}});
  for(let i=0;i<200&&(await requests()).filter(r=>r.url.startsWith('/torrents?')).length<2;i++)await new Promise(r=>setTimeout(r,25));
  assert.equal((await requests()).filter(r=>r.url.startsWith('/torrents?')).length,2,'the old prewarm was dropped, so the same torrent is prepared afresh');
});
test('controls arriving during preparation wait for loadfile rather than reporting a disconnected player',async t=>{
  let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
  const {dir,services}=await fixture(t,'normal',{videoHost:{acquire:async()=>{enter();await gate;return {windowId:'1234',close:async()=>{}};}}});
  const opening=services.startPlayback({session:'early-controls',candidate:{url:'https://video.example.com/fixture.mp4'}});
  await entered;
  const paused=services.playbackCommand({session:'early-controls',command:'pause',value:true});
  const verification=assert.doesNotReject(paused);
  release();await opening;await verification;
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(commands.findIndex(m=>m.command[0]==='loadfile')<commands.findIndex(m=>m.command[0]==='set_property'&&m.command[1]==='pause'));
});
test('sparse 256 KiB replay for a large video does not masquerade as a warm-ready first frame',async t=>{
  const {dir,services,events}=await fixture(t,'normal',{replayCache:true,torrentMetadataStrategy:'direct-index'});
  const cache=createTorrentReplayCache({userData:dir});
  const entry=await cache.remember({root:dir,infoHash:hash,fileIdx:0,fileLength:8*1024*1024,filename:'clip.mp4'});
  assert.equal(await entry.write(0,Buffer.alloc(256*1024,0x41)),true);
  await cache.close();
  await services.startPlayback({session:'sparse-replay-needs-engine',candidate:{infoHash:hash,fileIdx:0}});
  const stage=events.find(e=>e.stage==='replay-preflight');
  assert.equal(stage?.mode,'engine-required');
  assert.equal(stage?.verifiedBytes,256*1024);
  const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(requests.some(x=>x.url.startsWith('/torrents?')),'playback must use the verified engine instead of the sparse shortcut');
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);
  const url=commands.find(m=>m.command[0]==='loadfile').command[1];
  const response=await fetch(url,{headers:{Range:'bytes=0-3'},signal:AbortSignal.timeout(4000)});
  assert.equal(response.status,206);
  assert.equal(await response.text(),'abcd','a rejected replay must never be served again after remember()');
});

test('verified replay serves the exact selected range while fresh magnet discovery is still blocked',async t=>{
  const {dir,services}=await fixture(t,'slow',{replayCache:true,torrentMetadataStrategy:'direct-index'});
  const cache=createTorrentReplayCache({userData:dir});
  const entry=await cache.remember({root:dir,infoHash:hash,fileIdx:0,fileLength:20,filename:'clip.mp4'});
  assert.equal(await entry.write(0,Buffer.from('0123456789abcdefghij')),true);await cache.close();
  const opening=services.startPlayback({session:'cached-before-metadata',candidate:{infoHash:hash,fileIdx:0}});
  await Promise.race([opening,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('cached startup waited for metadata')),1500);timer.unref();})]);
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);
  const url=commands.find(m=>m.command[0]==='loadfile').command[1];
  const response=await fetch(url,{headers:{Range:'bytes=3-8'},signal:AbortSignal.timeout(1500)});
  assert.equal(response.status,206);assert.equal(await response.text(),'345678');
  assert.equal(response.headers.get('content-range'),'bytes 3-8/20');
  await services.stopPlayback({session:'cached-before-metadata'});
});
test('عمليات حقيقية: rqbit خاص وملف واحد ثم mpv IPC وتقدم وأوامر وتنظيف',async t=>{
  const {dir,services,events}=await fixture(t);
  assert.deepEqual(await services.startPlayback({session:'one',candidate:{type:'torrent',infoHash:hash,fileIdx:0},title:'عنوان عربي',position:5000}),{started:true});
  await new Promise(r=>setTimeout(r,150));
  const rq=JSON.parse(await readFile(join(dir,'rqbit-log'),'utf8'));
  // UPnP مفعّل وحفظ DHT مفعّل ومنفذ استماع صريح (0 يصير 4240 الثابت في rqbit server)
  assert.ok(!rq.args.includes('--disable-upnp-port-forward'));
  assert.ok(!rq.args.includes('--disable-dht-persistence'));
  assert.ok(Number(rq.args[rq.args.indexOf('--listen-port')+1])>0);
  assert.ok(rq.args.includes('--disable-lsd'));
  assert.ok(rq.args.includes('--disable-persistence'));
  assert.match(rq.auth,/^vantara:[a-f0-9]{48}$/);
  const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(requests.some(r=>r.url.includes('list_only=true')));
  assert.ok(requests.some(r=>r.url.includes('only_files=0')));
  const mpv=JSON.parse(await readFile(join(dir,'mpv-log'),'utf8'));
  assert.ok(mpv.includes('--no-config'));assert.ok(mpv.includes('--start=5'));
  assert.ok(mpv.includes('--title=عنوان عربي'));
  assert.ok(!mpv.join(' ').includes(rq.auth));
  assert.ok(events.some(e=>e.type==='playback/ready'));
  assert.ok(events.some(e=>e.type==='playback/progress'&&e.position===2000&&e.duration===60000));
  await services.playbackCommand({session:'one',command:'pause',value:true});
  await services.playbackCommand({session:'one',command:'seek',value:9000});
  await assert.rejects(services.playbackCommand({session:'old',command:'pause',value:true}),/جلسة/);
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(commands.some(m=>JSON.stringify(m.command)==='["set_property","pause",true]'));
  assert.ok(commands.some(m=>JSON.stringify(m.command)==='["seek",9,"absolute"]'));
  await services.stopPlayback({session:'one'});
  assert.equal(events.filter(e=>e.type==='playback/closed').length,1);
  assert.throws(()=>process.kill(rq.pid,0),{code:'ESRCH'});
  await services.close();await assert.rejects(services.startPlayback({session:'two',candidate:{infoHash:hash,fileIdx:0}}),/أغلقت/);
});
// Playback start acknowledges the process before mpv's asynchronous first-frame event.
// Assert the real event with a bounded wait, not a race with the Node scheduler.
async function hasReadyEvent(events,{timeoutMs=2000}={}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(events.some(e=>e.type==='playback/ready'))return true;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  return events.some(e=>e.type==='playback/ready');
}

test('عطل metadata المؤقت يعالج تلقائيًا قبل بدء المشغل من دون تكرار إضافة التورنت',async t=>{
  const {dir,services,events}=await fixture(t,'transient-metadata');
  assert.deepEqual(await services.startPlayback({session:'metadata-recovered',candidate:{infoHash:hash,fileIdx:0}}),{started:true});
  const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(requests.filter(r=>r.url.includes('list_only=true')).length,2);
  assert.equal(requests.filter(r=>r.url.includes('only_files=0')).length,1);
  assert.ok(await hasReadyEvent(events),'mpv must report a decoded ready frame');
  assert.equal(events.some(e=>e.type==='playback/error'),false);
});
test('مشاركو list_only يصلون لإضافة التنزيل كـinitial_peers مفلترين',async t=>{
  const {dir,services,events}=await fixture(t,'peers');
  assert.deepEqual(await services.startPlayback({session:'peers',candidate:{infoHash:hash,fileIdx:0}}),{started:true});
  const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
  const add=requests.filter(r=>r.url.includes('only_files=0'));
  assert.equal(add.length,1);
  assert.equal(new URL(add[0].url,'http://x').searchParams.get('initial_peers'),'93.184.216.34:6881,[2a00:1450:4001::5]:51413');
  assert.ok(add[0].body.includes('tracker.opentrackr.org'),'magnet الإضافة يحمل المتتبّعات العامة');
  assert.ok(await hasReadyEvent(events),'mpv must report a decoded ready frame');
});
test('رفض rqbit لـinitial_peers يعاد مرة واحدة بدونها ولا يُسقط التشغيل',async t=>{
  const {dir,services,events}=await fixture(t,'reject-peers');
  assert.deepEqual(await services.startPlayback({session:'reject',candidate:{infoHash:hash,fileIdx:0}}),{started:true});
  const add=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse).filter(r=>r.url.includes('only_files=0'));
  assert.equal(add.length,2);
  assert.ok(add[0].url.includes('initial_peers='));assert.ok(!add[1].url.includes('initial_peers='));
  assert.equal(events.some(e=>e.type==='playback/error'),false);
});
test('خروج rqbit مبكرًا مع حفظ DHT يعيد التشغيل مرة بلا حفظ DHT وبمنافذ جديدة',async t=>{
  const {dir,services,events}=await fixture(t,'dht-conflict');
  assert.deepEqual(await services.startPlayback({session:'dht',candidate:{infoHash:hash,fileIdx:0}}),{started:true});
  const attempts=(await readFile(join(dir,'rqbit-attempts'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(attempts.length,2);
  assert.ok(!attempts[0].includes('--disable-dht-persistence'));assert.ok(attempts[1].includes('--disable-dht-persistence'));
  const api=a=>a[a.indexOf('--http-api-listen-addr')+1];
  assert.notEqual(api(attempts[0]),api(attempts[1]));
  assert.ok(await hasReadyEvent(events),'mpv must eventually emit ready after DHT engine restart');
  assert.equal(events.some(e=>e.type==='playback/error'),false);
});
test('عند تعليق أول إطار يعيد فتح proxy مرة واحدة دون إعادة إضافة التورنت',async t=>{
  const {dir,services,events}=await fixture(t,'not-decoded',{firstFrameRecoveryMs:60,firstFrameFailureMs:100});
  await services.startPlayback({session:'stalled',candidate:{infoHash:hash,fileIdx:0}});
  await new Promise(resolve=>setTimeout(resolve,450));
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(commands.filter(r=>r.command[0]==='loadfile').length,2);
  const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(requests.filter(r=>r.url.includes('only_files=0')).length,1);
  assert.ok(events.some(e=>e.type==='playback/retrying'));
  assert.ok(events.some(e=>e.type==='playback/error'));
});
test('الإغلاق أثناء metadata يلغي الطلب ولا يترك عملية أو حدث جلسة قديمة',async t=>{
  const {services,events}=await fixture(t,'slow');
  const start=services.startPlayback({session:'slow',candidate:{infoHash:hash,fileIdx:0}});
  const rejected=assert.rejects(start,/ألغيت|جلسة/);
  await new Promise(r=>setTimeout(r,150));await services.close();await rejected;
  assert.ok(!events.some(e=>e.type==='playback/ready'||e.type==='playback/error'));
});

test('مهلة HTTPS تشمل انتظار DNS ولا تنتظر إلى الأبد',async t=>{
  const {default:dns}=await import('node:dns/promises');
  t.mock.method(dns,'lookup',()=>new Promise(()=>{}));
  const {services}=await fixture(t);
  const outcome=await Promise.race([services.requestResource({url:'https://example.com/',timeout:100}).then(()=>'success',()=>'timeout'),new Promise(r=>setTimeout(()=>r('pending'),400))]);
  assert.equal(outcome,'timeout');
});
test('تبديل جلسة أثناء metadata يترك فقط المشغل الجديد',async t=>{
  const {services,events}=await fixture(t,'slow');
  const old=services.startPlayback({session:'old',candidate:{infoHash:hash,fileIdx:0}});
  const cancelled=assert.rejects(old,/ألغيت|جلسة/);
  await new Promise(r=>setTimeout(r,120));
  assert.deepEqual(await services.startPlayback({session:'new',candidate:{url:'https://example.com/owned.mp4'},title:'جديد'}),{started:true});
  await cancelled;await new Promise(r=>setTimeout(r,30));
  assert.ok(events.some(e=>e.session==='new'&&e.type==='playback/ready'));
  assert.ok(!events.some(e=>e.session==='old'&&['playback/error','playback/ready'].includes(e.type)));
  await services.stopPlayback({session:'old'});
  await services.playbackCommand({session:'new',command:'pause',value:true});
});
test('نقل الإضافات يحد حجم الاستجابة ويرفض التوجيه الداخلي ولا يرسل auth',async t=>{
  const {default:https}=await import('node:https'),{default:http}=await import('node:http'),{default:dns}=await import('node:dns/promises');
  const requests=[];
  const server=http.createServer((req,res)=>{requests.push(req.headers);if(req.url==='/redirect'){res.writeHead(302,{location:'https://127.0.0.1/'});return res.end();}res.end(req.url==='/large'?'x'.repeat(1000):'{"fixture":true}');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  // Isolate DNS/TLS transport; the real response stream, limits, aborts and
  // redirect policy still run against a local subprocess-independent server.
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'request',(url,options,callback)=>http.request(`http://127.0.0.1:${server.address().port}${url.pathname}`,{...options,lookup:undefined},callback));
  const {services}=await fixture(t);
  const resource=await services.requestResource({url:'https://example.com/json',json:true,limit:100});assert.equal(resource.text,'{"fixture":true}');assert.equal(resource.status,200);
  await assert.rejects(services.requestResource({url:'https://example.com/large',limit:20}),/حجم/);
  await assert.rejects(services.requestResource({url:'https://example.com/redirect'}),/توجيه|داخلي/);
  assert.match(requests[0].accept,/^application\/json, application\/\*\+json/);assert.equal(requests[0].authorization,undefined);
});

test('حجب SNI: مصافحة تنقطع تُعاد مرة بتقسيم ClientHello، ويُذكر السبب الحقيقي إن فشلت',async t=>{
  const {default:https}=await import('node:https'),{default:http}=await import('node:http'),{default:dns}=await import('node:dns/promises');
  const {FragmentingAgent}=await import('./net-unblock.mjs');
  const server=http.createServer((req,res)=>res.end('{"ok":true}'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  const agents=[];
  t.mock.method(https,'request',(url,options,callback)=>{
    agents.push(options.agent instanceof FragmentingAgent?'fragment':'plain');
    if(url.hostname==='blocked.example.com'&&!(options.agent instanceof FragmentingAgent)||url.hostname==='dead.example.com'){
      const req=new http.ClientRequest(`http://127.0.0.1:${server.address().port}/`,()=>{});
      queueMicrotask(()=>req.destroy(Object.assign(new Error('read ECONNRESET'),{code:'ECONNRESET'})));return req;
    }
    return http.request(`http://127.0.0.1:${server.address().port}${url.pathname}`,{method:options.method,headers:options.headers,signal:options.signal},callback);
  });
  const {services}=await fixture(t);
  const ok=await services.requestResource({url:'https://blocked.example.com/a',json:true});assert.equal(ok.text,'{"ok":true}');
  assert.deepEqual(agents,['plain','fragment']);
  await services.requestResource({url:'https://blocked.example.com/b'});assert.equal(agents.at(-1),'fragment');assert.equal(agents.length,3);
  await assert.rejects(services.requestResource({url:'https://dead.example.com/'}),/قُطع الاتصال الآمن فور المصافحة/);
});

test('proxy يمرر Range ويحصر headers بالأصل عبر redirects دون كشفها للمشغل',async t=>{
  const {default:https}=await import('node:https'),{default:http}=await import('node:http'),{default:dns}=await import('node:dns/promises');
  const seen=[];
  const upstream=http.createServer((req,res)=>{seen.push({path:req.url,headers:req.headers});if(req.url==='/origin'){res.writeHead(302,{location:'https://cdn.example.com/clip'});return res.end();}res.writeHead(206,{'content-type':'video/mp4','content-range':'bytes 0-3/10','accept-ranges':'bytes'});res.end('abcd');});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>upstream.close(r)));
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'request',(url,options,cb)=>http.request(`http://127.0.0.1:${upstream.address().port}${url.pathname}`,{...options,lookup:undefined},cb));
  const {services,dir}=await fixture(t);
  await services.startPlayback({session:'headers',candidate:{url:'https://example.com/origin',headers:{Authorization:'secret-token','X-Foo':'sensitive'}}});
  const args=JSON.parse(await readFile(join(dir,'mpv-log'),'utf8')),commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse),local=commands.find(m=>m.command[0]==='loadfile')?.command[1]??args.at(-1);
  assert.ok(!args.join(' ').includes('secret-token'));
  const response=await fetch(local,{headers:{Range:'bytes=0-3'}});assert.equal(response.status,206);assert.equal(await response.text(),'abcd');
  assert.equal(seen[0].headers.authorization,'secret-token');assert.equal(seen[0].headers.range,'bytes=0-3');
  assert.equal(seen[1].headers.authorization,undefined);assert.equal(seen[1].headers['x-foo'],undefined);assert.equal(seen[1].headers.range,'bytes=0-3');
  assert.equal((await fetch(new URL('/wrong/0',local))).status,404);
});
test('HLS يعيد كتابة المراجع النسبية والمطلقة بقنوات خاصة ويحمي أسرار الترويسات',async t=>{
  const {default:https}=await import('node:https'),{default:http}=await import('node:http'),{default:dns}=await import('node:dns/promises');
  const seen=[];
  const upstream=http.createServer((req,res)=>{seen.push({path:req.url,auth:req.headers.authorization});if(req.url==='/folder/index.m3u8'){res.setHeader('content-type','application/vnd.apple.mpegurl');res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/key"\n#EXTINF:1,\nsegment.ts?token=kept\n');}else res.end('fixture');});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>upstream.close(r)));
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'request',(url,options,cb)=>http.request(`http://127.0.0.1:${upstream.address().port}${url.pathname}${url.search}`,{...options,lookup:undefined},cb));
  const {services,dir}=await fixture(t);
  await services.startPlayback({session:'hls',candidate:{type:'hls',url:'https://example.com/folder/index.m3u8',headers:{Authorization:'token'}}});
  const args=JSON.parse(await readFile(join(dir,'mpv-log'),'utf8'));
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse),local=commands.find(m=>m.command[0]==='loadfile')?.command[1]??args.at(-1);
  const playlist=await (await fetch(local)).text(),key=/URI="([^"]+)"/.exec(playlist)[1],segment=playlist.trim().split('\n').at(-1);
  assert.ok(key.startsWith('http://127.0.0.1:'));assert.ok(segment.startsWith('http://127.0.0.1:'));
  await (await fetch(key)).text();await (await fetch(segment)).text();
  assert.deepEqual(seen,[{path:'/folder/index.m3u8',auth:'token'},{path:'/key',auth:undefined},{path:'/folder/segment.ts?token=kept',auth:'token'}]);
});

test('فشل callback الأحداث لا يمنع إنهاء العمليات وتنظيف ملفات التحميل',async t=>{
  const {dir,services:unused,binaries}=await fixture(t);await unused.close();
  const events=[];
  const services=createDesktopServices({userData:dir,binaries,dnsOverHttps:false,onEvent:event=>{events.push(event);if(event.type==='playback/closed')throw new Error('callback failed');}});
  t.after(()=>services.close());
  await services.startPlayback({session:'callback',candidate:{infoHash:hash,fileIdx:0}});
  const rq=JSON.parse(await readFile(join(dir,'rqbit-log'),'utf8'));
  await services.stopPlayback({session:'callback'});
  assert.throws(()=>process.kill(rq.pid,0),{code:'ESRCH'});
  const {readdir}=await import('node:fs/promises');const {cacheNamespace}=await import('./torrent-cache.mjs');
  await assert.rejects(readdir(join(dir,cacheNamespace(dir))),{code:'ENOENT'});
});

test('فشل mpv قبل الفيديو يطلق error واضحًا دون ready أو closed ناجح',async t=>{
  const {services,events,binaries}=await fixture(t);
  await writeFile(binaries.mpv,`#!${process.execPath}\nprocess.exit(2);`);
  await assert.rejects(services.startPlayback({session:'broken-player',candidate:{url:'https://example.com/owned.mp4'}}),/تعذر|أغلق/);
  assert.equal(events.filter(e=>e.type==='playback/error').length,1);
  assert.equal(events.filter(e=>e.type==='playback/ready'||e.type==='playback/closed').length,0);
});

test('file-loaded وtime-pos لا يكفيان لإعلان فيديو جاهز قبل playback-restart وإطار ذي أبعاد',async t=>{
  const {services,events}=await fixture(t,'not-decoded');
  await services.startPlayback({session:'not-decoded',candidate:{url:'https://example.com/clip.mp4'}});
  await new Promise(r=>setTimeout(r,60));
  assert.equal(events.filter(e=>e.type==='playback/ready').length,0);
});

test('مصدر صوت فقط لا يعلن ready ويقدم خطأ إطار الفيديو',async t=>{
  const {services,events}=await fixture(t,'audio-only');
  await services.startPlayback({session:'audio-only',candidate:{url:'https://example.com/audio.mp4'}});
  await new Promise(r=>setTimeout(r,60));
  assert.equal(events.filter(e=>e.type==='playback/ready').length,0);
  assert.ok(events.some(e=>e.type==='playback/error'&&e.message.includes('إطار فيديو')));
});

test('انقطاع upstream أثناء الفيديو ينهي النقل دون إسقاط عملية Node',async t=>{
  const {default:https}=await import('node:https'),{default:http}=await import('node:http'),{default:dns}=await import('node:dns/promises');
  const source=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'video/mp4','content-length':'10000'});res.write('owned partial fixture');setTimeout(()=>res.destroy(),25);});
  await new Promise(r=>source.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>source.close(r)));
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'request',(url,options,cb)=>http.request(`http://127.0.0.1:${source.address().port}${url.pathname}`,{...options,lookup:undefined},cb));
  const {services,dir}=await fixture(t);await services.startPlayback({session:'broken-stream',candidate:{url:'https://example.com/owned.mp4'}});
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse),url=commands.find(m=>m.command[0]==='loadfile').command[1];
  const response=await fetch(url,{signal:AbortSignal.timeout(500)});await assert.rejects(response.text(),/terminated/i);
  await services.playbackCommand({session:'broken-stream',command:'pause',value:true});
});

test('بيانات ملف 90GiB تتجاوز فحص المساحة دون تخصيص 90GiB؛ اختبار مبدئي لا يثبت كاش دائري',async t=>{
  const {dir,services,events}=await fixture(t,'oversize');
  await services.startPlayback({session:'big-metadata',candidate:{infoHash:hash,fileIdx:0}});
  assert.ok(events.some(event=>event.type==='playback/stage'&&event.stage==='file-selected'&&event.bytes===90*1024**3));
  const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(requests.some(r=>r.url.includes('only_files=0')),'large file should reach the torrent engine');
});
test('سياسة البث تتحقق من هامش آمن دون اشتراط مساحة ملف 90 GiB كاملة',()=>{
  const large=90*1024**3,reserve=512n*1024n**2n;
  assert.equal(validateTorrentStorage({length:large},reserve+1n),large);
  for(const length of [undefined,null,'200',0,-1,Infinity,Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>validateTorrentStorage({length},reserve+1n),/حجم.*غير/);
  assert.throws(()=>validateTorrentStorage({length:100},reserve-1n),/المساحة/);
  assert.equal(validateTorrentStorage({length:100},reserve),100);
});
test('الملف المجهول يُرفض قبل أي تنزيل أو تشغيل mpv',async t=>{
  const {services,events,dir}=await fixture(t,'unknown');
  await assert.rejects(services.startPlayback({session:'unknown',candidate:{infoHash:hash,fileIdx:0}}),/حجم.*غير/);
  const requests=(await readFile(join(dir,'requests'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(requests.some(r=>r.url.includes('list_only=true')));
  assert.ok(!requests.some(r=>r.url.includes('only_files=')));
  await assert.rejects(readFile(join(dir,'mpv-log')),{code:'ENOENT'});
  assert.ok(!events.some(e=>e.type==='playback/ready'));
});
test('اختيار الكاش يرفض مساحة منخفضة قبل POST ويعرض رسالة واضحة',async t=>{
  const {default:fs}=await import('node:fs/promises');
  t.mock.method(fs,'statfs',async()=>({bavail:1n,bsize:4096n}));
  const {services,events,dir}=await fixture(t);
  await assert.rejects(services.startPlayback({session:'no-space',candidate:{infoHash:hash,fileIdx:0}}),/مساحة/);
  await assert.rejects(readFile(join(dir,'mpv-log')),{code:'ENOENT'});
  assert.ok(events.some(e=>e.type==='playback/error'&&e.message.includes('مساحة')));
});

test('تهيئة العميل تنظف cache المتروك قبل تشغيل جديد ولا تمس بيانات المستخدم الأخرى',async t=>{
  const {dir,services:unused,binaries}=await fixture(t);await unused.close();
  const {mkdir,readdir}=await import('node:fs/promises');
  const stale=join(dir,'torrent-cache','a'.repeat(48));await mkdir(stale,{recursive:true});await writeFile(join(stale,'partial.mp4'),'owned stale fixture');
  await writeFile(join(dir,'user-preferences.json'),'keep');
  const services=createDesktopServices({userData:dir,binaries,dnsOverHttps:false});t.after(()=>services.close());
  await services.startPlayback({session:'after-crash',candidate:{infoHash:hash,fileIdx:0}});
  const {cacheNamespace}=await import('./torrent-cache.mjs');
  const entries=await readdir(join(dir,cacheNamespace(dir)));assert.equal(entries.length,1);assert.notEqual(entries[0],'a'.repeat(48));
  assert.equal(await readFile(join(dir,'user-preferences.json'),'utf8'),'keep');
});

test('ملف ترجمة مقبول SRT/VTT/ASS فقط، محدود دون HTML أو binary أو playlist',()=>{
  assert.equal(validateSubtitleText('1\n00:00:00,000 --> 00:00:02,000\nمرحبًا\n').extension,'srt');
  assert.equal(validateSubtitleText('WEBVTT\n\n00:00.000 --> 00:02.000\nمرحبا\n').extension,'vtt');
  assert.equal(validateSubtitleText('[Script Info]\nTitle: Owned\n[Events]\nDialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,مرحبا').extension,'ass');
  for(const text of ['<html>not subtitles</html>','#EXTM3U\nhttps://private.local','PK\u0003\u0004bytes','random text','x'.repeat(2*1024*1024+1),'1\n00:00:00,000 --> 00:00:02,000\nhi\u0000'])assert.throws(()=>validateSubtitleText(text),/ترجمة|الحد/);
});
async function subtitleSource(t,{slow=false,invalid=false,oversize=false,redirect=false,legacyArabic=false,utf16=false,declaredCharset=null}={}){
  const {default:https}=await import('node:https'),{default:http}=await import('node:http'),{default:dns}=await import('node:dns/promises');
  const body=utf16?Buffer.concat([Buffer.from([255,254]),Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nمرحبا\n','utf16le')]):legacyArabic?Buffer.concat([Buffer.from('1\n00:00:00,000 --> 00:00:02,000\n'),Buffer.from([0xe3,0xd1,0xcd,0xc8,0xc7])]):oversize?'x'.repeat(2*1024*1024+1):invalid?'<html>upstream failed</html>':'1\n00:00:00,000 --> 00:00:02,000\nترجمة مؤلفة\n';
  const source=http.createServer((req,res)=>{if(declaredCharset)res.setHeader('content-type','text/plain; charset='+declaredCharset);if(redirect&&req.url==='/redirect.srt'){res.writeHead(302,{location:redirect==='public'?'https://cdn.example.com/final.srt':'https://127.0.0.1/private'});return res.end();}if(slow)setTimeout(()=>res.end(body),150);else res.end(body);});await new Promise(r=>source.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>source.close(r)));t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'request',(url,options,cb)=>http.request(`http://127.0.0.1:${source.address().port}${url.pathname}`,{...options,lookup:undefined},cb));return body;
}
test('subtitle-load ينزل ملفًا محليًا محققًا ويفضل العربية ويتيح off/select/delay/size فقط',async t=>{
  const body=await subtitleSource(t),{services,dir,events}=await fixture(t);await services.startPlayback({session:'sub-control',candidate:{url:'https://video.example.com/owned.mp4'}});
  await services.playbackCommand({session:'sub-control',command:'subtitle-load',value:{url:'https://subs.example.com/english.srt',lang:'en',label:'English'}});
  await services.playbackCommand({session:'sub-control',command:'subtitle-load',value:{url:'https://subs.example.com/arabic.srt',lang:'ara',label:'عربية'}});
  await new Promise(r=>setTimeout(r,30));
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse),adds=commands.filter(m=>m.command[0]==='sub-add');
  assert.equal(adds.length,2);for(const item of adds){assert.ok(!item.command[1].startsWith('http'));assert.equal(await readFile(item.command[1],'utf8'),body);}assert.equal(adds[1].command[2],'select');
  assert.ok(events.some(e=>e.type==='playback/subtitles'&&e.tracks.some(track=>track.lang==='ar'&&track.selected)));
  await services.playbackCommand({session:'sub-control',command:'subtitle-off'});await services.playbackCommand({session:'sub-control',command:'subtitle-select',value:1});
  await services.playbackCommand({session:'sub-control',command:'subtitle-delay',value:1500});await services.playbackCommand({session:'sub-control',command:'subtitle-size',value:44});
  for(const [command,value] of [['subtitle-select',999],['subtitle-delay',60001],['subtitle-size',100],['loadfile','https://evil.example/']])await assert.rejects(services.playbackCommand({session:'sub-control',command,value}));
  await services.stopPlayback({session:'sub-control'});for(const item of adds)await assert.rejects(readFile(item.command[1]),{code:'ENOENT'});
});
test('provider results stay selectable without downloading every file or hiding the nineteenth result',async t=>{
  const {services,events,dir}=await fixture(t);await services.startPlayback({session:'catalog',candidate:{url:'https://video.example.com/owned.mp4'}});
  for(let i=0;i<19;i++)await services.playbackCommand({session:'catalog',command:'subtitle-register',value:{url:`https://subs.example.com/${i}.srt`,lang:'ar',label:`SubSense ${i}`}});
  const tracks=events.filter(e=>e.type==='playback/subtitles').at(-1).tracks;
  assert.equal(tracks.length,19);assert.ok(!JSON.stringify(tracks).includes('https:'));
  let commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(commands.filter(x=>x.command[0]==='sub-add').length,0);
  await subtitleSource(t);await services.playbackCommand({session:'catalog',command:'subtitle-select',value:tracks[18].id});
  commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);const adds=commands.filter(x=>x.command[0]==='sub-add');assert.equal(adds.length,1);assert.equal(adds[0].command[3],'SubSense 18');assert.equal(adds[0].command[2],'select');
});
test('retrying the same failed subtitle performs a new download while video stays open',async t=>{
  const {services,dir}=await fixture(t);await services.startPlayback({session:'subtitle-retry',candidate:{url:'https://video.example.com/owned.mp4'}});
  await subtitleSource(t,{invalid:true});const value={url:'https://subs.example.com/retry.srt',lang:'ar',select:true};
  await assert.rejects(services.playbackCommand({session:'subtitle-retry',command:'subtitle-load',value}),/ترجمة/);
  t.mock.restoreAll();await subtitleSource(t);await services.playbackCommand({session:'subtitle-retry',command:'subtitle-load',value});
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(commands.filter(x=>x.command[0]==='sub-add').length,1);assert.equal(commands.filter(x=>x.command[0]==='loadfile').length,1);
});
test('explicitly choosing another subtitle after eight keeps the native file limit and selected video',async t=>{
  await subtitleSource(t);const {services,events,dir}=await fixture(t);await services.startPlayback({session:'many-subs',candidate:{url:'https://video.example.com/owned.mp4'}});
  for(let i=0;i<19;i++){
    await services.playbackCommand({session:'many-subs',command:'subtitle-register',value:{url:`https://subs.example.com/choice-${i}.srt`,lang:'ar',label:`Choice ${i}`}});
    const choice=events.filter(e=>e.type==='playback/subtitles').at(-1).tracks.find(x=>x.label===`Choice ${i}`);
    await services.playbackCommand({session:'many-subs',command:'subtitle-select',value:choice.id});
  }
  const tracks=events.filter(e=>e.type==='playback/subtitles').at(-1).tracks;
  assert.equal(tracks.filter(x=>x.id>0).length,8);assert.equal(tracks.filter(x=>x.selected).length,1);assert.equal(tracks.find(x=>x.selected).label,'Choice 18');
  const evicted=tracks.find(x=>x.label==='Choice 0');assert.ok(evicted.id<0);
  await services.playbackCommand({session:'many-subs',command:'subtitle-select',value:evicted.id});
  assert.equal(events.filter(e=>e.type==='playback/subtitles').at(-1).tracks.find(x=>x.selected).label,'Choice 0');
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(commands.filter(x=>x.command[0]==='sub-remove').length,12);assert.equal(commands.filter(x=>x.command[0]==='loadfile').length,1);
});
test('turning subtitles off cancels a slow pending selection without selecting it or reporting a stale failure',async t=>{
  await subtitleSource(t,{slow:true});const {services,events,dir}=await fixture(t);await services.startPlayback({session:'subs-off',candidate:{url:'https://video.example.com/owned.mp4'}});
  const loading=services.playbackCommand({session:'subs-off',command:'subtitle-load',value:{url:'https://subs.example.com/slow.srt',lang:'ar',select:true}});const rejected=assert.rejects(loading);
  await new Promise(r=>setTimeout(r,20));await services.playbackCommand({session:'subs-off',command:'subtitle-off'});await rejected;
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(!commands.some(x=>x.command[0]==='sub-add'));assert.ok(!events.some(e=>e.type==='playback/subtitles'&&e.message));
});
test('a manual click on an already downloading subtitle selects it on the first click',async t=>{
  await subtitleSource(t,{slow:true});const {services,dir}=await fixture(t);
  const subtitle={url:'https://subs.example.com/shared.srt',lang:'ar',label:'العربية'};
  await services.startPlayback({session:'pending-choice',candidate:{url:'https://video.example.com/owned.mp4',subtitles:[subtitle]}});
  await new Promise(r=>setTimeout(r,20));
  await services.playbackCommand({session:'pending-choice',command:'subtitle-load',value:{...subtitle,select:true}});
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse),adds=commands.filter(x=>x.command[0]==='sub-add');
  assert.equal(adds.length,1);assert.equal(adds[0].command[2],'select');
});
test('rapidly returning to a canceled subtitle downloads it again and selects the latest choice',async t=>{
  await subtitleSource(t,{slow:true});const {services,events,dir}=await fixture(t);await services.startPlayback({session:'rapid-subs',candidate:{url:'https://video.example.com/owned.mp4'}});
  const a={url:'https://subs.example.com/a.srt',lang:'ar',label:'A',select:true},b={...a,url:'https://subs.example.com/b.srt',label:'B'};
  const first=services.playbackCommand({session:'rapid-subs',command:'subtitle-load',value:a});const rejected=assert.rejects(first);
  await new Promise(r=>setTimeout(r,20));const middle=services.playbackCommand({session:'rapid-subs',command:'subtitle-load',value:b});
  await services.playbackCommand({session:'rapid-subs',command:'subtitle-load',value:a});await middle;await rejected;
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse),adds=commands.filter(x=>x.command[0]==='sub-add');assert.equal(adds.length,1);assert.equal(adds[0].command[3],'A');assert.equal(adds[0].command[2],'select');assert.ok(!events.some(e=>e.type==='playback/subtitles'&&e.message));
});
test('subtitle غير صالح يفشل بلا قطع الفيديو ولا sub-add ولا ready وهمي',async t=>{
  await subtitleSource(t,{invalid:true});const {services,events,dir}=await fixture(t);await services.startPlayback({session:'bad-sub',candidate:{url:'https://video.example.com/owned.mp4'}});
  await assert.rejects(services.playbackCommand({session:'bad-sub',command:'subtitle-load',value:{url:'https://subs.example.com/error.srt',lang:'ar'}}),/ترجمة/);
  await services.playbackCommand({session:'bad-sub',command:'pause',value:true});
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(!commands.some(m=>m.command[0]==='sub-add'));
  assert.ok(events.some(e=>e.type==='playback/subtitles'&&e.message));assert.ok(!events.some(e=>e.type==='playback/error'));
});
test('تنزيل ترجمة متأخر لا يضاف لمشغل جديد يحمل نفس session',async t=>{
  await subtitleSource(t,{slow:true});const {services,dir}=await fixture(t);await services.startPlayback({session:'same-sub',candidate:{url:'https://video.example.com/first.mp4'}});
  const pending=services.playbackCommand({session:'same-sub',command:'subtitle-load',value:{url:'https://subs.example.com/late.srt',lang:'ar'}});const rejected=assert.rejects(pending);
  await new Promise(r=>setTimeout(r,20));await services.startPlayback({session:'same-sub',candidate:{url:'https://video.example.com/second.mp4'}});await rejected;await new Promise(r=>setTimeout(r,170));
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(!commands.some(m=>m.command[0]==='sub-add'));
});

test('ترجمات candidate تنزل في الخلفية بأولوية العربية دون تأخير startPlayback',async t=>{
  await subtitleSource(t,{slow:true});const {services,dir}=await fixture(t);
  await services.startPlayback({session:'embedded',candidate:{url:'https://video.example.com/owned.mp4',subtitles:[{url:'https://subs.example.com/en.srt',lang:'en'},{url:'https://subs.example.com/ar.srt',lang:'ar'}]}});
  let commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(!commands.some(m=>m.command[0]==='sub-add'));
  await new Promise(r=>setTimeout(r,380));commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);const adds=commands.filter(m=>m.command[0]==='sub-add');
  assert.equal(adds.length,2);assert.equal(adds[0].command[4],'ar');assert.equal(adds[0].command[2],'select');assert.equal(adds[1].command[2],'auto');
});
test('subtitle-load يرفض هدفًا داخليًا والتوجيه الداخلي والملف فوق 2MiB دون تمرير URL إلى mpv',async t=>{
  const {services,dir}=await fixture(t);await services.startPlayback({session:'sub-security',candidate:{url:'https://video.example.com/owned.mp4'}});
  await assert.rejects(services.playbackCommand({session:'sub-security',command:'subtitle-load',value:{url:'https://127.0.0.1/private.srt'}}),/ترجمة/);
  await subtitleSource(t,{oversize:true});await assert.rejects(services.playbackCommand({session:'sub-security',command:'subtitle-load',value:{url:'https://subs.example.com/large.srt'}}),/الحد/);
  t.mock.restoreAll();await subtitleSource(t,{redirect:true});await assert.rejects(services.playbackCommand({session:'sub-security',command:'subtitle-load',value:{url:'https://subs.example.com/redirect.srt'}}),/ترجمة/);
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(!commands.some(m=>m.command[0]==='sub-add'));
});

test('تنزيل ترجمة يتبع HTTPS CDN عام محققًا دون إعطاء رابط mpv',async t=>{
  const body=await subtitleSource(t,{redirect:'public'}),{services,dir}=await fixture(t);await services.startPlayback({session:'sub-cdn',candidate:{url:'https://video.example.com/owned.mp4'}});
  await services.playbackCommand({session:'sub-cdn',command:'subtitle-load',value:{url:'https://subs.example.com/redirect.srt',lang:'ar'}});
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse),add=commands.find(m=>m.command[0]==='sub-add');assert.ok(add);assert.equal(await readFile(add.command[1],'utf8'),body);assert.ok(!add.command[1].startsWith('http'));
});

test('حد 8 ترجمات يحجز للعربية نصف المسارات ولا يكرر تنزيل URL',async t=>{
  await subtitleSource(t);const {services,dir}=await fixture(t);await services.startPlayback({session:'subtitle-limit',candidate:{url:'https://video.example.com/owned.mp4'}});
  for(let i=0;i<4;i++)await services.playbackCommand({session:'subtitle-limit',command:'subtitle-load',value:{url:`https://subs.example.com/en-${i}.srt`,lang:'en'}});
  await assert.rejects(services.playbackCommand({session:'subtitle-limit',command:'subtitle-load',value:{url:'https://subs.example.com/en-excess.srt',lang:'en'}}),/الحد/);
  for(let i=0;i<4;i++)await services.playbackCommand({session:'subtitle-limit',command:'subtitle-load',value:{url:`https://subs.example.com/ar-${i}.srt`,lang:'ar'}});
  await services.playbackCommand({session:'subtitle-limit',command:'subtitle-load',value:{url:'https://subs.example.com/ar-0.srt',lang:'ar'}});
  await assert.rejects(services.playbackCommand({session:'subtitle-limit',command:'subtitle-load',value:{url:'https://subs.example.com/ar-excess.srt',lang:'ar'}}),/الحد/);
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(commands.filter(m=>m.command[0]==='sub-add').length,8);
});

test('MPV يبدأ pause=true ويصدر pause/seek/state ms ويقيد rate للغرفة',async t=>{
  const {services,events,dir}=await fixture(t);await services.startPlayback({session:'room',candidate:{url:'https://video.example.com/owned.mp4'},pause:true});await new Promise(r=>setTimeout(r,30));
  const args=JSON.parse(await readFile(join(dir,'mpv-log'),'utf8'));assert.ok(args.includes('--pause=yes'));
  assert.ok(events.some(e=>e.type==='playback/state'&&e.paused===true&&e.position===2000&&e.duration===60000));
  await services.playbackCommand({session:'room',command:'pause',value:false});await services.playbackCommand({session:'room',command:'seek',value:4500});await new Promise(r=>setTimeout(r,30));
  assert.ok(events.some(e=>e.type==='playback/pause'&&e.paused===false));assert.ok(events.some(e=>e.type==='playback/seek'&&e.position===4500));
  assert.ok(events.some(e=>e.type==='playback/progress'&&e.paused===false&&e.buffering===false));
  await services.playbackCommand({session:'room',command:'rate',value:0.95});await services.playbackCommand({session:'room',command:'rate',value:1.05});
  for(const value of [0.94,1.06,'1',Infinity])await assert.rejects(services.playbackCommand({session:'room',command:'rate',value}));
  const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(commands.some(m=>JSON.stringify(m.command)==='["set_property","speed",0.95]'));
});

test('manual speed, fit and subtitle position are constrained MPV properties',async t=>{
 const {services,dir}=await fixture(t);await services.startPlayback({session:'appearance',candidate:{url:'https://video.example.com/owned.mp4'}});
 for(const [command,value] of [['speed',1.5],['video-fit','fill'],['subtitle-position',85]])await services.playbackCommand({session:'appearance',command,value});
 for(const [command,value] of [['speed',0],['speed',Infinity],['video-fit','arbitrary'],['subtitle-position',101]])await assert.rejects(services.playbackCommand({session:'appearance',command,value}));
 const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse).map(m=>m.command);
 for(const expected of [['set_property','speed',1.5],['set_property','panscan',1],['set_property','sub-pos',85]])assert.ok(commands.some(c=>JSON.stringify(c)===JSON.stringify(expected)));
});

test('Arabic subtitle downloads decode legacy1256 and honor UTF16 BOM without changing non-Arabic validation',async t=>{
 const {dir,services}=await fixture(t);await services.startPlayback({session:'arabic-encoding',candidate:{url:'https://video.example.com/owned.mp4'}});
 await subtitleSource(t,{legacyArabic:true});
 await assert.rejects(services.playbackCommand({session:'arabic-encoding',command:'subtitle-load',value:{url:'https://subs.example.com/non-arabic.srt',lang:'en'}}),/UTF-8/);
 await services.playbackCommand({session:'arabic-encoding',command:'subtitle-load',value:{url:'https://subs.example.com/arabic.srt',lang:'ar'}});
 await subtitleSource(t,{legacyArabic:true,declaredCharset:'windows-1256'});
 await services.playbackCommand({session:'arabic-encoding',command:'subtitle-load',value:{url:'https://subs.example.com/declared.srt',lang:'en'}});
 await subtitleSource(t,{utf16:true,declaredCharset:'windows-1256'});
 await services.playbackCommand({session:'arabic-encoding',command:'subtitle-load',value:{url:'https://subs.example.com/utf16.srt',lang:'ar'}});
 const commands=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse);const subs=commands.filter(x=>x.command[0]==='sub-add');assert.equal(subs.length,3);for(const sub of subs){const text=await readFile(sub.command[1],'utf8');assert.match(text,/مرحبا/);assert.ok(!text.includes('\uFFFD'));}
});

test('first Arabic provider result loads and selects itself; English and a user choice never auto-load',async t=>{
  await subtitleSource(t);const {services,events,dir}=await fixture(t);await services.startPlayback({session:'auto-ar',candidate:{url:'https://video.example.com/owned.mp4'}});
  await services.playbackCommand({session:'auto-ar',command:'subtitle-register',value:{url:'https://subs.example.com/en.srt',lang:'en',label:'English'}});
  await services.playbackCommand({session:'auto-ar',command:'subtitle-register',value:{url:'https://subs.example.com/ar1.srt',lang:'ar',label:'SubDL ar'}});
  await services.playbackCommand({session:'auto-ar',command:'subtitle-register',value:{url:'https://subs.example.com/ar2.srt',lang:'ar',label:'SubSense ar'}});
  await new Promise(r=>setTimeout(r,80));
  const adds=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse).filter(x=>x.command[0]==='sub-add');
  assert.equal(adds.length,1);assert.equal(adds[0].command[3],'SubDL ar');assert.equal(adds[0].command[2],'select');
  assert.ok(events.filter(e=>e.type==='playback/subtitles').at(-1).tracks.some(x=>x.selected&&x.lang==='ar'));
});
test('a broken Arabic result is skipped quietly for the next one',async t=>{
  const {services,events,dir}=await fixture(t);await services.startPlayback({session:'auto-skip',candidate:{url:'https://video.example.com/owned.mp4'}});
  await subtitleSource(t,{invalid:true});
  await services.playbackCommand({session:'auto-skip',command:'subtitle-register',value:{url:'https://subs.example.com/bad.srt',lang:'ar',label:'bad'}});
  await new Promise(r=>setTimeout(r,80));t.mock.restoreAll();await subtitleSource(t);
  await services.playbackCommand({session:'auto-skip',command:'subtitle-register',value:{url:'https://subs.example.com/good.srt',lang:'ar',label:'good'}});
  await new Promise(r=>setTimeout(r,80));
  const adds=(await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse).filter(x=>x.command[0]==='sub-add');
  assert.equal(adds.length,1);assert.equal(adds[0].command[3],'good');assert.ok(!events.some(e=>e.type==='playback/subtitles'&&e.message));
});
test('subtitles off before an Arabic result arrives stays off',async t=>{
  await subtitleSource(t);const {services,dir}=await fixture(t);await services.startPlayback({session:'auto-off',candidate:{url:'https://video.example.com/owned.mp4'}});
  await services.playbackCommand({session:'auto-off',command:'subtitle-off'});
  await services.playbackCommand({session:'auto-off',command:'subtitle-register',value:{url:'https://subs.example.com/ar.srt',lang:'ar',label:'ar'}});
  await new Promise(r=>setTimeout(r,80));
  assert.equal((await readFile(join(dir,'commands'),'utf8')).trim().split('\n').map(JSON.parse).filter(x=>x.command[0]==='sub-add').length,0);
});
