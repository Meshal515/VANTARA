import { loadSkipTimes, activeSegment } from '../lib/skip-times.js';
import { glyph } from '../v35/icons.js';
import { createServerSheet } from '../v35/server-sheet.js';
import { createDesktopLobby, openDesktopRoomEntry } from './lobby.js';
import { createOverlayLink } from './overlay-link.js';
const safeMessage=value=>String(value??'تعذر إكمال الطلب').replace(/(?:https?:\/\/|stremio:\/\/)[^\s]+/gi,'[رابط الخدمة]');
const clock=ms=>{const s=Math.max(0,Math.floor((ms??0)/1000));return `${Math.floor(s/3600)?`${Math.floor(s/3600)}:`:''}${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
/** Real native video occupies .desktop-player-video. Chromium controls live in
 * separate rows: Windows child-window airspace cannot support HTML overlays. */
export function installDesktopPlayer({g=globalThis,bridge=g.VantaraDesktop,engine,skipLoader=loadSkipTimes}={}) {
  if(!g.document?.body||typeof bridge?.playerViewport!=='function')return null;
  const doc=g.document;
  let panel,video,status,seek,time,pause,subtitles,audio,source,timing,releaseRoomSurface=null,roomModal=null,roomModalCleanup=null,session=null,position=0,duration=0,paused=false,ready=false,fullscreen=false,observer,previousFocus,revision=0,sourceRevision=0,lobbyUi=null,roomState=null,settings=null,serverSheet=null,entryView=null,playerInfo=null,nextEpisode=null,episodeSelect=null,speed=null,skipButton=null,skipResult=null,skipKey=null,skipController=null;
  // طبقة أدوات الـAPK فوق الفيديو (overlay.js): ما تعرضه يُحفظ هنا ويُرسل إليها
  let link=null,overlayServers=false,overlayRoutes=null,overlayRoutesDone=false,subtitleTrackList=[],audioTrackList=[],speedValue=1,fitValue='fit',volumeValue=100,subDelay=0,subSize=40,subPos=100,subBg='shadow',netInfo=null,skipLabel=null,buffering=false,failed=false,titleText='VANTARA',subtitleCommandRevision=0;
  const node=(tag,text,attrs={})=>{const el=doc.createElement(tag);if(text!=null)el.textContent=text;for(const [key,value]of Object.entries(attrs))el.setAttribute(key,String(value));return el;};
  const tell=(text,error=false)=>{if(status){status.textContent=safeMessage(text);status.dataset.error=String(error);}link?.push(true);};
  const command=async(name,value)=>{if(!session)return;if(!ready){if(!failed)tell('انتظر بدء الفيديو…');return;}const id=session,rev=revision,subtitleChoice=['subtitle-select','subtitle-off','subtitle-load'].includes(name),choice=subtitleChoice?++subtitleCommandRevision:0;try{if(engine.playerCommand)await engine.playerCommand({session:id,command:name,value});else await bridge.playbackCommand({session:id,command:name,value});}catch(error){if(session===id&&revision===rev&&(!subtitleChoice||choice===subtitleCommandRevision))tell(error.message,true);}};
  const viewport=(hidden=false)=>{
    if(!video||!session)return;
    const rect=video.getBoundingClientRect?.();if(!rect)return;
    const width=g.innerWidth??doc.documentElement.clientWidth,height=g.innerHeight??doc.documentElement.clientHeight;
    if(!Number.isFinite(width)||!width||!Number.isFinite(height)||!height)return;
    const id=session,rev=revision;
    void bridge.playerViewport({session:id,x:Math.max(0,rect.x??rect.left),y:Math.max(0,rect.y??rect.top),width:Math.max(0,rect.width),height:Math.max(0,rect.height),viewportWidth:width,viewportHeight:height,hidden:hidden||!!roomState?.visible||!!roomModal||!!settings&&!settings.hidden}).catch(error=>{if(session===id&&revision===rev)tell(error.message,true);});
  };
  const refreshSkip=()=>{
    const segment=activeSegment(skipResult?.timings,position);
    const label=segment?(segment.opening?'تخطي المقدمة':'تخطي النهاية'):null;if(label!==skipLabel){skipLabel=label;link?.push(true);}
    if(skipButton){skipButton.hidden=!segment;skipButton.textContent=segment?.opening?'تخطي المقدمة':'تخطي النهاية';skipButton.onclick=()=>segment&&void command('seek',segment.interval.endMs);}
    if(!playerInfo||playerInfo.section==='cinema'||duration<=0||(!playerInfo.malId&&!playerInfo.anilistId))return;
    const key=`${session}:${playerInfo.episode}:${Math.round(duration/1000)}`;if(skipKey===key)return;
    skipKey=key;skipController?.abort();skipController=new AbortController();
    void skipLoader({malId:playerInfo.malId,anilistId:playerInfo.anilistId,episode:Number(playerInfo.episode),durationMs:duration,signal:skipController.signal}).then(result=>{if(skipKey!==key||!panel)return;skipResult=result;refreshSkip();}).catch(()=>{});
  };
  const episode=async n=>{const id=session;try{await engine.changeEpisode?.({session:id,episode:Number(n)});}catch(error){if(session===id)tell(error.message,true);}};
  const update=()=>{if(!panel)return;pause.innerHTML=glyph(paused?'play':'pause',{size:30,filled:true});pause.setAttribute('aria-label',paused?'تشغيل الفيديو':'إيقاف الفيديو مؤقتًا');seek.max=String(duration||1);seek.value=String(Math.min(position,duration||position));seek.style.setProperty('--seek',`${duration?Math.min(100,position/duration*100):0}%`);seek.disabled=!ready||!duration;time.textContent=`${clock(position)} / ${clock(duration)}`;refreshSkip();link?.push();};
  const closeRoomSheet=()=>{
    const cleanup=roomModalCleanup;roomModalCleanup=null;roomModal?.remove();roomModal=null;
    try{cleanup?.();}catch{}
    serverSheet=null;viewport();
  };
  const dismiss=()=>{link?.close();link=null;overlayServers=false;overlayRoutes=null;skipController?.abort();skipKey=null;skipResult=null;playerInfo=null;viewport(true);roomState=null;lobbyUi?.destroy();lobbyUi=null;roomModal?.remove();roomModal=null;const cleanup=roomModalCleanup;roomModalCleanup=null;try{cleanup?.();}catch{}serverSheet=null;releaseRoomSurface?.();releaseRoomSurface=null;observer?.disconnect();observer=null;revision++;panel?.remove();panel=null;session=null;ready=false;previousFocus?.focus?.();};
  const close=async()=>{const id=session;if(!id)return;engine.leavePlayerRoom?.({session:id});viewport(true);dismiss();try{await Promise.all([engine.closeSession?.({session:id}),bridge.stopPlayback({session:id}),bridge.playerFullscreen?.({enabled:false})]);}catch{}fullscreen=false;};
  const button=(label,action,fn)=>{const b=node('button',label,{'type':'button','data-action':action,'aria-label':label,title:label});b.onclick=fn;return b;};
  const iconButton=(label,action,icon,fn)=>{const b=button(label,action,fn);b.innerHTML=action==='fullscreen'?'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/></svg>':glyph(icon,{size:24});return b;};
  // The native mpv child window hides DOM mounted in the main renderer.
  // Send the live room roster to the transparent controls window instead.
  const overlayPeople=()=>{
    const hub=session&&engine.roomHub?.({session});
    const room=hub?.session?.room;
    if(!room||room.status==='closed')return [];
    return (room.roster??[]).slice(0,24).map(r=>{
      const person=hub.person?.(r.userId);
      return {userId:String(r.userId??''),name:String(r.name||person?.displayName||'صديق'),
        avatarKey:r.avatarKey||person?.avatarKey||null,state:String(r.state||'preparing'),host:!!r.host};
    });
  };
  const overlaySnapshot=()=>{
    const info=playerInfo??{},server=info.server??null,movie=info.section==='cinema'&&!(Number(info.total)>1);
    const code=server?.code??null,q=Number(server?.quality)||null;
    return {title:info.title??titleText,subtitle:movie?'فيلم':`الحلقة ${info.episode??''}`,
      tone:info.section==='cinema'||info.media?.kind==='cinema'?'cinema':'anime',position,duration,paused,ready,buffering,
      status:{text:status?.textContent??'',error:status?.dataset.error==='true'},total:Number(info.total)||0,episode:Number(info.episode)||1,movie,canChangeEpisode:info.canChangeEpisode!==false,
      sources:info.sources??[],candidate:info.candidate??null,quality:q,serverCode:code,subtitles:subtitleTrackList,audio:audioTrackList,speed:speedValue,fit:fitValue,volume:volumeValue,fullscreen,
      skip:skipLabel,net:netInfo,people:overlayPeople(),synced:!!info.synced,subtitleDelay:subDelay,subtitleSize:subSize,subtitlePosition:subPos,subtitleBackground:subBg,together:!!info.together,videoOffsetMs:Number(info.videoOffsetMs)||0,...(overlayServers?{routes:overlayRoutes??[],routesDone:overlayRoutesDone}:{})};
  };
  const switchTo=async(id,find)=>{const rev=revision,choice=++sourceRevision;try{const selected=await find();if(session===id&&revision===rev&&sourceRevision===choice&&selected?.candidate)await engine.switchSource({session:id,candidate:selected.candidate,position});}catch(error){if(session===id&&revision===rev&&sourceRevision===choice)tell(error.message,true);}};
  const overlayCommand=message=>{
    const id=session,value=message.value;if(!id)return;
    switch(message.name){
      case 'retry':void engine.retryPlayback?.({session:id}).catch(error=>tell(error.message,true));break;
      case 'pause':void command('pause',!!value);break;
      case 'seek':if(Number.isFinite(value))void command('seek',Math.max(0,value));break;
      case 'seek-by':if(Number.isFinite(value))void command('seek',Math.max(0,Math.min(duration||position+value,position+value)));break;
      case 'close':void close();break;
      case 'fullscreen':panel?.querySelector('[data-action="fullscreen"]')?.click();break;
      case 'room':engine.openPlayerRoom?.({session:id});break;
      case 'settings':showSettings();break;
      case 'fit':if(value==='fit'||value==='fill'){fitValue=value;void command('video-fit',value);link?.push(true);}break;
      case 'volume':if(Number.isFinite(value)){volumeValue=Math.max(0,Math.min(100,Math.round(value)));void command('volume',volumeValue);link?.push(true);}break;
      case 'speed':if(Number.isFinite(value)){speedValue=value;void command('speed',value);link?.push(true);}break;
      case 'episode':if(Number.isSafeInteger(value))void episode(value);break;
      case 'source':void switchTo(id,async()=>({candidate:String(value)}));break;
      case 'pick':void switchTo(id,()=>engine.pick({session:id,route:String(value)}));break;
      case 'best':void switchTo(id,()=>engine.best({session:id}));break;
      case 'servers-open':overlayServers=true;void refreshServers();break;
      case 'servers-close':overlayServers=false;break;
      case 'subtitle-select':if(Number.isSafeInteger(value))void command('subtitle-select',value);break;
      case 'subtitle-off':void command('subtitle-off');break;
      case 'subtitle-delay':if(Number.isFinite(value)&&Math.abs(value)<=60000){subDelay=value;void command('subtitle-delay',value);link?.push(true);}break;
      case 'subtitle-size':if(Number.isFinite(value)){subSize=Math.max(20,Math.min(80,value));void command('subtitle-size',subSize);link?.push(true);}break;
      case 'subtitle-background':if(value==='shadow'||value==='box'){subBg=value;void command('subtitle-background',value);link?.push(true);}break;
      case 'subtitle-position':if(Number.isFinite(value)&&value>=0&&value<=100){subPos=value;void command('subtitle-position',value);link?.push(true);}break;
      case 'audio-select':if(Number.isSafeInteger(value))void command('audio-select',value);break;
      case 'skip':skipButton?.click();break;
      case 'video-offset':if(Number.isFinite(value)&&Math.abs(value)<=120000&&typeof engine.setVideoOffset==='function')void Promise.resolve(engine.setVideoOffset({session:id,ms:value})).then(()=>sources(),error=>tell(error.message,true));break;
      case 'key':if(typeof value==='string')keyboard({key:value,target:{},preventDefault(){}});break;
    }
  };
  const showSettings=()=>{settings.hidden=false;viewport();settings.querySelector('button')?.focus?.();};

  function ensureStyles(){for(const [id,path]of [['desktop-shared-player-style','../pwa/player/player.css'],['desktop-player-style','./player.css'],['desktop-server-style','../v35/server-sheet.css']])if(!doc.getElementById(id)){const link=node('link',null,{id,rel:'stylesheet',href:new URL(path,import.meta.url).href});doc.head.append(link);}}
  function stepper(input){const wrap=node('div',null,{class:'desktop-player-step',dir:'ltr'});const change=delta=>{input.value=String(Math.max(Number(input.min),Math.min(Number(input.max),Number(input.value)+delta)));input.dispatchEvent(new doc.defaultView.Event('change'));};wrap.append(button('−','timing-minus',()=>change(-.5)),input,button('+','timing-plus',()=>change(.5)));return wrap;}
  function showSheet(build,full=false) {
    closeRoomSheet();
    const layer=node('section',null,{class:'desktop-room-layer',role:'dialog','aria-modal':'true'});
    const body=node('div',null,{class:'desktop-room-body'});
    if(!full){const closeButton=button('إغلاق','room-close',closeRoomSheet);closeButton.classList.add('desktop-room-close');body.append(closeButton);}
    else layer.classList.add('desktop-room-layer--servers');
    layer.append(body);panel.append(layer);roomModal=layer;viewport();
    roomModalCleanup=build(body)??null;return closeRoomSheet;
  }
  async function showServers() {
    const id=session,rev=revision;if(!id)return;
    let state;try{state=await engine.playerState?.({session:id});}catch(error){if(session===id)tell(error.message,true);return;}if(session!==id||revision!==rev)return;
    showSheet(body=>{
      const el=(tag,cls,text)=>{const n=node(tag,text);if(cls)n.className=cls;return n;};
      const pick=async route=>{
        try{const selected=await engine.pick({session:id,route:route.id});if(session!==id||serverSheet!==ui||!selected.candidate)return;
          closeRoomSheet();await engine.switchSource({session:id,candidate:selected.candidate,position});}
        catch(error){tell(error.message,true);}
      };
      const ui=serverSheet=createServerSheet(body,{el,title:state?.title??'VANTARA',kicker:'اختر نسختك',onBack:closeRoomSheet,onPick:pick,
        onBest:async()=>{try{const best=await engine.best({session:id});if(session===id&&serverSheet===ui&&best.candidate){closeRoomSheet();await engine.switchSource({session:id,candidate:best.candidate,position});}}catch(error){tell(error.message,true);}}});
      void refreshServers();
    },true);
  }
  async function refreshServers(){const ui=serverSheet,id=session;if((!ui&&!overlayServers)||!id)return;try{const data=await engine.routes({session:id});if(session!==id)return;if(ui&&serverSheet===ui)ui.update({routes:data.routes,settled:data.done,status:{text:data.done?'':'نجلب السيرفرات…',spin:!data.done}});if(overlayServers){overlayRoutes=data.routes;overlayRoutesDone=!!data.done;link?.push(true);}}catch(error){if(session===id)tell(error.message,true);}}
  async function sources(){const id=session,rev=revision;try{const state=await engine.playerState?.({session:id});if(session!==id||revision!==rev||!source||!state)return;playerInfo=state;if(nextEpisode){nextEpisode.hidden=!(state.total>1);nextEpisode.disabled=state.canChangeEpisode===false||Number(state.episode)>=state.total;nextEpisode.onclick=()=>void episode(Number(state.episode)+1);}if(episodeSelect){episodeSelect.parentElement.hidden=!(state.total>1);episodeSelect.disabled=state.canChangeEpisode===false;episodeSelect.replaceChildren();for(let n=1;n<=Math.min(3000,state.total||0);n++){const o=node('option',`الحلقة ${n}`,{value:n});if(n===Number(state.episode))o.selected=true;episodeSelect.append(o);}}if(speed)speed.disabled=!!state.synced;refreshSkip();panel.dataset.tone=state.section==='cinema'||state.media?.kind==='cinema'?'cinema':'anime';const heading=panel.querySelector('header h2');if(heading)heading.textContent=state.title??heading.textContent;source.replaceChildren();for(const item of state.sources??[]){const o=node('option',item.label,{value:item.id});if(item.id===state.candidate)o.setAttribute('selected','');source.append(o);}source.disabled=(state.sources?.length??0)<2;
      if(timing){timing.disabled=!state.together||typeof engine.setVideoOffset!=='function';timing.value=String((state.videoOffsetMs??0)/1000);}
      link?.push(true);
    }catch{}}
  function open(event){
    if(panel&&session===event.session){revision++;skipController?.abort();skipKey=null;skipResult=null;duration=0;ready=false;failed=false;tell('');void sources();return;}
    dismiss();previousFocus=doc.activeElement;session=event.session;position=0;duration=0;paused=false;ready=false;failed=false;buffering=false;netInfo=null;skipLabel=null;subtitleTrackList=[];audioTrackList=[];speedValue=1;fitValue='fit';subDelay=0;subSize=40;subPos=100;subBg='shadow';titleText=event.title??'VANTARA';
    ensureStyles();
    panel=node('section',null,{class:'desktop-player pwa-player pp--shown v35','aria-label':'مشغل VANTARA'});
    const header=node('header');header.append(iconButton('عودة','close','back',()=>void close()),node('h2',event.title??'VANTARA'));
    header.append(iconButton('شاهد مع أصدقائك','room','users',()=>engine.openPlayerRoom?.({session})),iconButton('ملء الشاشة','fullscreen','sidebar',async()=>{const enabled=!fullscreen,id=session;try{await bridge.playerFullscreen({enabled});fullscreen=enabled;viewport();}catch(error){if(session===id)tell(error.message,true);}link?.push(true);}));
    header.append(iconButton('خيارات المشغل','menu','more',showSettings));
    video=node('div',null,{class:'desktop-player-video','aria-label':'الفيديو'});video.append(node('div','يجهز الفيديو…',{class:'desktop-player-placeholder'}));
    const controls=node('div',null,{class:'desktop-player-controls'}),row=node('div',null,{class:'desktop-player-row'});
    pause=button('إيقاف مؤقت','pause',()=>void command('pause',!paused));
    seek=node('input',null,{type:'range',min:0,max:1,step:1000,'aria-label':'موضع الفيديو','data-control':'seek',class:'desktop-player-seek'});seek.onchange=()=>void command('seek',Number(seek.value));
    time=node('span',null,{class:'desktop-player-time'});row.classList.add('desktop-player-progress');row.append(seek,time);controls.append(row);
    const transport=node('div',null,{class:'desktop-player-transport'});pause.classList.add('desktop-player-play');
    transport.append(button('−10 ث','back',()=>void command('seek',Math.max(0,position-10000))),pause,button('+10 ث','forward',()=>void command('seek',Math.min(duration||position+10000,position+10000))));
    const tools=node('div',null,{class:'desktop-player-tools'});tools.append(iconButton('اختر السيرفر','servers','server',()=>void showServers()),iconButton('الترجمة والصوت','tracks','translate',showSettings),iconButton('إعدادات المشغل','settings','settings',showSettings));
    nextEpisode=iconButton('الحلقة التالية','next-episode','play',()=>{});nextEpisode.hidden=true;tools.append(nextEpisode);skipButton=button('تخطي المقدمة','skip-segment',()=>{});skipButton.hidden=true;skipButton.classList.add('desktop-player-skip');transport.append(tools,skipButton);controls.append(transport);
    settings=node('section',null,{class:'desktop-player-settings',role:'dialog','aria-label':'إعدادات المشغل'});settings.hidden=true;const settingsClose=iconButton('إغلاق الإعدادات','settings-close','close',()=>{settings.hidden=true;viewport();});settings.append(settingsClose,node('h2','إعدادات المشغل'),button('شاهد مع أصدقائك','invite',()=>{settings.hidden=true;viewport();engine.openPlayerRoom?.({session});}));panel.append(settings);
    const tracks=node('div',null,{class:'desktop-player-row'});
    const select=(label,key)=>{const l=node('label',label),s=node('select',null,{'aria-label':label,'data-control':key});l.append(s);tracks.append(l);return s;};
    episodeSelect=select('الحلقات','episodes');episodeSelect.onchange=()=>void episode(episodeSelect.value);
    source=select('المصدر والجودة','source');source.onchange=async()=>{const id=session;source.disabled=true;try{await engine.switchSource({session:id,candidate:source.value,position});}catch(error){tell(error.message,true);}finally{if(session===id)void sources();}};
    audio=select('الصوت','audio');audio.onchange=()=>void command('audio-select',Number(audio.value));
    subtitles=select('الترجمة','subtitle');subtitles.append(node('option','إيقاف الترجمة',{value:'off'}));subtitles.onchange=()=>void command(subtitles.value==='off'?'subtitle-off':'subtitle-select',subtitles.value==='off'?undefined:Number(subtitles.value));
    const timingLabel=node('label','توقيت الفيديو (ث)');
    timing=node('input',null,{type:'number',min:-120,max:120,step:.25,value:0,'aria-label':'تقديم أو تأخير نسختي مع الأصدقاء بالثواني','data-control':'video-offset'});
    timing.disabled=true;
    timing.onchange=async()=>{const id=session;const ms=Number(timing.value)*1000;
      if(!Number.isFinite(ms)||Math.abs(ms)>120000){tell('توقيت الفيديو من −120 إلى +120 ثانية',true);return;}
      try {await engine.setVideoOffset({session:id,ms});if(session===id)void sources();}
      catch(error){tell(error.message,true);if(session===id)void sources();}
    };
    timingLabel.append(stepper(timing));tracks.append(timingLabel);
    const delayLabel=node('label','تأخير الترجمة (ث)'),delay=node('input',null,{type:'number',min:-60,max:60,step:.25,value:0,'aria-label':'تأخير الترجمة بالثواني','data-control':'subtitle-delay'});delay.onchange=()=>void command('subtitle-delay',Number(delay.value)*1000);delayLabel.append(stepper(delay));tracks.append(delayLabel);
    speed=select('سرعة التشغيل','speed');for(const n of [.5,.75,1,1.25,1.5,1.75,2]){const o=node('option',`${n}×`,{value:n});if(n===1)o.selected=true;speed.append(o);}speed.onchange=()=>void command('speed',Number(speed.value));
    const fit=select('حجم العرض','fit');fit.append(node('option','احتواء',{value:'fit'}),node('option','ملء',{value:'fill'}));fit.onchange=()=>void command('video-fit',fit.value);
    for(const [label,key,min,max,value] of [['حجم الترجمة','subtitle-size',20,80,40],['موضع الترجمة','subtitle-position',0,100,100]]){const l=node('label',label),input=node('input',null,{type:'range',min,max,value,'aria-label':label,'data-control':key});input.onchange=()=>void command(key,Number(input.value));l.append(input);tracks.append(l);}
    const volumeLabel=node('label','الصوت'),volume=node('input',null,{type:'range',min:0,max:100,value:100,'aria-label':'مستوى الصوت'});volume.onchange=()=>void command('volume',Number(volume.value));volumeLabel.append(volume);tracks.append(volumeLabel);settings.append(tracks);
    const external=node('details'),summary=node('summary','تحميل ترجمة خارجية');external.append(summary);
    const form=node('form',null,{class:'desktop-player-url'}),url=node('input',null,{type:'url',required:'',placeholder:'https://…/subtitles.srt','aria-label':'رابط ترجمة HTTPS'}),submit=node('button','تحميل',{type:'submit'});form.append(url,submit);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await command('subtitle-load',{url:url.value,lang:'ar',label:'ترجمة خارجية',select:true});}finally{submit.disabled=false;}};external.append(form);external.ontoggle=()=>viewport();settings.append(external);
    status=node('div','',{class:'desktop-player-status',role:'status','aria-live':'polite'});controls.append(status);
    panel.append(header,video,controls);
    const lobby=node('div',null,{class:'pp-lobby desktop-together-lobby'});lobby.hidden=true;panel.append(lobby);
    lobbyUi=createDesktopLobby({host:lobby,engine,session,chooseServer:()=>void showServers(),leave:()=>void close(),visibility:visible=>{panel.classList.toggle('pp--lobby',visible);viewport();}});
    doc.body.append(panel);
    {const id=session;link=createOverlayLink({bridge,session:id,snapshot:overlaySnapshot,onCommand:overlayCommand});
      void link?.open().then(ok=>{if(ok&&session===id&&panel){panel.classList.add('desktop-player--overlay');viewport();}});}
    const hub=engine.roomHub?.({session});
    if(hub?.useSurface){
      releaseRoomSurface=hub.useSurface({
        openSheet:build=>showSheet(build),
        closeSheet:closeRoomSheet,
        toast:message=>tell(message),
      });
    }
    update();void sources();
    if(g.ResizeObserver){observer=new g.ResizeObserver(()=>viewport());observer.observe(video);}
    viewport();header.querySelector('button')?.focus?.();
  }
  const tracks=(select,items,off=false)=>{if(!select)return;select.replaceChildren();if(off)select.append(node('option','إيقاف الترجمة',{value:'off'}));for(const track of items){const option=node('option',`${track.label}${track.lang&&track.lang!=='und'?` · ${track.lang}`:''}`,{value:track.id});if(track.selected)option.setAttribute('selected','');select.append(option);}select.disabled=!items.length;};
  const off=bridge.onEvent(event=>{
    if(event.type==='window/fullscreen'){fullscreen=event.enabled===true;viewport();g.requestAnimationFrame?.(()=>viewport());link?.push(true);return;}
    if(event.type==='playback/preparing')open(event);
    if(event.session!==session)return;
    if(event.type==='playback/ready'){ready=true;failed=false;viewport();video.querySelector('.desktop-player-placeholder')?.remove();tell('');update();}
    if(event.type==='playback/action'){if(event.action==='fullscreen')panel.querySelector('[data-action="fullscreen"]').click();if(event.action==='close')keyboard({key:'Escape',target:{},preventDefault(){}});}
    if(['playback/progress','playback/state','playback/pause'].includes(event.type)){if(typeof event.buffering==='boolean')buffering=event.buffering;if(Number.isFinite(event.downloadSpeed)||Number.isFinite(event.peers))netInfo={kbps:Number.isFinite(event.downloadSpeed)?event.downloadSpeed/1024:netInfo?.kbps??null,peers:Number.isFinite(event.peers)?event.peers:netInfo?.peers??null};if(event.type==='playback/pause')link?.push(true);if(Number.isFinite(event.position))position=event.position;if(Number.isFinite(event.duration))duration=event.duration;if(typeof event.paused==='boolean')paused=event.paused;update();if(event.buffering)tell('ينتظر بيانات الفيديو…');else if(ready)tell('');}
    // Technical torrent stages stay in diagnostics; the player uses one quiet loading indicator.
    if(event.type==='playback/stage'||event.type==='playback/retrying')return;
    if(event.type==='playback/subtitles'){subtitleTrackList=(event.tracks??[]).map(({id,label,lang,selected})=>({id,label,lang,selected}));link?.push(true);tracks(subtitles,event.tracks??[],true);if(event.message)tell(event.message,true);}
    if(event.type==='playback/audio'){audioTrackList=(event.tracks??[]).map(({id,label,lang,selected})=>({id,label,lang,selected}));link?.push(true);tracks(audio,event.tracks??[]);}
    if(event.type==='playback/error'){ready=false;failed=true;tell(event.message,true);viewport();update();}
    if(event.type==='playback/closed'){if(failed||roomState?.visible&&roomState.failed){viewport();return;}viewport(true);dismiss();if(fullscreen){fullscreen=false;void bridge.playerFullscreen({enabled:false});}}
  });
  const routeListener=engine.addListener?.('route',event=>{if(event?.session&&event.session!==session)return;void sources();void refreshServers();});
  const preparedListener=engine.addListener?.('prepared',event=>{if(event?.session===session){void sources();void refreshServers();}});
  const togetherListener=engine.addListener?.('desktopTogether',event=>{
    if(event.closed){if(event.session===session){roomState=null;void lobbyUi?.update({visible:false});viewport();}return;}
    if(!panel&&event.visible)open({session:event.session,title:event.media?.title??'VANTARA'});
    if(event.session!==session)return;
    roomState=event;void lobbyUi?.update(event);void sources();
  });
  const entryListener=engine.addListener?.('desktopRoomEntry',event=>{
    entryView?.destroy();if(panel)void close();ensureStyles();
    entryView=openDesktopRoomEntry({document:doc,...event});
  });
  const noticeListener=engine.addListener?.('desktopNotice',event=>{if(event.session===session)tell(event.message,true);});
  const keyboard=e=>{if(entryView?.active&&e.key==='Escape'){e.preventDefault();entryView.leave();return;}if(!panel||/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName))return;if([' ','ArrowLeft','ArrowRight','f','F','F11','Escape'].includes(e.key))e.preventDefault();if(e.key==='F11'){panel.querySelector('[data-action="fullscreen"]')?.click();return;}if(e.key===' ')void command('pause',!paused);if(e.key==='ArrowLeft')void command('seek',Math.max(0,position-10000));if(e.key==='ArrowRight')void command('seek',Math.min(duration||position+10000,position+10000));if(e.key==='f'||e.key==='F')panel.querySelector('[data-action="fullscreen"]').click();if(e.key==='Escape'&&roomModal){closeRoomSheet();return;}if(e.key==='Escape'&&settings&&!settings.hidden){settings.hidden=true;viewport();return;}if(e.key==='Escape')fullscreen?panel.querySelector('[data-action="fullscreen"]').click():void close();};
  g.addEventListener?.('keydown',keyboard);g.addEventListener?.('resize',viewport);
  return {close,dispose(){entryView?.destroy();void close();off?.();void routeListener?.remove?.();void preparedListener?.remove?.();void togetherListener?.remove?.();void noticeListener?.remove?.();void entryListener?.remove?.();g.removeEventListener?.('keydown',keyboard);g.removeEventListener?.('resize',viewport);}};
}
