/** Local Chromium QA for the real createAnime work page. No deployment or external writes.
 * VANTARA_ANIME_UI_CASES=card:390:rtl (optional comma list) narrows a diagnostic run.
 * VANTARA_ANIME_UI_PHASE=after (optional) skips baseline captures.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root=path.resolve(process.env.VANTARA_UI_ROOT||process.cwd());
const output=path.resolve(process.env.VANTARA_ANIME_UI_EVIDENCE||'/workspace/evidence/anime-detail-20261104');
const artwork=process.env.VANTARA_ANIME_UI_ART||'/workspace/evidence/visual-ui-20261103';
const baseline=process.env.VANTARA_ANIME_UI_BASELINE||'9da9ac0b';
const accent=process.env.VANTARA_ANIME_UI_ACCENT||'gold';
const playwright=process.env.VANTARA_PLAYWRIGHT_MODULE||'/workspace/vantara-browser-qa/node_modules/playwright/index.mjs';
const {chromium}=await import(path.isAbsolute(playwright)?pathToFileURL(playwright).href:playwright);
const run=promisify(execFile),cache=new Map(),evidence={baseline,cases:[],errors:[]};
await mkdir(output,{recursive:true});
const art=Object.fromEntries(await Promise.all(['logo','poster','background'].map(async k=>[k,await readFile(path.join(artwork,k+'.img'))])));
const contentTypes={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};

function html(phase,style,dir){
 const prefix='/'+phase;
 const css=['styles.css','v35/core.css','v35.css','v35/anime.css',...(phase==='after'?['v35/anime-episodes.css']:[]),'v35/server-sheet.css','v35/wide.css'];
 return `<!doctype html><html lang="ar" dir="${dir}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 ${css.map(file=>`<link rel="stylesheet" href="${prefix}/${file}">`).join('')}
 <style>@font-face{font-family:'Vantara Sans';src:url('/after/fonts/Inter-Latin.var.woff2') format('woff2');font-weight:100 900;unicode-range:U+0000-024F}@font-face{font-family:'Vantara Sans';src:url('/after/fonts/NotoSansArabic.var.woff2') format('woff2');font-weight:100 900;unicode-range:U+0600-06FF,U+0750-077F,U+08A0-08FF}body{margin:0}.qa-sheet{position:fixed;inset:20% 10% auto;max-height:70vh;overflow:auto;background:#18161f;z-index:1000;padding:20px;border-radius:20px}.qa-sheet:empty{display:none}</style>
 <div id="root" class="v35" data-section="anime"><main class="app"><section id="anime" class="page active"></section><section id="animeLibrary" hidden></section><section id="animeDiscover" hidden></section><section id="animeCollection" hidden></section></main><aside class="qa-sheet" id="dialog"></aside></div>
 <script type="module">
 import{createAnime,recordWatch,readWatch}from'${prefix}/v35/anime.js';
 import{applyAppearance}from'${prefix}/v35/appearance.js';
 localStorage.clear();localStorage.setItem('vantara.appearance.v1',JSON.stringify({style:{anime:'${style}'},accent:{anime:'${accent}'}}));
 const root=document.getElementById('root'),dialog=document.getElementById('dialog');
 applyAppearance('anime',[root,document.documentElement]);
 const id=120377,thumbs=Object.fromEntries(Array.from({length:1000},(_,i)=>[i+1,{title:'Shared voyage '+(i+1),thumbnail:'/qa-background'}]));
 const art={imdb:'tt12590266',fanart:'/qa-background',episodes:Object.fromEntries(Object.entries(thumbs).map(([n,e])=>[n,{title:e.title,image:'/qa-background'}]))};
 localStorage.setItem('vantara.tgart.az4-'+id,JSON.stringify({at:Date.now(),data:art}));
 const m={id,title:'Cyberpunk: Edgerunners',romaji:'Cyberpunk: Edgerunners',format:'ONA',status:'FINISHED',episodes:1000,aired:1000,duration:24,season:'FALL',year:2022,score:8.3,color:'#c9a227',poster:'/qa-poster',posterSmall:'/qa-poster',banner:'/qa-background',genres:['Action','Drama','Sci-Fi'],studio:'Trigger',description:'Night City. قصة العمل كما تظهر في صفحة الأنمي.',characters:[],relations:[],recommendations:[],thumbs,_sourceCopy:{sourceId:'qa',url:'/cyberpunk'}};
 for(let n=1;n<10;n++)recordWatch(m,n,1440000,1440000);recordWatch(m,10,60000,1440000);
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
 const anime=createAnime({root,q:id=>root.querySelector('#'+id),el,toast:()=>{},genreAr:g=>({Action:'أكشن',Drama:'دراما','Sci-Fi':'خيال علمي'}[g]||g),openSheet:build=>{dialog.replaceChildren();build(dialog)},closeSheet:()=>dialog.replaceChildren(),showPage:()=>{},goBack:()=>{},currentPage:()=> 'anime',sync:{user:null,rows:()=>[],enqueue:()=>{}}});
 window.fixture={anime,m,readWatch};await anime.openAnime(m);await document.fonts.ready;window.fixtureReady=true;
 </script></html>`;
}

async function source(phase,file){
 const target=path.resolve(root,'apps/web',file);assert.ok(target.startsWith(path.resolve(root,'apps/web')+path.sep));
 if(phase==='after')return readFile(target);
 const key=phase+file;if(cache.has(key))return cache.get(key);
 const result=Buffer.from((await run('git',['show',`${baseline}:apps/web/${file}`],{cwd:root,encoding:'buffer',maxBuffer:10*1024*1024})).stdout);cache.set(key,result);return result;
}
const server=createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://local'),parts=url.pathname.split('/').filter(Boolean);
  if(parts[0]==='qa'){res.setHeader('content-type','text/html');return res.end(html(url.searchParams.get('phase')||'after',url.searchParams.get('style')||'card',url.searchParams.get('dir')||'rtl'))}
  if(url.pathname.startsWith('/qa-')){const kind=url.pathname.slice(4);res.setHeader('content-type',kind==='logo'?'image/png':'image/jpeg');res.setHeader('access-control-allow-origin','*');return res.end(art[kind])}
  const phase=parts.shift();if(!['before','after'].includes(phase))throw Error('route');const file=parts.join('/');
  res.setHeader('content-type',contentTypes[path.extname(file)]||'application/octet-stream');res.end(await source(phase,file));
 }catch{res.statusCode=404;res.end('not found')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.VANTARA_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const requested=(process.env.VANTARA_ANIME_UI_CASES||'').split(',').filter(Boolean);
const cases=['core','platform','card','screen','episode'].flatMap(style=>[360,390,430,1440].flatMap(width=>['rtl','ltr'].map(dir=>({style,width,dir,key:[style,width,dir].join(':')})))).filter(c=>!requested.length||requested.includes(c.key));
const topSelector={core:'.aw-cover',platform:'.wl-aside .wl-cover',card:'.wl-stage3d .wl-card',screen:'.wl-top .wl-cover',episode:'.wl-series'};
async function facts(page,style){return page.evaluate(({style,cover})=>{
 const box=selector=>{const n=document.querySelector(selector);if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
 const node=document.querySelector(cover),shade=document.querySelector('.aw-shade');
 return{viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,app:box('.app'),hero:box('.aw-hero'),cover:box(cover),coverShadow:node?getComputedStyle(node).boxShadow:null,coverFilter:node?getComputedStyle(node).filter:null,shade:shade?getComputedStyle(shade).backgroundImage:null,rows:document.querySelectorAll('[data-episode-row]').length,controls:box('.aw-episode-controls'),style};
 },{style,cover:topSelector[style]});}
async function pauseTop(page){await page.evaluate(()=>{for(const animation of document.getAnimations()){if(animation.timeline instanceof DocumentTimeline&&animation.effect?.target?.closest?.('.aw-hero,.wl-head,.wl-headrow,.wl-top,.wl-stage3d,.wl-logo-layer')){animation.pause();animation.currentTime=1600}}});}
async function action(page,label){await page.locator('.aw-episode-controls [aria-label="الترتيب والتصفية"]').click();await page.locator('#dialog button').filter({hasText:label}).click();}
async function rowNumbers(page){return page.locator('[data-episode-row]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.ep)));}

try{
 for(const test of cases){
  const {style,width,dir,key}=test,row={...test,phases:{}};
  for(const phase of process.env.VANTARA_ANIME_UI_PHASE?[process.env.VANTARA_ANIME_UI_PHASE]:['before','after']){
   row.phases[phase]={};
   const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1,isMobile:width<700,hasTouch:width<700});
   const page=await context.newPage();const pageErrors=[];
   page.on('pageerror',error=>pageErrors.push(String(error)));
   await page.route('https://**/*',async route=>{
    const url=route.request().url();if(url.includes('images.metahub.space/')){const kind=url.includes('/logo/')?'logo':url.includes('/poster/')?'poster':'background';return route.fulfill({status:200,body:art[kind],contentType:kind==='logo'?'image/png':'image/jpeg',headers:{'access-control-allow-origin':'*'}})}
    return route.fulfill({status:404,body:'{}',contentType:'application/json',headers:{'access-control-allow-origin':'*'}});
   });
   try{
    await page.goto(origin+`/qa?phase=${phase}&style=${style}&dir=${dir}`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.fixtureReady,{timeout:15000});
    await page.waitForFunction(()=>document.querySelector('.aw-bg-img')?.complete||document.querySelector('.aw-still img')?.complete,{timeout:5000});
    if(style==='card')await page.waitForFunction(()=>document.querySelector('.wl-logo-layer')?.dataset.ready==='true',{timeout:5000});
    await pauseTop(page);await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(60);
    const initial=await facts(page,style);row.phases[phase]={initial};
    await page.screenshot({path:path.join(output,`${phase}-${style}-${width}-${dir}-top.png`)});
    if(phase==='after'){
     if(style==='core'){
      const preview=page.locator('.aw-still');
      await preview.scrollIntoViewIfNeeded();
      const optical=await page.locator('.aw-still-play').evaluate(button=>{
       const svg=button.querySelector('svg'),circle=button.getBoundingClientRect(),icon=svg.getBoundingClientRect();
       return{accent:getComputedStyle(button).backgroundColor,transform:getComputedStyle(svg).transform,circle:{width:circle.width,height:circle.height},svgCenterOffset:{x:icon.x+icon.width/2-circle.x-circle.width/2,y:icon.y+icon.height/2-circle.y-circle.height/2},preview:button.closest('.aw-still').getBoundingClientRect().toJSON()};
      });
      assert.equal(optical.transform,'none',key+' no extra SVG optical shift');
      assert.equal(optical.circle.width,optical.circle.height,key+' stable round preview button');
      assert.ok(Math.abs(optical.svgCenterOffset.x)<.5&&Math.abs(optical.svgCenterOffset.y)<.5,key+' SVG centered in preview circle');
      await preview.screenshot({path:path.join(output,`${phase}-${style}-${width}-${dir}-${accent}-preview.png`)});
      await page.locator('.aw-still-play').screenshot({path:path.join(output,`${phase}-${style}-${width}-${dir}-${accent}-play.png`)});
      row.phases.after.optical=optical;
     }
     assert.equal(initial.pageWidth,width,key+' page overflow');assert.ok(initial.app.width<=width,key+' app bound');
     assert.ok(initial.rows<= (style==='core'?50:25),key+' initial row bound');
     await page.evaluate(cover=>{window.retained={cover:document.querySelector(cover+' img'),hero:document.querySelector('.aw-bg img:last-of-type'),logo:document.querySelector('.wl-logo-layer'),animations:document.querySelector('.wl-logo-layer')?.getAnimations({subtree:true})??[]}},topSelector[style]);
     await action(page,'الأحدث أولًا');assert.equal((await rowNumbers(page))[0],1000,key+' global descending');
     await action(page,'أخفِ ما شاهدته');
     const input=page.locator('.aw-episode-controls input[type="search"]');
     await page.locator('.aw-episode-controls [aria-label="ابحث في الحلقات"]').first().click();
     await page.evaluate(()=>{window.retained.input=document.querySelector('.aw-episode-controls input');window.retained.rowImage=document.querySelector('[data-episode-row][data-ep="1000"] img')});
     await input.fill('Shared voyage');await page.waitForTimeout(260);
     assert.equal(await input.evaluate(node=>document.activeElement===node),true,key+' search update retains typing focus');
     assert.equal((await rowNumbers(page))[0],1000,key+' name search order');
     assert.ok((await rowNumbers(page)).length<=(style==='core'?50:25),key+' bounded name search');
     // Synthetic activation leaves the typing focus in place so that the update
     // itself, rather than normal pointer focus transfer, is what we measure.
     await page.evaluate(()=>{document.querySelector('.aw-episode-controls [aria-label="الترتيب والتصفية"]').click();[...document.querySelectorAll('#dialog button')].find(b=>b.textContent.trim()==='أخفِ ما شاهدته').click()});
     assert.equal(await input.evaluate(node=>document.activeElement===node),true,key+' filter update retains typing focus');
     for(let i=0;i<2;i++){
      await page.evaluate(()=>{const row=document.querySelector('[data-episode-row][data-ep="1000"]');const mark=row.querySelector('.an-er-icon');if(mark)mark.click();else{row.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));row.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));document.querySelector('#dialog button[aria-pressed]').click()}});
      assert.equal(await input.evaluate(node=>document.activeElement===node),true,key+' manual row update retains typing focus');
     }
     await page.evaluate(()=>{document.querySelector('.aw-episode-controls [aria-label="الترتيب والتصفية"]').click();[...document.querySelectorAll('#dialog button')].find(b=>b.textContent.trim()==='أخفِ ما شاهدته').click()});
     assert.equal(await input.evaluate(node=>document.activeElement===node),true,key+' restored filter retains typing focus');
     const retained=await page.evaluate(cover=>({input:document.querySelector('.aw-episode-controls input')===window.retained.input,cover:document.querySelector(cover+' img')===window.retained.cover,hero:document.querySelector('.aw-bg img:last-of-type')===window.retained.hero,rowImage:document.querySelector('[data-episode-row][data-ep="1000"] img')===window.retained.rowImage,logo:document.querySelector('.wl-logo-layer')===window.retained.logo,animation:!window.retained.logo||window.retained.animations.every(a=>window.retained.logo.getAnimations({subtree:true}).includes(a))}),topSelector[style]);
     assert.ok(Object.values(retained).every(Boolean),key+' retained DOM '+JSON.stringify(retained));row.phases.after.retained={...retained,typingFocus:true};
     const groups=page.locator('[data-episode-page]');await groups.last().click();
     const finalNumbers=await rowNumbers(page);assert.ok(finalNumbers.includes(10),key+' last filtered group reaches lowest unseen');assert.ok(finalNumbers.every(n=>n>=10),key+' hides all seen');
     const reachable=await groups.last().evaluate(node=>{const a=node.getBoundingClientRect(),b=node.parentElement.getBoundingClientRect();return{visible:a.left>=b.left-1&&a.right<=b.right+1,railWidth:b.width,viewport:innerWidth,offset:node.parentElement.scrollLeft}});
     assert.ok(reachable.visible,key+' last group horizontally reachable');assert.ok(reachable.railWidth<=width,key+' group rail bound');row.phases.after.reachable=reachable;
     await input.fill('١٠٠٠');await page.waitForTimeout(260);assert.deepEqual(await rowNumbers(page),[1000],key+' exact Arabic search');
     await page.locator('.aw-episode-controls').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${phase}-${style}-${width}-${dir}-episodes.png`)});
     assert.equal((await facts(page,style)).pageWidth,width,key+' overflow after updates');
    }else{
     const section=page.locator(style==='core'?'.aw-episodes':'.wl-sec').filter({hasText:'الحلقات'}).first();
     if(await section.count())await section.scrollIntoViewIfNeeded();
     await page.screenshot({path:path.join(output,`${phase}-${style}-${width}-${dir}-episodes.png`)});
    }
    assert.deepEqual(pageErrors,[],key+' browser errors');
   }catch(error){row.phases[phase].failure=String(error);evidence.errors.push({key,phase,error:String(error)});await page.screenshot({path:path.join(output,`failure-${phase}-${style}-${width}-${dir}.png`)});}
   finally{await context.close()}
  }
  const before=row.phases.before?.initial,after=row.phases.after?.initial;
  if(before&&after){row.composition={hero:before.hero&&after.hero?['x','y','width','height'].every(k=>Math.abs(before.hero[k]-after.hero[k])<1):null,coverGeometry:before.cover&&after.cover?['x','y','width','height'].every(k=>Math.abs(before.cover[k]-after.cover[k])<1):null,coverShadow:before.coverShadow===after.coverShadow,coverFilter:before.coverFilter===after.coverFilter,shade:before.shade===after.shade};
   if(!Object.values(row.composition).every(v=>v!==false))evidence.errors.push({key,error:'Baseline composition changed',comparison:row.composition});}
  evidence.cases.push(row);await writeFile(path.join(output,'measurements.json'),JSON.stringify(evidence,null,2));console.log(key+' '+JSON.stringify(row.composition||row.phases.after?.retained||{}));
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({cases:evidence.cases.length,errors:evidence.errors.length,evidence:path.join(output,'measurements.json')}));
if(evidence.errors.length)process.exitCode=1;
