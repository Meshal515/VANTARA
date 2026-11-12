/**
 * تدقيق Issue #323 على APK Debug حقيقي (WebView التطبيق وجسوره الأصلية عبر CDP).
 * كل خطوة مستقلة: فشلها يُسجَّل ولا يوقف ما بعدها. لا تسجيل دخول ولا حسابات حقيقية:
 * القشرة تُركَّب بمزامنة في الذاكرة تحاكي قواعد الخادم (progress: MAX + updated_at = الآن).
 *
 *   perf-<mode>   إقلاع كل قسم والموحد: Long Tasks وLayout Shift والطلبات (U-06, U-13)
 *   movie         صفحة 17-26 (MOVIE بثماني حلقات) (U-02)
 *   anime-clear   «مسح الكل» في سجل الأنمي: تأكيد؟ وما الذي يُمسح؟ (U-04)
 *   manga-*       مصدر حقيقي من Keiyoushi ← صفحة العمل ← القارئ: كتابات التقدم، كلفة المواضع، «تابع» (U-07, U-08, U-21, U-23)
 *   servers-*     تجهيز سيرفرات أنمي بمصدر CloudStream حقيقي: زمن كل سيرفر، وزمن أسماء الموسم (U-09، مثال 20 ثانية)
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
  await command('Page.reload', { ignoreCache: false });
  await delay(4000);
  for (let n = 0; n < 60 && !(await js('Boolean(window.Capacitor?.Plugins?.ExtensionEngine && document.querySelector("#root"))').catch(() => false)); n++) await delay(1000);
  await js(MOUNT(opts), 120000);
}

const EE = 'Capacitor.Plugins.ExtensionEngine', AE = 'Capacitor.Plugins.AnimeEngine', VR = 'Capacitor.Plugins.VantaraRuntime';

try {
  await connect();
  report.device = { abi: adb('shell', 'getprop', 'ro.product.cpu.abilist'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk'), webview: await js('navigator.userAgent') };

  // ───── 1. الإقلاع لكل قسم والموحد ─────
  for (const [mode, opts] of [['manga', { section: 'manga' }], ['anime', { section: 'anime' }], ['cinema', { section: 'cinema' }], ['unified', { unified: true }]]) {
    await step(`perf-${mode}`, async () => {
      await freshMount(opts);
      await delay(10000);
      return js(`(()=>{const res=performance.getEntriesByType('resource').filter(e=>e.startTime>=__mountAt&&!e.name.startsWith(location.origin));
        const hosts={};for(const e of res){const h=new URL(e.name).host;hosts[h]=(hosts[h]||0)+1}
        const cls=__cls.filter(x=>!x.recent);
        return {external:res.length,hosts,longTasks:__long.length,longTotalMs:__long.reduce((a,b)=>a+b.d,0),longMax:Math.max(0,...__long.map(x=>x.d)),
          cls:+cls.reduce((a,b)=>a+b.v,0).toFixed(3),shifts:cls.filter(x=>x.v>0.01).map(x=>x.t+'ms '+x.v.toFixed(3)+' '+x.src.join('/')),errors:__errors.slice(0,3)}})()`);
    });
  }

  // ───── 2. MOVIE بثماني حلقات (U-02) ─────
  await freshMount({ section: 'anime' });
  await delay(4000);
  await step('movie-17-26', async () => {
    await js(`window.__shell.openAnimeRef('anime:198188',{title:'Tatsuki Fujimoto 17-26'})`);
    await delay(8000);
    return js(`(()=>{const p=document.querySelector('#anime');return {active:document.querySelector('.page.active')?.id,
      text:p?.innerText.replace(/\\s+/g,' ').slice(0,260),episodeItems:p?.querySelectorAll('[data-episode],.aw-ep,.ep-row,.an-er').length??0}})()`);
  });

  // ───── 3. «مسح الكل» في سجل الأنمي (U-04) ─────
  await step('anime-clear-all', async () => {
    await js(`window.__shell.handleBack()`);
    await delay(1500);
    const seeded = await js(`(async()=>{const a=await import('/v35/anime.js');
      for(const [id,t,ep] of [[21,'One Piece',1100],[16498,'Attack on Titan',12],[113415,'Jujutsu Kaisen',7]])a.recordWatch({id,title:t,poster:null,format:'TV',episodes:24},ep,600000,1440000,'qa');
      return Object.keys(a.readWatch('qa')).length})()`);
    await js(`window.__shell.showPage('library')`);
    await delay(2500);
    await js(`(()=>{const t=[...document.querySelectorAll('.page.active button')].find(b=>/آخر المشاهدات/.test(b.textContent));t?.click();return Boolean(t)})()`);
    await delay(1500);
    const found = await js(`(()=>{const b=document.querySelector('.page.active .an-clear');if(!b)return null;const r=b.getBoundingClientRect();return {text:b.textContent,w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top)}})()`);
    if (!found) throw new Error('no «مسح الكل» button in anime history (seeded ' + seeded + ')');
    await shot('anime-clear-before');
    await js(`document.querySelector('.page.active .an-clear').click()`);
    await delay(1200);
    const after = await js(`(async()=>{const a=await import('/v35/anime.js');const w=a.readWatch('qa');
      return {confirmShown:Boolean(document.querySelector('.sheet.open,.sheet:not([hidden]) .sheet-body,[role=alertdialog],[role=dialog]:not([hidden])')),
        remainingWorks:Object.keys(w).length,resumePositionsLeft:Object.values(w).reduce((n,x)=>n+Object.keys(x.episodes||{}).length,0),
        viewRemoveOps:__ops.filter(o=>o.kind==='view.remove').length,toast:document.querySelector('#toast,.toast')?.textContent||''}})()`);
    return { seededWorks: seeded, button: found, ...after };
  });

  // ───── 4. مصدر مانجا حقيقي ─────
  const manga = await step('manga-source-install', () => js(`(async()=>{const E=${EE};await E.addRepo({url:${JSON.stringify(KEIYOUSHI)}});
    const rows=(await E.repoIndex({url:${JSON.stringify(KEIYOUSHI)}})).extensions,tried=[];
    for(const name of ${JSON.stringify(MANGA_CANDIDATES)}){const row=rows.find(r=>r.name===name&&r.arabic&&!r.nsfw&&!r.anime);if(!row)continue;
      try{const r=await E.installExtension({repo:${JSON.stringify(KEIYOUSHI)},pkg:row.pkg});const id=r.ids[0];
        const list=(await E.popular({sourceId:id,page:1})).mangas;
        for(const m of list.slice(0,12)){const ch=(await E.chapters({sourceId:id,manga:m}).catch(()=>({chapters:[]}))).chapters;
          if(ch.length>=6&&ch.length<=40)return {name,sourceId:id,title:m.title,chapters:ch.length}}
        tried.push(name+': no work with 6–40 chapters')}catch(e){tried.push(name+': '+String(e.message).slice(0,120))}}
    throw new Error(tried.join(' | '))})()`, 900000));

  if (manga) {
    await freshMount({ section: 'manga' });
    await delay(5000);
    const opened = await step('manga-open-work', async () => {
      const r = await js(`(async()=>{const w=await import('/v35/works.js');const t=${JSON.stringify(manga.title)};
        const {items}=await w.browse({query:t,keepWestern:true});window.__found=items;
        const hit=items.find(x=>[x.title?.romaji,x.title?.english,x.title].some(v=>typeof v==='string'&&v.trim().toLowerCase()===t.trim().toLowerCase()))||items[0];
        if(!hit)throw new Error('browse found nothing for '+t);window.__work=hit;window.__shell.openWork(hit);return {items:items.length}})()`, 300000);
      const ms = await until(`document.querySelectorAll('#detail .mw-ch-open, #detail .mw-cell-open').length>=3 && !document.querySelector('#readCta')?.disabled`, 'chapters on manga work page', 240000);
      return { ...r, chaptersVisibleAfterMs: ms, ...(await js(`({cta:document.querySelector('#readCtaLabel')?.textContent+' | '+document.querySelector('#readCtaSub')?.textContent,
        stats:document.querySelector('#detailStats')?.innerText.replace(/\\s+/g,' '),progress:document.querySelector('#progressText')?.textContent,
        rows:document.querySelectorAll('#detail .mw-ch-open, #detail .mw-cell-open').length,look:document.querySelector('#detail')?.dataset.look})`)) };
    });

    const NUMS = `[...document.querySelectorAll('#detail .mw-ch-open, #detail .mw-cell-open')].map(b=>({b,n:parseFloat((b.querySelector('.n,.mw-cell-n')?.textContent||'').replace(/[^0-9.]/g,''))})).filter(x=>Number.isFinite(x.n))`;
    const openChapter = (which) => js(`(()=>{const l=${NUMS};if(!l.length)throw new Error('no chapter buttons');l.sort((a,b)=>a.n-b.n);const x=${which === 'oldest' ? 'l[0]' : 'l[l.length-1]'};x.b.click();return x.n})()`);
    const readToEnd = async () => {
      await until(`document.querySelector('#rdScroll img')`, 'reader pages', 180000);
      let last = -1;
      for (let i = 0; i < 80; i++) {
        const h = await js(`(()=>{const s=document.querySelector('#rdScroll');s.scrollTop=s.scrollHeight;return s.scrollHeight})()`);
        await delay(1500);
        if (h === last && i > 6) break;
        last = h;
      }
      await delay(7000);
    };
    const exitReader = async () => { await js(`window.__reader?.handleBack()`); await delay(2500); };
    const cta = () => js(`(document.querySelector('#readCtaLabel')?.textContent||'')+' | '+(document.querySelector('#readCtaSub')?.textContent||'')`);

    if (opened) {
      // U-07 / U-08: قارئ مفتوح بلا تفاعل 30 ثانية، مع سجل مواضع لمستخدم قرأ 400 فصل
      await step('reader-idle-writes', async () => {
        await js(`(()=>{const all={};for(let i=0;i<400;i++){const pm={};for(let p=0;p<60;p++)pm[p]=900+p;all['seed'+i+'#n:'+i]={sourceId:'x',pages:60,page:59,ratio:1,pageMs:pm,at:Date.now()-i*1000}}
          localStorage.setItem('vantara.reader.positions.qa',JSON.stringify(all));
          const g=Storage.prototype.getItem,s=Storage.prototype.setItem;window.__pos={get:[],set:[]};
          Storage.prototype.getItem=function(k){const t=performance.now();const v=g.call(this,k);if(k==='vantara.reader.positions.qa')__pos.get.push(performance.now()-t);return v};
          Storage.prototype.setItem=function(k,v){const t=performance.now();const r=s.call(this,k,v);if(k==='vantara.reader.positions.qa')__pos.set.push(performance.now()-t);return r};
          return localStorage.getItem('vantara.reader.positions.qa').length})()`);
        const n = await openChapter('oldest');
        await until(`document.querySelector('#rdScroll img')`, 'reader pages', 180000);
        await delay(4000);
        const before = await js(`({ops:__ops.filter(o=>o.kind==='progress.set').length,long:__long.length})`);
        await delay(30000);
        return js(`(()=>{const p=__ops.filter(o=>o.kind==='progress.set').length;const sum=a=>a.reduce((x,y)=>x+y,0);
          return {chapter:${n},progressSetDuring30sIdle:p-${before.ops},positionsBytes:localStorage.getItem('vantara.reader.positions.qa').length,
            positionsReads:__pos.get.length,positionsWrites:__pos.set.length,readMsTotal:+sum(__pos.get).toFixed(1),writeMsTotal:+sum(__pos.set).toFixed(1),
            worstReadMs:+Math.max(0,...__pos.get).toFixed(1),worstWriteMs:+Math.max(0,...__pos.set).toFixed(1),longTasksDuringIdle:__long.length-${before.long}}})()`);
      });
      // U-21: أكمل الأقدم ← أكمل الأحدث ← نظرة على الأقدم ← ماذا يقول «تابع»؟
      await step('continue-after-peek', async () => {
        const trail = [];
        await readToEnd(); await exitReader();
        trail.push('after finishing oldest: ' + await cta());
        const newest = await openChapter('newest');
        await readToEnd(); await exitReader();
        trail.push(`after finishing newest (${newest}): ` + await cta());
        const oldest = await openChapter('oldest');
        await until(`document.querySelector('#rdScroll img')`, 'reader pages', 180000);
        await delay(8000);
        await exitReader();
        const final = await cta();
        trail.push(`after an 8 s peek at chapter ${oldest}: ` + final);
        const progress = await js(`__T.progress.map(r=>r.chapter_key.split('#')[1]+' ratio='+r.ratio.toFixed(2)+' t='+r.updated_at)`);
        return { trail, progress, regressed: !new RegExp(`(^|\\D)${newest}(\\D|$)`).test(final) && new RegExp(`الفصل (${oldest}|${oldest + 1})(\\D|$)`).test(final) };
      });
      await step('chapter-counts', () => js(`({stats:document.querySelector('#detailStats')?.innerText.replace(/\\s+/g,' '),progress:document.querySelector('#progressText')?.textContent,
        rows:${NUMS}.length,decimals:${NUMS}.filter(x=>!Number.isInteger(x.n)||x.n<1).map(x=>x.n)})`));
    }
  }

  // ───── 5. سيرفرات الأنمي: زمن كل سيرفر (مثال 20 ثانية، U-09) ─────
  const anime = await step('anime-source-install', () => js(`(async()=>{await ${VR}.setProfile({profile:'local'});await ${VR}.addRepository({url:${JSON.stringify(CS_REPO)}});
    const rows=(await ${VR}.extensions({url:${JSON.stringify(CS_REPO)}})).extensions,got=[];
    for(const name of ${JSON.stringify(ANIME_CANDIDATES)}){const row=rows.find(r=>r.internalName===name);if(!row)continue;
      try{await ${VR}.install({url:${JSON.stringify(CS_REPO)},pkg:row.pkg});got.push(name)}catch(e){}}
    for(let n=0;n<40;n++){const s=(await ${AE}.sources()).sources;if(s.length)return {installed:got,sources:s.map(x=>x.name)};await new Promise(r=>setTimeout(r,500))}
    throw new Error('no anime source offered; installed '+got.join(','))})()`, 600000));
  if (anime) {
    for (const [label, titles] of [['frieren', ['Sousou no Frieren', "Frieren: Beyond Journey's End"]], ['one-piece', ['ONE PIECE', 'One Piece']]]) {
      await step(`servers-${label}`, () => js(`(async()=>{const e=await import('/lib/anime-engine.js');const t0=Date.now();const ev=[];
        const h=await ${AE}.addListener('route',x=>ev.push({t:Date.now()-t0,state:x.route?.state,src:String(x.route?.sourceName??x.route?.sourceId??'').slice(0,30),server:String(x.route?.server??'').slice(0,20)}));
        const raw=[];let firstMatchAt=null;
        const found=await new Promise(res=>{const s=e.searchStream(${JSON.stringify(titles[0])},'anime',hit=>{raw.push(...(hit.items||[]));if(firstMatchAt===null&&e.pickCopies(raw,${JSON.stringify(titles)}))firstMatchAt=Date.now()-t0});Promise.resolve(s.done).then(()=>res(e.pickCopies(raw,${JSON.stringify(titles)})))});
        const searchDone=Date.now()-t0;if(!found)return {firstMatchAt,searchDone,copies:0};
        const p0=Date.now();const p=await e.prepare({copies:found.copies,episode:1});const prepareReturned=Date.now()-t0;
        if(p?.session)await e.best(p.session,null,60000).catch(()=>null);
        await new Promise(r=>setTimeout(r,15000));h.remove?.();
        const routes=(await e.routes(p.session).catch(()=>null))?.routes??[];
        const ready=ev.filter(x=>/ready/i.test(String(x.state)));
        return {copies:found.copies.map(c=>c.sourceId.slice(0,40)),firstMatchAt,searchDone,prepareReturned,firstReadyAt:ready[0]?.t??null,lastReadyAt:ready.at(-1)?.t??null,
          readyTimeline:ready.map(x=>x.t+'ms '+x.src+'/'+x.server).slice(0,25),routes:routes.length,states:[...new Set(ev.map(x=>x.state))]}})()`, 600000));
    }
    await step('season-aliases-cost', () => js(`(async()=>{const e=await import('/lib/anime-engine.js');const m=await import('/lib/anime-meta.js');
      const out={};for(const id of [104578,145064,139630]){const t=Date.now();const d=await m.fetchAnimeDetail(id).catch(()=>null);const t1=Date.now();
        const a=d?await e.seasonAliases(d,m.fetchAnimeDetail).catch(x=>({err:x.message})):null;out[id]={title:d?.title,detailMs:t1-t,aliasesMs:Date.now()-t1,aliases:a?.titles?.slice?.(0,3)}}return out})()`, 300000));
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
