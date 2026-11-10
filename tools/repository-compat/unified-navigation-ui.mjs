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
await page.route('**/*',async route=>{
 const u=route.request().url();if(u.startsWith('http://127.0.0.1:'))return route.continue();
 if(u.includes('graphql.anilist.co'))return route.fulfill({json:{data:{Media:{id:120377,type:'ANIME',title:{romaji:'قصة الاختبار'},coverImage:{large:origin+'/qa-poster'},bannerImage:origin+'/qa-poster',format:'TV',status:'FINISHED',episodes:148,duration:24,genres:['Action'],description:'قصة الاختبار',relations:{edges:[]},characters:{edges:[]},recommendations:{nodes:[]},streamingEpisodes:[]}}}});
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
 for (const name of ['Anime QA','Cinema QA','Manga QA']) {
   for (const delay of [0,50,500]) {
     const card=page.locator('.uv-rv').filter({hasText:name}).first(); await card.click();
     if(delay) await page.waitForTimeout(delay);
     await page.evaluate(()=>window.__shell.handleBack());
     await page.waitForFunction(() => !document.querySelector('.page-out,.page-in'), null, {timeout:5000});
     await page.waitForTimeout(700);
     const state=await page.evaluate(()=>({active:document.querySelector('.page.active')?.id, transient:document.querySelectorAll('.page-out,.page-in').length}));
     if(state.active!=='home'||state.transient) throw Error(name+' '+JSON.stringify(state));
   }
 }
 if (errors.length) throw Error('JavaScript errors: '+JSON.stringify(errors));
 console.log('PASS: unified recent cards, 3 types, immediate/50ms/500ms back, 9 cycles');
} finally {await browser.close();server.close();}
