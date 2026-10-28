import { expect, it } from "vitest";
import { createBundledAdapter } from "./bundled.js";
it("keeps the real full catalogue separate from the source latest listing", async () => {
  const calls = [];
  const source = {
    catalogue: async page => { calls.push(["catalogue", page]); return { mangas: [{ url: "/work/" + page, title: "Catalogue", memo: "kept" }], hasNextPage: true }; },
    latest: async page => { calls.push(["latest", page]); return { mangas: [], hasNextPage: false }; },
  };
  const adapter = createBundledAdapter({ sourceDef: { id: "selected", content: "manga" }, engine: { source: () => source, call: async (id, run) => { expect(id).toBe("selected"); return run(source); } } });
  expect(await adapter.catalogue(2)).toMatchObject({ mangas: [{ url: "/work/2", memo: "kept" }], hasNextPage: true });
  expect(await adapter.home(1)).toMatchObject({ mangas: [] });
  expect(calls).toEqual([["catalogue", 2], ["latest", 1]]);
});
it("does not advertise a full catalogue for anime or manga sources without that real method", () => {
  const make = (content, source) => createBundledAdapter({ sourceDef: { id: "selected", content }, engine: { source: () => source, call: async (_, run) => run(source) } });
  expect(make("anime", { latest() {}, catalogue() {} }).catalogue).toBeUndefined();
  expect(make("manga", { latest() {} }).catalogue).toBeUndefined();
});
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
