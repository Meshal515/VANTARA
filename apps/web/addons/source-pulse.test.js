import { describe, expect, it, vi } from 'vitest';
import { createSourcePulse, pulseView } from './source-pulse.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

describe('نبض المصدر', () => {
  it('يسجّل النجاح والفراغ والفشل من طلبات حقيقية، والإلغاء ليس عطلًا', async () => {
    let t = 1000;
    const pulse = createSourcePulse({ storage: memory(), now: () => t });
    await pulse.measure('core|a', async () => { t += 800; return { mangas: [{url:'/one',title:'One'}, {url:'/two',title:'Two'}] }; });
    expect(pulse.get('core|a')).toMatchObject({ state: 'ok', ms: 800, items: 2, failures: 0 });
    await pulse.measure('core|b', async () => []);
    expect(pulse.get('core|b').state).toBe('empty');
    await expect(pulse.measure('core|c', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(pulse.get('core|c')).toMatchObject({ state: 'failed', failures: 1, error: 'boom' });
    await expect(pulse.measure('core|d', async () => { throw new DOMException('x', 'AbortError'); })).rejects.toThrow();
    expect(pulse.get('core|d')).toBeNull();
  });

  it('يبقى بين الجلسات على الجهاز', () => {
    const storage = memory();
    createSourcePulse({ storage }).record('core|a', 'ok', { ms: 10 });
    expect(createSourcePulse({ storage }).get('core|a').state).toBe('ok');
  });

  it('الإصلاح الذاتي: يعيد فحص الفاشل بمهلة تتضاعف، والسليم كل 30 دقيقة', () => {
    let t = 0;
    const pulse = createSourcePulse({ storage: memory(), now: () => t });
    expect(pulse.due('core|new')).toBe(true);
    pulse.record('core|a', 'ok', {items:1});
    t = 29 * 60_000; expect(pulse.due('core|a')).toBe(false);
    t = 30 * 60_000; expect(pulse.due('core|a')).toBe(true);
    t = 0;
    pulse.record('core|x', 'failed');
    t = 59_000; expect(pulse.due('core|x')).toBe(false);
    t = 60_000; expect(pulse.due('core|x')).toBe(true);
    pulse.record('core|x', 'failed'); // الثانية: دقيقتان
    t = 60_000 + 119_000; expect(pulse.due('core|x')).toBe(false);
    t = 60_000 + 120_000; expect(pulse.due('core|x')).toBe(true);
  });

  it('ما يراه المستخدم: يعمل بزمنه، متعثّر إن نجح قريبًا، لا يستجيب إن طال', () => {
    const now = 10 * 3600_000;
    expect(pulseView({ state: 'ok', items:1, at: now - 180_000, ms: 820 }, { now })).toEqual({ level: 'ok', label: 'يعمل', detail: '0.8 ث · قبل 3 د' });
    expect(pulseView({ state: 'failed', at: now, failures: 1, lastOkAt: now - 3600_000 }, { now }).label).toBe('متعثّر');
    expect(pulseView({ state: 'failed', at: now, failures: 3, lastOkAt: null }, { now })).toMatchObject({ level: 'failed', label: 'لا يستجيب', detail: 'الآن · 3 محاولات' });
    expect(pulseView(null).label).toBe('لم يُفحص بعد');
    expect(pulseView(null, { checking: true }).level).toBe('checking');
  });
});

it('ينهي الطلب العالق ولا يسمح لنتيجة متأخرة بتغيير حالة المصدر', async () => {
  vi.useFakeTimers();
  try {
    const pulse = createSourcePulse({ storage: memory() });
    let finish;
    const result = pulse.measure('core|slow', () => new Promise(r => { finish = r; }), { timeoutMs: 100 });
    const check = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(100);
    await check;
    expect(pulse.get('core|slow').state).toBe('failed');
    finish({ items: [1] });
    await Promise.resolve();
    expect(pulse.get('core|slow').state).toBe('failed');
  } finally { vi.useRealTimers(); }
});
it('إلغاء الفحص يفك الطلب حتى لو تجاهل المصدر إشارة الإلغاء', async () => {
  const pulse = createSourcePulse({ storage: memory() });
  const controller = new AbortController();
  const result = pulse.measure('core|slow', () => new Promise(() => {}), { signal: controller.signal });
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(pulse.get('core|slow')).toBeNull();
});

it.each([
  {status:200,text:'<html>Challenge</html>'},
  '<html>HTTP 200 challenge</html>',
  undefined,
  {items:'not-a-list'},
  {items:[{status:200}]},
  {items:['<html>Challenge</html>']},
])('لا يسجّل استجابة بلا أعمال صالحة بوصفها مصدرًا يعمل: %j',async(response)=>{
 const pulse=createSourcePulse({storage:memory()});
 await expect(pulse.measure('core|malformed',async()=>response)).rejects.toMatchObject({code:'INVALID_SOURCE_RESPONSE'});
 expect(pulse.get('core|malformed').state).toBe('failed');expect(pulseView(pulse.get('core|malformed')).label).not.toBe('يعمل');
});

it('يميز قائمة البحث الفارغة الصالحة عن قائمة محتوى صالحة دون تغيير رد المحرك',async()=>{
 const pulse=createSourcePulse({storage:memory()});const page={items:[{url:'/work/1',title:'عمل حقيقي',memo:{token:'keep'}}],hasNext:true};
 expect(await pulse.measure('core|valid',async()=>page)).toBe(page);expect(pulse.get('core|valid')).toMatchObject({state:'ok',items:1});
 const empty={mangas:[],hasNextPage:false};expect(await pulse.measure('core|empty',async()=>empty)).toBe(empty);expect(pulseView(pulse.get('core|empty'))).toMatchObject({level:'empty',label:'يستجيب بلا نتائج'});
});

it.each([
 {code:'challenge',challenge:'interactive'},
 {blocked:'cloudflare_interactive'},
 {needsHuman:true},
 {code:'CloudflareBypassException',interactive:true},
 {code:'eu.kanade.tachiyomi.network.interceptor.CloudflareBypassException',message:'Cloudflare wants a human check for source.example; open the site in the WebView to pass it'},
])('يعرض طلب تحقق مؤكد بحالة مستقلة ويحافظ على دليل النجاح السابق: %j',async(info)=>{
 const pulse=createSourcePulse({storage:memory(),now:()=>1000});pulse.record('core|verify','ok',{items:1});
 const error=Object.assign(new Error('confirmed verification'),info);
 await expect(pulse.measure('core|verify',async()=>{throw error;})).rejects.toBe(error);
 expect(pulse.get('core|verify')).toMatchObject({state:'verification',lastOkAt:1000,failures:0});
 expect(pulseView(pulse.get('core|verify'))).toMatchObject({level:'verification',label:'يحتاج تحققًا'});
});

it.each([{status:403},{code:'HTTP_403'},{code:'challenge',challenge:'managed'},{code:'CloudflareBypassException',interactive:false}])('لا يستنتج تحققًا بشريًا من حظر HTTP أو خطأ حماية عام: %j',async(info)=>{
 const pulse=createSourcePulse({storage:memory()});await expect(pulse.measure('core|blocked',async()=>{throw Object.assign(new Error('Forbidden Cloudflare'),info);})).rejects.toThrow();
 expect(pulse.get('core|blocked').state).toBe('failed');expect(pulseView(pulse.get('core|blocked')).level).toBe('failed');
});

it('لا يحول رد needsHuman المؤكد مع قائمة فارغة إلى نجاح بحث فارغ',async()=>{
 const pulse=createSourcePulse({storage:memory()});await expect(pulse.measure('core|verify',async()=>({needsHuman:true,items:[]}))).rejects.toMatchObject({code:'VERIFICATION_REQUIRED'});
 expect(pulse.get('core|verify').state).toBe('verification');
});

it('لا يعرض قياسًا قديمًا بلا دليل أعمال بوصفه يعمل ويعيد فحصه دون مسح بياناته',()=>{
 const storage=memory();const pulse=createSourcePulse({storage,now:()=>1000});pulse.record('core|legacy','ok');
 const reopened=createSourcePulse({storage,now:()=>1000});expect(reopened.get('core|legacy').state).toBe('ok');expect(pulseView(reopened.get('core|legacy')).level).toBe('unknown');expect(reopened.due('core|legacy')).toBe(true);
});

it('يطبق التحقق على browse الحقيقي المغلف في runtime دون تغيير واجهة البحث الفارغ',async()=>{
 const {createAddonRuntime}=await import('./runtime.js');const {createStore}=await import('../pwa/cache/store.js');
 const pulse=createSourcePulse({storage:memory()});let response={status:200,text:'<html>Challenge</html>'};
 const source={latest:async()=>response,search:async()=>response};const descriptor={id:'native-reader',label:'Reader',content:'manga',version:'1.0',domain:'source.example'};
 const runtime=createAddonRuntime({pulse,store:createStore({indexedDB:null}),runtime:{native:true,ready:Promise.resolve(),registry:{list:()=>[descriptor],def:()=>descriptor,source:()=>source,call:(_id,invoke)=>invoke(source)}}});
 await runtime.ready;const adapter=runtime.adapter('core|native-reader');
 await expect(adapter.home(1)).rejects.toMatchObject({code:'INVALID_SOURCE_RESPONSE'});expect(pulseView(pulse.get('core|native-reader')).level).toBe('failed');
 response={mangas:[],hasNextPage:false};expect(await adapter.search('no matches',1)).toBe(response);expect(pulseView(pulse.get('core|native-reader')).level).toBe('empty');
});
