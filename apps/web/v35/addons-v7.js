
/* VANTARA V7 live add-on manager.
 * Presentation only: no migration, reset, deletion, or replacement of stored data.
 * The underlying registry and native extension stores remain authoritative. */
import { supportedCapabilities } from "../addons/assessment.js";

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
const label=(x)=>String(x||"V").trim().slice(0,2).toUpperCase();
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
  registry={}, filter="all", repositories=null, animeRepositories=null, sites=null,
  onOpenSource=()=>{}, onOpenNativeSource=null, onBack=()=>{}, onSourcesChanged=()=>{}, onCheck,
}={}){
  const root=el("section","v7-addon addon-v7");
  root.dir="rtl";
  if(["anime","manga","cinema"].includes(filter))root.dataset.sectionHub=filter;
  let alive=true, tab="repos", opened=null, currentSearch="", type="الكل";
  let busy=false, generation=0, lifecycle=0, menuOpen=false;
  const timers=new Set(), extensionErrors=new Map(), installedMetadata=new Map();
  let requests=new Map(), queue=[], activeRequests=0;
  const stores=[
    ...(animeRepositories?[{id:"anime",kind:"anime",api:animeRepositories}]:[]),
    ...(repositories?[{id:"manga",kind:"manga",api:repositories}]:[])
  ];
  let repos=[], extensions=new Map(), siteRows=[], loading=false;
  const mast=el("div","v7-mast"),word=el("div","v7-word");
  word.textContent="VANTARA · ADD-ONS";
  const back=btn("", "v7-back",()=>{if(!root.back())onBack();});
  back.append(ico("back"),el("span",null,"رجوع"));
  mast.append(word,back);
  const head=el("header","v7-heading"),headText=el("div"),heading=el("h2",null,"الإضافات");
  const subtitle=el("p",null,"أضف مستودعًا أو مصدرًا، وافتحه داخل VANTARA بواجهته الأصلية.");
  headText.append(heading,subtitle);
  const add=btn("أضف","v7-plus",()=>showImport());
  add.prepend(ico("plus"));
  head.append(headText,add);
  const tabs=el("nav","v7-tabs");
  const repoTab=btn("المستودعات","v7-tab",()=>switchTab("repos"));
  const installedTab=btn("المثبتة","v7-tab",()=>switchTab("installed"));
  const repoCount=el("span","v7-count","0"), installedCount=el("span","v7-count","0");
  repoTab.append(repoCount);installedTab.append(installedCount);
  tabs.append(repoTab,installedTab);
  const tools=el("div","v7-tools"),searchBox=el("label","v7-search"),search=el("input");
  search.type="search";search.autocomplete="off";search.placeholder="ابحث عن مصدر أو مستودع...";
  search.dataset.addonSearch="";
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
  root.append(mast,head,tabs,tools,body,message,layer);
  layer.addEventListener("click",e=>{if(e.target===layer && !busy)closeModal();});
  const fmtErr=e=>String(e?.message||e||"تعذر إكمال العملية").replace(/(?:https?:\/\/|stremio:\/\/)\S+/gi,"[رابط]");
  const notify=(s)=>{if(alive)message.textContent=s;};
  const invoke=(callback,...args)=>{
    if(!alive)return;
    try{Promise.resolve(callback(...args)).catch(err=>notify(fmtErr(err)));}
    catch(err){notify(fmtErr(err));}
  };
  const sourcesChanged=()=>invoke(onSourcesChanged);
  const later=(callback,delay)=>{
    const id=setTimeout(()=>{timers.delete(id);if(alive)callback();},delay);
    timers.add(id);
  };
  const resetRequests=()=>{
    for(const job of queue)job.resolve();
    queue=[];requests=new Map();activeRequests=0;
  };
  function logo(item,fallback,repo=false){
    const box=el("span","v7-logo"+(repo?" is-repo":""));
    const abbr=el("span","v7-fallback",label(item.name));box.append(abbr);
    const urls=[item.iconUrl,item.icon,item.logo,item.imageUrl,fallback?.iconUrl,fallback?.icon,fallback?.logo].map(safeIcon).filter(Boolean);
    let idx=0;
    const next=()=>{
      if(!alive||idx>=urls.length)return;
      const img=el("img");img.alt="";img.loading="lazy";img.referrerPolicy="no-referrer";
      img.onload=()=>{if(img.naturalWidth<16){img.remove();next();}else{abbr.hidden=true;}};
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
    return [kindName(a),a.arabic?"العربية":(a.lang||a.languages?.[0]||""),a.version||""].filter(Boolean).join(" · ");
  }
  function sourceRow(a,mode,parent){
    const row=el("article","v7-row");row.tabIndex=0;
    row.setAttribute("role","button");row.setAttribute("aria-label","تفاصيل "+a.name);
    const logoBox=logo(a,parent),info=el("div","v7-info");
    info.append(el("div","v7-name",a.name),el("div","v7-meta",sourceMeta(a)));
    const statusSlot=el("div","v7-status-slot"),stateLabel=el("span","v7-status");
    const isAdded=mode==="remote"?true:!!(a.installed||a.builtin||a.update);
    stateLabel.textContent="● مثبتة";
    if(isAdded)stateLabel.classList.add("visible");
    statusSlot.append(stateLabel);info.append(statusSlot);
    const actions=el("div","v7-actions");
    const foreign=mode==="native" && ((a._store?.kind==="anime"&&a.anime===false)||(a._store?.kind==="manga"&&a.anime===true));
    if(mode==="remote"){
      if(canOpenRemote(a)){
        const open=btn("فتح","v7-simple-btn",e=>{e.stopPropagation();openRemote(a);});
        open.prepend(ico("open"));actions.append(open);
      }
      if(!a.bundled && registry.remove){
        const del=btn("","v7-trash",e=>{e.stopPropagation();askDelete(a,"remote");});
        del.setAttribute("aria-label","حذف "+a.name);del.append(ico("trash"));actions.prepend(del);
      }
    }else if(mode==="native"){
      actions.classList.add("v7-native-actions");
      if(foreign){
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
    info.append(el("div","v7-name",item.name),el("div","v7-meta",["موقع مانجا",site.engine,site.domain].filter(Boolean).join(" · ")));
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
    actions.append(details);
    row.append(logo(item),info,actions);
    row.onclick=e=>{if(!e.target.closest("button"))details.click();};
    return row;
  }
  function storeRepoRow(r){
    const row=el("article","v7-row");
    row.append(logo(r.data,null,true));
    const info=el("div","v7-info");
    info.append(el("div","v7-name",r.data.name),el("div","v7-meta",(r.group.kind==="anime"?"Aniyomi":"Mihon")+" · "+(r.data.count??"")+" إضافة"));
    row.append(info);
    const go=btn("استعراض","v7-simple-btn",()=>{opened=r;type="الكل";search.value="";currentSearch="";draw();loadExtensions(r);});
    go.prepend(ico("chevron"));row.append(go);
    return row;
  }
  function switchTab(t){tab=t;opened=null;menuOpen=false;filterMenu.hidden=true;currentSearch="";type="الكل";search.value="";draw();}
  function toggleMenu(){
    menuOpen=!menuOpen;filterMenu.hidden=!menuOpen;
  }
  function fillKinds(items){
    const names=["الكل",...new Set(items.map(kindName))];
    if(!names.includes(type))type="الكل";
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
    const record={...item,kind:store.kind,_store:store,_url:url};
    if(installedMetadata.has(store.id)){
      record.installed=local?(local.version||true):false;
      if(!local)record.update=false;
    }
    if(local){record.iconUrl=local.iconUrl||item.iconUrl;record.content=local.content||item.content;}
    return record;
  }
  function draw(){
    if(!alive)return;
    const allRemote=registry.list?.()||[];
    const nativeByPackage=new Map();
    for(const x of extensions.values())for(const ext of x.items)nativeByPackage.set(x.store.id+":"+ext.pkg,nativeRecord(ext,x.store,x.url));
    for(const store of stores)for(const item of installedMetadata.get(store.id)||[]){
      const key=store.id+":"+item.pkg;
      if(!nativeByPackage.has(key))nativeByPackage.set(key,nativeRecord(item,store,item.repo));
    }
    const allNative=[...nativeByPackage.values()];
    const installedNative=allNative.filter(x=>x.installed || x.update || x.builtin);
    repoCount.textContent=String(repos.length);
    installedCount.textContent=String(allRemote.length+installedNative.length+siteRows.length);
    repoTab.classList.toggle("active",tab==="repos");
    installedTab.classList.toggle("active",tab==="installed");
    body.replaceChildren();
    body.setAttribute("aria-busy",String(loading));
    filterWrap.hidden=tab==="repos"&&!opened;
    fillKinds(tab==="installed"?[...allRemote,...installedNative,...siteRows.map(x=>({kind:"manga",name:x.label}))]:(opened?(extensions.get(opened.key)?.items||[]).map(item=>nativeRecord(item,opened.group,opened.data.url)):[]));
    if(tab==="repos"){
      if(opened){
        const backRepo=btn("رجوع","v7-back",()=>{opened=null;search.value="";currentSearch="";draw();});
        backRepo.prepend(ico("back"));
        body.append(backRepo);
        body.append(section(opened.data.name,opened.group.kind==="anime"?"Aniyomi":"Mihon"));
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
        if(!repos.length){if(loading){body.append(el("p","v7-notice","جارٍ تحميل المستودعات…"));return;}body.append(empty("ابدأ بإضافة مصدر لك","اضغط «أضف» لإضافة أول مستودع أو إضافة."));return;}
        const matches=repos.filter(r=>!currentSearch||(r.data.name||"").toLowerCase().includes(currentSearch));
        body.append(section("المستودعات",String(matches.length)));
        const list=el("div","v7-list");matches.forEach(r=>list.append(storeRepoRow(r)));
        body.append(list);
      }
    }else{
      const filteredRemote=filtered(allRemote);
      const filteredNative=filtered(installedNative);
      const filteredSites=siteRows.filter(x=>(type==="الكل"||type==="مانجا")&&(!currentSearch||String((x.label||"")+" "+(x.domain||"")+" "+(x.engine||"")).toLocaleLowerCase().includes(currentSearch)));
      const list=el("div","v7-list");
      filteredRemote.forEach(a=>list.append(sourceRow(a,"remote")));
      filteredNative.forEach(a=>list.append(sourceRow(a,"native",repos.find(r=>r.data.url===a._url)?.data)));
      filteredSites.forEach(a=>list.append(siteRow(a)));
      if(!filteredRemote.length&&!filteredNative.length&&!filteredSites.length)body.append(empty("ابدأ بإضافة مصدر لك","لم تُثبّت إضافات بعد."));
      else{body.append(section("المثبتة",String(filteredRemote.length+filteredNative.length+filteredSites.length)),list);}
    }
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
      for(const result of settled)if(result.status==="rejected")notify("تعذر تحديث المستودعات: "+fmtErr(result.reason));
      const saved=new Set(repos.map(r=>r.key));
      for(const key of extensions.keys())if(!saved.has(key))extensions.delete(key);
      for(const key of extensionErrors.keys())if(!saved.has(key))extensionErrors.delete(key);
      if(opened&&!saved.has(opened.key))opened=null;
      draw();
      // Read installed native sources without flooding bridges with every saved index at once.
      await Promise.all(repos.map(r=>loadExtensions(r,{force:true,run})));
      await sitesTask;
    }catch(err){if(alive&&run===generation)notify(fmtErr(err));}
    finally{if(alive&&run===generation){loading=false;draw();}}
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
  function closeModal(force=false){if(busy&&!force)return;layer.hidden=true;dialog.replaceChildren();}
  function showDialog(title,description){
    if(!alive)return;
    layer.hidden=false;dialog.replaceChildren();
    dialog.append(el("h3",null,title));
    if(description)dialog.append(el("p",null,description));
  }
  function bottomButtons(primaryName,primary,variant="primary"){
    const actions=el("div","v7-dialog-actions");
    const yes=btn(primaryName,"v7-btn "+variant,primary),no=btn("رجوع","v7-btn",()=>closeModal());
    actions.append(yes,no);dialog.append(actions);return yes;
  }
  function showDetails(a,mode,parent){
    showDialog(a.name,a.description||"");
    const main=el("div","v7-fields");
    const field=(k,v)=>{const d=el("div","v7-field");d.append(el("strong",null,k),el("span",null,v||"—"));return d;};
    main.append(field("النوع",kindName(a)),field("الإصدار",a.version||"—"),field("المستودع",parent?.name||"إضافات VANTARA"),field("اللغة",a.lang||a.languages?.[0]||"—"));
    dialog.append(main);
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
      if(registry.stage && !a.bundled)act("فحص تحديث",()=>registry.stage(a.key));
      if(registry.activateStaged && a.stagedVersion)act("تطبيق التحديث",()=>registry.activateStaged(a.key));
      if(registry.rollback && a.previousVersion)act("العودة للإصدار السابق",()=>registry.rollback(a.key));
      if(registry.reinstall && !a.bundled)act("إعادة التثبيت",()=>registry.reinstall(a.key));
      if(onCheck)act("فحص الاتصال",()=>onCheck(a));
      if(a.configuration?.configurable && registry.configurationUrl){
        try{
          const url=safe(registry.configurationUrl(a.key));
          if(url){
            const link=el("a","v7-btn","إعداد الإضافة");
            link.href=url;link.target="_blank";link.rel="noopener noreferrer";
            advancedActions.append(link);
          }
        }catch{/* Config URL is optional and must not break details. */}
      }
      if(advancedActions.childElementCount){advanced.append(advancedActions);dialog.append(advanced);}
    }else{
      const acts=el("div","v7-dialog-actions");
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
      acts.append(btn("رجوع","v7-btn",()=>closeModal()));dialog.append(acts);
    }
  }
  function canOpenRemote(a){
    return a.enabled!==false && !(a.configuration?.required && !a.configuration?.configured) && supportedCapabilities(a,registry.runtimeName||"pwa")
      .some(c=>["catalog","home","search"].includes(c));
  }
  function openRemote(a){
    if(!canOpenRemote(a))return notify("المصدر لا يوفر كتالوجًا مدعومًا.");
    closeModal();invoke(onOpenSource,a);
  }
  function openNative(a){
    closeModal();
    if(onOpenNativeSource){invoke(onOpenNativeSource,a);return;}
    const match=(registry.list?.()||[]).find(x=>x.name===a.name && canOpenRemote(x));
    if(match){invoke(onOpenSource,match);return;}
    notify("هذا المصدر مثبت في المحرك الأصلي. افتحه من قسم الأنمي أو المانجا في VANTARA.");
  }
  async function installNative(a){
    const api=a._store?.api;
    if(!api)throw Error("تعذر تحديد محرك الإضافة.");
    // Preserve native distinction: Aniyomi can target anime/cinema; manga uses its own engine.
    await api.install(a._url,a.pkg,a._store.kind==="anime"?"anime":undefined);
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
    const uri=safe(value);
    if(!uri){note.textContent="يتطلب رابط HTTPS صالحًا.";return;}
    const parsed=new URL(uri);
    // Native repositories contain executable extension code. Require informed opt-in before calling add().
    if(!parsed.pathname.endsWith("manifest.json") && yes.dataset.trustedUrl!==uri){
      yes.dataset.trustedUrl=uri;
      yes.textContent="أثق به، أضفه";
      note.textContent="إضافات المستودع قد تنفّذ كودًا على جهازك. أضف مستودعات تثق بناشريها فقط؛ اضغط مجددًا للتأكيد.";
      return;
    }
    if(busy)return;
    busy=true;yes.disabled=true;note.textContent="جارٍ فحص الرابط…";
    try{
      let url=parsed;
      if(url.pathname.endsWith("manifest.json")){
        const preview=await registry.inspect(uri);
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
      const candidates=stores.filter(s=>s.api?.add);
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
    if(!layer.hidden){if(!busy)closeModal();return true;}
    if(menuOpen){menuOpen=false;filterMenu.hidden=true;return true;}
    if(opened){opened=null;type="الكل";currentSearch="";search.value="";draw();return true;}
    if(tab==="installed"){switchTab("repos");return true;}
    return false;
  }
  root.back=navigateBack;
  root.close=()=>{alive=false;generation++;lifecycle++;resetRequests();for(const id of timers)clearTimeout(id);timers.clear();layer.hidden=true;dialog.replaceChildren();};
  root.reload=()=>{alive=true;void refresh();};
  search.oninput=()=>{currentSearch=search.value.trim().toLocaleLowerCase();draw();};
  void refresh();draw();
  return root;
}
