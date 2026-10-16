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
