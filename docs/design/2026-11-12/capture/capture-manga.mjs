/**
 * لقطات أمينة لصفحة عمل المانجا من APK حقيقي (Stable أو Debug) ببيانات المصادر المدمجة.
 * مرجع تصميم فقط: لا تثبيت حسابات ولا نشر. الأدوات منسوخة من docs/audit/ux-2026-11-12/android/audit-addons.mjs.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const out = process.env.AUDIT_EVIDENCE || 'audit-evidence';
const pkg = 'com.vantara.app.debug';
const KEIYOUSHI = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo';
const CS_REPO = 'https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json';
const MANGA_CANDIDATES = ['Rocks Manga', 'Lava Scans', 'Despair', 'Oduto', 'SayManhwa', 'Loner', 'XSano', 'Kawii', 'ProComic', 'Azora', 'Team X'];
const ANIME_CANDIDATES = ['AnimeRift', 'Animewitcher', 'Anime4up', 'Aia2tv 2'];
mkdirSync(out, { recursive: true });
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const report = { started: new Date().toISOString(), steps: {} };
const save = () => writeFileSync(`${out}/audit.json`, JSON.stringify(report, null, 2) + '\n');
setTimeout(() => { report.fatal = 'global watchdog: 30 min'; save(); process.exit(2); }, 30 * 60000).unref();

// ── CDP ──
let socket, seq = 0;
const pending = new Map();
async function connect() {
  const pid = adb('shell', 'pidof', pkg);
  if (!/^\d+$/.test(pid)) throw new Error('APK process is not running');
  adb('forward', 'tcp:9225', `localabstract:webview_devtools_remote_${pid}`);
  let page;
  for (let n = 0; n < 90 && !page; n++) {
    try { page = (await (await fetch('http://127.0.0.1:9225/json')).json()).find((p) => p.type === 'page' && p.url.startsWith('https://localhost')); } catch {}
    if (!page) await delay(1000);
  }
  if (!page) throw new Error('WebView not exposed');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id); clearTimeout(item.timer);
    msg.error ? item.reject(new Error(JSON.stringify(msg.error))) : item.resolve(msg.result);
  };
  await command('Runtime.enable');
  await command('Page.enable');
}
const command = (method, params = {}, ms = 60000) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, ms);
  pending.set(id, { resolve, reject, timer });
  socket.send(JSON.stringify({ id, method, params }));
});
async function js(expression, ms) {
  const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, ms);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
const until = async (expr, label, ms = 60000) => {
  for (const t = Date.now(); Date.now() - t < ms; await delay(500)) if (await js(`Boolean(${expr})`).catch(() => false)) return Date.now() - t;
  throw new Error('timed out: ' + label);
};
async function shot(name) {
  try { const s = await command('Page.captureScreenshot', { format: 'png' }, 30000); writeFileSync(`${out}/${name}.png`, Buffer.from(s.data, 'base64')); } catch {}
}
const STEP_CAP_MS = Number(process.env.AUDIT_STEP_CAP_MS || 240000);
async function step(name, fn, cap = STEP_CAP_MS) {
  const t = Date.now();
  try {
    let timer;
    const value = await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`step cap ${cap} ms exceeded`)), cap); })]).finally(() => clearTimeout(timer));
    report.steps[name] = { result: 'PASS', ms: Date.now() - t, value };
  } catch (error) {
    report.steps[name] = { result: 'FAIL', ms: Date.now() - t, error: String(error?.message || error).slice(0, 1200) };
  }
  console.log(`${report.steps[name].result} ${name}`, JSON.stringify(report.steps[name].value ?? report.steps[name].error).slice(0, 1500));
  save();
  await shot(name);
  return report.steps[name].value;
}

// ── قشرة بمزامنة في الذاكرة (نفس قواعد الخادم للتقدم: MAX للصفحة والنسبة، updated_at دائمًا الآن) ──
const MOUNT = (opts) => `(async()=>{
  const o=${JSON.stringify(opts)};
  localStorage.setItem('vantara.experience.v1',JSON.stringify({v:2,unifyContent:Boolean(o.unified)}));
  localStorage.setItem('vantara.section',o.section||'manga');
  window.__errors=[];addEventListener('error',e=>__errors.push(String(e.error?.stack||e.message).slice(0,300)));
  addEventListener('unhandledrejection',e=>__errors.push(String(e.reason?.stack||e.reason).slice(0,300)));
  window.__cls=[];window.__long=[];
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())__cls.push({t:Math.round(e.startTime),v:e.value,recent:e.hadRecentInput,src:(e.sources||[]).slice(0,2).map(s=>String(s.node?.className||s.node?.nodeName||'?').slice(0,50))})}).observe({type:'layout-shift',buffered:true})}catch{}
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())__long.push({t:Math.round(e.startTime),d:Math.round(e.duration)})}).observe({type:'longtask'})}catch{}
  try{performance.setResourceTimingBufferSize(5000)}catch{}
  window.__mountAt=performance.now();
  const T={progress:[],chapter_marks:[],work_views:[],library:[],collections:[],completions:[],ratings:[],notifications:[],settings:[],accounts:[{user_id:'qa',display_name:'QA',created_at:1}],...(o.rows||{})};
  const K={progress:r=>r.user_id+'/'+r.chapter_key,chapter_marks:r=>r.user_id+'/'+r.chapter_key};
  const L=new Set();const emit=t=>{for(const f of L){try{f(t)}catch(e){__errors.push('onChange '+e)}}};
  window.__ops=[];window.__T=T;
  const upsert=(t,row)=>{const k=K[t](row);const i=T[t].findIndex(r=>K[t](r)===k);if(i<0)T[t].push(row);else T[t][i]=row;};
  const sync={user:{userId:'qa',displayName:'QA'},ready:Promise.resolve(),authorizationHeader:null,
    rows:(t,p)=>(T[t]||[]).filter(p||(()=>true)),
    row:(t,k)=>(T[t]||[]).find(r=>(K[t]?K[t](r)===k:false)||r.id===k||r.user_id===k)||null,
    onChange:f=>{L.add(f);return()=>L.delete(f)},
    enqueue:(kind,p)=>{const now=Date.now();__ops.push({kind,at:now,p:JSON.stringify(p).slice(0,200)});
      if(kind==='progress.set'){const k='qa/'+p.chapterKey;const old=T.progress.find(r=>K.progress(r)===k);
        upsert('progress',{user_id:'qa',chapter_key:p.chapterKey,series_ref:p.seriesRef,page:Math.max(old?.page??0,p.page??0),ratio:Math.max(old?.ratio??0,p.ratio??0),updated_at:now});emit(['progress'])}
      if(kind==='chapter.mark'){upsert('chapter_marks',{user_id:'qa',chapter_key:p.chapterKey,series_ref:p.seriesRef,read:p.read?1:0});emit(['chapter_marks'])}
      if(kind==='chapter.markMany'){for(const k of p.keys||[])upsert('chapter_marks',{user_id:'qa',chapter_key:k,series_ref:p.seriesRef,read:p.read?1:0});emit(['chapter_marks'])}
      if(kind==='view.add'){T.work_views=T.work_views.filter(r=>r.series_ref!==p.seriesRef);T.work_views.push({user_id:'qa',series_ref:p.seriesRef,series_title:p.seriesTitle,cover_url:p.coverUrl,chapter_label:p.chapterLabel,viewed_at:now});emit(['work_views'])}
      return crypto.randomUUID()},
    translation:async()=>({status:200,body:{rows:[],groups:[]}}),latestSnapshots:async()=>({sources:[]}),presence:async()=>[],stats:async()=>({}),insights:async()=>({}),
    topWorks:async()=>[],pendingDevices:async()=>[],privacyCapability:async()=>({}),refreshSession:async()=>{}};
  window.__sync=sync;
  const readerMod=await import('/v35/reader.js');const engineMod=await import('/lib/extension-engine.js');
  const root=document.querySelector('#root');
  const {mountV35}=await import('/v35/shell.js');
  window.__shell=mountV35({sync,mount:n=>root.replaceChildren(n),go:async()=>{},friends:()=>[],presence:async()=>[],version:'audit',switchAccount:()=>{},
    openReader:target=>{window.__shell.pause();window.__readerOpenAt=Date.now();
      window.__reader=readerMod.openSmartReader({sync,engine:engineMod.default,api:async()=>{throw new Error('no content api')},mount:n=>root.replaceChildren(n),
        exit:()=>{root.replaceChildren(window.__shell.root);window.__shell.resume();window.__reader=null},friends:()=>[],together:null,sendFrame:()=>{},report:async()=>({}),setReading:()=>{},immersive:()=>{}},target)}},{page:'home'});
  return true})()`;
async function freshMount(opts) {
  // التطبيق قد يعيد تحميل صفحته مرة عند أول إقلاع: نعيد التركيب إن مات سياق الصفحة أثناءه
  for (let attempt = 1; ; attempt++) {
    try {
      await command('Page.reload', { ignoreCache: false });
      await delay(4000 + attempt * 2000);
      for (let n = 0; n < 60 && !(await js('Boolean(window.Capacitor?.Plugins?.ExtensionEngine && document.querySelector("#root"))').catch(() => false)); n++) await delay(1000);
      await js(MOUNT(opts), 120000);
      await delay(1500);
      if (await js('Boolean(window.__shell && window.__sync)').catch(() => false)) return;
      throw new Error('shell not mounted after reload');
    } catch (error) {
      if (attempt >= 3) throw error;
      console.log(`freshMount retry ${attempt}: ${String(error.message).slice(0, 120)}`);
    }
  }
}

const EE = 'Capacitor.Plugins.ExtensionEngine', AE = 'Capacitor.Plugins.AnimeEngine', VR = 'Capacitor.Plugins.VantaraRuntime';

const STYLES = (process.env.CAPTURE_STYLES || 'default').split(',').filter(Boolean);
const CARD = `[...document.querySelectorAll('#root *')].filter(n=>n._work&&n.getClientRects().length&&n.getBoundingClientRect().width>60)`;
let title = null;
try {
  await connect();
  report.device = { abi: adb('shell', 'getprop', 'ro.product.cpu.abilist'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk'), webview: await js('navigator.userAgent') };
  for (const style of STYLES) {
    await step(`mount-${style}`, async () => {
      await js(`localStorage.setItem('vantara.appearance.v1',JSON.stringify(${JSON.stringify(style)}==='default'?{style:{},accent:{}}:{style:{manga:${JSON.stringify(style)}},accent:{}}))`);
      await freshMount({ section: 'manga' }); return true;
    });
    await step(`home-${style}`, async () => {
      // البطاقات تصل من المصادر المدمجة؛ إن لم تظهر في الرئيسية نفتح «الرائج»
      try { await until(`${CARD}.length`, 'cards on home', 90000); }
      catch { await js(`[...document.querySelectorAll('#root button, #root a')].find(b=>/الرائج|كل الأعمال/.test(b.textContent))?.click()`); await until(`${CARD}.length`, 'cards after tile', 120000); }
      await delay(2500); await shot(`home-${style}`);
      return await js(`${CARD}.slice(0,8).map(n=>n._work.title)`);
    }, 260000);
    await step(`open-${style}`, async () => {
      const t = await js(`(()=>{const all=${CARD};const want=${JSON.stringify(title)};const n=(want&&all.find(n=>n._work.title===want))||all.find(n=>n._work.thumbnailUrl)||all[0];n.click();return n._work.title})()`);
      title ??= t;
      await delay(14000);
      return { title: t, height: await js('document.scrollingElement.scrollHeight') };
    });
    for (const [i, y] of [[0, 0], [1, 560], [2, 1200], [3, 2000]]) {
      await js(`scrollTo(0,${y})`); await delay(1400); await shot(`work-${style}-${i}`);
    }
  }
} catch (error) {
  report.fatal = String(error?.stack || error).slice(0, 1500);
  console.log('FATAL', report.fatal);
} finally {
  try { report.errors = await js('window.__errors?.slice(0,10)'); } catch {}
  report.finished = new Date().toISOString();
  save();
  try { socket?.close(); } catch {}
  try { adb('forward', '--remove', 'tcp:9225'); } catch {}
}
