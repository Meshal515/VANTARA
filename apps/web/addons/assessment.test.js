import { expect, it } from "vitest";
import { assessAddon } from "./assessment.js";
const now = 2_000_000_000;
const addon = (health = {}, extra = {}) => ({ version: "1.0.0", cacheEpoch: "epoch", enabled: true, capabilities: ["catalog", "meta"], compatibility: { pwa: true, apk: false }, health, ...extra });
const success = { state: "healthy", lastSuccessAt: now - 1000, version: "1.0.0", cacheEpoch: "epoch" };
it("requires recent current version functional evidence for every supported capability", () => {
  expect(assessAddon(addon(), "pwa", now).level).toBe("candidate");
  expect(assessAddon(addon({ catalog: success }), "pwa", now).level).toBe("candidate");
  expect(assessAddon(addon({ catalog: success, meta: success }), "pwa", now).level).toBe("stable");
  for (const changed of [{lastSuccessAt: now - 8*86400000}, {version:"0.9.0"}, {cacheEpoch:"old"}, {lastSuccessAt:now+1}, {version:undefined}])
    expect(assessAddon(addon({ catalog: success, meta: {...success,...changed} }), "pwa", now).level).toBe("candidate");
});
it("separates configuration disabled unsupported and genuine failed capability states", () => {
  expect(assessAddon(addon({meta:{state:"failed"}}),"pwa",now).level).toBe("broken");
  expect(assessAddon(addon({meta:{state:"failed"}},{configuration:{required:true,configured:false}}),"pwa",now).level).toBe("configuration");
  expect(assessAddon(addon({}, {enabled:false}),"pwa",now).level).toBe("disabled");
  expect(assessAddon(addon(),"apk",now).level).toBe("unsupported");
  expect(assessAddon(addon({}, {bundled:true}),"apk",now).level).toBe("builtin");
});
it("assesses only APK-supported subtitles and keeps empty responses candidate without evidence", () => {
  const a = addon({catalog:{state:"failed"},subtitles:success},{capabilities:["catalog","subtitles"],compatibility:{apk:true,apkCapabilities:["subtitles"]}});
  expect(assessAddon(a,"apk",now).level).toBe("stable");
  expect(assessAddon(addon({subtitles:{state:"empty"}}, {capabilities:["subtitles"]}),"pwa",now).level).toBe("candidate");
});
it('does not let generic success callbacks refresh absent or stale functional evidence',()=>{
  expect(assessAddon(addon({catalog:{...success,functionalSuccessAt:null},meta:success}),'pwa',now).level).toBe('candidate');
  expect(assessAddon(addon({catalog:{...success,functionalSuccessAt:now-8*86400000},meta:success}),'pwa',now).level).toBe('candidate');
});
it('does not report failures from a replaced provider epoch as current breakage',()=>{
  expect(assessAddon(addon({meta:{state:'failed',version:'0.9.0',cacheEpoch:'old'}}),'pwa',now).level).toBe('candidate');
});
