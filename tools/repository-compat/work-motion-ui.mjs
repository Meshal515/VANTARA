import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const baselineFiles=new Set(['v35/shell.js','v35/page-motion.js','v35/motion.js','v35/core.css','v35/cinema.js']);
const fileCache=new Map();
const modulePath=process.env.VANTARA_PLAYWRIGHT_MODULE||'/workspace/vantara-browser-qa/node_modules/playwright/index.mjs';
const {chromium}=await import(path.isAbsolute(modulePath)?pathToFileURL(modulePath).href:modulePath);
const repo=process.argv[2]||process.cwd();
const phase=process.env.WORK_MOTION_PHASE||'after';
const root=path.join(repo,'apps/web'),out=process.env.VANTARA_UI_EVIDENCE||'/workspace/evidence/work-motion-20261108/'+phase;await mkdir(out,{recursive:true});
const css=['styles.css','v35/core.css','v35.css','v35/reader.css','v35/majlis.css','v35/social.css','v35/profile.css','v35/anime.css','v35/cinema.css','v35/server-sheet.css','v35/manga.css','v35/rafiq.css','v35/wide.css','v35/addons.css','v35/addons-v7.css','v35/together.css'];
const server=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p==='/qa-poster'){try{const b=await readFile(process.env.VANTARA_WORK_MOTION_POSTER||'/workspace/evidence/visual-ui-20261103/poster.img');res.setHeader('Content-Type','image/jpeg');return res.end(b)}catch{res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#28354a"/><circle cx="150" cy="160" r="70" fill="#bdc9dd"/></svg>')}}if(p==='/__ui'){res.setHeader('Content-Type','text/html');return res.end('<html dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+css.map(p=>`<link rel="stylesheet" href="/${p}">`).join('')+'<body></body></html>')}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');const file=p.slice(1);if(phase==='before'&&baselineFiles.has(file)){if(!fileCache.has(file))fileCache.set(file,execFileSync('git',['show','e73cc6be:apps/web/'+file],{cwd:repo}));return res.end(fileCache.get(file))}res.end(await readFile(root+p));}catch{res.statusCode=404;res.end()}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:process.env.VANTARA_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.route('**/*',async route=>{
 const u=route.request().url();if(u.startsWith('http://127.0.0.1:'))return route.continue();
 if(u.includes('graphql.anilist.co'))return route.fulfill({json:{data:{Media:{id:120377,type:'ANIME',title:{romaji:'قصة الاختبار'},coverImage:{large:origin+'/qa-poster'},bannerImage:origin+'/qa-poster',format:'TV',status:'FINISHED',episodes:148,duration:24,genres:['Action'],description:'قصة الاختبار',relations:{edges:[]},characters:{edges:[]},recommendations:{nodes:[]},streamingEpisodes:[]}}}});
 if(u.includes('v3-cinemeta.strem.io/meta/'))return route.fulfill({json:{meta:{id:'tt12590266',type:'movie',name:'قصة الاختبار',poster:origin+'/qa-poster',background:origin+'/qa-poster',description:'قصة الاختبار',runtime:'24 min',genres:['Action']}}});
 return route.abort();
});
const origin=`http://127.0.0.1:${server.address().port}`;await page.goto(origin+'/__ui');
await page.evaluate(async()=>{const sync={user:null,rows:()=>[],row:()=>null,onChange:()=>()=>{},enqueue:()=>{},translation:async()=>({status:200,body:{rows:[]}}),latestSnapshots:async()=>({sources:[]}),presence:async()=>[],stats:async()=>({}),insights:async()=>({}),topWorks:async()=>[],pendingDevices:async()=>[],privacyCapability:async()=>({}),authorizationHeader:null};const {mountV35}=await import('/v35/shell.js');window.__shell=mountV35({sync,mount:n=>document.body.replaceChildren(n),go:async()=>{},friends:()=>[],presence:async()=>[],version:'motion-fixture',switchAccount:()=>{},openReader:()=>{}},{page:'home'});});
await page.waitForSelector('#home.active');
const proof={phase,cases:[],errors,fixture:'real shell.openWork/showPage; local anonymous data; CPU throttling is not physical device testing'};
const cdp=await page.context().newCDPSession(page);
const looks=['manga','core','platform','card','screen','episode','cinema'];
try {
 for(const width of [390,1440]) for(const rate of [1,6]) {
  await page.setViewportSize({width,height:844});await cdp.send('Emulation.setCPUThrottlingRate',{rate});
  for(const look of looks) {
   if(process.env.WORK_MOTION_CASES&&!process.env.WORK_MOTION_CASES.split(',').includes([look,width,rate].join(':')))continue;
   await page.evaluate(async look=>{
    window.__shell.showPage('home');
    localStorage.setItem('vantara.appearance.v1',JSON.stringify({style:{anime:look},accent:{anime:'gold'}}));
    const id=look==='manga'?'qa-manga':look==='cinema'?'cinema:tt12590266':'anime:120377';
    window.__shell.openWork({id,title:{romaji:'قصة الاختبار'},coverImage:{large:location.origin+'/qa-poster'},description:'قصة الاختبار',genres:['Action'],status:'FINISHED',_work:{key:'qa-manga',editions:[]}});
   },look);
   await page.waitForTimeout(750);
   const id=look==='manga'?'detail':look==='cinema'?'cinema':'anime';
   const cover=look==='manga'?'#detailCover':({core:'.aw-cover',platform:'.wl-plate .wl-cover',card:'.wl-stage3d > .wl-card',screen:'.wl-top .wl-cover',episode:'.wl-series > img',cinema:'.cn-detail-art'})[look];
   await page.evaluate(id=>{
    const n=document.querySelector('#'+id), pad=document.createElement('div');pad.dataset.qaLong='true';pad.style.height='14000px';n.append(pad);
    window.__shell.showPage('home');window.__shell.showPage(id);
   },id);
   const facts=await page.evaluate(async({id,cover})=>{
    await Promise.resolve();const n=document.querySelector('#'+id), a=n.getAnimations().find(a=>a.effect?.target===n);
    if(!a)throw new Error('Missing entry animation '+id);
    a.pause();const samples=[];
    for(const t of [0,160,399]){a.currentTime=t;const c=n.querySelector(cover)?.getBoundingClientRect();const fixed=[...n.querySelectorAll('.aw-bar,.wl-dock,.wl-mini,.cn-detail-bar')].map(x=>({cls:x.className,y:x.getBoundingClientRect().y,h:x.getBoundingClientRect().height,opacity:getComputedStyle(x).opacity}));samples.push({t,centre:c?{x:c.x+c.width/2,y:c.y+c.height/2}:null,fixed});}
    a.finish();return {samples,scrollHeight:document.scrollingElement.scrollHeight};
   },{id,cover});
   if(phase==='after'){
    const c=facts.samples.map(s=>s.centre).filter(Boolean);if(c.length&&Math.max(...c.map(p=>p.y))-Math.min(...c.map(p=>p.y))>.1)throw new Error('Cover drift '+JSON.stringify({look,width,rate,facts}));
    for(const sample of facts.samples)for(const f of sample.fixed)if(f.opacity!=='0'&&f.h>0&&(f.y>900||f.y+f.h< -200))throw new Error('Fixed control left viewport '+JSON.stringify({look,width,rate,f}));
   }
   await page.waitForTimeout(30);
   const finalCover=await page.locator('#'+id+' '+cover).first().boundingBox();
   await page.screenshot({path:out+`/${look}-${width}-${rate}.png`});
   await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));
   const backFixed=await page.evaluate(async id=>{
     window.__shell.showPage('search');window.__shell.handleBack();await Promise.resolve();
     const n=document.querySelector('#'+id),a=n.getAnimations().find(a=>a.effect?.target===n);if(a){a.pause();a.currentTime=160;}
     const boxes=[...n.querySelectorAll('.aw-bar,.wl-dock,.wl-mini,.cn-detail-bar')].map(x=>({cls:x.className,y:x.getBoundingClientRect().y,h:x.getBoundingClientRect().height,opacity:getComputedStyle(x).opacity}));
     a?.finish();return boxes;
   },id);
   if(phase==='after')for(const f of backFixed)if(f.opacity!=='0'&&f.h>0&&(f.y>900||f.y+f.h< -200))throw new Error('Scrolled return lost a fixed control '+JSON.stringify({look,width,rate,f}));
   await page.waitForTimeout(30);

   const exit=await page.evaluate(id=>{const n=document.querySelector('#'+id),marker=n.querySelector('[data-qa-long]'),y=marker.getBoundingClientRect().y;const before={rect:n.getBoundingClientRect().toJSON(),children:[...n.children].slice(0,6).map(c=>({id:c.id,cl:c.className,r:c.getBoundingClientRect().toJSON()})),style:getComputedStyle(n).display};window.__shell.handleBack();const a=n.getAnimations().find(a=>a.effect?.target===n);if(a){a.pause();a.currentTime=0;}const value={fixed:[...n.querySelectorAll('.aw-bar,.wl-dock,.wl-mini,.cn-detail-bar')].map(x=>({cls:x.className,y:x.getBoundingClientRect().y,h:x.getBoundingClientRect().height,opacity:getComputedStyle(x).opacity})),before,rect:n.getBoundingClientRect().toJSON(),children:[...n.children].slice(0,6).map(c=>({id:c.id,cl:c.className,r:c.getBoundingClientRect().toJSON()})),beforeY:y,afterY:marker.getBoundingClientRect().y,height:n.getBoundingClientRect().height,scrollTop:n.scrollTop};a?.finish();return value},id);
   if(phase==='after'&&(Math.abs(exit.beforeY-exit.afterY)>.1||exit.height>845))throw new Error('Outgoing viewport/scroll mismatch '+JSON.stringify({look,width,rate,exit}));
   if(phase==='after')for(const f of exit.fixed)if(f.opacity!=='0'&&f.h>0&&(f.y>900||f.y+f.h< -200))throw new Error('Scrolled exit lost a fixed control '+JSON.stringify({look,width,rate,f}));
   proof.cases.push({look,width,rate,...facts,backFixed,finalCover,exit});
  }
 }
 // Focused pressure cases: immediate, frame-length, medium and full-duration Back.
 for(const rate of (phase==='before'?[]:[1,4,6])){
  await cdp.send('Emulation.setCPUThrottlingRate',{rate});
  for(const delay of [0,16,80,450])for(let i=0;i<5;i++){
   await page.evaluate(i=>window.__shell.openWork({id:'qa-'+i,title:{romaji:'قصة الاختبار'},coverImage:{large:location.origin+'/qa-poster'},_work:{key:'qa-'+i,editions:[]}}),i);
   if(delay)await page.waitForTimeout(delay);await page.evaluate(()=>window.__shell.handleBack());
  }
 }
 await page.waitForTimeout(700);
 proof.leftovers=await page.evaluate(()=>({active:document.querySelectorAll('.page.active').length,transient:document.querySelectorAll('.page-in,.page-out,.page-depth,[data-motion-space]').length}));
 if(proof.leftovers.active!==1||proof.leftovers.transient)throw new Error('Navigation cleanup leak '+JSON.stringify(proof.leftovers));
 if(errors.length)throw new Error(errors.join('\n'));
 await writeFile(out+'/proof.json',JSON.stringify(proof,null,2));console.log('Work motion:',proof.cases.length,'visual cases;60 pressure cycles; clean teardown');
} finally {await browser.close();server.close();}
