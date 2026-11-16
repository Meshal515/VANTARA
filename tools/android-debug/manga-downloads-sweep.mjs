/**
 * مسح حي لتنزيل المانجا على APK حقيقي في محاكي: إضافات Keiyoushi حقيقية، أعمال وفصول حقيقية، صور حقيقية.
 *
 * لكل مصدر: تثبيت ← رائج ← تفاصيل وفصول ← فصلان بعددَي صفحات مختلفين ←
 *   (أ) القراءة المباشرة: كل صفحة بمحرك الإضافة نفسه، تُفك في WebView، وبصمتها SHA-256.
 *   (ب) التنزيل بمدير التنزيلات الحقيقي بعد تفريغ كاش الصور (فالتنزيل يجلب من الشبكة فعلًا).
 *   (ج) التحقق مما حُفظ: عدد الصفحات = قائمة المصدر، كل صفحة تُفك، وبصمتها = بصمة القراءة المباشرة.
 * ثم:
 *   - انقطاع: وضع الطيران وسط تنزيل ← «بانتظار الاتصال» لا فشل ← عودة الشبكة ← يكمل وحده ← سليم.
 *   - إيقاف مؤقت ثم استئناف ← يكمل من حيث وقف.
 *   - القارئ الحقيقي: فصل من الإنترنت أولًا (يربط جدولة الصور بمحرك المصادر: عطل سابق)، ثم وضع الطيران،
 *     ثم الفصل المحمّل في القارئ نفسه كما يُفتح من صفحة العمل، وكل صفحة تُعرض فعلًا (naturalWidth > 0).
 *
 * لا حسابات حقيقية. النتيجة manga-sweep.json وmanga-sweep.md ولقطات من شاشة الجهاز.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const out = process.env.DEBUG_EVIDENCE || 'manga-evidence';
const pkg = 'com.vantara.app.debug';
const KEIYOUSHI = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo';
// مصادر متنوعة القوالب والحمايات: Madara، MangaThemesia، API (MangaDex)، صور مبعثرة (MangaFire)، مضيفات صور
// بـReferer، وعربية وإنجليزية. ما ليس في الفهرس يُتخطى ويُذكر.
const WANTED = (process.env.MANGA_SOURCES || [
  'MangaDex', 'MangaFire', 'Mangakakalot', 'MangaHere', 'Weeb Central', 'MangaPill', 'MangaKatana', 'Manga Town', 'Comick',
  'Mangarill', 'MangaReader', 'Bato.to', 'Asura Scans', 'Toonily',
  'Rocks Manga', 'Lava Scans', 'Despair', 'Oduto', 'SayManhwa', 'Hizo Manga', 'Manga Swat', 'Mangalek', 'Team X', 'Azora',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const MAX_SOURCES = Number(process.env.MANGA_MAX_SOURCES || 12);
const CHAPTERS_PER_SOURCE = Number(process.env.MANGA_CHAPTERS || 2);
const MAX_PAGES = 80;

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
mkdirSync(out, { recursive: true });
const proof = { startedAt: new Date().toISOString(), sources: [], scenarios: {}, shots: [], index: null };
const save = () => writeFileSync(`${out}/manga-sweep.json`, JSON.stringify(proof, null, 2) + '\n');
let shotNo = 0;
const shot = async (name) => {
  try { adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.CLOSE_SYSTEM_DIALOGS'); } catch {}
  await delay(700);
  const file = `shot-${String(++shotNo).padStart(2, '0')}-${name}.png`;
  writeFileSync(`${out}/${file}`, execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));
  proof.shots.push(file);
  save();
};
for (const cmd of [['pm', 'disable-user', '--user', '0', 'com.google.android.apps.nexuslauncher'], ['settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed']]) { try { adb('shell', ...cmd); } catch {} }
const pid = adb('shell', 'pidof', pkg);
adb('forward', 'tcp:9226', `localabstract:webview_devtools_remote_${pid}`);
let pages;
for (let n = 0; n < 90; n++) {
  try {
    pages = await (await fetch('http://127.0.0.1:9226/json')).json();
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
const command = (method, params = {}, ms = 300000) => new Promise((resolve, reject) => {
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

const airplane = async (on) => {
  adb('shell', 'cmd', 'connectivity', 'airplane-mode', on ? 'enable' : 'disable');
  for (let n = 0; n < 40; n++) {
    const online = await js(`fetch('https://raw.githubusercontent.com/keiyoushi/extensions/repo/repo.json',{cache:'no-store'}).then(()=>true,()=>false)`, 30000);
    if (online === !on) { await delay(on ? 500 : 2500); return { online }; }
    await delay(1000);
  }
  throw new Error('airplane mode did not settle');
};

// أدوات داخل الصفحة: فك صورة وبصمتها، ومدير التنزيلات الحقيقي
await js(`(async()=>{
  window.__uiErrors=[];addEventListener('error',e=>__uiErrors.push(String(e.error?.stack||e.message)));addEventListener('unhandledrejection',e=>__uiErrors.push(String(e.reason?.stack||e.reason)));
  const hex=(b)=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  window.__qa={
    async inspect(buf,type){
      const sha=hex(await crypto.subtle.digest('SHA-256',buf));
      try{const bm=await createImageBitmap(new Blob([buf],{type:type||'image/jpeg'}));const r={ok:bm.width>0&&bm.height>0,w:bm.width,h:bm.height,sha,bytes:buf.byteLength};bm.close?.();return r}
      catch(e){return {ok:false,sha,bytes:buf.byteLength,why:String(e.message||e)}}
    },
    async fromSrc(src){const r=await fetch(src);const buf=await r.arrayBuffer();return this.inspect(buf,r.headers.get('content-type'))},
    dl: ()=>import('/lib/downloads/index.js').then(m=>m.downloads()),
  };
  return true})()`);
const EE = 'Capacitor.Plugins.ExtensionEngine';
const EEJ = `import('/lib/extension-engine.js').then(m=>m.default)`;

async function step(bucket, name, fn) {
  const t = Date.now();
  try {
    const value = await fn();
    bucket[name] = { result: 'PASS', ms: Date.now() - t, value };
    console.log(`PASS ${name}`, JSON.stringify(value)?.slice(0, 300));
    return value;
  } catch (error) {
    bucket[name] = { result: 'FAIL', ms: Date.now() - t, error: String(error?.message || error).slice(0, 900) };
    console.log(`FAIL ${name}`, bucket[name].error);
    return null;
  } finally { save(); }
}

/** القراءة المباشرة لفصل: كل صفحة من محرك الإضافة كما يطلبها القارئ، مفكوكة وببصمتها. */
async function readOnline(sourceId, chapter) {
  return js(`(async()=>{const e=await ${EEJ};const list=await e.pages(${JSON.stringify(sourceId)},${JSON.stringify(chapter)});
    const pages=list.slice(0,${MAX_PAGES});const out=[];let i=0;
    const work=async()=>{while(i<pages.length){const k=i++;try{const img=await e.pageImage(${JSON.stringify(sourceId)},pages[k]);out[k]=await __qa.fromSrc(img.src)}catch(err){out[k]={ok:false,why:String(err.code||'')+' '+String(err.message||err).slice(0,200)}}}};
    await Promise.all([work(),work(),work()]);
    return {count:list.length,pages:out}})()`, 600000);
}

async function waitItem(id, ms, onTick) {
  const t = Date.now();
  let last = null;
  while (Date.now() - t < ms) {
    last = await js(`__qa.dl().then(({manager})=>{const i=manager.get(${JSON.stringify(id)});return i&&{state:i.state,pages:i.pages,pagesTotal:i.pagesTotal,error:i.error,source:i.source,attempts:i.attempts,stage:i.stage??null}})`);
    if (onTick) await onTick(last);
    if (!last || ['ready', 'failed', 'no_space'].includes(last.state)) return last;
    await delay(1500);
  }
  return { ...last, timedOut: true };
}

/** ما حُفظ على الجهاز لهذا العنصر: كل صفحة تُفك وبصمتها. */
async function verifyStored(id) {
  return js(`(async()=>{const {manager,store}=await __qa.dl();const it=manager.get(${JSON.stringify(id)});const total=Number(it?.pagesTotal??0);const out=[];
    for(let i=0;i<total;i++){const p=await store.getPage(it.id,i);if(!p?.data){out.push({ok:false,why:'missing'});continue}
      const r=await __qa.inspect(p.data,p.type);r.lengthMatches=p.data.byteLength===p.bytes;out.push(r)}
    return {state:it?.state,pagesTotal:total,storedBytes:it?.storage?.bytes??null,pages:out}})()`, 600000);
}

async function enqueue(source, work, ch, unitKey) {
  const spec = { section: 'manga', work: { ref: `qa:${source.sourceId}:${work.url}`, title: work.title }, unit: { key: unitKey, number: ch.chapterNumber, title: ch.name },
    source: { mode: 'manual', sourceId: source.sourceId, sourceName: source.name }, request: { sourceId: source.sourceId, chapter: ch } };
  return js(`__qa.dl().then(({manager})=>manager.enqueue([${JSON.stringify(spec)}])).then(r=>({id:r.added[0]?.id??r.skipped[0]?.item?.id,skipped:r.skipped.map(s=>s.reason)}))`);
}

const compare = (online, stored) => {
  const n = Math.min(online.pages.length, stored.pages.length);
  let same = 0;
  for (let i = 0; i < n; i++) if (online.pages[i]?.sha && online.pages[i].sha === stored.pages[i]?.sha) same++;
  return {
    onlineCount: online.count, storedCount: stored.pagesTotal,
    onlineDecoded: online.pages.filter((p) => p?.ok).length, storedDecoded: stored.pages.filter((p) => p?.ok && p.lengthMatches).length,
    identical: same, compared: n,
  };
};

const ready = [];
try {
  await step(proof.scenarios, 'addRepository', () => js(`${EE}.addRepo({url:${JSON.stringify(KEIYOUSHI)}}).then(()=>true)`, 180000));
  const index = await step(proof.scenarios, 'repoIndex', () => js(`${EE}.repoIndex({url:${JSON.stringify(KEIYOUSHI)}}).then(r=>r.extensions.filter(x=>!x.nsfw&&!x.anime).map(x=>({name:x.name,pkg:x.pkg,lang:x.lang,builtin:x.builtin,sources:x.sources})))`, 180000));
  const builtins = (await js(`${EE}.sources().then(r=>r.sources.map(s=>({id:s.id,label:s.label,lang:s.lang,pkg:s.pkg})))`)) ?? [];
  proof.index = { size: index?.length ?? 0, rill: (index ?? []).filter((x) => /rill/i.test(x.name)).map((x) => x.name), builtins: builtins.length };
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  let used = 0;
  for (const name of WANTED) {
    if (used >= MAX_SOURCES) break;
    const rec = { wanted: name, steps: {}, chapters: [] };
    const builtin = builtins.find((b) => norm(b.label) === norm(name));
    const row = (index ?? []).find((r) => norm(r.name) === norm(name) || (r.sources ?? []).some((s) => norm(s) === norm(name)));
    if (!builtin && !row) { rec.skipped = 'not in index'; proof.sources.push(rec); save(); continue; }
    proof.sources.push(rec);
    const source = await step(rec.steps, 'install', async () => {
      if (builtin) { await js(`${EE}.prepare({sourceId:${JSON.stringify(builtin.id)}})`, 240000); return { sourceId: builtin.id, name: builtin.label, builtin: true }; }
      if (row.builtin) {
        // حزمة مدمجة اسمها في القائمة بالعربية: تُعرف بحزمتها
        const b = builtins.filter((x) => x.pkg === row.pkg).sort((a, c) => Number(!/^(en|ar)$/.test(a.lang)) - Number(!/^(en|ar)$/.test(c.lang)))[0];
        if (!b) throw new Error('builtin package without listed source');
        await js(`${EE}.prepare({sourceId:${JSON.stringify(b.id)}})`, 240000);
        return { sourceId: b.id, name: b.label || row.name, builtin: true };
      }
      const ids = await js(`${EE}.installExtension({repo:${JSON.stringify(KEIYOUSHI)},pkg:${JSON.stringify(row.pkg)}}).then(r=>r.ids)`, 300000);
      const srcs = await js(`${EE}.sources().then(r=>r.sources.filter(s=>${JSON.stringify(ids)}.includes(s.id)).map(s=>({id:s.id,label:s.label,lang:s.lang})))`);
      const pick = srcs.find((s) => /^(en|ar|all)$/.test(s.lang)) ?? srcs[0];
      return { sourceId: pick?.id ?? ids[0], name: pick?.label ?? row.name, lang: pick?.lang, pkg: row.pkg };
    });
    if (!source) continue;
    used++;
    rec.source = source;
    const works = await step(rec.steps, 'popular', async () => {
      let r = await js(`${EE}.popular({sourceId:${JSON.stringify(source.sourceId)},page:1}).then(r=>r.mangas.slice(0,6))`, 180000).catch(() => null);
      if (!r?.length) r = await js(`${EE}.latest({sourceId:${JSON.stringify(source.sourceId)},page:1}).then(r=>r.mangas.slice(0,6))`, 180000);
      if (!r?.length) throw new Error('no works');
      return r;
    });
    if (!works) continue;
    // أول عمل له فصول بصفحات؛ فصلان متباعدان (الأحدث وآخر أقدم) لأعداد صفحات مختلفة
    let picked = 0;
    for (const work of works) {
      if (picked >= CHAPTERS_PER_SOURCE) break;
      const series = await js(`${EE}.series({sourceId:${JSON.stringify(source.sourceId)},manga:${JSON.stringify(work)}}).then(r=>({manga:r.manga,chapters:r.chapters}))`, 180000).catch((e) => ({ error: String(e.message) }));
      if (!series?.chapters?.length) { rec.chapters.push({ work: work.title, error: series?.error ?? 'no chapters' }); continue; }
      const chs = series.chapters.filter((c) => c.url && !/^(n-a|#)$/.test(c.url));
      const candidates = [...new Map([chs[0], chs[Math.floor(chs.length / 2)], chs[chs.length - 1]].filter(Boolean).map((c) => [c.url, c])).values()];
      for (const ch of candidates) {
        if (picked >= CHAPTERS_PER_SOURCE) break;
        const c = { work: work.title, chapter: ch.name, number: ch.chapterNumber };
        rec.chapters.push(c);
        const online = await readOnline(source.sourceId, ch).catch((e) => ({ error: String(e.message).slice(0, 300) }));
        c.online = online.error ? { error: online.error } : { count: online.count, decoded: online.pages.filter((p) => p?.ok).length, failures: online.pages.filter((p) => !p?.ok).slice(0, 3) };
        save();
        if (!online.count) continue;
        // كاش الصور يُفرغ: التنزيل يجلب من الموقع لا من نسخة القراءة المباشرة
        await js(`${EE}.clearImageCache()`).catch(() => {});
        const q = await enqueue(source, work, ch, `qa-${picked}-${ch.url}`);
        c.itemId = q.id;
        const t0 = Date.now();
        const end = await waitItem(q.id, 6 * 60000);
        c.download = { ...end, ms: Date.now() - t0 };
        if (end?.state === 'ready') {
          const stored = await verifyStored(q.id);
          c.verify = compare(online, stored);
          c.verify.ok = c.verify.storedCount === c.verify.onlineCount && c.verify.storedDecoded === c.verify.storedCount;
          c.verify.badPages = stored.pages.map((p, i) => (!p.ok || !p.lengthMatches ? { i, ...p } : null)).filter(Boolean).slice(0, 5);
          if (c.verify.ok) ready.push({ source, work, ch, series, itemId: q.id, count: c.verify.storedCount });
        }
        picked++;
        save();
        console.log(`${source.name} · ${work.title} · ${ch.name}: online ${c.online.count ?? c.online.error} → ${c.download.state} ${JSON.stringify(c.verify ?? c.download.error ?? '')}`);
      }
    }
  }

  // ───── انقطاع وسط التنزيل ثم عودة الشبكة ─────
  const big = [...ready].sort((a, b) => b.count - a.count)[0];
  if (big) {
    await step(proof.scenarios, 'networkDropMidDownload', async () => {
      await js(`__qa.dl().then(({manager})=>manager.remove(${JSON.stringify(big.itemId)}))`);
      await js(`${EE}.clearImageCache()`).catch(() => {});
      const q = await enqueue(big.source, big.work, big.ch, `qa-drop-${big.ch.url}`);
      let dropped = false;
      const seen = new Set();
      const end = await waitItem(q.id, 10 * 60000, async (s) => {
        seen.add(s?.state);
        if (!dropped && s?.pages >= 2) {
          dropped = true;
          await airplane(true);
          await delay(25000);
          const during = await js(`__qa.dl().then(({manager})=>manager.get(${JSON.stringify(q.id)})).then(i=>({state:i.state,pages:i.pages,error:i.error}))`);
          proof.scenarios.networkDropDuring = during;
          await shot('download-waiting-network').catch(() => {});
          if (during.state === 'failed') throw new Error(`failed while offline: ${JSON.stringify(during)}`);
          await airplane(false);
        }
      });
      if (end?.state !== 'ready') throw new Error(JSON.stringify(end));
      const stored = await verifyStored(q.id);
      const v = { states: [...seen], ...compare({ count: big.count, pages: [] }, stored) };
      if (stored.pagesTotal !== big.count || v.storedDecoded !== big.count) throw new Error(JSON.stringify(v));
      big.itemId = q.id;
      return v;
    });

    // ───── إيقاف مؤقت ثم استئناف ─────
    const other = ready.find((r) => r !== big && r.count >= 6) ?? big;
    await step(proof.scenarios, 'pauseResume', async () => {
      await js(`__qa.dl().then(({manager})=>manager.remove(${JSON.stringify(other.itemId)}))`);
      await js(`${EE}.clearImageCache()`).catch(() => {});
      const q = await enqueue(other.source, other.work, other.ch, `qa-pause-${other.ch.url}`);
      let paused = null;
      await waitItem(q.id, 5 * 60000, async (s) => {
        if (!paused && s?.pages >= 2 && s.state === 'downloading') {
          await js(`__qa.dl().then(({manager})=>manager.pause(${JSON.stringify(q.id)}))`);
          await delay(3000);
          paused = await js(`__qa.dl().then(({manager})=>manager.get(${JSON.stringify(q.id)})).then(i=>({state:i.state,pages:i.pages}))`);
          await js(`__qa.dl().then(({manager})=>manager.resume(${JSON.stringify(q.id)}))`);
        }
      });
      const stored = await verifyStored(q.id);
      if (stored.state !== 'ready' || stored.pages.some((p) => !p.ok)) throw new Error(JSON.stringify({ paused, state: stored.state }));
      other.itemId = q.id;
      return { paused, pages: stored.pagesTotal };
    });
  }

  // ───── الذكي: مصدر الفصل الأول معطوب ⇒ يكمل من نسخة حقيقية أخرى (بديل) ─────
  if (ready.length) {
    const alt = ready[ready.length - 1];
    await step(proof.scenarios, 'smartFallbackToAlternate', async () => {
      const broken = ready.find((x) => x.source.sourceId !== alt.source.sourceId) ?? alt;
      const spec = { section: 'manga', work: { ref: `qa-fallback:${alt.work.url}`, title: alt.work.title }, unit: { key: `qa-fallback-${alt.ch.url}`, number: alt.ch.chapterNumber },
        source: { mode: 'smart', sourceId: broken.source.sourceId, sourceName: broken.source.name },
        request: { sourceId: broken.source.sourceId, chapter: { ...broken.ch, url: `${broken.ch.url}-vantara-qa-missing` }, alternates: [{ sourceId: alt.source.sourceId, chapter: alt.ch, sourceName: alt.source.name }] } };
      const id = await js(`__qa.dl().then(({manager})=>manager.enqueue([${JSON.stringify(spec)}])).then(r=>r.added[0]?.id)`);
      const end = await waitItem(id, 6 * 60000);
      if (end?.state !== 'ready') throw new Error(JSON.stringify(end));
      const stored = await verifyStored(id);
      if (stored.pages.some((x) => !x.ok)) throw new Error('bad pages after fallback');
      return { from: broken.source.name, to: end.source?.sourceId, fallbackFrom: end.source?.fallbackFrom, pages: stored.pagesTotal };
    });
  }

  // ───── القارئ الحقيقي: فصل من الإنترنت ثم المحمّل بلا اتصال ─────
  if (ready.length) {
    // عمل فيه فصل محمّل وفصل آخر غير محمّل: الأول يُقرأ من الإنترنت (يربط القارئ بمحرك المصادر)، ثم المحمّل بلا اتصال
    const readyUrls0 = new Set(ready.map((x) => x.ch.url));
    const r = ready.find((x) => (x.series.chapters ?? []).some((c) => c.url && !readyUrls0.has(c.url))) ?? ready[0];
    const mountReader = (row, rows) => js(`(async()=>{
      const {openSmartReader}=await import('/v35/reader.js');const {readerEngine}=await import('/lib/reader-engine.js');
      const sync={user:{userId:'qa',displayName:'QA'},ready:Promise.resolve(),rows:()=>[],row:()=>null,onChange:()=>()=>{},enqueue:()=>Promise.resolve(),refreshSession:async()=>{},translation:async()=>({status:200,body:{rows:[]}})};
      window.__reader?.destroy?.();
      const mount=n=>document.querySelector('#root').replaceChildren(n);
      const rows=${JSON.stringify(rows)};const row=rows[${JSON.stringify(rows.indexOf(row))}];
      window.__reader=openSmartReader({sync,engine:readerEngine,mount,exit:()=>{},friends:()=>[],setReading:()=>{},immersive:()=>{}},{seriesRef:'qa',title:'QA',work:{_chapters:rows},rows,row});
      return true})()`);
    const readAll = async (label, expected) => {
      const t = Date.now();
      let stat = null;
      while (Date.now() - t < 180000) {
        stat = await js(`(()=>{const s=document.querySelector('#rdScroll');const imgs=[...document.querySelectorAll('.rd img')].filter(i=>!i.closest('.rd-zoom'));
          const ok=imgs.filter(i=>i.complete&&i.naturalWidth>0).length;const errs=document.querySelectorAll('.rd-page--error').length;
          if(s)s.scrollTop=Math.min(s.scrollHeight,s.scrollTop+Math.max(600,innerHeight*1.5));
          return {ok,errs,slots:document.querySelectorAll('.rd-page,[data-index]').length,firstChapterErr:document.querySelector('.rd-error h3')?.textContent||null}})()`);
        if (stat.firstChapterErr || stat.ok >= expected || stat.errs) break;
        await delay(700);
      }
      await shot(label);
      return stat;
    };
    const rowsOf = (x) => {
      const list = (x.series.chapters ?? []).filter((c) => c.url);
      const at = list.findIndex((c) => c.url === x.ch.url);
      const around = list.slice(Math.max(0, at - 20), at + 20);
      return (around.length ? around : [x.ch]).map((c) => ({ sourceId: x.source.sourceId, chapter: c, number: c.chapterNumber, label: x.source.name }));
    };
    const rows = rowsOf(r);
    const downloadedRow = rows.find((x) => x.chapter.url === r.ch.url);
    const readyUrls = new Set(ready.map((x) => x.ch.url));
    const onlineRow = rows.find((x) => !readyUrls.has(x.chapter.url)) ?? null;
    if (onlineRow) {
      await step(proof.scenarios, 'readerOnlineFirst', async () => {
        await mountReader(onlineRow, rows);
        const s = await readAll('reader-online', 2);
        if (!(s.ok >= 1)) throw new Error(JSON.stringify(s));
        return s;
      });
    }
    await airplane(true);
    await step(proof.scenarios, 'readerDownloadedOffline', async () => {
      await mountReader(downloadedRow, rows);
      const s = await readAll('reader-downloaded-offline', r.count);
      if (s.ok < r.count) throw new Error(JSON.stringify({ ...s, expected: r.count }));
      return { ...s, expected: r.count };
    });
    // كل فصل جاهز يُقرأ من الجهاز بمحرك القارئ (بلا شبكة)، صفحةً صفحة
    await step(proof.scenarios, 'allDownloadedReadableOffline', async () => {
      const res = [];
      for (const x of ready) {
        const v = await js(`(async()=>{const {readerEngine}=await import('/lib/reader-engine.js');const list=await readerEngine.pages(${JSON.stringify(x.source.sourceId)},${JSON.stringify(x.ch)});
          let ok=0;for(const p of list){try{const img=await readerEngine.pageImage(${JSON.stringify(x.source.sourceId)},p);const r=await __qa.fromSrc(img.src);if(r.ok&&img.local)ok++}catch{}}return {pages:list.length,ok}})()`, 300000);
        res.push({ source: x.source.name, chapter: x.ch.name, ...v, expected: x.count });
      }
      const bad = res.filter((v) => v.ok !== v.expected || v.pages !== v.expected);
      if (bad.length) throw new Error(JSON.stringify(bad));
      return res;
    });
    await airplane(false);
  }
} catch (error) {
  proof.failure = String(error?.stack || error).slice(0, 1500);
  process.exitCode = 1;
} finally {
  try { adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'); } catch {}
  proof.uiErrors = await js('JSON.stringify(window.__uiErrors||[]).slice(0,3000)').catch(() => null);
  proof.finishedAt = new Date().toISOString();
  save();
  // جدول مقروء
  const lines = ['| المصدر | العمل | الفصل | مباشر (صفحات/مفكوكة) | التنزيل | المحفوظ (صفحات/مفكوكة/مطابقة) | الحكم |', '|---|---|---|---|---|---|---|'];
  for (const s of proof.sources) {
    if (s.skipped || !s.source) { lines.push(`| ${s.wanted} | — | — | — | — | — | ${s.skipped ?? s.steps.install?.error?.slice(0, 80) ?? s.steps.popular?.error?.slice(0, 80) ?? 'FAIL'} |`); continue; }
    if (!s.chapters.length) lines.push(`| ${s.source.name} | — | — | — | — | — | ${s.steps.popular?.error?.slice(0, 80) ?? 'لا فصول'} |`);
    for (const c of s.chapters) {
      const v = c.verify;
      const verdict = v?.ok ? (v.identical === v.compared ? 'PASS' : `PASS (بصمات مختلفة ${v.compared - v.identical})`) : c.download ? `FAIL ${c.download.error?.code ?? c.download.state}: ${String(c.download.error?.message ?? '').slice(0, 90)}` : c.online?.error ? `مباشر: ${c.online.error.slice(0, 90)}` : c.error ?? '—';
      lines.push(`| ${s.source.name} | ${c.work} | ${c.chapter ?? ''} | ${c.online?.count ?? '✗'}/${c.online?.decoded ?? '✗'} | ${c.download?.state ?? '—'} ${c.download?.ms ? Math.round(c.download.ms / 1000) + 'ث' : ''} | ${v ? `${v.storedCount}/${v.storedDecoded}/${v.identical}` : '—'} | ${verdict} |`);
    }
  }
  lines.push('', '| السيناريو | النتيجة |', '|---|---|');
  for (const [k, v] of Object.entries(proof.scenarios)) if (v?.result) lines.push(`| ${k} | ${v.result} ${String(JSON.stringify(v.value ?? v.error)).slice(0, 220)} |`);
  writeFileSync(`${out}/manga-sweep.md`, lines.join('\n') + '\n');
  socket.close();
  try { adb('forward', '--remove', 'tcp:9226'); } catch {}
}
