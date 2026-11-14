import { diagnosticsUi } from '../lib/diagnostics-ui.js';
import {expect,it,vi,afterEach} from 'vitest';
import {parseHTML} from 'linkedom';
import {createOverlayView} from './overlay.js';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function fixture(){
  vi.useFakeTimers();
  const {document}=parseHTML('<html><body></body></html>');
  const send=vi.fn();
  return {document,send,view:createOverlayView(document,send, {timers:globalThis})};
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

it('F11 in the focused transparent Windows player routes fullscreen to the native host',()=>{
  vi.useFakeTimers();
  const {document}=parseHTML('<html><body></body></html>');
  const send=vi.fn();
  createOverlayView(document,send);
  const event=new document.defaultView.Event('keydown',{cancelable:true});
  Object.assign(event,{key:'F11'});
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(send).toHaveBeenCalledWith({name:'fullscreen'});
});

it('native Windows overlay keeps actual room avatars and preparation status visible above MPV',()=>{
  const {view}=fixture();
  const people=[
    {userId:'host',name:'مشعل',avatarKey:'https://example.org/a.png',state:'ready',host:true},
    {userId:'friend',name:'صديق',avatarKey:null,state:'preparing'},
    {userId:'third',name:'ثالث',avatarKey:'file:///unsafe',state:'failed'},
    {userId:'fourth',name:'رابع',avatarKey:null,state:'ready'},
  ];
  view.update({people,ready:true,paused:false});
  const strip=view.root.querySelector('.pp-people');
  expect(strip.hidden).toBe(false);
  expect(strip.parentElement).toBe(view.root); // outside the auto-hiding pp-controls
  expect(strip.getAttribute('aria-label')).toContain('4');
  expect(strip.querySelectorAll('.pp-person')).toHaveLength(3);
  expect(strip.querySelector('img')?.getAttribute('src')).toBe('https://example.org/a.png');
  expect(strip.querySelector('.pp-person.is-busy')).not.toBeNull();
  expect(strip.querySelector('.pp-person.is-failed')).not.toBeNull();
  expect(strip.querySelector('.pp-person-more')?.textContent).toBe('+1');
  const before=strip.querySelector('img');
  view.update({position:15000,people:[...people]});
  expect(strip.querySelector('img')).toBe(before);
  view.update({people:[]});
  expect(strip.hidden).toBe(true);
});

it('desktop provides audio track menu and advanced settings instead of hiding existing controls',()=>{
  vi.useFakeTimers();
  const {document}=parseHTML('<html><body></body></html>');
  const send=vi.fn();
  const view=createOverlayView(document,send);
  view.update({audio:[{id:1,label:'العربية',lang:'ar'},{id:2,label:'الإنجليزية',lang:'en'}]});
  const audio=view.root.querySelector('[data-action="audio"].pp-desk');
  expect(audio).not.toBeNull();
  expect(audio.hidden).toBe(false);
  // بجانب الترجمة مباشرة كما في الـAPK
  expect(audio.previousElementSibling.dataset.action).toBe('subtitles');
  audio.click();
  const sheet=view.root.querySelector('.pp-sheet');
  expect(sheet.dataset.kind).toBe('audio');
  [...sheet.querySelectorAll('button')].find(b=>b.textContent.includes('الإنجليزية')).click();
  expect(send).toHaveBeenCalledWith({name:'audio-select',value:2});
  // مسار واحد يبقى ظاهرًا (يُعرف به لغة الصوت) ولا يتكرر في «المزيد»
  view.update({audio:[{id:1,label:'jpn',lang:'jpn'}]});
  expect(audio.hidden).toBe(false);
  view.open.more();
  expect([...view.root.querySelector('.pp-sheet').querySelectorAll('button')].some(b=>b.textContent.includes('jpn'))).toBe(false);
  // «الإعدادات المتقدمة» حُذفت (قرار المالك): لا شاشة منفصلة؛ الترجمة الإضافية في لوحة الترجمة
  expect(view.root.querySelector('.pp-sheet').textContent).not.toContain('الإعدادات المتقدمة');
});

it('keeps server buttons mounted during cloned progress snapshots so scrolling and clicks survive',()=>{
 const {view}=fixture();const routes=[{id:'r',state:'READY',sourceName:'Torrentio',quality:2160,candidates:['c']}];
 view.update({ready:true,candidate:'other',routes,routesDone:true});view.open.servers();
 const body=view.root.querySelector('.pp-sheet__body'),button=body.querySelector('.pp-route');body.scrollTop=320;
 view.update({position:1000,routes:structuredClone(routes),candidate:'other',ready:true});
 expect(body.querySelector('.pp-route')).toBe(button);expect(body.scrollTop).toBe(320);
});
it('keeps subtitle adjustment buttons mounted across transport snapshots',()=>{
 const {view}=fixture();const tracks=[{id:1,label:'العربية',selected:true}];view.update({subtitles:tracks,subtitleDelay:0});view.open.subtitles();
 [...view.root.querySelectorAll('button')].find(b=>b.textContent==='الضبط').click();
 const before=[...view.root.querySelectorAll('button')].find(b=>b.textContent==='أتأخر 0.5');
 view.update({position:1000,subtitles:structuredClone(tracks),subtitleDelay:0});
 expect([...view.root.querySelectorAll('button')].find(b=>b.textContent==='أتأخر 0.5')).toBe(before);
});

it('network metrics are a normal part of the player, independent of the diagnostics toggle (owner, 14 Nov)',()=>{
 vi.spyOn(diagnosticsUi,'visible').mockReturnValue(false);
 const {view,send}=fixture();
 const net={openAt:0,stages:{'engine-start':300,downloading:2100,'player-start':2600,ready:3900},torrentBps:1750000,peers:58,seeds:45,aheadMs:41000,inputBps:1690000,videoBps:4200000,videoHeight:1080};
 view.update({ready:true,paused:true,net,serverCode:'TR',skipStatus:'المقدمة 1:30–3:00'});
 view.open.more();
 const more=view.root.querySelector('.pp-sheet');
 // ترتيب الـAPK: التخطي ثم الشبكة، بلا تكرار لأزرار الشريط العلوي
 expect([...more.querySelectorAll('.pp-row-item strong')].map(n=>n.textContent)).toEqual(['تخطي المقدمة والنهاية','الشبكة']);
 [...more.querySelectorAll('button')].find(b=>b.textContent.includes('الشبكة')).click();
 const sheet=view.root.querySelector('.pp-sheet');
 expect(sheet.dataset.kind).toBe('network');
 const rows=Object.fromEntries([...sheet.querySelectorAll('.pp-metric')].map(r=>[r.querySelector('span').textContent,r.querySelector('b').textContent]));
 expect(rows['تجهيز التورنت']).toBe('1800 ms');
 expect(rows['جاهز أمامك']).toBe('41 ثانية');
 expect(rows['مشاركون متصلون']).toBe('58 (زارعون 45)');
 expect(rows['تحميل التورنت']).toBe('14.0 Mbps');
 expect(rows['الفيديو']).toBe('1080p · 4.2 Mbps');
 expect(rows['السيرفر']).toBe('TR');
 expect(sheet.querySelector('.pp-metric--bad span').textContent).toBe('تجهيز التورنت');
 // شريحة القياس فوق الفيديو تُفعّل من اللوحة وتبقى بعد الإغلاق
 expect(view.root.querySelector('.pp-netchip').hidden).toBe(true);
 [...sheet.querySelectorAll('button')].find(b=>b.textContent.includes('إظهار القياس فوق الفيديو')).click();
 expect(view.root.querySelector('.pp-netchip').hidden).toBe(false);
 view.closeSheet();view.update({position:1000});
 expect(view.root.querySelector('.pp-netchip').textContent).toContain('58 مشارك');
 expect(send).not.toHaveBeenCalledWith({name:'settings'});
 try{localStorage.removeItem('vantara.player.netChip');}catch{}
});

it('extra subtitles load from an https link inside the subtitles popover, like the APK',()=>{
 const {view,send}=fixture();view.update({subtitles:[]});view.open.subtitles();
 const form=view.root.querySelector('.pp-url'),input=form.querySelector('input');
 input.value='https://example.com/a.srt';form.onsubmit({preventDefault(){}});
 expect(send).toHaveBeenCalledWith({name:'subtitle-load',value:'https://example.com/a.srt'});
});

it('شاشة التحميل كالـAPK: الشعار يمتلئ من اليسار بقدر التقدم ثم تتلاشى عند أول إطار',()=>{
  const {view}=fixture();
  view.update({ready:false,title:'Frieren',art:{backdrop:'https://img/bg.jpg',logo:'https://img/logo.png'},loadProgress:.4,loadEpoch:1});
  const stage=view.root.querySelector('.pp-stage');
  expect(stage.hidden).toBe(false);expect(stage.classList.contains('pp-stage--startup')).toBe(true);
  expect(view.root.querySelector('.pp-stage__bg').getAttribute('src')).toBe('https://img/bg.jpg');
  expect(view.root.querySelector('.pp-stage__fill').style.clipPath).toBe('inset(0 60% 0 0)');
  expect(view.root.querySelector('.pp-spinner').hidden).toBe(true);
  view.update({loadProgress:.2});
  expect(view.root.querySelector('.pp-stage__fill').style.clipPath).toBe('inset(0 60% 0 0)');
  view.update({ready:true,paused:false});
  expect(stage.classList.contains('pp-stage--out')).toBe(true);
  vi.advanceTimersByTime(320);expect(stage.hidden).toBe(true);
});
it('بلا شعار: الاسم بعد نصف ثانية لا فورًا، والروابط غير الآمنة لا تُحمَّل',()=>{
  const {view}=fixture();
  view.update({ready:false,title:'Blue Lock',art:{backdrop:'http://img/bg.jpg',logo:null}});
  const name=view.root.querySelector('.pp-stage__name');
  expect(name.hidden).toBe(true);vi.advanceTimersByTime(520);expect(name.hidden).toBe(false);
  expect(name.textContent).toBe('Blue Lock');
  expect(view.root.querySelector('.pp-stage__bg').getAttribute('src')).toBeNull();
});
it('التوقف أثناء المشاهدة: بعد 450ms فقط، والشعار كامل يومض، والخطأ يخفي الشاشة ليظهر زر الإعادة',()=>{
  const {view}=fixture();
  view.update({ready:true,paused:false,buffering:false,title:'X'});
  const stage=view.root.querySelector('.pp-stage');
  view.update({buffering:true});vi.advanceTimersByTime(300);expect(stage.hidden).toBe(true);
  vi.advanceTimersByTime(200);expect(stage.hidden).toBe(false);expect(stage.classList.contains('pp-stage--stalled')).toBe(true);
  expect(view.root.querySelector('.pp-stage__fill').style.clipPath).toBe('inset(0 0% 0 0)');
  view.update({ready:false,buffering:false,status:{text:'تعذّر',error:true}});
  expect(stage.hidden).toBe(true);expect(view.root.querySelector('.pp-retry').hidden).toBe(false);
});

it('auto-next like the APK: countdown card at the end, plays the next episode, cancel and settings work',()=>{
 const {view,send}=fixture();
 view.update({ready:true,paused:false,episode:3,total:12,ended:false});
 view.update({ended:true});
 const card=view.root.querySelector('.pp-next');
 expect(card.hidden).toBe(false);
 expect(card.textContent).toContain('الحلقة 4');
 expect(card.textContent).toContain('تبدأ خلال 10 ث');
 vi.advanceTimersByTime(10000);
 expect(send).toHaveBeenCalledWith({name:'episode',value:4});
 expect(card.hidden).toBe(true);
 // إلغاء
 send.mockClear();view.update({ended:false,episode:4});view.update({ended:true});
 [...card.querySelectorAll('button')].find(b=>b.textContent==='إلغاء').click();
 vi.advanceTimersByTime(20000);
 expect(send).not.toHaveBeenCalledWith({name:'episode',value:5});
 // الإعداد من «المزيد»: إيقاف ⇒ لا بطاقة
 view.open.more();
 [...view.root.querySelectorAll('.pp-sheet button')].find(b=>b.textContent==='إيقاف').click();
 view.closeSheet();view.update({ended:false});view.update({ended:true});
 expect(card.hidden).toBe(true);
 try{localStorage.removeItem('vantara.player.autoNext');}catch{}
});

it('auto-next never fires in a watch-together room, for a movie, or on the last episode',()=>{
 for(const s of [{together:true,episode:1,total:3},{movie:true,episode:1,total:1},{episode:3,total:3}]){
  const {view,send}=fixture();view.update({ready:true,...s,ended:false});view.update({ended:true});
  expect(view.root.querySelector('.pp-next').hidden).toBe(true);vi.advanceTimersByTime(20000);
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({name:'episode'}));
 }
});

it('recommend popover: «الجميع» then friends, sends and confirms (PlayerActivity.pickFriend)',()=>{
 const {view,send}=fixture();
 view.update({ready:true,episode:5,total:12,canRecommend:true,friends:[{userId:'u2',displayName:'سارة'}]});
 view.open.more();
 [...view.root.querySelectorAll('.pp-sheet button')].find(b=>b.textContent.includes('رشّح الحلقة لصديق')).click();
 const sheet=view.root.querySelector('.pp-sheet');
 expect(sheet.dataset.kind).toBe('recommend');
 expect([...sheet.querySelectorAll('.pp-row-item strong')].map(n=>n.textContent)).toEqual(['الجميع','سارة']);
 [...sheet.querySelectorAll('button')].find(b=>b.textContent.includes('سارة')).click();
 expect(send).toHaveBeenCalledWith({name:'recommend',value:'u2'});
 expect(view.root.querySelector('.pp-toast').textContent).toBe('انرسلت لـ سارة');
 view.update({canRecommend:false});view.open.more();
 expect(view.root.querySelector('.pp-sheet').textContent).not.toContain('رشّح');
});
