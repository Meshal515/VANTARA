import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayStartupHeadBytes, reusableStartupReplay } from './torrent-replay-startup.mjs';

const MiB=1024*1024;
test('warm replay needs the full short clip or a bounded verified movie head',()=>{
  assert.equal(replayStartupHeadBytes(20),20);
  assert.equal(replayStartupHeadBytes(8*MiB),2*MiB);
  assert.equal(replayStartupHeadBytes(512*MiB),4*MiB);
  assert.equal(replayStartupHeadBytes(16*1024*MiB),4*MiB);
  for(const length of [0,-1,Infinity,NaN,1.5])assert.equal(replayStartupHeadBytes(length),0);
});
test('256 KiB replay prefix cannot fake playback readiness for a movie-sized file',async()=>{
  const candidate={descriptor:{fileLength:8*MiB},read:async(_start,length)=>Buffer.alloc(Math.min(length,256*1024))};
  assert.deepEqual(await reusableStartupReplay(candidate),{usable:false,requiredBytes:2*MiB,verifiedBytes:256*1024});
});
test('fully cached short clips and verified multi-megabyte heads remain fast',async()=>{
  const full={descriptor:{fileLength:20},read:async(_start,length)=>Buffer.alloc(length)};
  const big={descriptor:{fileLength:2*1024*MiB},read:async(_start,length)=>Buffer.alloc(length)};
  assert.deepEqual(await reusableStartupReplay(full),{usable:true,requiredBytes:20,verifiedBytes:20});
  assert.deepEqual(await reusableStartupReplay(big),{usable:true,requiredBytes:4*MiB,verifiedBytes:4*MiB});
});
test('missing, unreadable and damaged cache fail open to the verified engine rather than bypass verification',async()=>{
  const missing=await reusableStartupReplay(null);
  const corrupted=await reusableStartupReplay({descriptor:{fileLength:10*MiB},read:async()=>{throw Error('invalid hash')}});
  assert.equal(missing.usable,false);
  assert.equal(corrupted.usable,false);
});
