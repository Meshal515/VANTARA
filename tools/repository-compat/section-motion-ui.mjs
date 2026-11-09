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
try {
  const proof=await sectionMotionProof(expr=>page.evaluate(expr),name=>page.screenshot({path:out+'/'+name+'.png'}));
  await writeFile(out+'/proof.json',JSON.stringify(proof,null,2));
  if(errors.length)throw new Error('Uncaught shell exceptions: '+errors.join('\\n'));
  // Reproduce the reported cinema -> manga transition from inside a work page.
  await page.evaluate(()=>document.querySelector('#secOpt-cinema').click());
  await page.waitForFunction(()=>document.querySelector('.v35')?.dataset.section==='cinema'&&!document.querySelector('.layering,.section-page-layer'),null,{timeout:8000});
  await page.evaluate(()=>window.__shell.showPage('cinema'));
  await page.waitForTimeout(650);
  await page.evaluate(()=>document.querySelector('#secOpt-manga').click());
  const samples=[];
  for(const delay of [0,35,75,115,175,310]) {
    if(delay) await page.waitForTimeout(delay);
    samples.push(await page.evaluate(()=>{
      const hero=document.querySelector('#mangaHome .mg-hero');
      return {top:hero?.getBoundingClientRect().top??null,section:document.querySelector('.v35')?.dataset.section};
    }));
  }
  if(samples.some(s=>s.top===null))throw new Error('Manga hero not rendered during cinema exit: '+JSON.stringify(samples));
  const delta=Math.max(...samples.map(s=>s.top))-Math.min(...samples.map(s=>s.top));
  if(delta>8)throw new Error('Cinema to manga first-frame hero jump: '+JSON.stringify({delta,samples}));
  await page.screenshot({path:out+'/cinema-to-manga-settled.png'});
  // Real CSS + Web Animations test: wide artwork stays at a constant screen Y
  // from first frame through animation completion (DOM existence alone is not proof).
  const visual=await browser.newPage({viewport:{width:390,height:844}});
  try {
    await visual.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
    await visual.goto('http://127.0.0.1:'+server.address().port+'/__ui');
    for(const [width,height] of [[360,780],[390,844],[768,1024]]) {
      await visual.setViewportSize({width,height});
      const start=await visual.evaluate(async()=>{
        document.body.innerHTML='<div class="v35" data-section="cinema"><div class="app"><section class="page active cinema-page" id="cinema"><article class="cn-detail" data-style="marquee"><div class="cn-detail-bar"></div><div class="cn-detail-art"><img class="cn-img loaded" alt=""></div><div class="cn-detail-body"><div class="cn-detail-mark">DEXTER</div></div></article></section></div></div>';
        const image=document.querySelector('.cn-detail-art img');
        image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="502"><rect width="1200" height="502" fill="#158ad9"/></svg>');
        const {pageIn}=await import('/v35/page-motion.js');
        const art=document.querySelector('.cn-detail-art');
        const before=art.getBoundingClientRect().top;
        const shadow=getComputedStyle(art).boxShadow;
        pageIn(document.querySelector('#cinema'),{depth:true});
        return {before,shadow};
      });
      if(start.shadow!=='none')throw new Error('Marquee still has hard black bands: '+JSON.stringify({width,start}));
      const ys=[start.before];
      for(const delay of [30,90,160,260]) {
        await visual.waitForTimeout(delay);
        ys.push(await visual.evaluate(()=>document.querySelector('.cn-detail-art').getBoundingClientRect().top));
      }
      const travel=Math.max(...ys)-Math.min(...ys);
      if(travel>2)throw new Error('Dexter art shifts on page entry: '+JSON.stringify({width,travel,ys}));
      if(width===390)await visual.screenshot({path:out+'/marquee-no-jump.png'});
    }
  } finally {await visual.close()}
  await writeFile(out+'/visual-proof.json',JSON.stringify({cinemaToManga:{delta,samples},marqueeWidths:[360,390,768]},null,2));
  if(errors.length)throw new Error('Uncaught shell exceptions: '+errors.join('\\n'));
  console.log('Visual motion PASS: 24 section cases, cinema work -> manga, marquee art at 3 widths, no black bars or entry jump');
} finally {await browser.close();server.close();}
