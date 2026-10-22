/** قناة ويندوز مستقلة: لا تختلط بإصدارات APK التي لا تحتوي مثبت ويندوز. */
export const MANIFEST_URL = 'https://github.com/Meshal515/VANTARA/releases/download/windows-channel/desktop-update.json';

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

function validatedRelease(manifest) {
  const channel = manifest?.format === 1 && manifest.product === 'VANTARA';
  const legacy = manifest?.format === 2 && manifest.versionName === manifest.desktop?.version;
  if (!channel && !legacy) return null;
  const entry = channel ? manifest : manifest.desktop;
  if (entry?.platform !== 'win32-x64' || entry.installer !== 'nsis' ||
      !/^\d+\.\d+\.\d+$/.test(entry.version ?? '') ||
      !/^[a-f0-9]{64}$/i.test(entry.sha256 ?? '') ||
      !Number.isSafeInteger(entry.size) || entry.size <= 0) return null;
  let url;
  try { url = new URL(entry.url); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.search || url.hash || url.username || url.password) return null;
  const tag = channel ? `windows-v${entry.version}` : `stable-${manifest.versionCode}`;
  if (!channel && (!Number.isSafeInteger(manifest.versionCode) || manifest.versionCode <= 0)) return null;
  if (url.pathname !== `/Meshal515/VANTARA/releases/download/${tag}/VANTARA-${entry.version}-Windows-x64-Setup.exe`) return null;
  return {version:entry.version,url:url.href,sha256:entry.sha256,size:entry.size,
    notes:(Array.isArray(channel ? entry.notes : manifest.changelog) ? (channel ? entry.notes : manifest.changelog) : []).slice(0,4).map(String)};
}

export function desktopUpdateFromManifest(manifest, installed) {
  const entry = validatedRelease(manifest);
  // إصدار مجهول (0.0.0 حين لا يصل رقم الإصدار للواجهة) ليس «أقدم»: كان سيعرض التحديث نفسه بعد كل تثبيت
  if (!/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(installed ?? '') || installed === '0.0.0') return null;
  const legacyPreview = manifest?.format === 2 && /^\d+\.\d+\.\d+-preview\.\d+$/.test(installed ?? '');
  return entry && (newerVersion(entry.version, installed) || legacyPreview) ? entry : null;
}

export async function checkDesktopUpdate(bridge, {url=MANIFEST_URL} = {}) {
  if(!bridge?.requestResource) throw new Error('جسر تحديث ويندوز غير متاح');
  const result=await bridge.requestResource({url,json:true,limit:256*1024,timeout:20000});
  if(result.status!==200||typeof result.text!=='string')throw new Error('تعذر قراءة تحديث فانتارا');
  let data;
  try {data=JSON.parse(result.text);} catch{throw new Error('بيان التحديث غير صالح');}
  if (!validatedRelease(data)) throw new Error('بيان تحديث ويندوز غير متاح أو غير صالح');
  return desktopUpdateFromManifest(data,bridge.version);
}

export function startDesktopUpdateWatch({bridge=globalThis.VantaraDesktop,doc=globalThis.document} = {}) {
  if(!bridge?.requestResource||!bridge?.openUpdatePage||!doc?.body)return null;
  let pending=null,checking=null,disposed=false,downloading=null,offProgress=null,settled=null;
  const mb=n=>`${Math.round(n/1048576)}MB`;
  // شريط واحد بحالاته: يُنزَّل ← جاهز (أعد التشغيل / عند الإغلاق) ← أو تنزيل يدوي إن تعذر
  const bar=()=>{
    let el=doc.querySelector('[data-vantara-desktop-update]');
    if(el)return el;
    el=doc.createElement('aside');
    el.dataset.vantaraDesktopUpdate='1';
    Object.assign(el.style,{position:'fixed',bottom:'18px',right:'18px',maxWidth:'440px',zIndex:10050,direction:'rtl',padding:'16px 20px',borderRadius:'14px',background:'#18161f',color:'#fff',boxShadow:'0 10px 30px #0009'});
    el.setAttribute('role','status');
    const title=doc.createElement('strong'),description=doc.createElement('p'),actions=doc.createElement('div');
    title.dataset.updateTitle='';description.dataset.updateDescription='';actions.dataset.updateActions='';
    el.append(title,description,actions);doc.body.append(el);
    return el;
  };
  const render=(title,description,buttons=[])=>{
    if(disposed)return;
    const el=bar();
    el.querySelector('[data-update-title]').textContent=title;
    el.querySelector('[data-update-description]').textContent=description;
    const actions=el.querySelector('[data-update-actions]');
    actions.replaceChildren(...buttons.map(([label,run])=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.style.margin='6px';b.onclick=run;return b;}));
  };
  const manual=(update,note='حمّل المثبت ثم ثبّته بعد إغلاق التطبيق.')=>render('تحديث VANTARA متاح: '+update.version,note,[
    ['تحميل تحديث ويندوز',()=>void bridge.openUpdatePage({url:update.url}).catch(()=>render('تحديث VANTARA متاح: '+update.version,'تعذر فتح التحميل. افتح إصدارات VANTARA على GitHub.'))],
    ['لاحقًا',()=>{settled=update.version;doc.querySelector('[data-vantara-desktop-update]')?.remove();}],
  ]);
  // لا نكرر تنزيل نسخة جاهزة في الجلسة نفسها؛ الفحص يبدأ من الإعدادات فقط
  const ready=update=>(settled=update.version,render('تحديث VANTARA جاهز: '+update.version,'نُزّل وتحققنا من بصمته. أعد التشغيل الآن، أو يُثبَّت وحده عند إغلاقك التطبيق.',[
    ['أعد التشغيل وحدّث',()=>void bridge.applyUpdate().catch(()=>manual(update,'تعذر بدء التثبيت. حمّل المثبت يدويًا.'))],
    ['عند الإغلاق',()=>doc.querySelector('[data-vantara-desktop-update]')?.remove()],
  ]));
  const show=(update)=>{
    if(!update||disposed||settled===update.version)return;
    pending=update;
    if(!bridge.downloadUpdate)return manual(update);
    if(downloading)return;
    render('يُنزَّل تحديث VANTARA '+update.version,`0 / ${mb(update.size)}`);
    offProgress??=bridge.onEvent?.(e=>{if(e?.type==='update/progress'&&downloading)render('يُنزَّل تحديث VANTARA '+pending.version,`${mb(e.received)} / ${mb(e.total)}`);})??null;
    downloading=Promise.resolve(bridge.downloadUpdate(update)).then(result=>{
      if(result?.ready)ready(update);
      else manual(update);
    }).catch(()=>manual(update,'تعذر تنزيل التحديث تلقائيًا. حمّل المثبت يدويًا.')).finally(()=>{downloading=null;});
  };
  const check=({force=false}={})=>{
    if(disposed||!force)return Promise.resolve({update:null,status:'idle'});
    if(checking)return checking;
    checking=checkDesktopUpdate(bridge).then(update=>{
      if(update)show(update);
      return {update,status:update?'available':'current'};
    }).catch(error=>{if(force)throw error;return {update:null,status:'unknown'};}).finally(()=>{checking=null;});
    return checking;
  };
  return {check,close(){disposed=true;offProgress?.();doc.querySelector('[data-vantara-desktop-update]')?.remove();}};
}
