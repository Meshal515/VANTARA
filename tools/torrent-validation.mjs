import assert from 'node:assert/strict';

export function assessByteFlow(samples,requiredBitsPerSecond){
  const last=samples.at(-1);
  const maxLatenessSeconds=Math.max(0,...samples.map(s=>s.atSeconds-s.bytes*8/requiredBitsPerSecond-1));
  return {passed:!!last&&Number.isFinite(maxLatenessSeconds)&&maxLatenessSeconds===0,maxLatenessSeconds,initialBufferSeconds:1};
}

// Acceptance is absolute wall-clock playback; local-file measurements explain
// environment failures but never reduce the required rate or frame-loss bound.
export function assessRealtimePlayback(samples,{seconds=10,fps=24}={}) {
  const first=samples[0],last=samples.at(-1);
  if(!first||!last||samples.length<Math.ceil(seconds*2))return {passed:false,reason:'missing full-duration samples'};
  const observed=last.atSeconds-first.atSeconds,advance=last.position-first.position;
  let longestBuffer=0,bufferStart=null,longestStall=0,lastMotion=first.atSeconds;
  for(let i=0;i<samples.length;i++){
    const s=samples[i];
    if(!Number.isFinite(s.position)||!Number.isFinite(s.atSeconds)||typeof s.paused!=='boolean'||typeof s.buffering!=='boolean'||
       ![s.droppedFrames,s.delayedFrames,s.decoderDroppedFrames].every(v=>Number.isFinite(v)&&v>=0))return {passed:false,reason:'missing measured clock/buffer/frame counters'};
    if(i&&(s.atSeconds<=samples[i-1].atSeconds||s.atSeconds-samples[i-1].atSeconds>.75))return {passed:false,reason:'unobserved playback interval'};
    if(s.buffering||s.paused){bufferStart??=s.atSeconds;longestBuffer=Math.max(longestBuffer,s.atSeconds-bufferStart);}else bufferStart=null;
    if(i&&s.position>samples[i-1].position)lastMotion=s.atSeconds;
    longestStall=Math.max(longestStall,s.atSeconds-lastMotion);
  }
  const dropped=Math.max(0,(last.droppedFrames??0)-(first.droppedFrames??0));
  const delayed=Math.max(0,(last.delayedFrames??0)-(first.delayedFrames??0));
  const decoderDropped=Math.max(0,last.decoderDroppedFrames-first.decoderDroppedFrames);
  const lostFraction=(dropped+delayed+decoderDropped)/Math.max(1,observed*fps);
  return {passed:observed>=seconds&&advance>=observed*.9&&advance<=observed*1.1&&longestBuffer<=.5&&longestStall<=.5&&lostFraction<=.05,
    observedSeconds:observed,advanceSeconds:advance,minimumSeconds:observed*.9,longestBufferSeconds:longestBuffer,longestStallSeconds:longestStall,droppedFrames:dropped,delayedFrames:delayed,decoderDroppedFrames:decoderDropped,lostFraction};
}
export function verifyByteRange(source,start,end,actual){
  assert.equal(actual.length,end-start+1,'Range length mismatch');
  assert.ok(source.subarray(start,end+1).equals(actual),'Verified byte mismatch');
}
