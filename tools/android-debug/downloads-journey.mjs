/**
 * رحلة التحميلات على APK حقيقي في محاكي، ببيانات حقيقية ولقطات من شاشة الجهاز نفسها (adb screencap):
 *
 *   أنمي: مصدر CloudStream حقيقي ← عمل حقيقي ← ⋮ ← «تحميل» ← ورقة البدء ← «جاري التحميل» بتقدّم حقيقي
 *         ← «على الجهاز» ← صفحة العمل المحلي ← ⓘ ← وضع الطيران ← تشغيل الحلقة من الملف بالمشغّل الأصلي.
 *   مانجا: مصدر Keiyoushi حقيقي ← عمل حقيقي ← ⋮ ← «تحميل» ← فصل ← على الجهاز ← وضع الطيران ← القارئ من الجهاز.
 *
 * لا تسجيل دخول ولا حسابات. كل خطوة PASS/FAIL في downloads.json، واللقطات shot-*.png.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const out = process.env.DEBUG_EVIDENCE || 'downloads-evidence';
const pkg = 'com.vantara.app.debug';
const CS_REPO = 'https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json';
const KEIYOUSHI = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo';
const ANIME_CANDIDATES = ['AnimeRift', 'Animewitcher', 'Anime4up', 'Aia2tv 2'];
const MANGA_CANDIDATES = ['Rocks Manga', 'Lava Scans', 'Despair', 'Oduto', 'SayManhwa', 'Loner', 'XSano', 'Kawii', 'ProComic'];

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
mkdirSync(out, { recursive: true });
const proof = { passed: false, steps: {}, shots: [] };
const save = () => writeFileSync(`${out}/downloads.json`, JSON.stringify(proof, null, 2) + '\n');
let shotNo = 0;
/** لقطة الشاشة كما يراها المستخدم (شريط النظام والإشعارات معها). */
const shot = async (name) => {
  // نوافذ النظام (المحاكي) لا تغطي التصميم: تُغلق قبل كل لقطة
  try { adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.CLOSE_SYSTEM_DIALOGS'); } catch {}
  await delay(700);
  const file = `shot-${String(++shotNo).padStart(2, '0')}-${name}.png`;
  writeFileSync(`${out}/${file}`, execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));
  proof.shots.push(file);
  save();
};

// مشغّل المحاكي (Pixel Launcher) يعلق على runner بلا GPU ويغطي كل لقطة بنافذة «لا يستجيب»، وتأكيد ملء الشاشة
// يحجب المشغّل ويبتلع زر الرجوع. كلاهما من المحاكي لا من VANTARA.
for (const cmd of [['pm', 'disable-user', '--user', '0', 'com.google.android.apps.nexuslauncher'], ['settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed']]) { try { adb('shell', ...cmd); } catch {} }
const topActivity = () => adb('shell', 'dumpsys', 'activity', 'activities').split('\n').filter((l) => /topResumedActivity|mResumedActivity/.test(l)).join(' ');
const pid = adb('shell', 'pidof', pkg);
adb('forward', 'tcp:9225', `localabstract:webview_devtools_remote_${pid}`);
let pages;
for (let n = 0; n < 90; n++) {
  try {
    pages = await (await fetch('http://127.0.0.1:9225/json')).json();
    if (pages.some((p) => p.type === 'page' && p.url.startsWith('https://localhost'))) break;
  } catch {}
  await delay(1000);
}
const target = pages?.find((p) => p.type === 'page' && p.url.startsWith('https://localhost'));
if (!target) throw new Error('The APK did not expose its local WebView');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let seq = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  const item = pending.get(msg.id);
  if (!item) return;
  pending.delete(msg.id); clearTimeout(item.timer);
  msg.error ? item.reject(new Error(JSON.stringify(msg.error))) : item.resolve(msg.result);
};
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
await command('Runtime.enable');
for (let n = 0; n < 60 && !(await js('Boolean(window.Capacitor?.Plugins?.VantaraDownloads)')); n++) await delay(1000);

async function step(name, fn) {
  const t = Date.now();
  try {
    const value = await fn();
    proof.steps[name] = { result: 'PASS', ms: Date.now() - t, value };
    console.log(`PASS ${name}`, JSON.stringify(value)?.slice(0, 400));
    return value;
  } catch (error) {
    proof.steps[name] = { result: 'FAIL', ms: Date.now() - t, error: String(error?.message || error).slice(0, 900) };
    console.log(`FAIL ${name}`, proof.steps[name].error);
    await shot(`fail-${name}`).catch(() => {});
    throw error;
  } finally { save(); }
}
const wait = async (expr, label, ms = 60000) => {
  for (const t = Date.now(); Date.now() - t < ms; await delay(500)) if (await js(`Boolean(${expr})`)) return true;
  throw new Error(`timed out: ${label} | toast=${await js(`document.querySelector('#toast')?.textContent||''`)} | errors=${await js('JSON.stringify(window.__uiErrors||[]).slice(0,600)')}`);
};
const click = (selector) => js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error('missing '+${JSON.stringify(selector)});n.click();return true})()`);
const airplane = async (on) => {
  adb('shell', 'cmd', 'connectivity', 'airplane-mode', on ? 'enable' : 'disable');
  for (let n = 0; n < 30; n++) {
    const online = await js(`fetch('https://raw.githubusercontent.com/keiyoushi/extensions/repo/repo.json',{cache:'no-store'}).then(()=>true,()=>false)`, 30000);
    if (online === !on) return { online };
    await delay(1000);
  }
  throw new Error('airplane mode did not settle');
};
const dlState = () => js(`import('/lib/downloads/index.js').then(m=>m.downloads()).then(({manager})=>manager.list().map(i=>({id:i.id,title:i.work.title,unit:i.unit.number,state:i.state,bytes:i.bytes,total:i.total,pages:i.pages,pagesTotal:i.pagesTotal,error:i.error,source:i.source,media:i.media,storage:i.storage,transport:i.transport})))`);
const AE = 'Capacitor.Plugins.AnimeEngine', VR = 'Capacitor.Plugins.VantaraRuntime', EE = 'Capacitor.Plugins.ExtensionEngine';

try {
  await step('mountShell', () => js(`(async()=>{window.__uiErrors=[];
    addEventListener('error',e=>__uiErrors.push(String(e.error?.stack||e.message)));addEventListener('unhandledrejection',e=>__uiErrors.push(String(e.reason?.stack||e.reason)));
    // حساب تجريبي محايد (لا حساب حقيقي): تظهر أزرار الحساب كما عند المالك
    const tables={work_views:[],library:[],progress:[],collections:[],completions:[],ratings:[],notifications:[],chapter_marks:[],settings:[],accounts:[{user_id:'qa',display_name:'QA',created_at:1}]};
    const sync={user:{userId:'qa',displayName:'QA'},ready:Promise.resolve(),rows:(t,p)=>(tables[t]??[]).filter(p||(()=>true)),row:(t,id)=>(tables[t]??[]).find(r=>r.id===id||r.user_id===id)??null,onChange:()=>()=>{},enqueue:()=>Promise.resolve(),refreshSession:async()=>{},attachNativeLinkBridge:()=>{},translation:async()=>({status:200,body:{rows:[]}}),latestSnapshots:async()=>({sources:[]}),
      presence:async()=>[],stats:async()=>({}),insights:async()=>({}),topWorks:async()=>[],pendingDevices:async()=>[],privacyCapability:async()=>({}),authorizationHeader:null};
    const engine=await import('/lib/extension-engine.js');
    const {openSmartReader}=await import('/v35/reader.js');
    const {mountV35}=await import('/v35/shell.js');
    const mount=n=>document.querySelector('#root').replaceChildren(n);
    // القارئ الحقيقي نفسه: فصل «التحميلات» يأتي بمحركه المحلي
    const openReader=(t)=>{window.__readerTarget=t;window.__reader=openSmartReader({sync,engine:t.engine??engine,mount,exit:()=>{},friends:()=>[],setReading:()=>{},immersive:()=>{}},t);};
    window.__shell=mountV35({sync,mount,go:async()=>{},friends:()=>[],presence:async()=>[],version:'downloads-journey',switchAccount:()=>{},openReader},{page:'home'});return true})()`));

  // ───────────── أنمي ─────────────
  const anime = await step('installAnimeSource', async () => {
    const errors = [];
    for (const name of ANIME_CANDIDATES) {
      try {
        return await js(`(async()=>{await ${VR}.setProfile({profile:'local'});await ${VR}.addRepository({url:${JSON.stringify(CS_REPO)}});
          const rows=(await ${VR}.extensions({url:${JSON.stringify(CS_REPO)}})).extensions,row=rows.find(r=>r.internalName===${JSON.stringify(name)});
          if(!row)throw new Error('not in repository');await ${VR}.install({url:${JSON.stringify(CS_REPO)},pkg:row.pkg});
          for(let n=0;n<40;n++){const s=(await ${AE}.sources()).sources.find(x=>x.pkg===row.pkg);if(s)return {name:${JSON.stringify(name)},id:s.id};await new Promise(r=>setTimeout(r,500))}
          throw new Error('installed but not offered')})()`, 300000);
      } catch (e) { errors.push(`${name}: ${String(e.message).slice(0, 150)}`); }
    }
    throw new Error(errors.join(' | '));
  });

  await step('openRealAnimeWork', async () => {
    await js(`(()=>{document.querySelector('[data-act="openDrawer"]').click();[...document.querySelectorAll('.drawer-item')].find(b=>b.textContent.trim()==='الإضافات').click();return true})()`);
    await wait(`document.querySelector('#utility.active .y-root .y > *')`, 'addons page');
    await js(`[...document.querySelectorAll('.v7-tab')].find(b=>b.textContent.includes('المثبتة')).click()`);
    await wait(`[...document.querySelectorAll('.v7-row')].some(r=>r.querySelector('.v7-name')?.textContent.trim()===${JSON.stringify(anime.name)})`, 'installed row');
    await js(`(()=>{const r=[...document.querySelectorAll('.v7-row')].find(r=>r.querySelector('.v7-name')?.textContent.trim()===${JSON.stringify(anime.name)});[...r.querySelectorAll('button')].find(b=>b.textContent.includes('فتح')).click();return true})()`);
    const CARD = '#utility.active .addon-source-home .an-card, #utility.active .addon-source-home .hero-slide, #utility.active .addon-source .work-card';
    await wait(`document.querySelector(${JSON.stringify(CARD)})`, 'cards inside the source', 150000);
    const title = await js(`(()=>{const c=document.querySelector(${JSON.stringify(CARD)});const t=(c.getAttribute('aria-label')||c.textContent).trim().slice(0,60);c.click();return t})()`);
    await wait(`document.querySelector('#anime.active .aw-tools [aria-haspopup]')`, 'work page tools', 150000);
    await wait(`document.querySelectorAll('#anime.active [data-episode], #anime.active .ep-row, #anime.active .aw-ep, .aw-episodes button').length>0`, 'episodes', 150000);
    await shot('anime-work');
    return { title };
  });

  await step('animeMenuShowsDownload', async () => {
    await click('#anime.active .aw-tools [aria-haspopup]');
    await wait(`document.querySelector('#anime.active .aw-menu.open')`, 'menu open');
    await delay(800);
    await shot('anime-menu');
    const first = await js(`document.querySelector('#anime.active .aw-menu.open .aw-menu-item')?.textContent.trim()`);
    if (first !== 'تحميل') throw new Error(`first item: ${first}`);
    return { first };
  });

  await step('animeStartSheet', async () => {
    await click('#anime.active .aw-menu.open .aw-menu-item');
    await wait(`document.querySelector('.dl-start')`, 'download sheet');
    await shot('anime-sheet');
    await js(`(()=>{const b=[...document.querySelectorAll('.dl-start .dl-chip')].find(x=>/حلقات محددة/.test(x.textContent));b?.click();return Boolean(b)})()`);
    await delay(300);
    await shot('anime-sheet-range');
    await js(`(()=>{const b=[...document.querySelectorAll('.dl-start .dl-chip')].find(x=>/^الحلقة/.test(x.textContent));b.click();return true})()`);
    await click('.dl-start-go');
    await wait(`!document.querySelector('.dl-start')`, 'sheet closed after start', 120000);
    return { toast: await js(`document.querySelector('#toast')?.textContent||''`) };
  });

  const openDownloads = async () => {
    await js(`document.querySelector('[data-act="navTo"][data-arg="library"]')?.click()`);
    await wait(`document.querySelector('#library.active [data-act="openDownloads"]')`, 'library entry');
    await click('#library.active [data-act="openDownloads"]');
    await wait(`document.querySelector('#downloads.active')`, 'downloads page');
  };

  const episode = await step('animeDownloadsToDevice', async () => {
    await openDownloads();
    let last = null;
    let shots = 0;
    for (const t = Date.now(); Date.now() - t < 20 * 60000; await delay(4000)) {
      const list = (await dlState()).filter((i) => i.unit != null && !i.pagesTotal);
      last = list[0];
      if (last?.state === 'downloading' && shots < 2 && last.bytes > 0) {
        await shot(`anime-queue-${++shots}`);
        if (shots === 2 && await js(`Boolean(document.querySelector('#downloads .dl-row .dl-info'))`)) {
          await click('#downloads .dl-row .dl-info');
          await wait(`document.querySelector('.dl-info-sheet')`, 'info sheet');
          await shot('anime-queue-info');
          await js(`document.querySelector('.sheet-backdrop.show')?.click()`);
          await delay(600);
        }
      }
      if (last && (last.state === 'ready' || last.state === 'failed' || last.state === 'no_space')) break;
    }
    if (last?.state !== 'ready') { await shot('anime-queue-end'); throw new Error(JSON.stringify(last)); }
    return last;
  });

  await step('animeOriginalPageFromDevice', async () => {
    await js(`[...document.querySelectorAll('#downloads .library-tab')].find(b=>b.textContent.includes('على الجهاز')).click()`);
    await wait(`document.querySelector('#downloads .dl-card img')`, 'device card');
    await shot('device-grid');
    await click('#downloads .dl-card');
    // صفحة العمل الأصلية نفسها، بالحلقات المحمّلة وحدها
    await wait(`document.querySelector('#anime.active .an-er')`, 'original anime page from device', 60000);
    await delay(2500);
    await shot('anime-original-from-device');
    const eps = await js(`[...document.querySelectorAll('#anime.active .an-er')].map(r=>r.dataset.ep)`);
    await js(`document.querySelector('#anime.active .an-er')?.scrollIntoView({block:'center'})`);
    await delay(900);
    await shot('anime-original-episodes');
    await js(`window.scrollTo(0,0)`);
    await click('#anime.active .aw-tools [aria-haspopup]');
    await wait(`document.querySelector('#anime.active .aw-menu.open')`, 'menu');
    await click('#anime.active .aw-menu.open .aw-menu-item');
    await wait(`document.querySelector('.dl-manage')`, 'manage sheet');
    await shot('anime-device-manage');
    await js(`document.querySelector('.sheet-backdrop.show')?.click()`);
    await delay(600);
    return { episodesShown: eps };
  });

  await step('animePlaysOfflineFromFile', async () => {
    await airplane(true);
    await delay(1500);
    await shot('airplane-local-work');
    await js(`(()=>{document.querySelector('.sheet-backdrop.show')?.click();document.querySelector('#anime.active .an-er-main').click();return true})()`);
    let player = false;
    for (const t = Date.now(); Date.now() - t < 30000 && !player; await delay(1000)) {
      player = /PlayerActivity/.test(adb('shell', 'dumpsys', 'activity', 'activities').split('\n').filter((l) => /topResumedActivity|mResumedActivity/.test(l)).join(' '));
    }
    if (!player) throw new Error('player did not open | toast=' + (await js(`document.querySelector('#toast')?.textContent||''`)));
    await delay(12000);
    await shot('offline-player');
    const still = /PlayerActivity/.test(adb('shell', 'dumpsys', 'activity', 'activities').split('\n').filter((l) => /topResumedActivity|mResumedActivity/.test(l)).join(' '));
    // يُغلق المشغّل فعلًا قبل المانجا: WebView خلف نشاط آخر لا يرسم إطاراته
    for (let n = 0; n < 6 && /PlayerActivity/.test(topActivity()); n++) { adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await delay(1500); }
    if (/PlayerActivity/.test(topActivity())) throw new Error('player did not close');
    if (!still) throw new Error('player closed during offline playback');
    return { episode: episode.unit, bytes: episode.bytes, stillPlayingAfter12s: true };
  });
  await airplane(false);

  // ───────────── مانجا ─────────────
  const manga = await step('installMangaSource', async () => {
    await js(`${EE}.addRepo({url:${JSON.stringify(KEIYOUSHI)}}).then(()=>true)`, 120000);
    const rows = await js(`${EE}.repoIndex({url:${JSON.stringify(KEIYOUSHI)}}).then(r=>r.extensions.filter(x=>x.arabic&&!x.nsfw&&!x.anime).map(x=>({name:x.name,pkg:x.pkg,builtin:x.builtin})))`, 120000);
    const errors = [];
    for (const name of MANGA_CANDIDATES) {
      const row = rows.find((r) => r.name === name && !r.builtin);
      if (!row) continue;
      try {
        const ids = await js(`${EE}.installExtension({repo:${JSON.stringify(KEIYOUSHI)},pkg:${JSON.stringify(row.pkg)}}).then(r=>r.ids)`, 240000);
        const list = await js(`${EE}.popular({sourceId:${JSON.stringify(ids[0])},page:1}).then(r=>r.mangas.slice(0,5))`, 120000);
        if (!list.length) throw new Error('no works');
        return { name, sourceId: ids[0], works: list.map((m) => m.title) };
      } catch (e) { errors.push(`${name}: ${String(e.message).slice(0, 150)}`); }
    }
    throw new Error(errors.join(' | '));
  });

  await step('openRealMangaWork', async () => {
    await js(`(async()=>{const list=(await ${EE}.popular({sourceId:${JSON.stringify(manga.sourceId)},page:1})).mangas;const m=list[0];
      const {toV35Work}=await import('/v35/works.js');
      const w=toV35Work({key:m.title.toLowerCase(),title:m.title,thumbnailUrl:m.thumbnailUrl??null,editions:[{sourceId:${JSON.stringify(manga.sourceId)},label:${JSON.stringify(manga.name)},manga:m}]});
      document.querySelector('[data-act="pickSection"][data-arg="manga"]')?.click();
      await __shell.openWork(w);return m.title})()`, 120000);
    await wait(`document.querySelector('#detail.active #detailTools [aria-haspopup]')`, 'manga work tools', 120000);
    await wait(`document.querySelectorAll('#detail.active .chapter, #detail.active [data-chapter], #detail.active .ch-row').length>0 || (window.__shell && document.querySelector('#detail.active'))`, 'chapters', 120000);
    await delay(4000);
    await shot('manga-work');
    return true;
  });

  await step('mangaDownloadChapter', async () => {
    await click('#detail.active #detailTools [aria-haspopup]');
    await wait(`document.querySelector('#detailMenu.open')`, 'manga menu');
    await delay(800);
    await shot('manga-menu');
    await click('#detailMenu.open .aw-menu-item');
    await wait(`document.querySelector('.dl-start')`, 'manga sheet');
    await shot('manga-sheet');
    await click('.dl-start-go');
    await wait(`!document.querySelector('.dl-start')`, 'manga sheet closed', 60000);
    await openDownloads();
    let item = null;
    for (const t = Date.now(); Date.now() - t < 5 * 60000; await delay(2000)) {
      item = (await dlState()).find((i) => i.pagesTotal != null || i.transport === 'pages');
      if (item?.state === 'downloading' && !proof.shots.some((s) => s.includes('manga-queue'))) await shot('manga-queue');
      if (item && ['ready', 'failed'].includes(item.state)) break;
    }
    if (item?.state !== 'ready') throw new Error(JSON.stringify(item));
    return item;
  });

  await step('mangaReadsOffline', async () => {
    await js(`[...document.querySelectorAll('#downloads .library-tab')].find(b=>b.textContent.includes('على الجهاز')).click()`);
    await wait(`document.querySelectorAll('#downloads .dl-card').length>=2`, 'two works on device');
    await shot('device-grid-two');
    await airplane(true);
    await js(`[...document.querySelectorAll('#downloads .dl-card')].find(c=>/فصل/.test(c.textContent)).click()`);
    await wait(`document.querySelector('#detail.active .mw-ch-open')`, 'original manga page from device', 60000);
    await delay(2000);
    await shot('manga-original-from-device');
    await js(`document.querySelector('#detail.active .mw-ch')?.scrollIntoView({block:'center'})`);
    await delay(800);
    await shot('manga-original-chapters');
    await click('#detail.active .mw-ch-open');
    await wait(`document.querySelectorAll('.rd img').length>0 && [...document.querySelectorAll('.rd img')].some(i=>i.complete&&i.naturalWidth>0)`, 'reader pages offline', 60000);
    await delay(1500);
    await shot('manga-reader-offline');
    return { images: await js(`[...document.querySelectorAll('.rd img')].filter(i=>i.complete&&i.naturalWidth>0).length`) };
  });
  proof.passed = true;
} catch (error) {
  proof.failure = String(error?.stack || error).slice(0, 1500);
  process.exitCode = 1;
} finally {
  proof.downloads = await dlState().catch(() => null);
  save();
  try { adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'); } catch {}
  socket.close();
  try { adb('forward', '--remove', 'tcp:9225'); } catch {}
}
