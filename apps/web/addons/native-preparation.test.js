import { expect, it } from 'vitest';
import { nativeAddonPreparation } from './native-preparation.js';

const manifest={key:'provider',name:'Provider',enabled:true,protocol:'stremio',capabilities:['streams']};
const copy={sourceId:'addon|provider',type:'series',id:'tt123',url:'tt123',requestedSeason:2,identity:{kind:'series',season:2,externalIds:{imdb:'tt123'}}};
const runtime=streams=>({registry:{list:()=>[manifest]},adapter:()=>({streams}),sources:{source:()=>null}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

it('publishes each native provider independently without waiting for another provider or starting playback', async()=>{
 const slow=deferred(), calls=[], fast={...manifest,key:'fast',name:'Fast'};
 const a=runtime(({videoId})=>{expect(videoId).toBe('tt123:2:3');return slow.promise;});
 a.registry.list=()=>[manifest,fast];a.adapter=k=>({streams:()=>k==='fast'?Promise.resolve([{id:'f',url:'https://cdn.test/a.mp4',status:'RESOLVED'}]):slow.promise});
 const plan=nativeAddonPreparation({runtime:a,copies:[copy,{...copy,sourceId:'addon|fast'}],episode:3});
 expect(plan.sourceIds).toEqual(['addon|provider','addon|fast']);
 const job=plan.start('session',{appendAddonStreams:async data=>calls.push(data)});
 await new Promise(r=>setTimeout(r,0));
 expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({sourceId:'addon|fast',session:'session',name:'Fast'});
 slow.resolve([]);await job.done;expect(calls).toHaveLength(2);
});
it('uses canonical season/episode stream identity directly instead of fetching meta from a stream provider',async()=>{
 let input;const calls=[];
 const plan=nativeAddonPreparation({runtime:runtime(async args=>{input=args;return [{id:'x',status:'RESOLVED',url:'https://cdn.test/a.mp4'}];}),copies:[copy],episode:3});
 await plan.start('s',{appendAddonStreams:async data=>calls.push(data)}).done;
 expect(input).toMatchObject({type:'series',videoId:'tt123:2:3'});expect(calls[0].streams).toHaveLength(1);
});
it('requests a provider-local episode by its own ID without a title-only identity guess',async()=>{
 let request;const a=runtime(()=>{throw new Error('must use provider facade');});
 a.sources.source=()=>({episodes:async()=>[{url:'private:wrong',number:1,season:1,type:'series'},{url:'private:correct',number:1,season:2,type:'series'}],servers:async ep=>[{url:ep.url}],streams:async server=>{request=server.url;return [];}});
 const plan=nativeAddonPreparation({runtime:a,copies:[{...copy,id:'private:work',url:'private:work',identity:null}],episode:1});
 await plan.start('s',{appendAddonStreams:async()=>{}}).done;
 expect(request).toBe('private:correct');
});
it('completes failed provider batches with a safe reason and preserves working siblings',async()=>{
 const calls=[];
 const plan=nativeAddonPreparation({runtime:runtime(async()=>{throw new Error('https://provider.test/private-token/stream.json');}),copies:[copy],episode:1});
 await plan.start('s',{appendAddonStreams:async data=>calls.push(data)}).done;
 expect(calls).toHaveLength(1);expect(calls[0].streams).toEqual([]);expect(calls[0].reason).not.toContain('private-token');
});
it('aborts addon network work and suppresses stale publication when a session is closed',async()=>{
 const pending=deferred(),calls=[];let signal;
 const plan=nativeAddonPreparation({runtime:runtime(args=>{signal=args.signal;return pending.promise;}),copies:[copy],episode:1});
 const job=plan.start('s',{appendAddonStreams:async data=>calls.push(data)});
 job.cancel();pending.resolve([{status:'RESOLVED',url:'https://cdn.test/old.mp4'}]);await job.done;
 expect(signal.aborted).toBe(true);expect(calls).toEqual([]);
});
it('does not request disabled, unconfigured or unsupported providers',()=>{
 const a=runtime(async()=>[]);a.registry.list=()=>[{...manifest,enabled:false}];
 expect(nativeAddonPreparation({runtime:a,copies:[copy],episode:1}).sourceIds).toEqual([]);
});
it('prepares a provider-local movie using its movie ID when cinema uses the -1 sentinel', async()=>{
 let id;const a=runtime(()=>{throw new Error('private movie must use its facade');});
 a.sources.source=()=>({episodes:async()=>[{url:'private:film',type:'movie',number:1}],servers:async ep=>[{url:ep.url}],streams:async server=>{id=server.url;return [];}});
 const plan=nativeAddonPreparation({runtime:a,copies:[{...copy,id:'private:film',url:'private:film',type:'movie',identity:null}],episode:-1});
 await plan.start('s',{appendAddonStreams:async()=>{}}).done;
 expect(id).toBe('private:film');
});
it('prepares exact anime Kitsu episodes and bare movie IDs with native-next descriptors', async()=>{
 let input; const calls=[]; const a=runtime(async args=>{input=args;return [];});
 a.registry.connection=()=>({manifestUrl:'https://addon.test/manifest.json'});
 for (const [format,episode,videoId,type] of [['TV',1101,'kitsu:12:1101','series'],['MOVIE',1,'kitsu:12','movie']]) {
  const anime={...copy,id:'kitsu:12',url:'kitsu:12',identity:{kind:'anime',format,season:4,externalIds:{kitsu:'12',anilist:'21'}}};
  const plan=nativeAddonPreparation({runtime:a,copies:[anime],episode});
  expect(plan.providers[0]).toMatchObject({videoId,type});
  await plan.start('s',{appendAddonStreams:async data=>calls.push(data)}).done;
  expect(input).toMatchObject({videoId,type});
 }
});
