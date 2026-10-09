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
it("shows a failing source clearly and heals itself with one automatic retry", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  let calls = 0;
  const view = renderSourceMode({
    addon: { key: "core|x", name: "X", capabilities: ["home"], contentTypes: ["manga"] },
    state: { tab: "home", query: "", page: 1 },
    adapter: { home: async () => { if (++calls === 1) throw new Error("timeout"); return { mangas: [{ url: "/a", title: "A" }], hasNextPage: false }; } },
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(view.querySelector(".addon-source-error").textContent).toContain("نعيد المحاولة");
  await new Promise((r) => setTimeout(r, 2600));
  expect(calls).toBe(2);
  expect(view.querySelector(".addon-source-error")).toBeNull();
  expect(view.querySelector(".up-card .up-title").textContent).toBe("A");
  view.close();
});

it('لا يبقي هياكل تحميل في مصدر لا يدعم إلا البحث قبل إدخال نص', async () => {
  globalThis.document = parseHTML('<html><body></body></html>').document;
  const view = renderSourceMode({ addon: { name: 'Only search', capabilities: ['search'] }, adapter: { search: async () => [] } });
  await new Promise(r => setTimeout(r, 0));
  expect(view.textContent).toContain('اكتب اسم العمل');
  expect(view.querySelectorAll('.up-skel')).toHaveLength(0);
  view.close();
});
it('يمنع تكرار الهوية في التصفح مع الحفاظ على الأعمال المختلفة بنفس العنوان والنوع', async () => {
  globalThis.document = parseHTML('<html><body></body></html>').document;
  const view = renderSourceMode({
    addon: { name: 'Catalog', capabilities: ['home'] },
    adapter: { home: async (p) => ({ items: p === 1 ? [
      { id: 'tt1', type: 'movie', title: 'Same' }, { id: 'tt2', type: 'movie', title: 'Same' },
      { id: 'tt1', type: 'series', title: 'Same' },
    ] : [{ id: 'tt1', type: 'movie', title: 'Same' }, { id: 'tt3', type: 'movie', title: 'Same' }], hasNext: p === 1 }) },
  });
  await new Promise(r => setTimeout(r, 0));
  [...view.querySelectorAll('button')].find(b => b.textContent === 'تحميل المزيد').click();
  await new Promise(r => setTimeout(r, 0));
  expect(view.querySelectorAll('.up-card')).toHaveLength(4);
  view.close();
});

it('يستأنف التحميل المتوقف بدل ترك هياكل التحميل بعد الرجوع', async () => {
  globalThis.document = parseHTML('<html><body></body></html>').document;
  let calls = 0;
  const view = renderSourceMode({ addon: { name: 'Source', capabilities: ['home'] }, adapter: { home: async () => {
    if (++calls === 1) return new Promise(() => {});
    return { items: [{ id: 'a', title: 'A' }], hasNext: false };
  } } });
  view.pause(); view.resume();
  await new Promise(r => setTimeout(r, 0));
  expect(calls).toBe(2);
  expect(view.querySelectorAll('.up-card')).toHaveLength(1);
  expect(view.querySelectorAll('.up-skel')).toHaveLength(0);
  view.close();
});
