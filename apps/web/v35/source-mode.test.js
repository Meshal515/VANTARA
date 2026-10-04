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
it("requires supported catalog filters before loading and sends selected options only", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  const calls = [];
  const addon = {
    name: "Catalog",
    capabilities: ["catalog"],
    contentTypes: ["movie"],
    catalogs: [
      {
        type: "movie",
        id: "top",
        name: "Top",
        extra: [
          { name: "genre", isRequired: true, options: ["Action", "Drama"] },
          { name: "search", isRequired: false },
          { name: "unsupported", isRequired: false },
        ],
      },
    ],
  };
  const view = renderSourceMode({
    addon,
    adapter: {
      catalog: async (args) => {
        calls.push(args);
        return [];
      },
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toHaveLength(0);
  expect(view.textContent).toContain("اختر");
  const select = view.querySelector("select");
  [...select.querySelectorAll("option")].find(
    (option) => option.value === "Action",
  ).selected = true;
  select.dispatchEvent(new document.defaultView.Event("change"));
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toHaveLength(1);
  expect(calls[0].extra).toEqual({ genre: "Action" });
  expect(calls[0].extra).not.toHaveProperty("unsupported");
});
it("does not dispatch a catalog with unknown required extras", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  let calls = 0;
  const view = renderSourceMode({
    addon: {
      name: "Catalog",
      capabilities: ["catalog"],
      contentTypes: ["movie"],
      catalogs: [
        {
          type: "movie",
          id: "x",
          extra: [{ name: "unknown", isRequired: true }],
        },
      ],
    },
    adapter: {
      catalog: async () => {
        calls++;
        return [];
      },
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toBe(0);
  expect(view.textContent).toContain("غير مدعوم");
});
it("retries the same failed next page while keeping loaded cards", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  const seen = [];
  let fail = true;
  const state = { tab: "search", query: "work", page: 1 };
  const view = renderSourceMode({
    addon: { name: "Only", capabilities: ["search"], contentTypes: ["manga"] },
    state,
    adapter: {
      search: async (_, page) => {
        seen.push(page);
        if (page === 2 && fail) {
          fail = false;
          throw new Error("Retry");
        }
        return { items: [{ title: `Page ${page}` }], hasNextPage: page === 1 };
      },
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  const more = [...view.querySelectorAll("button")].find(
    (b) => b.textContent === "تحميل المزيد",
  );
  more.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(more.hidden).toBe(false);
  expect(view.textContent).toContain("Page 1");
  more.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(seen).toEqual([1, 2, 2]);
  expect(view.textContent).toContain("Page 2");
});
