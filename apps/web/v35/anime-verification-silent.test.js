import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {parseHTML} from 'linkedom';
const events=vi.hoisted(()=>({listeners:new Set(),verify:vi.fn()}));
vi.mock('./motion.js',()=>({pop(){},pageIn(){},revealIn(){},stripIn(){}}));
vi.mock('../lib/anime-engine.js',async original=>({...await original(),available:()=>false,
 sources:async()=>[{id:'egy-dead',name:'Egy Dead',domain:'https://source.example'}],
 on:()=>()=>{},verify:events.verify,
 onNeedsHuman:fn=>{events.listeners.add(fn);return()=>events.listeners.delete(fn);}}));
const {createAnime}=await import('./anime.js');
beforeEach(()=>{events.listeners.clear();events.verify.mockClear();vi.useFakeTimers();});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it.each(['utility','cinema','anime'])('keeps a background Egy Dead needsHuman event silent while %s is visible',async page=>{
 const {window,document}=parseHTML('<html><body><main><section id="utility">الإضافات</section><section id="anime"></section><section id="animeLibrary"></section></main></body></html>');
 vi.stubGlobal('window',window);vi.stubGlobal('document',document);
 vi.stubGlobal('requestAnimationFrame',fn=>fn());
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
 const root=document.querySelector('main'),toast=vi.fn(),openSheet=vi.fn(),passive=vi.fn();
 events.listeners.add(passive);
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
 createAnime({root,q:id=>root.querySelector('#'+id),el,toast,openSheet,closeSheet:vi.fn(),showPage:vi.fn(),currentPage:()=>page,genreAr:x=>x,
   sync:{user:null,rows:()=>[],enqueue:vi.fn()}});
 await Promise.resolve();await Promise.resolve();
 for(const callback of events.listeners)callback('egy-dead');
 expect(passive).toHaveBeenCalledWith('egy-dead'); // Event delivery/diagnostics remain available.
 expect(document.querySelector('.an-verify')).toBeNull();
 expect(document.body.textContent).not.toContain('يطلب تحقق');
 expect(toast).not.toHaveBeenCalled();expect(openSheet).not.toHaveBeenCalled();expect(events.verify).not.toHaveBeenCalled();
});
