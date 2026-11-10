import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const baselineFiles=new Set(['v35/shell.js','v35/page-motion.js','v35/motion.js','v35/unified-view.css','v35/core.css','v35/cinema.js']);
const fileCache=new Map();
const modulePath=process.env.VANTARA_PLAYWRIGHT_MODULE||'/workspace/vantara-browser-qa/node_modules/playwright/index.mjs';
const {chromium}=await import(path.isAbsolute(modulePath)?pathToFileURL(modulePath).href:modulePath);
const repo=process.argv[2]||process.cwd();
const phase=process.env.WORK_MOTION_PHASE||'after';
const root=path.join(repo,'apps/web'),out=process.env.VANTARA_UI_EVIDENCE||'/workspace/evidence/work-motion-20261108/'+phase;await mkdir(out,{recursive:true});
const css=['styles.css','v35/unified-view.css','v35/core.css','v35.css','v35/reader.css','v35/majlis.css','v35/social.css','v35/profile.css','v35/anime.css','v35/cinema.css','v35/server-sheet.css','v35/manga.css','v35/rafiq.css','v35/wide.css','v35/addons.css','v35/addons-v7.css','v35/together.css'];
const server=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p==='/qa-poster'){try{const b=await readFile(process.env.VANTARA_WORK_MOTION_POSTER||'/workspace/evidence/visual-ui-20261103/poster.img');res.setHeader('Content-Type','image/jpeg');return res.end(b)}catch{res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#28354a"/><circle cx="150" cy="160" r="70" fill="#bdc9dd"/></svg>')}}if(p==='/__ui'){res.setHeader('Content-Type','text/html');return res.end('<html dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+css.map(p=>`<link rel="stylesheet" href="/${p}">`).join('')+'<body></body></html>')}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');const file=p.slice(1);if(phase==='before'&&baselineFiles.has(file)){if(!fileCache.has(file))fileCache.set(file,execFileSync('git',['show','e73cc6be:apps/web/'+file],{cwd:repo}));return res.end(fileCache.get(file))}res.end(await readFile(root+p));}catch{res.statusCode=404;res.end()}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:process.env.VANTARA_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
let actionArtworkRequests=0, cataloguePageTwoRequests=0;
await page.route('**/*',async route=>{
 const u=route.request().url();if(u.startsWith('http://127.0.0.1:'))return route.continue();
 if(u.includes('graphql.anilist.co') && JSON.parse(route.request().postData()||'{}').variables?.genre==='Action') {
   actionArtworkRequests++;
   if(actionArtworkRequests===1) return route.fulfill({status:503,json:{errors:[{message:'offline'}]}});
   return route.fulfill({json:{data:{Page:{media:[{id:1,title:{romaji:'Action'},bannerImage:origin+'/qa-poster?action=1'}]}}}});
 }
 if(u.includes('graphql.anilist.co')) {
   const request=JSON.parse(route.request().postData()||'{}');
   if(request.query?.includes('media(type: ANIME, search:') && !request.variables?.genre) {
     const second=request.variables.page===2;if(second) cataloguePageTwoRequests++;
     const media=second?[{id:100,title:{romaji:'Next QA'}}]:[{id:0,title:{romaji:'Invalid QA'}},{id:120377,title:{romaji:'Valid QA'}}];
     return route.fulfill({json:{data:{Page:{media,pageInfo:{hasNextPage:!second}}}}});
   }
 }
 if(u.includes('graphql.anilist.co'))return route.fulfill({json:{data:{Page:{media:[{id:0,title:{romaji:'Invalid QA'},coverImage:{large:origin+'/qa-poster'}},{id:120377,title:{romaji:'Valid QA'},coverImage:{large:origin+'/qa-poster'}}],pageInfo:{hasNextPage:false}},Media:{id:120377,type:'ANIME',title:{romaji:'قصة الاختبار'},coverImage:{large:origin+'/qa-poster'},bannerImage:origin+'/qa-poster',format:'TV',status:'FINISHED',episodes:148,duration:24,genres:['Action'],description:'قصة الاختبار',relations:{edges:[]},characters:{edges:[]},recommendations:{nodes:[]},streamingEpisodes:[]}}}});
 if(u.includes('v3-cinemeta.strem.io/meta/'))return route.fulfill({json:{meta:{id:'tt12590266',type:'movie',name:'قصة الاختبار',poster:origin+'/qa-poster',background:origin+'/qa-poster',description:'قصة الاختبار',runtime:'24 min',genres:['Action']}}});
 return route.abort();
});
const origin=`http://127.0.0.1:${server.address().port}`;await page.goto(origin+'/__ui');

await page.evaluate(async()=>{
 localStorage.setItem('vantara.experience.v1', JSON.stringify({v:2,unifyContent:true}));
 const items=[{user_id:'qa',series_ref:'anime:120377',series_title:'Anime QA',viewed_at:3},{user_id:'qa',series_ref:'cinema:tt12590266',series_title:'Cinema QA',viewed_at:2,chapter_label:'فيلم'},{user_id:'qa',series_ref:'ext:qa',series_title:'Manga QA',viewed_at:1}];
 const sync={user:{userId:'qa'},rows:(t,p)=>t==='work_views'?items.filter(p || (()=>true)):[],row:()=>null,onChange:()=>()=>{},enqueue:()=>{},translation:async()=>({status:200,body:{rows:[]}}),latestSnapshots:async()=>({sources:[]}),presence:async()=>[],stats:async()=>({}),insights:async()=>({}),topWorks:async()=>[],pendingDevices:async()=>[],privacyCapability:async()=>({}),authorizationHeader:null};
 const {mountV35}=await import('/v35/shell.js');window.__shell=mountV35({sync,mount:n=>document.body.replaceChildren(n),go:async()=>{},friends:()=>[],presence:async()=>[],version:'qa',switchAccount:()=>{},openReader:()=>{}},{page:'home'});
});
try {
 await page.waitForSelector('.uv-rv');
 await page.evaluate(()=>{
   const add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window);
   window.__scrollListeners={touchstart:new Set(),wheel:new Set()};
   window.addEventListener=(type,fn,opts)=>{if(window.__scrollListeners[type]&&fn?.name==='stop')window.__scrollListeners[type].add(fn);return add(type,fn,opts);};
   window.removeEventListener=(type,fn,opts)=>{if(window.__scrollListeners[type]&&fn?.name==='stop')window.__scrollListeners[type].delete(fn);return remove(type,fn,opts);};
 });
 for (const name of ['Anime QA','Cinema QA','Manga QA']) {
   for (const delay of [0,50,500]) {
     const card=page.locator('.uv-rv').filter({hasText:name}).first(); await card.click();
     if(delay) await page.waitForTimeout(delay);
     if (delay === 500) await page.locator('.page.active [data-act="goBack"], .page.active [data-act="backFromDetail"]').first().click();
     else await page.evaluate(()=>window.__shell.handleBack());
     await page.waitForFunction(() => !document.querySelector('.page-out,.page-in'), null, {timeout:5000});
     await page.waitForTimeout(700);
     const state=await page.evaluate(()=>({active:document.querySelector('.page.active')?.id, transient:document.querySelectorAll('.page-out,.page-in').length}));
     if(state.active!=='home'||state.transient) throw Error(name+' '+JSON.stringify(state));
   }
 }
 const retainedListeners=await page.evaluate(()=>window.__scrollListeners.touchstart.size+window.__scrollListeners.wheel.size);
 if(retainedListeners) throw Error('Scroll restoration retained input listeners: '+retainedListeners);
 const interrupted=await page.evaluate(()=>{
   document.querySelector('.uv-rv').click();window.__shell.handleBack();
   const before=window.__scrollListeners.touchstart.size+window.__scrollListeners.wheel.size;
   window.dispatchEvent(new Event('wheel'));
   return {before,after:window.__scrollListeners.touchstart.size+window.__scrollListeners.wheel.size};
 });
 if(interrupted.before!==2||interrupted.after!==0) throw Error('Input did not cancel scroll restoration: '+JSON.stringify(interrupted));
 await page.waitForFunction(()=>!document.querySelector('.page-out,.page-in'));
 const paused=await page.evaluate(()=>{
   document.querySelector('.uv-rv').click();window.__shell.handleBack();window.__shell.pause();
   const count=window.__scrollListeners.touchstart.size+window.__scrollListeners.wheel.size;
   window.__shell.resume();return count;
 });
 if(paused) throw Error('Pausing shell retained scroll listeners: '+paused);
 await page.evaluate(()=>{window.__originBody=document.querySelector('.uv-body');});
 await page.locator('.uv-rv').filter({hasText:'Anime QA'}).first().click();
 const retained=await page.evaluate(()=>window.__originBody===document.querySelector('.uv-body'));
 if(!retained) throw Error('Opening an anime rebuilt the unified home');
 await page.evaluate(()=>window.__shell.handleBack());
 await page.waitForFunction(()=>!document.querySelector('.page-out,.page-in'));
 await page.locator('.uv-door').filter({hasText:'كل الأعمال'}).click();
 await page.getByRole('button',{name:'Next QA',exact:true}).waitFor();
 if(cataloguePageTwoRequests!==1) throw Error('Duplicate page requests: '+cataloguePageTwoRequests);
 await page.locator('.uv-page .uv-po').filter({hasText:'Invalid QA'}).click();
 const invalid=await page.locator('.uv-page').evaluate(n=>({pointerEvents:n.style.pointerEvents,visible:getComputedStyle(n).visibility}));
 if(invalid.pointerEvents==='none'||invalid.visible==='hidden') throw Error('Invalid work left its origin suspended: '+JSON.stringify(invalid));
 await page.getByRole('button',{name:'Valid QA',exact:true}).click();
 await page.waitForSelector('#anime.active');
 await page.evaluate(()=>window.__shell.handleBack());
 await page.waitForFunction(() => !document.querySelector('.page-out,.page-in'), null, {timeout:5000});
 const restored=await page.locator('.uv-page').evaluate(n=>({pointerEvents:n.style.pointerEvents,visible:getComputedStyle(n).visibility}));
 if(restored.pointerEvents==='none'||restored.visible==='hidden') throw Error('Valid work did not restore origin: '+JSON.stringify(restored));
 await page.evaluate(()=>window.__shell.handleBack());
 await page.waitForFunction(()=>!document.querySelector('.uv-page'));
 const scrollState=await page.evaluate(()=>{
   const body=document.querySelector('.uv-body'); body.style.minHeight='4000px';
   window.scrollTo(0,1800); const initial=window.scrollY;
   const tabs=[...document.querySelectorAll('.uv > .uv-tabs button')];
   tabs.find(x=>x.textContent==='المانجا').click();
   tabs.find(x=>x.textContent==='الكل').click();
   return {same:document.querySelector('.uv-body')===body,before:initial,after:window.scrollY};
 });
 if (!scrollState.same || Math.abs(scrollState.after-scrollState.before)>1) throw Error('Filter state was lost: '+JSON.stringify(scrollState));
 const cycles=Number(process.env.VANTARA_UNIFIED_STRESS_CYCLES||0);
 if(cycles>0) {
   const pressure=await page.evaluate(async cycles=>{
     let seed=94721;
     for(let i=0;i<cycles;i++) {
       seed=(seed*16807)%2147483647;
       const cards=[...document.querySelectorAll('.uv-rv')], card=cards[seed%cards.length];
       if(!card) throw Error('missing card at '+i);
       card.click();await Promise.resolve();
       const work=document.querySelector('.page.active')?.id;
       if(!['detail','anime','cinema'].includes(work)) throw Error('wrong work at '+i+': '+work);
       window.__shell.handleBack();await Promise.resolve();
       const active=[...document.querySelectorAll('.page.active')];
       if(active.length!==1||active[0].id!=='home') throw Error('wrong return at '+i+': '+active.map(n=>n.id));
       await new Promise(resolve=>setTimeout(resolve,16));
     }
     return {steps:cycles*2};
   },cycles);
   console.log('Directed pressure:',JSON.stringify(pressure));
 }
 await page.evaluate(()=>window.__shell.showPage('discover'));
 await page.waitForSelector('.ud-genres .ud-genre');
 await page.waitForFunction(()=>document.querySelector('.ud-genres .ud-genre'));
 await page.waitForTimeout(300);
 await page.locator('.ud-seg:not(.ud-seg--page) button').filter({hasText:'مانجا'}).click();
 await page.locator('.ud-seg:not(.ud-seg--page) button').filter({hasText:'أنمي'}).click();
 if(actionArtworkRequests!==1) throw Error('Genre artwork retried before backoff: '+actionArtworkRequests);
 await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+31000;});
 await page.locator('.ud-seg:not(.ud-seg--page) button').filter({hasText:'مانجا'}).click();
 await page.locator('.ud-seg:not(.ud-seg--page) button').filter({hasText:'أنمي'}).click();
 await page.waitForTimeout(300);
 if(actionArtworkRequests<2) throw Error('Failed genre artwork was never retried: '+actionArtworkRequests);
 await page.waitForFunction(()=>{const image=document.querySelector('.ud-genres .ud-genre:first-child img');return image?.complete && image.naturalWidth>0;},null,{timeout:3000}).catch(async error=>{throw Error('Artwork not visible: '+JSON.stringify(await page.locator('.ud-genres .ud-genre').first().evaluate(n=>n.outerHTML))+' '+error.message);});
 if (errors.length) throw Error('JavaScript errors: '+JSON.stringify(errors));
 console.log('PASS: 9 recent-card back cycles; invalid work rejected and valid work restores origin');
} finally {await browser.close();server.close();}
