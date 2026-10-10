/** Real Chrome, production player/UI and room protocol. Requires playwright and ws. */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {RoomCore} from '../../services/sync-worker/src/together-core.ts';
import {createBrowserBackend} from './browser-fetch-service.mjs';
import {witanime} from '../../apps/web/pwa/sources/engines/witanime.js';
import {useLinkedom} from './live-fetcher.mjs';
const requireDeps = root=>createRequire(root ? `${root}/package.json` : import.meta.url);
const {chromium}=requireDeps(process.env.BROWSER_MODULE_ROOT)('playwright');
const {WebSocketServer}=requireDeps(process.env.WS_MODULE_ROOT)('ws');
const output=resolve(process.env.TEST_OUTPUT ?? 'work/together-browser');await mkdir(output,{recursive:true});
const fixture=await readFile('android/app/src/androidTest/assets/addon-torrent-proof.mp4');
const room=RoomCore.create({code:'ABCDEF',hostUserId:'host',cap:10,mode:'sync',control:'host',createdAt:Date.now(),allowed:['guest','late']},{key:'anime:42#1',kind:'anime',label:'Fixture episode 1'},Date.now());
const sockets=new Map();let next=0;
let nativeSnapshot=null;const nativeActions=[];
const android=process.argv.includes('--android');
const adb=process.env.ADB ?? 'adb';
const adbRun=(...args)=>execFileSync(adb,args,{encoding:'utf8'});
function send(out){for(const o of out){if(o.close){sockets.get(o.close)?.close(o.code,o.reason);continue;}for(const [id,s] of sockets)if(s.readyState===1 && id!==o.except && (o.to==='all'||o.to.includes(id)))s.send(JSON.stringify(o.msg));}}
const html=`<!doctype html><html dir="rtl"><head><link rel="stylesheet" href="/v35/together.css"></head><body><script type="module">
import {createTogether,readerBridge} from '/v35/together.js';
import {openPlayer} from '/pwa/player/player.js';
import {openSmartReader} from '/v35/reader.js';
const user=new URLSearchParams(location.search).get('user')||'host';
const sync={authorizationHeader:'Bearer '+user,user:{userId:user},rows:()=>[],enqueue:()=>{}};
const hub=createTogether({sync,baseUrl:()=>location.origin,avatarNode:p=>{const n=document.createElement('span');n.textContent=p.displayName?.slice(0,1);return n;},toast:console.log,openMedia:()=>{},openSheet:()=>{},closeSheet:()=>{}});
window.hub=hub;window.errors=[];
window.launch=()=>{
 hub.joinByCode('ABCDEF',{media_json:JSON.stringify({seriesRef:'anime:42',key:'anime:42#1',kind:'anime'}),mode:'sync'});
 const cand={id:'fixture',route:'fixture',url:location.origin+'/fixture.mp4',type:'mp4',code:'Local '+user,sourceId:'test',server:'fixture'};
 const session={cands:new Map([['fixture',cand]]),done:true};
 window.player=openPlayer({title:'Together real video test',episode:1,total:2,session:'fixture',candidate:'fixture',section:'anime',minRealDuration:1,copies:[{sourceId:'test',url:'/fixture',title:'Fixture'}],together:hub.handOff('anime:42'),runtime:{ensureMedia:async()=>{},fetcher:{mediaUrl:u=>u}},engine:{closeSession:async()=>{},best:async()=>({candidate:'fixture'}),prepare:async()=>({session:'fixture',copies:[{sourceId:'test',url:'/fixture',title:'Fixture'}]})},sessionOf:()=>session,readyCandidates:()=>[cand],emit:()=>{}});
};
window.read=()=>{
 hub.joinByCode('READ01',{media_json:JSON.stringify({seriesRef:'manga:test',key:'manga:test#1',kind:'manga'}),mode:'sync'});
 const rows=[1,2].map(number=>({number,sourceId:'test',manga:{url:'/test',title:'test'},chapter:{url:'/chapter/'+number,name:'Chapter '+number,number}}));
 const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="4000"><rect width="800" height="4000" fill="#554070"/><text x="100" y="400" fill="white" font-size="70">Reading test</text></svg>');
 window.reader=openSmartReader({sync,together:hub,engine:{pages:async()=>[0,1,2].map(index=>({index,imageUrl:svg,url:svg})),pageImage:async()=>({src:svg})},mount:n=>{n.style.position='fixed';n.style.inset='0';document.body.append(n);},exit:()=>{}},{seriesRef:'manga:test',title:'Reading',rows,row:rows[0],work:{}});
};
window.ready=true;
</script></body></html>`;
const reading=RoomCore.create({...room.settings,code:'READ01'},{key:'manga:test#1',kind:'manga',label:'Reading'},Date.now());
const cores=new Map();
const server=createServer(async(req,res)=>{
 try{
  if(req.url==='/native'&&req.method==='POST'){let data='';for await(const chunk of req)data+=chunk;nativeSnapshot={...JSON.parse(data),receivedAt:Date.now()};res.setHeader('content-type','application/json');res.end(JSON.stringify({actions:nativeActions.splice(0)}));return;}
  if(req.url?.startsWith('/harness')){res.setHeader('content-type','text/html');res.end(html);return;}
  if(req.url==='/fixture.mp4'){
   const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range??'');const start=m?Number(m[1]):0;const end=m&&m[2]?Math.min(fixture.length-1,Number(m[2])):fixture.length-1;
   res.writeHead(m?206:200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':end-start+1,...(m?{'content-range':`bytes ${start}-${end}/${fixture.length}`}:{})});res.end(fixture.subarray(start,end+1));return;
  }
  const path=resolve('apps/web','.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(resolve('apps/web')+'/')&&!path.startsWith(resolve('apps/web')+'\\'))throw Error('path');
  res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]??'text/plain');res.end(await readFile(path));
 }catch{res.writeHead(404);res.end();}
});
const wss=new WebSocketServer({server,handleProtocols:()=> 'vantara.together'});
wss.on('connection',(socket,req)=>{const id=String(++next),user=(req.headers['sec-websocket-protocol']??'').split(',').map(s=>s.trim()).find(s=>s.startsWith('bearer.'))?.slice(7)??req.headers.authorization?.replace(/^Bearer\s+/,'');const core=req.url.includes('READ01')?reading:room;
 sockets.set(id,socket);cores.set(id,core);send(core.join({conn:id,userId:user,name:user,avatarKey:null},Date.now()));
 socket.on('message',raw=>send(core.handle(id,JSON.parse(raw),Date.now())));socket.on('close',()=>{sockets.delete(id);cores.delete(id);send(core.leave(id,Date.now()));});});
// Each core sends only to its own connections.
const originalSend=send;send=out=>{for(const o of out){if(o.close){originalSend([o]);continue;}const core=o.msg.room?.code==='READ01'||o.msg.state?.media?.kind==='manga'?reading:null;originalSend([{...o,to:o.to==='all'&&core?[...cores].filter(([,c])=>c===core).map(([id])=>id):o.to}]);}};
// Broadcast messages without media are separated using the originating core.
for(const core of [room,reading]){for(const name of ['join','handle','leave','tick']){const fn=core[name].bind(core);core[name]=(...a)=>{const result=fn(...a);const out=Array.isArray(result)?result:result.out;for(const o of out)if(o.to==='all')o.to=[...cores].filter(([,c])=>c===core).map(([id])=>id);return result;};}}
const timer=setInterval(()=>{send(room.tick(Date.now()).out);send(reading.tick(Date.now()).out);},200);
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome',args:['--autoplay-policy=no-user-gesture-required']});
const errors=[],results={};let backend;
try{
 const context=await browser.newContext({viewport:{width:1280,height:720}}),mobile=await browser.newContext({viewport:{width:390,height:844}});
 const host=await context.newPage(),guest=await mobile.newPage();
 for(const p of [host,guest])p.on('pageerror',e=>errors.push(e.message));
 const launch=async(p,user,method='launch')=>{await p.goto(base+'/harness?user='+user);await p.waitForFunction(()=>window.ready);await p.evaluate(m=>window[m](),method);};
 if(android){
  await launch(host,'host');
  adbRun('shell','am','force-stop','com.vantara.proof');
  adbRun('shell','am','start','-n','com.vantara.proof/.ProofActivity','--es','base',base.replace('127.0.0.1','10.0.2.2'),'--es','user','guest');
  const wait=async(check,ms=20000)=>{const start=Date.now();while(!check()){if(Date.now()-start>ms)throw Error('native condition timed out: '+JSON.stringify(nativeSnapshot));await host.waitForTimeout(150);}};
  await wait(()=>room.roster(Date.now()).length===2&&room.roster(Date.now()).every(r=>r.state==='ready'));
  await wait(()=>nativeSnapshot?.ready&&!nativeSnapshot.playing&&nativeSnapshot.pos<100);
  await host.locator('.pp-together').click();assert.equal(await host.locator('.tg-row').count(),2);await host.screenshot({path:resolve(output,'desktop-android-room.png')});
  // Device wall clocks need not match. Extrapolate a native sample from receipt time;
  // uncertainty is one local HTTP transit, not the emulator's system-clock offset.
  const sample=async()=>{const web=await host.locator('video').evaluate(v=>({pos:v.currentTime*1000,at:Date.now(),playing:!v.paused}));const n=nativeSnapshot;results.deviceWallClockOffsetMs=n.receivedAt-n.at;return Math.abs(web.pos-(n.pos+(n.playing?web.at-n.receivedAt:0)));};
  await host.evaluate(()=>hub.session.room.command('play',{pos:0}));await wait(()=>nativeSnapshot?.playing&&nativeSnapshot?.width>0);await host.waitForTimeout(900);
  const drifts=[];for(let i=0;i<5;i++){drifts.push(await sample());await host.waitForTimeout(150);}results.desktopHostAndroidGuest={samplesMs:drifts,maxMs:Math.max(...drifts)};assert.ok(Math.max(...drifts)<500);
  await host.evaluate(()=>hub.session.room.command('pause',{pos:1500}));await host.waitForTimeout(900);assert.equal(nativeSnapshot.playing,false);results.crossPauseDriftMs=await sample();assert.ok(results.crossPauseDriftMs<200);
  await host.evaluate(()=>hub.session.room.command('seek',{pos:500}));await host.waitForTimeout(900);results.crossSeekDriftMs=await sample();assert.ok(results.crossSeekDriftMs<200);
  await host.evaluate(()=>hub.session.room.giveHost('guest'));await wait(()=>nativeSnapshot.host);
  nativeActions.push({op:'play'});await wait(()=>room.timeline.playing);await host.waitForTimeout(1200);results.androidHostDesktopGuestDriftMs=await sample();assert.ok(results.androidHostDesktopGuestDriftMs<1000);
  nativeActions.push({op:'pause'});await wait(()=>!room.timeline.playing);await host.waitForTimeout(900);results.androidHostPauseDriftMs=await sample();assert.ok(results.androidHostPauseDriftMs<200);
  nativeActions.push({op:'seek',pos:1000});await host.waitForTimeout(1000);results.androidHostSeekDriftMs=await sample();assert.ok(results.androidHostSeekDriftMs<200);
  const nativeId=[...room.members].find(([,m])=>m.userId==='guest')[0];sockets.get(nativeId).close(1012,'test restart');await wait(()=>[...room.members].some(([id,m])=>m.userId==='guest'&&id!==nativeId));await host.waitForTimeout(600);results.androidReconnectDriftMs=await sample();assert.ok(results.androidReconnectDriftMs<200);
  nativeActions.push({op:'load'});await wait(()=>nativeSnapshot.episode===2&&room.timeline.media.key.endsWith('#2')&&room.timeline.started,25000);await host.waitForTimeout(900);results.androidNextEpisodeDriftMs=await sample();assert.ok(results.androidNextEpisodeDriftMs<500);
  adbRun('shell','am','force-stop','com.vantara.proof');await host.evaluate(()=>player.close());await wait(()=>room.members.size===0);results.noOrphans=true;
 } else {
 await launch(host,'host');await launch(guest,'guest');
 for(const p of [host,guest])await p.waitForFunction(()=>hub.session?.room.roster.length===2&&hub.session.room.roster.every(r=>r.state==='ready'),{timeout:20000});
 await host.locator('.pp-together').click();assert.equal(await host.locator('.tg-row').count(),2);await host.screenshot({path:resolve(output,'desktop-room.png')});
 // Close the real player sheet then start from the lobby button.
 await host.locator('.pp-sheet-backdrop').evaluate(n=>n.click()).catch(()=>{});
 await host.evaluate(()=>hub.session.room.command('play',{pos:0}));await host.waitForTimeout(1700);
 const sample=async()=>{const times=await Promise.all([host,guest].map(p=>p.locator('video').evaluate(v=>v.currentTime)));return Math.abs(times[0]-times[1])*1000;};
 const drift=[];for(let i=0;i<6;i++){drift.push(await sample());await host.waitForTimeout(250);}results.videoDriftMs={samples:drift,max:Math.max(...drift)};assert.ok(Math.max(...drift)<800,'real player drift over 800ms');
 await host.evaluate(()=>hub.session.room.command('pause',{pos:2000}));await host.waitForTimeout(950);for(const p of [host,guest])assert.equal(await p.locator('video').evaluate(v=>v.paused),true);
 await host.evaluate(()=>hub.session.room.command('seek',{pos:1000}));await host.waitForTimeout(950);results.pausedSeekDriftMs=await sample();assert.ok(results.pausedSeekDriftMs<120);
 const late=await context.newPage();await launch(late,'late');await late.waitForFunction(()=>hub.session.room.roster.find(r=>r.userId==='late')?.state==='paused',{timeout:20000});assert.ok(Math.abs(await late.locator('video').evaluate(v=>v.currentTime)-1)<.15);results.lateJoin=true;
 const guestId=[...room.members].find(([,m])=>m.userId==='guest')[0];sockets.get(guestId).close(1012,'test restart');await guest.waitForFunction(()=>hub.session.room.status==='reconnecting');await guest.waitForFunction(()=>hub.session.room.status==='live',{timeout:10000});results.reconnect=true;
 await host.evaluate(()=>hub.session.room.setMode('free'));await guest.waitForFunction(()=>hub.session.room.info.mode==='free');await guest.locator('video').evaluate(v=>v.currentTime=2);await guest.waitForTimeout(800);assert.ok(await guest.locator('video').evaluate(v=>v.currentTime)>1.9);results.separate=true;
 await host.evaluate(()=>hub.session.room.setMode('sync'));await guest.waitForFunction(()=>hub.session.room.info.mode==='sync');await host.waitForTimeout(800);
 await host.evaluate(()=>hub.session.room.command('load',{media:{key:'anime:42#2',kind:'anime',label:'Episode 2'},pos:0}));await guest.waitForFunction(()=>hub.session.room.timeline.media.key.endsWith('#2'));await guest.waitForTimeout(1800);results.nextEpisode=await guest.locator('video').evaluate(v=>v.readyState>=3);
 await guest.screenshot({path:resolve(output,'mobile-room.png')});
 for(const p of [host,guest,late])await p.evaluate(()=>player.close());await host.waitForTimeout(300);assert.equal(room.members.size,0);results.noOrphans=true;
 await launch(host,'host','read');await launch(guest,'guest','read');
 await host.addStyleTag({url:base+'/v35/reader.css'});await guest.addStyleTag({url:base+'/v35/reader.css'});
 for(const p of [host,guest])await p.waitForFunction(()=>document.querySelector('#rdScroll')?.scrollHeight>3000,{timeout:10000});
 await host.locator('#rdScroll').evaluate(n=>n.scrollTop=700);await host.waitForTimeout(1000);
 const anchor=async(p)=>p.evaluate(()=>{const s=document.querySelector('#rdScroll');const f=s.querySelector('.rd-page');return {top:s.scrollTop,height:f?.getBoundingClientRect().height,pos:hub.session.room.timeline.pos};});
 results.reading=await Promise.all([host,guest].map(anchor));assert.ok(reading.timeline.pos>0&&reading.timeline.pos<1,'within-page fractional scroll');
 await host.locator('#rdScroll').evaluate(n=>n.scrollTop=300);await host.waitForTimeout(1000);assert.ok(reading.timeline.pos<results.reading[0].pos);results.upward=true;
 for(const top of [360,420,490,580]){await host.locator('#rdScroll').evaluate((n,top)=>n.scrollTop=top,top);await host.waitForTimeout(130);}
 await host.waitForTimeout(500);const current=reading.timeline.pos;assert.ok(current>0&&current<1);results.slowWithinPage=true;
 await launch(late,'late','read');await late.addStyleTag({url:base+'/v35/reader.css'});await late.waitForTimeout(1100);
 const fraction=async(p)=>p.evaluate(()=>{const s=document.querySelector('#rdScroll'),f=s.querySelector('.rd-page');return s.scrollTop/f.getBoundingClientRect().height;});
 assert.ok(Math.abs(await fraction(late)-current)<.02);results.readingLateJoin=true;
 await host.evaluate(()=>hub.session.room.setMode('free'));await guest.waitForFunction(()=>hub.session.room.info.mode==='free');const before=await fraction(guest);await host.locator('#rdScroll').evaluate(n=>n.scrollTop=900);await host.waitForTimeout(800);assert.ok(Math.abs(await fraction(guest)-before)<.005);results.readingSeparate=true;
 await host.evaluate(()=>hub.session.room.setMode('sync'));await host.waitForTimeout(800);assert.ok(Math.abs(await fraction(guest)-reading.timeline.pos)<.02);
 await guest.locator('.rd-page').first().evaluate(n=>n.style.height='2700px');await guest.waitForTimeout(900);assert.ok(Math.abs(await fraction(guest)-reading.timeline.pos)<.02);results.readingResize=true;
 await host.screenshot({path:resolve(output,'desktop-reader.png')});
 for(const p of [host,guest,late])await p.evaluate(()=>{reader.destroy();reader.root.remove();hub.leave();});await host.waitForTimeout(350);assert.equal(reading.members.size,0);results.readerNoOrphans=true;
 if (process.argv.includes('--sources')) {
 useLinkedom();backend=await createBrowserBackend({browser,secret:'test-browser-secret-at-least-32-characters'});
 const session='a'.repeat(64);const fetchPage=async(url,opts={})=>{const r=await backend.fetchPage({url,session,method:opts.method??(opts.body!==undefined?'POST':'GET'),body:opts.body,headers:{...opts.headers, ...(opts.xhr?{'x-requested-with':'XMLHttpRequest'}:{}),...(opts.referer?{referer:opts.referer}:{})},follow:opts.follow!==false});await writeFile(resolve(output,'source-last.html'),r.text);console.log(JSON.stringify({sourceURL:url,status:r.status,bytes:r.text.length}));if(r.status>=400)throw Error('source HTTP '+r.status);return r;};
 const engine=witanime.create({id:'witanime',domain:'witanime.site'},{fetch:{page:fetchPage,text:fetchPage},hosts:{resolve:async u=>[{url:u}]}});
 const items=await engine.search('black clover');results.wit={search:items.length};assert.ok(items.length>0);const work=items.find(i=>i.url==='/anime/black-clover')??items[0];const eps=await engine.episodes(work);results.wit.episodes=eps.length;assert.ok(eps.length>0);const servers=await engine.servers(eps[0]);results.wit.servers=servers.length;assert.ok(servers.length>0);
 }
 assert.deepEqual(errors,[]);results.errors=errors;
 }
}finally{if(android)adbRun('shell','am','force-stop','com.vantara.proof');await backend?.close();await browser.close();clearInterval(timer);for(const s of sockets.values())s.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));await writeFile(resolve(output,android?'android-results.json':'results.json'),JSON.stringify({...results,errors},null,2));}
console.log(JSON.stringify(results,null,2));
