import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { renderSourceMode } from "./source-mode.js";
it("searches only the chosen adapter and preserves source/tab/filter on back", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  let query;
  const state = { tab: "search", query: "naruto", page: 1, scroll: 42 };
  const adapter = {
    search: async (q) => {
      query = q;
      return { mangas: [{ url: "/n", title: "Naruto" }], hasNextPage: false };
    },
  };
  let work;
  const view = renderSourceMode({
    addon: {
      key: "s",
      name: "Source",
      capabilities: ["search"],
      contentTypes: ["manga"],
    },
    adapter,
    state,
    onOpenWork: (x) => (work = x),
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(query).toBe("naruto");
  [...view.querySelectorAll("button")]
    .find((b) => b.textContent === "Naruto")
    .click();
  expect(work.url).toBe("/n");
  expect(state).toMatchObject({ tab: "search", query: "naruto", scroll: 42 });
});
it("loads only the selected source next page and cancels requests when leaving", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  const seen = [];
  let signal;
  const state = { tab: "search", query: "work", page: 1 };
  const view = renderSourceMode({
    addon: { name: "Only", capabilities: ["search"], contentTypes: ["manga"] },
    state,
    adapter: {
      search: async (q, p, o) => {
        seen.push(p);
        signal = o.signal;
        return {
          mangas: [{ url: `/${p}`, title: `Page ${p}` }],
          hasNextPage: p === 1,
        };
      },
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  [...view.querySelectorAll("button")]
    .find((b) => b.textContent === "تحميل المزيد")
    .click();
  await new Promise((r) => setTimeout(r, 0));
  expect(seen).toEqual([1, 2]);
  expect(view.textContent).toContain("Page 1");
  expect(view.textContent).toContain("Page 2");
  view.close();
  expect(signal.aborted).toBe(true);
});
