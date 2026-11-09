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
  // Regression for a real scrolled cinema HOME (earlier proof forced home scroll to zero).
  // The fixed cinema header and the flow-positioned manga header must share one
  // logical top offset; scrolling cinema must not become extra blank space in manga.
  const scrolledProof = [];
  let baselineMangaTop = null;
  for (const sourceScroll of [0, 180, 440, 1000]) {
    await page.evaluate(() => document.querySelector('#secOpt-cinema').click());
    await page.waitForFunction(
      () => document.querySelector('.v35')?.dataset.section === 'cinema'
        && !document.querySelector('#home.layering,.section-page-layer'),
      null, {timeout: 8000}
    );
    // Local deterministic layout: the same full-bleed cinema CSS with enough
    // content to reproduce actual scrolling, independent of remote movie metadata.
    await page.evaluate(y => {
      const view = document.querySelector('#cinemaHome');
      if (!view.querySelector(':scope > .cn-hero-alt')) {
        const hero = document.createElement('div');
        hero.className = 'cn-hero-alt';
        hero.style.height = '320px';
        view.prepend(hero);
      }
      if (!view.querySelector('#motion-cinema-scroll-sentinel')) {
        const tall = document.createElement('div');
        tall.id = 'motion-cinema-scroll-sentinel';
        tall.style.height = '2600px';
        view.append(tall);
      }
      window.scrollTo({top: y, behavior: 'instant'});
    }, sourceScroll);
    await page.waitForTimeout(45);
    const before = await page.evaluate(() => {
      const header = document.querySelector('#home > .header');
      return {
        scrollY: window.scrollY,
        fixed: getComputedStyle(header).position === 'fixed',
        headerBottom: header.getBoundingClientRect().bottom,
      };
    });
    if (!before.fixed || Math.abs(before.scrollY - sourceScroll) > 2)
      throw new Error('Cinema scroll fixture did not reproduce the fixed header: '+JSON.stringify({sourceScroll,before}));
    const first = await page.evaluate(() => {
      document.querySelector('#secOpt-manga').click();
      const home = document.querySelector('#home');
      return {
        layering: home.classList.contains('layering'),
        layerTop: Number.parseFloat(home.style.getPropertyValue('--layer-top')),
        hiddenButtons: getComputedStyle(home.querySelector(':scope > .header .header-start')).pointerEvents === 'none',
      };
    });
    if (!first.layering || Math.abs(first.layerTop - before.headerBottom) > 2
        || first.hiddenButtons !== (sourceScroll > 8))
      throw new Error('Cinema leaked its scroll offset or wrong top/top header visibility: '+JSON.stringify({sourceScroll,before,first}));
    await page.waitForTimeout(85);
    const during = await page.evaluate(() => ({
      fading: Number.parseFloat(getComputedStyle(document.querySelector('#home > .header .header-start')).opacity),
      brandOpacity: Number.parseFloat(getComputedStyle(document.querySelector('#brandLockup')).opacity),
      moving: document.querySelector('#home').classList.contains('layering'),
    }));
    if (!during.moving || (sourceScroll > 8 ? !(during.fading < 0.99) : Math.abs(during.fading - 1) > 0.02))
      throw new Error('Header actions violated top/top or scrolled transition rules: '+JSON.stringify({sourceScroll,during}));
    if (sourceScroll === 0 && Math.abs(during.brandOpacity - 1) > 0.02)
      throw new Error('VANTARA brand must stay visible at Home top: '+JSON.stringify({sourceScroll,during}));
    if (sourceScroll > 8 && !(during.brandOpacity < 0.99))
      throw new Error('Scrolled section brand must fade during switch: '+JSON.stringify({sourceScroll,during}));
    if (sourceScroll === 440) await page.screenshot({path:out+'/cinema-440-to-manga-midfade.png'});
    await page.waitForFunction(
      () => document.querySelector('.v35')?.dataset.section === 'manga'
        && !document.querySelector('#home.layering,.section-page-layer'),
      null, {timeout: 8000}
    );
    await page.waitForTimeout(210);
    const after = await page.evaluate(() => ({
      heroTop: document.querySelector('#mangaHome .mg-hero')?.getBoundingClientRect().top,
      headerOpacity: Number.parseFloat(getComputedStyle(document.querySelector('#home > .header .header-start')).opacity),
      brandOpacity: Number.parseFloat(getComputedStyle(document.querySelector('#brandLockup')).opacity),
      scrollbarWidth: getComputedStyle(document.documentElement).scrollbarWidth,
      section: document.querySelector('.v35')?.dataset.section,
    }));
    if (after.heroTop == null || Math.abs(after.headerOpacity-1) > 0.02 || Math.abs(after.brandOpacity-1) > 0.02 || after.scrollbarWidth !== 'none')
      throw new Error('Manga hero missing or header buttons failed to reappear: '+JSON.stringify({sourceScroll,after}));
    if (baselineMangaTop === null) baselineMangaTop = after.heroTop;
    if (Math.abs(after.heroTop-baselineMangaTop) > 8)
      throw new Error('Manga top changed based on how far cinema had scrolled: '+JSON.stringify({sourceScroll,baselineMangaTop,after}));
    if (sourceScroll === 440) await page.screenshot({path:out+'/cinema-440-to-manga-settled.png'});
    scrolledProof.push({sourceScroll,headerBottom:before.headerBottom,layerTop:first.layerTop,heroTop:after.heroTop});
  }
  await writeFile(out+'/scrolled-cinema-proof.json',JSON.stringify(scrolledProof,null,2));
  // The native scrollbar is independent of CSS scrollbar styles and must be
  // disabled for the actual Android WebView.
  const activitySource = await readFile(path.join(repo,'android/app/src/main/java/com/vantara/app/MainActivity.java'),'utf8');
  if (!activitySource.includes('setVerticalScrollBarEnabled(false)')
      || !activitySource.includes('setHorizontalScrollBarEnabled(false)'))
    throw new Error('Native Android scroll indicators were not disabled');
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
