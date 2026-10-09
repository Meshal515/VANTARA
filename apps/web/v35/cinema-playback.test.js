import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ routes: [], session: null, listeners: new Map(), open: vi.fn(), pick: vi.fn(async (_s,id) => id) }));
vi.mock('./motion.js', () => ({ pop() {}, progressFill() {}, reduced: () => true, revealIn() {}, stripIn() {} }));
vi.mock('../lib/anime-engine.js', async original => ({
  ...await original(), available: () => true, sources: async () => [], onNeedsHuman() {},
  on: (event,fn) => { state.listeners.set(event,fn); return () => state.listeners.delete(event); },
  withAddonCopies: async () => [], prepare: async args => { state.session=args.session; return {session:args.session,routes:state.routes,done:true}; },
  routes: async () => ({routes:state.routes,done:true}), episodes: async () => [],
  pick: state.pick, open: state.open, closeSession: async () => {},
}));
const { createCinema } = await import('./cinema.js');
afterEach(() => { state.listeners.clear(); state.open.mockClear(); state.pick.mockClear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each([false, true])('73 native torrent choices remain selectable while HTTP pending=%s, with excess releases folded and no autoplay', async (httpPending) => {
  vi.useFakeTimers();
  state.routes = Array.from({length:73},(_,i) => ({id:`torrent-${i}`,code:`TRR${i}`,server:'Torrentio',sourceId:'addon|torrentio',sourceName:'Torrentio',label:`Fight.Club.1999.1080p.Release-${i}`,quality:1080,state:'READY',runtimeReady:true,probed:null}));
  if (httpPending) state.routes.push({id:'http-pending',sourceId:'arabseed',code:'SRV',state:'READY',probed:null});
  const {window,document}=parseHTML('<html><body><main id="cinema"></main><div id="sheet"></div></body></html>');
  vi.stubGlobal('window',window);vi.stubGlobal('document',document);
  vi.stubGlobal('requestAnimationFrame',fn=>setTimeout(fn,0));
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem(){}});
  vi.stubGlobal('Image',function(){return document.createElement('img');});
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
  let cleanup;
  const sheet=document.getElementById('sheet');
  const deps={q:id=>document.getElementById(id),el,toast:vi.fn(),showPage(){},openSheet:fn=>{cleanup=fn(sheet);},closeSheet:vi.fn(),currentPage:()=> 'cinema'};
  const cinema=createCinema(deps);
  await cinema.openWork({id:'tt0137523',type:'movie',title:'Fight Club',_sourceCopy:{sourceId:'addon|torrentio',url:'tt0137523',title:'Fight Club'}},{autoplay:true});
  await vi.advanceTimersByTimeAsync(1);
  if (process.env.VANTARA_PICKER_CAPTURE) {
    const {writeFileSync}=await import('node:fs');
    writeFileSync(process.env.VANTARA_PICKER_CAPTURE, sheet.innerHTML);
  }
  expect(state.open).not.toHaveBeenCalled();
  if (!httpPending) expect(sheet.textContent).not.toContain('نفحص التشغيل');
  const first=sheet.querySelector('.an-srv-group > .an-srv-grid .an-srv');
  expect(first.disabled).toBe(false);
  expect(first.textContent).toContain('Torrentio');
  expect(first.textContent).toContain('Release-0');
  expect(first.textContent).toContain('يبدأ عند الاختيار');
  expect(Boolean(sheet.querySelector('.cn-srv-wait'))).toBe(httpPending);
  expect(sheet.querySelectorAll('.an-srv-group > .an-srv-grid .an-srv').length).toBe(6);
  const more=sheet.querySelector('.an-srv-group details');
  expect(more.open).toBeFalsy();
  expect(more.querySelector('summary').textContent).toContain('67');
  expect(more.querySelectorAll('.an-srv').length).toBe(67);
  more.open=true;
  state.listeners.get('route')({session:state.session,route:{...state.routes[72],state:'FAILED',runtimeReady:false}});
  await vi.advanceTimersByTimeAsync(1);
  expect(more.querySelector('summary').textContent).toContain('66');
  expect(more.querySelectorAll('.an-srv').length).toBe(66);
  expect(more.open).toBe(true);
  await first.onclick();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.pick).toHaveBeenCalled();
  expect(state.open).toHaveBeenCalledWith(expect.objectContaining({candidate:'torrent-0',section:'cinema'}));
  cleanup?.();
});
