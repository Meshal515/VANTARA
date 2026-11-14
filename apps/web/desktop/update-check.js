/**
 * تحديث ويندوز اليدوي: لا فحص ولا إشعار ولا تنزيل إلا حين يضغط المستخدم «البحث عن تحديثات» في
 * الإعدادات. كل قناة لها بيانها:
 *  - Debug: windows-debug-channel/desktop-debug.json (format 3، رقم بناء صاعد).
 *  - Stable: آخر stable-N (vantara-update.json، حقل desktop).
 *
 * السبب الجذري لظهور واجهة أقدم بعد «التحديث»: Stable (0.0.N) كان يقرأ windows-channel القديمة
 * (0.3.18)، و0.3.18 أكبر رقميًا من 0.0.215 مع أنها أقدم كودًا. لذلك لا تقبل أي قناة بيان قناة أخرى،
 * ويُرفض كل تحديث رقم بنائه ليس أكبر من المثبت (والعملية الرئيسية تعيد الفحص نفسه قبل التنزيل).
 */
const RELEASES = 'https://github.com/Meshal515/VANTARA/releases';
export const MANIFEST_URLS = Object.freeze({
  stable: `${RELEASES}/latest/download/vantara-update.json`,
  debug: `${RELEASES}/download/windows-debug-channel/desktop-debug.json`,
});
/** للتوافق مع من يستورد الاسم القديم: بيان Stable. */
export const MANIFEST_URL = MANIFEST_URLS.stable;
export const manifestUrlFor = channel => MANIFEST_URLS[channel === 'debug' ? 'debug' : 'stable'];

export function newerVersion(candidate, installed) {
  const parse = value => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/.exec(String(value ?? ''));
    return m ? [Number(m[1]),Number(m[2]),Number(m[3]),m[4] == null ? 1 : 0,Number(m[4] ?? 0)] : null;
  };
  const a=parse(candidate), b=parse(installed);
  if(!a||!b) return false;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]>b[i];
  return false;
}

function githubAsset(value, pathname) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.search || url.hash || url.username || url.password) return null;
  return url.pathname === pathname ? url.href : null;
}
const validFile = entry => /^[a-f0-9]{64}$/i.test(entry?.sha256 ?? '') && Number.isSafeInteger(entry?.size) && entry.size > 0;
const notesOf = list => (Array.isArray(list) ? list : []).slice(0, 4).map(String);

/** يتحقق من بيان قناة واحدة ويعيده بشكل ثابت؛ بيان قناة أخرى = null. */
function validatedRelease(manifest, channel = 'stable') {
  if (channel === 'debug') {
    const m = manifest;
    if (m?.format !== 3 || m.product !== 'VANTARA' || m.channel !== 'windows-debug' || m.platform !== 'win32-x64' || m.installer !== 'nsis') return null;
    if (!Number.isSafeInteger(m.build) || m.build <= 0 || !/^\d+\.\d+\.\d+$/.test(m.version ?? '') || !m.version.endsWith(`.${m.build}`) || !validFile(m)) return null;
    const url = githubAsset(m.url, `/Meshal515/VANTARA/releases/download/windows-debug-${m.build}/VANTARA-Debug-${m.version}-Windows-x64-Setup.exe`);
    if (!url) return null;
    return {channel:'debug',version:m.version,build:m.build,url,sha256:m.sha256,size:m.size,notes:notesOf(m.notes),
      sourceSha:/^[0-9a-f]{7,40}$/.test(m.sourceSha ?? '') ? m.sourceSha : null,
      builtAt:typeof m.builtAt === 'string' && !Number.isNaN(Date.parse(m.builtAt)) ? m.builtAt : null};
  }
  // Stable: البيان الموحد stable-N فقط. بيان windows-channel القديم (format 1) لا يُقبل أبدًا.
  if (manifest?.format !== 2 || manifest.versionName !== manifest.desktop?.version) return null;
  const entry = manifest.desktop;
  if (entry?.platform !== 'win32-x64' || entry.installer !== 'nsis' || !/^\d+\.\d+\.\d+$/.test(entry.version ?? '') || !validFile(entry)) return null;
  if (!Number.isSafeInteger(manifest.versionCode) || manifest.versionCode <= 0) return null;
  const url = githubAsset(entry.url, `/Meshal515/VANTARA/releases/download/stable-${manifest.versionCode}/VANTARA-${entry.version}-Windows-x64-Setup.exe`);
  if (!url) return null;
  return {channel:'stable',version:entry.version,build:manifest.versionCode,url,sha256:entry.sha256,size:entry.size,notes:notesOf(manifest.changelog),sourceSha:null,builtAt:null};
}

const installedOf = value => typeof value === 'string' || value == null
  ? {version:value,channel:'stable',build:null}
  : {version:value.version,channel:value.channel === 'debug' ? 'debug' : 'stable',build:Number.isSafeInteger(value.build) && value.build > 0 ? value.build : null};

/** التحديث المعروض، أو null إن لم يكن أحدث في الإصدار ورقم البناء معًا. */
export function desktopUpdateFromManifest(manifest, installedValue) {
  const installed = installedOf(installedValue);
  const entry = validatedRelease(manifest, installed.channel);
  // إصدار مجهول (0.0.0 حين لا يصل رقم الإصدار للواجهة) ليس «أقدم»: كان سيعرض التحديث نفسه بعد كل تثبيت
  if (!entry || !/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(installed.version ?? '') || installed.version === '0.0.0') return null;
  if (installed.build != null && entry.build <= installed.build) return null;
  const legacyPreview = installed.channel === 'stable' && /^\d+\.\d+\.\d+-preview\.\d+$/.test(installed.version);
  return newerVersion(entry.version, installed.version) || legacyPreview ? entry : null;
}

export async function checkDesktopUpdate(bridge, {url} = {}) {
  if(!bridge?.requestResource) throw new Error('جسر تحديث ويندوز غير متاح');
  const channel = bridge.channel === 'debug' ? 'debug' : 'stable';
  const result=await bridge.requestResource({url:url ?? manifestUrlFor(channel),json:true,limit:256*1024,timeout:20000});
  if(result.status!==200||typeof result.text!=='string')throw new Error('تعذر قراءة تحديث فانتارا');
  let data;
  try {data=JSON.parse(result.text);} catch{throw new Error('بيان التحديث غير صالح');}
  if (!validatedRelease(data, channel)) throw new Error(channel === 'debug' ? 'بيان تحديث ويندوز Debug غير متاح أو غير صالح' : 'بيان تحديث ويندوز غير متاح أو غير صالح');
  return desktopUpdateFromManifest(data,{version:bridge.version,channel,build:bridge.build});
}

/** وصف النسخة المثبتة كما يظهر في الإعدادات: «VANTARA Debug 0.4.12 · بناء 12 · abcdef1». */
export function describeInstalled(bridge) {
  if (!bridge) return '';
  const parts = [`${bridge.channel === 'debug' ? 'VANTARA Debug' : 'VANTARA'} ${bridge.version ?? ''}`.trim()];
  if (bridge.build) parts.push(`بناء ${bridge.build}`);
  if (bridge.sourceSha) parts.push(bridge.sourceSha.slice(0, 7));
  if (bridge.builtAt) parts.push(bridge.builtAt.slice(0, 10));
  return parts.join(' · ');
}

const STYLE = `[data-vantara-desktop-update]{position:fixed;inset-block-end:20px;inset-inline-start:20px;z-index:10050;direction:rtl;width:min(420px,calc(100vw - 40px));
padding:18px 20px 16px;border-radius:16px;background:#141219f2;color:#f4f2f8;border:1px solid #ffffff14;box-shadow:0 18px 48px #000a;font:14px/1.5 inherit;
backdrop-filter:blur(18px);animation:vdu-in .22s cubic-bezier(.2,.8,.2,1)}
@keyframes vdu-in{from{opacity:0;transform:translateY(8px)}}
@media (prefers-reduced-motion:reduce){[data-vantara-desktop-update]{animation:none}}
[data-vantara-desktop-update] strong{display:block;font-size:15px;font-weight:700}
[data-vantara-desktop-update] p{margin:4px 0 0;color:#b9b4c6}
[data-vantara-desktop-update] ul{margin:8px 0 0;padding-inline-start:18px;color:#d6d2e0}
[data-vantara-desktop-update] progress{display:block;width:100%;height:4px;margin-top:10px;appearance:none;border:0;border-radius:4px;background:#ffffff1a;overflow:hidden}
[data-vantara-desktop-update] progress::-webkit-progress-bar{background:#ffffff1a}
[data-vantara-desktop-update] progress::-webkit-progress-value{background:#8b5cf6}
[data-vantara-desktop-update] [data-update-actions]{display:flex;gap:8px;margin-top:14px}
[data-vantara-desktop-update] button{border:0;border-radius:10px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;background:#ffffff14;color:inherit}
[data-vantara-desktop-update] button:first-child{background:#f4f2f8;color:#141219}
[data-vantara-desktop-update] button:hover{filter:brightness(1.1)}
[data-vantara-desktop-update] button:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}`;

export function startDesktopUpdateWatch({bridge=globalThis.VantaraDesktop,doc=globalThis.document} = {}) {
  if(!bridge?.requestResource||!bridge?.openUpdatePage||!doc?.body)return null;
  let checking=null,disposed=false,downloading=null,offProgress=null,settled=null;
  const product = bridge.channel === 'debug' ? 'VANTARA Debug' : 'VANTARA';
  const mb=n=>`${Math.round(n/1048576)}MB`;
  const remove=()=>doc.querySelector('[data-vantara-desktop-update]')?.remove();
  const bar=()=>{
    let el=doc.querySelector('[data-vantara-desktop-update]');
    if(el)return el;
    if(!doc.querySelector('style[data-vantara-update-style]')){const style=doc.createElement('style');style.dataset.vantaraUpdateStyle='';style.textContent=STYLE;doc.head?.append(style);}
    el=doc.createElement('aside');
    el.dataset.vantaraDesktopUpdate='1';
    el.setAttribute('role','status');el.setAttribute('aria-live','polite');
    const title=doc.createElement('strong'),description=doc.createElement('p'),extra=doc.createElement('div'),actions=doc.createElement('div');
    title.dataset.updateTitle='';description.dataset.updateDescription='';extra.dataset.updateExtra='';actions.dataset.updateActions='';
    el.append(title,description,extra,actions);doc.body.append(el);
    return el;
  };
  const render=(title,description,buttons=[],{notes=[],progress=null}={})=>{
    if(disposed)return;
    const el=bar();
    el.querySelector('[data-update-title]').textContent=title;
    el.querySelector('[data-update-description]').textContent=description;
    const extra=[];
    if(notes.length){const list=doc.createElement('ul');for(const line of notes){const li=doc.createElement('li');li.textContent=line;list.append(li);}extra.push(list);}
    if(progress){const bar=doc.createElement('progress');bar.max=progress.total;bar.value=progress.received;extra.push(bar);}
    el.querySelector('[data-update-extra]').replaceChildren(...extra);
    el.querySelector('[data-update-actions]').replaceChildren(...buttons.map(([label,run])=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.onclick=run;return b;}));
  };
  const label=update=>`${product} ${update.version}${update.build?` · بناء ${update.build}`:''}`;
  const meta=update=>[update.builtAt?.slice(0,10),update.sourceSha?.slice(0,7),mb(update.size)].filter(Boolean).join(' · ');
  const manual=(update,note='حمّل المثبت ثم ثبّته بعد إغلاق التطبيق.')=>render('تحديث متاح: '+label(update),note,[
    ['تحميل المثبت',()=>void bridge.openUpdatePage({url:update.url}).catch(()=>render('تحديث متاح: '+label(update),'تعذر فتح التحميل. افتح إصدارات VANTARA على GitHub.'))],
    ['لاحقًا',()=>{settled=update.version;remove();}],
  ]);
  const ready=update=>(settled=update.version,render('التحديث جاهز: '+label(update),'نُزّل وتحققنا من بصمته. أعد التشغيل الآن، أو يُثبَّت وحده عند إغلاقك التطبيق.',[
    ['أعد التشغيل وحدّث',()=>void bridge.applyUpdate().catch(()=>manual(update,'تعذر بدء التثبيت. حمّل المثبت يدويًا.'))],
    ['عند الإغلاق',remove],
  ]));
  /** التنزيل يبدأ بموافقة المستخدم فقط (زر «تنزيل وتثبيت»). */
  const download=update=>{
    if(!bridge.downloadUpdate)return manual(update);
    if(downloading)return downloading;
    render('يُنزَّل '+label(update),`0 / ${mb(update.size)}`,[],{progress:{received:0,total:update.size}});
    offProgress??=bridge.onEvent?.(e=>{if(e?.type==='update/progress'&&downloading)render('يُنزَّل '+label(update),`${mb(e.received)} / ${mb(e.total)}`,[],{progress:e});})??null;
    downloading=Promise.resolve(bridge.downloadUpdate(update)).then(result=>{
      if(result?.ready)ready(update);
      else manual(update);
    }).catch(()=>manual(update,'تعذر تنزيل التحديث من داخل التطبيق. حمّل المثبت يدويًا.')).finally(()=>{downloading=null;});
    return downloading;
  };
  const offer=update=>{
    if(!update||disposed||settled===update.version)return;
    render('تحديث متاح: '+label(update),meta(update),[
      ['تنزيل وتثبيت',()=>void download(update)],
      ['لاحقًا',()=>{settled=update.version;remove();}],
    ],{notes:update.notes});
  };
  const check=({force=false}={})=>{
    if(disposed||!force)return Promise.resolve({update:null,status:'idle'});
    if(checking)return checking;
    checking=checkDesktopUpdate(bridge).then(update=>{
      if(update)offer(update);
      return {update,status:update?'available':'current',installed:describeInstalled(bridge)};
    }).finally(()=>{checking=null;});
    return checking;
  };
  return {check,download,installed:()=>describeInstalled(bridge),close(){disposed=true;offProgress?.();remove();}};
}
