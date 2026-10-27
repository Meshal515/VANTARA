import assert from 'node:assert/strict';

// Acceptance is absolute wall-clock playback; local-file measurements explain
// environment failures but never reduce the required rate or frame-loss bound.
export function assessRealtimePlayback(samples,{seconds=10,fps=24}={}) {
  const first=samples[0],last=samples.at(-1);
  if(!first||!last)return {passed:false,reason:'missing samples'};
  const observed=last.atSeconds-first.atSeconds,advance=last.position-first.position;
  let longestBuffer=0,bufferStart=null,longestStall=0,lastMotion=first.atSeconds;
  for(let i=0;i<samples.length;i++){
    const s=samples[i];
    if(!Number.isFinite(s.position)||!Number.isFinite(s.atSeconds))return {passed:false,reason:'invalid clock'};
    if(s.buffering||s.paused){bufferStart??=s.atSeconds;longestBuffer=Math.max(longestBuffer,s.atSeconds-bufferStart);}else bufferStart=null;
    if(i&&s.position>samples[i-1].position)lastMotion=s.atSeconds;
    longestStall=Math.max(longestStall,s.atSeconds-lastMotion);
  }
  const dropped=Math.max(0,(last.droppedFrames??0)-(first.droppedFrames??0));
  const delayed=Math.max(0,(last.delayedFrames??0)-(first.delayedFrames??0));
  const lostFraction=(dropped+delayed)/Math.max(1,observed*fps);
  return {passed:observed>=seconds&&advance>=observed*.9&&advance<=observed*1.1&&longestBuffer<=.5&&longestStall<=.5&&lostFraction<=.05,
    observedSeconds:observed,advanceSeconds:advance,minimumSeconds:observed*.9,longestBufferSeconds:longestBuffer,longestStallSeconds:longestStall,droppedFrames:dropped,delayedFrames:delayed,lostFraction};
}
export function verifyByteRange(source,start,end,actual){
  assert.equal(actual.length,end-start+1,'Range length mismatch');
  assert.ok(source.subarray(start,end+1).equals(actual),'Verified byte mismatch');
}
