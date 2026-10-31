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

it('settles a rejected native bridge delivery without blocking a successful sibling', async () => {
  const calls = [], completed = [];
  const a = runtime(async () => [{ id: 'ok', url: 'https://cdn.test/ok.mp4', status: 'RESOLVED' }]);
  a.registry.list = () => [manifest, { ...manifest, key: 'good', name: 'Good' }];
  const copies = [copy, { ...copy, sourceId: 'addon|good' }];
  const job = nativeAddonPreparation({ runtime: a, copies, episode: 3 }).start('s', {
    appendAddonStreams: async data => {
      calls.push(data.sourceId);
      if (data.sourceId === 'addon|provider') throw new Error('Capacitor delivery failed');
    },
    finishAddonBatch: async data => completed.push(data.sourceId),
  });
  await job.done;
  expect(calls).toContain('addon|good');
  expect(completed).toEqual(['addon|provider']);
});

it('bounds an unresponsive provider and emits a completion result', async () => {
  const events = [];
  const a = runtime(() => new Promise(() => {}));
  const job = nativeAddonPreparation({ runtime: a, copies: [copy], episode: 3 }).start('s', {
    appendAddonStreams: async data => events.push(data),
  }, { timeoutMs: 10 });
  await job.done;
  expect(events).toHaveLength(1);
  expect(events[0].sourceId).toBe('addon|provider');
  expect(events[0].streams).toEqual([]);
  expect(events[0].reason).toMatch(/مهلة/);
});

it('uses a legacy bridge fallback when finishAddonBatch is absent', async () => {
  const calls = [];
  const a = runtime(async () => []);
  await nativeAddonPreparation({ runtime: a, copies: [copy], episode: 3 }).start('s', {
    appendAddonStreams: async data => {
      calls.push(data);
      if (calls.length === 1) throw new Error('first publish failed');
    },
  }).done;
  expect(calls).toHaveLength(2);
  expect(calls[1].streams).toEqual([]);
});

it('does not publish after cancelling an unresponsive provider', async () => {
  const calls = [];
  const a = runtime(() => new Promise(() => {}));
  const job = nativeAddonPreparation({ runtime: a, copies: [copy], episode: 3 }).start('s', {
    appendAddonStreams: async data => calls.push(data),
  }, { timeoutMs: 1000 });
  job.cancel();
  await job.done;
  expect(calls).toEqual([]);
});
