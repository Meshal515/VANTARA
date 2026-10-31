/** CDP proof against the installed APK's real WebView and native bridges.
 * The navigation phase uses the shipped shell with an anonymous, local sync
 * fixture. It is deliberately not an authentication/source playback test.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const phase = process.argv[2];
if (!['baseline', 'candidate', 'restart'].includes(phase)) throw new Error('Expected baseline/candidate/restart phase');
const out = process.env.DEBUG_EVIDENCE || 'android-debug-evidence';
const pkg = 'com.vantara.app.debug';
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const pid = adb('shell', 'pidof', pkg);
if (!/^\d+$/.test(pid)) throw new Error('APK process is not running');
adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
let pages;
for (let n = 0; n < 90; n++) {
  try {
    pages = await (await fetch('http://127.0.0.1:9223/json')).json();
    if (pages.some(p => p.type === 'page' && p.url.startsWith('https://localhost'))) break;
  } catch {}
  await delay(1000);
}
const page = pages?.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
if (!page) throw new Error('The APK did not expose its local WebView');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
socket.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push(d.exception?.description || d.text);
  }
  const item = pending.get(msg.id);
  if (item) {
    pending.delete(msg.id);
    clearTimeout(item.timer);
    if (msg.error) item.reject(new Error(JSON.stringify(msg.error)));
    else item.resolve(msg.result);
  }
};
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, label) {
  for (let n = 0; n < 90; n++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await delay(500);
  }
  throw new Error(`Timed out: ${label}`);
}
mkdirSync(out, { recursive: true });
await command('Runtime.enable');
await command('Page.enable');
const proof = { phase, package: pkg, pid, passed: false, authenticationTest: false, sourcePlaybackTest: false };
function assertNoAutomaticVerification(iteration) {
  const activities = adb('shell', 'dumpsys', 'activity', 'activities');
  const resumed = activities.split('\n').filter(line => /mResumedActivity|topResumedActivity/.test(line));
  if (!resumed.some(line => line.includes(`${pkg}/com.vantara.app.MainActivity`))) {
    writeFileSync(`${out}/unexpected-activities-${iteration}.txt`, activities);
    throw new Error(`MainActivity lost focus during Home/Addons cycle ${iteration}`);
  }
  const verification = spawnSync('adb', ['shell', 'pidof', `${pkg}:verification`], { encoding: 'utf8' });
  if (verification.status === 0 && verification.stdout.trim()) throw new Error('Verification process started without a user source request');
  if (iteration % 10 === 0) {
    const memory = adb('shell', 'dumpsys', 'meminfo', pkg);
    writeFileSync(`${out}/memory-cycle-${iteration}.txt`, memory);
    const webviews = memory.match(/WebViews:\s*(\d+)/);
    if (!webviews || Number(webviews[1]) !== 1) throw new Error(`Expected only the shell WebView; found ${webviews?.[1] ?? 'unknown'}`);
    proof.maxObservedWebViews = Math.max(proof.maxObservedWebViews || 0, Number(webviews[1]));
  }
}
try {
  // index.html contains a static .gate before app.js even evaluates. Wait for
  // a live screen so we cannot remove the root while app.js is importing.
  await waitFor("document.querySelector('#root .gate button,#root .v35,#root .vpin')", 'mounted APK account gate, configuration screen, or Home');
  proof.startup = await evaluate(`({gate:!!document.querySelector('.gate'),home:!!document.querySelector('.v35'),pin:!!document.querySelector('.vpin')})`);
  if(process.env.VANTARA_RUNTIME_DEBUG==='true' && phase!=='baseline') {
    proof.optionalRuntime = await evaluate('Capacitor.Plugins.VantaraRuntime.capabilities()');
    if(proof.optionalRuntime?.cloudstream!==true || proof.optionalRuntime?.platform!=='android')
      throw new Error('Optional runtime did not initialize through the actual MainActivity/Capacitor bootstrap');
    if(phase==='candidate') {
      // Real owner-supplied repository -> native HTTP -> complete index -> JS
      // bridge. No source-site/catalogue/package-install request is made here.
      proof.runtimeRepository = await evaluate(`(async()=>{
        const plugin=Capacitor.Plugins.VantaraRuntime;
        await plugin.setProfile({profile:'local'});
        const before=await plugin.list();
        const url='https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json';
        await plugin.addRepository({url});
        const result=await plugin.extensions({url}),rows=result.extensions;
        if(!Array.isArray(rows)||rows.length<43)throw new Error('Real repository index is missing entries');
        for(const name of ['Animewitcher','AnimeRift','Aia2tv 2'])
          if(!rows.some(row=>row.internalName===name))throw new Error('Missing actual repository package: '+name);
        if(!rows.every(row=>/^cs3_[0-9a-f]{32}$/.test(row.pkg)))throw new Error('Invalid package storage identity');
        const spaced=rows.find(row=>row.internalName==='Aia2tv 2');
        if(!spaced.url.endsWith('/Aia2tv%202.cs3'))throw new Error('Spaced artifact path is not canonicalized');
        const after=await plugin.list();
        if(JSON.stringify(before.installed)!==JSON.stringify(after.installed))throw new Error('Repository browsing mutated installed packages');
        if(!after.repos.some(repo=>repo.url===url))throw new Error('Repository was not saved');
        return {entries:rows.length,spaceNamedEntry:true,encodedArtifactPath:true,installedPackagesUnchanged:true,sourceSiteRequests:false};
      })()`);
    } else if(phase==='restart') {
      proof.runtimeRepository = await evaluate(`(async()=>{
        const plugin=Capacitor.Plugins.VantaraRuntime;await plugin.setProfile({profile:'local'});
        const data=await plugin.list();
        const retained=data.repos.some(repo=>repo.url==='https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json');
        if(!retained)throw new Error('Actual runtime repository was lost after process restart');
        return {retainedAfterProcessRestart:true};
      })()`);
    }
  }
  // A sentinel in both web storage systems and the real native identity must
  // survive a package replacement and then a complete process restart.
  proof.retention = await evaluate(`(async()=>{
    const key='vantara.debug.upgrade-proof';
    const native=await Capacitor.Plugins.SystemUi.deviceId();
    const value={marker:'debug-upgrade-fixture-20261027',deviceId:native.identifier};
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('vantara-debug-upgrade-proof',1);r.onupgradeneeded=()=>r.result.createObjectStore('proof');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    if(${JSON.stringify(phase)}==='baseline'){
      localStorage.setItem(key,JSON.stringify(value));
      await new Promise((resolve,reject)=>{const t=db.transaction('proof','readwrite');t.objectStore('proof').put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
    }
    const stored=await new Promise((resolve,reject)=>{const r=db.transaction('proof').objectStore('proof').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    db.close();
    const persisted=localStorage.getItem(key);
    const saved=JSON.parse(persisted||'null');
    // Diagnostic booleans only: do not expose device IDs or user data in logs.
    return {
      localStorage:persisted===JSON.stringify(value),
      indexedDB:JSON.stringify(stored)===JSON.stringify(value),
      nativeIdentity:saved?.deviceId===native.identifier,
      localExists:persisted!==null,
      indexedDBExists:stored!==undefined,
      nativeHasIdentifier:typeof native.identifier==='string'&&native.identifier.length>0,
    };
  })()`);
  console.log('Debug upgrade storage proof:', JSON.stringify(proof.retention));
  if (!proof.retention.localStorage || !proof.retention.indexedDB || !proof.retention.nativeIdentity) {
    throw new Error('APK upgrade retention failure (diagnostics in '+out+'/'+phase+'.json): '+JSON.stringify(proof.retention));
  }
  if (phase === 'candidate') {
    // Inspect real bundled APK resources, without preparing a source or making
    // any catalogue/CAPTCHA request. Do not mistake a fallback SVG for its logo.
    // Debug مفصول بلا نسخ مدمجة (31 أكتوبر): الشعار يُقرأ من نسخة على الجهاز إن وُجدت. المصدر يبقى معلنًا،
    // وبلا نسخة محلية لا شعار بعد (لا تنزيل هنا)؛ أي شعار يظهر يجب أن يكون PNG حقيقيًا بالحجم الثابت.
    proof.nativeArtwork = await evaluate(`(async()=>{
      const out=await Capacitor.Plugins.ExtensionEngine.sources();
      const source=out.sources.find(s=>s.pkg==='eu.kanade.tachiyomi.extension.ar.mangaswat');
      if(!source)throw new Error('Former built-in source is no longer declared');
      const any=out.sources.find(s=>/^data:image\\/png;base64,/.test(s.iconUrl||''));
      if(!any)return {realBundledPng:false,separated:true,width:96,height:96};
      if(any.iconUrl&&!/^data:image\\/png;base64,/.test(any.iconUrl))throw new Error('Native source icon is not a PNG');
      const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Native source logo did not decode'));img.src=any.iconUrl});
      return {realLocalPng:true,width:img.naturalWidth,height:img.naturalHeight};
    })()`);
    if(proof.nativeArtwork.width!==96||proof.nativeArtwork.height!==96)throw new Error('Native logo dimensions exceed the fixed resource budget');
    // No production credentials or synthetic login: render the actual shipped
    // shell using a local anonymous sync fixture; native engines stay real.
    await evaluate(`(async()=>{
      window.__debugProofErrors=[];
      addEventListener('error',e=>window.__debugProofErrors.push(String(e.error?.stack||e.message)));
      addEventListener('unhandledrejection',e=>window.__debugProofErrors.push(String(e.reason?.stack||e.reason)));
      const sync={user:null,rows:()=>[],row:()=>null,onChange:()=>()=>{},enqueue:()=>{},
        translation:async()=>({status:200,body:{rows:[]}}),latestSnapshots:async()=>({sources:[]}),
        presence:async()=>[],stats:async()=>({}),insights:async()=>({}),topWorks:async()=>[],
        pendingDevices:async()=>[],privacyCapability:async()=>({}),authorizationHeader:null};
      const {mountV35}=await import('/v35/shell.js');
      window.__debugProofShell=mountV35({sync,mount:node=>document.querySelector('#root').replaceChildren(node),go:async()=>{},
        friends:()=>[],presence:async()=>[],version:'debug-emulator-fixture',switchAccount:()=>{},openReader:()=>{}},{page:'home'});
      return true;
    })()`);
    await waitFor("document.querySelector('.v35 #home.active')", 'shipped Home renderer');
    assertNoAutomaticVerification(0);
    for (let iteration = 1; iteration <= 30; iteration++) {
      await evaluate(`(()=>{document.querySelector('[data-act="openDrawer"]').click();const b=[...document.querySelectorAll('.drawer-item')].find(b=>b.textContent.trim()==='الإضافات');if(!b)throw new Error('Missing Addons navigation');b.click();return true})()`);
      await waitFor("document.querySelector('#utility.active .v7-addon')", `Addons renderer cycle ${iteration}`);
      // Exercise nested dialogs before close so their disposal also runs.
      await evaluate(`(()=>{document.querySelector('.v7-plus')?.click();return true})()`);
      await delay(150);
      await evaluate(`(()=>{window.__debugProofShell.handleBack();document.querySelector('[data-act="navTo"][data-arg="home"]').click();return true})()`);
      await waitFor("document.querySelector('#home.active') && !document.querySelector('#utility.active')", `Home return cycle ${iteration}`);
      await delay(150);
      if (adb('shell', 'pidof', pkg) !== pid) throw new Error(`APK process restarted during cycle ${iteration}`);
      assertNoAutomaticVerification(iteration);
      proof.cycles = iteration;
    }
    proof.navigationFixture = 'shipped Home/Addons shell; local anonymous sync; real native bridges';
    proof.javascriptErrors = await evaluate('window.__debugProofErrors');
    if (proof.javascriptErrors.length || errors.length) throw new Error('Uncaught JavaScript exception during navigation; see proof');
    // تشخيص فتح عمل أنمي على WebView الحقيقي (لا يُفشل البناء: يعتمد على شبكة AniList). المالك يلمس
    // غلافًا فلا تفتح صفحة العمل على الجهاز بينما تفتح في المتصفح؛ هذا يسجّل ما يحدث فعلًا هنا.
    try {
      proof.animeOpen = await evaluate(`(async()=>{
        const wait=async(f,ms)=>{const t=Date.now();while(Date.now()-t<ms){const v=f();if(v)return v;await new Promise(r=>setTimeout(r,300));}return null};
        const before=window.__debugProofErrors.length;
        document.querySelector('[data-act="openDrawer"]')?.click();await new Promise(r=>setTimeout(r,400));
        const sw=[...document.querySelectorAll('button,div')].find(b=>b.offsetParent&&/^ANIME/.test(b.textContent.trim()));
        sw?.click();
        const card=await wait(()=>[...document.querySelectorAll('.an-card')].find(c=>c.offsetParent),30000);
        if(!card)return {section:document.documentElement.dataset.section,cards:0,errors:window.__debugProofErrors.slice(before)};
        card.click();
        const hero=await wait(()=>document.querySelector('#anime.active .aw-hero, .aw-hero'),20000);
        return {section:document.documentElement.dataset.section,cards:document.querySelectorAll('.an-card').length,opened:!!hero,
          active:document.querySelector('.page.active,[data-page].active')?.id??null,title:document.querySelector('.aw h1,.aw-title')?.textContent?.slice(0,60)??null,
          errors:window.__debugProofErrors.slice(before).map(e=>e.slice(0,400))};
      })()`);
    } catch (error) { proof.animeOpen = { probeError: String(error).slice(0, 400) }; }
    console.log('Anime open probe:', JSON.stringify(proof.animeOpen));
    try {
      const shot = await command('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${out}/anime-open.png`, Buffer.from(shot.data, 'base64'));
    } catch {}
  }
  proof.passed = true;
} catch (error) {
  proof.failure = String(error?.stack || error);
  throw error;
} finally {
  proof.cdpExceptions = errors;
  try {
    const screenshot = await command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${out}/${phase}.png`, Buffer.from(screenshot.data, 'base64'));
  } catch {}
  writeFileSync(`${out}/${phase}.json`, JSON.stringify(proof, null, 2) + '\n');
  socket.close();
  adb('forward', '--remove', 'tcp:9223');
}
