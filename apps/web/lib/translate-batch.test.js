import { describe, expect, it, vi } from 'vitest';
import { createTextBatcher } from './translate-batch.js';

const page = (i, { regionCount = 1, source = `Page ${i}`, speed } = {}) => ({
  pageHash: `h${i}`,
  seriesRef:'work',
  chapterKey:'work#1',
  pageIndex:i,
  ...(speed ? { speed } : {}),
  regions:Array.from({length:regionCount},(_,r)=>({id:`r${r}`,source,kind:'speech'})),
  image:{data:'AAAA'},
});

const batchReply = body => ({
  status:200,
  body:{
    pages:body.pages.map(p=>({
      pageHash:p.pageHash,
      pageIndex:p.pageIndex,
      status:200,
      body:{regions:p.regions,perf:{providerNetworkMs:10,batchWaitMs:2}},
    })),
  },
});

describe('adaptive background Luna assembly',()=> {
  it('collects background pages, resolves by hash even in reversed response order',async()=> {
    vi.useFakeTimers();const calls=[];
    const batch=createTextBatcher(async(path,body)=> {
      calls.push({path,body});
      return {status:200,body:{pages:body.pages.toReversed().map(p=>({pageHash:p.pageHash,pageIndex:p.pageIndex,status:200,body:{regions:[{id:'r0',arabic:p.pageHash}]}}))}};
    },{waitMs:40});
    const a=batch.enqueueTextPage(page(0)),b=batch.enqueueTextPage(page(1));
    expect(calls).toHaveLength(0);await vi.advanceTimersByTimeAsync(40);
    expect((await a).body.regions[0].arabic).toBe('h0');expect((await b).body.regions[0].arabic).toBe('h1');expect(calls).toHaveLength(1);
    vi.useRealTimers();
  });

  it('visible pages bypass assembly and expose zero batch wait telemetry',async()=> {
    const calls=[];const batch=createTextBatcher(async(path,body)=> {
      calls.push(path);
      return {status:200,body:{regions:body.regions,perf:{providerNetworkMs:0,batchWaitMs:0}}};
    });
    const visible=await batch.enqueueTextPage(page(0),{interactive:true});
    expect(calls).toEqual(['/v1/translate/text']);
    expect(visible.lunaPerf).toMatchObject({batchWaitMs:0,pagesPerBatch:1,regionsPerBatch:1});

    const controller=new AbortController();const promise=batch.enqueueTextPage(page(1),{signal:controller.signal});controller.abort();
    await expect(promise).rejects.toMatchObject({name:'AbortError'});expect(calls).toHaveLength(1);
  });

  it('coalesces semantically equivalent default and smart quality metadata',async()=> {
    vi.useFakeTimers();const calls=[];
    const batch=createTextBatcher(async(path,body)=>{calls.push({path,body});return batchReply(body);},{waitMs:40,limits:{maxPages:2}});
    const a=batch.enqueueTextPage(page(0));
    const b=batch.enqueueTextPage({...page(1),speed:'smart',sourceLang:'auto'});
    await Promise.resolve();await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.pages).toHaveLength(2);
    await Promise.all([a,b]);vi.useRealTimers();
  });

  it('does not mix works/modes and only falls back on missing endpoint',async()=> {
    vi.useFakeTimers();const calls=[];
    const batch=createTextBatcher(async(path,body)=> {
      calls.push({path,body});
      return path.endsWith('text-batch')?{status:404}:{status:200,body:{pageHash:body.pageHash,perf:{providerNetworkMs:0,batchWaitMs:0}}};
    },{waitMs:40});
    const a=batch.enqueueTextPage(page(0)),b=batch.enqueueTextPage(page(1,{speed:'fast'}));
    await vi.advanceTimersByTimeAsync(40);expect((await a).status).toBe(200);expect((await b).status).toBe(200);
    expect(calls.filter(c=>c.path.endsWith('text-batch'))).toHaveLength(2);
    const failed=createTextBatcher(async()=>({status:429,body:{error:'busy'}}),{waitMs:40});
    const blocked=failed.enqueueTextPage(page(3));await vi.advanceTimersByTimeAsync(40);expect((await blocked).status).toBe(429);
    vi.useRealTimers();
  });

  it('sends immediately when the first adaptive limit is reached',async()=> {
    const cases=[
      {name:'pages',limits:{maxPages:2,maxRegions:99,maxSourceChars:9999,maxSourceTokens:9999},pages:[page(0),page(1)]},
      {name:'regions',limits:{maxPages:6,maxRegions:4,maxSourceChars:9999,maxSourceTokens:9999},pages:[page(0,{regionCount:2}),page(1,{regionCount:2})]},
      {name:'chars',limits:{maxPages:6,maxRegions:99,maxSourceChars:10,maxSourceTokens:9999},pages:[page(0,{source:'12345'}),page(1,{source:'67890'})]},
      {name:'tokens',limits:{maxPages:6,maxRegions:99,maxSourceChars:9999,maxSourceTokens:4},pages:[page(0,{source:'12345678'}),page(1,{source:'ABCDEFGH'})]},
    ];
    for(const test of cases){
      const calls=[];
      const batch=createTextBatcher(async(path,body)=>{calls.push({path,body});return batchReply(body);},{waitMs:1000,limits:test.limits});
      const work=test.pages.map(p=>batch.enqueueTextPage(p));
      await Promise.resolve();await Promise.resolve();
      expect(calls,test.name).toHaveLength(1);
      expect(calls[0].body.pages,test.name).toHaveLength(2);
      await Promise.all(work);
    }
  });

  it('never extends the oldest page batch deadline when newer pages arrive',async()=> {
    vi.useFakeTimers();const calls=[];
    const batch=createTextBatcher(async(path,body)=>{calls.push({path,body});return batchReply(body);},{waitMs:40});
    const a=batch.enqueueTextPage(page(0));
    await vi.advanceTimersByTimeAsync(30);
    const b=batch.enqueueTextPage(page(1));
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.pages.map(p=>p.pageIndex)).toEqual([0,1]);
    await Promise.all([a,b]);vi.useRealTimers();
  });

  it('packs six light pages per request and bounds active batches',async()=> {
    const pending=[];const calls=[];
    const batch=createTextBatcher((path,body)=>new Promise(resolve=>{
      calls.push({path,body});
      pending.push(()=>resolve(batchReply(body)));
    }),{limits:{maxPages:6,maxRegions:48,maxSourceChars:7000,maxSourceTokens:2600}});
    const work=Array.from({length:12},(_,i)=>batch.enqueueTextPage(page(i)));
    await Promise.resolve();await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(calls.every(c=>c.body.pages.length===6)).toBe(true);
    pending.splice(0).forEach(f=>f());await Promise.all(work);
  });

  it('benchmark: batching may reduce requests only when simulated chapter wall does not rise',async()=> {
    vi.useFakeTimers();
    const makeProvider=()=>{
      let active=0,maxActive=0,calls=0;
      const queued=[];
      const pump=()=>{
        while(active<2 && queued.length){
          const job=queued.shift();active++;maxActive=Math.max(maxActive,active);
          setTimeout(()=>{
            active--;
            const result=job.path.endsWith('text-batch')
              ? batchReply(job.body)
              : {status:200,body:{regions:job.body.regions,perf:{providerNetworkMs:100,batchWaitMs:0}}};
            job.resolve(result);pump();
          },100);
        }
      };
      return {
        request:(path,body)=>new Promise(resolve=>{calls++;queued.push({path,body,resolve});pump();}),
        stats:()=>({calls,maxActive}),
      };
    };

    const pages=Array.from({length:12},(_,i)=>page(i));

    const direct=makeProvider();
    const directStart=Date.now();
    const directWork=pages.map(p=>direct.request('/v1/translate/text',p));
    await vi.runAllTimersAsync();await Promise.all(directWork);
    const directWall=Date.now()-directStart;

    const batched=makeProvider();
    const scheduler=createTextBatcher(batched.request,{
      waitMs:40,maxInFlight:2,
      limits:{maxPages:6,maxRegions:48,maxSourceChars:7000,maxSourceTokens:2600},
    });
    const batchStart=Date.now();
    const batchWork=pages.map(p=>scheduler.enqueueTextPage(p));
    await vi.runAllTimersAsync();await Promise.all(batchWork);
    const batchWall=Date.now()-batchStart;

    expect(direct.stats()).toMatchObject({calls:12,maxActive:2});
    expect(batched.stats()).toMatchObject({calls:2,maxActive:2});
    expect(batchWall).toBeLessThanOrEqual(directWall);
    vi.useRealTimers();
  });

  it('backs off after 429 and never dispatches queued work during cooldown',async()=> {
    vi.useFakeTimers();const calls=[];
    const batch=createTextBatcher(async(path,body)=>{calls.push(body.pages);return {status:429,body:{error:'busy',retryAfterMs:1000}};},{waitMs:40,maxInFlight:1,adaptive:true});
    const first=batch.enqueueTextPage(page(0));await vi.advanceTimersByTimeAsync(40);expect((await first).status).toBe(429);
    const second=batch.enqueueTextPage(page(1));await vi.advanceTimersByTimeAsync(40);expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);expect((await second).status).toBe(429);expect(calls).toHaveLength(2);vi.useRealTimers();
  });
});
