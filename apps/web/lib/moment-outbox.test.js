import { describe, it, expect, vi } from 'vitest';
import { createMomentOutbox } from './moment-outbox.js';
const base = () => {
 let who='a'; const disk=new Map(); const rows=[];let confirmed=false;
 const item={id:'clip-1',userId:'a',type:'moment',animeId:'42',title:'عمل',episode:3,startMs:12000,endMs:32000,sources:[{sourceId:'arab',server:'known'}]};
 const native={outbox:vi.fn(async()=>[item]),acknowledgeOutbox:vi.fn(async()=>{})};
 const sync={uploadMedia:vi.fn(),enqueue:vi.fn((kind,payload,opts)=>{rows.push({id:opts.opId,_pending:true,...payload});}),push:vi.fn(async()=>{}),rows:()=>confirmed?[{id:'clip-1',rev:1}]:rows};
 const drain=createMomentOutbox({native,sync,currentUser:()=>who,storage:{getItem:k=>disk.get(k),setItem:(k,v)=>disk.set(k,v)}});
 return {item,native,sync,drain,disk,setUser:v=>who=v,confirm:()=>confirmed=true};
};
describe('durable source-backed moment native handoff',()=>{
 it('sends original time range and source hints without uploading video, acknowledging only a confirmed server row',async()=>{
  const t=base();await t.drain();expect(t.sync.enqueue).toHaveBeenCalledOnce();expect(t.sync.uploadMedia).not.toHaveBeenCalled();expect(t.native.acknowledgeOutbox).not.toHaveBeenCalled();
  expect(t.sync.enqueue.mock.calls[0][1].moment).toMatchObject({startMs:12000,endMs:32000,sources:[{sourceId:'arab',server:'known'}]});
  t.confirm();await t.drain();expect(t.sync.enqueue).toHaveBeenCalledOnce();expect(t.native.acknowledgeOutbox).toHaveBeenCalledWith({userId:'a',id:'clip-1'});
 });
 it('does not post an old account moment after switching during native read',async()=>{
  const t=base();t.native.outbox.mockImplementation(async()=>{t.setUser('b');return [t.item];});await t.drain();expect(t.sync.enqueue).not.toHaveBeenCalled();expect(t.native.acknowledgeOutbox).not.toHaveBeenCalled();
 });
 it('retries one stable operation id after a failed push and preserves pending files',async()=>{
  const t=base();t.sync.push.mockRejectedValueOnce(new Error('offline'));await t.drain();await t.drain();expect(t.sync.enqueue.mock.calls.every(c=>c[2].opId==='clip-1')).toBe(true);expect(t.native.acknowledgeOutbox).not.toHaveBeenCalled();
 });
 it('delivers native durable metadata when WebView string storage is full',async()=>{
  const t=base();const full=createMomentOutbox({native:t.native,sync:t.sync,currentUser:()=> 'a',storage:{getItem:()=>null,setItem:()=>{throw new DOMException('full','QuotaExceededError');}}});
  await full();expect(t.sync.enqueue).toHaveBeenCalledOnce();expect(t.native.acknowledgeOutbox).not.toHaveBeenCalled();
  t.confirm();await full();expect(t.native.acknowledgeOutbox).toHaveBeenCalledWith({userId:'a',id:'clip-1'});
 });
 it('normalizes the native movie sentinel to nullable episode before server delivery',async()=>{
  const t=base();t.item.episode=-1;t.item.seriesRef='cinema:tt123456';await t.drain();
  expect(t.sync.enqueue.mock.calls[0][1]).toMatchObject({seriesRef:'cinema:tt123456',chapterNumber:null,moment:{episode:null}});
 });
 it('rejects an invalid range without publishing or discarding the native moment',async()=>{
  const t=base();t.item.endMs=11000;await t.drain();expect(t.sync.enqueue).not.toHaveBeenCalled();expect(t.native.acknowledgeOutbox).not.toHaveBeenCalled();
 });
});
