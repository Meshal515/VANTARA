import { afterEach, expect, it, vi } from 'vitest';
const fixtures=vi.hoisted(()=>({runtime:null,pwaPlugin:null}));
vi.mock('../pwa/platform.js',()=>({isNative:()=>globalThis.Capacitor?.isNativePlatform?.()===true,webPlugin:()=>fixtures.pwaPlugin}));
vi.mock('../addons/runtime.js',()=>({getAddonRuntime:async()=>fixtures.runtime}));
afterEach(()=>{fixtures.pwaPlugin=null;vi.unstubAllGlobals();vi.resetModules();});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function setup(pending) {
 const calls=[];
 const manifest={key:'provider',name:'Provider',enabled:true,protocol:'stremio',capabilities:['streams'],resources:[{name:'stream',types:['series'],idPrefixes:['tt']}],types:['series'],bundled:false,compatibility:{apk:true,pwa:false}};
 fixtures.runtime={ready:Promise.resolve(),runtimeName:'apk',nativeCapabilities:()=>({addonStreams:true,torrentSupported:true}),registry:{list:()=>[manifest],connection:()=>({manifestUrl:'https://provider.test/settings/manifest.json'})},adapter:()=>({streams:()=>pending.promise}),sources:{source:()=>null}};
 const plugin={configure:async()=>({ok:true}),prepare:async args=>{calls.push(['prepare',args]);return {session:args.session,routes:[],done:false};},appendAddonStreams:async args=>calls.push(['append',args]),closeSession:async()=>calls.push(['close']),extend:async args=>{calls.push(['extend',args]);return {added:args.copies.length};},extendAddonSources:async args=>{calls.push(['reserve',args]);return {added:args.sourceIds.length};}};
 vi.stubGlobal('Capacitor',{getPlatform:()=> 'android',isNativePlatform:()=>true,Plugins:{AnimeEngine:plugin,AddonEngine:{}}});
 vi.stubGlobal('fetch',async()=>({json:async()=>({sources:[]})}));
 return {api:await import('./anime-engine.js'),calls,plugin};
}
const identity={kind:'series',externalIds:{imdb:'tt123'},season:1,episode:1};
it('reserves native addon batches before starting source preparation and returns without waiting for providers',async()=>{
 const pending=deferred();const {api,calls}=await setup(pending);
 const out=await api.prepare({copies:[{sourceId:'native',url:'/work'}],identity,episode:1,session:'test'});
 expect(out.copies.map(c=>c.sourceId)).toEqual(['native','addon|provider']);
 expect(calls[0][1]).toMatchObject({copies:[{sourceId:'native',url:'/work'}],addonSources:['addon|provider'],addonProviders:[{sourceId:'addon|provider',videoId:'tt123:1:1'}]});
 expect(calls).toHaveLength(1);
 pending.resolve([{url:'https://cdn.test/a.mp4',status:'RESOLVED'}]);await new Promise(r=>setTimeout(r,0));
 expect(calls[1]).toMatchObject(['append',{session:'test',sourceId:'addon|provider'}]);
});
it('closing a native session cancels pending results instead of leaking into a later episode',async()=>{
 const pending=deferred();const {api,calls}=await setup(pending);
 await api.prepare({copies:[],identity,episode:1,session:'test'});await api.closeSession('test');
 pending.resolve([{url:'https://cdn.test/old.mp4',status:'RESOLVED'}]);await new Promise(r=>setTimeout(r,0));
 expect(calls.map(x=>x[0])).toEqual(['prepare','close']);
});
it('adds a late discovered native provider to the same session instead of sending it to an unknown source adapter',async()=>{
 const pending=deferred();const {api,calls}=await setup(pending);
 await api.prepare({copies:[{sourceId:'native',url:'/work'}],episode:1,session:'test'});
 const copies=await api.withAddonCopies([],identity);
 expect(await api.extend('test',copies)).toBe(1);
 expect(calls.find(x=>x[0]==='reserve')[1]).toMatchObject({session:'test',sourceIds:['addon|provider']});
 expect(calls.some(x=>x[0]==='extend'&&x[1].copies.some(c=>c.sourceId.startsWith('addon|')))).toBe(false);
 pending.resolve([]);await new Promise(r=>setTimeout(r,0));
});
it('does not launch addons if the user closes while native prepare is still pending',async()=>{
 const pending=deferred(),prepared=deferred();const {api,calls,plugin}=await setup(pending);
 plugin.prepare=async args=>{calls.push(['prepare',args]);return prepared.promise;};
 const preparing=api.prepare({copies:[],identity,episode:1,session:'race'});
 await new Promise(r=>setTimeout(r,0));
 await api.closeSession('race');prepared.resolve({session:'race',routes:[],done:false});await preparing;
 pending.resolve([{url:'https://cdn.test/stale.mp4',status:'RESOLVED'}]);await new Promise(r=>setTimeout(r,0));
 expect(calls.some(x=>x[0]==='append')).toBe(false);
});
it('attaches a generation to native addon publication so a reused session ID cannot accept a stale RPC',async()=>{
 const pending=deferred();const {api,calls}=await setup(pending);
 await api.prepare({copies:[],identity,episode:1,session:'gen'});
 const generation=calls[0][1].addonGeneration;
 expect(typeof generation).toBe('string');expect(generation.length).toBeGreaterThan(10);
 pending.resolve([]);await new Promise(r=>setTimeout(r,0));
 expect(calls[1][1].addonGeneration).toBe(generation);
});
it('releases the addon snapshot when the native player closes or moves to another episode',async()=>{
 const pending=deferred();const {api,calls,plugin}=await setup(pending);let listener;const release=vi.fn();
 fixtures.runtime.registry.snapshot=()=>({release});
 plugin.addListener=async (name,fn)=>{if(name==='sessionClosed')listener=fn;return {remove(){}};};
 await api.prepare({copies:[],identity,episode:1,session:'native-close'});
 const generation=calls[0][1].addonGeneration;
 listener({session:'native-close',addonGeneration:'different'});expect(release).not.toHaveBeenCalled();
 listener({session:'native-close',addonGeneration:generation});expect(release).toHaveBeenCalledTimes(1);
 pending.resolve([]);await new Promise(r=>setTimeout(r,0));expect(calls.some(x=>x[0]==='append')).toBe(false);
});
it('does not retain an addon snapshot when native prepare rejects',async()=>{
 const pending=deferred();const {api,plugin}=await setup(pending);const release=vi.fn();
 fixtures.runtime.registry.snapshot=()=>({release});plugin.prepare=async()=>{throw new Error('prepare failed');};
 await expect(api.prepare({copies:[],identity,episode:1,session:'error'})).rejects.toThrow('prepare failed');
 expect(release).toHaveBeenCalledTimes(1);
});
it('starts regular anime preparation without waiting for exact-ID mapping and adds the provider later',async()=>{
 const pending=deferred(), mapping=deferred();const {api,calls}=await setup(pending);
 fixtures.runtime.registry.list=()=>[{key:'provider',name:'Provider',enabled:true,protocol:'stremio',capabilities:['streams'],resources:[{name:'stream',types:['series'],idPrefixes:['kitsu:']}],bundled:false,compatibility:{apk:true}}];
 fixtures.runtime.enrichAnimeIdentity=()=>mapping.promise;
 const anime={canonicalId:'anime:21',kind:'anime',format:'TV',externalIds:{anilist:'21'},episode:2};
 const out=await api.prepare({copies:[{sourceId:'native',url:'/work'}],identity:anime,episode:2,session:'deferred-anime'});
 expect(out.session).toBe('deferred-anime');expect(calls[0][1].addonSources).toEqual([]);
 mapping.resolve({...anime,externalIds:{anilist:'21',kitsu:'12'}});await new Promise(r=>setTimeout(r,0));
 expect(calls.find(x=>x[0]==='reserve')).toBeTruthy();
 pending.resolve([]);await new Promise(r=>setTimeout(r,0));
 expect(calls.find(x=>x[0]==='append')[1].provider.videoId).toBe('kitsu:12:2');
});
it('refreshes an existing exact Kitsu copy for the selected episode instead of retaining episode one',async()=>{
 const {api}=await setup(deferred());
 fixtures.runtime.registry.list=()=>[{key:'provider',enabled:true,protocol:'stremio',capabilities:['streams'],resources:[{name:'stream',types:['series'],idPrefixes:['kitsu:']}]}];
 const identity={kind:'anime',format:'TV',episode:2,externalIds:{kitsu:'12'}};
 const copies=await api.withAddonCopies([{sourceId:'addon|provider',id:'kitsu:12',url:'kitsu:12',identity:{...identity,episode:1}}],identity);
 expect(copies[0].identity.episode).toBe(2);
});

it('uses the same generated PWA session when deferred addon discovery finishes',async()=>{
 const pending=deferred(), mapping=deferred();const {api,calls,plugin}=await setup(pending);
 vi.stubGlobal('Capacitor',undefined);fixtures.pwaPlugin=plugin;fixtures.runtime.runtimeName='pwa';
 fixtures.runtime.registry.list=()=>[{key:'provider',enabled:true,protocol:'stremio',capabilities:['streams'],resources:[{name:'stream',types:['series'],idPrefixes:['kitsu:']}]}];
 fixtures.runtime.enrichAnimeIdentity=()=>mapping.promise;
 const identity={kind:'anime',format:'TV',canonicalId:'anime:21',externalIds:{anilist:'21'}};
 const out=await api.prepare({copies:[{sourceId:'native',url:'/work'}],identity,episode:2});
 expect(out.session).toBe(calls[0][1].session);expect(out.session).toMatch(/^s-/);
 mapping.resolve({...identity,episode:2,externalIds:{anilist:'21',kitsu:'12'}});await new Promise(r=>setTimeout(r,0));
 expect(calls.find(x=>x[0]==='extend')[1]).toMatchObject({session:out.session,copies:[{sourceId:'addon|provider',identity:{episode:2}}]});
 await api.closeSession(out.session);
});
