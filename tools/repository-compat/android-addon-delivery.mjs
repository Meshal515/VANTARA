#!/usr/bin/env node
/** Real Android WebView/Capacitor/addon/network UI proof. Only the anonymous
 * account shell is a fixture; every repository, installation and media is real.
 * Runs alongside LiveDeliveryUiDeviceTest, which observes the player selected
 * by these DOM clicks rather than creating a separate playback session.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const pkg='com.vantara.app.debug', phase=process.argv[2]||'fresh';
assert.ok(['fresh','restart'].includes(phase));
const out=process.env.VANTARA_DELIVERY_EVIDENCE||'addon-delivery-evidence';
await mkdir(out,{recursive:true});
const report={phase,platform:'Android emulator',account:'anonymous local shell fixture',backend:'real Capacitor and installed APK/CS3',checks:[],livePlayback:[],errors:[],physicalDevice:false};
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8',maxBuffer:8*1024*1024}).trim();
const read=name=>JSON.parse(adb('shell','run-as',pkg,'cat',`files/debug-ui-delivery/${name}`));
async function until(fn,label,ms=45000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){last=e;}await delay(250);}throw new Error(`${label}: ${last?.message||'deadline exceeded'}`);}
const ready=await until(()=>{const r=read('ready.json');return r.phase===phase&&r;},'real instrumentation ready',120000);
assert.ok(Number.isInteger(ready.pid));
adb('forward','tcp:9223',`localabstract:webview_devtools_remote_${ready.pid}`);
const target=await until(async()=>{const pages=await(await fetch('http://127.0.0.1:9223/json')).json();return pages.find(p=>p.type==='page'&&p.url.startsWith('https://localhost'));},'actual application WebView');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let seq=0;const pending=new Map();
socket.onmessage=({data})=>{const m=JSON.parse(data);const job=pending.get(m.id);if(job){pending.delete(m.id);clearTimeout(job.timer);m.error?job.reject(Error(m.error.message)):job.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')report.errors.push(String(m.params.exceptionDetails.text));};
function command(method,params={},ms=150000){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP ${method} timeout`));},ms);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
const invoke=(fn,arg)=>evaluate(`(${fn.toString()})(${JSON.stringify(arg)})`);
async function screenshot(name){const r=await command('Page.captureScreenshot',{format:'png'});await writeFile(`${out}/${phase}-${name}.png`,Buffer.from(r.data,'base64'));}
let observing=false,finished=false;
async function observer(value){observing=true;try{const id=`${phase}-${Date.now()}-${++seq}`;execFileSync('adb',['shell',`run-as ${pkg} sh -c 'cat > files/debug-ui-delivery/command.json'`],{input:JSON.stringify({id,...value}),encoding:'utf8'});const r=await until(()=>{const r=read('response.json');return r.id===id&&r;},'native playback observer',65000);assert.equal(r.status,'PASS',JSON.stringify(r));return r;}finally{observing=false;}}
const heartbeat=setInterval(()=>{if(!observing){try{execFileSync('adb',['shell',`run-as ${pkg} sh -c 'cat > files/debug-ui-delivery/command.json'`],{input:JSON.stringify({id:'heartbeat-'+Date.now(),action:'ping'}),encoding:'utf8'});}catch{}}},45000);
async function openManager(){await evaluate(`(()=>{window.__deliveryShell.showPage('home');document.querySelector('[data-act="openDrawer"]').click();const b=[...document.querySelectorAll('.drawer-item')].find(b=>b.textContent.trim()==='الإضافات');if(!b)throw Error('Addons navigation missing');b.click()})()`);await until(()=>evaluate(`!!document.querySelector('#utility.active .v7-addon')`),'production addon manager');}
async function browse(name){await openManager();await until(()=>invoke(name=>{const row=[...document.querySelectorAll('.v7-body .v7-row')].find(r=>r.querySelector('.v7-name')?.textContent===name);if(!row)return false;row.querySelector('.v7-go').click();return true;},name),'saved repository '+name);}
async function row(name){return until(()=>invoke(name=>{const r=[...document.querySelectorAll('.v7-body .v7-row')].find(r=>r.querySelector('.v7-name')?.textContent===name);if(!r)return false;r.scrollIntoView({block:'center'});return {button:r.querySelector('.v7-flip')?.textContent,icon:r.querySelector('img')?.currentSrc||null};},name),'repository item '+name,90000);}
async function install(name,{cinema=false}={}){await row(name);await invoke(({name,cinema})=>{const r=[...document.querySelectorAll('.v7-body .v7-row')].find(r=>r.querySelector('.v7-name')?.textContent===name);window.__deliveryInstall={row:r,manager:r.closest('.v7-addon'),scroll:window.scrollY};if(cinema){r.click();const b=[...document.querySelectorAll('.v7-dialog button')].find(b=>b.textContent==='ثبّت في السينما');if(!b)throw Error('Cinema install choice missing');b.click();}else r.querySelector('.v7-flip').click();},{name,cinema});await until(()=>invoke(name=>{const r=[...document.querySelectorAll('.v7-body .v7-row')].find(r=>r.querySelector('.v7-name')?.textContent===name);return r?.querySelector('.v7-flip')?.textContent==='فتح';},name),'durable install '+name,180000);await delay(800);const state=await evaluate(`({sameRow:__deliveryInstall.row.isConnected,sameManager:__deliveryInstall.manager.isConnected,scrollBefore:__deliveryInstall.scroll,scrollAfter:scrollY})`);assert.ok(state.sameRow&&state.sameManager,'Installation replaced repository view');report.checks.push({operation:'real UI install',name,...state});await screenshot('installed-'+report.checks.length);}
async function openSource(name){await row(name);await invoke(name=>{const r=[...document.querySelectorAll('.v7-body .v7-row')].find(r=>r.querySelector('.v7-name')?.textContent===name);r.querySelector('.v7-flip').click();},name);await until(()=>evaluate(`!!document.querySelector('.addon-source-home,.addon-source')`),'source catalogue '+name,45000);await until(()=>evaluate(`!!document.querySelector('.addon-source-home .an-card,.addon-source-home .addon-home-billboard,.addon-source .up-card')`),'live source catalogue work '+name,40000);}
async function sourceWork(sourceId){const info=await invoke(async sourceId=>{const engine=Capacitor.Plugins.AnimeEngine;const r=await engine.page({sourceId,listing:'popular',page:1,query:''});const items=r.page?.items;if(!items?.length)throw Error('No live native catalogue work');return {item:items[0],items:items.length};},sourceId);return info;}
async function clickSourceWork(title){await invoke(title=>{window.__deliveryWantedTitle=title;},title);await evaluate(`(()=>{const c=[...document.querySelectorAll('.addon-source-home .an-card,.addon-source-home .addon-home-billboard,.addon-source .up-card')].find(c=>c.getAttribute('aria-label')===window.__deliveryWantedTitle||c.textContent.includes(window.__deliveryWantedTitle));if(!c)throw Error('Real catalogue card missing');c.scrollIntoView({block:'center'});c.click()})()`);await until(async()=>{const stage=await evaluate(`(()=>{if(document.querySelector('#anime.active .aw-play,#cinema.active .cn-btn--play.cn-btn--block,.addon-source-choices'))return 'work';const sheet=document.querySelector('#sheet:not([hidden]) #sheetBody');if(sheet?.querySelector('h3')?.textContent==='اختر الموسم'){const choices=[...sheet.querySelectorAll('button.sheet-item')];const first=choices.find(b=>/(?:^|\\s)1(?:\\s|$)/.test(b.textContent))||choices[0];first?.click();return 'season';}return null})()`);return stage==='work';},'live work details',60000);const choice=await evaluate(`!!document.querySelector('.addon-source-choices')`);assert.equal(choice,false,'Unexpected unresolved source selection');const seasons=await evaluate(`!![...document.querySelectorAll('.sheet button')].find(b=>/الموسم/.test(b.textContent))`);if(seasons)await evaluate(`[...document.querySelectorAll('.sheet button')].find(b=>/الموسم.*1/.test(b.textContent))?.click()`);}
async function resetTrace(){await evaluate(`(async()=>{await window.__deliveryRouteHandle?.remove?.();await window.__deliveryPreparedHandle?.remove?.();window.__deliveryRoutes={};window.__deliverySessions={};const p=Capacitor.Plugins.AnimeEngine;window.__deliveryRouteHandle=await p.addListener('route',e=>{if(e.route)__deliveryRoutes[e.route.id]={...e.route,session:e.session,addonGeneration:e.addonGeneration,at:Date.now()};});window.__deliveryPreparedHandle=await p.addListener('prepared',e=>{__deliverySessions[e.session]={session:e.session,addonGeneration:e.addonGeneration,at:Date.now()};});})()`);}
async function sheetAndPlay(sourceId,label){
  await evaluate(`(()=>{const b=document.querySelector('#anime.active .aw-play,#cinema.active .cn-btn--play.cn-btn--block');if(!b)throw Error('Actual work play button missing');b.click()})()`);
  const route=await until(()=>invoke(async sourceId=>{
    const plugin=Capacitor.Plugins.AnimeEngine;
    for(const s of Object.values(window.__deliverySessions||{}).sort((a,b)=>b.at-a.at)){
      const snap=await plugin.routes({session:s.session});
      for(const r of snap.routes||[])if(r.sourceId===sourceId)__deliveryRoutes[r.id]={...r,...s};
    }
    const r=Object.values(window.__deliveryRoutes||{}).sort((a,b)=>b.at-a.at).find(r=>r.sourceId===sourceId&&r.state==='READY'&&r.probed===true&&r.candidates?.length);
    return r?{id:r.id,sourceId:r.sourceId,session:r.session,addonGeneration:r.addonGeneration,candidate:r.candidates[0],quality:r.quality}:null;
  },sourceId),'probed real route reaches '+label,100000);
  await until(()=>evaluate(`!!document.querySelector('.an-srv--ready:not([disabled])')`),'ready route in server sheet',20000);
  await screenshot(label+'-server-sheet');const spinner=await evaluate(`document.querySelector('.an-srv-status')?.textContent||''`);
  await evaluate(`(()=>{const b=document.querySelector('.an-srv--ready:not([disabled])');b.scrollIntoView({block:'center'});b.click()})()`);
  const measured=await observer({action:'observe',sourceId,session:route.session,addonGeneration:route.addonGeneration});
  report.livePlayback.push({entry:label,route:{id:route.id,sourceId:route.sourceId,session:route.session,addonGeneration:route.addonGeneration,quality:route.quality},serverSheetStatus:spinner,facts:measured.facts});adb('shell','input','keyevent','4');await delay(1200);
}
async function generalWork(item,sourceId,kind){
  await resetTrace();
  const result=await invoke(async({item,kind})=>{
    const norm=s=>String(s||'').toLowerCase().replace(/\b(\d+)(st|nd|rd|th)\b/g,'$1').replace(/[^\p{L}\p{N}]/gu,'');
    if(kind==='anime'){
      const meta=await import('/lib/anime-meta.js');const found=await meta.searchAnime({search:item.title});
      const exact=(found.items||[]).find(m=>[m.title,m.romaji,m.native,...(m.synonyms||[])].some(t=>norm(t)===norm(item.title)));
      if(!exact)throw Error('GENERAL_METADATA_MAPPING_BLOCKED: no exact AniList counterpart');
      window.__deliveryShell.openRef('anime:'+exact.id,exact.title,exact.poster);return {metadata:'AniList',id:exact.id,title:exact.title};
    }
    const meta=await import('/lib/cinema-meta.js');
    const slug=decodeURIComponent(item.url||'').split('/').filter(Boolean).at(-1)?.replace(/[-_]/g,' ');
    const queries=[item.title,slug].filter(Boolean);let exact;
    for(const query of queries){const found=await meta.search(query);exact=found.find(m=>norm(m.title)===norm(item.title)||norm(m.title)===norm(slug));if(exact)break;}
    if(!exact)throw Error('GENERAL_METADATA_MAPPING_BLOCKED: no exact Cinemeta counterpart');
    window.__deliveryShell.openRef('cinema:'+exact.id,exact.title,exact.poster);return {metadata:'Cinemeta',id:exact.id,title:exact.title};
  },{item,kind});
  report.checks.push({operation:'same real work in general metadata',...result});
  await until(()=>evaluate(`!!document.querySelector('#anime.active .aw-play,#cinema.active .cn-btn--play.cn-btn--block')`),'general work renderer',60000);
  await sheetAndPlay(sourceId,kind+'-general');
}
try{
  await command('Runtime.enable');
  await until(()=>evaluate(`!!document.querySelector('#root .gate button,#root .v35,#root .vpin')`),'mounted real app');
  const repos=await evaluate(`(async()=>{const m='https://github.com/keiyoushi/extensions/raw/repo/index.pb',a='https://github.com/yuzono/anime-repo/raw/repo/index.pb',c='https://raw.githubusercontent.com/mo7AmMeD64/cs-ar/main/repo/repo.json';await Capacitor.Plugins.VantaraRuntime.setProfile({profile:'local'});if(${JSON.stringify(phase)}==='fresh'){await Capacitor.Plugins.ExtensionEngine.addRepo({url:m});await Capacitor.Plugins.AnimeEngine.addRepo({url:a});await Capacitor.Plugins.VantaraRuntime.addRepository({url:c});}const mg=await Capacitor.Plugins.ExtensionEngine.repos(),an=await Capacitor.Plugins.AnimeEngine.repos(),cs=await Capacitor.Plugins.VantaraRuntime.list();const mi=await Capacitor.Plugins.ExtensionEngine.repoIndex({url:m}),ai=await Capacitor.Plugins.AnimeEngine.repoIndex({url:a}),ci=await Capacitor.Plugins.VantaraRuntime.extensions({url:c});return {manga:mg.repos[0].name,anime:an.repos[0].name,cloud:cs.repos[0].name,mangaPackage:mi.extensions.find(e=>e.pkg==='eu.kanade.tachiyomi.extension.ar.manhatok'),animePackage:ai.extensions.find(e=>e.pkg.endsWith('.ar.asia2tv')),cloudPackage:ci.extensions.find(e=>/witcher/i.test(e.name))};})()`);
  await evaluate(`(async()=>{window.__deliveryShell?.destroy?.();const sync={user:null,ready:Promise.resolve(),rows:()=>[],row:()=>null,onChange:()=>()=>{},enqueue:()=>{},translation:async()=>({status:200,body:{rows:[]}}),latestSnapshots:async()=>({sources:[]}),presence:async()=>[],stats:async()=>({}),insights:async()=>({}),topWorks:async()=>[],pendingDevices:async()=>[],privacyCapability:async()=>({}),authorizationHeader:null};const ent=await import('/lib/source-entitlement.js');ent.setEntitlement({state:'clean',added:new Set(),removed:new Set()});const {mountV35}=await import('/v35/shell.js');window.__deliveryShell=mountV35({sync,mount:n=>document.querySelector('#root').replaceChildren(n),go:async()=>{},friends:()=>[],presence:async()=>[],version:'actual-native-delivery-QA',switchAccount:()=>{},openReader:()=>{}},{page:'home'});})()`);
  if(phase==='fresh'){
    await browse(repos.manga);await install(repos.mangaPackage.name);
    const icon=await invoke(name=>{const r=[...document.querySelectorAll('.v7-body .v7-row')].find(r=>r.querySelector('.v7-name')?.textContent===name);const i=r.querySelector('img');return {decoded:!!i?.complete&&i.naturalWidth>0,width:i?.naturalWidth};},'Manhatok');assert.ok(icon.decoded,'Real installed Manhatok icon not decoded');report.checks.push({operation:'Manhatok icon',...icon});
    await browse(repos.anime);await install(repos.animePackage.name,{cinema:true});
    await browse(repos.cloud);await install(repos.cloudPackage.name);
  }
  const sources=await evaluate(`(async()=>{const out=await Capacitor.Plugins.AnimeEngine.sources();return out.sources.map(s=>({id:s.id,pkg:s.pkg,label:s.label,name:s.name,content:s.content}));})()`);
  const ani=sources.find(s=>s.pkg===repos.animePackage.pkg||/asia2tv/i.test(s.id)),cs=sources.find(s=>s.id.startsWith('addon|cs3|'+repos.cloudPackage.pkg+'|'));assert.ok(ani&&cs,'Installed native sources missing');
  const general=[];
  for(const [source,name,repo,kind] of [[ani,repos.animePackage.name,repos.anime,'cinema'],[cs,repos.cloudPackage.name,repos.cloud,'anime']]){
    try {await browse(repo);const original=await sourceWork(source.id);await openSource(name);await resetTrace();await clickSourceWork(original.item.title);await sheetAndPlay(source.id,kind+'-source');general.push({item:original.item,sourceId:source.id,kind});}
    catch(error){report.checks.push({operation:kind+'-source',result:'FAIL',error:String(error.message).replace(/https?:\/\/\S+/g,'[url]')});}
  }
  for(const entry of general){try{await generalWork(entry.item,entry.sourceId,entry.kind);}catch(error){report.checks.push({operation:entry.kind+'-general',result:'BLOCKED_OR_FAIL',error:String(error.message).replace(/https?:\/\/\S+/g,'[url]')});}}
  assert.equal(report.livePlayback.length,4,'Four real source/general playback observations required');report.retention=await observer({action:'finish'});finished=true;report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error?.stack||error).replace(/https?:\/\/\S+/g,'[url]');try{await screenshot('failure');report.visibleFailure=await evaluate(`document.body.innerText.slice(-3500)`);}catch{}if(!finished)try{await observer({action:'finish'});}catch{}throw error;
}finally{clearInterval(heartbeat);await writeFile(`${out}/${phase}-ui-proof.json`,JSON.stringify(report,null,2)+'\n');for(const p of pending.values())clearTimeout(p.timer);socket.close();adb('forward','--remove','tcp:9223');}
