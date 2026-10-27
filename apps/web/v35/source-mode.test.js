import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { renderSourceMode } from "./source-mode.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps a visible loading cover until the saved native image actually loads", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  let finish;
  vi.stubGlobal("Capacitor", { Plugins: { ExtensionEngine: { cover: () => new Promise(resolve => { finish = resolve; }) } } });
  const view = renderSourceMode({
    addon: { name: "Native", protocol: "native", sourceId: "native-reader", capabilities: ["home"], contentTypes: ["manga"] },
    adapter: { home: async () => ({ items: [{ url: "1", title: "Work", thumbnailUrl: "https://images.example.com/visible-native-loading.webp" }] }) },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const art = view.querySelector(".up-art");
  expect(art.dataset.imageState).toBe("loading");
  expect(art.getAttribute("aria-busy")).toBe("true");
  expect(art.querySelector(".skeleton")).not.toBeNull();
  finish({ path: "/saved/visible-native-loading.webp" });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(art.dataset.imageState).toBe("loading");
  const image = art.querySelector("img");
  image.onload();
  expect(art.dataset.imageState).toBe("ready");
  expect(art.getAttribute("aria-busy")).toBe("false");
  expect(art.querySelector(".skeleton")).toBeNull();
  expect(art.querySelector("img")).toBe(image);
  view.close();
});

it("shows an honest fallback when the source cover pipeline fails without guessing a cause", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  vi.stubGlobal("Capacitor", { Plugins: { ExtensionEngine: { cover: async () => { throw new Error("unknown source failure"); } } } });
  const view = renderSourceMode({
    addon: { name: "Native", protocol: "native", sourceId: "native-reader", capabilities: ["home"], contentTypes: ["manga"] },
    adapter: { home: async () => ({ items: [{ url: "1", title: "Work", thumbnailUrl: "https://images.example.com/visible-native-failure.webp" }] }) },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const art = view.querySelector(".up-art");
  expect(art.dataset.imageState).toBe("failed");
  expect(art.title).toBe("تعذّر تحميل الغلاف");
  expect(art.getAttribute("aria-label")).toBe("تعذّر تحميل الغلاف");
  expect(art.querySelector(".image-fallback")).not.toBeNull();
  expect(art.querySelector("img,.skeleton")).toBeNull();
  expect(art.textContent).not.toMatch(/Cloudflare|تحقق/);
  view.close();
});

it("replaces a failed public image with visible fallback art", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  const view = renderSourceMode({
    addon: { name: "External", protocol: "remote", capabilities: ["home"], contentTypes: ["manga"] },
    adapter: { home: async () => ({ items: [{ url: "1", title: "Work", thumbnailUrl: "https://images.example.com/visible-public-failure.webp" }] }) },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const art = view.querySelector(".up-art");
  expect(art.dataset.imageState).toBe("loading");
  art.querySelector("img").onerror();
  expect(art.dataset.imageState).toBe("failed");
  expect(art.querySelector(".image-fallback")).not.toBeNull();
  expect(art.querySelector("img,.skeleton")).toBeNull();
  view.close();
});

it("distinguishes a missing source cover from a failed download", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  const view = renderSourceMode({
    addon: { name: "Source", capabilities: ["home"], contentTypes: ["manga"] },
    adapter: { home: async () => ({ items: [{ url: "1", title: "Work" }] }) },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const art = view.querySelector(".up-art");
  expect(art.dataset.imageState).toBe("missing");
  expect(art.title).toBe("لا يوجد غلاف من المصدر");
  expect(art.querySelector(".image-fallback")).not.toBeNull();
  view.close();
});

it("loads native manga covers through the source session and renders the saved file", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  const sourceId = "eu.kanade.tachiyomi.extension.ar.mangaswat#7657007209499352344";
  const url = "https://images.example.com/native-session-cover.webp";
  const cover = vi.fn(async () => ({ path: "/data/user/0/com.vantara.app.debug/files/covers/source.webp" }));
  vi.stubGlobal("Capacitor", {
    Plugins: { ExtensionEngine: { cover } },
    convertFileSrc: path => "https://localhost/_capacitor_file_" + path,
  });
  const view = renderSourceMode({
    addon: { name: "Native manga", protocol: "native", sourceId, capabilities: ["home"], contentTypes: ["manga"] },
    adapter: { home: async () => ({ items: [{ url: "1702288", title: "Work", thumbnailUrl: url }] }) },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(cover).toHaveBeenCalledWith({ sourceId, url });
  expect(view.querySelector(".up-art img")?.getAttribute("src")).toBe("https://localhost/_capacitor_file_/data/user/0/com.vantara.app.debug/files/covers/source.webp");
  view.close();
});

it("does not retry protected native covers as unauthenticated WebView image requests", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  vi.stubGlobal("Capacitor", { Plugins: { ExtensionEngine: { cover: async () => { throw new Error("verification required"); } } } });
  const view = renderSourceMode({
    addon: { name: "Native manga", bundled: true, sourceId: "native-reader", capabilities: ["home"], contentTypes: ["manga"] },
    adapter: { home: async () => ({ items: [{ url: "1", title: "Work", thumbnailUrl: "https://images.example.com/verification-cover.webp" }] }) },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(view.querySelector(".up-art img")).toBeNull();
  expect(view.querySelector(".up-title").textContent).toBe("Work");
  view.close();
});

it("ignores cover responses after leaving the source screen", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  let finish;
  vi.stubGlobal("Capacitor", { Plugins: { ExtensionEngine: { cover: () => new Promise(resolve => { finish = resolve; }) } } });
  const view = renderSourceMode({
    addon: { name: "Native manga", protocol: "native", sourceId: "native-reader", capabilities: ["home"], contentTypes: ["manga"] },
    adapter: { home: async () => ({ items: [{ url: "1", title: "Work", thumbnailUrl: "https://images.example.com/late-native-cover.webp" }] }) },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  const art = view.querySelector(".up-art");
  expect(finish).toBeTypeOf("function");
  view.close();
  finish({ path: "/saved/late-cover.webp" });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(art.querySelector("img")).toBeNull();
});

it("keeps pending first-page covers when another source page is appended", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  const pending = [];
  vi.stubGlobal("Capacitor", { Plugins: { ExtensionEngine: { cover: () => new Promise(resolve => pending.push(resolve)) } } });
  const view = renderSourceMode({
    addon: { name: "Native manga", protocol: "native", sourceId: "native-reader", capabilities: ["home"], contentTypes: ["manga"] },
    adapter: { home: async page => ({ items: [{ url: String(page), title: "Page " + page, thumbnailUrl: `https://images.example.com/append-cover-${page}.webp` }], hasNextPage: page === 1 }) },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  view.querySelector(".addon-source-more").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  pending[0]({ path: "/saved/first.webp" });
  pending[1]({ path: "/saved/second.webp" });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([...view.querySelectorAll(".up-art img")].map(img => img.getAttribute("src"))).toEqual(["/saved/first.webp", "/saved/second.webp"]);
  view.close();
});

it("leaves external add-on poster URLs on their existing public image route", async () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  const cover = vi.fn();
  vi.stubGlobal("Capacitor", { Plugins: { ExtensionEngine: { cover } } });
  const url = "https://images.example.com/external-public-cover.webp";
  const view = renderSourceMode({
    addon: { name: "External manga", protocol: "stremio", capabilities: ["home"], contentTypes: ["manga"] },
    adapter: { home: async () => ({ items: [{ url: "1", title: "Work", thumbnailUrl: url }] }) },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(view.querySelector(".up-art img")?.getAttribute("src")).toBe(url);
  expect(cover).not.toHaveBeenCalled();
  view.close();
});

it("shows actual source logos and replaces broken images with a clean glyph", () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  const view = renderSourceMode({ addon: { name: "Actual source", iconUrl: "https://images.example.com/icon.png" }, adapter: {} });
  const mark = view.querySelector(".addon-source-head .addon-logo");
  const image = mark.querySelector("img");
  expect(image?.getAttribute("src")).toBe("https://images.example.com/icon.png");
  expect(image.style.objectFit).toBe("contain");
  expect(image.referrerPolicy).toBe("no-referrer");
  image.onerror();
  expect(mark.querySelector("img")).toBeNull();
  expect(mark.querySelector("svg")).not.toBeNull();
  expect(mark.textContent).toBe("");
  view.close();
});

it("accepts bounded native PNG data while rejecting unsafe or oversized source logos", () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=";
  const accepted = renderSourceMode({ addon: { name: "Native", logo: png }, adapter: {} });
  expect(accepted.querySelector(".addon-logo img")?.getAttribute("src")).toBe(png);
  accepted.close();
  for (const logo of [undefined, "javascript:alert(1)", "http://example.com/icon.png", "https://user:secret@example.com/icon.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,AAAA<script>", "data:image/png;base64," + "A".repeat(90 * 1024)]) {
    const view = renderSourceMode({ addon: { name: "No invented initials", logo }, adapter: {} });
    const mark = view.querySelector(".addon-logo");
    expect(mark.querySelector("img")).toBeNull();
    expect(mark.querySelector("svg")).not.toBeNull();
    expect(mark.textContent).toBe("");
    view.close();
  }
});

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
    .find((b) => b.querySelector(".up-title")?.textContent === "Naruto")
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
