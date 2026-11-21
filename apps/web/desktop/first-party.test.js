import {it,expect} from 'vitest';
import {installFirstPartyTransport} from './first-party.js';
it('المتصفح يرسل حساب فانتارا إلى النقل الأصلي ويبقي إضافات HTTPS مستقلة',async()=>{
  const native=[],web=[];const g={fetch:async(...args)=>{web.push(args);return new Response('{}');},VantaraDesktop:{requestFirstParty:async args=>{native.push(args);return{status:200,text:'{"accounts":[]}',headers:{'content-type':'application/json'}};}}};
  installFirstPartyTransport(g);
  expect(await(await g.fetch('https://vantara-sync.ngm-309.workers.dev/v1/accounts',{headers:{authorization:'Bearer fixture'}})).json()).toEqual({accounts:[]});
  await g.fetch('https://torrentio.strem.fun/manifest.json');
  expect(native).toHaveLength(1);expect(web).toHaveLength(1);
  await g.fetch('https://vantara-sync.ngm-309.workers.dev/v1/media',{method:'POST',headers:{'content-type':'image/png'},body:new Uint8Array([0,255,137,80])});
  expect(native[1].bodyBase64).toBe('AP+JUA==');
});

it('خادم بديل من الإعدادات يمر بالنقل الأصلي بعد إعلانه للعملية الرئيسية، والأصلي يخرج كطلب عادي', async () => {
  const native = [], web = [], declared = [];
  const g = { fetch: async (...a) => { web.push(a); return new Response('{}'); }, VantaraDesktop: { setFirstPartyOrigin: async (x) => { declared.push(x); return true; }, requestFirstParty: async (a) => { native.push(a); return { status: 200, text: '{}', headers: {} }; } } };
  installFirstPartyTransport(g, { server: () => 'https://my-sync.example.workers.dev' });
  await g.fetch('https://my-sync.example.workers.dev/v1/sync');
  expect(declared).toEqual([{ origin: 'https://my-sync.example.workers.dev' }]);
  expect(native.map((x) => x.url)).toEqual(['https://my-sync.example.workers.dev/v1/sync']);
  await g.fetch('https://vantara-sync.ngm-309.workers.dev/v1/sync');
  expect(web).toHaveLength(1);
});
