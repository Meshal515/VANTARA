import { it, expect } from "vitest";
import { createNativeTransport } from "./native-transport.js";
it("uses only the native bridge and cancels the actual request on playback abort", async () => {
  let args, cancelled, finish;
  const plugin = {
    request: (a) => {
      args = a;
      return new Promise((r) => (finish = r));
    },
    cancel: async (a) => {
      cancelled = a.requestId;
    },
  };
  const transport = createNativeTransport(plugin),
    c = new AbortController();
  const done = transport
    .json("https://addon.test/config/manifest.json", { signal: c.signal })
    .catch((e) => e.name);
  await Promise.resolve();
  c.abort();
  finish({ text: "{}" });
  expect(await done).toBe("AbortError");
  expect(cancelled).toBe(args.requestId);
  expect(args.url).toContain("/config/");
});
it("never falls back to browser fetch if the native plugin is absent", () =>
  expect(() => createNativeTransport(null)).toThrow());
