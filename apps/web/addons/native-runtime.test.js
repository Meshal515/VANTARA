import { afterEach, expect, it, vi } from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.resetModules();});
const setup=async(manifest)=>{
  vi.resetModules();
  const memory=new Map();
  vi.stubGlobal('localStorage',{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)});
  vi.stubGlobal('Capacitor',{Plugins:{AddonEngine:{request:async()=>({text:JSON.stringify(manifest)}),cancel:async()=>{}}}});
  const {getNativeAddonRuntime}=await import('./native-runtime.js');
  const a=getNativeAddonRuntime();await a.ready;
  const p=await a.registry.inspect('https://addon.test/manifest.json');await a.registry.install(p);
  return {a,key:p.manifest.key};
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
