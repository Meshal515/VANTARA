import {expect,it,vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {installDesktopPlayer} from './player.js';
function fixture({skipLoader}={}){
 const {document}=parseHTML('<html><body><button id="previous">عمل</button></body></html>');const callbacks=[],commands=[],listeners=new Map();
 const bridge={playerViewport:vi.fn(async()=>true),playerFullscreen:vi.fn(async()=>true),playbackCommand:vi.fn(async arg=>commands.push(arg)),stopPlayback:vi.fn(async()=>{}),onEvent:fn=>{callbacks.push(fn);return()=>{};}};
 const engine={addListener:(name,fn)=>{listeners.set(name,fn);return{remove(){}};},playerState:async()=>({title:'فيلم',candidate:'source-1',sources:[{id:'source-1',label:'مصدر · 1080p'}]}),switchSource:vi.fn(async()=>{}),closeSession:vi.fn(async()=>{})};
 document.defaultView.HTMLElement.prototype.getBoundingClientRect=function(){return{x:0,y:64,width:1000,height:600};};
 const g={document,innerWidth:1000,innerHeight:800,addEventListener:vi.fn(),removeEventListener:vi.fn()};const player=installDesktopPlayer({g,bridge,engine,skipLoader});
 return{document,bridge,engine,commands,player,event:e=>callbacks.forEach(fn=>fn(e)),lobby:e=>listeners.get('desktopTogether')?.(e),route:e=>listeners.get('route')?.(e)};
}
it('opens an in-app native viewport with controls outside it and sends pause/seek safely',async()=>{
 const f=fixture();f.event({type:'playback/preparing',session:'one',title:'فيلم'});await Promise.resolve();
 const panel=f.document.querySelector('.desktop-player');expect(panel).toBeTruthy();expect(panel.querySelector('.desktop-player-video')).toBeTruthy();
 expect(panel.querySelector('.desktop-player-video .desktop-player-controls')).toBeNull();
 f.event({type:'playback/ready',session:'one',embedded:true});f.event({type:'playback/state',session:'one',position:5000,duration:60000,paused:false});
 panel.querySelector('[data-action="pause"]').click();await Promise.resolve();expect(f.commands).toContainEqual({session:'one',command:'pause',value:true});
 const seek=panel.querySelector('[data-control="seek"]');seek.value='20000';seek.dispatchEvent(new f.document.defaultView.Event('change'));await Promise.resolve();expect(f.commands).toContainEqual({session:'one',command:'seek',value:20000});
});
it('ignores events from an old session, reports errors, and closes native playback',async()=>{
 const f=fixture();f.event({type:'playback/preparing',session:'one'});f.event({type:'playback/preparing',session:'two'});
 f.event({type:'playback/closed',session:'one'});expect(f.document.querySelector('.desktop-player')).toBeTruthy();
 f.event({type:'playback/error',session:'two',message:'تعذر الإطار'});expect(f.document.querySelector('.desktop-player').textContent).toContain('تعذر الإطار');
 f.document.querySelector('[data-action="close"]').click();await Promise.resolve();expect(f.engine.closeSession).toHaveBeenCalledWith({session:'two'});expect(f.bridge.stopPlayback).toHaveBeenCalledWith({session:'two'});expect(f.document.querySelector('.desktop-player')).toBeNull();
});
it('audio, subtitle, delay and fullscreen controls use only constrained bridge commands',async()=>{
 const f=fixture();f.event({type:'playback/preparing',session:'one'});f.event({type:'playback/ready',session:'one',embedded:true});
 f.event({type:'playback/audio',session:'one',tracks:[{id:2,label:'ياباني',selected:true}]});f.event({type:'playback/subtitles',session:'one',tracks:[{id:3,label:'عربية',selected:true}]});
 const panel=f.document.querySelector('.desktop-player');expect(panel.textContent).toContain('ياباني');expect(panel.textContent).toContain('عربية');
 const audio=panel.querySelector('[data-control="audio"]');audio.dispatchEvent(new f.document.defaultView.Event('change'));
 panel.querySelector('[data-action="fullscreen"]').click();await Promise.resolve();expect(f.commands).toContainEqual({session:'one',command:'audio-select',value:2});expect(f.bridge.playerFullscreen).toHaveBeenCalledWith({enabled:true});
});

it('manual video timing appears above subtitle delay and changes only local room offset',async()=>{
 const f=fixture();
 f.engine.playerState=async()=>({candidate:'source-1',sources:[],together:true,videoOffsetMs:-30000});
 f.engine.setVideoOffset=vi.fn(async()=>({videoOffsetMs:-31000}));
 f.event({type:'playback/preparing',session:'one',title:'فيلم'});
 await Promise.resolve();await Promise.resolve();
 const panel=f.document.querySelector('.desktop-player');
 const timing=panel.querySelector('[data-control="video-offset"]');
 const subtitles=panel.querySelector('[data-control="subtitle-delay"]');
 expect(timing).toBeTruthy();expect(subtitles).toBeTruthy();
 expect(panel.textContent.indexOf('توقيت الفيديو')).toBeLessThan(panel.textContent.indexOf('تأخير الترجمة'));
 timing.value='-31';timing.dispatchEvent(new f.document.defaultView.Event('change'));
 await Promise.resolve();
 expect(f.engine.setVideoOffset).toHaveBeenCalledWith({session:'one',ms:-31000});
 expect(f.commands.some(c=>c.command==='seek')).toBe(false);
});

it('يعرض ورقة دعوة الأصدقاء فوق المشغل دون إغلاق الفيديو أو تغيير المصدر',async()=>{
  const f=fixture();let surface;
  f.engine.roomHub=()=>({useSurface:ui=>{surface=ui;return()=>{};}});
  f.engine.openPlayerRoom=vi.fn(()=>surface.openSheet(body=>{
    const text=f.document.createElement('p');text.textContent='ادع منصور إلى الحلقة';body.append(text);
  }));
  f.event({type:'playback/preparing',session:'one',title:'مسلسل'});
  f.event({type:'playback/ready',session:'one',embedded:true});
  f.document.querySelector('[data-action="room"]').click();
  expect(f.engine.openPlayerRoom).toHaveBeenCalledWith({session:'one'});
  expect(f.document.querySelector('.desktop-room-layer')?.textContent).toContain('ادع منصور');
  expect(f.document.querySelector('.desktop-player')).toBeTruthy();
  expect(f.bridge.stopPlayback).not.toHaveBeenCalled();
  f.document.querySelector('[data-action="room-close"]').click();
  expect(f.document.querySelector('.desktop-room-layer')).toBeNull();
  expect(f.document.querySelector('.desktop-player')).toBeTruthy();
});

it('shows the cinematic room before native playback and hides its HWND until the room starts',async()=>{
 const f=fixture();vi.stubGlobal('document',f.document);vi.stubGlobal('Image',class{constructor(){return f.document.createElement('img');}});
 const avatar=vi.fn(person=>{const img=f.document.createElement('img');img.src=person.avatarKey;return img;});
 const start=vi.fn(),setVideoOffset=vi.fn();
 f.engine.roomHub=()=>({session:{media:{kind:'cinema',format:'movie',title:'فيلم التجربة',banner:'https://images.example/banner.jpg',logo:'https://images.example/logo.png'}},avatar,person:id=>({userId:id,displayName:'منصور',avatarKey:'/avatars/mansour.webp'})});
 f.engine.playerState=async()=>({title:'فيلم التجربة',section:'cinema',media:{kind:'cinema',format:'movie',title:'فيلم التجربة',banner:'https://images.example/banner.jpg'},candidate:'source-1',sources:[{id:'source-1',label:'مصدر · 1080p'}]});
 f.lobby({session:'one',visible:true,host:true,prepared:false,connection:'live',me:'host',invited:['mansour'],roster:[],start,setVideoOffset});
 await new Promise(resolve=>setTimeout(resolve,0));
 const lobby=f.document.querySelector('.desktop-player .pp-lobby');
 expect(lobby?.querySelector('.pl-title')?.textContent).toBe('فيلم التجربة');
 expect(lobby?.querySelector('.pl-bg img')?.src).toBe('https://images.example/banner.jpg');
 expect(lobby?.textContent).toContain('اختر السيرفر');expect(lobby?.querySelector('.pl-go[aria-label="ابدأ للجميع"]').disabled).toBe(true);
 expect(avatar).toHaveBeenCalledWith(expect.objectContaining({displayName:'منصور',avatarKey:'/avatars/mansour.webp'}),44);
 f.event({type:'playback/preparing',session:'one',title:'فيلم التجربة'});
 f.event({type:'playback/ready',session:'one',embedded:true});
 expect(f.bridge.playerViewport).toHaveBeenLastCalledWith(expect.objectContaining({hidden:true}));
 f.lobby({session:'one',visible:true,host:true,prepared:true,connection:'live',me:'host',invited:[],roster:[],start,setVideoOffset});
 await new Promise(resolve=>setTimeout(resolve,0));
 f.document.querySelector('.pl-go[aria-label="ابدأ للجميع"]').click();expect(start).toHaveBeenCalledOnce();
 f.lobby({session:'one',visible:false,prepared:true,roster:[]});
 expect(f.document.querySelector('.pp-lobby').hidden).toBe(true);
 expect(f.bridge.playerViewport).toHaveBeenLastCalledWith(expect.objectContaining({hidden:false}));
 f.player.dispose();vi.unstubAllGlobals();
});
it('opens the shared server sheet and keeps settings out of the video until requested',async()=>{
 const f=fixture();vi.stubGlobal('document',f.document);
 let extra=[];f.engine.routes=async()=>({done:true,routes:[...extra,{id:'route-1',state:'READY',quality:1080,sourceId:'addon|https://torrentio.strem.fun|torrentio',sourceName:'Torrentio',label:'WEB-DL 1080p',server:'Torrentio',candidates:[{id:'source-1'}]}]});
 f.engine.pick=vi.fn(async()=>({candidate:'source-1'}));f.engine.best=async()=>({candidate:'source-1'});
 f.event({type:'playback/preparing',session:'one'});f.event({type:'playback/ready',session:'one'});
 f.event({type:'playback/progress',session:'one',position:15000,duration:60000});
 expect(f.document.querySelector('.desktop-player-settings').hidden).toBe(true);
 f.document.querySelector('[data-action=settings]').click();expect(f.bridge.playerViewport).toHaveBeenLastCalledWith(expect.objectContaining({hidden:true}));
 f.document.querySelector('[data-action=settings-close]').click();expect(f.bridge.playerViewport).toHaveBeenLastCalledWith(expect.objectContaining({hidden:false}));
 f.document.querySelector('[data-action=servers]').click();await new Promise(resolve=>setTimeout(resolve,0));
 expect(f.document.querySelector('.an-pick.ss')?.textContent).toContain('Torrentio');
 extra=[{id:'route-2',state:'READY',quality:720,sourceId:'owned',sourceName:'Fast fixture CDN',server:'Fast fixture CDN',label:'720p',candidates:[{id:'source-2'}]}];f.route({session:'one'});await new Promise(resolve=>setTimeout(resolve,0));expect(f.document.querySelector('.an-pick.ss')?.textContent).toContain('Fast fixture CDN');
 expect(f.bridge.playerViewport).toHaveBeenLastCalledWith(expect.objectContaining({hidden:true}));
 f.document.querySelector('.an-pick-best').click();await new Promise(resolve=>setTimeout(resolve,0));
 expect(f.engine.switchSource).toHaveBeenCalledWith({session:'one',candidate:'source-1',position:15000});
 expect(f.document.querySelector('.desktop-room-layer')).toBeNull();f.player.dispose();vi.unstubAllGlobals();
});

it('offers episode navigation, speed, fit and subtitle appearance without raw MPV commands',async()=>{
 const f=fixture();f.engine.playerState=async()=>({title:'أنمي',episode:1,total:2,section:'anime',sources:[],together:false});f.engine.changeEpisode=vi.fn(async()=>{});
 f.event({type:'playback/preparing',session:'one'});f.event({type:'playback/ready',session:'one'});await new Promise(r=>setTimeout(r,0));
 const next=f.document.querySelector('[data-action=next-episode]');expect(next).toBeTruthy();expect(next.disabled).toBe(false);next.click();await Promise.resolve();expect(f.engine.changeEpisode).toHaveBeenCalledWith({session:'one',episode:2});
 f.document.querySelector('[data-action=settings]').click();
 for(const [key,value,name] of [['speed','1.5','speed'],['fit','fill','video-fit'],['subtitle-size','46','subtitle-size'],['subtitle-position','85','subtitle-position']]){
  const field=f.document.querySelector(`[data-control="${key}"]`);expect(field).toBeTruthy();if(field.tagName==='SELECT'){for(const option of field.options)option.removeAttribute('selected');field.querySelector(`option[value="${value}"]`).setAttribute('selected','');}else field.value=value;field.dispatchEvent(new f.document.defaultView.Event('change'));await Promise.resolve();expect(f.commands).toContainEqual({session:'one',command:name,value:key==='fit'?value:Number(value)});
 }
 f.player.dispose();
});
it('uses the shared AniSkip intervals and seeks only when a matching opening is active',async()=>{
 const skipLoader=vi.fn(async()=>({status:'READY',timings:{opening:{startMs:10000,endMs:90000},ending:null}}));
 const f=fixture({skipLoader});f.engine.playerState=async()=>({title:'أنمي',episode:1,total:2,malId:21,section:'anime',sources:[]});
 f.event({type:'playback/preparing',session:'one'});f.event({type:'playback/ready',session:'one'});await new Promise(r=>setTimeout(r,0));f.event({type:'playback/progress',session:'one',position:15000,duration:1400000});await new Promise(r=>setTimeout(r,0));
 expect(skipLoader).toHaveBeenCalledWith(expect.objectContaining({malId:21,episode:1,durationMs:1400000}));
 const skip=f.document.querySelector('[data-action=skip-segment]');expect(skip?.hidden).toBe(false);skip.click();await Promise.resolve();expect(f.commands).toContainEqual({session:'one',command:'seek',value:90000});f.player.dispose();
});
it('retains the player and its source controls after an error followed by native shutdown',async()=>{
 const f=fixture();f.engine.retryPlayback=vi.fn(async()=>{});f.event({type:'playback/preparing',session:'one'});f.event({type:'playback/error',session:'one',message:'لم يصل المقطع'});f.event({type:'playback/closed',session:'one'});
 expect(f.document.querySelector('.desktop-player')).toBeTruthy();expect(f.document.querySelector('[data-action=servers]')).toBeTruthy();f.player.dispose();
});

it('keeps torrent phase and cache rebuild diagnostics out of the viewing surface',()=>{const f=fixture();f.event({type:'playback/preparing',session:'one'});for(const stage of ['metadata','first-frame','cache-selected'])f.event({type:'playback/stage',session:'one',stage,volume:'E:'});f.event({type:'playback/retrying',session:'one',message:'رجعت لجزء حُذف من الكاش'});const text=f.document.querySelector('.desktop-player-status').textContent;expect(text).not.toMatch(/إطار|مغناطيس|كاش|حذف/);f.player.dispose();});

it('keeps startup controls away from an unconnected player without presenting a playback failure',async()=>{
 const f=fixture();f.event({type:'playback/preparing',session:'one'});
 f.document.querySelector('[data-action=pause]').click();await Promise.resolve();
 expect(f.bridge.playbackCommand).not.toHaveBeenCalled();
 expect(f.document.querySelector('.desktop-player-status').dataset.error).not.toBe('true');
 f.event({type:'playback/ready',session:'one'});
 f.document.querySelector('[data-action=pause]').click();await Promise.resolve();
 expect(f.bridge.playbackCommand).toHaveBeenCalledWith({session:'one',command:'pause',value:true});f.player.dispose();
});
it('ignores an obsolete same-session command rejection after switching sources',async()=>{
 const f=fixture();let reject;
 f.bridge.playbackCommand=vi.fn(()=>new Promise((_,no)=>reject=no));
 f.event({type:'playback/preparing',session:'one'});f.event({type:'playback/ready',session:'one'});
 f.document.querySelector('[data-action=pause]').click();
 f.event({type:'playback/preparing',session:'one'});f.event({type:'playback/ready',session:'one'});
 reject(new Error('old player disconnected'));await Promise.resolve();await Promise.resolve();
 expect(f.document.querySelector('.desktop-player-status').textContent).toBe('');
 f.player.dispose();
});
it('does not apply a player state response from a previous source in the same session',async()=>{
 const f=fixture();let resolve;
 f.engine.playerState=()=>new Promise(yes=>resolve=yes);
 f.event({type:'playback/preparing',session:'one'});const old=resolve;
 f.engine.playerState=async()=>({title:'new source',sources:[]});
 f.event({type:'playback/preparing',session:'one'});await Promise.resolve();
 old({title:'old source',sources:[]});await Promise.resolve();
 expect(f.document.querySelector('.desktop-player header h2').textContent).toBe('new source');f.player.dispose();
});
it('uses native fullscreen state for Escape and restores the state when a request fails',async()=>{
 const f=fixture();f.event({type:'playback/preparing',session:'one'});
 f.event({type:'window/fullscreen',enabled:true});
 f.event({type:'playback/action',session:'one',action:'close'});await Promise.resolve();
 expect(f.bridge.playerFullscreen).toHaveBeenCalledWith({enabled:false});
 expect(f.bridge.stopPlayback).not.toHaveBeenCalled();
 f.bridge.playerFullscreen.mockRejectedValueOnce(new Error('fullscreen failed'));
 f.document.querySelector('[data-action=fullscreen]').click();await Promise.resolve();
 f.document.querySelector('[data-action=fullscreen]').click();await Promise.resolve();
 expect(f.bridge.playerFullscreen).toHaveBeenLastCalledWith({enabled:true});f.player.dispose();
});

it('keeps genuine current command failures visible',async()=>{
 const f=fixture();f.event({type:'playback/preparing',session:'one'});f.event({type:'playback/ready',session:'one'});
 f.bridge.playbackCommand.mockRejectedValueOnce(new Error('native command failed'));
 f.document.querySelector('[data-action=pause]').click();await Promise.resolve();await Promise.resolve();
 expect(f.document.querySelector('.desktop-player-status').textContent).toBe('native command failed');
 expect(f.document.querySelector('.desktop-player-status').dataset.error).toBe('true');f.player.dispose();
});
