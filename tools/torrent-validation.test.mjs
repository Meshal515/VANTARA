import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRealtimePlayback, verifyByteRange, assessByteFlow } from './torrent-validation.mjs';

test('high average byte speed cannot hide a missed streaming deadline',()=>{
  assert.equal(assessByteFlow([{atSeconds:0,bytes:0},{atSeconds:2,bytes:1024},{atSeconds:3,bytes:64*1024*1024}],24000000).passed,false);
  assert.equal(assessByteFlow([{atSeconds:0,bytes:0},{atSeconds:1,bytes:4*1024*1024},{atSeconds:2,bytes:8*1024*1024}],24000000).passed,true);
});

test('real playback cannot pass with a software-relative baseline or a decoded still', () => {
  const samples = [{atSeconds:0,position:0,buffering:false},{atSeconds:10,position:5,buffering:false}];
  assert.equal(assessRealtimePlayback(samples).passed,false);
  assert.equal(assessRealtimePlayback(samples.map(s=>({...s,position:0}))).passed,false);
});
test('real playback requires the entire sample, bounded frame loss and no sustained rebuffer', () => {
  const samples = Array.from({length:41},(_,i)=>({atSeconds:i/4,position:i/4,buffering:false,paused:false,droppedFrames:0,delayedFrames:0,decoderDroppedFrames:0}));
  assert.equal(assessRealtimePlayback(samples).passed,true);
  assert.equal(assessRealtimePlayback(samples.slice(0,2)).passed,false);
  assert.equal(assessRealtimePlayback([samples[0],samples.at(-1)]).passed,false);
  assert.equal(assessRealtimePlayback(samples.map(s=>({...s,droppedFrames:null}))).passed,false);
  assert.equal(assessRealtimePlayback(samples.map((s,i)=>({...s,buffering:i>8&&i<20}))).passed,false);
  assert.equal(assessRealtimePlayback(samples.map((s,i)=>({...s,droppedFrames:i*3}))).passed,false);
  assert.equal(assessRealtimePlayback(samples.map((s,i)=>({...s,position:i<20?s.position:4.75}))).passed,false);
});
test('byte proof verifies requested position and length, rejecting zero-filled sparse data', () => {
  const source=Buffer.from('the owned torrent has distinct bytes');
  assert.doesNotThrow(()=>verifyByteRange(source,4,12,source.subarray(4,13)));
  assert.throws(()=>verifyByteRange(source,4,12,Buffer.alloc(9)),/mismatch/);
  assert.throws(()=>verifyByteRange(source,4,12,source.subarray(4,12)),/length/);
  assert.throws(()=>verifyByteRange(source,4,12,source.subarray(3,12)),/mismatch/);
});
