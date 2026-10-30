
/* VANTARA V7 live add-on manager.
 * Presentation only: no migration, reset, deletion, or replacement of stored data.
 * The underlying registry and native extension stores remain authoritative. */
import { assessAddon, supportedCapabilities } from "../addons/assessment.js";

import { configureLink } from "./addons-view.js";
import { manifestEndpoint } from "../addons/import.js";

const icons = {
  plus:'<path d="M12 5v14M5 12h14"/>',
  back:'<path d="M19 12H5m7-7-7 7 7 7"/>',
  chevron:'<path d="m14 6-6 6 6 6"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2m-10 0 1 15h10l1-15M10 10v7m4-7v7"/>',
  open:'<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  box:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 10h8M8 14h5"/>'
};
const el=(tag,cls,text)=>{
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(text!==undefined)e.textContent=String(text);
  return e;
};
const ico=(key)=>{
  const e=document.createElementNS("http://www.w3.org/2000/svg","svg");
  e.setAttribute("viewBox","0 0 24 24");
  e.setAttribute("aria-hidden","true");
  e.innerHTML=icons[key]||icons.box;
  return e;
};
const btn=(txt,cls,handler)=>{
  const e=el("button",cls,txt);
  e.type="button";if(handler)e.onclick=handler;
  return e;
};
const safe=(value)=>{
  try {
    const u=new URL(String(value||""));
    return u.protocol==="https:" && !u.username && !u.password ? u.href : null;
  }catch{return null;}
};
const safeIcon=(value)=>{
  const text=String(value||"");
  if(text.length<=90*1024&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(text))return text;
  return safe(value);
};
const capabilityLabel=cap=>({home:"آخر التحديثات",catalog:"كتالوج",catalogue:"كتالوج",browse:"التصفح",search:"بحث",meta:"بيانات",details:"تفاصيل",streams:"روابط التشغيل",subtitles:"ترجمة",pages:"صفحات",chapters:"فصول",episodes:"حلقات",addon:"الإضافة",integration:"ربط المحرك",other:"قدرة إضافية"}[cap]||"قدرة إضافية");
// رموز اللغة كما يقولها الناس: «ar» ← العربية
const LANG_AR={en:"الإنجليزية",ja:"اليابانية",ko:"الكورية",zh:"الصينية",fr:"الفرنسية",es:"الإسبانية",tr:"التركية",id:"الإندونيسية",multi:"متعددة",all:"متعددة"};
const kindName=(a)=>{
  if(a.content==="cinema"||a.kind==="cinema")return "سينما";
  if(a.kind==="anime" || a.anime || (a.contentTypes||[]).includes("anime"))return "أنمي";
  if((a.contentTypes||[]).includes("manga") || a.kind==="manga")return "مانجا";
  if((a.contentTypes||[]).some(x=>x==="movie"||x==="series"))return "سينما";
  if((a.capabilities||[]).includes("subtitles"))return "ترجمة";
  if((a.capabilities||[]).includes("streams"))return "تورنت";
  if((a.capabilities||[]).some(x=>x==="meta"||x==="details"))return "بيانات";
  return "مصدر";
};

export function renderV7Addons({
  registry={}, filter="all", repositories=null, readySources=null, animeRepositories=null, cloudstreamRepositories=null, sites=null, verification=null, pulse=null,
  onOpenSource=()=>{}, onOpenNativeSource=null, onBack=()=>{}, onSourcesChanged=()=>{}, onCheck, initialState={},
}={}){
  const root=el("section","v7-addon addon-v7");
  root.dir="rtl";
  if(["anime","manga","cinema"].includes(filter))root.dataset.sectionHub=filter;
  let alive=true, tab=["repos","installed","verification"].includes(initialState.tab)?initialState.tab:"repos", opened=null, currentSearch=String(initialState.search||"").trim().toLocaleLowerCase(), type=String(initialState.type||"الكل");
  let restoreKey=initialState.openedKey||null, restoreScroll=true;
  let busy=false, generation=0, lifecycle=0, menuOpen=false, diagnosticController=null;
  const timers=new Set(), extensionErrors=new Map(), installedMetadata=new Map(), diagnosticResults=new Map();
  let requests=new Map(), queue=[], activeRequests=0;
  const stores=[
    ...(cloudstreamRepositories?[{id:"cloudstream",kind:"anime",family:"cloudstream",api:cloudstreamRepositories}]:[]),
    ...(animeRepositories?[{id:"anime",kind:"anime",api:animeRepositories}]:[]),
    ...(repositories?[{id:"manga",kind:"manga",api:repositories}]:[]),
    // مصادر المانجا التي كانت مدمجة: تُضاف لحسابك بمعرّفها القديم (lib/extension-engine.js readySources)
    ...(readySources?[{id:"ready",kind:"manga",api:readySources}]:[])
  ];
  let repos=[], extensions=new Map(), siteRows=[], loading=false;
  const head=el("div","v7-heading");
  const add=btn("أضف","v7-plus",()=>showImport());
  add.prepend(ico("plus"));
  head.append(add);
  const tabs=el("nav","v7-tabs");
  const repoTab=btn("الإضافات","v7-tab",()=>switchTab("repos"));
  const installedTab=btn("المثبتة","v7-tab",()=>switchTab("installed"));
  const repoCount=el("span","v7-count","0"), installedCount=el("span","v7-count","0");
  repoTab.append(repoCount);installedTab.append(installedCount);
  const verificationTab=btn("تحتاج تحقق","v7-tab v7-verify-entry",()=>switchTab("verification"));
  const verificationCount=el("span","v7-count","0");verificationTab.append(verificationCount);
  // «أضف» في طرف صف التبويبات نفسه: لا صف مستقل له يترك فراغًا بجانبه
  tabs.append(repoTab,installedTab,verificationTab,add);
  const tools=el("div","v7-tools"),searchBox=el("label","v7-search"),search=el("input");
  search.type="search";search.autocomplete="off";search.placeholder="ابحث عن مصدر أو مستودع...";
  search.dataset.addonSearch="";search.value=String(initialState.search||"");
  searchBox.append(ico("search"),search);
  const filterWrap=el("div","v7-filter-wrap");
  const filterButton=btn("كل الأنواع","v7-filter",()=>toggleMenu());
  const filterArrow=ico("down");filterButton.append(filterArrow);
  const filterMenu=el("div","v7-menu");filterMenu.hidden=true;
  filterWrap.append(filterButton,filterMenu);tools.append(searchBox,filterWrap);
  const body=el("div","v7-body"),message=el("div","v7-diagnostic");
  message.setAttribute("role","status");message.setAttribute("aria-live","polite");
  const layer=el("div","v7-layer");layer.hidden=true;
  const dialog=el("section","v7-dialog");
  dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");
  layer.append(dialog);
  root.append(tabs,tools,body,message,layer);
  layer.addEventListener("click",e=>{if(e.target===layer)closeModal();});
  const fmtErr=e=>String(e?.message||e||"تعذر إكمال العملية").replace(/(?:https?:\/\/|stremio:\/\/)\S+/gi,"[رابط]");
  const notify=(s)=>{if(alive)message.textContent=s;};
  const invoke=(callback,...args)=>{
    if(!alive)return;
    try{Promise.resolve(callback(...args)).catch(err=>notify(fmtErr(err)));}
    catch(err){notify(fmtErr(err));}
  };
  const sourcesChanged=()=>invoke(onSourcesChanged);
  root.addEventListener("addon-configured",()=>{if(alive){void refresh();sourcesChanged();}});
  const later=(callback,delay)=>{
    const id=setTimeout(()=>{timers.delete(id);if(alive)callback();},delay);
    timers.add(id);
  };
  const resetRequests=()=>{
    for(const job of queue)job.resolve();
    queue=[];requests=new Map();activeRequests=0;
  };
  // The queue is a display of pending human verification; only an explicit
  // user click may launch Android's verification Activity.
  let pendingVerification=[];
  function renderVerification(){draw();}
  function receiveVerification(items){
    if(!alive)return;
    pendingVerification=Array.isArray(items)?items.filter(x=>typeof x?.host==="string"):[];
    renderVerification();
  }
  async function verifyHost(host,button){
    if(!verification?.begin)return;
    if(button){button.disabled=true;button.textContent="جارٍ التحقق…";}
    try{
      const result=(await cloudstreamRepositories?.verify?.(host)) ?? await verification.begin(host);
      if(!alive)return;
      if(result?.ok===true||result?.state==="verified"){
        if(button)button.textContent="تم التحقق";
        // Do not claim the source can play until its own runtime succeeds.
      }else if(button){
        button.disabled=false;button.textContent="إعادة التحقق";
      }
    }catch(err){if(alive){notify(fmtErr(err));if(button){button.disabled=false;button.textContent="إعادة التحقق";}}}
  }
  function sourceChallenges(source){
    const hosts=new Set();
    const addHost=value=>{
      if(typeof value!=="string")return;
      try{hosts.add(new URL(value).hostname.toLowerCase());return;}catch{}
      if(/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value))hosts.add(value.toLowerCase());
    };
    addHost(source.domain);addHost(source.url);addHost(source.homepage);
    for(const v of Array.isArray(source.domains)?source.domains:[])addHost(typeof v==="string"?v:v?.url||v?.host);
    for(const h of Array.isArray(source.permissions?.networkHosts)?source.permissions.networkHosts:[])addHost(h);
    const name=String(source.name||"").trim().toLowerCase();
    return pendingVerification.filter(item=>
      hosts.has(item.host?.toLowerCase()) ||
      (item.sourceName && String(item.sourceName).trim().toLowerCase()===name)
    );
  }
  let removeVerification=verification?.subscribe?.(receiveVerification)||(()=>{});
  try{
    const saved=verification?.list?.();
    if(saved?.then)saved.then(receiveVerification).catch(err=>notify(fmtErr(err)));
    else if(saved)receiveVerification(saved);
  }catch(err){notify(fmtErr(err));}


  /**
   * صورة حقيقية لكل إضافة ومستودع، من مصادرها بالترتيب: ما أعلنته (شعار Stremio، أيقونة
   * CloudStream بعد تعويض %size%، أيقونة APK المثبتة)، ثم أيقونة الحزمة في مستودعها نفسه
   * (Mihon/Aniyomi: icon/<pkg>.png)، ثم صورة مالك المستودع على GitHub، ثم أيقونة الموقع نفسه
   * (apple-touch-icon ثم favicon، من الموقع مباشرة بلا طرف ثالث). بلا شيء: الحرف الأول بلون القسم.
   */
  function logoCandidates(item,fallback,repo){
    const out=[item.iconUrl,item.icon,item.logo,item.imageUrl,fallback?.iconUrl,fallback?.icon,fallback?.logo];
    const indexUrl=item._url||item.repo||item.repoUrl||(repo?item.url:null);
    try{
      const index=new URL(String(indexUrl||""));
      if(item.pkg&&/\.json$/i.test(index.pathname))out.push(new URL("icon/"+item.pkg+".png",index).href);
      const gh=index.hostname==="raw.githubusercontent.com"?index.pathname.split("/")[1]:/^([a-z0-9-]+)\.github\.io$/i.exec(index.hostname)?.[1];
      if(repo&&gh)out.push("https://avatars.githubusercontent.com/"+gh+"?size=96");
    }catch{}
    const site=[item.baseUrl,item.mainUrl,item.siteUrl,item.domain&&("https://"+String(item.domain).replace(/^https?:\/\//,"")),item.transportUrl,item.manifestUrl].find(Boolean);
    try{const host=new URL(String(site||"")).origin;if(/^https:/.test(host)&&!repo)out.push(host+"/apple-touch-icon.png",host+"/favicon.ico");}catch{}
    return [...new Set(out.map(u=>typeof u==="string"?u.replace(/%size%/g,"128"):u).map(safeIcon).filter(Boolean))];
  }
  function logo(item,fallback,repo=false){
    const box=el("span","v7-logo"+(repo?" is-repo":""));
    // بلا صورة: الحرف الأول من الاسم بلون القسم (لا رمز عام متكرر على كل صف)
    const abbr=el("span","v7-fallback");
    const initial=Array.from(String(item.name||fallback?.name||"").trim())[0]||"";
    if(initial){abbr.textContent=initial.toLocaleUpperCase();abbr.classList.add("v7-initial");}else abbr.append(ico("box"));
    box.append(abbr);
    const urls=logoCandidates(item,fallback,repo);
    let idx=0;
    const next=()=>{
      if(!alive||idx>=urls.length)return;
      const img=el("img");img.alt="";img.loading="lazy";img.referrerPolicy="no-referrer";
      // أيقونة 16px (favicon افتراضي) لا تُقرأ في مربع 44: التالية بدلها
      img.onload=()=>{if(img.naturalWidth<=16){img.remove();next();}else{abbr.hidden=true;}};
      img.onerror=()=>{img.remove();next();};
      img.src=urls[idx++];box.append(img);
    };next();return box;
  }
  function empty(title,text){
    const e=el("div","v7-empty"),sym=el("div","v7-empty-symbol");sym.append(ico("box"));
    e.append(sym,el("h3",null,title),el("p",null,text));return e;
  }
  function section(title,count){
    const d=el("div","v7-section-head");
    d.append(el("h3",null,title),el("span",null,count));
    return d;
  }
  function sourceMeta(a){
    // الإصدار في التفاصيل؛ الرقم المجرد في الصف لا يعني شيئًا للمستخدم
    const code=String(a.lang||a.languages?.[0]||"").toLowerCase();
    return [kindName(a),a.arabic||code==="ar"?"العربية":(LANG_AR[code]??code)].filter(Boolean).join(" · ");
  }
  const diagnosticKey=a=>JSON.stringify([a._store?.id,a.key||a.pkg||a.id||a.domain,a.version,a.cacheEpoch]);
  function installedState(a){
    if(sourceChallenges(a).length)return {state:"attention",label:"تحتاج انتباه",detail:"المصدر يحتاج تحققًا."};
    if(a.enabled===false)return {state:"attention",label:"تحتاج انتباه",detail:"الإضافة معطلة."};
    if(a.configuration?.required&&!a.configuration.configured)return {state:"attention",label:"تحتاج انتباه",detail:"الإضافة تحتاج إعدادًا."};
    const actualError=a.loadError||a.disabledReason||a.error;
    if(actualError)return {state:"attention",label:"تحتاج انتباه",detail:fmtErr(actualError)};
    if(a.availability?.confirmed===true&&a.availability.state==="unavailable")
      return {state:"unavailable",label:"غير متاحة",detail:a.availability.reason||"أكد المحرك أن المصدر غير متاح."};
    // Native packages may expose several canonical sources. Package identity is
    // authoritative; a matching display name never supplies health evidence.
    const bound=a._store&&a.pkg?(registry.list?.()||[]).filter(x=>x.pkg===a.pkg):[];
    const sources=bound.length?bound:[a],passed=[],untested=[],errors=[];
    let empty=false;
    const recent=(at,age)=>Number.isFinite(at)&&at<=Date.now()&&Date.now()-at<=age;
    for(const source of sources){
      const caps=supportedCapabilities(source,registry.runtimeName||"pwa");
      const checked=new Set();
      for(const cap of caps){
        const h=source.health?.[cap];
        if(!h||(h.version!=null&&h.version!==source.version)||(h.cacheEpoch!=null&&h.cacheEpoch!==source.cacheEpoch))continue;
        if(["failed","cooling","configuration"].includes(h.state)){
          if(h.scope==="source"&&/^(HTTP[_ ]?(404|410)|SOURCE_REMOVED|SOURCE_NOT_FOUND)$/.test(h.reason||""))
            return {state:"unavailable",label:"غير متاحة",detail:h.reason};
          errors.push(capabilityLabel(cap)+": "+(h.reason||"فشل الطلب الفعلي"));
        }
        if(["healthy","empty"].includes(h.state)&&h.version===source.version&&h.cacheEpoch===source.cacheEpoch&&recent(h.functionalSuccessAt,7*86400000)){
          passed.push({cap,stable:h.functionalSuccessCount>=2});checked.add(cap);
        }else if(h.state==="empty")empty=true;
      }
      const p=pulse?.get?.(source.key);
      const release=p&&p.version===String(source.version)&&p.cacheEpoch===(source.cacheEpoch??"core:"+source.version);
      if(release){
        if(["failed","verification"].includes(p.state))errors.push(p.error|| (p.state==="verification"?"المصدر يحتاج تحققًا.":"فشل طلب التصفح الفعلي."));
        if(p.state==="ok"&&Number.isInteger(p.items)&&p.items>0&&recent(p.at,30*60000)){
          const cap=p.capability||"browse";passed.push({cap,stable:p.successfulBrowseCount>=2});checked.add(cap);
          if(cap==="catalog")checked.add("catalogue");
        }else if(p.state==="empty"&&p.items===0&&recent(p.at,30*60000))empty=true;
      }
      for(const cap of caps)if(!checked.has(cap))untested.push(capabilityLabel(cap));
    }
    const diagnosis=diagnosticResults.get(diagnosticKey(a));
    for(const check of diagnosis?.checks||[]){
      if(["failed","configuration","disabled"].includes(check.state))errors.push(check.message||"فشل الفحص الفعلي.");
      else if(check.state==="passed"&&!["addon","integration","other"].includes(check.capability)&&!passed.some(x=>x.cap===check.capability))
        passed.push({cap:check.capability,stable:false});
      else if(check.state==="empty")empty=true;
    }
    if(errors.length)return {state:"attention",label:"تحتاج انتباه",detail:errors.map(fmtErr).join(" · ")};
    if(passed.length){
      const labels=[...new Set(passed.map(x=>capabilityLabel(x.cap)))];
      const missing=[...new Set(untested)].filter(x=>!labels.includes(x));
      const stable=passed.every(x=>x.stable);
      return {state:stable?"stable":"working",label:(stable?"مستقرة":"تعمل")+" · "+labels.join("، "),
        detail:"نجح وظيفيًا: "+labels.join("، ")+"."+(missing.length?" لم تُفحص: "+missing.join("، ")+".":"")+" الحالة تخص الوظائف المذكورة فقط."};
    }
    if(empty)return {state:"empty",label:"تستجيب بلا نتائج",detail:"استجابة فعلية صالحة بلا نتائج لهذا الطلب؛ لا تثبت توفر المحتوى."};
    return {state:"untested",label:"لم تُفحص",detail:"لا توجد أدلة وظيفية حديثة لهذه الإضافة."};
  }
  // الحالة تظهر حين تهم فقط (مشكلة بسببها)؛ «مثبتة ·» داخل التبويب نفسه زائدة فتُخفى بصريًا
  function status(a){
    const result=installedState(a),node=el("span","v7-status visible");
    node.append(el("span","v7-status-pre","مثبتة · "),el("span","v7-status-label",result.label));
    node.dataset.state=result.state;node.title=result.detail;return node;
  }
  function why(a){
    const result=installedState(a);
    if(!["attention","unavailable"].includes(result.state)||!result.detail)return null;
    const node=el("span","v7-why",result.detail);node.dir="auto";return node;
  }
  function sourceRow(a,mode,parent){
    const row=el("article","v7-row");row.tabIndex=0;
    row.setAttribute("role","button");row.setAttribute("aria-label","تفاصيل "+a.name);
    const logoBox=logo(a,parent),info=el("div","v7-info");
    info.append(el("div","v7-name",a.name),el("div","v7-meta",sourceMeta(a)));
    const statusSlot=el("div","v7-status-slot"),stateLabel=status(a);
    const isAdded=mode==="remote"?true:!!(a.installed||a.builtin||a.update);
    if(!isAdded)stateLabel.classList.remove("visible");
    statusSlot.append(stateLabel);
    const reason=isAdded?why(a):null;if(reason)statusSlot.append(reason);
    info.append(statusSlot);
    const actions=el("div","v7-actions");
    const challenges=sourceChallenges(a);
    const verifyButton=()=>{const verify=btn("تحقق","v7-simple-btn",e=>{e.stopPropagation();void verifyHost(challenges[0].host,verify);});return verify;};
    const foreign=mode==="native" && ((a._store?.kind==="anime"&&a.anime===false)||(a._store?.kind==="manga"&&a.anime===true));
    if(mode==="remote"){
      if(challenges.length)actions.append(verifyButton());
      else if(canOpenRemote(a)){
        const open=btn("فتح","v7-simple-btn",e=>{e.stopPropagation();openRemote(a);});
        open.prepend(ico("open"));actions.append(open);
      }
      if(!a.bundled && registry.remove){
        const del=btn("","v7-trash",e=>{e.stopPropagation();askDelete(a,"remote");});
        del.setAttribute("aria-label","حذف "+a.name);del.append(ico("trash"));actions.prepend(del);
      }
    }else if(mode==="native"){
      actions.classList.add("v7-native-actions");
      if(challenges.length&&isAdded){
        if(!a.builtin){const del=btn("","v7-trash",e=>{e.stopPropagation();askDelete(a,"native");});del.setAttribute("aria-label","حذف "+a.name);del.append(ico("trash"));actions.append(del);}
        actions.append(verifyButton());
      }else if(foreign){
        const wrong=btn("نوع مختلف","v7-simple-btn",e=>{e.stopPropagation();showDetails(a,"native",parent);});
        actions.append(wrong);
      }else{
      const slot=el("div","v7-trash-holder");
      const trash=btn("","v7-trash",e=>{e.stopPropagation();askDelete(a,"native");});
      trash.append(ico("trash"));trash.setAttribute("aria-label","حذف "+a.name);if(!a.builtin)slot.append(trash);
      if(isAdded)slot.classList.add("visible");
      const flip=el("button","v7-flip"+(isAdded?" installed":""));
      flip.type="button";flip.setAttribute("aria-label",(isAdded?"فتح ":"تثبيت ")+a.name);
      const rotor=el("span","v7-rotor");
      const front=el("span","v7-face v7-front","تثبيت");
      const rear=el("span","v7-face v7-rear");
      rear.append(ico("open"),el("span",null,"فتح"));rotor.append(front,rear);flip.append(rotor);
      flip.onclick=async e=>{
        e.stopPropagation();
        if(flip.disabled)return;
        if(a.installed||a.builtin||a.update){
          if(onOpenNativeSource)openNative(a);else showDetails(a,"native",parent);
          return;
        }
        flip.disabled=true;
        const installLifecycle=lifecycle;
        try{
          await installNative(a);
          if(!alive||installLifecycle!==lifecycle)return;
          a.installed=true;
          const cached=extensions.get(a._store.id+":"+a._url)?.items.find(x=>x.pkg===a.pkg);
          if(cached)cached.installed=true;
          if(installedMetadata.has(a._store.id)){
            const saved=installedMetadata.get(a._store.id);
            if(!saved.some(x=>x.pkg===a.pkg))saved.push({...a,repo:a._url,installed:true});
          }
          installedCount.textContent=String(Number(installedCount.textContent)+1);
          flip.classList.add("installed");
          flip.setAttribute("aria-label","فتح "+a.name);
          later(()=>{if(row.isConnected)slot.classList.add("visible");},300);
          stateLabel.classList.add("visible");
          later(sourcesChanged,400);
        }catch(err){notify(fmtErr(err));}finally{flip.disabled=false;}
      };
      actions.append(slot,flip);
      }
    }
    row.append(logoBox,info,actions);
    row.onclick=e=>{if(!e.target.closest("button"))showDetails(a,mode,parent);};
    row.onkeydown=e=>{if(e.target!==row)return;if(e.key==="Enter"||e.key===" "){e.preventDefault();showDetails(a,mode,parent);}};
    return row;
  }
  function siteRow(site){
    const row=el("article","v7-row");
    const item={name:site.label||site.domain||"موقع مانجا",iconUrl:site.iconUrl||null};
    const info=el("div","v7-info");
    info.append(el("div","v7-name",item.name),el("div","v7-meta",["موقع مانجا",site.engine,site.domain].filter(Boolean).join(" · ")),status(site));
    const actions=el("div","v7-actions");
    const details=btn("تفاصيل","v7-simple-btn",e=>{
      e.stopPropagation();
      showDialog(item.name,"هذا الموقع محفوظ ضمن مصادر المانجا لديك.");
      const fields=el("div","v7-fields");
      for(const [key,val] of [["الموقع",site.domain||site.url||"—"],["المحرك",site.engine||"—"]]){
        const part=el("div","v7-field");part.append(el("strong",null,key),el("span",null,val));fields.append(part);
      }
      dialog.append(fields);
      const acts=el("div","v7-dialog-actions");
      acts.append(btn("رجوع","v7-btn",()=>closeModal()));
      if(sites?.remove)acts.append(btn("حذف الموقع","v7-btn danger",()=>{
        showDialog("حذف موقع مانجا؟","هل تريد حذف «"+item.name+"» من قائمة مصادر المانجا؟");
        const confirm=el("div","v7-confirm-actions");
        confirm.append(btn("رجوع","v7-btn",()=>closeModal()),btn("حذف","v7-btn danger",async()=>{
          if(busy)return;busy=true;
          try{await sites.remove(site.id);closeModal(true);await refresh();sourcesChanged();}
          catch(err){notify(fmtErr(err));}finally{busy=false;}
        }));
        dialog.append(confirm);
      }));
      dialog.append(acts);
    });
    const challenges=sourceChallenges({...site,name:item.name});
    if(challenges.length){const verify=btn("تحقق","v7-simple-btn",e=>{e.stopPropagation();void verifyHost(challenges[0].host,verify);});actions.append(verify);}
    else actions.append(details);
    row.append(logo({...site,...item}),info,actions);
    row.onclick=e=>{if(!e.target.closest("button"))details.click();};
    return row;
  }
  function storeRepoRow(r){
    const row=el("article","v7-row");
    row.append(logo(r.data,null,true));
    const info=el("div","v7-info");
    // نوع المستودع وعدد إضافاته إن أعلنه؛ بلا عدد يبقى «مستودع» لا كلمة «إضافة» وحدها
    const count=Number(r.data.count);
    const family=r.group.family==="cloudstream"?"CloudStream":r.group.kind==="anime"?"Aniyomi":"Mihon";
    // اسم المنصة اللاتيني معزول اتجاهه فلا يقلب ترتيب السطر العربي
    const meta=el("div","v7-meta"),fam=el("bdi",null,family);fam.dir="ltr";
    meta.append(fam," · "+(Number.isFinite(count)&&count>0?count+" إضافة":"مستودع"));
    info.append(el("div","v7-name",r.data.name),meta);
    row.append(info);
    const browse=()=>{opened=r;type="الكل";search.value="";currentSearch="";draw();loadExtensions(r);};
    const go=btn("استعراض","v7-simple-btn v7-go",browse);
    go.setAttribute("aria-label","استعراض "+r.data.name);
    go.prepend(ico("chevron"));row.append(go);
    // الصف كله يفتح المستودع، والأزرار تبقى لما خُصصت له
    row.onclick=e=>{if(!e.target.closest("button"))browse();};
    if(r.group.api?.remove){
      const remove=btn("","v7-trash",()=>{
        showDialog("إزالة المستودع؟",r.group.family==="cloudstream"?"سيُزال رابط المستودع؛ إضافاته المثبتة وجلساتها تبقى محفوظة.":"ستُزال «"+r.data.name+"» وإضافاته المثبتة أيضًا. تأكد قبل المتابعة.");
        const actions=el("div","v7-confirm-actions"),result=el("p","v7-notice");result.setAttribute("role","status");
        const cancel=btn("رجوع","v7-btn",()=>closeModal());
        const confirm=btn("إزالة","v7-btn danger",async()=>{
          if(busy)return;busy=true;confirm.disabled=true;
          try{await r.group.api.remove(r.data.url);opened=null;closeModal(true);sourcesChanged();await refresh();}
          catch(error){result.textContent=fmtErr(error);}finally{busy=false;confirm.disabled=false;}
        });
        actions.append(cancel,confirm);dialog.append(actions,result);
      });
      remove.append(ico("trash"));remove.dataset.removeRepo="";remove.setAttribute("aria-label","إزالة المستودع "+r.data.name);row.append(remove);
    }
    return row;
  }
  function switchTab(t){tab=t;opened=null;menuOpen=false;filterMenu.hidden=true;currentSearch="";type="الكل";search.value="";draw();}
  function toggleMenu(){
    menuOpen=!menuOpen;filterMenu.hidden=!menuOpen;
  }
  function fillKinds(items){
    const names=["الكل",...new Set(items.map(kindName))];
    if(items.length&&!names.includes(type))type="الكل";
    filterButton.firstChild.textContent=type==="الكل"?"كل الأنواع":type;
    filterMenu.replaceChildren(...names.map(name=>{
      const b=btn(name,name===type?"active":"",()=>{
        type=name;menuOpen=false;filterMenu.hidden=true;draw();
      });
      return b;
    }));
  }
  function filtered(items){
    return items.filter(a=>{
      if(type!=="الكل" && kindName(a)!==type)return false;
      return !currentSearch || (String(a.name)+" "+sourceMeta(a)).toLocaleLowerCase().includes(currentSearch);
    });
  }
  function nativeRecord(item,store,url){
    const local=installedMetadata.get(store.id)?.find(x=>x.pkg===item.pkg);
    const record={...item,...local,kind:store.kind,_store:store,_url:url};
    if(installedMetadata.has(store.id)){
      record.installed=local?(local.version||true):false;
      if(!local)record.update=false;
    }
    if(local){record.iconUrl=local.iconUrl||item.iconUrl;record.content=local.content||item.content;}
    return record;
  }
  function draw(){
    if(!alive)return;
    const managedCloudStream=new Set((installedMetadata.get('cloudstream')||[]).map(item=>item.pkg));
    const allRemote=(registry.list?.()||[]).filter(item=>
      !String(item.sourceId||'').startsWith('addon|cs3|') || !managedCloudStream.has(item.pkg));
    const nativeByPackage=new Map();
    for(const x of extensions.values())for(const ext of x.items)nativeByPackage.set(x.store.id+":"+ext.pkg,nativeRecord(ext,x.store,x.url));
    for(const store of stores)for(const item of installedMetadata.get(store.id)||[]){
      const key=store.id+":"+item.pkg;
      if(!nativeByPackage.has(key))nativeByPackage.set(key,nativeRecord(item,store,item.repo));
    }
    const allNative=[...nativeByPackage.values()];
    const installedNative=allNative.filter(x=>x.installed || x.update || x.builtin);
    const direct=allRemote.filter(a=>!a.bundled);
    repoCount.textContent=String(repos.length+direct.length+siteRows.length);
    installedCount.textContent=String(allRemote.length+installedNative.length+siteRows.length);
    repoTab.classList.toggle("active",tab==="repos");
    installedTab.classList.toggle("active",tab==="installed");
    verificationTab.classList.toggle("active",tab==="verification");
    const installedRecords=[...allRemote,...installedNative,...siteRows.map(x=>({...x,name:x.label||x.domain,kind:"manga",_site:true}))];
    const challenged=installedRecords.filter(a=>sourceChallenges(a).length);
    const unknown=pendingVerification.filter(item=>!challenged.some(a=>sourceChallenges(a).some(x=>x.host===item.host)));
    verificationCount.textContent=String(challenged.length+unknown.length);
    body.replaceChildren();
    body.setAttribute("aria-busy",String(loading));
    filterWrap.hidden=tab==="repos"&&!opened&&!direct.length&&!siteRows.length;
    fillKinds(tab==="verification"?challenged:tab==="installed"?[...allRemote,...installedNative,...siteRows.map(x=>({kind:"manga",name:x.label}))]:(opened?(extensions.get(opened.key)?.items||[]).map(item=>nativeRecord(item,opened.group,opened.data.url)):[...direct,...siteRows.map(x=>({kind:"manga",name:x.label})),...repos.map(r=>({kind:r.group.kind,name:r.data.name}))]));
    if(tab==="repos"){
      if(opened){
        body.append(section(opened.data.name,opened.group.family==="cloudstream"?"CloudStream":opened.group.kind==="anime"?"Aniyomi":"Mihon"));
        const list=el("div","v7-list");
        const ext=extensions.get(opened.key);
        const failure=extensionErrors.get(opened.key);
        if(failure){
          const retryRepo=opened;
          body.append(el("p","v7-notice",failure),btn("إعادة المحاولة","v7-simple-btn",()=>void loadExtensions(retryRepo,{force:true})));
        }
        if(!ext){if(!failure)body.append(el("p","v7-notice","جارٍ تحميل المصادر…"));return;}
        const records=filtered(ext.items.filter(x=>!x.nsfw).map(item=>nativeRecord(item,opened.group,opened.data.url)));
        for(const item of records)list.append(sourceRow(item,"native",opened.data));
        body.append(records.length?list:empty("لا توجد نتائج","غيّر البحث أو نوع المصدر."));
      }else{
        if(!repos.length&&!direct.length&&!siteRows.length){if(loading){body.append(el("p","v7-notice","جارٍ تحميل الإضافات…"));return;}body.append(empty("ابدأ بإضافة مصدر لك","اضغط «أضف» لإضافة أول مستودع أو إضافة."));return;}
        const matches=repos.filter(r=>(type==="الكل"||kindName({kind:r.group.kind})===type)&&(!currentSearch||String(r.data.name||"").toLowerCase().includes(currentSearch)));
        const directMatches=filtered(direct);
        const siteMatches=siteRows.filter(x=>(type==="الكل"||type==="مانجا")&&(!currentSearch||String((x.label||"")+" "+(x.domain||"")+" "+(x.engine||"")).toLowerCase().includes(currentSearch)));
        const groups=[{name:"مستودعات",items:matches,row:storeRepoRow},{name:"إضافات برابط",items:directMatches,row:a=>sourceRow(a,"remote")},{name:"مواقع",items:siteMatches,row:siteRow}].filter(group=>group.items.length);
        for(const group of groups){
          if(groups.length>1)body.append(el("h3","v7-group-title",group.name));
          const list=el("div","v7-list");group.items.forEach(item=>list.append(group.row(item)));body.append(list);
        }
        if(!groups.length)body.append(empty("لا توجد نتائج","غيّر البحث أو نوع المصدر."));
      }
    }else if(tab==="verification"){
      const list=el("div","v7-list");
      for(const a of filtered(challenged)){
        if(a._site)list.append(siteRow(a));
        else list.append(sourceRow(a,a._store?"native":"remote",repos.find(r=>r.data.url===a._url)?.data));
      }
      for(const item of unknown.filter(x=>!currentSearch||String(x.host+" "+(x.sourceName||"")).toLowerCase().includes(currentSearch)))list.append(verificationRow(item));
      body.append(list.childElementCount?list:empty("لا توجد مصادر تحتاج تحققًا",""));
    }else{
      const filteredRemote=filtered(allRemote);
      const filteredNative=filtered(installedNative);
      const filteredSites=siteRows.filter(x=>(type==="الكل"||type==="مانجا")&&(!currentSearch||String((x.label||"")+" "+(x.domain||"")+" "+(x.engine||"")).toLocaleLowerCase().includes(currentSearch)));
      const list=el("div","v7-list");
      filteredRemote.forEach(a=>list.append(sourceRow(a,"remote")));
      filteredNative.forEach(a=>list.append(sourceRow(a,"native",repos.find(r=>r.data.url===a._url)?.data)));
      filteredSites.forEach(a=>list.append(siteRow(a)));
      if(!filteredRemote.length&&!filteredNative.length&&!filteredSites.length)body.append(empty("ابدأ بإضافة مصدر لك","لم تُثبّت إضافات بعد."));
      else{body.append(list);}
    }
  }
  function verificationRow(item){
    const row=el("div","v7-verification-item");
    const title=el("div","v7-verification-name");
    title.append(el("strong",null,item.sourceName||item.host),el("small",null,item.host));
    if(item.message)title.append(el("small",null,fmtErr(item.message)));
    const go=btn("تحقق","v7-btn",()=>{void verifyHost(item.host,go);});
    row.append(title,go);return row;
  }
  async function refresh(){
    if(!alive)return;
    const run=++generation;
    resetRequests();loading=true;notify("");draw();
    const sitesTask=(async()=>{
      if(!sites?.list)return;
      try{
        const rows=await sites.list();
        if(alive&&run===generation){siteRows=rows||[];draw();}
      }catch(err){if(alive&&run===generation)notify("تعذر تحديث مواقع المانجا: "+fmtErr(err));}
    })();
    try{
      const settled=await Promise.allSettled(stores.map(async group=>{
        const res=await group.api.list();
        if(alive&&run===generation&&Array.isArray(res?.installed))installedMetadata.set(group.id,res.installed);
        return (res?.repos||[]).map(data=>({group,data,key:group.id+":"+data.url}));
      }));
      if(!alive||run!==generation)return;
      const failedKinds=new Set(stores.filter((g,i)=>settled[i]?.status==="rejected").map(g=>g.id));
      repos=[...repos.filter(r=>failedKinds.has(r.group.id)),...settled.filter(x=>x.status==="fulfilled").flatMap(x=>x.value)];
      for(const result of settled)if(result.status==="rejected"&&result.reason?.code!=="UNSUPPORTED_ON_WEB")notify("تعذر تحديث المستودعات: "+fmtErr(result.reason));
      const saved=new Set(repos.map(r=>r.key));
      for(const key of extensions.keys())if(!saved.has(key))extensions.delete(key);
      for(const key of extensionErrors.keys())if(!saved.has(key))extensionErrors.delete(key);
      if(opened&&!saved.has(opened.key))opened=null;
      if(restoreKey){opened=repos.find(r=>r.key===restoreKey)||null;restoreKey=null;}
      draw();
      // Read installed native sources without flooding bridges with every saved index at once.
      await Promise.all(repos.map(r=>loadExtensions(r,{force:true,run})));
      await sitesTask;
    }catch(err){if(alive&&run===generation)notify(fmtErr(err));}
    finally{if(alive&&run===generation){loading=false;draw();
      if(restoreScroll){restoreScroll=false;root.scrollTop=Number(initialState.scrollTop)||0;
        if(Number.isFinite(initialState.scrollY)&&typeof window?.scrollTo==="function")window.scrollTo({top:initialState.scrollY,behavior:"instant"});}
    }}
  }
  function drainRequests(){
    while(alive&&activeRequests<4&&queue.length){
      const job=queue.shift();
      if(job.run!==generation){job.resolve();continue;}
      activeRequests++;
      void (async()=>{
        try{
          const items=await job.repo.group.api.extensions(job.repo.data.url);
          if(alive&&job.run===generation){
            extensions.set(job.repo.key,{store:job.repo.group,url:job.repo.data.url,items:items||[]});
            extensionErrors.delete(job.repo.key);
          }
        }catch(err){
          if(alive&&job.run===generation){extensionErrors.set(job.repo.key,fmtErr(err));notify(fmtErr(err));}
        }finally{
          if(job.run===generation){activeRequests--;requests.delete(job.repo.key);draw();drainRequests();}
          job.resolve();
        }
      })();
    }
  }
  function loadExtensions(r,{force=false,run=generation}={}){
    if(!alive||run!==generation)return Promise.resolve();
    if(requests.has(r.key))return requests.get(r.key);
    if(!force&&(extensions.has(r.key)||extensionErrors.has(r.key))){draw();return Promise.resolve();}
    extensionErrors.delete(r.key);
    let resolve;
    const promise=new Promise(done=>{resolve=done;});
    requests.set(r.key,promise);queue.push({repo:r,run,resolve});
    draw();drainRequests();return promise;
  }
  function cancelDiagnostic(){
    if(diagnosticController){diagnosticController.abort();diagnosticController=null;busy=false;}
  }
  function closeModal(force=false){if(busy&&!force&&!diagnosticController)return;cancelDiagnostic();layer.hidden=true;dialog.replaceChildren();}
  function showDialog(title,description){
    if(!alive)return;
    cancelDiagnostic();layer.hidden=false;dialog.replaceChildren();
    dialog.append(el("h3",null,title));
    if(description)dialog.append(el("p",null,description));
  }
  function bottomButtons(primaryName,primary,variant="primary"){
    const actions=el("div","v7-dialog-actions");
    const yes=btn(primaryName,"v7-btn "+variant,primary),no=btn("رجوع","v7-btn",()=>closeModal());
    actions.append(yes,no);dialog.append(actions);return yes;
  }
  function renderDiagnostics(a,container,actions){
    const results=el("div","v7-checks");results.setAttribute("aria-live","polite");
    const check=btn("فحص الإضافة","v7-btn",async()=>{
      if(busy)return;busy=true;check.disabled=true;results.textContent="جارٍ فحص الإضافة…";
      const controller=new AbortController();diagnosticController=controller;
      try{
        const result=await onCheck(a,{signal:controller.signal});
        if(!alive||controller.signal.aborted||!dialog.contains(results))return;
        diagnosticResults.set(diagnosticKey(a),result);
        results.replaceChildren();
        const labels={passed:"نجح",failed:"مشكلة",untested:"لم يُفحص",unsupported:"غير مدعوم",empty:"لا نتائج",configuration:"يحتاج إعدادًا",disabled:"معطلة"};
        const checks=[...(result?.checks||[])];
        for(const capability of a.capabilities||[])if(!checks.some(x=>x.capability===capability))
          checks.push({capability,state:"untested",message:"لم يُرجع الفحص نتيجة لهذه القدرة."});
        for(const item of checks){
          const line=el("div","v7-check");line.dataset.state=item.state;
          line.append(el("strong",null,[item.sourceName,labels[item.state]||"لم يُفحص",capabilityLabel(item.capability)].filter(Boolean).join(" · ")),el("span",null,fmtErr(item.message||"لم يُرجع الفحص تفاصيل.")));results.append(line);
        }
        if(!checks.length)results.append(el("p","v7-notice","لم يُرجع الفحص نتائج قابلة للتحقق."));
        if(result?.assessment?.detail)results.append(el("p","v7-notice",fmtErr(result.assessment.detail)));
        const detail=dialog.querySelector(".v7-evidence-detail");if(detail)detail.textContent=installedState(a).detail;draw();
      }catch(err){if(alive&&!controller.signal.aborted&&dialog.contains(results))results.replaceChildren(el("p","v7-notice",fmtErr(err)));}
      finally{if(diagnosticController===controller){diagnosticController=null;busy=false;}check.disabled=false;}
    });actions.append(check);container.append(results);
  }
  function showDetails(a,mode,parent){
    showDialog(a.name,a.description||"");
    const main=el("div","v7-fields");
    const field=(k,v)=>{const d=el("div","v7-field");d.append(el("strong",null,k),el("span",null,v||"—"));return d;};
    main.append(field("النوع",kindName(a)),field("الإصدار",a.version||"—"),field("المستودع",parent?.name||a.repository?.name||a.repositoryName||a.repository?.url||a.repo||a._url||a.origin||"غير معروف"),field("اللغة",a.lang||a.languages?.[0]||"—"));
    dialog.append(main);
    const challenges=sourceChallenges(a);
    if(challenges.length){
      dialog.append(el("p","v7-notice",challenges[0].message?fmtErr(challenges[0].message):"هذا المصدر يحتاج تحققًا قبل إعادة المحاولة."));
      const verify=btn("تحقق من المصدر","v7-btn",()=>{void verifyHost(challenges[0].host,verify);});
      dialog.append(verify);
    }
    const assessment=a.assessment||(mode==="remote"?assessAddon(a,registry.runtimeName||"pwa"):null);
    const knownFailure=a.loadError||a.disabledReason||a.error;
    dialog.append(el("p","v7-notice",knownFailure
      ? "حالة التشغيل: مشكلة في المصدر — "+fmtErr(knownFailure)
      : assessment?.detail
        ? "حالة التشغيل: "+fmtErr(assessment.detail)
        : "حالة التشغيل: لم تُفحص."));
    dialog.append(el("p","v7-notice v7-evidence-detail",installedState(a).detail));
    // تنبيه الناشر يُعرض كما هو، والمصدر يبقى قابلًا للاستعمال
    if(typeof a.advisory==="string"&&a.advisory.trim())dialog.append(el("p","v7-notice v7-advisory",a.advisory.slice(0,300)));
    for(const [cap,h] of Object.entries(a.health||{}))if(h.reason)dialog.append(el("p","v7-notice",cap+": "+fmtErr(h.reason)));
    if(mode==="remote"){
      const acts=el("div","v7-dialog-actions");
      const open=btn("فتح في VANTARA","v7-btn primary",()=>openRemote(a));
      if(!canOpenRemote(a))open.disabled=true;
      acts.append(open,btn("رجوع","v7-btn",()=>closeModal()));dialog.append(acts);
      if(!canOpenRemote(a))dialog.append(el("p","v7-notice","هذه الإضافة لا تعرض كتالوجًا مباشرًا على هذا الجهاز؛ تبقى متاحة لوظائفها المدعومة."));
      // Keep all existing Addon Fabric capabilities behind a compact advanced disclosure.
      const advanced=el("details","v7-advanced");
      advanced.append(el("summary",null,"إدارة الإضافة وإعداداتها"));
      const advancedActions=el("div","v7-dialog-actions");
      const run=async(action)=>{
        if(busy)return;busy=true;
        try{await action();closeModal(true);draw();sourcesChanged();}
        catch(err){notify(fmtErr(err));}finally{busy=false;}
      };
      const act=(title,fn)=>advancedActions.append(btn(title,"v7-btn",()=>void run(fn)));
      if(registry.enable && !a.bundled)act(a.enabled===false?"تفعيل":"تعطيل",()=>registry.enable(a.key,a.enabled===false));
      if(registry.pin)act(a.pinned?"إلغاء التثبيت بالأعلى":"تثبيت بالأعلى",()=>registry.pin(a.key,!a.pinned));
      if(registry.stage && !a.bundled){
        const updateResult=el("p","v7-update-result");updateResult.setAttribute("role","status");
        const update=btn("فحص تحديث","v7-btn",async()=>{
          if(busy)return;busy=true;update.disabled=true;updateResult.textContent="جارٍ فحص التحديث…";
          try{const result=await registry.stage(a.key);if(!alive||!dialog.contains(updateResult))return;
            updateResult.dataset.state=result?.changed===true?"update":result?.changed===false?"noUpdate":"unknown";
            updateResult.textContent=result?.changed===true?"يوجد تحديث جاهز للتطبيق.":result?.changed===false?"الإضافة محدّثة؛ لا يوجد تحديث جديد.":"لم يُرجع المصدر نتيجة تحديث واضحة.";
            if(result?.changed===true){const fresh=registry.list?.().find(x=>x.key===a.key);if(fresh?.stagedVersion&&!advancedActions.querySelector('[data-apply-update]')){const apply=btn("تطبيق التحديث","v7-btn",()=>void run(()=>registry.activateStaged(a.key)));apply.dataset.applyUpdate="";advancedActions.append(apply);}}
            draw();
          }catch(err){if(alive){updateResult.dataset.state="error";updateResult.textContent=fmtErr(err);}}
          finally{busy=false;update.disabled=false;}
        });advancedActions.append(update);advanced.append(updateResult);
      }
      if(registry.activateStaged && a.stagedVersion)act("تطبيق التحديث",()=>registry.activateStaged(a.key));
      if(registry.rollback && a.previousVersion)act("العودة للإصدار السابق",()=>registry.rollback(a.key));
      if(registry.reinstall && !a.bundled)act("إعادة التثبيت",()=>registry.reinstall(a.key));
      if(onCheck)renderDiagnostics(a,advanced,advancedActions);
      if(a.configuration?.configurable && registry.configurationUrl){
        try{const link=configureLink(a,registry);if(link){link.className="v7-btn";advancedActions.append(link);}}
        catch{/* Optional configuration cannot prevent opening details. */}
      }
      if(advancedActions.childElementCount){advanced.append(advancedActions);dialog.append(advanced);}
    }else{
      const acts=el("div","v7-dialog-actions");
      if(onCheck&&(a.installed||a.builtin||a.update))renderDiagnostics(a,dialog,acts);
      const wrongFamily=(a._store?.kind==="anime"&&a.anime===false)||(a._store?.kind==="manga"&&a.anime===true);
      if(wrongFamily){
        dialog.append(el("p","v7-notice",a._store?.kind==="anime"?"هذه إضافة مانجا؛ ثبّتها من مستودع مانجا.":"هذه إضافة أنمي؛ ثبّتها من مستودع أنمي."));
      }else if(!a.installed&&!a.builtin&&!a.update){
        acts.append(btn("تثبيت","v7-btn primary",async()=>{
          if(busy)return;busy=true;
          try{await installNative(a);closeModal(true);sourcesChanged();await refresh();}
          catch(err){notify(fmtErr(err));}finally{busy=false;}
        }));
        if(a._store?.kind==="anime"){
          acts.append(btn("ثبّت في السينما","v7-btn",async()=>{
            if(busy)return;busy=true;
            try{await a._store.api.install(a._url,a.pkg,"cinema");closeModal(true);sourcesChanged();await refresh();}
            catch(err){notify(fmtErr(err));}finally{busy=false;}
          }));
        }
      }else if(!wrongFamily){
        if(a.update)acts.append(btn("تحديث","v7-btn primary",async()=>{
          if(busy)return;busy=true;
          try{await installNative(a);closeModal(true);sourcesChanged();await refresh();}
          catch(err){notify(fmtErr(err));}finally{busy=false;}
        }));
        acts.append(btn("فتح في VANTARA","v7-btn primary",()=>openNative(a)));
        if(!a.builtin)acts.append(btn("حذف","v7-btn danger",()=>askDelete(a,"native")));
      }
      if(a._store?.api?.enable && a.installed)acts.append(btn(a.enabled===false?"تفعيل":"تعطيل","v7-btn",async()=>{
        if(busy)return;busy=true;
        try{await a._store.api.enable(a.pkg,a.enabled===false);closeModal(true);sourcesChanged();await refresh();}
        catch(error){notify(fmtErr(error));}finally{busy=false;}
      }));
      acts.append(btn("رجوع","v7-btn",()=>closeModal()));dialog.append(acts);
    }
  }
  function canOpenRemote(a){
    return a.enabled!==false && !(a.configuration?.required && !a.configuration?.configured) && supportedCapabilities(a,registry.runtimeName||"pwa")
      .some(c=>["catalog","home","search"].includes(c));
  }
  function openRemote(a){
    if(sourceChallenges(a).length){showDetails(a,"remote");return;}
    if(!canOpenRemote(a))return notify("المصدر لا يوفر كتالوجًا مدعومًا.");
    closeModal();invoke(onOpenSource,a);
  }
  function openNative(a){
    if(a.enabled===false)return notify("هذه الإضافة معطلة؛ فعّلها من تفاصيلها أولًا.");
    if(sourceChallenges(a).length){showDetails(a,"native",repos.find(r=>r.data.url===a._url)?.data);return;}
    closeModal();
    if(onOpenNativeSource){invoke(onOpenNativeSource,a);return;}
    notify("هذا المصدر مثبت في المحرك الأصلي. افتحه من قسم الأنمي أو المانجا في VANTARA.");
  }
  async function installNative(a){
    const api=a._store?.api;
    if(!api)throw Error("تعذر تحديد محرك الإضافة.");
    // Preserve native distinction: Aniyomi can target anime/cinema; manga uses its own engine.
    await api.install(a._url,a.pkg,a._store.kind==="anime"?(a.content==="cinema"?"cinema":"anime"):undefined);
  }
  function askDelete(a,mode){
    showDialog("حذف المصدر؟","هل تريد حذف «"+a.name+"» من الإضافات المثبتة؟");
    const actions=el("div","v7-confirm-actions");
    const cancel=btn("رجوع","v7-btn",()=>closeModal());
    const yes=btn("حذف","v7-btn danger",async()=>{
      if(busy)return;busy=true;yes.disabled=true;
      try{
        if(mode==="remote")await registry.remove(a.key);
        else await a._store.api.uninstall(a.pkg);
        closeModal(true);sourcesChanged();await refresh();draw();
      }catch(err){notify(fmtErr(err));}finally{busy=false;yes.disabled=false;}
    });
    actions.append(cancel,yes);dialog.append(actions);
  }
  function showImport(){
    showDialog("أضف مصدرًا أو مستودعًا","ألصق رابط مستودع أو إضافة.");
    const line=el("div","v7-search");
    const addFile=btn("","v7-upload",()=>file.click());addFile.append(ico("plus"));
    addFile.setAttribute("aria-label","اختيار ملف من مدير الملفات");
    const input=el("input","v7-add-input");input.placeholder="ألصق الرابط...";
    input.setAttribute("aria-label","رابط المستودع أو الإضافة");input.dir="ltr";
    const file=el("input");file.type="file";file.accept=".json,application/json";file.multiple=true;file.hidden=true;
    file.dataset.importFile="";
    line.append(addFile,input,file);dialog.append(line);
    const note=el("div","v7-notice");dialog.append(note);
    const yes=bottomButtons("أضف",async()=>{await processInput(input.value.trim(),note,yes);});
    file.onchange=async()=>{
      if(!file.files?.length)return;
      await processFiles(file.files,note);
    };
  }
  async function processInput(value,note,yes){
    if(!value){note.textContent="ألصق رابطًا أولًا.";return;}
    let uri;
    try{uri=safe(/^stremio:\/\//i.test(value)?manifestEndpoint(value):value);}catch{}
    if(!uri){note.textContent="يتطلب رابط HTTPS صالحًا.";return;}
    const parsed=new URL(uri);
    // Native repositories contain executable extension code. Require informed opt-in before calling add().
    if(!/\/manifest\.json\/?$/i.test(parsed.pathname) && yes.dataset.trustedUrl!==uri){
      yes.dataset.trustedUrl=uri;
      yes.textContent="أثق به، أضفه";
      note.textContent="إضافات المستودع قد تنفّذ كودًا على جهازك. أضف مستودعات تثق بناشريها فقط؛ اضغط مجددًا للتأكيد.";
      return;
    }
    if(busy)return;
    busy=true;yes.disabled=true;note.textContent="جارٍ فحص الرابط…";
    try{
      const explicitManifest=/\/manifest\.json\/?$/i.test(parsed.pathname);
      let preview;
      // Stable accepts service roots as well as manifest/install links. Probe
      // through its existing registry before considering a plain website.
      if(!explicitManifest && !/\.json\/?$/i.test(parsed.pathname) && registry.inspect){
        try{preview=await registry.inspect(uri);}catch{/* Not a Manifest: existing site/repository flow validates next. */}
        if(!alive||!dialog.contains(note))return;
      }
      if(explicitManifest||preview){
        preview??=await registry.inspect(uri);
        note.textContent="الإضافة: "+preview.manifest.name+" · راجع المصدر قبل التثبيت.";
        yes.textContent="تأكيد التثبيت";yes.onclick=async()=>{
          if(busy)return;busy=true;yes.disabled=true;
          try{await registry.install(preview);closeModal(true);await refresh();sourcesChanged();}
          catch(e){note.textContent=fmtErr(e);}finally{busy=false;yes.disabled=false;}
        };
        return;
      }
      // Standalone manga websites use the actual site bridge, not the executable APK repo engines.
      if(!/\.json$/i.test(parsed.pathname) && sites?.add){
        const site=await sites.add(uri);
        note.textContent="أُضيف الموقع: "+(site?.label||parsed.hostname);
        closeModal(true);await refresh();sourcesChanged();return;
      }
      // CloudStream's repo.json points at a pluginLists index of .cs3 packages.
      // A valid index is NOT executable by native Mihon/Aniyomi APK runtimes.
      // Recognize its format and report real compatibility rather than
      // submitting it to unrelated engines or falsely saying it is installed.
      const cloudstream=stores.find(s=>s.family==="cloudstream");
      if(/\/repo\.json$/i.test(parsed.pathname) && cloudstream){
        try{
          await cloudstream.api.add(uri);closeModal(true);await refresh();sourcesChanged();return;
        }catch(error){
          if(!/NOT_CLOUDSTREAM_REPOSITORY/.test(String(error?.code||error?.message)))throw error;
        }
      }
      if(/\/repo\.json$/i.test(parsed.pathname) && !cloudstream && typeof fetch==="function"){
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),5000);
        try{
          const response=await fetch(uri,{method:"GET",credentials:"omit",signal:controller.signal});
          if(response.ok && Number(response.headers?.get?.("content-length")||0)<65536){
            const data=await response.text();
            if(data.length<65536){
              const index=JSON.parse(data);
              if(Array.isArray(index.pluginLists)&&index.pluginLists.length){
                note.textContent="هذا مستودع CloudStream صالح، لكن VANTARA لا يملك حاليًا محركًا ينفّذ إضافات .cs3. لم تُثبّت الإضافات، ولن نعرضها على أنها تعمل.";
                return;
              }
            }
          }
        }catch{/* Offline/CORS: let native repositories validate their formats. */}
        finally{clearTimeout(timeout);}
      }
      const candidates=stores.filter(s=>s.api?.add&&s.family!=="cloudstream");
      if(!candidates.length){note.textContent="لا يوجد محرك مستودعات متاح في هذا الجهاز.";return;}
      let matched=false, lastError="";
      // Real engines validate format and signing; do not substitute a simulated repository.
      for(const store of candidates){
        try{
          note.textContent="جارٍ قراءة المستودع باستخدام "+(store.kind==="anime"?"Aniyomi":"Mihon")+"…";
          const result=await store.api.add(uri);
          note.textContent="مستودع "+(result?.repo?.name||"جديد")+" يحتاج تأكيدًا في المحرك.";
          matched=true;sourcesChanged();await refresh();closeModal(true);break;
        }catch(e){lastError=fmtErr(e);}
      }
      if(!matched)note.textContent=lastError||"صيغة المستودع غير متوافقة مع المحركات الحالية.";
    }catch(e){note.textContent=fmtErr(e);}
    finally{busy=false;yes.disabled=false;}
  }
  async function processFiles(files,note){
    if(!registry.inspectData){note.textContent="استيراد JSON غير مدعوم.";return;}
    if(files.length>100){note.textContent="الحد الأقصى 100 ملف.";return;}
    if([...files].reduce((a,f)=>a+f.size,0)>1048576){note.textContent="الحد الأقصى الإجمالي 1MB.";return;}
    const entries=[];
    try{
      for(const f of files){
        const data=await f.text();
        const out=await registry.inspectData(data);
        entries.push(...out);
      }
      dialog.replaceChildren(el("h3",null,"معاينة الإضافات"));
      const picks=[];
      for(const item of entries){
        const line=el("label","v7-field");
        const cb=el("input");cb.type="checkbox";cb.checked=!!item.preview;
        cb.disabled=!item.preview;
        line.append(cb,el("span",null,item.preview?.manifest?.name||item.name||"ملف غير صالح"));
        if(item.error)line.append(el("small",null,fmtErr(item.error)));
        picks.push({cb,preview:item.preview});dialog.append(line);
      }
      const state=el("p","v7-notice");dialog.append(state);
      bottomButtons("تثبيت المحدد",async()=>{
        if(busy)return;busy=true;
        try{
          for(const pick of picks.filter(p=>p.cb.checked&&p.preview))await registry.install(pick.preview);
          closeModal(true);await refresh();sourcesChanged();
        }catch(e){state.textContent=fmtErr(e);}finally{busy=false;}
      });
    }catch(e){note.textContent=fmtErr(e);}
  }
  function navigateBack(){
    if(!layer.hidden){closeModal();return true;}
    if(menuOpen){menuOpen=false;filterMenu.hidden=true;return true;}
    if(opened){opened=null;type="الكل";currentSearch="";search.value="";draw();return true;}
    return false;
  }
  root.back=navigateBack;
  root.snapshot=()=>({tab,openedKey:opened?.key||restoreKey||null,search:search.value,type,scrollTop:root.scrollTop||0,scrollY:window?.scrollY||0});
  let removePulse=pulse?.onChange?.(()=>{if(alive)draw();})||(()=>{});
  root.close=()=>{cancelDiagnostic();alive=false;removePulse();removeVerification();generation++;lifecycle++;resetRequests();for(const id of timers)clearTimeout(id);timers.clear();layer.hidden=true;dialog.replaceChildren();};
  root.reload=()=>{alive=true;removePulse();removePulse=pulse?.onChange?.(()=>{if(alive)draw();})||(()=>{});removeVerification();removeVerification=verification?.subscribe?.(receiveVerification)||(()=>{});void refresh();};
  search.oninput=()=>{currentSearch=search.value.trim().toLocaleLowerCase();draw();};
  void refresh();draw();
  return root;
}
