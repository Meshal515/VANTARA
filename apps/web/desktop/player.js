const safeMessage=value=>String(value??'تعذر إكمال الطلب').replace(/(?:https?:\/\/|stremio:\/\/)[^\s]+/gi,'[رابط الخدمة]');
const clock=ms=>{const s=Math.max(0,Math.floor((ms??0)/1000));return `${Math.floor(s/3600)?`${Math.floor(s/3600)}:`:''}${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
const styles=`
.desktop-player{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;background:#08080a;color:#f3f4f8;direction:rtl;font-family:inherit}
.desktop-player header{display:flex;align-items:center;gap:14px;padding:12px 22px;min-height:56px;box-sizing:border-box;background:#111116}
.desktop-player h2{font-size:17px;margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.desktop-player-video{flex:1;min-height:80px;background:#000;position:relative}
.desktop-player-placeholder{display:grid;place-content:center;height:100%;color:#aba7bd}
.desktop-player-controls{flex:none;padding:12px 22px 18px;background:#111116;border-top:1px solid #28242f;display:grid;gap:10px;max-height:44vh;overflow:auto}
.desktop-player-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.desktop-player label{display:flex;align-items:center;gap:8px;color:#bfb9cf;font-size:13px}
.desktop-player button,.desktop-player select,.desktop-player input[type=url],.desktop-player input[type=number]{background:#201b2a;color:#f3f4f8;border:1px solid #44364f;border-radius:9px;padding:8px 12px;font:inherit;max-width:100%}
.desktop-player button{cursor:pointer}.desktop-player button:focus-visible,.desktop-player input:focus-visible,.desktop-player select:focus-visible{outline:2px solid #b995ff;outline-offset:2px}
.desktop-player button:disabled{opacity:.45;cursor:default}.desktop-player input[type=range]{accent-color:#aa87f1;direction:ltr;min-width:100px}
.desktop-player-seek{flex:1}.desktop-player-time{direction:ltr;font-variant-numeric:tabular-nums;font-size:13px}
.desktop-player-status{min-height:20px;color:#c5bdd5;font-size:13px}.desktop-player-status[data-error=true]{color:#ff8899}
.desktop-player-url{display:flex;gap:8px;margin-top:8px}.desktop-player-url input{flex:1;min-width:160px;direction:ltr}
@media(max-height:650px){.desktop-player header{min-height:48px;padding:8px 16px}.desktop-player-controls{padding:8px 16px;gap:6px}.desktop-player button,.desktop-player select{padding:5px 9px}}
`;
/** Real native video occupies .desktop-player-video. Chromium controls live in
 * separate rows: Windows child-window airspace cannot support HTML overlays. */
export function installDesktopPlayer({g=globalThis,bridge=g.VantaraDesktop,engine}={}) {
  if(!g.document?.body||typeof bridge?.playerViewport!=='function')return null;
  const doc=g.document;
  let panel,video,status,seek,time,pause,subtitles,audio,source,session=null,position=0,duration=0,paused=false,ready=false,fullscreen=false,observer,previousFocus,revision=0;
  const node=(tag,text,attrs={})=>{const el=doc.createElement(tag);if(text!=null)el.textContent=text;for(const [key,value]of Object.entries(attrs))el.setAttribute(key,String(value));return el;};
  const tell=(text,error=false)=>{if(status){status.textContent=safeMessage(text);status.dataset.error=String(error);}};
  const command=async(name,value)=>{if(!session)return;try{if(engine.playerCommand)await engine.playerCommand({session,command:name,value});else await bridge.playbackCommand({session,command:name,value});}catch(error){tell(error.message,true);}};
  const viewport=(hidden=false)=>{
    if(!video||!session)return;
    const rect=video.getBoundingClientRect?.();if(!rect)return;
    const width=g.innerWidth??doc.documentElement.clientWidth,height=g.innerHeight??doc.documentElement.clientHeight;
    if(!Number.isFinite(width)||!width||!Number.isFinite(height)||!height)return;
    void bridge.playerViewport({session,x:Math.max(0,rect.x??rect.left),y:Math.max(0,rect.y??rect.top),width:Math.max(0,rect.width),height:Math.max(0,rect.height),viewportWidth:width,viewportHeight:height,hidden}).catch(error=>tell(error.message,true));
  };
  const update=()=>{if(!panel)return;pause.textContent=paused?'تشغيل':'إيقاف مؤقت';pause.setAttribute('aria-label',paused?'تشغيل الفيديو':'إيقاف الفيديو مؤقتًا');seek.max=String(duration||1);seek.value=String(Math.min(position,duration||position));seek.disabled=!ready||!duration;time.textContent=`${clock(position)} / ${clock(duration)}`;};
  const dismiss=()=>{observer?.disconnect();observer=null;revision++;panel?.remove();panel=null;session=null;ready=false;previousFocus?.focus?.();};
  const close=async()=>{const id=session;if(!id)return;viewport(true);dismiss();try{await Promise.all([engine.closeSession?.({session:id}),bridge.stopPlayback({session:id}),bridge.playerFullscreen?.({enabled:false})]);}catch{}fullscreen=false;};
  const button=(label,action,fn)=>{const b=node('button',label,{'type':'button','data-action':action});b.onclick=fn;return b;};
  async function sources(){const id=session,rev=revision;try{const state=await engine.playerState?.({session:id});if(session!==id||revision!==rev||!source||!state)return;source.replaceChildren();for(const item of state.sources??[]){const o=node('option',item.label,{value:item.id});if(item.id===state.candidate)o.setAttribute('selected','');source.append(o);}source.disabled=(state.sources?.length??0)<2;}catch{}}
  function open(event){
    if(panel&&session===event.session){ready=false;tell('يجهز المصدر الجديد…');void sources();return;}
    dismiss();previousFocus=doc.activeElement;session=event.session;position=0;duration=0;paused=false;ready=false;
    if(!doc.querySelector('#desktop-player-style')){const s=node('style',styles,{id:'desktop-player-style'});doc.head?.append(s);}
    panel=node('section',null,{class:'desktop-player','aria-label':'مشغل VANTARA'});
    const header=node('header');header.append(button('عودة','close',()=>void close()),node('h2',event.title??'VANTARA'));
    header.append(button('الغرفة','room',()=>engine.openPlayerRoom?.({session})),button('ملء الشاشة','fullscreen',async()=>{fullscreen=!fullscreen;try{await bridge.playerFullscreen({enabled:fullscreen});viewport();}catch(error){tell(error.message,true);}}));
    video=node('div',null,{class:'desktop-player-video','aria-label':'الفيديو'});video.append(node('div','يجهز الفيديو…',{class:'desktop-player-placeholder'}));
    const controls=node('div',null,{class:'desktop-player-controls'}),row=node('div',null,{class:'desktop-player-row'});
    pause=button('إيقاف مؤقت','pause',()=>void command('pause',!paused));
    seek=node('input',null,{type:'range',min:0,max:1,step:1000,'aria-label':'موضع الفيديو','data-control':'seek',class:'desktop-player-seek'});seek.onchange=()=>void command('seek',Number(seek.value));
    time=node('span',null,{class:'desktop-player-time'});row.append(pause,button('−10 ث','back',()=>void command('seek',Math.max(0,position-10000))),button('+10 ث','forward',()=>void command('seek',Math.min(duration||position+10000,position+10000))),seek,time);controls.append(row);
    const tracks=node('div',null,{class:'desktop-player-row'});
    const select=(label,key)=>{const l=node('label',label),s=node('select',null,{'aria-label':label,'data-control':key});l.append(s);tracks.append(l);return s;};
    source=select('المصدر والجودة','source');source.onchange=async()=>{const id=session;source.disabled=true;try{await engine.switchSource({session:id,candidate:source.value,position});}catch(error){tell(error.message,true);}finally{if(session===id)void sources();}};
    audio=select('الصوت','audio');audio.onchange=()=>void command('audio-select',Number(audio.value));
    subtitles=select('الترجمة','subtitle');subtitles.append(node('option','إيقاف الترجمة',{value:'off'}));subtitles.onchange=()=>void command(subtitles.value==='off'?'subtitle-off':'subtitle-select',subtitles.value==='off'?undefined:Number(subtitles.value));
    const delayLabel=node('label','تأخير الترجمة (ث)'),delay=node('input',null,{type:'number',min:-60,max:60,step:.25,value:0,'aria-label':'تأخير الترجمة بالثواني','data-control':'subtitle-delay'});delay.onchange=()=>void command('subtitle-delay',Number(delay.value)*1000);delayLabel.append(delay);tracks.append(delayLabel);
    const volumeLabel=node('label','الصوت'),volume=node('input',null,{type:'range',min:0,max:100,value:100,'aria-label':'مستوى الصوت'});volume.onchange=()=>void command('volume',Number(volume.value));volumeLabel.append(volume);tracks.append(volumeLabel);controls.append(tracks);
    const external=node('details'),summary=node('summary','تحميل ترجمة خارجية');external.append(summary);
    const form=node('form',null,{class:'desktop-player-url'}),url=node('input',null,{type:'url',required:'',placeholder:'https://…/subtitles.srt','aria-label':'رابط ترجمة HTTPS'}),submit=node('button','تحميل',{type:'submit'});form.append(url,submit);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await command('subtitle-load',{url:url.value,lang:'ar',label:'ترجمة خارجية',select:true});}finally{submit.disabled=false;}};external.append(form);external.ontoggle=()=>viewport();controls.append(external);
    status=node('div','يبدأ المحرك ويجهز بيانات الفيديو…',{class:'desktop-player-status',role:'status','aria-live':'polite'});controls.append(status);
    panel.append(header,video,controls);doc.body.append(panel);update();void sources();
    if(g.ResizeObserver){observer=new g.ResizeObserver(()=>viewport());observer.observe(video);}
    viewport();header.querySelector('button')?.focus?.();
  }
  const tracks=(select,items,off=false)=>{if(!select)return;select.replaceChildren();if(off)select.append(node('option','إيقاف الترجمة',{value:'off'}));for(const track of items){const option=node('option',`${track.label}${track.lang&&track.lang!=='und'?` · ${track.lang}`:''}`,{value:track.id});if(track.selected)option.setAttribute('selected','');select.append(option);}select.disabled=!items.length;};
  const off=bridge.onEvent(event=>{
    if(event.type==='playback/preparing')open(event);
    if(event.session!==session)return;
    if(event.type==='playback/ready'){ready=true;video.querySelector('.desktop-player-placeholder')?.remove();tell('');update();}
    if(event.type==='playback/action'){if(event.action==='fullscreen')panel.querySelector('[data-action="fullscreen"]').click();if(event.action==='close')void close();}
    if(['playback/progress','playback/state','playback/pause'].includes(event.type)){if(Number.isFinite(event.position))position=event.position;if(Number.isFinite(event.duration))duration=event.duration;if(typeof event.paused==='boolean')paused=event.paused;update();if(event.buffering)tell('ينتظر بيانات الفيديو…');else if(ready)tell('');}
    if(event.type==='playback/stage'){const text={'engine-start':'يبدأ محرك التورنت…',metadata:'يجلب بيانات المغناطيس…','file-selected':'حدد ملف الفيديو المطلوب','downloading':'يتصل بالسرب وينزل الفيديو…','player-start':'يفتح المشغل داخل VANTARA…','first-frame':'يفك ترميز أول إطار…'}[event.stage];if(text)tell(text);}
    if(event.type==='playback/retrying')tell(event.message);
    if(event.type==='playback/subtitles'){tracks(subtitles,event.tracks??[],true);if(event.message)tell(event.message,true);}
    if(event.type==='playback/audio')tracks(audio,event.tracks??[]);
    if(event.type==='playback/error'){ready=false;tell(event.message,true);viewport(true);update();}
    if(event.type==='playback/closed'){viewport(true);dismiss();if(fullscreen){fullscreen=false;void bridge.playerFullscreen({enabled:false});}}
  });
  const routeListener=engine.addListener?.('route',()=>void sources());
  const keyboard=e=>{if(!panel||/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName))return;if([' ','ArrowLeft','ArrowRight','f','F','Escape'].includes(e.key))e.preventDefault();if(e.key===' ')void command('pause',!paused);if(e.key==='ArrowLeft')void command('seek',Math.max(0,position-10000));if(e.key==='ArrowRight')void command('seek',Math.min(duration||position+10000,position+10000));if(e.key==='f'||e.key==='F')panel.querySelector('[data-action="fullscreen"]').click();if(e.key==='Escape')fullscreen?panel.querySelector('[data-action="fullscreen"]').click():void close();};
  g.addEventListener?.('keydown',keyboard);g.addEventListener?.('resize',viewport);
  return {close,dispose(){void close();off?.();void routeListener?.remove?.();g.removeEventListener?.('keydown',keyboard);g.removeEventListener?.('resize',viewport);}};
}
