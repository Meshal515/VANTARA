import test from 'node:test';
import assert from 'node:assert/strict';
import { framePixels, summarize, main, assessPlaybackProgress } from './torrent-startup-benchmark.mjs';

test('frame proof rejects black output and accepts authored colored rendered pixels',()=>{
  assert.equal(framePixels(Buffer.alloc(1200)).nonblack,false);
  assert.equal(framePixels(Buffer.from([230,10,30,10,200,80])).nonblack,true);
});
test('timing summary excludes failed runs and reports measured samples only',()=>{
  const result=summarize([{ok:true,firstRenderedMs:100},{ok:true,firstRenderedMs:300},{ok:false,firstRenderedMs:1}]);
  assert.deepEqual(result,{successful:2,failed:1,minMs:100,medianMs:200,p95Ms:300,maxMs:300});
  assert.equal(summarize([{ok:false}]).medianMs,null);
});

test('software-only host comparison never passes a stopped video or exempts a normal renderer',()=>{
  const sample={fromSeconds:0,toSeconds:.3,observedSeconds:2};
  const baseline={fromSeconds:0,toSeconds:.4,observedSeconds:2,softwareAdapter:true};
  assert.equal(assessPlaybackProgress(sample).passed,false);
  assert.equal(assessPlaybackProgress(sample,{...baseline,softwareAdapter:false}).passed,false);
  assert.equal(assessPlaybackProgress(sample,baseline).kind,'host-relative');
  assert.equal(assessPlaybackProgress(sample,baseline).passed,true);
  assert.equal(assessPlaybackProgress({...sample,toSeconds:0},baseline).passed,false);
  assert.equal(assessPlaybackProgress(sample,{...baseline,toSeconds:0}).passed,false);
  assert.equal(assessPlaybackProgress({...sample,toSeconds:2}).kind,'realtime');
  assert.equal(assessPlaybackProgress({...sample,toSeconds:2}).passed,true);
});

test('benchmark rejects unknown warmup strategies and invalid piece sizes before launching tools',async()=>{
  const required=['--service-module','unused','--rqbit','unused','--mpv','unused'];
  await assert.rejects(main([...required,'--torrent-warmup','head-typo']),/torrent-warmup/);
  await assert.rejects(main([...required,'--piece-length','12345']),/piece-length/);
});
