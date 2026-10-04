import { expect, it } from "vitest";
import { runProgressive } from "./scheduler.js";
it("publishes a ready result before slow jobs finish and bounds 100 providers", async () => {
  let active = 0,
    peak = 0,
    release;
  const blocked = new Promise((r) => (release = r)),
    found = [];
  const jobs = Array.from({ length: 100 }, (_, i) => ({
    origin: `o${i % 4}`,
    run: async () => {
      active++;
      peak = Math.max(peak, active);
      if (i === 0) await blocked;
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return i;
    },
  }));
  const done = runProgressive(jobs, {
    onResult: (x) => found.push(x),
    stagger: 1,
  });
  await new Promise((r) => setTimeout(r, 15));
  expect(found.length).toBeGreaterThan(0);
  expect(found).not.toContain(0);
  expect(peak).toBeLessThanOrEqual(6);
  release();
  await done;
  expect(found).toHaveLength(100);
});
it("does not publish a late result after cancellation", async () => {
  const c = new AbortController(),
    found = [];
  let release;
  const done = runProgressive(
    [
      {
        origin: "o",
        run: async () => {
          await new Promise((r) => (release = r));
          return 1;
        },
      },
    ],
    { signal: c.signal, onResult: (x) => found.push(x) },
  );
  await Promise.resolve();
  c.abort();
  release();
  await done;
  expect(found).toEqual([]);
});
