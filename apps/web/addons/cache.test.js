import { expect, it } from "vitest";
import { createAddonCache } from "./cache.js";
import { createStore } from "../pwa/cache/store.js";
it("isolates addon keys and never returns expired stream URLs", async () => {
  let now = 0;
  const c = createAddonCache({
    store: createStore({ indexedDB: null, now: () => now }),
    clock: () => now,
  });
  await c.set("a", "streams", "e", [1], { expiresAt: 100 });
  expect(await c.get("a", "streams", "e")).toEqual([1]);
  expect(await c.get("b", "streams", "e")).toBeNull();
  now = 101;
  expect(await c.get("a", "streams", "e")).toBeNull();
});
