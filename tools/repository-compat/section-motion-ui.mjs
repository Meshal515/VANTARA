import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const modulePath=process.env.VANTARA_PLAYWRIGHT_MODULE||'/workspace/vantara-browser-qa/node_modules/playwright/index.mjs';
const {chromium}=await import(path.isAbsolute(modulePath)?pathToFileURL(modulePath).href:modulePath);
const repo=process.argv[2]||process.cwd();
const root=path.join(repo,'apps/web'),out=process.env.VANTARA_UI_EVIDENCE||'/workspace/evidence/section-motion-20261106';await mkdir(out,{recursive:true});
const css=['styles.css','v35/core.css','v35.css','v35/reader.css','v35/majlis.css','v35/social.css','v35/profile.css','v35/anime.css','v35/cinema.css','v35/server-sheet.css','v35/manga.css','v35/rafiq.css','v35/wide.css','v35/addons.css','v35/addons-v7.css','v35/together.css'];
const server=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p==='/__ui'){res.setHeader('Content-Type','text/html');return res.end('<html dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+css.map(p=>`<link rel="stylesheet" href="/${p}">`).join('')+'<body></body></html>')}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');res.end(await readFile(root+p));}catch{res.statusCode=404;res.end()}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:process.env.VANTARA_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
await page.goto(`http://127.0.0.1:${server.address().port}/__ui`);
await page.evaluate(async()=>{const sync={user:null,rows:()=>[],row:()=>null,onChange:()=>()=>{},enqueue:()=>{},translation:async()=>({status:200,body:{rows:[]}}),latestSnapshots:async()=>({sources:[]}),presence:async()=>[],stats:async()=>({}),insights:async()=>({}),topWorks:async()=>[],pendingDevices:async()=>[],privacyCapability:async()=>({}),authorizationHeader:null};const {mountV35}=await import('/v35/shell.js');window.__shell=mountV35({sync,mount:n=>document.body.replaceChildren(n),go:async()=>{},friends:()=>[],presence:async()=>[],version:'motion-fixture',switchAccount:()=>{},openReader:()=>{}},{page:'home'});});
await page.waitForSelector('#home.active');
// First switch: the other sections are laid out off-screen in idle time after boot (a hidden section used to get its
// first style and layout at the tap: a 270 ms task on cinema, the first-switch jank on weak devices), without
// lengthening the visible page's scroll.
{
  const before=await page.evaluate(()=>document.scrollingElement.scrollHeight);
  await page.waitForFunction(()=>document.querySelectorAll('#home > .home-view.layer-standby').length===2,null,{timeout:15000});
  const warm=await page.evaluate(()=>({scroll:document.scrollingElement.scrollHeight,laidOut:[...document.querySelectorAll('#home > .home-view.layer-standby')].every(v=>v.getBoundingClientRect().height>0)}));
  if(!warm.laidOut)throw new Error('Standby sections are not laid out: '+JSON.stringify(warm));
  if(warm.scroll>before+1)throw new Error('Standby sections lengthen the page scroll: '+JSON.stringify({before,...warm}));
}
const {sectionMotionProof}=await import('./section-motion-proof.mjs');
try {const proof=await sectionMotionProof(expr=>page.evaluate(expr),name=>page.screenshot({path:out+'/'+name+'.png'}));await writeFile(out+'/proof.json',JSON.stringify(proof,null,2));if(errors.length)throw new Error('Uncaught shell exceptions: '+errors.join('\n'));console.log('Section compositor PASS:',proof.cases.length,'cases; rapid selection; reduced motion; no first-frame scroll jumps');} finally {await browser.close();server.close();}
