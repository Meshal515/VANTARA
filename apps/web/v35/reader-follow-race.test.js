import {afterEach,expect,it,vi} from 'vitest';
import {parseHTML} from 'linkedom';
vi.mock('./reader-translate.js',()=>({createReaderTranslation:()=>({attach(){},openGate(){},focus(){},needs:()=>false,enabled:()=>false,isOn:()=>false,destroy(){},onImage(){}})}));
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('a late initial layout cannot overwrite the newest host position',async()=>{
  vi.useFakeTimers();vi.resetModules();
  const {window,document}=parseHTML('<html><body></body></html>');
  document.visibilityState='visible';
  vi.stubGlobal('document',document);vi.stubGlobal('window',window);vi.stubGlobal('navigator',{onLine:true});
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem(){}});
  vi.stubGlobal('Image',class{});
  vi.stubGlobal('IntersectionObserver',class{observe(){}unobserve(){}disconnect(){}});
  window.HTMLElement.prototype.scrollTo=function({top=0}){this.scrollTop=top;};
  window.HTMLElement.prototype.scrollIntoView=function(){};
  window.HTMLElement.prototype.getBoundingClientRect=function(){
    const index=Number(this.dataset.index??0);const top=this.id==='rdScroll'?0:index*1000-(document.querySelector('#rdScroll')?.scrollTop??0);
    return {top,bottom:top+1000,height:1000};
  };
  Object.defineProperty(window.HTMLElement.prototype,'scrollHeight',{get:()=>10000,configurable:true});
  Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get:()=>500,configurable:true});
  let id=0;const frames=new Map();vi.stubGlobal('requestAnimationFrame',fn=>{frames.set(++id,fn);return id;});vi.stubGlobal('cancelAnimationFrame',i=>frames.delete(i));
  const events=new Map();const room={isHost:false,me:'guest',status:'live',info:{mode:'sync'},clock:{serverNow:()=>1000},
    timeline:{media:{key:'manga:solo#1',kind:'manga'},started:true,pos:.25,seq:1},report:vi.fn(),command:vi.fn(),
    on:(e,fn)=>{const set=events.get(e)??new Set();events.set(e,set);set.add(fn);return()=>set.delete(fn);}};
  const session={room,mode:'sync',media:{kind:'manga',seriesRef:'solo'}};
  const hub={session,useSurface:()=>()=>{},mountStrip:()=>()=>{}};
  let resolve;const waiting=new Promise(r=>resolve=r);
  const engine={pages:vi.fn(()=>waiting),pageImage:()=>new Promise(()=>{})};
  const {openSmartReader}=await import('./reader.js');
  const reader=openSmartReader({sync:{user:{userId:'g'},rows:()=>[],enqueue:vi.fn()},engine,together:hub,mount:n=>document.body.append(n),exit(){}},
    {title:'Manga',seriesRef:'solo',rows:[{number:1,sourceId:'src',chapter:{url:'/1',name:'chapter 1'}}],row:{number:1,sourceId:'src',chapter:{url:'/1',name:'chapter 1'}}});
  resolve(Array.from({length:8},(_,i)=>({url:`/${i}`})));
  for(let n=0;n<20;n++)await Promise.resolve();
  expect(document.querySelectorAll('.rd-page')).toHaveLength(8);
  room.timeline={...room.timeline,pos:.1,seq:room.timeline.seq+1,at:1000};
  for(const fn of events.get('state')??[])fn({state:room.timeline,by:'host'});
  for(let at=0;at<600;at+=16){const tasks=[...frames.values()];frames.clear();tasks.forEach(fn=>fn(at));await Promise.resolve();}
  expect(document.querySelector('#rdScroll').scrollTop).toBeCloseTo(100,0);
  reader.destroy();expect([...events.values()].every(set=>!set.size)).toBe(true);
});
it.each([true,false])('reports decoded positions, never placeholder fractions (host=%s)',async(isHost)=>{
  vi.useFakeTimers();vi.resetModules();
  const {window,document}=parseHTML('<html><body></body></html>');
  document.visibilityState='visible';
  vi.stubGlobal('document',document);vi.stubGlobal('window',window);vi.stubGlobal('navigator',{onLine:true});
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem(){}});
  let decode;const decoded=new Promise(resolve=>{decode=resolve;});
  vi.stubGlobal('Image',class{constructor(){const img=document.createElement('img');img.decode=()=>decoded;img.naturalWidth=1000;img.naturalHeight=6000;return img;}});
  vi.stubGlobal('IntersectionObserver',class{observe(){}unobserve(){}disconnect(){}});
  window.HTMLElement.prototype.scrollTo=function({top=0}){this.scrollTop=top;};
  window.HTMLElement.prototype.scrollIntoView=function(){};
  window.HTMLElement.prototype.getBoundingClientRect=function(){
    const height=this.querySelector('img')?6000:1000;
    const top=this.id==='rdScroll'?0:Number(this.dataset.index??0)*height-(document.querySelector('#rdScroll')?.scrollTop??0);
    return {top,bottom:top+height,height};
  };
  Object.defineProperty(window.HTMLElement.prototype,'scrollHeight',{get:()=>50000,configurable:true});
  Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get:()=>500,configurable:true});
  let id=0;const frames=new Map();vi.stubGlobal('requestAnimationFrame',fn=>{frames.set(++id,fn);return id;});vi.stubGlobal('cancelAnimationFrame',i=>frames.delete(i));
  const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();const tasks=[...frames.values()];frames.clear();tasks.forEach(fn=>fn(1000));};
  const room={isHost,me:isHost?'host':'guest',status:'live',info:{mode:'sync'},clock:{serverNow:()=>1000},
    timeline:{media:{key:'manga:solo#1',kind:'manga'},started:true,pos:0,seq:1},report:vi.fn(),command:vi.fn(),on:()=>()=>{}};
  const session={room,mode:'sync',media:{kind:'manga',seriesRef:'solo'}};
  const hub={session,useSurface:()=>()=>{},mountStrip:()=>()=>{}};
  const {openSmartReader}=await import('./reader.js');
  const row={number:1,sourceId:'src',chapter:{url:'/1',name:'chapter 1'}};
  const reader=openSmartReader({sync:{user:{userId:'h'},rows:()=>[],enqueue:vi.fn()},engine:{pages:async()=>Array.from({length:8},(_,i)=>({url:`/${i}`})),pageImage:async()=>({src:'fixture'})},together:hub,mount:n=>document.body.append(n),exit(){}},
    {title:'Manga',seriesRef:'solo',rows:[row],row});
  await flush();
  const scroll=document.querySelector('#rdScroll');
  if(isHost){scroll.scrollTop=100;scroll.dispatchEvent(new window.Event('scroll'));}
  await flush();
  expect(room.command).not.toHaveBeenCalled();
  decode();await flush();await flush();
  if(isHost)expect(room.command).toHaveBeenLastCalledWith('seek',{pos:100/6000});
  else {expect(room.command).not.toHaveBeenCalled();expect(room.report).toHaveBeenCalledWith(expect.objectContaining({pos:0,state:'playing'}));}
  reader.destroy();
});
