/** Explicit verification UI. Background events never launch native Activities. */
const validHost = value => typeof value === 'string' && value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value) && value.includes('.') && !/^\d+(?:\.\d+){3}$/.test(value) && !/\.(?:local|internal|localhost|invalid|lan)$/i.test(value);
export function nativeVerificationPlugin() {
  return globalThis.Capacitor?.getPlatform?.() === 'android' ? globalThis.Capacitor?.Plugins?.Verification ?? null : null;
}
export function createSourceVerification({plugin=nativeVerificationPlugin(),document=globalThis.document}={}) {
  let closed=false;
  const pending=new Map(),active=new Map(),handles=[],listeners=new Set();
  // Background network challenges update the Add-ons list only. No toast,
  // system notification, automatic WebView or focus-stealing overlay.
  function render(){
    if(closed)return;
    const snapshot=[...pending.values()].map(({retry,...item})=>({...item}));
    for(const listener of listeners){
      try{listener(snapshot);}catch{/* Observers cannot break verification. */}
    }
  }
  function require(item){if(closed||!validHost(item?.host))return;const host=item.host.toLowerCase(),old=pending.get(host);if(!old&&pending.size>=24)pending.delete(pending.keys().next().value);pending.set(host,{...old,...item,host});render();}
  async function begin(host){
    if(closed||!plugin||!pending.has(host))return {ok:false,error:'التحقق غير متاح لهذا المصدر'};
    if(active.has(host))return active.get(host);
    const item=pending.get(host);
    const job=(async()=>{
      try{
        const result=await plugin.begin({host});if(closed)return {ok:false,cancelled:true};
        if(result?.host!==host||result?.state!=='verified'){
          require({...item,message:result?.state==='cancelled'?'أُلغي التحقق. تقدر تحاول مرة ثانية.':'لم يكتمل التحقق. تقدر تحاول مرة ثانية.'});return {ok:false,...result};
        }
        pending.delete(host);render();
        // One callback per explicitly opened verification, never per state event.
        const retried=typeof item.retry==='function'?await item.retry():null;
        return retried??{ok:true,...result};
      }catch{if(!closed)require({...item,message:'تعذّر التحقق من المصدر. تقدر تحاول مرة ثانية.'});return {ok:false,error:'تعذّر التحقق'};}
      finally{active.delete(host);render();}
    })();active.set(host,job);render();return job;
  }
  function state(item){if(closed||!validHost(item?.host))return;if(['verified','expired'].includes(item.state)){pending.delete(item.host);render();}else if(item.state==='required')require(item);}
  const ready=(async()=>{
    if(!plugin)return;
    await Promise.all(['required','state'].map(async name=>{
      try{const handle=await plugin.addListener(name,name==='required'?require:state);if(closed)await handle?.remove?.();else handles.push(handle);}catch{/* Optional old APK bridge; never break shell startup. */}
    }));
    try{const out=await plugin.pending();if(!closed)for(const item of out?.pending??[])require(item);}catch{/* Host detection can be unavailable without affecting the app. */}
  })();
  return {
    ready,require,begin,
    list:()=>[...pending.values()].map(({retry,...item})=>({...item})),
    subscribe(listener){
      if(typeof listener!=='function'||closed)return ()=>{};
      listeners.add(listener);
      try{listener([...pending.values()].map(({retry,...item})=>({...item}));}catch{}
      return ()=>listeners.delete(listener);
    },
    close(){
      if(closed)return;closed=true;
      pending.clear();listeners.clear();
      for(const h of handles)void Promise.resolve(h?.remove?.()).catch(()=>{});
      handles.length=0;
    },
  };
}

/** Existing anime Verify button: choose the exact source domain, then one retry. */
export async function verifySourceDomains({domains,sourceName,retry,plugin=nativeVerificationPlugin()}={}) {
  if(!plugin)return {ok:false,error:'التحقق داخل التطبيق يحتاج نسخة Android محدثة'};
  try{
    const hosts=new Set((domains??[]).map(url=>{try{return new URL(url).hostname.toLowerCase();}catch{return null;}}).filter(Boolean));
    const out=await plugin.pending(),match=(out?.pending??[]).find(x=>hosts.has(x.host));
    if(!match)return {ok:false,error:'لا يوجد تحدي تحقق مسجّل لهذا المصدر. أعد فحصه أولًا.'};
    const result=await plugin.begin({host:match.host});
    if(result?.host!==match.host||result?.state!=='verified')return {ok:false,error:result?.state==='cancelled'?'أُلغي التحقق':'لم يكتمل التحقق'};
    return typeof retry==='function'?await retry():{ok:true};
  }catch{return {ok:false,error:`تعذّر التحقق من ${sourceName||'المصدر'}`};}
}
