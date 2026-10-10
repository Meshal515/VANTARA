import { expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { renderAddons, renderAddonDetails } from "./addons-view.js";
const setup = () => {
  globalThis.document = parseHTML("<html><body></body></html>").document;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (view, text) =>
  [...view.querySelectorAll("button")]
    .find((b) => b.textContent === text)
    ?.click();
const submit = (view) =>
  view
    .querySelector("form")
    .dispatchEvent(
      new document.defaultView.Event("submit", { cancelable: true }),
    );
const row = (name, extra = {}) => ({
  key: name,
  name,
  capabilities: ["search"],
  contentTypes: ["manga"],
  enabled: true,
  bundled: true,
  ...extra,
});
it("opens native external catalog addons without the obsolete subtitles-only notice", () => {
  setup();
  const addon=row("Catalog",{bundled:false,protocol:"stremio",capabilities:["catalog","meta","streams"],compatibility:{apk:true,apkCapabilities:["catalog","meta","streams"]}});
  const onOpenSource=vi.fn();
  const view=renderAddonDetails({addon,registry:{runtimeName:"apk"},onOpenSource});
  click(view,"فتح المصدر");
  expect(onOpenSource).toHaveBeenCalledWith(addon);
  expect(view.textContent).not.toContain("ترجمات مستقلة فقط");
});
it("filters cards and searches addon names without changing application section", () => {
  setup();
  const view = renderAddons({
    registry: {
      list: () => [row("Anime", { contentTypes: ["anime"] }), row("Manga")],
    },
  });
  click(view, "مانجا");
  expect(view.querySelector(".addon-grid").textContent).toContain("Manga");
  expect(view.querySelector(".addon-grid").textContent).not.toContain("Anime");
  const search = view.querySelector("[data-addon-search]");
  search.value = "no match";
  search.dispatchEvent(new document.defaultView.Event("input"));
  expect(view.querySelector(".addon-grid").textContent).toContain("لا توجد");
});
it("previews untrusted names as text and keeps configured URL secrets private", async () => {
  setup();
  let installed = 0;
  const view = renderAddons({
    registry: {
      list: () => [],
      inspect: async () => ({
        manifest: row("<img src=x onerror=evil()>", {
          permissions: { networkHosts: ["addon.test"] },
        }),
      }),
      install: async () => installed++,
    },
  });
  view.querySelector("[data-import-url]").value =
    "https://addon.test/token/manifest.json";
  submit(view);
  await tick();
  expect(installed).toBe(0);
  expect(view.querySelector("img")).toBeNull();
  expect(view.textContent).not.toContain("/token/");
  click(view, "إلغاء");
  expect(installed).toBe(0);
});
it("shows real discovery cards with configuration requirements and no invented stable health", () => {
  setup();
  const view = renderAddons({ registry: { list: () => [] } });
  click(view, "استكشاف");
  const cards = view.querySelector(".addon-grid");
  expect(cards.textContent).toContain("Cinemeta");
  expect(cards.textContent).toContain("SubDL");
  expect(cards.textContent).toContain("SubSource");
  expect(cards.textContent).toContain("يحتاج إعداد");
  expect(cards.textContent).not.toContain("مستقرة");
});
it("previews partial JSON bundles with selection and reveals installed rows across previous filters", async () => {
  setup();
  const rows = [];
  let selected;
  const p = {
    manifest: row("Subtitles", {
      capabilities: ["subtitles"],
      contentTypes: ["movie"],
      bundled: false,
    }),
  };
  const view = renderAddons({
    registry: {
      list: () => rows,
      inspectData: async () => [
        { name: "Subtitles", preview: p },
        { name: "Invalid", error: { message: "SERVICE_URL_REQUIRED" } },
      ],
      install: async (x) => {
        selected = x;
        const a = { ...x.manifest };
        rows.push(a);
        return a;
      },
    },
  });
  click(view, "مانجا");
  click(view, "JSON");
  view.querySelector("textarea").value = "[]";
  submit(view);
  await tick();
  expect(view.querySelectorAll("[data-preview-choice]").length).toBe(1);
  expect(view.textContent).toContain("Invalid");
  expect(view.textContent).toContain("رابط الخدمة");
  click(view, "تثبيت المحدد");
  await tick();
  expect(selected).toBe(p);
  expect(view.querySelector(".addon-grid").textContent).toContain("Subtitles");
});
it("installs only checked bundle previews and accepts multiple JSON files", async () => {
  setup();
  const installed = [];
  const view = renderAddons({
    registry: {
      list: () => [],
      inspectData: async (text) => [
        { name: text, preview: { manifest: row(text) } },
      ],
      install: async (p) => {
        installed.push(p.manifest.name);
        return p.manifest;
      },
    },
  });
  click(view, "ملف");
  const file = view.querySelector("[data-import-file]");
  Object.defineProperty(file, "files", {
    value: [
      { name: "a.json", text: async () => "Alpha" },
      { name: "b.json", text: async () => "Beta" },
    ],
  });
  submit(view);
  await tick();
  const choices = view.querySelectorAll("[data-preview-choice]");
  choices[1].checked = false;
  click(view, "تثبيت المحدد");
  await tick();
  expect(installed).toEqual(["Alpha"]);
});
it("cancel aborts pending inspection and ignores late responses", async () => {
  setup();
  let done, signal;
  const view = renderAddons({
    registry: {
      list: () => [],
      inspect: (_, { signal: s }) => {
        signal = s;
        return new Promise((r) => (done = r));
      },
    },
  });
  view.querySelector("[data-import-url]").value =
    "https://addon.test/manifest.json";
  submit(view);
  click(view, "إلغاء");
  expect(signal.aborted).toBe(true);
  done({ manifest: row("Late") });
  await tick();
  expect(view.textContent).not.toContain("Late");
});
it("configure opens only an HTTPS provider page in a new protected tab", () => {
  setup();
  const addon = row("Configured", {
    bundled: false,
    configuration: { required: true, configurable: true, configured: false },
  });
  const view = renderAddonDetails({
    addon,
    registry: { configurationUrl: () => "https://addon.test/configure" },
  });
  const link = view.querySelector("a[data-configure]");
  expect(link.getAttribute("href")).toBe("https://addon.test/configure");
  expect(link.target).toBe("_blank");
  expect(link.rel).toContain("noopener");
  expect(view.querySelector("iframe")).toBeNull();
});
it("keeps network permissions and diagnostics collapsed and shows supplied assessment", () => {
  setup();
  const addon = row("Addon", {
    assessment: { level: "candidate", label: "مرشحة", detail: "لم تُختبر" },
    permissions: { networkHosts: ["addon.test"] },
  });
  const view = renderAddonDetails({ addon, registry: {} });
  expect(view.textContent).toContain("مرشحة");
  expect(view.querySelector("details").hasAttribute("open")).toBe(false);
  expect(view.querySelector("details").textContent).toContain("addon.test");
});
it("passes check action and prevents duplicated pending mutation", async () => {
  setup();
  let resolve;
  const onCheck = vi.fn(() => new Promise((r) => (resolve = r)));
  const view = renderAddonDetails({
    addon: row("Addon"),
    registry: {},
    onCheck,
  });
  click(view, "فحص الإضافة");
  click(view, "فحص الإضافة");
  expect(onCheck).toHaveBeenCalledTimes(1);
  resolve();
  await tick();
});
it("shows actual failed and untested diagnostics and refreshes returned assessment", async () => {
  setup();
  const view = renderAddonDetails({
    addon: row("Addon"),
    registry: {},
    onCheck: async () => ({
      checks: [
        { capability: "catalog", state: "failed", message: "تعذر الطلب" },
        { capability: "streams", state: "untested", message: "لا توجد هوية" },
      ],
      assessment: {
        level: "broken",
        label: "غير سليمة",
        detail: "فشل الكتالوج",
      },
    }),
  });
  click(view, "فحص الإضافة");
  await tick();
  expect(view.textContent).toContain("تعذر الطلب");
  expect(view.textContent).toContain("لا توجد هوية");
  expect(view.textContent).toContain("غير سليمة");
  expect(view.querySelector("[role=status]").textContent).not.toContain(
    "تم بنجاح",
  );
});
it("cancels active detail diagnostics when the hub closes", async () => {
  setup();
  let signal, done;
  const view = renderAddons({
    registry: { list: () => [row("Addon")] },
    onCheck: (_, { signal: s }) => {
      signal = s;
      return new Promise((r) => (done = r));
    },
  });
  click(view, "تفاصيل");
  click(view, "فحص الإضافة");
  view.close();
  expect(signal.aborted).toBe(true);
  done({
    checks: [
      { capability: "catalog", state: "failed", message: "Late diagnostics" },
    ],
  });
  await tick();
  expect(view.textContent).not.toContain("Late diagnostics");
});
it("reports an unchanged staged update without navigating away", async () => {
  setup();
  const onBack = vi.fn();
  const view = renderAddonDetails({
    addon: row("Addon", { bundled: false }),
    registry: { stage: async () => ({ changed: false }) },
    onBack,
  });
  click(view, "فحص تحديث الإضافة");
  await tick();
  expect(view.textContent).toContain("لا توجد تحديثات");
  expect(onBack).not.toHaveBeenCalled();
});
it("offers configuration for a required provider even without configurable hint", () => {
  setup();
  const view = renderAddonDetails({
    addon: row("Addon", {
      configuration: { required: true, configured: false },
    }),
    registry: { configurationUrl: () => "https://addon.test/configure" },
  });
  expect(view.querySelector("[data-configure]")).not.toBeNull();
});
it("bounds multiple-file imports before reading oversized selections", async () => {
  setup();
  let reads = 0;
  const view = renderAddons({
    registry: { list: () => [], inspectData: async () => [] },
  });
  click(view, "ملف");
  Object.defineProperty(view.querySelector("[data-import-file]"), "files", {
    value: Array.from({ length: 101 }, (_, i) => ({
      name: `${i}.json`,
      text: async () => {
        reads++;
        return "{}";
      },
    })),
  });
  submit(view);
  await tick();
  expect(reads).toBe(0);
  expect(view.textContent).toContain("100");
});
it("locks cancel while committing and reveals a delayed install after old filters", async () => {
  setup();
  const rows = [];
  let finish;
  const p = {
    manifest: row("New subtitles", {
      capabilities: ["subtitles"],
      contentTypes: ["movie"],
    }),
  };
  const view = renderAddons({
    registry: {
      list: () => rows,
      inspect: async () => p,
      install: () =>
        new Promise((r) => {
          finish = () => {
            rows.push(p.manifest);
            r(p.manifest);
          };
        }),
    },
  });
  click(view, "مانجا");
  view.querySelector("[data-import-url]").value =
    "https://addon.test/manifest.json";
  submit(view);
  await tick();
  click(view, "تثبيت");
  const cancel = [...view.querySelectorAll("button")].find(
    (b) => b.textContent === "إلغاء",
  );
  expect(cancel.disabled).toBe(true);
  cancel.click();
  finish();
  await tick();
  expect(view.querySelector(".addon-grid").textContent).toContain(
    "New subtitles",
  );
});
it("native import summary closure aborts a busy preview and ignores its late result", async () => {
  setup();
  let signal, finish;
  const view = renderAddons({
    registry: {
      list: () => [],
      inspect: (_, { signal: s }) => {
        signal = s;
        return new Promise((r) => (finish = r));
      },
    },
  });
  view.querySelector("[data-import-url]").value =
    "https://addon.test/manifest.json";
  submit(view);
  const panel = view.querySelector(".addon-import");
  panel.open = false;
  panel.dispatchEvent(new document.defaultView.Event("toggle"));
  expect(signal.aborted).toBe(true);
  finish({ manifest: row("Late") });
  await tick();
  expect(view.textContent).not.toContain("Late");
});
it("navigation during commit ignores late DOM writes and reload reveals persisted rows", async () => {
  setup();
  const rows = [];
  let finish;
  const p = { manifest: row("Committed", { contentTypes: ["movie"] }) };
  const view = renderAddons({
    registry: {
      list: () => rows,
      inspect: async () => p,
      install: () =>
        new Promise((r) => {
          finish = () => {
            rows.push(p.manifest);
            r(p.manifest);
          };
        }),
    },
  });
  click(view, "مانجا");
  view.querySelector("[data-import-url]").value =
    "https://addon.test/manifest.json";
  submit(view);
  await tick();
  click(view, "تثبيت");
  const entry = view.querySelector(".addon-preview-entry");
  view.close();
  const html = view.innerHTML;
  finish();
  await tick();
  expect(view.innerHTML).toBe(html);
  expect(entry.textContent).not.toContain("تم التثبيت");
  view.reload();
  expect(view.querySelector(".addon-grid").textContent).toContain("Committed");
});
it("summary closure during commit preserves library reveal after persistence", async () => {
  setup();
  const rows = [];
  let finish;
  const p = { manifest: row("Committed", { contentTypes: ["movie"] }) };
  const view = renderAddons({
    registry: {
      list: () => rows,
      inspect: async () => p,
      install: () =>
        new Promise((r) => {
          finish = () => {
            rows.push(p.manifest);
            r(p.manifest);
          };
        }),
    },
  });
  click(view, "مانجا");
  view.querySelector("[data-import-url]").value =
    "https://addon.test/manifest.json";
  submit(view);
  await tick();
  click(view, "تثبيت");
  const panel = view.querySelector(".addon-import");
  panel.open = false;
  panel.dispatchEvent(new document.defaultView.Event("toggle"));
  finish();
  await tick();
  expect(view.querySelector(".addon-grid").textContent).toContain("Committed");
});
it("disables inactive import fields so stale invalid URLs cannot block JSON or file submits", () => {
  setup();
  const view = renderAddons({ registry: { list: () => [] } });
  view.querySelector("[data-import-url]").value = "invalid";
  click(view, "JSON");
  expect(view.querySelector("[data-import-url]").disabled).toBe(true);
  click(view, "ملف");
  expect(view.querySelector("[data-import-url]").disabled).toBe(true);
  expect(view.querySelector("textarea").disabled).toBe(true);
  click(view, "رابط");
  expect(view.querySelector("[data-import-url]").disabled).toBe(false);
  expect(view.querySelector('[aria-label="رابط الخدمة"]').disabled).toBe(true);
});
it("refreshes installed version actions after activation and rollback", async () => {
  setup();
  const onBack = vi.fn();
  const registry = {
    activateStaged: async () => true,
    rollback: async () => true,
  };
  const view = renderAddonDetails({
    addon: row("Addon", {
      bundled: false,
      stagedVersion: "2",
      previousVersion: "0",
    }),
    registry,
    onBack,
  });
  click(view, "تطبيق التحديث بعد انتهاء الجلسات");
  await tick();
  expect(onBack).toHaveBeenCalledTimes(1);
  click(view, "رجوع للنسخة السابقة");
  await tick();
  expect(onBack).toHaveBeenCalledTimes(2);
});
it("groups installed sources by section with their real pulse and probes due sources by itself", async () => {
  setup();
  const { createSourcePulse } = await import("../addons/source-pulse.js");
  const m = new Map();
  const pulse = createSourcePulse({ storage: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } });
  pulse.record("core|lek", "ok", { ms: 900 });
  const probed = [];
  const onOpenSource = vi.fn();
  vi.useFakeTimers();
  const view = renderAddons({
    registry: { runtimeName: "apk", list: () => [
      row("مانجا ليك", { key: "core|lek", capabilities: ["home", "search"] }),
      row("WitAnime", { key: "core|wit", contentTypes: ["anime"], capabilities: ["home", "search"] }),
      row("Torrentio", { key: "t", bundled: false, protocol: "stremio", capabilities: ["streams"], contentTypes: ["movie"] }),
    ] },
    pulse,
    onOpenSource,
    onProbe: async (a) => { probed.push(a.key); pulse.record(a.key, "failed", { error: "timeout" }); },
  });
  const groups = [...view.querySelectorAll(".addon-group-head h3")].map((h) => h.textContent);
  expect(groups).toEqual(["مصادر المانجا", "مصادر الأنمي", "إضافات Stremio والخدمات"]);
  const lek = view.querySelector('[data-key="core|lek"]');
  expect(lek.querySelector(".addon-pulse").textContent).toContain("يعمل");
  expect(view.querySelector('[data-key="core|wit"] .addon-pulse').textContent).toContain("لم يُفحص بعد");
  await vi.advanceTimersByTimeAsync(800);
  vi.useRealTimers();
  expect(probed).toEqual(["core|wit"]); // السليم حديثًا لا يُطرق
  expect(view.querySelector('[data-key="core|wit"] .addon-pulse').textContent).toContain("لا يستجيب");
  expect(view.querySelector(".addon-summary").textContent).toContain("1 من 2 مصدر يعمل");
  lek.querySelector(".addon-row-main").click();
  expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ key: "core|lek" }));
  view.close();
});

it('يعيد فحص المصدر المتعثر عند انتهاء المهلة ويوقف الفحص عند الخروج', async () => {
  setup();
  const { createSourcePulse } = await import('../addons/source-pulse.js');
  vi.useFakeTimers();
  try {
    const pulse = createSourcePulse({ storage: null });
    let calls = 0;
    const view = renderAddons({ registry: { list: () => [row('Source', { key: 'core|x' })] }, pulse,
      onProbe: async (a) => { calls++; pulse.record(a.key, 'failed'); } });
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
    view.close();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(2);
  } finally { vi.useRealTimers(); }
});
