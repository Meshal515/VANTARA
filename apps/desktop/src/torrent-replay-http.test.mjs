import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { replayRange, sendReplayPrefix, createReplayRecorder } from './torrent-replay-http.mjs';

test('replay ranges preserve exact bounds including suffix and reject unsafe or multiple ranges', () => {
  assert.deepEqual(replayRange('bytes=3-9', 8), {start:3,end:7,partial:true});
  assert.deepEqual(replayRange('bytes=-3', 8), {start:5,end:7,partial:true});
  for (const h of ['bytes=8-', 'bytes=4-2','bytes=-0','bytes=','bytes=0-1,3-4','bytes=9007199254740992-']) assert.equal(replayRange(h,8),null);
});
test('cached prefix leaves a hole for the engine instead of returning zeros or a short success',async()=>{
  const res=new EventEmitter();res.writeHead=(s,h)=>{res.status=s;res.headers=h;};res.write=b=>{res.body=Buffer.concat([res.body??Buffer.alloc(0),b]);return true;};res.end=()=>res.ended=true;
  const entry={descriptor:{fileLength:12},read:async at=>at===2?Buffer.from('ABCD'):null};
  const out=await sendReplayPrefix({entry,req:{method:'GET',headers:{range:'bytes=2-10'}},res,signal:new AbortController().signal});
  assert.equal(out.cursor,6);assert.equal(out.complete,false);assert.equal(res.headers['content-length'],9);assert.equal(res.body.toString(),'ABCD');assert.equal(res.ended,undefined);
});
test('recorder commits the final partial extent on close and bounds individual writes',async()=>{
  const calls=[],entry={write:async(at,b)=>{calls.push({at,length:b.length,first:b[0]});return true;}};
  const r=createReplayRecorder(entry,17);r.append(Buffer.alloc(4*1024*1024+123,7));await r.finish();await r.finish();
  assert.deepEqual(calls,[{at:17,length:4*1024*1024,first:7},{at:17+4*1024*1024,length:123,first:7}]);
});
