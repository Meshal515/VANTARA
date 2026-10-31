/**
 * رحلات Debug الثلاث على APK حقيقي في محاكي، عبر WebView التطبيق وجسوره الأصلية نفسها (CDP):
 *
 *   upgrade-before  على Debug القديم (بنسخ مدمجة): بيانات ويب، مصادر مدمجة مستعملة، مستودع وإضافة مثبتة.
 *   upgrade-after   بعد `adb install -r` بلا حذف: كل ما سبق باقٍ، والمدمجة تُحمَّل من الجهاز **بلا شبكة**.
 *   restart         بعد إعادة تشغيل العملية: المستودع والإضافة والمدمجة باقية.
 *   clean           تثبيت نظيف: لا نسخ مدمجة، لا مستودع، لا إضافة، لا تنزيل ذاتي، وحساب جديد يرى صفر مصادر.
 *   repo-read       من النظيف: إضافة مستودع ← تثبيت مصدر ← قراءة فصل كامل (كل صورة تُنزّل ويُتحقق أنها صورة)،
 *                   ثم مصدر كان مدمجًا يُجلب من الشبكة الموثّقة ويُقرأ له فصل كامل.
 *
 * لا تسجيل دخول ولا حسابات حقيقية. الحكم PASS/FAIL في <phase>.json، والخروج غير الصفري = فشل.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const phase = process.argv[2];
const PHASES = ['upgrade-before', 'upgrade-after', 'restart', 'clean', 'repo-read', 'anime', 'ui-anime'];
if (!PHASES.includes(phase)) throw new Error(`phase: ${PHASES.join('|')}`);
const out = process.env.DEBUG_EVIDENCE || 'android-debug-evidence';
const pkg = 'com.vantara.app.debug';
const KEIYOUSHI = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo';
const AZORA = 'eu.kanade.tachiyomi.extension.ar.azora';
const TEAMX = 'eu.kanade.tachiyomi.extension.ar.teamx';
// إضافات عربية غير مدمجة مرّت في الفحص الحي حتى صورة؛ أول ما يُثبَّت ويُقرأ له فصل كامل يكفي، والمحاولات تُسجَّل
const CS_REPO = 'https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json';
// مصادر أنمي أثبت الفحص الحي تشغيلها؛ كل واحد يُحكم عليه وحده حتى تشغيل فعلي
const ANIME_CANDIDATES = ['AnimeRift', 'Animewitcher', 'Anime4up', 'Aia2tv 2'];
const USER_CANDIDATES = ['Rocks Manga', 'Lava Scans', 'Despair', 'Oduto', 'SayManhwa', 'Loner', 'XSano', 'Kawii', 'ProComic'];

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const shell = (cmd) => adb('shell', 'run-as', pkg, 'sh', '-c', `'${cmd}'`);
mkdirSync(out, { recursive: true });
const proof = { phase, passed: false, steps: {} };
const save = () => writeFileSync(`${out}/${phase}.json`, JSON.stringify(proof, null, 2) + '\n');

const pid = adb('shell', 'pidof', pkg);
if (!/^\d+$/.test(pid)) throw new Error('APK process is not running');
adb('forward', 'tcp:9224', `localabstract:webview_devtools_remote_${pid}`);
let pages;
for (let n = 0; n < 90; n++) {
  try {
    pages = await (await fetch('http://127.0.0.1:9224/json')).json();
    if (pages.some((p) => p.type === 'page' && p.url.startsWith('https://localhost'))) break;
  } catch {}
  await delay(1000);
}
const page = pages?.find((p) => p.type === 'page' && p.url.startsWith('https://localhost'));
if (!page) throw new Error('The APK did not expose its local WebView');
const socket = new WebSocket(page.webSocketDebuggerUrl);
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
for (let n = 0; n < 60 && !(await js('Boolean(window.Capacitor?.Plugins?.ExtensionEngine)')); n++) await delay(1000);

/** خطوة محكومة: تُسجَّل نتيجتها أو سبب فشلها، والفشل يوقف المرحلة. */
async function step(name, fn) {
  const t = Date.now();
  try {
    const value = await fn();
    proof.steps[name] = { result: 'PASS', ms: Date.now() - t, value };
    console.log(`PASS ${phase}/${name}`, JSON.stringify(value)?.slice(0, 300));
    return value;
  } catch (error) {
    proof.steps[name] = { result: 'FAIL', ms: Date.now() - t, error: String(error?.message || error).slice(0, 600) };
    console.log(`FAIL ${phase}/${name}`, proof.steps[name].error);
    throw error;
  } finally { save(); }
}

// ── أدوات داخل WebView ──
const EE = 'Capacitor.Plugins.ExtensionEngine';
const webMarker = `(async()=>{
  const key='vantara.debug.journey-proof',value='journey-20261031';
  const db=await new Promise((res,rej)=>{const r=indexedDB.open('vantara-debug-journey',1);r.onupgradeneeded=()=>r.result.createObjectStore('p');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  if(${JSON.stringify(phase)}==='upgrade-before'){localStorage.setItem(key,value);await new Promise((res,rej)=>{const t=db.transaction('p','readwrite');t.objectStore('p').put(value,key);t.oncomplete=res;t.onerror=()=>rej(t.error)})}
  const stored=await new Promise((res,rej)=>{const r=db.transaction('p').objectStore('p').get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});db.close();
  return {localStorage:localStorage.getItem(key)===value,indexedDB:stored===value};
})()`;
const snapshot = async () => ({
  sources: (await js(`${EE}.sources().then(r=>r.sources.map(s=>s.id).sort())`)),
  repos: (await js(`${EE}.repos().then(r=>({repos:r.repos.map(x=>x.url).sort(),installed:r.installed.map(x=>x.pkg+'@'+x.version).sort()}))`)),
  files: shell('cd files/extensions 2>/dev/null && find . -type f -name "*.apk" | sort; true'),
  userRepos: shell('sha256sum files/extensions/user-repos.json 2>/dev/null | cut -c1-64; true'),
  visible: shell('cat files/extensions/builtin-visible.json 2>/dev/null; true'),
});
const network = async (on) => {
  adb('shell', 'cmd', 'connectivity', 'airplane-mode', on ? 'disable' : 'enable');
  for (let n = 0; n < 30; n++) {
    const online = await js(`fetch('https://raw.githubusercontent.com/keiyoushi/extensions/repo/repo.json',{cache:'no-store'}).then(()=>true,()=>false)`, 30000);
    if (online === on) return { online };
    await delay(1000);
  }
  throw new Error(`network did not become ${on ? 'online' : 'offline'}`);
};

/** فصل كامل: رائج ← حتى ثلاثة أعمال ← الأحدث/الأوسط/الأقدم حتى فصل بأكثر من صفحتين ← كل صورة تُنزّل وتُتحقق. */
const readChapter = (sourceId) => js(`(async()=>{
  const E=${EE},id=${JSON.stringify(sourceId)},trail=[];
  let list=(await E.popular({sourceId:id,page:1}).catch(e=>({mangas:[],e:e.message}))).mangas;
  if(!list.length)list=(await E.latest({sourceId:id,page:1})).mangas;
  for(const manga of list.slice(0,3)){
    const ch=(await E.chapters({sourceId:id,manga}).catch(e=>{trail.push('chapters: '+e.message);return {chapters:[]}})).chapters;
    for(const chapter of [...new Set([ch[0],ch[Math.floor(ch.length/2)],ch[ch.length-1]])].filter(Boolean)){
      const pg=(await E.pages({sourceId:id,chapter}).catch(e=>{trail.push('pages: '+e.message);return {pages:[]}})).pages;
      trail.push(manga.title.slice(0,40)+' / '+(chapter.name||'').slice(0,30)+': '+pg.length+' pages');
      if(pg.length<3)continue;
      let bytes=0;const types=new Set();
      for(const p of pg.slice(0,120)){
        const img=await E.image({sourceId:id,page:p});
        if(!(img.bytes>1024)||!/^image\\//.test(img.contentType||''))throw new Error('page '+p.index+' is not an image: '+img.contentType+' '+img.bytes);
        bytes+=img.bytes;types.add(img.contentType);
      }
      return {work:manga.title.slice(0,60),chapter:(chapter.name||'').slice(0,60),pages:pg.length,imagesRead:Math.min(pg.length,120),bytes,types:[...types],trail};
    }
  }
  throw new Error('no chapter with more than two pages read fully: '+trail.join(' | '));
})()`, 900000);


/** تشغيل فعلي من جهة الشبكة نفسها: أول بايتات الفيديو بترويسات المرشّح، أو أول مقطع HLS. */
async function playable(c) {
  const headers = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', ...(c.headers || {}) };
  const get = async (url, range) => {
    const r = await fetch(url, { headers: range ? { ...headers, range: 'bytes=0-131071' } : headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`);
    return { r, bytes: new Uint8Array(await r.arrayBuffer()) };
  };
  const text = (b) => new TextDecoder().decode(b.slice(0, 200000));
  const media = (b) => b.length > 1024 && (b[0] === 0x47 || [0x66747970, 0x6d6f6f66, 0x73747970].includes(new DataView(b.buffer).getUint32(4)) || (b[0] === 0x1a && b[1] === 0x45));
  let { r, bytes } = await get(c.url, true);
  if (/#EXTM3U/.test(text(bytes))) {
    let list = text(bytes), base = r.url;
    const variant = list.split('\n').find((l) => l && !l.startsWith('#') && /#EXT-X-STREAM-INF/.test(list));
    if (variant) { ({ r, bytes } = await get(new URL(variant.trim(), base).href)); list = text(bytes); base = r.url; }
    const seg = list.split('\n').find((l) => l.trim() && !l.startsWith('#'));
    if (!seg) throw new Error('HLS without segments');
    const encrypted = /#EXT-X-KEY:METHOD=AES/.test(list);
    const s = await get(new URL(seg.trim(), base).href, true);
    if (!(s.bytes.length > 1024) || (!encrypted && !media(s.bytes))) throw new Error(`segment is not video (${s.bytes.length} bytes)`);
    return { kind: encrypted ? 'hls-aes' : 'hls', segmentBytes: s.bytes.length };
  }
  if (!media(bytes)) throw new Error(`not video: ${r.headers.get('content-type')} ${bytes.length} bytes`);
  return { kind: 'file', bytes: bytes.length, type: r.headers.get('content-type') };
}
const AE = 'Capacitor.Plugins.AnimeEngine', VR = 'Capacitor.Plugins.VantaraRuntime';
const installAnime = (name) => js(`(async()=>{await ${VR}.setProfile({profile:'local'});await ${VR}.addRepository({url:${JSON.stringify(CS_REPO)}});
  const rows=(await ${VR}.extensions({url:${JSON.stringify(CS_REPO)}})).extensions,row=rows.find(r=>r.internalName===${JSON.stringify(name)});
  if(!row)throw new Error('not in repository');await ${VR}.install({url:${JSON.stringify(CS_REPO)},pkg:row.pkg});
  for(let n=0;n<40;n++){const s=(await ${AE}.sources()).sources.find(x=>x.pkg===row.pkg);if(s)return {pkg:row.pkg,id:s.id,name:s.name};await new Promise(r=>setTimeout(r,500))}
  throw new Error('installed but not offered as an anime source')})()`, 300000);
async function watchEpisode(sourceId) {
  const trail = [];
  const page = await js(`${AE}.page({sourceId:${JSON.stringify(sourceId)},listing:'popular',page:1}).then(r=>r.page.items)`, 240000);
  for (const anime of page.slice(0, 3)) {
    const work = await js(`${AE}.details({anime:${JSON.stringify(anime)}}).then(r=>r.anime).catch(()=>(${JSON.stringify(anime)}))`, 240000);
    const eps = await js(`${AE}.episodes({anime:${JSON.stringify(work)}}).then(r=>r.episodes)`, 240000).catch((e) => { trail.push(`episodes: ${e.message}`); return []; });
    trail.push(`${anime.title.slice(0, 40)}: ${eps.length} episodes`);
    if (!eps.length) continue;
    const ep = eps[0];
    const out = await js(`${AE}.streams({copies:[${JSON.stringify(work)}],episode:${Number(ep.number) || 1}})`, 400000).catch((e) => { trail.push(`streams: ${e.message}`); return { candidates: [] }; });
    const servers = out.candidates.map((c) => ({ server: c.server, host: c.host, quality: c.quality, container: c.container }));
    trail.push(`episode ${ep.number}: ${servers.length} servers`);
    for (const c of out.candidates.slice(0, 8)) {
      try {
        const play = await playable(c);
        await js(`${AE}.closeSession({session:${JSON.stringify(out.session)}})`).catch(() => {});
        return { work: anime.title.slice(0, 60), episode: ep.number, servers: servers.length, qualities: [...new Set(servers.map((x) => x.quality).filter(Boolean))].sort((a, b) => b - a), played: { server: c.server, host: c.host, quality: c.quality, ...play }, trail };
      } catch (error) { trail.push(`${c.server}@${c.host}: ${String(error.message).slice(0, 80)}`); }
    }
  }
  throw new Error(trail.join(' | '));
}

try {
  if (phase === 'upgrade-before') {
    await step('webData', async () => { const m = await js(webMarker); if (!m.localStorage || !m.indexedDB) throw new Error(JSON.stringify(m)); return m; });
    await step('builtinsUsed', () => js(`(async()=>{const E=${EE};await E.setVisibleBuiltins({pkgs:[${JSON.stringify(AZORA)},${JSON.stringify(TEAMX)}]});
      const a=await E.prepare({sourceId:${JSON.stringify(AZORA)}}),t=await E.prepare({sourceId:${JSON.stringify(TEAMX)}});return {azora:a.name,teamx:t.name}})()`));
    await step('repositoryAndExtension', () => js(`(async()=>{const E=${EE};await E.addRepo({url:${JSON.stringify(KEIYOUSHI)}});
      const rows=(await E.repoIndex({url:${JSON.stringify(KEIYOUSHI)}})).extensions,tried=[];
      for(const name of ${JSON.stringify(USER_CANDIDATES)}){const row=rows.find(r=>r.name===name&&r.arabic&&!r.builtin&&!r.nsfw&&!r.anime);if(!row)continue;
        try{const r=await E.installExtension({repo:${JSON.stringify(KEIYOUSHI)},pkg:row.pkg});await E.prepare({sourceId:r.ids[0]});return {name,pkg:row.pkg,id:r.ids[0]}}catch(e){tried.push(name+': '+e.message)}}
      throw new Error('no candidate installed: '+tried.join(' | '))})()`));
    await step('animeExtension', () => installAnime(ANIME_CANDIDATES[0]));
    proof.snapshot = await step('snapshot', snapshot);
    proof.anime = await step('animeSnapshot', () => js(`${VR}.setProfile({profile:'local'}).then(()=>${VR}.list()).then(d=>({repos:d.repos.map(r=>r.url).sort(),installed:JSON.stringify(d.installed)}))`));
    if (!/vault\/eu\.kanade\.tachiyomi\.extension\.ar\.azora\//.test(proof.snapshot.files)) throw new Error('used built-in has no device copy before the upgrade');
  }

  if (phase === 'upgrade-after' || phase === 'restart') {
    const before = JSON.parse(readFileSync(`${out}/upgrade-before.json`, 'utf8'));
    const user = before.steps.repositoryAndExtension.value;
    await step('webData', async () => { const m = await js(webMarker); if (!m.localStorage || !m.indexedDB) throw new Error(JSON.stringify(m)); return m; });
    const now = await step('snapshot', snapshot);
    await step('nothingLost', () => {
      const missing = (a, b) => a.filter((x) => !b.includes(x));
      const lost = {
        sources: missing(before.snapshot.sources, now.sources),
        repos: missing(before.snapshot.repos.repos, now.repos.repos),
        installed: missing(before.snapshot.repos.installed, now.repos.installed),
        files: missing(before.snapshot.files.split('\n'), now.files.split('\n')),
      };
      if (Object.values(lost).some((l) => l.length) || before.snapshot.userRepos !== now.userRepos || before.snapshot.visible !== now.visible) throw new Error('lost after upgrade: ' + JSON.stringify(lost));
      return { sources: now.sources.length, repos: now.repos.repos, installed: now.repos.installed, deviceCopies: now.files.split('\n').length, userReposUnchanged: true };
    });
    // الدليل على الفصل: النسخة المضمّنة غابت، والمدمجة المستعملة والإضافة تُحمَّلان من الجهاز وحده
    await step('offline', () => network(false));
    await step('loadsFromDeviceWithoutNetwork', () => js(`(async()=>{const E=${EE},r={};
      for(const id of [${JSON.stringify(AZORA)},${JSON.stringify(TEAMX)},${JSON.stringify(user.id)}])r[id]=(await E.prepare({sourceId:id})).name;return r})()`));
    await step('online', () => network(true));
    await step('animeRetained', async () => {
      const now = await js(`${VR}.setProfile({profile:'local'}).then(()=>${VR}.list()).then(d=>({repos:d.repos.map(r=>r.url).sort(),installed:JSON.stringify(d.installed)}))`);
      const pkgId = before.steps.animeExtension.value.pkg;
      const offered = await js(`${AE}.sources().then(r=>r.sources.some(s=>s.pkg===${JSON.stringify(pkgId)}))`);
      if (JSON.stringify(now.repos) !== JSON.stringify(before.anime.repos) || now.installed !== before.anime.installed || !offered) throw new Error('anime repository/extension changed: ' + JSON.stringify({ now, offered }).slice(0, 300));
      return { repos: now.repos.length, extensionKept: true, offeredAsSource: true };
    });
    await step('builtinWorksAfterUpgrade', () => js(`${EE}.popular({sourceId:${JSON.stringify(AZORA)},page:1}).then(r=>{if(!r.mangas.length)throw new Error('empty');return {items:r.mangas.length}})`));
  }

  if (phase === 'clean') {
    await delay(75000); // الإقلاع والتحميل المسبق ودقيقة التحقق اليومي: لا شيء يُنزَّل لحساب لم يضف شيئًا
    const now = await step('snapshot', snapshot);
    await step('noSourcesInstalled', async () => {
      if (now.files) throw new Error('extension packages appeared without the user adding any: ' + now.files);
      if (now.repos.repos.length || now.repos.installed.length) throw new Error('repositories/extensions present on a clean install');
      if (now.visible) throw new Error('visibility written without an account');
      const ready = await js(`${EE}.sources().then(r=>r.sources.filter(s=>s.ready).map(s=>s.id))`);
      if (ready.length) throw new Error('sources loaded on a clean install: ' + ready);
      return { packagesOnDevice: 0, repos: 0, installed: 0, loaded: 0 };
    });
    await step('newAccountSeesZeroSources', () => js(`(async()=>{const m=await import('/lib/source-entitlement.js');
      const d=m.decide({account:{created_at:m.BUNDLED_CUTOVER_MS+1}}),all=(await ${EE}.sources()).sources;
      const shown=all.filter(s=>m.visible(s,d));if(d.state!=='clean'||shown.length)throw new Error('visible: '+shown.map(s=>s.id));
      const legacy=m.decide({account:{created_at:m.BUNDLED_CUTOVER_MS-86400000}});
      return {state:d.state,visible:0,declared:all.length,legacyAccountKeeps:all.filter(s=>m.visible(s,legacy)).length}})()`));
  }

  if (phase === 'repo-read') {
    await step('addRepository', () => js(`${EE}.addRepo({url:${JSON.stringify(KEIYOUSHI)}}).then(r=>({name:r.repo.name,count:r.count}))`));
    const rows = await step('repositoryIndex', () => js(`${EE}.repoIndex({url:${JSON.stringify(KEIYOUSHI)}}).then(r=>r.extensions.filter(x=>x.arabic&&!x.nsfw&&!x.anime).map(x=>({name:x.name,pkg:x.pkg,builtin:x.builtin})))`));
    const attempts = [];
    let read = null;
    for (const name of USER_CANDIDATES) {
      const row = rows.find((r) => r.name === name && !r.builtin);
      if (!row) continue;
      try {
        const ids = await js(`${EE}.installExtension({repo:${JSON.stringify(KEIYOUSHI)},pkg:${JSON.stringify(row.pkg)}}).then(r=>r.ids)`);
        read = { name, pkg: row.pkg, ...(await readChapter(ids[0])) };
        break;
      } catch (error) { attempts.push(`${name}: ${String(error.message).slice(0, 200)}`); }
    }
    proof.attempts = attempts;
    await step('installAndReadFullChapter', async () => { if (!read) throw new Error(attempts.join(' | ')); return read; });
    await step('installedListed', () => js(`${EE}.repos().then(r=>{if(!r.installed.some(x=>x.pkg===${JSON.stringify(read.pkg)}))throw new Error('not listed');return r.installed.map(x=>x.name)})`));
    // مصدر كان مدمجًا: بلا نسخة في التطبيق يُجلب من Keiyoushi بمفتاحه ويُقرأ له فصل كامل
    await step('formerBuiltinFromNetworkFullChapter', () => readChapter(AZORA));
  }

  if (phase === 'ui-anime') {
    // الواجهة الحقيقية كما يلمسها المستخدم: الإضافات ← المثبتة ← المصدر ← فتح ← بطاقة عمل ← صفحة العمل والحلقات
    await step('mountShell', () => js(`(async()=>{window.__uiErrors=[];
      addEventListener('error',e=>__uiErrors.push(String(e.error?.stack||e.message)));addEventListener('unhandledrejection',e=>__uiErrors.push(String(e.reason?.stack||e.reason)));
      const sync={user:null,rows:()=>[],row:()=>null,onChange:()=>()=>{},enqueue:()=>{},translation:async()=>({status:200,body:{rows:[]}}),latestSnapshots:async()=>({sources:[]}),
        presence:async()=>[],stats:async()=>({}),insights:async()=>({}),topWorks:async()=>[],pendingDevices:async()=>[],privacyCapability:async()=>({}),authorizationHeader:null};
      const {mountV35}=await import('/v35/shell.js');
      window.__shell=mountV35({sync,mount:n=>document.querySelector('#root').replaceChildren(n),go:async()=>{},friends:()=>[],presence:async()=>[],version:'journey',switchAccount:()=>{},openReader:()=>{}},{page:'home'});return true})()`));
    const wait = async (expr, label, ms = 60000) => { for (const t = Date.now(); Date.now() - t < ms; await delay(500)) if (await js(`Boolean(${expr})`)) return true; throw new Error('timed out: ' + label + ' | toast=' + (await js(`document.querySelector('#toast')?.textContent||''`)) + ' | errors=' + (await js('JSON.stringify(window.__uiErrors||[]).slice(0,600)'))); };
    const results = {};
    for (const name of ['AnimeRift', 'AnimeWitcher']) {
      try {
        results[name] = await step(`open-${name}`, async () => {
          await js(`(()=>{document.querySelector('[data-act="openDrawer"]').click();[...document.querySelectorAll('.drawer-item')].find(b=>b.textContent.trim()==='الإضافات').click();return true})()`);
          await wait(`document.querySelector('#utility.active .v7-addon')`, 'addons page');
          await js(`[...document.querySelectorAll('.v7-tab')].find(b=>b.textContent.includes('المثبتة')).click()`);
          await wait(`[...document.querySelectorAll('.v7-row')].some(r=>r.querySelector('.v7-name')?.textContent.trim()===${JSON.stringify(name)})`, 'installed row');
          await js(`(()=>{const r=[...document.querySelectorAll('.v7-row')].find(r=>r.querySelector('.v7-name')?.textContent.trim()===${JSON.stringify(name)});[...r.querySelectorAll('button')].find(b=>b.textContent.includes('فتح')).click();return true})()`);
          await wait(`document.querySelector('#utility.active .addon-source')`, 'extension page after «فتح»', 120000);
          await wait(`document.querySelector('#utility.active .addon-source .work-card .up-title')`, 'cards inside the extension page', 120000);
          const title = await js(`(()=>{const c=document.querySelector('#utility.active .addon-source .work-card');const t=c.textContent.trim().slice(0,60);c.click();return t})()`);
          await wait(`document.querySelector('#anime.active, .aw-hero, #cinema.active')`, 'work page after tapping «' + title + '»', 120000);
          await wait(`document.querySelectorAll('#anime.active [data-episode], #anime.active .ep-row, #anime.active .aw-ep, .aw-episodes button').length>0`, 'episodes on the work page', 120000);
          return { opened: title, episodes: await js(`document.querySelectorAll('#anime.active [data-episode], #anime.active .ep-row, #anime.active .aw-ep, .aw-episodes button').length`) };
        });
      } catch (error) { results[name] = { error: String(error.message).slice(0, 700) }; }
      try { const shot = await command('Page.captureScreenshot', { format: 'png' }, 30000); writeFileSync(`${out}/ui-${name}.png`, Buffer.from(shot.data, 'base64')); } catch {}
      await js(`document.querySelector('[data-act="navTo"][data-arg="home"]')?.click()`).catch(() => {});
    }
    proof.ui = results;
    if (Object.values(results).some((r) => r.error)) throw new Error('anime source did not open to a work page with episodes');
  }

  if (phase === 'anime') {
    const results = {};
    for (const name of ANIME_CANDIDATES) {
      try { const src = await installAnime(name); results[name] = { result: 'PASS', ...(await watchEpisode(src.id)) }; }
      catch (error) { results[name] = { result: 'FAIL', error: String(error.message).slice(0, 700) }; }
      console.log(`${results[name].result} anime/${name}`, JSON.stringify(results[name]).slice(0, 400));
      proof.anime = results; save();
    }
    await step('installAndPlay', () => {
      const ok = Object.entries(results).filter(([, r]) => r.result === 'PASS').map(([n]) => n);
      if (!ok.length) throw new Error('no anime source reached real playback');
      return { played: ok, failed: Object.keys(results).filter((n) => !ok.includes(n)) };
    });
  }
  proof.passed = true;
} catch (error) {
  proof.failure = String(error?.stack || error).slice(0, 1500);
  process.exitCode = 1;
} finally {
  try { const s = await command('Page.captureScreenshot', { format: 'png' }, 30000); writeFileSync(`${out}/${phase}.png`, Buffer.from(s.data, 'base64')); } catch {}
  save();
  socket.close();
  try { adb('forward', '--remove', 'tcp:9224'); } catch {}
  if (phase !== 'clean' && phase !== 'repo-read') try { adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'); } catch {}
}
