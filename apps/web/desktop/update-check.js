/** قناة ويندوز مستقلة: لا تختلط بإصدارات APK التي لا تحتوي مثبت ويندوز. */
export const MANIFEST_URL = 'https://github.com/Meshal515/VANTARA/releases/download/windows-channel/desktop-update.json';
export const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;

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
  let pending=null,interval=null,checking=null,disposed=false;
  const show=(update)=>{
    if(!update||disposed)return;
    pending=update;
    let bar=doc.querySelector('[data-vantara-desktop-update]');
    if(!bar) {
      bar=doc.createElement('aside');
      bar.dataset.vantaraDesktopUpdate='1';
      Object.assign(bar.style,{position:'fixed',bottom:'18px',right:'18px',maxWidth:'440px',zIndex:10050,direction:'rtl',padding:'16px 20px',borderRadius:'14px',background:'#18161f',color:'#fff',boxShadow:'0 10px 30px #0009'});
      bar.setAttribute('role','status');
      const title=doc.createElement('strong'),description=doc.createElement('p'),button=doc.createElement('button'),later=doc.createElement('button');
      title.dataset.updateTitle='';description.dataset.updateDescription='';button.textContent='تحميل تحديث ويندوز';later.textContent='لاحقًا';
      button.type='button';later.type='button';button.style.margin='6px';later.style.margin='6px';
      button.onclick=()=>{if(pending)void bridge.openUpdatePage({url:pending.url}).catch(()=>{description.textContent='تعذر فتح التحميل. افتح إصدارات VANTARA على GitHub.';});};
      later.onclick=()=>bar.remove();
      bar.append(title,description,button,later);doc.body.append(bar);
    }
    bar.querySelector('[data-update-title]').textContent='تحديث VANTARA متاح: '+update.version;
    bar.querySelector('[data-update-description]').textContent='تم تجهيز مثبت ويندوز والتحقق من بصمته في البناء. حمّله ثم ثبّته بعد إغلاق التطبيق.';
  };
  const check=({force=false}={})=>{
    if(checking)return checking;
    checking=checkDesktopUpdate(bridge).then(update=>{
      if(update)show(update);
      return {update,status:update?'available':'current'};
    }).catch(error=>{if(force)throw error;return {update:null,status:'unknown'};}).finally(()=>{checking=null;});
    return checking;
  };
  void check();
  interval=setInterval(()=>void check(),CHECK_EVERY_MS);
  const visible=()=>{if(doc.visibilityState==='visible')void check();};
  doc.addEventListener('visibilitychange',visible);
  return {check,close(){disposed=true;clearInterval(interval);doc.removeEventListener('visibilitychange',visible);doc.querySelector('[data-vantara-desktop-update]')?.remove();}};
}
