/**
 * الجولة الثالثة على APK Debug حقيقي: قائمة الإضافات وورقة السيرفرات بلمسات فعلية ولقطات كل ثانية.
 * نفس أدوات audit.mjs (CDP، قشرة بمزامنة في الذاكرة). لا حسابات ولا نشر.
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
const command = (method, params = {}, ms = 240000) => new Promise((resolve, reject) => {
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
async function step(name, fn) {
  const t = Date.now();
  try {
    const value = await fn();
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


// ════════ الجولة الثالثة: قائمة الإضافات وورقة السيرفرات على الـAPK ════════
const VW = () => js('innerWidth');
/** لقطة حالة قائمة الإضافات: التبويبات وعداداتها، الصفوف، الأيقونات المعطوبة، النصوص المقصوصة، الخروج عن الشاشة. */
const ADDONS_STATE = `(()=>{const u=document.querySelector('#utility');const vw=innerWidth;
  const rows=[...(u?.querySelectorAll('.v7-row')??[])].filter(r=>r.getClientRects().length);
  const name=r=>r.querySelector('.v7-name')?.textContent.trim()||'';
  const broken=rows.filter(r=>{const i=r.querySelector('.v7-logo img,img');return i&&i.complete&&i.naturalWidth===0}).map(name);
  const fallback=rows.filter(r=>r.querySelector('.v7-fallback:not([hidden])')).map(name);
  const clipped=rows.filter(r=>{const n=r.querySelector('.v7-name');return n&&n.scrollWidth>n.clientWidth+2&&getComputedStyle(n).textOverflow!=='ellipsis'}).map(name);
  const out=[...(u?.querySelectorAll('*')??[])].filter(n=>{if(!n.getClientRects().length)return false;const b=n.getBoundingClientRect();return b.width>4&&(b.right>vw+1||b.left<-1)&&getComputedStyle(n).position!=='fixed'}).slice(0,5).map(n=>String(n.className).slice(0,40));
  const names=rows.map(name);const dup=names.filter((n,i)=>n&&names.indexOf(n)!==i);
  return {active:document.querySelector('.page.active')?.id,tabs:[...(u?.querySelectorAll('.v7-tab')??[])].map(t=>t.textContent.trim().replace(/\\s+/g,' ')+(t.classList.contains('active')||t.getAttribute('aria-selected')==='true'?'*':'')),
    rows:rows.length,first:names.slice(0,12),dup,broken,fallback,clipped,outOfViewport:out,
    notice:(u?.querySelector('.v7-diagnostic')?.textContent||'').slice(0,200),empty:(u?.querySelector('.v7-empty')?.innerText||'').replace(/\\s+/g,' ').slice(0,160),
    dialog:u?.querySelector('.v7-layer:not([hidden]) .v7-dialog')?.innerText.replace(/\\s+/g,' ').slice(0,200)||null,y:Math.round(scrollY),nodes:document.getElementsByTagName('*').length}})()`;
const openAddons = async () => {
  const t = Date.now();
  await js(`(()=>{document.querySelector('[data-act="openDrawer"]')?.click();const it=[...document.querySelectorAll('.drawer-item')].find(b=>b.textContent.trim()==='الإضافات');it?.click();return Boolean(it)})()`);
  await until(`document.querySelector('#utility.active .v7-row, #utility.active .v7-empty')`, 'addons list', 90000);
  return Date.now() - t;
};
const tabTo = (label) => js(`(()=>{const t=[...document.querySelectorAll('#utility .v7-tab')].find(b=>b.textContent.includes(${JSON.stringify(label)}));t?.click();return Boolean(t)})()`);
const topActivity = () => adb('shell', 'dumpsys', 'activity', 'activities').split('\n').filter((l) => /topResumedActivity|mResumedActivity/.test(l)).join(' ');
const screencap = (name) => { try { writeFileSync(`${out}/${name}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p'])); } catch {} };

/** ورقة السيرفرات: عينة كل ثانية — الصفوف بترتيبها وحالتها، سطر الحالة، الزر، ارتفاع الورقة. */
const SHEET_STATE = `(()=>{const rows=[...document.querySelectorAll('.ss-row')].filter(r=>r.getClientRects().length);
  const sheet=rows[0]?.closest('.sheet,.sheet-body,[role=dialog]')||document.querySelector('.an-srv-status')?.closest('.sheet,.sheet-body,[role=dialog]');
  const key=r=>(r.querySelector('.ss-name')?.textContent||'')+'@'+(r.querySelector('.ss-host')?.textContent||'')+'#'+(r.querySelector('.ss-q b')?.textContent||'');
  return {rows:rows.map(r=>({k:key(r),state:(r.className.match(/an-srv--(\\w+)/)||[])[1],top:r.classList.contains('ss-row--top'),y:Math.round(r.getBoundingClientRect().top)})),
    status:document.querySelector('.an-srv-status')?.textContent.trim()||'',best:document.querySelector('.an-pick-best')?.textContent.trim()||'',bestDisabled:Boolean(document.querySelector('.an-pick-best')?.disabled),
    note:document.querySelector('.ss-note,.ss-none')?.textContent.trim().slice(0,160)||'',skeleton:Boolean(document.querySelector('.ss-skel:not([hidden]),.ss-skel-list')),
    sheetH:sheet?Math.round(sheet.getBoundingClientRect().height):null,open:Boolean(document.querySelector('.an-pick-best'))}})()`;
async function sampleSheet(label, seconds) {
  const samples = [];
  const t0 = Date.now();
  for (let i = 0; i < seconds; i++) {
    const s = await js(SHEET_STATE).catch((e) => ({ error: String(e.message).slice(0, 120) }));
    samples.push({ t: Date.now() - t0, ...s });
    if ([1, 3, 6, 10, 15, 20, 30, 40].includes(i)) await shot(`${label}-${String(i).padStart(2, '0')}s`);
    await delay(Math.max(0, (i + 1) * 1000 - (Date.now() - t0)));
  }
  // تحليل: أول صف، أول جاهز، تبدل الترتيب تحت الإصبع، تبدل «المقترح»، قفزات ارتفاع الورقة
  let reorders = 0, topChanges = 0, heightJumps = 0, moved = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (!a.rows || !b.rows) continue;
    const ia = new Map(a.rows.map((r, n) => [r.k, n]));
    for (const [n, r] of b.rows.entries()) if (ia.has(r.k) && ia.get(r.k) !== n && Math.abs(a.rows[ia.get(r.k)].y - r.y) > 8) { reorders++; if (moved.length < 8) moved.push(`${b.t}ms ${r.k} ${ia.get(r.k)}→${n}`); }
    const ta = a.rows.find((r) => r.top)?.k, tb = b.rows.find((r) => r.top)?.k;
    if (ta && tb && ta !== tb) topChanges++;
    if (a.sheetH != null && b.sheetH != null && Math.abs(a.sheetH - b.sheetH) > 24) heightJumps++;
  }
  const firstRow = samples.find((s) => s.rows?.length)?.t ?? null;
  const firstReady = samples.find((s) => s.rows?.some((r) => r.state === 'ready'))?.t ?? null;
  const last = samples.at(-1);
  return { firstRowMs: firstRow, firstReadyMs: firstReady, reorders, moved, topChanges, heightJumps,
    final: { rows: last?.rows?.length, ready: last?.rows?.filter((r) => r.state === 'ready').length, status: last?.status, best: last?.best, note: last?.note },
    timeline: samples.filter((_, i) => i % 3 === 0).map((s) => `${s.t}ms rows=${s.rows?.length ?? '?'} ready=${s.rows?.filter((r) => r.state === 'ready').length ?? '?'} h=${s.sheetH} «${(s.status || s.note || '').slice(0, 50)}» best=«${(s.best || '').slice(0, 30)}»`) };
}

try {
  await connect();
  report.device = { abi: adb('shell', 'getprop', 'ro.product.cpu.abilist'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk'), webview: await js('navigator.userAgent') };
  await step('mount', async () => { await freshMount({ section: 'anime' }); await delay(4000); return true; });

  // ───── A. قائمة الإضافات قبل تثبيت أي شيء ─────
  await step('addons-first-open', async () => {
    const ms = await openAddons();
    const s0 = await js(ADDONS_STATE);
    await delay(3000);
    const s3 = await js(ADDONS_STATE);
    return { openMs: ms, at0: s0, after3s: s3 };
  });
  await step('addons-tabs-empty', async () => {
    const r = {};
    for (const t of ['المثبتة', 'تحتاج تحقق', 'الإضافات']) { await tabTo(t); await delay(1500); r[t] = await js(ADDONS_STATE); await shot('addons-tab-' + t); }
    return r;
  });

  // تثبيت عبر الجسور (كما في رحلات Debug) ثم الحكم على ما تعرضه القائمة
  const installed = await step('install-sources', () => js(`(async()=>{const out={};
    await ${VR}.setProfile({profile:'local'});await ${VR}.addRepository({url:${JSON.stringify(CS_REPO)}});
    const rows=(await ${VR}.extensions({url:${JSON.stringify(CS_REPO)}})).extensions;out.csRepoExtensions=rows.length;out.cs=[];
    for(const name of ${JSON.stringify(ANIME_CANDIDATES)}){const row=rows.find(r=>r.internalName===name);if(!row)continue;try{await ${VR}.install({url:${JSON.stringify(CS_REPO)},pkg:row.pkg});out.cs.push(name)}catch(e){out.cs.push(name+' ✗ '+String(e.message).slice(0,60))}}
    const E=${EE};await E.addRepo({url:${JSON.stringify(KEIYOUSHI)}});const idx=(await E.repoIndex({url:${JSON.stringify(KEIYOUSHI)}})).extensions;out.keiyoushiExtensions=idx.length;
    const rk=idx.find(r=>r.name==='Rocks Manga');if(rk){try{await E.installExtension({repo:${JSON.stringify(KEIYOUSHI)},pkg:rk.pkg});out.manga='Rocks Manga'}catch(e){out.manga='✗ '+e.message}}
    return out})()`, 600000));

  await step('addons-after-install', async () => {
    await js(`window.__shell.showPage('home')`); await delay(1500);
    const ms = await openAddons();
    await tabTo('المثبتة'); await delay(2500);
    const s = await js(ADDONS_STATE);
    await tabTo('الإضافات'); await delay(2500);
    const repos = await js(ADDONS_STATE);
    return { openMs: ms, installedTab: s, reposTab: repos };
  });

  // البحث داخل القائمة: كلمة موجودة، كلمة غير موجودة، ثم مسح
  await step('addons-search', async () => {
    const typeIn = (v) => js(`(()=>{const i=document.querySelector('#utility [data-addon-search]');i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    const r = {};
    for (const v of ['anime', 'zzqqxx', '']) { await typeIn(v); await delay(1500); r[v || '(empty)'] = await js(ADDONS_STATE); }
    return r;
  });

  // تثبيت من الواجهة نفسها: أول صف غير مثبت في تبويب الإضافات ← «تثبيت» ← كم يأخذ وكيف تتغير القائمة
  await step('addons-install-from-ui', async () => {
    await tabTo('الإضافات'); await delay(1500);
    await js(`scrollTo(0,0)`);
    const pick = await js(`(()=>{const r=[...document.querySelectorAll('#utility .v7-row')].find(r=>r.querySelector('.v7-flip:not(.installed)'));if(!r)return null;r.setAttribute('data-qa','pick');r.scrollIntoView({block:'center'});return {name:r.querySelector('.v7-name')?.textContent.trim(),y:Math.round(scrollY)}})()`);
    if (!pick) throw new Error('no installable row in the list');
    await delay(600);
    const before = await js(`({nodes:document.querySelectorAll('#utility .v7-row').length,y:Math.round(scrollY)})`);
    const t = Date.now();
    await js(`document.querySelector('[data-qa="pick"] .v7-flip').click()`);
    let state = null, dialog = null;
    for (; Date.now() - t < 120000; await delay(500)) {
      state = await js(`(()=>{const r=document.querySelector('[data-qa="pick"]');const f=r?.querySelector('.v7-flip');return {connected:Boolean(r?.isConnected),installed:Boolean(f?.classList.contains('installed')),disabled:Boolean(f?.disabled),label:f?.getAttribute('aria-label')||'',notice:document.querySelector('#utility .v7-diagnostic')?.textContent.slice(0,160)||''}})()`);
      dialog = await js(`document.querySelector('#utility .v7-layer:not([hidden]) .v7-dialog')?.innerText.replace(/\\s+/g,' ').slice(0,200)||null`);
      if (dialog || state.installed || !state.connected) break;
    }
    await shot('addons-install-result');
    const after = await js(`({nodes:document.querySelectorAll('#utility .v7-row').length,y:Math.round(scrollY)})`);
    return { pick, ms: Date.now() - t, state, dialog, rowsBefore: before.nodes, rowsAfter: after.nodes, scrollBefore: before.y, scrollAfter: after.y };
  });

  // فتح مصدر مثبت من القائمة ← رئيسيته ← رجوع: هل ترجع للقائمة بنفس التبويب والموضع؟
  await step('addons-open-and-back', async () => {
    await js(`(()=>{const l=document.querySelector('#utility .v7-layer:not([hidden])');if(l)l.click();return true})()`);
    await tabTo('المثبتة'); await delay(1500);
    const target = await js(`(()=>{const r=[...document.querySelectorAll('#utility .v7-row')].find(r=>/AnimeRift|AnimeWitcher/i.test(r.querySelector('.v7-name')?.textContent||''));if(!r)return null;const b=r.querySelector('.v7-flip.installed')||[...r.querySelectorAll('button')].find(b=>b.textContent.includes('فتح'));b?.click();return r.querySelector('.v7-name').textContent.trim()})()`);
    if (!target) throw new Error('no installed anime source row');
    const t = Date.now();
    await until(`document.querySelector('#utility.active .addon-source-home .an-card, #utility.active .addon-source-home .hero-slide, #utility.active .addon-source .work-card')`, 'cards in source home', 120000);
    const cardsMs = Date.now() - t;
    await shot('addons-source-home');
    await js(`window.__shell.handleBack()`); await delay(2000);
    const back = await js(ADDONS_STATE);
    await shot('addons-after-back');
    return { opened: target, cardsMs, afterBack: { active: back.active, tabs: back.tabs, rows: back.rows } };
  });

  // ورقة الحذف: تظهر؟ ونصها؟ ثم «رجوع» لا يحذف شيئًا
  await step('addons-delete-dialog', async () => {
    await tabTo('المثبتة'); await delay(1200);
    const n0 = (await js(ADDONS_STATE)).rows;
    const name = await js(`(()=>{const r=[...document.querySelectorAll('#utility .v7-row')].find(r=>r.querySelector('.v7-trash'));if(!r)return null;r.querySelector('.v7-trash').click();return r.querySelector('.v7-name').textContent.trim()})()`);
    await delay(1200);
    const dialog = await js(`document.querySelector('#utility .v7-layer:not([hidden]) .v7-dialog')?.innerText.replace(/\\s+/g,' ').slice(0,240)||null`);
    await shot('addons-delete-dialog');
    await js(`(()=>{const b=[...document.querySelectorAll('#utility .v7-layer:not([hidden]) button')].find(b=>b.textContent.trim()==='رجوع');b?.click();return Boolean(b)})()`);
    await delay(1200);
    const n1 = (await js(ADDONS_STATE)).rows;
    return { name, dialog, rowsBefore: n0, rowsAfterCancel: n1 };
  });

  // فتح وإغلاق القائمة 10 مرات: زمن الفتح، العناصر، الأخطاء
  await step('addons-reopen-x10', async () => {
    const times = [], nodes = [];
    for (let i = 0; i < 10; i++) {
      await js(`window.__shell.showPage('home')`); await delay(800);
      times.push(await openAddons()); await delay(700);
      nodes.push(await js('document.getElementsByTagName("*").length'));
    }
    return { openMs: times, nodes, errors: await js('window.__errors.slice(0,5)') };
  });

  // ───── B. ورقة السيرفرات: أنمي من AniList ─────
  await js(`window.__shell.showPage('home')`); await delay(1500);
  const openWatch = async (ref, title) => {
    await js(`window.__shell.openAnimeRef(${JSON.stringify(ref)},{title:${JSON.stringify(title)}})`);
    await until(`document.querySelector('#anime.active .aw-still-play')`, 'watch button', 90000);
    await delay(1500);
    const t = Date.now();
    await js(`document.querySelector('#anime.active .aw-still-play').click()`);
    await until(`document.querySelector('.an-pick-best, .an-srv-status')`, 'server sheet', 30000);
    return Date.now() - t;
  };
  await step('sheet-frieren', async () => {
    const openMs = await openWatch('anime:154587', 'Frieren');
    return { sheetOpenMs: openMs, ...(await sampleSheet('sheet-frieren', 45)) };
  });
  // إغلاق الورقة وفتحها من جديد: هل يُعاد التجهيز من الصفر أم تُستعاد الجلسة؟
  await step('sheet-reopen', async () => {
    await js(`window.__shell.handleBack()`); await delay(1500);
    const t = Date.now();
    await js(`document.querySelector('#anime.active .aw-still-play')?.click()`);
    await until(`document.querySelector('.an-pick-best, .an-srv-status')`, 'server sheet again', 30000);
    return { sheetOpenMs: Date.now() - t, ...(await sampleSheet('sheet-reopen', 15)) };
  });
  // إغلاق أثناء التجهيز (بعد ثانيتين) على عمل آخر ثم فتح عمل ثالث: لا جلسات معلّقة ولا صفوف من عمل سابق
  await step('sheet-close-midway', async () => {
    await js(`window.__shell.handleBack()`); await delay(800);
    await js(`window.__shell.handleBack()`); await delay(1500);
    await openWatch('anime:21', 'One Piece');
    await delay(2000);
    const mid = await js(SHEET_STATE);
    await js(`window.__shell.handleBack()`); await delay(600);
    await js(`window.__shell.handleBack()`); await delay(1500);
    await openWatch('anime:113415', 'Jujutsu Kaisen');
    const s = await sampleSheet('sheet-jjk', 25);
    return { midRowsOnePiece: mid.rows?.length ?? 0, midStatus: mid.status, jjk: s };
  });
  // تشغيل «الأفضل»: هل يفتح المشغل الأصلي ويبقى؟ وماذا يظهر بعد الرجوع منه؟
  await step('sheet-play-best', async () => {
    const ok = await until(`document.querySelector('.an-pick-best') && !document.querySelector('.an-pick-best').disabled`, 'best enabled', 60000).catch(() => null);
    if (ok === null) throw new Error('«شغّل الأفضل» never enabled');
    const label = await js(`document.querySelector('.an-pick-best').textContent.trim()`);
    const t = Date.now();
    await js(`document.querySelector('.an-pick-best').click()`);
    let player = false;
    for (; Date.now() - t < 90000 && !player; await delay(1500)) player = /PlayerActivity/.test(topActivity());
    const openedMs = Date.now() - t;
    await delay(15000);
    screencap('player-15s');
    const still = /PlayerActivity/.test(topActivity());
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await delay(3000);
    const after = /PlayerActivity/.test(topActivity()) ? 'still player' : await js(`({active:document.querySelector('.page.active')?.id,sheetOpen:Boolean(document.querySelector('.an-pick-best')),toast:document.querySelector('#toast,.toast')?.textContent||''})`).catch((e) => String(e.message));
    await shot('after-player-back');
    return { best: label, playerOpened: player, playerOpenMs: player ? openedMs : null, stillPlayingAfter15s: still, afterBack: after };
  });

  // ───── C. ورقة السينما: مسلسل بلا إضافات Stremio ─────
  await step('sheet-cinema', async () => {
    await js(`window.__shell.showPage('home')`); await delay(1000);
    await js(`window.__shell.openCinemaRef('cinema:tt0903747',{title:'Breaking Bad',type:'series'})`);
    await until(`document.querySelector('#cinemaPlay')`, 'cinema play', 90000);
    await delay(2000);
    await js(`document.querySelector('#cinemaPlay').click()`);
    await delay(1000);
    return sampleSheet('sheet-cinema', 20);
  });
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
