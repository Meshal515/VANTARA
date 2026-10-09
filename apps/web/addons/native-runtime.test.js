import { afterEach, expect, it, vi } from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.resetModules();});
const setup=async(manifest,extraPlugins={},response=()=>manifest)=>{
  vi.resetModules();
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
