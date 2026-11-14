// قياس وميض شاشة الغرفة في ويندوز ببيانات حقيقية: Bleach (AniList 269) بغلافه الحقيقي، والفن يُحسم بـresolveArt
// الحقيقي من ani.zip. الرسّام والمنسّق من كود الإنتاج (desktop/player.js + together-player.js)، والمحرك وحده محاكى.
// يسجّل كل تبدّل في صورة الخلفية، وفي العلامة (اسم ↔ شعار)، وكل رجوع لامتلاء الشعار، بزمنه من فتح الغرفة.
// node tools/together/lobby-flicker.cjs  (يحتاج شبكة إلى api.ani.zip وs4.anilist.co)
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/node-tools/node_modules/playwright');
const root=path.resolve(__dirname,'../../apps/web'),out=process.env.SHOTS||'/tmp/vantara-lobby-flicker';fs.mkdirSync(out,{recursive:true});
const COVER='https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx269-d2GmRkJbMopq.png';
const html=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>body{margin:0;background:#000}</style><link rel="stylesheet" href="/v35/core.css"><script type="module">
import{installDesktopPlayer}from'/desktop/player.js';import{createDesktopTogetherPlayer}from'/desktop/together-player.js';
const media={kind:'anime',seriesRef:'anime:269',episode:1,key:'anime:269#1',title:'Bleach',cover:${JSON.stringify(COVER)},label:'Bleach — الحلقة 1'};
const listeners=new Map(),nativeListeners=[],roomListeners=new Map();let coordinator;
const emit=(n,e)=>{for(const f of listeners.get(n)||[])f(e)};
const room={status:'live',isHost:true,canControl:true,me:'host',info:{mode:'sync',invited:['host','friend']},roster:[{userId:'host',name:'أنا',host:true,state:'preparing'}],clock:{serverNow:()=>Date.now()},timeline:{media,started:false,playing:false,pos:0,at:Date.now(),seq:0},report(){},on(n,fn){const a=roomListeners.get(n)||new Set();a.add(fn);roomListeners.set(n,a);return()=>a.delete(fn)},command(){}};
const session={room,media,invited:['friend'],mode:'sync',code:'FLICK'};
const hub={session,person:id=>({userId:id,displayName:'صديق',avatarKey:null}),avatar(p){const s=document.createElement('span');s.textContent=(p.displayName||'؟')[0];return s},leave(){},openPanel(){},onChange:()=>()=>{},useSurface:()=>()=>{}};
const bridge={onEvent:fn=>{nativeListeners.push(fn);return()=>{}},playerViewport:async()=>true,playerFullscreen:async x=>x,stopPlayback:async()=>{},playbackCommand:async()=>{}};
const push=e=>{for(const f of nativeListeners)f(e)};
const engine={addListener(n,fn){const a=listeners.get(n)||new Set();a.add(fn);listeners.set(n,a);return{remove:()=>a.delete(fn)}},roomHub:()=>hub,
  playerState:async()=>({title:'Bleach',section:'anime',media,episode:1,poster:media.cover,together:true,videoOffsetMs:0}),routes:async()=>({routes:[],done:true}),closeSession:async()=>{}};
installDesktopPlayer({bridge,engine});
window.t0=performance.now();window.log=[];
const note=(k,v)=>window.log.push({ms:Math.round(performance.now()-window.t0),k,v});
new MutationObserver(()=>{
  const bg=document.querySelector('.desktop-player .pl-bg img');const src=bg?.getAttribute('src')||null;if(src!==window.lastBg){window.lastBg=src;note('خلفية',src&&src.split('/').pop().slice(0,40));}
  const mark=document.querySelector('.desktop-player .pl-mark .pl-fill');const m=mark?(mark.tagName==='IMG'?'شعار':'اسم'):null;if(m!==window.lastMark){window.lastMark=m;note('علامة',m);}
  const clip=mark?.style.clipPath;const p=clip?100-Number(/inset\\(0 ([\\d.]+)%/.exec(clip)?.[1]??100):null;if(p!=null&&window.lastP!=null&&p<window.lastP-1)note('الامتلاء رجع',window.lastP+'→'+p);if(p!=null)window.lastP=p;
}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src','style']});
coordinator=createDesktopTogetherPlayer({together:{hub,session,mediaPrefix:'anime:269'},bridge,session:'s1',episode:()=>1,onLobby:e=>emit('desktopTogether',{session:'s1',media,...e})});
push({type:'playback/preparing',session:'s1',title:'Bleach'});
setTimeout(()=>{push({type:'playback/ready',session:'s1'});coordinator.ready();note('أول إطار','');},4000);
window.ready=true;
</script></html>`;
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://x').pathname;if(u==='/'){res.setHeader('content-type','text/html');return res.end(html)}try{res.setHeader('content-type',u.endsWith('.js')?'text/javascript':u.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(path.join(root,u)))}catch{res.statusCode=404;res.end()}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.VANTARA_CHROMIUM||'/opt/pw-browsers/chromium'});
try{const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
for(const ms of [300,1500,4500,7000]){await page.waitForTimeout(ms-(ms===300?0:0));}
await page.screenshot({path:path.join(out,'lobby.png')});
const log=await page.evaluate(()=>window.log);console.log(JSON.stringify(log,null,0));if(errors.length)console.log('أخطاء الصفحة:',errors);
const bgChanges=log.filter(x=>x.k==='خلفية'&&x.v).length,markChanges=log.filter(x=>x.k==='علامة'&&x.v).length,drops=log.filter(x=>x.k==='الامتلاء رجع').length;
console.log(`تبدّل الخلفية: ${bgChanges} · تبدّل العلامة: ${markChanges} · رجوع الامتلاء: ${drops}`);
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
