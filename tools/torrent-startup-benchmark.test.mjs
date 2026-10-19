import test from 'node:test';
import assert from 'node:assert/strict';
import { framePixels, summarize } from './torrent-startup-benchmark.mjs';

test('frame proof rejects black output and accepts authored colored rendered pixels',()=>{
  assert.equal(framePixels(Buffer.alloc(1200)).nonblack,false);
  assert.equal(framePixels(Buffer.from([230,10,30,10,200,80])).nonblack,true);
});
test('timing summary excludes failed runs and reports measured samples only',()=>{
  const result=summarize([{ok:true,firstRenderedMs:100},{ok:true,firstRenderedMs:300},{ok:false,firstRenderedMs:1}]);
  assert.deepEqual(result,{successful:2,failed:1,minMs:100,medianMs:200,p95Ms:300,maxMs:300});
  assert.equal(summarize([{ok:false}]).medianMs,null);
});
