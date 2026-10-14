import {expect,it,vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {installDesktopPlayer} from './player.js';
function fixture(){
 const {document}=parseHTML('<html><body><button id="previous">عمل</button></body></html>');const callbacks=[],commands=[],listeners=new Map();
 const bridge={playerViewport:vi.fn(async()=>true),playerFullscreen:vi.fn(async()=>true),playbackCommand:vi.fn(async arg=>commands.push(arg)),stopPlayback:vi.fn(async()=>{}),onEvent:fn=>{callbacks.push(fn);return()=>{};}};
 const engine={addListener:(name,fn)=>{listeners.set(name,fn);return{remove(){}};},playerState:async()=>({title:'فيلم',candidate:'source-1',sources:[{id:'source-1',label:'مصدر · 1080p'}]}),switchSource:vi.fn(async()=>{}),closeSession:vi.fn(async()=>{})};
 const g={document,innerWidth:1000,innerHeight:800,addEventListener:vi.fn(),removeEventListener:vi.fn()};const player=installDesktopPlayer({g,bridge,engine});
 return{document,bridge,engine,commands,player,event:e=>callbacks.forEach(fn=>fn(e))};
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
