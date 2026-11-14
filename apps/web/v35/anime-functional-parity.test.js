import {parseHTML} from 'linkedom';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./motion.js',()=>({pop(){},pageIn(){},revealIn(){},stripIn(){}}));
vi.mock('../lib/anime-engine.js',async original=>({...await original(),available:()=>false,sources:async()=>[],on:()=>()=>{},onNeedsHuman(){}}));
const {createAnime,recordWatch,readWatch}=await import('./anime.js');
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
let sequence=83000;
function setup(style,{total=1180,work={}}={}){
 vi.useFakeTimers();
 const{document,window}=parseHTML('<html><body><main><section id="anime"></section><section id="animeLibrary"></section><section id="animeDiscover"></section><section id="animeCollection"></section></main><aside id="dialog"></aside></body></html>');
 vi.stubGlobal('document',document);vi.stubGlobal('window',window);vi.stubGlobal('Image',function(){return document.createElement('img')});
 vi.stubGlobal('requestAnimationFrame',fn=>setTimeout(fn,0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
 vi.stubGlobal('addEventListener',()=>{});vi.stubGlobal('removeEventListener',()=>{});vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 const memory=new Map([['vantara.appearance.v1',JSON.stringify({style:{anime:style}})]]);
 vi.stubGlobal('localStorage',{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)});
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({})})));
 const root=document.querySelector('main'),dialog=document.getElementById('dialog');
 const el=(t,c,s)=>{const n=document.createElement(t);if(c)n.className=c;if(s!=null)n.textContent=s;return n};
 const deps={root,q:id=>root.querySelector('#'+id),el,toast:vi.fn(),genreAr:s=>s,openSheet:fn=>{dialog.replaceChildren();fn(dialog)},closeSheet(){dialog.replaceChildren()},showPage(){},currentPage:()=> 'anime',sync:{user:null,rows:()=>[],enqueue(){}}};
 const anime=createAnime(deps),m={id:++sequence,title:'Long series',format:'TV',status:'FINISHED',episodes:total,aired:total,duration:24,genres:[],relations:[],characters:[],_sourceCopy:{sourceId:'test',url:'/series'},...work};
 return{anime,m,root,dialog,document,memory};
}
const settle=async()=>{for(let i=0;i<8;i++)await vi.advanceTimersByTimeAsync(1)};
const numbers=f=>[...f.root.querySelectorAll('[data-episode-row]')].map(n=>Number(n.dataset.ep));
const pageSize=()=>50;
const buttonText=(host,text)=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const tools=f=>f.root.querySelector('.aw-episode-controls');
async function chooseTool(f,label){
 tools(f).querySelector('[aria-label="الترتيب والتصفية"]').click();
 const action=buttonText(f.dialog,label);expect(action,label).not.toBeUndefined();action.click();await settle();
}
async function search(f,value){
 const input=tools(f).querySelector('input[type="search"]');input.value=value;
 input.dispatchEvent(new f.document.defaultView.Event('input'));await vi.advanceTimersByTimeAsync(250);await settle();return input;
}
async function mark(f,episode){
 const row=f.root.querySelector(`[data-episode-row][data-ep="${episode}"]`);expect(row,`episode ${episode} is visible`).not.toBeNull();
 const mark=row.querySelector('.an-er-icon');
 if(mark)mark.click();
 else{row.dispatchEvent(new f.document.defaultView.Event('pointerdown',{bubbles:true}));
  row.dispatchEvent(new f.document.defaultView.Event('contextmenu',{bubbles:true,cancelable:true}));
  row.dispatchEvent(new f.document.defaultView.Event('pointerup',{bubbles:true}));
  const action=f.dialog.querySelector('button[aria-pressed]');expect(action).not.toBeNull();action.click();}
 await settle();
}
for(const style of ['core','platform','card','screen','episode']){
 it(`${style}: bounded episode pages, last group and exact Arabic-number search`,async()=>{
  const f=setup(style);await f.anime.openAnime(f.m);await settle();
  const tools=f.root.querySelector('.aw-episode-controls');expect(tools,style).not.toBeNull();
  const groups=tools.querySelectorAll('[data-episode-page]');expect(groups.length).toBeGreaterThan(1);
  groups[groups.length-1].click();await settle();
  const nums=[...f.root.querySelectorAll('[data-episode-row]')].map(n=>Number(n.dataset.ep));expect(nums).toContain(1180);expect(nums.length).toBeLessThanOrEqual(50);
  const input=tools.querySelector('input[type="search"]');input.value='١٠٠٠';input.dispatchEvent(new f.document.defaultView.Event('input'));await vi.advanceTimersByTimeAsync(250);await settle();
  expect([...f.root.querySelectorAll('[data-episode-row]')].map(n=>Number(n.dataset.ep))).toEqual([1000]);
  expect(f.root.querySelector('.aw-episode-controls input')).toBe(input);
  f.anime.leaveDetail();
 });
 it(`${style}: resumes the actual tenth episode and keeps its group`,async()=>{
  const f=setup(style);recordWatch(f.m,10,60000,1440000);
  await f.anime.openAnime(f.m);await settle();
  if(style==='episode')expect(f.root.querySelector('.wl-now button').getAttribute('aria-label')).toBe('تابع الحلقة 10');
  else expect(f.root.querySelector(style==='core'?'.aw-play':style==='card'?'.wl-big':style==='screen'?'.wl-go':'.wl-cta').textContent).toContain('تابع الحلقة 10');
  expect([...f.root.querySelectorAll('[data-episode-row]')].map(n=>Number(n.dataset.ep))).toContain(10);
  f.anime.leaveDetail();
 });

 it.each([12,25,26,148,400,1000])(`${style}: all groups remain reachable and bounded for %i episodes`,async total=>{
  const f=setup(style,{total});await f.anime.openAnime(f.m);await settle();
  const groups=[...tools(f).querySelectorAll('[data-episode-page]')];
  expect(groups).toHaveLength(Math.ceil(total/pageSize(style)));
  const reached=[];
  for(const group of groups){
   expect(group.dir).toBe('ltr');expect(group.textContent).not.toMatch(/^[-/]|-1/);
   group.click();await settle();const current=numbers(f);expect(current.length).toBeLessThanOrEqual(pageSize(style));expect(current.length).toBeGreaterThan(0);reached.push(...current);
  }
  expect(reached).toEqual(Array.from({length:total},(_,i)=>i+1));f.anime.leaveDetail();
 });

 it(`${style}: sorts globally and removes watched episodes before dividing groups`,async()=>{
  const f=setup(style,{total:148});for(let n=1;n<=100;n++)recordWatch(f.m,n,1440000,1440000);
  await f.anime.openAnime(f.m);await settle();await chooseTool(f,'الأحدث أولًا');
  expect(numbers(f)).toEqual(Array.from({length:pageSize(style)},(_,i)=>148-i));
  await chooseTool(f,'أخفِ ما شاهدته');
  const reached=[];
  for(const group of tools(f).querySelectorAll('[data-episode-page]')){group.click();await settle();expect(numbers(f).length).toBeGreaterThan(0);reached.push(...numbers(f));}
  expect(reached).toEqual(Array.from({length:48},(_,i)=>148-i));
  await chooseTool(f,'الأقدم أولًا');expect(numbers(f)).toEqual(Array.from({length:Math.min(48,pageSize(style))},(_,i)=>101+i));
  f.anime.leaveDetail();
 });

 it(`${style}: name search is bounded, survives page changes and reaches the last match`,async()=>{
  const f=setup(style);f.m.thumbs=Object.fromEntries(Array.from({length:1180},(_,i)=>[i+1,{title:`Shared voyage ${i+1}`}]))
  await f.anime.openAnime(f.m);await settle();const input=await search(f,' SHARED voyage ');
  expect(numbers(f)).toEqual(Array.from({length:pageSize(style)},(_,i)=>i+1));
  const groups=tools(f).querySelectorAll('[data-episode-page]');groups[groups.length-1].click();await settle();
  expect(numbers(f)).toContain(1180);expect(numbers(f).length).toBeLessThanOrEqual(pageSize(style));expect(tools(f).querySelector('input')).toBe(input);
  expect(input.value.trim()).toBe('SHARED voyage');f.anime.leaveDetail();
 });

 it(`${style}: manual marking and unmarking preserve the real playback pointer and its progress`,async()=>{
  const f=setup(style,{total:26});recordWatch(f.m,10,60000,1440000);const original={...readWatch()[f.m.id].episodes[10]};
  await f.anime.openAnime(f.m);await settle();await mark(f,20);
  expect(readWatch()[f.m.id].episode).toBe(10);expect(readWatch()[f.m.id].episodes[10]).toEqual(original);
  await mark(f,10);expect(readWatch()[f.m.id].episode).toBe(10);
  expect(readWatch()[f.m.id].episodes[10]).toEqual({...original,done:true});
  await mark(f,10);expect(readWatch()[f.m.id].episode).toBe(10);
  expect(readWatch()[f.m.id].episodes[10]).toEqual(original);f.anime.leaveDetail();
 });

 it(`${style}: marking a range refills filtered pages and preserves playback progress`,async()=>{
  const f=setup(style,{total:148});recordWatch(f.m,10,60000,1440000);const original={...readWatch()[f.m.id].episodes[10]};
  await f.anime.openAnime(f.m);await settle();await chooseTool(f,'علّم حلقات: من ← إلى');
  const fields=f.dialog.querySelectorAll('input[type="number"]');expect(fields).toHaveLength(2);fields[0].value='1';fields[1].value='100';
  buttonText(f.dialog,'علّمها شوهدت').click();await settle();
  expect(readWatch()[f.m.id].episode).toBe(10);expect(readWatch()[f.m.id].episodes[10]).toEqual({...original,done:true});
  await chooseTool(f,'أخفِ ما شاهدته');expect(numbers(f)).toEqual(Array.from({length:Math.min(pageSize(style),48)},(_,i)=>101+i));
  await chooseTool(f,'علّم حلقات: من ← إلى');const undo=f.dialog.querySelectorAll('input[type="number"]');undo[0].value='1';undo[1].value='100';
  buttonText(f.dialog,'ألغِ تعليمها').click();await settle();
  expect(readWatch()[f.m.id].episode).toBe(10);expect(readWatch()[f.m.id].episodes[10]).toEqual(original);
  expect(numbers(f)).toEqual(Array.from({length:pageSize(style)},(_,i)=>i+1));
  f.anime.leaveDetail();
 });

 it(`${style}: real seasons remain separate from page groups and keep search, hide and ordering`,async()=>{
  const f=setup(style,{total:148});f.m.title='Long series Season 1';
  f.m.thumbs=Object.fromEntries(Array.from({length:148},(_,i)=>[i+1,{title:`Shared voyage ${i+1}`}]))
  const sequel={...f.m,id:++sequence,title:'Long series Season 2',episodes:26,aired:26,relation:'الجزء التالي',relations:[]};
  f.m.relations=[sequel];sequel.relations=[{...f.m,relation:'الجزء السابق'}];
  recordWatch(f.m,1,1440000,1440000);recordWatch(sequel,1,1440000,1440000);
  await f.anime.openAnime(f.m);await settle();await chooseTool(f,'الأحدث أولًا');await chooseTool(f,'أخفِ ما شاهدته');await search(f,'Shared');
  const seasons=tools(f).querySelector('.an-seasons');expect(seasons.querySelectorAll('button')).toHaveLength(2);
  expect(seasons.querySelector('[data-episode-page]')).toBeNull();
  const go=seasons.querySelector('[aria-label="Long series Season 2"]');expect(go).not.toBeNull();go.click();await settle();
  expect(tools(f).querySelector('input').value).toBe('Shared');expect(numbers(f)).toEqual(Array.from({length:25},(_,i)=>26-i));
  expect(tools(f).querySelector('.an-season[aria-current="true"]').getAttribute('aria-label')).toBe('Long series Season 2');
  tools(f).querySelector('[aria-label="الترتيب والتصفية"]').click();
  expect(buttonText(f.dialog,'الأحدث أولًا').getAttribute('aria-pressed')).toBe('true');expect(buttonText(f.dialog,'أخفِ ما شاهدته').getAttribute('aria-pressed')).toBe('true');
  f.anime.leaveDetail();
 });

 it(`${style}: movies expose playback without episode controls or numbered episode rows`,async()=>{
  const f=setup(style,{total:1,work:{format:'MOVIE'}});await f.anime.openAnime(f.m);await settle();
  expect(tools(f)).toBeNull();expect(numbers(f)).toEqual([]);expect(f.root.textContent).not.toContain('الحلقات');f.anime.leaveDetail();
 });

 it(`${style}: unknown metadata keeps the actual episode while the list waits for availability`,async()=>{
  const f=setup(style,{work:{episodes:null,aired:null,status:null}});recordWatch(f.m,10,60000,1440000);
  await f.anime.openAnime(f.m);await settle();expect(numbers(f)).toEqual([]);
  const label=style==='episode'?f.root.querySelector('.wl-now button').getAttribute('aria-label'):f.root.querySelector(style==='core'?'.aw-play':style==='card'?'.wl-big':style==='screen'?'.wl-go':'.wl-cta').textContent;
  expect(label).toContain('تابع الحلقة 10');expect(readWatch()[f.m.id].episodes[10].duration).toBe(1440000);f.anime.leaveDetail();
 });

 it(`${style}: an ongoing series lists available episodes and does not claim whole-series completion`,async()=>{
  const f=setup(style,{total:12,work:{status:'RELEASING',episodes:24,next:{episode:13,at:Date.now()+86400000}}});
  for(let n=1;n<=12;n++)recordWatch(f.m,n,1440000,1440000);
  await f.anime.openAnime(f.m);await settle();expect(numbers(f)).toEqual(Array.from({length:12},(_,i)=>i+1));
  const replay=f.root.querySelector(style==='core'?'.aw-play':style==='card'?'.wl-big':style==='screen'?'.wl-go':style==='platform'?'.wl-cta':'.wl-now button');
  expect(style==='episode'?replay.getAttribute('aria-label'):replay.textContent).toContain('الحلقة 12');
  expect(f.root.querySelector('[data-episode-row][data-ep="13"]')).toBeNull();f.anime.leaveDetail();
 });

 it(`${style}: a fully watched finished series offers an explicit first-episode replay`,async()=>{
  const f=setup(style,{total:12});for(let n=1;n<=12;n++)recordWatch(f.m,n,1440000,1440000);
  await f.anime.openAnime(f.m);await settle();
  const replay=f.root.querySelector(style==='core'?'.aw-play':style==='card'?'.wl-big':style==='screen'?'.wl-go':style==='platform'?'.wl-cta':'.wl-now button');
  expect(style==='episode'?replay.getAttribute('aria-label'):replay.textContent).toContain('أعد مشاهدة الحلقة 1');
  f.anime.leaveDetail();
 });
}
it('finished work has an explicit replay action rather than an unwatched label',async()=>{
 const f=setup('card',{total:12});for(let n=1;n<=12;n++)recordWatch(f.m,n,1440000,1440000);
 await f.anime.openAnime(f.m);await settle();expect(f.root.querySelector('.wl-big').textContent).toContain('أعد مشاهدة');expect(f.root.querySelector('.wl-info').textContent).toContain('12 من 12');f.anime.leaveDetail();
});
