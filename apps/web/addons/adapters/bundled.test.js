import { expect, it } from "vitest";
import { createBundledAdapter } from "./bundled.js";
it("only calls the selected existing source and retains manga chapter memo", async () => {
  let called;
  const memo = '{"mangaPath":"/w"}';
  const a = createBundledAdapter({
    sourceDef: { id: "selected", content: "manga" },
    engine: {
      call: async (id, f) => {
        called = id;
        return f({
          series: async () => ({
            manga: { url: "/w", title: "Work" },
            chapters: [{ url: "chapter-1", memo }],
          }),
          search: async () => ({ mangas: [], hasNextPage: false }),
        });
      },
    },
  });
  const out = await a.series({ url: "/w" });
  expect(called).toBe("selected");
  expect(out.chapters[0].memo).toBe(memo);
});
