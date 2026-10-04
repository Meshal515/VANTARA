import { expect, it } from "vitest";
import { createRemoteAdapter } from "./remote.js";
it("encodes data in a fixed same-origin template instead of accepting an arbitrary endpoint", async () => {
  let url;
  const a = createRemoteAdapter({
    manifest: {
      key: "x",
      baseUrl: "https://addon.test/",
      capabilities: ["search"],
      resources: { search: "/search?query={query}&page={page}" },
    },
    transport: {
      json: async (u) => {
        url = u;
        return { mangas: [] };
      },
    },
  });
  await a.search("https://evil.test/?a=b", 1);
  expect(new URL(url).origin).toBe("https://addon.test");
  expect(new URL(url).searchParams.get("query")).toBe("https://evil.test/?a=b");
  await expect(a.pages({ url: "x" })).rejects.toThrow();
});
it("bounds home responses before they reach the page", async () => {
  const a = createRemoteAdapter({
    manifest: {
      baseUrl: "https://addon.test",
      capabilities: ["home"],
      resources: { home: "/home" },
    },
    transport: {
      json: async () => ({
        mangas: Array.from({ length: 1001 }, () => ({ url: "x", title: "X" })),
      }),
    },
  });
  await expect(a.home()).rejects.toThrow();
});
it("preserves owning work in reused chapter IDs and in the pages request", async () => {
  let url;
  const a = createRemoteAdapter({
    manifest: {
      key: "demo",
      baseUrl: "https://addon.test/",
      capabilities: ["details", "pages"],
      resources: {
        details: "/work/{workId}",
        pages: "/work/{workId}/chapter/{chapterId}",
      },
    },
    transport: {
      json: async (u) => {
        url = u;
        return u.includes("/chapter/")
          ? { pages: [] }
          : {
              manga: { url: u, title: "M" },
              chapters: [{ url: "chapter-1", name: "1", memo: "original" }],
            };
      },
    },
  });
  const one = await a.series({ url: "work-a" }),
    two = await a.series({ url: "work-b" });
  expect(one.chapters[0].memo).not.toBe(two.chapters[0].memo);
  await a.pages(two.chapters[0]);
  expect(url).toBe("https://addon.test/work/work-b/chapter/chapter-1");
});
