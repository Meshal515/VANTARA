import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {pathToFileURL} from 'node:url';
const modulePath=process.env.VANTARA_PLAYWRIGHT_MODULE || '/workspace/vantara-browser-qa/node_modules/playwright/index.mjs';
const {chromium}=await import(path.isAbsolute(modulePath)?pathToFileURL(modulePath).href:modulePath);
const root=process.argv[2]||process.cwd(), phase=process.argv[3]||'after', out=process.env.VANTARA_UI_EVIDENCE || '/workspace/evidence/visual-ui-20261103';
await mkdir(out,{recursive:true});
for(const kind of ['logo','poster','background']){
 try{await readFile(path.join(out,kind+'.img'));}catch{
  const response=await fetch('https://images.metahub.space/'+kind+'/medium/tt12590266/img',{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,'Official metadata art fixture '+kind);
  await writeFile(path.join(out,kind+'.img'),Buffer.from(await response.arrayBuffer()));
 }
}
const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const html=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/v35/core.css"><link rel="stylesheet" href="/v35/anime.css"><link rel="stylesheet" href="/v35/server-sheet.css"><style>body{margin:0;background:#08070c}.aw{position:relative;min-height:100vh} .aw-bar{position:absolute!important;top:0!important}.qa-icons{direction:ltr;display:grid;grid-template-columns:repeat(8,1fr);gap:16px;padding:20px}.qa-icon{text-align:center;color:#fff;font:12px sans-serif}.qa-icon button{display:grid;place-items:center;width:60px;height:60px;background:#16151e;border:1px solid #444;border-radius:50%;color:#fff;margin:0 auto 7px}.qa-icons svg{display:block}</style><div class="v35" data-section="anime"><div class="aw" data-style="card" style="--art:#dbbe25"><header class="aw-bar"><button class="icon-btn" data-icon="back"></button><div class="aw-bar-title"></div><div class="aw-tools"><button class="icon-btn" data-icon="more"></button><button class="icon-btn" data-icon="send"></button><button class="icon-btn" data-icon="heart"></button></div></header><div class="aw-hero"><div class="aw-bg"><img class="aw-bg-img in" src="/qa-background"></div><div class="aw-shade"></div></div><div class="an-sources" id="legacy-diagnostics">متوفر في المصدر · تشخيص الاكتشاف</div><div id="look"></div></div></div><script type="module">
import{renderLook}from'/v35/work-looks.js';import{glyph,GLYPH_NAMES}from'/v35/icons.js';import{applyAppearance}from'/v35/appearance.js';import{createServerSheet}from'/v35/server-sheet.js';
const ctx={m:{id:120377,title:'Cyberpunk: Edgerunners',poster:'/qa-poster',description:'Night City. قصة العمل كما تظهر في صفحة الأنمي.',recommendations:[],relations:[]},glyph,logo:'/qa-logo',meta:['ONA','خريف 2022',{html:'★ <b>8.3</b>'},'10 حلقات','مكتمل'],genres:['أكشن','دراما','خيال علمي'],facts:[],point:{episode:5,resume:true},label:'تابع الحلقة 5',total:10,ratio:.45,left:24,seenRatio:.4,progressText:'شاهدت 4 من 10',characters:[],epTitle:n=>n===5?'Fades (Pass the Distance)':'Someone That I Used to Know',epOverview:()=>null,still:()=>({src:'/qa-background',still:true}),seen:n=>n<5,minutes:()=> '28 د',play:()=>{},open:()=>{}};
window.draw=(current=5,logo='/qa-logo',style='card')=>{ctx.point.episode=current;ctx.logo=logo;document.querySelector('.aw').dataset.style=style;renderLook(style,document.querySelector('#look'),ctx,{center:true});document.querySelector('#legacy-diagnostics').hidden=${phase!=='before'};};window.color=id=>applyAppearance('anime',[document.querySelector('.v35'),document.documentElement],{accent:{anime:id}});window.icons=()=>{document.querySelector('.v35').innerHTML='<div class="qa-icons">'+GLYPH_NAMES.map(n=>'<div class="qa-icon"><button>'+glyph(n,{size:30,filled:['play','pause','heart','star'].includes(n)})+'</button>'+n+'</div>').join('')+'</div>'};
window.servers=async(showDiagnostics=false)=>{const{diagnosticsUi}=await import('/lib/diagnostics-ui.js');globalThis.Capacitor={Plugins:{SystemUi:{diagnostics:async()=>({debug:true,visible:showDiagnostics})}}};await diagnosticsUi.initialize();await diagnosticsUi.setVisible(showDiagnostics);document.querySelector('.v35').innerHTML='<div id="sheet"></div>';const body=document.querySelector('#sheet'),el=(t,c,s)=>{const n=document.createElement(t);if(c)n.className=c;if(s)n.textContent=s;return n};const friends=el('button','an-pick-together');friends.innerHTML=glyph('users')+'<span>شاهد مع أصدقائك</span>';const debug=el('button','aw-link aw-discovery-debug','تشخيص الاكتشاف');window.sheet=createServerSheet(body,{el,title:ctx.m.title,kicker:'الحلقة 5',media:{kind:'anime',poster:'/qa-poster',backdrop:'/qa-background',logo:'/qa-logo'},extraFoot:[friends${phase==='before'?',debug':''}],diagnosticAction:()=>debug,onBest:()=>{},onPick:()=>{}});sheet.update({routes:[],done:false});};
for(const b of document.querySelectorAll('[data-icon]'))b.innerHTML=glyph(b.dataset.icon);window.draw();window.color('gold');window.ready=true;
</script></html>`;
const playerFamilies={};
for(const [name,file] of [['Web player','pwa/player/player.js'],['Desktop player','desktop/overlay.js']]) {
 const source=await readFile(path.join(root,'apps/web',file),'utf8');
 const from=source.indexOf('const svg ='),last=source.indexOf('\n};',source.indexOf('const ICON =',from))+3;
 playerFamilies[name]=runInNewContext(source.slice(from,last).replace('export const ICON','const ICON')+';ICON');
}
const server=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://local').pathname;if(p==='/'){res.setHeader('Content-Type','text/html');return res.end(html)}if(p.startsWith('/qa-')){const b=await readFile(path.join(out,p.slice(4)+'.img'));res.setHeader('Content-Type',p==='/qa-logo'?'image/png':'image/jpeg');return res.end(b)}const target=path.resolve(root,'apps/web',p.slice(1));if(!target.startsWith(path.resolve(root,'apps/web')+'/'))throw Error();res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(await readFile(target));}catch{res.statusCode=404;res.end()}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({executablePath:process.env.VANTARA_CHROMIUM || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});page.on('pageerror',e=>console.error(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);await page.locator('.wl-logo').waitFor();await page.waitForTimeout(200);await page.screenshot({path:out+'/'+phase+'-390-card.png',fullPage:true});await writeFile(out+'/'+phase+'-icon-mass.json',JSON.stringify(await page.evaluate(async()=>{const{glyph,GLYPH_NAMES}=await import('/v35/icons.js');const rows=[];for(const name of GLYPH_NAMES){const svg= glyph(name,{size:192,filled:['play','heart','star'].includes(name)}).replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"').replaceAll('currentColor','white');const im=new Image();im.src=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));await im.decode();const c=document.createElement('canvas');c.width=c.height=192;const x=c.getContext('2d');x.drawImage(im,0,0);const data=x.getImageData(0,0,192,192).data;let mass=0,sx=0,sy=0,minx=192,maxx=0,miny=192,maxy=0;for(let y=0;y<192;y++)for(let x=0;x<192;x++){const a=data[(y*192+x)*4+3];mass+=a;sx+=a*(x+.5);sy+=a*(y+.5);if(a>20){minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y)}}rows.push({name,cx:sx/mass/8,cy:sy/mass/8,bounds:[minx/8,miny/8,(maxx+1)/8,(maxy+1)/8]});URL.revokeObjectURL(im.src)}return rows}),null,2));const colorProof=[];
const rgb = async (selector, property) => page.locator(selector).evaluate((node,property)=>{
 const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=getComputedStyle(node)[property];x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3);
},property);
for(const color of ['gold','white','cinema']) {
 await page.evaluate(c=>window.color(c),color);
 const normal=await rgb('.wl-big','backgroundColor'),text=await rgb('.wl-big','color');
 await page.locator('.wl-big').scrollIntoViewIfNeeded();const box=await page.locator('.wl-big').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 const pressed=await rgb('.wl-big','backgroundColor');await page.screenshot({path:out+'/'+phase+'-press-'+color+'.png'});await page.mouse.up();
 if(phase!=='before')assert.notDeepEqual(pressed,normal,'Pressed background follows theme');
 colorProof.push({color,normal,text,pressed});
}
await page.keyboard.press('Tab');await page.locator('.wl-big').focus();
if(phase!=='before')assert.equal(await page.locator('.wl-big').evaluate(n=>getComputedStyle(n).outlineStyle),'solid','Keyboard focus remains visible');
await writeFile(out+'/'+phase+'-colors.json',JSON.stringify(colorProof,null,2));
const measurements=[];
for(const width of [360,390,430]) for(const direction of ['rtl','ltr']) {
  await page.setViewportSize({width,height:844});
  await page.evaluate(dir=>{document.documentElement.dir=dir;window.draw();},direction);
  await page.waitForTimeout(120);
  for(const color of ['gold','white','cinema']) {
    await page.evaluate(c=>window.color(c),color);
    const facts=await page.evaluate(()=>{const b=document.querySelector('.wl-big'),r=document.querySelector('.wl-strip'),c=r.querySelector('.cur'),th=c.querySelector('.th'),rr=r.getBoundingClientRect(),tr=th.getBoundingClientRect();return {buttonColor:getComputedStyle(b).backgroundColor,textColor:getComputedStyle(b).color,paintContain:getComputedStyle(c).contain,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,ringInsetTop:tr.top-rr.top,band:document.querySelector('.wl-logo-layer')?.getBoundingClientRect().toJSON(),hero:document.querySelector('.aw-hero').getBoundingClientRect().toJSON()}});
    if(phase!=='before') {assert.ok(!facts.paintContain.includes('paint'),'Raised episode may not paint-clip its ring');assert.equal(facts.pageWidth,facts.viewport,'Page horizontal overflow');assert.ok(facts.ringInsetTop>=4,'Raised border has top safety');assert.ok(Math.abs(facts.band.top-facts.hero.bottom)<2,'Logo band stays beneath banner');assert.equal(await page.locator('.wl-logo-layer').evaluate(n=>getComputedStyle(n).backgroundImage),'none','Preserve original banner shade, no strip background');}
    measurements.push({width,direction,color,...facts});
    await page.screenshot({path:out+'/'+phase+'-'+width+'-'+direction+'-'+color+'.png',fullPage:true});
  }
  for(const episode of [1,10]){
    await page.evaluate(n=>window.draw(n),episode);await page.waitForTimeout(150);
    await page.locator('.wl-strip').screenshot({path:out+'/'+phase+'-'+width+'-'+direction+'-episode'+episode+'.png'});
    if(phase!=='before') {
      await page.locator('.wl-strip').scrollIntoViewIfNeeded();const rail=await page.locator('.wl-strip').boundingBox();const cdp=await page.context().newCDPSession(page);const y=rail.y+35,x=width/2;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(direction==='rtl'?1:-1)*i*12,y}]});
      await page.locator('.wl-strip').screenshot({path:out+'/'+phase+'-'+width+'-'+direction+'-drag'+episode+'.png'});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    }
  }
}
if(phase!=='before') {
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.dir='rtl';window.draw();window.color('gold')});
 await page.waitForTimeout(150);
 const spacing=await page.locator('.wl-logo-color img').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {center:b.x+b.width/2,padding:parseFloat(getComputedStyle(n).paddingLeft)*2}}));
 assert.ok(spacing.every(n=>n.padding>=40),'Logical logo separation');
 const steps=spacing.slice(1).map((n,i)=>n.center-spacing[i].center);assert.ok(Math.max(...steps)-Math.min(...steps)<1,'Uniform logo spacing across loop seam');
 const trains=page.locator('.wl-logo-train');
 for(const time of [0,9000,18000,35999,36000]){
  await trains.evaluateAll((nodes,time)=>nodes.forEach(n=>{const a=n.getAnimations()[0];a.pause();a.currentTime=time}),time);
  await page.screenshot({path:out+'/after-logo-phase-'+time+'.png'});
 }
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await trains.first().evaluate(n=>getComputedStyle(n).animationName),'none');await page.screenshot({path:out+'/after-reduced-motion.png'});await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>window.draw(5,null));assert.equal(await page.locator('.wl-logo-layer').count(),0,'Missing logo creates no decorative layer');
 await page.evaluate(()=>window.draw(5,'/qa-poster'));await page.waitForTimeout(200);assert.equal(await page.locator('.wl-logo-layer').isVisible(),false,'Opaque art must not become a logo');
 for(const style of ['platform','screen','episode']){await page.evaluate(style=>window.draw(5,'/qa-logo',style),style);assert.equal(await page.locator('.wl-logo-layer').count(),0,'Other work layouts are unchanged');}
 await page.evaluate(()=>window.servers(false));await page.waitForTimeout(100);await page.screenshot({path:out+'/after-servers-off.png',fullPage:true});
 const friendsOff=await page.locator('.an-pick-together').boundingBox();
 await page.evaluate(async()=>{const{diagnosticsUi}=await import('/lib/diagnostics-ui.js');globalThis.Capacitor.Plugins.SystemUi.diagnostics=async()=>({debug:true,visible:true});await diagnosticsUi.setVisible(true)});
 const friendsOn=await page.locator('.an-pick-together').boundingBox();assert.deepEqual(friendsOn,friendsOff,'Diagnostics must not move friends button');assert.ok(friendsOn.x<195,'Friends action remains at physical left in RTL');
 await page.screenshot({path:out+'/after-servers-on.png',fullPage:true});
}
await writeFile(out+'/'+phase+'-measurements.json',JSON.stringify(measurements,null,2));
await page.evaluate(families=>{document.querySelector('.v35').innerHTML=Object.entries(families).map(([name,icons])=>'<h2 style="color:white;text-align:center">'+name+'</h2><div class="qa-icons">'+Object.entries(icons).map(([name,svg])=>'<div class="qa-icon"><button>'+svg+'</button>'+name+'</div>').join('')+'</div>').join('');},playerFamilies);
await page.setViewportSize({width:900,height:1050});await page.screenshot({path:out+'/'+phase+'-player-icons.png',fullPage:true});
await page.evaluate(()=>window.icons());await page.setViewportSize({width:900,height:1050});await page.screenshot({path:out+'/'+phase+'-icons.png',fullPage:true});await writeFile(out+'/'+phase+'-html.html',html);console.log('captured '+phase)}finally{await browser.close();server.close()}
