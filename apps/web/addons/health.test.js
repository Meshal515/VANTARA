import { expect, it } from "vitest";
import { createHealth } from "./health.js";
it("isolates runtime and capability; permits one half-open probe and a manual retry", () => {
  let now = 0;
  const h = createHealth({ clock: () => now });
  for (let i = 0; i < 3; i++) h.failure("a", "streams", "pwa", "timeout");
  expect(h.allow("a", "streams", "pwa")).toBe(false);
  expect(h.allow("a", "subtitles", "pwa")).toBe(true);
  expect(h.allow("a", "streams", "apk")).toBe(true);
  now = 30000;
  expect(h.allow("a", "streams", "pwa")).toBe(true);
  expect(h.allow("a", "streams", "pwa")).toBe(false);
  expect(h.allow("a", "streams", "pwa", { manual: true })).toBe(true);
  h.success("a", "streams", "pwa");
  expect(h.state("a", "streams", "pwa").state).toBe("healthy");
});
it('releases cancelled recovery probes without erasing the preceding failure',()=>{
  let now=0;const h=createHealth({clock:()=>now});
  for(let n=0;n<3;n++)h.failure('a','subtitles','pwa','TIMEOUT');
  now=30001;expect(h.allow('a','subtitles','pwa')).toBe(true);
  h.releaseProbe('a','subtitles','pwa');
  expect(h.state('a','subtitles','pwa').state).toBe('cooling');
  expect(h.allow('a','subtitles','pwa')).toBe(true);
});
it("reports measured latency percentiles and keeps last success after a failure", () => {
  let now = 100;
  const h = createHealth({ clock: () => now });
  for (const ms of [10, 20, 30, 40, 100]) h.success("a", "streams", "pwa", ms);
  now = 200;
  h.failure("a", "streams", "pwa", "TIMEOUT", 15000);
  const s = h.state("a", "streams", "pwa");
  expect(s.lastSuccessAt).toBe(100);
  expect(s.p50).toBe(30);
  expect(s.p95).toBe(15000);
  expect(s.latencyMs).toBe(15000);
});
it('clears availability failures without inventing functional success and retains evidence provenance',()=>{
  const h=createHealth({clock:()=>100});
  h.failure('a','streams','pwa','TIMEOUT');
  h.empty('a','streams','pwa',5,{version:'1.0.0',cacheEpoch:'one'});
  expect(h.state('a','streams','pwa')).toMatchObject({state:'empty',failures:0,version:'1.0.0',cacheEpoch:'one'});
  expect(h.state('a','streams','pwa').lastSuccessAt).toBeFalsy();
  h.success('a','streams','pwa',10,{version:'1.0.0',cacheEpoch:'one'});
  expect(h.state('a','streams','pwa')).toMatchObject({state:'healthy',lastSuccessAt:100,version:'1.0.0',cacheEpoch:'one'});
});
it('keeps generic subtitle callbacks from manufacturing or renewing functional evidence',()=>{
  let now=100;const h=createHealth({clock:()=>now});
  h.empty('a','subtitles','pwa',5,{version:'1.0.0',cacheEpoch:'one'});
  h.success('a','subtitles','pwa');
  expect(h.state('a','subtitles','pwa')).toMatchObject({version:'1.0.0',cacheEpoch:'one',functionalSuccessAt:null});
  h.success('a','subtitles','pwa',5,{version:'1.0.0',cacheEpoch:'one'});
  now=200;h.success('a','subtitles','pwa');
  expect(h.state('a','subtitles','pwa').functionalSuccessAt).toBe(100);
});
it('does not transfer successful release evidence through an empty response from a different epoch',()=>{
 const h=createHealth({clock:()=>1000});h.success('a','streams','pwa',1,{version:'1.0.0',cacheEpoch:'old'});
 h.empty('a','streams','pwa',1,{version:'1.0.0',cacheEpoch:'new'});expect(h.state('a','streams','pwa').functionalSuccessAt).toBeNull();
});
