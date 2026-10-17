import {expect,it,vi,afterEach} from 'vitest';
import {parseHTML} from 'linkedom';
import {createOverlayView} from './overlay.js';
afterEach(()=>vi.useRealTimers());
function fixture(){
  vi.useFakeTimers();
  const {document}=parseHTML('<html><body></body></html>');
  return {document,view:createOverlayView(document,()=>{}, {timers:globalThis})};
}
it('يخفي أزرار البداية بعد وصول أول إطار دون انتظار حركة الماوس',()=>{
  const {view}=fixture();
  view.update({ready:false,paused:false});
  view.update({ready:true,paused:false});
  expect(view.root.classList.contains('pp--shown')).toBe(true);
  vi.advanceTimersByTime(3500);
  expect(view.root.classList.contains('pp--shown')).toBe(false);
});
it('تحديثات التقدم لا تعيد إظهار الأدوات وتظهر عند تحريك الماوس',()=>{
  const {document,view}=fixture();view.update({ready:true,paused:false});
  vi.advanceTimersByTime(3500);view.update({position:15000});
  expect(view.root.classList.contains('pp--shown')).toBe(false);
  view.root.dispatchEvent(new document.defaultView.Event('mousemove'));
  expect(view.root.classList.contains('pp--shown')).toBe(true);
  vi.advanceTimersByTime(3500);expect(view.root.classList.contains('pp--shown')).toBe(false);
});
it('تبقى أدوات الإيقاف مرئية ثم تختفي بعد الاستئناف',()=>{
  const {view}=fixture();view.update({ready:true,paused:true});
  vi.advanceTimersByTime(10000);expect(view.root.classList.contains('pp--shown')).toBe(true);
  view.update({paused:false});vi.advanceTimersByTime(3500);
  expect(view.root.classList.contains('pp--shown')).toBe(false);
});

it('anchors compact subtitle dialog above its button and restores focus on Escape',()=>{
  const {document,view}=fixture();
  const button=view.root.querySelector('[data-action="subtitles"]');
  button.getBoundingClientRect=()=>({left:900,right:940,top:650,bottom:690,width:40,height:40});
  view.root.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:720});
  view.open.subtitles();
  const sheet=view.root.querySelector('.pp-sheet');
  expect(sheet.dataset.kind).toBe('subtitles');
  expect(sheet.style.bottom).toBe('80px');
  expect(sheet.style.right).toBe('60px');
  expect(button.getAttribute('aria-expanded')).toBe('true');
  view.update({ready:true,paused:false,position:1000});vi.advanceTimersByTime(10000);
  expect(sheet.hidden).toBe(false);
  const escape=new document.defaultView.Event('keydown');Object.assign(escape,{key:'Escape'});document.dispatchEvent(escape);
  expect(sheet.hidden).toBe(true);expect(button.getAttribute('aria-expanded')).toBe('false');
});
it('subtitle adjustment sends exact timing, style and reset commands without dismissing',()=>{
  vi.useFakeTimers();const {document}=parseHTML('<html><body></body></html>');const send=vi.fn();
  const view=createOverlayView(document,send);view.update({subtitleDelay:500});view.open.subtitles();
  const click=(label)=>[...view.root.querySelectorAll('button')].find(b=>b.textContent===label).click();
  click('الضبط');click('أبكر 0.5');expect(send).toHaveBeenLastCalledWith({name:'subtitle-delay',value:0});
  click('كبير');expect(send).toHaveBeenLastCalledWith({name:'subtitle-size',value:52});
  click('تصفير التوقيت');expect(send).toHaveBeenLastCalledWith({name:'subtitle-delay',value:0});
  expect(view.root.querySelector('.pp-sheet').hidden).toBe(false);
});

it('clamps quality popup near the left edge and sends selected source and speed',()=>{
  vi.useFakeTimers();const {document}=parseHTML('<html><body></body></html>');const send=vi.fn();const view=createOverlayView(document,send);
  view.root.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600});
  const quality=view.root.querySelector('.pp-quality');quality.getBoundingClientRect=()=>({left:10,right:50,top:520});
  view.update({sources:[{id:'hq',label:'1080p'}]});view.open.quality();const sheet=view.root.querySelector('.pp-sheet');
  expect(sheet.style.right).toBe('508px');expect(sheet.style.bottom).toBe('90px');
  [...sheet.querySelectorAll('button')].find(b=>b.textContent==='1080p').click();expect(send).toHaveBeenLastCalledWith({name:'source',value:'hq'});expect(sheet.hidden).toBe(true);
  view.open.speed();[...sheet.querySelectorAll('button')].find(b=>b.textContent==='1.5×').click();expect(send).toHaveBeenLastCalledWith({name:'speed',value:1.5});
  view.open.subtitles();view.root.querySelector('.pp-scrim').click();expect(sheet.hidden).toBe(true);
});
