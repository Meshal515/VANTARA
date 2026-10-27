
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
const label=(x)=>String(x||"V").trim().slice(0,2).toUpperCase();
const kindName=(a)=>{
  if(a.anime || (a.contentTypes||[]).includes("anime"))return "أنمي";
  if((a.contentTypes||[]).includes("manga") || a.kind==="manga")return "مانجا";
  if((a.contentTypes||[]).some(x=>x==="movie"||x==="series"))return "سينما";
  if((a.capabilities||[]).includes("subtitles"))return "ترجمة";
  if((a.capabilities||[]).includes("streams"))return "تورنت";
  if((a.capabilities||[]).some(x=>x==="meta"||x==="details"))return "بيانات";
  return "مصدر";
};

export function renderV7Addons({
  registry, filter="all", repositories=null, animeRepositories=null, sites=null,
  onOpenSource=()=>{}, onBack=()=>{}, onSourcesChanged=()=>{}, onCheck,
}={}){
  const root=el("section","v7-addon addon-v7");
  root.dir="rtl";
  if(["anime","manga","cinema"].includes(filter))root.dataset.sectionHub=filter;
  let alive=true, tab="repos", opened=null, details=null, currentSearch="", type="الكل";
  let busy=false, generation=0, pending=false, modal=null, menuOpen=false;
  const stores=[
    ...(animeRepositories?[{id:"anime",kind:"anime",api:animeRepositories}]:[]),
    ...(repositories?[{id:"manga",kind:"manga",api:repositories}]:[])
  ];
  let repos=[], extensions=new Map(), loading=false;
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
  const notify=(s)=>{message.textContent=s;};
  function logo(item,fallback,repo=false){
    const box=el("span","v7-logo"+(repo?" is-repo":""));
    const abbr=el("span","v7-fallback",label(item.name));box.append(abbr);
    const urls=[item.iconUrl,item.icon,item.logo,item.imageUrl,fallback?.iconUrl,fallback?.icon,fallback?.logo].map(safe).filter(Boolean);
    let idx=0;
    const next=()=>{
      if(idx>=urls.length)return;
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
  function installed(a){return a.installed!==false && !a.available && (a.bundled || a.key || a.installed===true);}
  function sourceRow(a,mode,parent){
    const row=el("article","v7-row");row.tabIndex=0;
    row.setAttribute("role","button");row.setAttribute("aria-label","تفاصيل "+a.name);
    const logoBox=logo(a,parent),info=el("div","v7-info");
    info.append(el("div","v7-name",a.name),el("div","v7-meta",sourceMeta(a)));
    const statusSlot=el("div","v7-status-slot"),stateLabel=el("span","v7-status");
    const isAdded=mode==="remote"?true:!!a.installed;
    stateLabel.textContent="● مثبتة";
    if(isAdded)stateLabel.classList.add("visible");
    statusSlot.append(stateLabel);info.append(statusSlot);
    const actions=el("div","v7-actions");
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
      const slot=el("div","v7-trash-holder");
      const trash=btn("","v7-trash",e=>{e.stopPropagation();askDelete(a,"native");});
      trash.append(ico("trash"));trash.setAttribute("aria-label","حذف "+a.name);slot.append(trash);
      if(a.installed)slot.classList.add("visible");
      const flip=el("button","v7-flip"+(a.installed?" installed":""));
      flip.type="button";flip.setAttribute("aria-label",(a.installed?"فتح ":"تثبيت ")+a.name);
      const rotor=el("span","v7-rotor");
      const front=el("span","v7-face v7-front","تثبيت");
      const rear=el("span","v7-face v7-rear");
      rear.append(ico("open"),el("span",null,"فتح"));rotor.append(front,rear);flip.append(rotor);
      flip.onclick=async e=>{
        e.stopPropagation();
        if(flip.disabled)return;
        if(a.installed){
          showDetails(a,"native");
          return;
        }
        if(a.builtin){showDetails(a,"native");return;}
        flip.disabled=true;
        try{
          await installNative(a);
          a.installed=true;
          flip.classList.add("installed");
          flip.setAttribute("aria-label","فتح "+a.name);
          setTimeout(()=>{if(alive && row.isConnected)slot.classList.add("visible");},300);
          stateLabel.classList.add("visible");
          onSourcesChanged();
        }catch(err){notify(fmtErr(err));}finally{flip.disabled=false;}
      };
      actions.append(slot,flip);
    }
    row.append(logoBox,info,actions);
    row.onclick=e=>{if(!e.target.closest("button"))showDetails(a,mode,parent);};
    row.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();showDetails(a,mode,parent);}};
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
  function switchTab(t){tab=t;opened=null;details=null;currentSearch="";type="الكل";search.value="";draw();}
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
  function draw(){
    if(!alive)return;
    const allRemote=registry.list?.()||[];
    const allNative=[...extensions.values()].flatMap(x=>x.items.map(ext=>({...ext,kind:x.store.kind,_store:x.store,_url:x.url})));
    const installedNative=allNative.filter(x=>x.installed || x.update);
    repoCount.textContent=String(repos.length);
    installedCount.textContent=String(allRemote.length+installedNative.length);
    repoTab.classList.toggle("active",tab==="repos");
    installedTab.classList.toggle("active",tab==="installed");
    body.replaceChildren();message.textContent="";
    filterWrap.hidden=tab==="repos"&&!opened;
    fillKinds(tab==="installed"?[...allRemote,...installedNative]:(opened?extensions.get(opened.key)?.items||[]:[]));
    if(tab==="repos"){
      if(opened){
        const backRepo=btn("رجوع","v7-back",()=>{opened=null;search.value="";currentSearch="";draw();});
        backRepo.prepend(ico("back"));
        body.append(backRepo);
        body.append(section(opened.data.name,opened.group.kind==="anime"?"Aniyomi":"Mihon"));
        const list=el("div","v7-list");
        const ext=extensions.get(opened.key);
        if(!ext){body.append(el("p","v7-notice","جارٍ تحميل المصادر…"));return;}
        const records=filtered(ext.items.filter(x=>!x.nsfw));
        for(const item of records)list.append(sourceRow({...item,kind:opened.group.kind,_store:opened.group,_url:opened.data.url},"native",opened.data));
        body.append(records.length?list:empty("لا توجد نتائج","غيّر البحث أو نوع المصدر."));
      }else{
        if(!repos.length){body.append(empty("ابدأ بإضافة مصدر لك","اضغط «أضف» لإضافة أول مستودع أو إضافة."));return;}
        const matches=repos.filter(r=>!currentSearch||(r.data.name||"").toLowerCase().includes(currentSearch));
        body.append(section("المستودعات",String(matches.length)));
        const list=el("div","v7-list");matches.forEach(r=>list.append(storeRepoRow(r)));
        body.append(list);
      }
    }else{
      const filteredRemote=filtered(allRemote);
      const filteredNative=filtered(installedNative);
      const list=el("div","v7-list");
      filteredRemote.forEach(a=>list.append(sourceRow(a,"remote")));
      filteredNative.forEach(a=>list.append(sourceRow(a,"native",repos.find(r=>r.data.url===a._url)?.data)));
      if(!filteredRemote.length&&!filteredNative.length)body.append(empty("ابدأ بإضافة مصدر لك","لم تُثبّت إضافات بعد."));
      else{body.append(section("المثبتة",String(filteredRemote.length+filteredNative.length)),list);}
    }
  }
  async function refresh(){
    const run=++generation;
    loading=true;
    try{
      const entries=await Promise.all(stores.map(async group=>{
        const res=await group.api.list();
        return (res?.repos||[]).map(data=>({group,data,key:group.id+":"+data.url}));
      }));
      if(!alive||run!==generation)return;
      repos=entries.flat();
      // Always read previously installed native extensions; never infer an empty list from unopened repos.
      await Promise.all(repos.map(async r=>{
        try{
          const items=await r.group.api.extensions(r.data.url);
          if(alive&&run===generation)extensions.set(r.key,{store:r.group,url:r.data.url,items:items||[]});
        }catch(err){if(alive&&run===generation)notify(fmtErr(err));}
      }));
    }catch(err){if(alive&&run===generation)notify(fmtErr(err));}
    finally{loading=false;if(alive&&run===generation)draw();}
  }
  async function loadExtensions(r){
    if(extensions.has(r.key)){draw();return;}
    try{const items=await r.group.api.extensions(r.data.url);
      if(alive){extensions.set(r.key,{store:r.group,url:r.data.url,items:items||[]});draw();}
    }catch(err){notify(fmtErr(err));}
  }
  function closeModal(force=false){if(busy&&!force)return;modal=null;layer.hidden=true;dialog.replaceChildren();}
  function showDialog(title,description){
    modal=true;layer.hidden=false;dialog.replaceChildren();
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
    }else{
      const acts=el("div","v7-dialog-actions");
      if(!a.installed){
        acts.append(btn("تثبيت","v7-btn primary",async()=>{
          if(busy)return;busy=true;
          try{await installNative(a);closeModal(true);onSourcesChanged();await refresh();}
          catch(err){notify(fmtErr(err));}finally{busy=false;}
        }));
      }else{
        acts.append(btn("فتح في VANTARA","v7-btn primary",()=>openNative(a)));
        if(!a.builtin)acts.append(btn("حذف","v7-btn danger",()=>askDelete(a,"native")));
      }
      acts.append(btn("رجوع","v7-btn",()=>closeModal()));dialog.append(acts);
    }
  }
  function canOpenRemote(a){
    return a.enabled!==false && supportedCapabilities(a,registry.runtimeName||"pwa")
      .some(c=>["catalog","home","search"].includes(c));
  }
  function openRemote(a){
    if(!canOpenRemote(a))return notify("المصدر لا يوفر كتالوجًا مدعومًا.");
    closeModal();onOpenSource(a);
  }
  function openNative(a){
    closeModal();
    const match=(registry.list?.()||[]).find(x=>x.name===a.name && canOpenRemote(x));
    if(match){onOpenSource(match);return;}
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
        closeModal(true);onSourcesChanged();await refresh();draw();
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
    if(busy)return;
    busy=true;yes.disabled=true;note.textContent="جارٍ فحص الرابط…";
    try{
      let url=new URL(uri);
      if(url.pathname.endsWith("manifest.json")){
        const preview=await registry.inspect(uri);
        note.textContent="الإضافة: "+preview.manifest.name+" · راجع المصدر قبل التثبيت.";
        yes.textContent="تأكيد التثبيت";yes.onclick=async()=>{
          if(busy)return;busy=true;yes.disabled=true;
          try{await registry.install(preview);closeModal(true);await refresh();onSourcesChanged();}
          catch(e){note.textContent=fmtErr(e);}finally{busy=false;yes.disabled=false;}
        };
        return;
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
          matched=true;onSourcesChanged();await refresh();closeModal(true);break;
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
          closeModal(true);await refresh();onSourcesChanged();
        }catch(e){state.textContent=fmtErr(e);}finally{busy=false;}
      });
    }catch(e){note.textContent=fmtErr(e);}
  }
  function navigateBack(){
    if(!layer.hidden){if(!busy)closeModal();return true;}
    if(opened){opened=null;draw();return true;}
    if(tab==="installed"){switchTab("repos");return true;}
    return false;
  }
  root.back=navigateBack;
  root.close=()=>{alive=false;generation++;};
  root.reload=()=>{alive=true;void refresh();};
  search.oninput=()=>{currentSearch=search.value.trim().toLocaleLowerCase();draw();};
  void refresh();draw();
  return root;
}
