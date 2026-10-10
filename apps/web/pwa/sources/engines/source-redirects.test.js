import {beforeAll,it,expect,vi} from 'vitest';
import {DOMParser} from 'linkedom';
import {setParser} from '../dom.js';
import {tuktuk} from './tuktuk.js';
import {egydead} from './egydead.js';
beforeAll(()=>setParser((s,t='text/html')=>new DOMParser().parseFromString(s,t)));
it('TukTuk resolves the verified landing destination and keeps search and subsequent episode requests there',async()=>{
 const page=vi.fn(async url=>url.startsWith('https://tuktukhd.com')?{url:'https://web2.tuktuk-sa.online/',text:`<a class="go-stream" data-link="${btoa('https://zx33.tuktuk-sa.online')}">Watch</a>`}:{url,text:'<div class="Block--Item"><a href="/film" title="Film"><img src="/poster.jpg"></a></div>'});
 const engine=tuktuk.create({id:'tuk',domain:'tuktukhd.com'},{fetch:{page},hosts:{}});
 const items=await engine.search('dune');expect(items).toHaveLength(1);expect(page.mock.calls[1][0]).toBe('https://zx33.tuktuk-sa.online/?s=dune');
 await engine.servers({url:'/film',name:'Film'});expect(page.mock.calls.at(-1)[0]).toBe('https://zx33.tuktuk-sa.online/film');
});
it('TukTuk refuses a landing link to an unrelated or private destination',async()=>{
 for(const url of ['https://evil.test/','http://127.0.0.1/','https://tuktuk-sa.online.evil.test/']){
  const page=vi.fn(async()=>({url:'https://tuktukhd.com/',text:`<a class="go-stream" data-link="${btoa(url)}">Watch</a>`}));
  await expect(tuktuk.create({domain:'tuktukhd.com'},{fetch:{page},hosts:{}}).latest()).rejects.toThrow();expect(page).toHaveBeenCalledTimes(1);
 }
});
it('EgyDead resolves paths relative to the final source origin after a verified redirect',async()=>{
 const page=vi.fn(async url=>({url:'https://k8w4e.sbs/h3/',text:'<li class="movieItem"><a href="/film" title="Film"><img src="/poster.jpg"></a></li>'}));
 const engine=egydead.create({id:'egy',domain:'tv10.egydead.live'},{fetch:{page},hosts:{}});
 const items=await engine.latest();expect(items[0].thumbnail).toBe('https://k8w4e.sbs/poster.jpg');await engine.servers({url:'/film',name:'Film'});expect(page.mock.calls.at(-1)[0]).toBe('https://k8w4e.sbs/film');
});
