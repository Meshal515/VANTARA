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
it('asks anime-only providers for Kitsu episodes under the anime type they declare', async()=>{
 let input; const a=runtime(async args=>{input=args;return [];});
 const anime={...copy,type:'anime',id:'kitsu:12',url:'kitsu:12',identity:{kind:'anime',format:'TV',externalIds:{kitsu:'12'}}};
 await nativeAddonPreparation({runtime:a,copies:[anime],episode:7}).start('s',{appendAddonStreams:async()=>{}}).done;
 expect(input).toMatchObject({videoId:'kitsu:12:7',type:'anime'});
});


it('settles the exact native batch when JS-to-Android delivery rejects, preserving sibling success', async () => {
  const received = [], settled = [];
  const fast = {...manifest,key:'second',name:'Second'};
  const a = runtime(async () => [{status:'RESOLVED',url:'https://cdn.test/ok.mp4'}]);
  a.registry.list = () => [manifest, fast];
  const plan = nativeAddonPreparation({runtime:a,copies:[copy,{...copy,sourceId:'addon|second'}],episode:3});
  const done = plan.start('s', {
    appendAddonStreams:async ({sourceId,...rest}) => {
      if (sourceId === 'addon|provider') throw Error('bridge disconnected');
      received.push({sourceId,...rest});
    },
    finishAddonBatch:async payload => settled.push(payload),
  },{addonGeneration:'generation-1',deliveryTimeoutMs:40});
  await done.done;
  expect(received.map(x => x.sourceId)).toEqual(['addon|second']);
  expect(settled).toMatchObject([{session:'s',sourceId:'addon|provider',addonGeneration:'generation-1'}]);
});

it('times out a provider that never settles, without blocking sibling or leaking timers', async () => {
  const published = [], slow={...manifest,key:'slow',name:'Slow'};
  const a=runtime(async()=>[]);
  a.registry.list=()=>[manifest,slow];
  a.adapter=key=>({streams:()=>key==='slow' ? new Promise(()=>{}) : Promise.resolve([{id:'fast',url:'https://cdn.test/ok.mp4'}])});
  const p=nativeAddonPreparation({runtime:a,copies:[copy,{...copy,sourceId:'addon|slow'}],episode:3});
  await p.start('s',{appendAddonStreams:async payload=>published.push(payload)},{deadlineMs:25}).done;
  expect(published).toHaveLength(2);
  expect(published.find(x=>x.sourceId==='addon|slow').streams).toEqual([]);
  expect(published.find(x=>x.sourceId==='addon|slow').reason).toContain('مهلة');
});

it('times out a hung Android delivery and falls back to the native settle method',async()=>{
  const settled=[];
  await nativeAddonPreparation({runtime:runtime(async()=>[]),copies:[copy],episode:3})
    .start('s',{appendAddonStreams:()=>new Promise(()=>{}),finishAddonBatch:async p=>settled.push(p)},
      {addonGeneration:'g',deliveryTimeoutMs:20}).done;
  expect(settled[0]).toMatchObject({sourceId:'addon|provider',addonGeneration:'g'});
});

it('cancellation settles JS tasks without publishing a stale result or waiting for the provider timeout',async()=>{
  const p=nativeAddonPreparation({runtime:runtime(()=>new Promise(()=>{})),copies:[copy],episode:3});
  const calls=[];
  const job=p.start('s',{appendAddonStreams:async x=>calls.push(x)},{deadlineMs:1000});
  job.cancel();
  await job.done;
  expect(calls).toEqual([]);
});
