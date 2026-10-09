import {expect,it,vi} from 'vitest';
vi.mock('../addons/runtime.js',()=>({getAddonRuntime:async()=>({ready:Promise.resolve(),registry:{list:()=>[{key:'demo',enabled:true,protocol:'stremio',capabilities:['streams'],resources:[{name:'stream',types:['series']}],types:['series'],idPrefixes:[],name:'Demo'}]}})}));
vi.mock('../pwa/platform.js',()=>({webPlugin:()=>null,isNative:()=>false}));
import {prepare,firstAvailableCopies} from './anime-engine.js';
it('returns effective addon copies to the caller for subsequent episodes',async()=>{
 const plugin={configure:async()=>({ok:true}),prepare:async()=>({session:'s',routes:[]})};globalThis.Capacitor={Plugins:{AnimeEngine:plugin}};vi.stubGlobal('fetch',async()=>({json:async()=>({})}));
 try {const out=await prepare({copies:[],episode:1,identity:{kind:'series',externalIds:{imdb:'tt1196946'},season:2,episode:1}});expect(out.copies[0]).toMatchObject({sourceId:'addon|demo',requestedSeason:2,episode:1});}finally{delete globalThis.Capacitor;vi.unstubAllGlobals();}
});
it('starts confirmed addon copies while the core locator is still pending',async()=>{
 const fast=[{sourceId:'addon|demo',url:'tt1196946'}];expect(await firstAvailableCopies(new Promise(()=>{}),Promise.resolve(fast))).toEqual({copies:fast});
});
it('waits for the core locator when the addon identity has no eligible provider',async()=>{
 const found={copies:[{sourceId:'core',url:'/work'}]};expect(await firstAvailableCopies(Promise.resolve(found),Promise.resolve([]))).toBe(found);
});
it('does not let an empty fast core result suppress confirmed addon copies',async()=>{
 expect(await firstAvailableCopies(Promise.resolve({copies:[]}),Promise.resolve([{sourceId:'addon|demo'}]))).toEqual({copies:[{sourceId:'addon|demo'}]});
});
