/** Production anime image scheduling under controlled local responses.
 * VANTARA_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium
 * BASELINE=1 WIDTH=390 DPR=2 OUT=/path/before.json node tools/repository-compat/anime-image-performance.mjs
 * Omit BASELINE for current working files. WIDTH=1440 DPR=1 measures desktop layout.
 * STYLES, IMG_DELAY_MS, ZIP_DELAY_MS, HD_DELAY_MS and RAW_OUT are optional.
 * This tool does not publish, install a service worker, or represent native device measurements.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
const playwrightModule = process.env.VANTARA_PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwrightModule.startsWith('/') ? pathToFileURL(playwrightModule).href : playwrightModule);
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const repo=path.resolve(process.env.VANTARA_UI_ROOT || fileURLToPath(new URL('../..', import.meta.url)));
const root=path.join(repo,'apps/web');
const requests=[];
const width=Number(process.env.WIDTH||390), dpr=Number(process.env.DPR||2);
const imgDelay=Number(process.env.IMG_DELAY_MS||220), zipDelay=Number(process.env.ZIP_DELAY_MS||1500), hdDelay=Number(process.env.HD_DELAY_MS||900);
const baseline=process.env.BASELINE==='1';
const baselineRef=process.env.BASE_REF||'9da9ac0b1b8af1b7013e37da036c46419866e8fb';
const saved=new Map();
if(baseline){const {execFileSync}=await import('node:child_process');for(const p of ['v35/anime.js','v35/work-looks.js','lib/anime-art.js','lib/together/art.js'])saved.set('/'+p,execFileSync('git',['show',baselineRef+':apps/web/'+p],{cwd:repo}));}
const tracked=['v35/anime.js','v35/work-looks.js','v35/work-dom.js','v35/anime-episode-controls.js','v35/anime-episodes.js','v35/anime.css','v35/anime-episodes.css','lib/anime-art.js','lib/together/art.js'];
const fingerprints=async()=>Object.fromEntries(await Promise.all(tracked.map(async p=>[p,createHash('sha256').update(saved.get('/'+p)??await fs.readFile(path.join(root,p))).digest('hex')])));
const startedInputs=await fingerprints();
const svg=(w,h)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#94694b"/><text x="40" y="90" font-size="70">Image audit ${w}</text></svg>`;
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/audit-img/')) {requests.push({url:u.pathname,at:Date.now()}); await new Promise(r=>setTimeout(r,imgDelay));res.setHeader('Cache-Control','public,max-age=86400');res.setHeader('Content-Type','image/svg+xml');const name=decodeURIComponent(u.pathname);const sized=Number(/\/w(\d+)\.jpg$/.exec(name)?.[1]);const w=sized||(name.includes('cover-small')?300:name.includes('cover')?800:name.includes('tvdb')?640:name.includes('/logo/')?680:1920);const h=name.includes('cover')?w*1.5:name.includes('/logo/')?240:name.includes('banner')?400:w*9/16;res.end(svg(w,h));return;}
 if(u.pathname==='/audit') {res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><link rel="stylesheet" href="/v35/core.css"><link rel="stylesheet" href="/v35.css"><link rel="stylesheet" href="/v35/anime.css"><link rel="stylesheet" href="/v35/anime-episodes.css"><link rel="stylesheet" href="/v35/wide.css"></head><body class="v35"><main><section id="anime"></section><section id="animeLibrary"></section><section id="animeDiscover"></section><section id="animeCollection"></section></main></body></html>`);return;}
 try {const p=path.join(root,u.pathname);const d=saved.get(u.pathname)??await fs.readFile(p);res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/plain');res.end(d);}catch {res.statusCode=404;res.end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});
const results=[];
for(const style of (process.env.STYLES||'core,platform,card,screen,episode').split(',')) {
 const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:dpr});const page=await context.newPage();const unexpected=[];const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('request',r=>{if(r.url().startsWith('https:'))unexpected.push(r.url());});
 await page.goto(base+'/audit');
 await page.evaluate(async ({style,base,zipDelay,hdDelay})=>{
  localStorage.clear();localStorage.setItem('vantara.appearance.v1',JSON.stringify({style:{anime:style},accent:{},pureBlack:false}));
  const orig=fetch;window.apiCalls=[];window.events=[];window.start=performance.now();
  window.fetch=async(u,opts)=>{
   const s=String(u);window.apiCalls.push({url:s,at:performance.now()-start});
   if(s.startsWith('https://api.ani.zip')) {await new Promise(r=>setTimeout(r,zipDelay));return new Response(JSON.stringify({mappings:{imdb_id:'tt7654321'},episodes:Object.fromEntries(Array.from({length:60},(_,i)=>[i+1,{image:base+'/audit-img/tvdb-'+(i+1),seasonNumber:1,episodeNumber:i+1,airDate:'2025-01-'+String(i%28+1).padStart(2,'0'),title:{en:'Ep '+(i+1)}}]))}));}
   if(s.includes('v3-cinemeta.strem.io/meta/')) {await new Promise(r=>setTimeout(r,hdDelay));return new Response(JSON.stringify({meta:{videos:Array.from({length:60},(_,i)=>({season:1,episode:i+1,released:'2025-01-'+String(i%28+1).padStart(2,'0'),thumbnail:'https://episodes.metahub.space/tt7654321/1/'+(i+1)+'/w780.jpg'}))}}));}
   if(s.startsWith('https://graphql.anilist')) return new Response(JSON.stringify({data:{}}));
   if(s.startsWith('https://')) return new Response('{}',{status:404});return orig(u,opts);
  };
  // Keep real image requests/cache while translating remote art to deterministic local files.
  const NativeImage=Image;window.Image=function(){const im=new NativeImage();im.addEventListener('load',()=>{if(/aw-bg-img/.test(im.className)){events.push({type:'hero-load',src:im.currentSrc,cls:im.className,at:performance.now()-start});}});return im;};let heroNode=null;const seenVisible=new WeakMap();function frame(){for(const im of document.querySelectorAll('#anime img')){const r=im.getBoundingClientRect(),cs=getComputedStyle(im);if(seenVisible.get(im)!==im.currentSrc&&im.complete&&im.naturalWidth&&r.width&&r.height&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&cs.visibility!=='hidden'&&Number(cs.opacity)>0.01){seenVisible.set(im,im.currentSrc);events.push({type:'image-visible',src:im.currentSrc,cls:im.className,at:performance.now()-start,visible:true,width:r.width,naturalWidth:im.naturalWidth,ep:im.closest('[data-ep]')?.dataset.ep??null});}}const im=document.querySelector('.aw-bg-img.in');if(im&&im!==heroNode){heroNode=im;events.push({type:'hero-visible',src:im.currentSrc,cls:im.className,at:performance.now()-start,visible:true});}requestAnimationFrame(frame);}requestAnimationFrame(frame);
  const localArt=value=>String(value).replace(/https:\/\/(?:images|episodes)\.metahub\.space\/[A-Za-z0-9_./:%?=+#~-]+/g,u=>base+'/audit-img/'+encodeURIComponent(u));
  const htmlDesc=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');Object.defineProperty(Element.prototype,'innerHTML',{get:htmlDesc.get,set(v){htmlDesc.set.call(this,localArt(v));}});
  const nativeSetProperty=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(k,v,p){return nativeSetProperty.call(this,k,localArt(v),p);};
  const nativeAttr=Element.prototype.setAttribute;Element.prototype.setAttribute=function(k,v){return nativeAttr.call(this,k,this instanceof HTMLImageElement&&k.toLowerCase()==='src'?localArt(v):v);};
  const desc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{get:desc.get,set(v){desc.set.call(this,String(v).startsWith('https://')?base+'/audit-img/'+encodeURIComponent(v):v);}});
  const m={id:9876543,title:'Audit anime',poster:base+'/audit-img/cover',posterSmall:base+'/audit-img/cover-small',banner:base+'/audit-img/banner',aired:60,episodes:60,duration:24,status:'FINISHED',_sourceCopy:true};
  const mod=await import('/v35/anime.js');const main=document.querySelector('main');const el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n;};
  window.anime=mod.createAnime({root:main,q:id=>document.getElementById(id),el,toast(){},genreAr:s=>s,openSheet(){},closeSheet(){},showPage(){},currentPage:()=> 'anime',sync:{user:null,rows:()=>[],enqueue(){}}});window.media=m;
  document.addEventListener('load',e=>{if(e.target instanceof HTMLImageElement){const im=e.target;events.push({type:'load',src:im.currentSrc,cls:im.className,at:performance.now()-start,visible:!!(im.offsetWidth&&im.offsetHeight&&im.getBoundingClientRect().top<innerHeight)});}},true);
  window.start=performance.now();await anime.openAnime(m);
 },{style,base,zipDelay,hdDelay});
 await page.waitForTimeout(6500);
 const cold=await page.evaluate(()=>({api:apiCalls,events,imgs:document.querySelectorAll('img').length,shown:[...document.querySelectorAll('img')].filter(i=>i.complete&&i.naturalWidth&&i.offsetWidth&&i.offsetHeight&&i.getBoundingClientRect().top<innerHeight).map(i=>({src:i.currentSrc,cls:i.className}))}));
 const serverCold=requests.splice(0);
 await page.evaluate(async()=>{events=[];apiCalls=[];start=performance.now();await anime.openAnime(media);});await page.waitForTimeout(2000);
 const warm=await page.evaluate(()=>({api:apiCalls,events}));const serverWarm=requests.splice(0);
 results.push({style,unexpected,errors,cold,warm,network:{cold:serverCold,warm:serverWarm}});await context.close();
}
const source = raw => decodeURIComponent(String(raw).replace(base+'/audit-img/',''));
const round = n => Math.round(n*10)/10;
const kind = raw => {const u=source(raw);return u.includes('episodes.metahub')?'hd-still':u.includes('tvdb-')?'tvdb-still':u.includes('/background/')?'backdrop':u.includes('/logo/')?'logo':u.includes('cover')?'cover':'banner';};
const summarize = (phase, network) => {
 const visible=phase.events.filter(e=>e.type==='image-visible');
 const first=predicate=>{const e=visible.find(predicate);return e?{ms:round(e.at),src:source(e.src),displayWidth:round(e.width),naturalWidth:e.naturalWidth}:null;};
 const byKind={};for(const request of network){const k=kind(request.url);byKind[k]=(byKind[k]||0)+1;}
 return {requests:network.length,byKind,api:phase.api.map(e=>({url:e.url,ms:round(e.at)})),firstCover:first(e=>e.src.includes('cover')),firstStill:first(e=>/tvdb-|episodes.metahub/.test(decodeURIComponent(e.src))),firstLogo:first(e=>decodeURIComponent(e.src).includes('/logo/')),heroes:phase.events.filter(e=>e.type==='image-visible'&&e.cls.includes('aw-bg-img')).map(e=>({ms:round(e.at),src:source(e.src),displayWidth:round(e.width),naturalWidth:e.naturalWidth})),visibleImageChanges:visible.length};
};
const endedInputs=await fingerprints();
const inputs={start:startedInputs,end:endedInputs,changedDuringRun:JSON.stringify(startedInputs)!==JSON.stringify(endedInputs)};
const report={inputs,mode:baseline?'before':'after',baselineRef:baseline?baselineRef:null,viewport:{width,height:844,dpr},delays:{imgDelay,zipDelay,hdDelay},method:'Production createAnime, controlled metadata delays, real HTTP-cacheable SVG image fixtures; current CSS in both runs. Not a provider benchmark or native/PWA-device test.',styles:results.map(r=>({style:r.style,unexpected:r.unexpected,errors:r.errors,cold:summarize(r.cold,r.network.cold),warm:summarize(r.warm,r.network.warm)}))};
const out=path.resolve(process.env.OUT||`anime-image-${baseline?'before':'after'}-${width}.json`);
await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
if(process.env.RAW_OUT)await fs.writeFile(process.env.RAW_OUT,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(report.styles.map(r=>({style:r.style,cold:r.cold.requests,warm:r.warm.requests,firstHero:r.cold.heroes[0]?.ms,finalHero:r.cold.heroes.at(-1)?.ms,unexpected:r.unexpected.length,errors:r.errors.length})),null,2));
await browser.close();server.close();
if(inputs.changedDuringRun||report.styles.some(r=>r.unexpected.length||r.errors.length))process.exitCode=1;
