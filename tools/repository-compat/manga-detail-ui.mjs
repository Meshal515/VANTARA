import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const modulePath=process.env.VANTARA_PLAYWRIGHT_MODULE||'/workspace/vantara-browser-qa/node_modules/playwright/index.mjs';
const {chromium}=await import(path.isAbsolute(modulePath)?pathToFileURL(modulePath).href:modulePath);
const repo=process.argv[2]||process.cwd();
const phase='after';
const root=path.join(repo,'apps/web');
const css=['styles.css','v35/core.css','v35.css','v35/reader.css','v35/majlis.css','v35/social.css','v35/profile.css','v35/anime.css','v35/cinema.css','v35/server-sheet.css','v35/manga.css','v35/rafiq.css','v35/wide.css','v35/addons.css','v35/addons-v7.css','v35/together.css'];
const server=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p==='/qa-poster'){try{const b=await readFile(process.env.VANTARA_WORK_MOTION_POSTER||'/workspace/evidence/visual-ui-20261103/poster.img');res.setHeader('Content-Type','image/jpeg');return res.end(b)}catch{res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#28354a"/><circle cx="150" cy="160" r="70" fill="#bdc9dd"/></svg>')}}if(p==='/__ui'){res.setHeader('Content-Type','text/html');return res.end('<html dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+css.map(p=>`<link rel="stylesheet" href="/${p}">`).join('')+'<body></body></html>')}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');const file=p.slice(1);res.end(await readFile(root+p));}catch{res.statusCode=404;res.end()}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
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

try {
 for (const look of ['page', 'gallery', 'profile', 'resume']) {
  await page.evaluate(look => localStorage.setItem('vantara.appearance.v1', JSON.stringify({style:{manga:look,anime:'card'}})), look);
  await page.evaluate(() => window.__shell.openWork({id:'qa-manga',title:{romaji:'Test Manga'},coverImage:{large:location.origin+'/qa-poster'},description:'Test story',genres:['Action'],status:'FINISHED',_work:{key:'qa-manga',editions:[]}}));
  const result = await page.evaluate(() => ({look:document.querySelector('#detail').dataset.look,title:document.querySelector('#detailTitle')?.textContent,button:document.querySelector('#readCtaLabel')?.textContent,icon:document.querySelector('#readCta .mw-go svg')?.innerHTML,style:JSON.parse(localStorage.getItem('vantara.appearance.v1')).style}));
  if (result.look !== look || result.title !== 'Test Manga' || result.button === 'جارٍ جمع الفصول' || !result.icon?.includes('M12 6.8') || result.style.anime !== 'card') throw new Error(JSON.stringify(result));
  console.log('PASS', look, result.button);
 }
 if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); server.close(); }
