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
