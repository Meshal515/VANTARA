import { describe, expect, it, vi } from 'vitest';
import { createTextBatcher } from './translate-batch.js';
const page = i => ({ pageHash: `h${i}`, seriesRef:'work', chapterKey:'work#1', pageIndex:i, regions:[{id:'same'}], image:{data:'AAAA'} });
describe('bounded background text assembly',()=> {
  it('collects background pages, resolves by hash even in reversed response order',async()=> {
    vi.useFakeTimers();const calls=[];
    const batch=createTextBatcher(async(path,body)=> {
      calls.push({path,body});return {status:200,body:{pages:body.pages.toReversed().map(p=>({pageHash:p.pageHash,status:200,body:{regions:[{id:'same',arabic:p.pageHash}]}}))}};
    });
    const a=batch.enqueueTextPage(page(0)),b=batch.enqueueTextPage(page(1));
    expect(calls).toHaveLength(0);await vi.advanceTimersByTimeAsync(200);
    expect((await a).body.regions[0].arabic).toBe('h0');expect((await b).body.regions[0].arabic).toBe('h1');expect(calls).toHaveLength(1);
    vi.useRealTimers();
  });
  it('visible pages bypass assembly and cancellation cannot apply stale results',async()=> {
    const calls=[];const batch=createTextBatcher(async(path,body)=> {calls.push(path);return {status:200,body:{regions:body.regions}};});
    await batch.enqueueTextPage(page(0),{interactive:true});expect(calls).toEqual(['/v1/translate/text']);
    const controller=new AbortController();const promise=batch.enqueueTextPage(page(1),{signal:controller.signal});controller.abort();
    await expect(promise).rejects.toMatchObject({name:'AbortError'});expect(calls).toHaveLength(1);
  });
  it('does not mix works/modes and only falls back on missing endpoint',async()=> {
    vi.useFakeTimers();const calls=[];
    const batch=createTextBatcher(async(path,body)=> {calls.push({path,body});return path.endsWith('text-batch')?{status:404}:{status:200,body:{pageHash:body.pageHash}};});
    const a=batch.enqueueTextPage(page(0)),b=batch.enqueueTextPage({...page(1),speed:'fast'});
    await vi.advanceTimersByTimeAsync(200);expect((await a).status).toBe(200);expect((await b).status).toBe(200);
    expect(calls.filter(c=>c.path.endsWith('text-batch'))).toHaveLength(2);
    const failed=createTextBatcher(async()=>({status:429,body:{error:'busy'}}));
    const blocked=failed.enqueueTextPage(page(3));await vi.advanceTimersByTimeAsync(200);expect((await blocked).status).toBe(429);
    vi.useRealTimers();
  });
  it('flushes at four pages and bounds active batches',async()=> {
    const pending=[];const calls=[];
    const batch=createTextBatcher((path,body)=>new Promise(resolve=>{calls.push({path,body});pending.push(()=>resolve({status:200,body:{pages:body.pages.map(p=>({pageHash:p.pageHash,status:200,body:{}}))}}));}));
    const work=Array.from({length:12},(_,i)=>batch.enqueueTextPage(page(i)));
    await Promise.resolve();expect(calls).toHaveLength(2);expect(calls.every(c=>c.body.pages.length===4)).toBe(true);
    pending.splice(0).forEach(f=>f());await new Promise(r=>setTimeout(r,0));expect(calls).toHaveLength(3);
    pending.splice(0).forEach(f=>f());await Promise.all(work);
  });
});

it('backs off after 429 and never dispatches queued work during cooldown',async()=> {
 vi.useFakeTimers();const calls=[];
 const batch=createTextBatcher(async(path,body)=>{calls.push(body.pages);return {status:429,body:{error:'busy',retryAfterMs:1000}};},{maxInFlight:1,adaptive:true});
 const first=batch.enqueueTextPage(page(0));await vi.advanceTimersByTimeAsync(200);expect((await first).status).toBe(429);
 const second=batch.enqueueTextPage(page(1));await vi.advanceTimersByTimeAsync(200);expect(calls).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(1000);expect((await second).status).toBe(429);expect(calls).toHaveLength(2);vi.useRealTimers();
});
