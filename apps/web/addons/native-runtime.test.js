import { afterEach, expect, it, vi } from 'vitest';
import { nativeStore } from './native-runtime.js';
import { createStore, SPACES } from '../pwa/cache/store.js';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.resetModules();});
// حساب موجود قبل فصل المصادر المدمجة: يرى المصادر نفسها (lib/source-entitlement.js)
const account=async(created_at)=>{const e=await import('../lib/source-entitlement.js');e.setEntitlement(e.decide({account:{user_id:'u',created_at}}));return e;};
const setup=async(manifest,extraPlugins={},response=()=>manifest,createdAt=Date.UTC(2026,0,1))=>{
  vi.resetModules();
  await account(createdAt);
  const memory=new Map();
  vi.stubGlobal('localStorage',{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)});
  const requests=[];
  vi.stubGlobal('Capacitor',{Plugins:{AddonEngine:{request:async input=>{requests.push(input);return {text:JSON.stringify(input.url.endsWith('manifest.json')?manifest:response(input.url))};},cancel:async()=>{}},...extraPlugins}});
  const {getNativeAddonRuntime}=await import('./native-runtime.js');
  const a=getNativeAddonRuntime();await a.ready;
  const p=await a.registry.inspect('https://addon.test/manifest.json');await a.registry.install(p);
  return {a,key:p.manifest.key,requests};
};
const manifest={id:'org.sub',name:'Sub',version:'1.0.0',resources:['subtitles'],types:['movie'],catalogs:[]};
it('waits for the selected account before collecting optional CloudStream sources',async()=>{
  let selected='local';const calls=[];
  const runtimePlugin={capabilities:async()=>({cloudstream:true,platform:'android'}),setProfile:async({profile})=>{await Promise.resolve();selected=profile;calls.push(profile);},
    list:async()=>({repos:[],installed:[]}),addRepository:async()=>{},removeRepository:async()=>{},extensions:async()=>({extensions:[]}),install:async()=>{},uninstall:async()=>{},enable:async()=>{}};
  vi.stubGlobal('fetch',async()=>({json:async()=>({sources:[]})}));
  const {a}=await setup(manifest,{VantaraRuntime:runtimePlugin,AnimeEngine:{configure:async()=>{},capabilities:async()=>({}),sources:async()=>({sources:selected==='local'?[]:[{id:'addon|cs3|cs3_'+selected+'|provider',name:'Owned source',content:'anime',enabled:true,user:true,pkg:'cs3_'+selected}]})}});
  a.registry.setProfile('one');await a.reloadSources();
  expect(a.sources.list('anime').map(x=>x.id)).toEqual(['addon|cs3|cs3_one|provider']);
  a.registry.setProfile('two');await a.reloadSources();
  expect(a.sources.list('anime').map(x=>x.id)).toEqual(['addon|cs3|cs3_two|provider']);
  expect(calls).toEqual(['one','two']);
});
it('routes the Team X catalogue through the existing native catalogue contract instead of latest',async()=>{
 const sourceId='eu.kanade.tachiyomi.extension.ar.teamx';
 const catalogue=vi.fn(async({page})=>({mangas:[{url:`/series/work-${page}`,title:`Catalogue ${page}`,memo:'native'}],hasNextPage:page===1}));
 const latest=vi.fn(async()=>({mangas:[],hasNextPage:false}));
 const prepare=vi.fn(async()=>({ok:true}));
 const {a}=await setup(manifest,{ExtensionEngine:{sources:async()=>({sources:[{id:sourceId,label:'Team X',version:'1.6.33'}]}),prepare,catalogue,latest}});
 const adapter=a.adapter(`core|${sourceId}`);
 expect(await adapter.catalogue(2)).toMatchObject({mangas:[{title:'Catalogue 2',memo:'native'}],hasNextPage:false});
 expect(catalogue).toHaveBeenCalledWith({sourceId,page:2});
 expect(latest).not.toHaveBeenCalled();
 expect(prepare).toHaveBeenCalledWith({sourceId});
 expect(await adapter.home(1)).toMatchObject({mangas:[]});
});
it('retains native declared versions and loaded manga domain instead of overwriting metadata',async()=>{
 vi.stubGlobal('fetch',async()=>{throw new Error('no remote configuration in this fixture');});
 const {a}=await setup(manifest,{
  AnimeEngine:{sources:async()=>({sources:[{id:'video',name:'Video',enabled:true,content:'anime',version:'1.6.7',lang:'ar',repo:'Video Repository'}]})},
  ExtensionEngine:{sources:async()=>({sources:[{id:'reader',label:'Reader',domain:'https://source.example',version:'1.6.8'}]})},
 });
 expect(a.sources.def('video')).toMatchObject({version:'1.6.7'});
 expect(a.sources.def('reader')).toMatchObject({domain:'https://source.example',version:'1.6.8'});
});
it('listing native subtitle providers does not consume a half-open request slot',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000);
  const {a,key}=await setup(manifest);
  for(let n=0;n<3;n++)a.registry.health.failure(key,'subtitles','apk','TIMEOUT');
  vi.setSystemTime(31001);
  expect(a.nativeSubtitleProviders()).toHaveLength(1);
  expect(a.nativeSubtitleProviders()).toHaveLength(1);
  expect(a.registry.health.state(key,'subtitles','apk').probing).toBe(false);
});
it('does not offer native stream routes when an older APK has no stream bridge',async()=>{
  const {a,key}=await setup({...manifest,resources:['catalog','stream'],catalogs:[{type:'movie',id:'top'}]});
  const source=a.sources.source(`addon|${key}`);
  expect(await source.servers({url:'tt1',type:'movie'})).toEqual([]);
  await expect(a.adapter(key).streams({type:'movie',videoId:'tt1'})).rejects.toMatchObject({code:'UNSUPPORTED_RESOURCE'});
  expect(a.nativeCapabilities()).toEqual({addonStreams:false,torrentSupported:false});
});
it('keeps native addons available when a bundled source initialization fails and uses measured bridge availability',async()=>{
  vi.stubGlobal('fetch',async()=>{throw new Error('core configure failed');});
  const {a,key}=await setup({...manifest,resources:['stream']},{AnimeEngine:{capabilities:async()=>({addonStreams:true,torrentSupported:true})}});
  expect(a.nativeCapabilities()).toEqual({addonStreams:true,torrentSupported:true});
  expect(a.sources.list('cinema')).toMatchObject([{id:`addon|${key}`}]);
  expect(await a.sources.source(`addon|${key}`).servers({url:'tt1',type:'movie'})).toHaveLength(1);
});
it('fails closed on a rejected native capability probe without suppressing catalog browsing',async()=>{
  vi.stubGlobal('fetch',async()=>{throw new Error('core configure failed');});
  const {a,key}=await setup({...manifest,resources:['catalog','stream'],catalogs:[{type:'movie',id:'top'}]},{AnimeEngine:{capabilities:async()=>{throw new Error('not implemented');}}});
  expect(a.nativeCapabilities()).toEqual({addonStreams:false,torrentSupported:false});
  expect(a.sources.list('cinema')).toHaveLength(1);
  expect(await a.sources.source(`addon|${key}`).servers({url:'tt1',type:'movie'})).toEqual([]);
});
it('routes configured native catalog, metadata and direct stream requests through AddonEngine only',async()=>{
  vi.stubGlobal('fetch',async()=>{throw new Error('core configure failed');});
  const {a,key,requests}=await setup({...manifest,resources:['catalog','meta','stream'],catalogs:[{type:'movie',id:'top'}]},
   {AnimeEngine:{capabilities:async()=>({addonStreams:true,torrentSupported:false})}},
   url=>url.includes('/catalog/')?{metas:[{id:'tt1254207',type:'movie',name:'Big Buck Bunny'}]}:url.includes('/meta/')?{meta:{id:'tt1254207',type:'movie',name:'Big Buck Bunny'}}:{streams:[{url:'https://cdn.test/bunny.mpd',name:'1080p'}]});
  const [work]=await a.adapter(key).catalog({type:'movie',id:'top'});
  const source=a.sources.source(`addon|${key}`);
  const [episode]=await source.episodes(work);const [server]=await source.servers(episode);
  expect(await source.streams(server)).toMatchObject([{type:'dash',quality:1080,status:'RESOLVED'}]);
  expect(requests.map(x=>new URL(x.url).pathname)).toEqual(['/manifest.json','/catalog/movie/top.json','/meta/movie/tt1254207.json','/stream/movie/tt1254207.json']);
  expect(requests.every(x=>x.requestId&&x.limit>0&&x.timeout>0)).toBe(true);
});
it('keeps native source listing scoped to its content section when external cinema is enabled',async()=>{
  vi.stubGlobal('fetch',async()=>({json:async()=>({sources:[]})}));
  const {a,key}=await setup({...manifest,resources:['stream']},{
    AnimeEngine:{capabilities:async()=>({addonStreams:true}),configure:async()=>{},sources:async()=>({sources:[{id:'anime-core',name:'Anime',enabled:true,content:'anime'}]})},
    ExtensionEngine:{sources:async()=>({sources:[{id:'manga-core',name:'Manga'}]})}
  });
  expect(a.sources.list('cinema').map(x=>x.id)).toEqual([`addon|${key}`]);
  expect(a.sources.list('anime').map(x=>x.id)).toEqual(['anime-core']);
  expect(a.sources.list('manga').map(x=>x.id)).toEqual(['manga-core']);
});
it('excludes required unconfigured native subtitle providers',async()=>{
  const {a}=await setup({...manifest,behaviorHints:{configurable:true,configurationRequired:true}});
  expect(a.nativeSubtitleProviders()).toEqual([]);
});
it('projects normalized resource rules without inheriting global prefixes or widening empty restrictions',async()=>{
 const {a}=await setup({...manifest,idPrefixes:['wrong'],resources:[{name:'subtitles',types:['movie']},{name:'subtitles',types:['series'],idPrefixes:[]}]});
 const providers=a.nativeSubtitleProviders();expect(providers).toHaveLength(1);expect(providers[0]).toMatchObject({types:['movie'],idPrefixes:[]});
});
it('preserves different native movie and series prefix rules rather than taking only the first resource',async()=>{
 const {a}=await setup({...manifest,resources:[{name:'subtitles',types:['movie'],idPrefixes:['tt']},{name:'subtitles',types:['series'],idPrefixes:['tt9']}]});
 const providers=a.nativeSubtitleProviders();expect(providers).toHaveLength(2);expect(providers.map(x=>[x.types,x.idPrefixes])).toEqual([[['movie'],['tt']],[['series'],['tt9']]]);
});
it('shows an extension installed from a repository right away, in any language, and keeps hidden fillers hidden',async()=>{
  vi.stubGlobal('fetch',async()=>{throw new Error('core configure failed');});
  const manga=[{id:'eu.kanade.tachiyomi.extension.ar.azora',name:'Azora',filler:false}];
  const {a}=await setup(manifest,{ExtensionEngine:{sources:async()=>({sources:manga})}});
  expect(a.registry.list().filter(x=>x.bundled).map(x=>x.sourceId)).toEqual(['eu.kanade.tachiyomi.extension.ar.azora']);
  manga.push({id:'eu.kanade.tachiyomi.extension.en.asura#1',name:'Asura',filler:true,user:true},{id:'eu.kanade.tachiyomi.extension.en.shipped',name:'Filler',filler:true});
  await a.reloadSources();
  const rows=a.registry.list().filter(x=>x.bundled);
  expect(rows.map(x=>x.sourceId)).toEqual(['eu.kanade.tachiyomi.extension.ar.azora','eu.kanade.tachiyomi.extension.en.asura#1']);
  expect(rows[1]).toMatchObject({user:true,contentTypes:['manga']});
});

it("APK addons move off the shared localStorage, keep installed addons, and drop the never-deleted response cache", async () => {
  const data = new Map([
    ["vantara.addons.native|state|addons.v1", JSON.stringify({ value: [{ id: "kept" }], expiresAt: 1e15 })],
    ["vantara.addons.native|source|addon|[1]", "x".repeat(5000)],
    ["vantara.addons.native|source|addon|[2]", "x".repeat(5000)],
    ["vantara.sync.library", "{}"],
  ]);
  const storage = {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); },
    removeItem: (k) => data.delete(k),
  };
  const store = nativeStore(storage, createStore({ indexedDB: null, spaces: { ...SPACES, state: { ttlMs: Infinity, maxBytes: 16 * 1024 * 1024, maxEntryBytes: 16 * 1024 * 1024 } } }));
  expect((await store.get("state", "addons.v1")).value).toEqual([{ id: "kept" }]);
  expect([...data.keys()]).toEqual(["vantara.sync.library"]);
  // localStorage ممتلئ لا يمنع حفظ الإضافات بعد الآن
  expect(await store.set("state", "addons.v1", [{ id: "kept" }, { id: "new", blob: "y".repeat(3 * 1024 * 1024) }])).toBe(true);
  expect((await store.get("state", "addons.v1")).value).toHaveLength(2);
  expect(store.failure()).toBe(null);
});
it('a new account sees zero formerly bundled manga sources but keeps what it installed, and adding one keeps its old id',async()=>{
  vi.stubGlobal('fetch',async()=>{throw new Error('core configure failed');});
  const manga=[{id:'eu.kanade.tachiyomi.extension.ar.azora',name:'Azora'},{id:'eu.kanade.tachiyomi.extension.en.asura#1',name:'Asura',user:true}];
  const prepare=vi.fn(async()=>({ok:true}));
  const {a}=await setup(manifest,{ExtensionEngine:{sources:async()=>({sources:manga}),prepare}},()=>manifest,Date.UTC(2027,0,1));
  expect(a.registry.list().filter(x=>x.bundled).map(x=>x.sourceId)).toEqual(['eu.kanade.tachiyomi.extension.en.asura#1']);
  expect(()=>a.adapter('core|eu.kanade.tachiyomi.extension.ar.azora')).toThrow(expect.objectContaining({code:'SOURCE_NOT_ADDED'}));
  expect(prepare).not.toHaveBeenCalled();
  const e=await import('../lib/source-entitlement.js');
  e.setEntitlement(e.decide({account:{user_id:'u',created_at:Date.UTC(2027,0,1)},settings:e.choicePatch('eu.kanade.tachiyomi.extension.ar.azora',true)}));
  await a.ready;await new Promise(r=>setTimeout(r,0));
  expect(a.registry.list().filter(x=>x.bundled).map(x=>x.sourceId).sort()).toEqual(['eu.kanade.tachiyomi.extension.ar.azora','eu.kanade.tachiyomi.extension.en.asura#1']);
});
