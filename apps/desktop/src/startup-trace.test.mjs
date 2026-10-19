import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartupTrace} from './startup-trace.mjs';
test('startup phases use monotonic elapsed time and exclude source and account secrets',()=>{
  let time=10;const events=[],trace=createStartupTrace(e=>events.push(e),()=>time);
  trace.once('source-selected',{fileIdx:0,url:'https://private/token',headers:{Authorization:'secret'},ownerId:'secret',mode:'cold'});
  time=15;trace.once('http-first-byte',{bytes:17,waitMs:5});trace.once('http-first-byte',{bytes:999});
  assert.deepEqual(events,[{type:'playback/diagnostic',stage:'source-selected',elapsedMs:0,fileIdx:0,mode:'cold'},{type:'playback/diagnostic',stage:'http-first-byte',elapsedMs:5,bytes:17,waitMs:5}]);
  trace.stop();trace.record('later');assert.equal(events.length,2);
});
test('long-running telemetry has a bounded local history',()=>{
  const trace=createStartupTrace(()=>{});for(let i=0;i<1000;i++)trace.record('torrent-sample',{checkedBytes:i});
  const events=trace.snapshot();assert.equal(events.length,256);events[0].stage='changed';assert.equal(trace.snapshot()[0].stage,'torrent-sample');
});
