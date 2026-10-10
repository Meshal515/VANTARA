import {beforeAll,it,expect} from 'vitest';
import {DOMParser} from 'linkedom';
import {setParser} from '../dom.js';
import {witanime} from './witanime.js';
beforeAll(()=>setParser((s,t='text/html')=>new DOMParser().parseFromString(s,t)));
const watch='<meta name="csrf-token" content="test-csrf"><script>sourcesUrl: "/watch/test/1/sources"</script>';
it('reports source POST failures instead of claiming that a blocked source has no servers',async()=>{
 const engine=witanime.create({id:'wit',domain:'witanime.site'},{fetch:{page:async(u,o)=>{if(o?.method==='POST')throw Error('HTTP 404');return {url:u,text:watch};}},hosts:{}});
 await expect(engine.servers({url:'/watch/test/1',name:'episode'})).rejects.toThrow('HTTP 404');
});
it('rejects malformed server payloads while permitting an actual empty players object',async()=>{
 for(const body of ['not JSON','{"message":"Not Found"}']){
  const engine=witanime.create({domain:'witanime.site'},{fetch:{page:async(u,o)=>({url:u,text:o?.method==='POST'?body:watch})},hosts:{}});
  await expect(engine.servers({url:'/watch/test/1'})).rejects.toThrow();
 }
 const engine=witanime.create({domain:'witanime.site'},{fetch:{page:async(u,o)=>({url:u,text:o?.method==='POST'?'{"players":{}}':watch})},hosts:{}});
 expect(await engine.servers({url:'/watch/test/1'})).toEqual([]);
});
