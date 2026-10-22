import { it, expect, afterEach, vi } from 'vitest';
import { createDesktopRuntime } from './runtime.js';
import { createDesktopFetcher } from './source-fetcher.js';
import { DOMParser } from 'linkedom';
afterEach(() => vi.unstubAllGlobals());

it('يشغل مصدر المانجا الأصلي ويعيد فصوله عبر النقل المحلي دون حساب بديل', async () => {
  vi.stubGlobal('DOMParser',DOMParser);
  const bridge = { platform:'windows', startPlayback:async()=>({started:true}),onEvent:()=>()=>{},requestResource:async({url})=>({status:200,url,text:JSON.stringify({feed:{entry:[{id:{$t:'post-1'},title:{$t:'Solo'},link:[{rel:'alternate',href:'https://source.blogspot.com/2026/solo.html'}],category:[{term:'Series'}],content:{$t:'<img src="https://images.example/solo.jpg">'}}]}})}) };
  const runtime = createDesktopRuntime({bridge, storage:null, definitions:[{id:'demo',label:'Demo',engine:'zeistmanga',version:1,content:'manga',domain:'source.blogspot.com',config:{},probe:{query:'solo'}}]});
  await runtime.ready;
  expect(runtime.registry.list('manga')).toMatchObject([{id:'demo',label:'Demo'}]);
  const result=await runtime.registry.call('demo',source=>source.search('solo',1));
  expect(result.mangas[0]).toMatchObject({title:'Solo'});
});

it('ينقل نموذج POST وترويسة المصدر ويمنع إرفاق Authorization للمصادر', async () => {
  let request;
  const fetcher=createDesktopFetcher({requestResource:async args=>{request=args;return{status:200,text:'ok',url:args.url};}});
  await fetcher.page('https://source.example/ajax',{form:{action:'chapters'},referer:'https://source.example/',xhr:true});
  expect(request).toMatchObject({method:'POST',body:'action=chapters',headers:{referer:'https://source.example/','x-requested-with':'XMLHttpRequest'}});
  expect(request.headers.authorization).toBeUndefined();
  await expect(fetcher.page('https://source.example/',{headers:{authorization:'Bearer account'}})).rejects.toThrow();
});
