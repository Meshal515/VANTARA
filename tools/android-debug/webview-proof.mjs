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
  await waitFor("document.querySelector('.gate,.v35,.vpin')", 'real APK startup gate or Home');
  proof.startup = await evaluate(`({gate:!!document.querySelector('.gate'),home:!!document.querySelector('.v35'),pin:!!document.querySelector('.vpin')})`);
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
    if(localStorage.getItem(key)!==JSON.stringify(value)||JSON.stringify(stored)!==JSON.stringify(value))throw new Error('APK upgrade lost storage or changed native identity');
    return {localStorage:true,indexedDB:true,nativeIdentity:true};
  })()`);
  if (phase === 'candidate') {
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
      window.__debugProofShell=mountV35({sync,mount:node=>document.body.replaceChildren(node),go:async()=>{},
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
