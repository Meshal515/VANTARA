#!/usr/bin/env node
/** Real Chromium checks of the production shell/manager/native JS wrappers.
 * Only Capacitor's backend and anonymous sync are fixtures. No APK executes here.
 * Usage: VANTARA_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/repository-compat/playwright-addon-manager.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const webRoot=path.join(repositoryRoot,'apps/web');
const evidence=process.env.VANTARA_PLAYWRIGHT_EVIDENCE||'addon-delivery-evidence/browser-fixture';
const publisherIcon='https://cdn.jsdelivr.net/gh/keiyoushi/extensions-source@main/src/ar/manhatok/res/mipmap-xhdpi/ic_launcher.png';
const iconPath=process.env.VANTARA_MANHATOK_ICON||null;
async function publisherImage(){
  if(iconPath)return readFile(iconPath);
  const response=await fetch(publisherIcon,{signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,'Actual declared publisher icon');
  const parts=[];let size=0;
  try{for await(const part of response.body){size+=part.length;assert.ok(size<=65536,'Publisher icon byte limit');parts.push(part);}}
  catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  return Buffer.concat(parts,size);
}
const icon=await publisherImage();
assert.equal(icon.readUInt32BE(16),96,'Publisher Manhatok PNG width');assert.equal(icon.readUInt32BE(20),96,'Publisher Manhatok PNG height');
const png='data:image/png;base64,'+icon.toString('base64');
const playwrightModule=process.env.VANTARA_PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(path.isAbsolute(playwrightModule)?pathToFileURL(playwrightModule).href:playwrightModule);
await mkdir(evidence,{recursive:true});

async function browserFixture({png,publisherIcon}){
  const target='eu.kanade.tachiyomi.extension.ar.manhatok',retry='qa.manager.retry',existing='qa.manager.existing';
  const repo='https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.pb';
  const state={calls:[],installed:[{pkg:existing,name:'Man Existing (QA fixture)',version:'1',repo,installed:'1'}],pending:new Map(),offline:false,failNext:null};
  const rows=Array.from({length:70},(_,i)=>({pkg:'qa.manager.filler'+i,name:'Man QA filler '+String(i).padStart(2,'0'),lang:'ar',version:'1',nsfw:false,anime:false,iconUrl:null}));
  rows.splice(35,0,{pkg:target,name:'Manhatok',lang:'ar',version:'1.6.16',nsfw:false,anime:false,iconUrl:publisherIcon});
  rows.splice(36,0,{pkg:retry,name:'Man Retry (QA fixture)',lang:'ar',version:'1',nsfw:false,anime:false});
  rows.unshift({pkg:existing,name:'Man Existing (QA fixture)',lang:'ar',version:'1',nsfw:false,anime:false});
  const record=(pkg)=>state.installed.find(x=>x.pkg===pkg);
  const engine={
    addRepo:async()=>{},
    repos:async()=>{state.calls.push({method:'repos'});return {repos:[{url:repo,name:'Keiyoushi'}],installed:structuredClone(state.installed),readyCatalogDismissed:true};},
    repoIndex:async()=>{state.calls.push({method:'repoIndex',offline:state.offline});if(state.offline)throw Error('QA fixture repository offline');return {extensions:rows.map(x=>({...x,installed:record(x.pkg)?.version||null}))};},
    sources:async()=>{state.calls.push({method:'sources'});return {sources:state.installed.map(x=>({id:x.pkg+'#1',pkg:x.pkg,label:x.name,version:x.version,user:true,lang:'ar',ready:false,artifactPresent:true,installedVersion:x.version,...(x.iconUrl?{iconUrl:x.iconUrl}:{})}))};},
    installExtension:async({pkg})=>{state.calls.push({method:'installExtension',pkg});if(state.failNext===pkg){state.failNext=null;throw Error('QA controlled install failure');}return new Promise((resolve,reject)=>state.pending.set(pkg,{resolve,reject}));},
    uninstallExtension:async({pkg})=>{state.installed=state.installed.filter(x=>x.pkg!==pkg);return {ok:true};},
    prepare:async({sourceId})=>{state.calls.push({method:'prepare',sourceId});return {ok:true};},
    catalogue:async()=>({mangas:[],hasNextPage:false}),popular:async()=>({mangas:[],hasNextPage:false}),latest:async()=>({mangas:[],hasNextPage:false}),search:async()=>({mangas:[],hasNextPage:false}),
  };
  window.__qa={state,target,retry,existing,repo,publisherIcon,png,errors:[],shellReady:false,
    confirm(pkg){const item=rows.find(x=>x.pkg===pkg);state.installed=state.installed.filter(x=>x.pkg!==pkg);state.installed.push({...item,version:item.version,repo,installed:item.version,...(pkg===target?{iconUrl:png}:{})});const job=state.pending.get(pkg);state.pending.delete(pkg);job?.resolve({ok:true,sources:1});},
  };
  addEventListener('error',e=>window.__qa.errors.push(String(e.error?.stack||e.message)));
  addEventListener('unhandledrejection',e=>window.__qa.errors.push(String(e.reason?.stack||e.reason)));
  window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',Plugins:{ExtensionEngine:engine,AddonEngine:{request:async()=>({text:'{}'}),cancel:async()=>({})}}};
  const entitlement=await import('/lib/source-entitlement.js');entitlement.setEntitlement({state:'clean',added:new Set(),removed:new Set()});
  const sync={user:null,rows:()=>[],row:()=>null,onChange:()=>()=>{},enqueue:()=>{},translation:async()=>({status:200,body:{rows:[]}}),latestSnapshots:async()=>({sources:[]}),presence:async()=>[],stats:async()=>({}),insights:async()=>({}),topWorks:async()=>[],pendingDevices:async()=>[],privacyCapability:async()=>({}),authorizationHeader:null};
  try{
    const {mountV35}=await import('/v35/shell.js');
    window.__qa.shell=mountV35({sync,mount:node=>document.querySelector('#root').replaceChildren(node),go:async()=>{},friends:()=>[],presence:async()=>[],version:'qa-controlled-native-backend',switchAccount:()=>{},openReader:()=>{}},{page:'home'});
    window.__qa.shellReady=true;
  }catch(error){window.__qa.errors.push(String(error.stack||error));window.__qa.bootError=String(error);}
}
const fixtureSource=`(${browserFixture.toString()})(${JSON.stringify({png,publisherIcon})});`;
const html=(await readFile(path.join(webRoot,'index.html'),'utf8')).replace('<script type="module" src="/app.js"></script>','<script type="module" src="/__qa/main.js"></script>');
const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}
  if(url.pathname==='/__qa/main.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(fixtureSource);return;}
  const local=path.resolve(webRoot,'.'+decodeURIComponent(url.pathname));
  if(!local.startsWith(webRoot+path.sep)){res.writeHead(403);res.end();return;}
  try{const bytes=await readFile(local);res.writeHead(200,{'content-type':mime[path.extname(local)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const report={startedAt:new Date().toISOString(),origin,browser:'Chromium',productionShell:true,productionManager:true,productionNativeWrappers:true,backend:'controlled Capacitor.ExtensionEngine fixture',anonymousSyncFixture:true,liveExtensionExecuted:false,actualAndroidBackend:false,publisherIcon:{path:iconPath,url:publisherIcon,width:96,height:96},checks:[],screenshots:[],passed:false};
let browser,page;
const check=async(name,work)=>{const started=Date.now();const detail=await work();report.checks.push({name,passed:true,milliseconds:Date.now()-started,...(detail?{detail}:{})});console.log('PASS '+name);};
const screenshot=async(name)=>{const file=path.join(evidence,name+'.png');await page.screenshot({path:file,fullPage:false});report.screenshots.push(file);};
const installedCount=()=>page.locator('.v7-tab').filter({hasText:'المثبتة'}).locator('.v7-count');
const sourceRow=name=>page.locator('.v7-body .v7-row').filter({has:page.locator('.v7-name',{hasText:name})});
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:1,reducedMotion:'reduce'});
 page=await context.newPage();
 page.on('pageerror',error=>{report.pageErrors??=[];report.pageErrors.push(String(error));});
 await page.route('https://**/*',async route=>route.request().url()===publisherIcon?route.fulfill({status:200,contentType:'image/png',body:icon}):route.fulfill({status:404,body:''}));
 await page.goto(origin,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__qa?.shellReady,{timeout:20000});
 await check('full shipped shell opens Add-ons through the drawer',async()=>{
   await page.locator('.page.active [data-act="openDrawer"]').first().click();
   await page.locator('.drawer-item').filter({hasText:/^الإضافات$/}).click();
   await page.locator('#utility.active .v7-addon').waitFor();
   await page.locator('.v7-row').filter({hasText:'Keiyoushi'}).waitFor();
   assert.equal(await installedCount().textContent(),'1');
   await page.locator('.v7-row').filter({hasText:'Keiyoushi'}).getByRole('button',{name:'استعراض Keiyoushi'}).click();
   await sourceRow('Manhatok').waitFor();
 });
 await check('existing durable installation is Open and missing package is Install',async()=>{
   assert.equal(await sourceRow('Man Existing').locator('.v7-flip').getAttribute('aria-label'),'فتح Man Existing (QA fixture)');
   assert.equal(await sourceRow('Manhatok').locator('.v7-flip').getAttribute('aria-label'),'تثبيت Manhatok');
 });
 await check('repository search and type filter produce a scrollable real source list',async()=>{
   await page.locator('[data-addon-search]').fill('Man');
   await page.locator('.v7-filter').click();await page.locator('.v7-menu button').filter({hasText:/^مانجا$/}).click();
   await sourceRow('Manhatok').scrollIntoViewIfNeeded();
   await page.evaluate(()=>{const target=[...document.querySelectorAll('.v7-body .v7-row')].find(x=>x.querySelector('.v7-name')?.textContent==='Manhatok');const other=target.nextElementSibling;window.__qa.original={manager:document.querySelector('.v7-addon'),row:target,other,flip:target.querySelector('.v7-flip'),search:document.querySelector('[data-addon-search]'),scrollY:scrollY,scrollTop:document.scrollingElement.scrollTop};});
   const info=await page.evaluate(()=>({rows:document.querySelectorAll('.v7-body .v7-row').length,scrollY,search:document.querySelector('[data-addon-search]').value,type:document.querySelector('.v7-filter').textContent.trim(),icon:window.__qa.original.row.querySelector('img')?.src}));
   assert.ok(info.rows>=70);assert.ok(info.scrollY>200);assert.equal(info.icon,publisherIcon);await page.waitForFunction(()=>window.__qa.original.row.querySelector('img')?.naturalWidth===96);return info;
 });
 await screenshot('01-before-install');
 await check('install stays pending until the durable backend confirms it and other rows remain usable',async()=>{
   await sourceRow('Manhatok').locator('.v7-flip').click();
   await page.waitForFunction(()=>window.__qa.state.calls.some(x=>x.method==='installExtension'));
   await page.evaluate(()=>window.__qa.original.flip.click());
   const state=await page.evaluate(()=>({calls:window.__qa.state.calls.filter(x=>x.method==='installExtension'&&x.pkg===window.__qa.target).length,disabled:window.__qa.original.flip.disabled,installed:window.__qa.original.flip.classList.contains('installed'),otherDisabled:window.__qa.original.other.querySelector('.v7-flip').disabled,rowSame:window.__qa.original.row.isConnected}));
   assert.equal(state.calls,1);assert.equal(state.disabled,true);assert.equal(state.installed,false);assert.equal(state.otherDisabled,false);assert.equal(state.rowSame,true);assert.equal(await installedCount().textContent(),'1');await page.evaluate(()=>window.__qa.original.other.click());assert.equal(await page.locator('.v7-layer').isVisible(),true);assert.ok((await page.locator('.v7-dialog').textContent()).includes('Man Retry'));await page.locator('.v7-dialog-actions button').filter({hasText:/^رجوع$/}).click();await page.evaluate(()=>window.__qa.original.search.focus({preventScroll:true}));return {...state,otherRowDetailsOpenedWhilePending:true};
 });
 await screenshot('02-pending-confirmation');
 await check('durable install updates the same row, icon, count and Open control without remount after notification',async()=>{
   await page.evaluate(()=>window.__qa.confirm(window.__qa.target));
   await page.waitForFunction(()=>window.__qa.original.flip.classList.contains('installed'));
   await page.waitForTimeout(850);
   const state=await page.evaluate(()=>{const old=window.__qa.original,current=document.querySelector('.v7-addon');return {managerSame:current===old.manager,rowSame:old.row.isConnected,otherRowSame:old.other.isConnected,flipSame:old.row.querySelector('.v7-flip')===old.flip,searchSame:document.querySelector('[data-addon-search]')===old.search,focusPreserved:document.activeElement===old.search,search:document.querySelector('[data-addon-search]').value,type:document.querySelector('.v7-filter').textContent.trim(),scrollY,originalScrollY:old.scrollY,icon:old.row.querySelector('img')?.src,iconDecoded:!!old.row.querySelector('img')?.naturalWidth,open:old.flip.getAttribute('aria-label'),installCalls:window.__qa.state.calls.filter(x=>x.method==='installExtension'&&x.pkg===window.__qa.target).length};});
   report.installState=state;
   assert.equal(state.managerSame,true,'onSourcesChanged remounted the production Add-ons manager');assert.equal(state.rowSame,true);assert.equal(state.otherRowSame,true);assert.equal(state.flipSame,true);assert.equal(state.searchSame,true);assert.equal(state.focusPreserved,true,'Pending-install interaction lost focus');assert.equal(state.search,'Man');assert.equal(state.type,'مانجا');assert.ok(Math.abs(state.scrollY-state.originalScrollY)<=2,'Scroll position changed');assert.equal(state.icon,png);assert.equal(state.iconDecoded,true);assert.equal(state.open,'فتح Manhatok');assert.equal(state.installCalls,1);assert.equal(await installedCount().textContent(),'2');return {...state,icon:'verified publisher PNG supplied as installed metadata fixture'};
 });
 await screenshot('03-confirmed-same-row');
 await check('a failed install preserves the row and offers a successful retry',async()=>{
   await sourceRow('Man Retry').scrollIntoViewIfNeeded();
   await page.evaluate(()=>{window.__qa.state.failNext=window.__qa.retry;window.__qa.retryRow=[...document.querySelectorAll('.v7-row')].find(x=>x.querySelector('.v7-name')?.textContent==='Man Retry (QA fixture)');});
   await sourceRow('Man Retry').locator('.v7-flip').click();await page.locator('.v7-diagnostic').filter({hasText:'QA controlled install failure'}).waitFor();
   assert.equal(await sourceRow('Man Retry').locator('.v7-flip').isEnabled(),true);assert.equal(await installedCount().textContent(),'2');
   await sourceRow('Man Retry').locator('.v7-flip').click();await page.waitForFunction(()=>window.__qa.state.pending.has(window.__qa.retry));
   await page.evaluate(()=>window.__qa.confirm(window.__qa.retry));await page.waitForFunction(()=>window.__qa.retryRow.querySelector('.v7-flip').classList.contains('installed'));await page.waitForTimeout(600);
   assert.equal(await page.evaluate(()=>window.__qa.retryRow.isConnected),true);assert.equal(await installedCount().textContent(),'3');
 });
 await screenshot('04-retried-success');
 await check('installed tab and icons stay stable when the repository index is offline',async()=>{
   await page.evaluate(()=>{window.__qa.state.offline=true;document.querySelector('.v7-addon').reload();});
   await page.waitForFunction(()=>document.querySelector('.v7-diagnostic')?.textContent.includes('QA fixture repository offline'));
   assert.equal(await installedCount().textContent(),'3');
   await page.locator('.v7-tab').filter({hasText:'المثبتة'}).click();await sourceRow('Manhatok').waitFor();
   assert.equal(await sourceRow('Manhatok').locator('.v7-flip').getAttribute('aria-label'),'فتح Manhatok');assert.equal(await sourceRow('Manhatok').locator('img').getAttribute('src'),png);assert.equal(await page.locator('.v7-body .v7-row').count(),3);
 });
 await screenshot('05-offline-installed');
 report.backendCalls=await page.evaluate(()=>window.__qa.state.calls);report.browserErrors=await page.evaluate(()=>window.__qa.errors);assert.deepEqual(report.browserErrors,[]);
 report.passed=true;
}catch(error){report.failure=String(error.stack||error);if(page){report.browserErrors=await page.evaluate(()=>window.__qa?.errors||[]).catch(()=>[]);await screenshot('failure').catch(()=>{});}console.error(report.failure);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log('Evidence '+path.join(evidence,'report.json'));await browser?.close();await new Promise(resolve=>server.close(resolve));}
