const http=require('http'),fs=require('fs'),path=require('path');
// Run with PLAYWRIGHT_MODULE and CHROMIUM_PATH when not installed locally.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../apps/web');
const assert=require('node:assert/strict');
const html=`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/v35/reader.css"><style>*{box-sizing:border-box}body{margin:0}</style><script type="module">
import {openSmartReader} from '/v35/reader.js';import{readingPosition}from'/v35/reader-scroll.js';
const guest=location.search.includes('guest');window.imageGate=new Promise(r=>window.releaseImage=r);const events=new Map();window.commands=[];let seq=0;
const room={isHost:!guest,me:guest?'guest':'host',status:'live',info:{mode:'sync'},clock:{serverNow:()=>performance.now()},timeline:{media:{key:'manga:fixture#1',kind:'manga'},started:true,playing:true,pos:0,seq:0,at:0},report(){},command(kind,data){if(kind==='seek'||kind==='load')window.commands.push({kind,...data,at:performance.now(),seq:++seq});},on(e,fn){const s=events.get(e)||new Set();s.add(fn);events.set(e,s);return()=>s.delete(fn)}};
window.receive=m=>{room.timeline={...room.timeline,pos:m.pos,at:m.at,seq:m.seq,...(m.media?{media:m.media}:{})};for(const f of events.get('state')||[])f({state:room.timeline,by:'host'})};
const rows=[1,2].map(number=>({number,sourceId:'same',chapter:{url:'chapter-'+number,name:'chapter '+number}}));
const engine={pages:async()=>Array.from({length:12},(_,index)=>({index})),pageImage:async(_,p)=>{if(!guest&&p.index===0)await window.imageGate;const h=[6000,800,4000,1600][p.index%4];return {src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="'+h+'"><rect width="100%" height="100%" fill="'+(p.index%2?'skyblue':'salmon')+'"/><text x="10" y="100" font-size="50">PAGE '+p.index+'</text></svg>')}}};
const sync={user:{userId:room.me},rows:()=>[],enqueue(){}};const hub={session:{room,mode:'sync',media:{kind:'manga',seriesRef:'fixture'}},useSurface:()=>()=>{},mountStrip:()=>()=>{}};
window.reader=openSmartReader({sync,engine,together:hub,mount:n=>document.body.append(n),exit(){}},{title:'Fixture',seriesRef:'fixture',rows,row:rows[0],sourceLocked:true});
window.sample=()=>{const s=document.querySelector('.rd-scroll'),frames=[...document.querySelectorAll('.rd-page')].slice(0,12);return{y:s.scrollTop,pos:readingPosition(frames,s.getBoundingClientRect().top),chapter:document.querySelector('#rdChapter').textContent,heights:frames.slice(0,4).map(f=>f.getBoundingClientRect().height),imgs:document.querySelectorAll('.rd-page img').length}};window.ready=true;
</script>`;
const server=http.createServer((req,res)=>{const url=req.url.split('?')[0];if(url==='/'){res.setHeader('content-type','text/html');return res.end(html)}try{const f=path.join(root,url);res.setHeader('content-type',url.endsWith('.js')?'text/javascript':url.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(f))}catch{res.statusCode=404;res.end()}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const host=await browser.newPage({viewport:{width:412,height:900}}),guest=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];for(const page of[host,guest])page.on('pageerror',e=>errors.push(e.message));
  const base='http://127.0.0.1:'+server.address().port;
  await Promise.all([host.goto(base),guest.goto(base+'/?guest')]);
  await Promise.all([host.waitForFunction(()=>window.ready),guest.waitForFunction(()=>window.ready)]);
  await guest.waitForFunction(()=>document.querySelectorAll('.rd-page img').length>=12);
  let sent=0;
  const relay=async()=>{
   const commands=await host.evaluate(start=>window.commands.slice(start),sent);sent+=commands.length;
   for(const c of commands)await guest.evaluate(c=>window.receive(c),c);
  };
  const frames=async(n=1)=>{for(let i=0;i<n;i++){await relay();await host.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())));}};
  for(let i=1;i<=30;i++){await host.evaluate(y=>document.querySelector('.rd-scroll').scrollTop=y,i*7);await frames();}
  await frames(15);
  const pending=await host.evaluate(()=>window.commands.at(-1)?.pos??0);
  assert.equal(pending,0,'unloaded placeholder geometry must not drive the guest into a decoded tall image');
  await host.evaluate(()=>window.releaseImage());
  await host.waitForFunction(()=>document.querySelectorAll('.rd-page img').length>=12);
  await frames(30);
  const aligned=async(label)=>{
   const h=await host.evaluate(()=>window.sample()),g=await guest.evaluate(()=>window.sample());
   assert.ok(Math.abs(h.pos-g.pos)<.002,`${label}: host ${h.pos}, guest ${g.pos}`);
   console.log(`PASS ${label}: host=${h.pos.toFixed(4)}, guest=${g.pos.toFixed(4)}`);
   return {h,g};
  };
  await aligned('image decode republishes the actual within-page anchor');
  const before=await aligned('initial join settles');
  for(let i=1;i<=30;i++){await host.evaluate(y=>document.querySelector('.rd-scroll').scrollTop=y,210+i*7);await frames();}
  await frames(25);
  const after=await aligned('small downward scrolling across different viewport widths');
  assert.ok(Math.abs((after.g.y-before.g.y)/(after.h.y-before.h.y)-390/412)<.03,'guest movement scales with image width, never amplifies a small scroll');
  await host.evaluate(()=>document.querySelector('.rd-scroll').scrollTop=140);await frames(30);
  await aligned('upward scroll stops at the same content');
  await host.evaluate(()=>document.querySelector('.rd-scroll').scrollTop=4000);await frames(40);
  await aligned('crossing images retains the same fractional page');
  assert.deepEqual(errors,[]);
  console.log('PASS no reader page errors');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
