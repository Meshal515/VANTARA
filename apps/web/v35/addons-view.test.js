import { expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { renderAddons, renderAddonDetails, configureInApp } from "./addons-view.js";
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

it("explains how to bring a provider's Stremio install link back into VANTARA beside configuration", () => {
  setup();
  const addon = row("Torrentio", {
    bundled: false,
    configuration: { required: true, configurable: true, configured: false },
  });
  const view = renderAddonDetails({
    addon,
    registry: { configurationUrl: () => "https://torrentio.test/configure" },
  });
  const help = view.querySelector(".addon-configure-help");
  expect(help).not.toBeNull();
  expect(help?.textContent).toContain("تثبيت في Stremio");
  expect(help?.textContent).toContain("انسخ رابط هذا الزر");
  expect(help?.textContent).toContain("إضافة جديدة");
  expect(help?.textContent).toContain("stremio://");
  expect(help?.previousElementSibling).toBe(view.querySelector(".addon-actions"));
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

it('previews a configured return link beside setup and replaces saved settings without duplicates', async () => {
  setup();
  const {createAddonRegistry}=await import('../addons/registry.js');
  const {createStore}=await import('../pwa/cache/store.js');
  const store=createStore({indexedDB:null}),manifest={id:'org.demo',name:'Demo',version:'1.0.0',types:['movie'],resources:['subtitles'],catalogs:[],behaviorHints:{configurable:true}};
  const registry=createAddonRegistry({store,transport:{json:async()=>manifest}});await registry.ready;
  const addon=await registry.install(await registry.inspect('https://addon.test/manifest.json'));
  await registry.enable(addon.key,false);
  const view=renderAddonDetails({addon,registry});const input=view.querySelector('[data-configured-url]');
  expect(input).not.toBeNull();input.value='stremio://addon.test/settings/manifest.json?token=private';
  click(view,'معاينة رابط الإعداد');await tick();
  expect((await store.get('state','addons.v1')).value[0].url).toBe('https://addon.test/manifest.json');
  expect(view.textContent).not.toContain('private');
  click(view,'حفظ الإعداد');await tick();
  expect(registry.list()).toHaveLength(1);expect(registry.list()[0].enabled).toBe(false);
  const again=createAddonRegistry({store,transport:{json:async()=>manifest}});await again.ready;
  expect(again.list()[0].enabled).toBe(false);await again.enable(addon.key,true);
  expect(again.connection(addon.key).manifestUrl).toBe('https://addon.test/settings/manifest.json?token=private');
});

it('cancels a configured-link preview and rejects a different addon identity',async()=>{
 setup();let release;const install=vi.fn();
 const addon=row('Demo',{id:'org.demo',bundled:false,configuration:{configurable:true}});
 const registry={configurationUrl:()=> 'https://addon.test/configure',inspect:()=>new Promise(resolve=>{release=resolve;}),install};
 const view=renderAddonDetails({addon,registry});view.querySelector('[data-configured-url]').value='https://addon.test/configured/manifest.json';
 click(view,'معاينة رابط الإعداد');view.close();release({manifest:{id:'org.demo',name:'Late'}});await tick();
 expect(view.textContent).not.toContain('Late');expect([...view.querySelectorAll('button')].some(b=>b.textContent==='حفظ الإعداد')).toBe(false);
 const other=renderAddonDetails({addon,registry:{...registry,inspect:async()=>({manifest:{id:'org.other',name:'Other'}})}});
 other.querySelector('[data-configured-url]').value='https://addon.test/other/manifest.json';click(other,'معاينة رابط الإعداد');await tick();
 expect(other.textContent).toContain('هوية الإضافة');expect(install).not.toHaveBeenCalled();
});

it('describes desktop automatic capture and browser or APK manual fallback honestly',()=>{
 setup();const addon=row('Demo',{bundled:false,configuration:{configurable:true}});
 const desktop=renderAddonDetails({addon,registry:{runtimeName:'desktop',configurationUrl:()=> 'https://addon.test/configure'}});
 expect(desktop.querySelector('.addon-configure-help').textContent).toContain('معاينة داخل VANTARA');
 for(const runtimeName of ['pwa','apk']){
  const view=renderAddonDetails({addon,registry:{runtimeName,configurationUrl:()=> 'https://addon.test/configure'}});
  expect(view.querySelector('.addon-configure-help').textContent).toContain('لا تضمن الخدمة العودة التلقائية');
 }
});

it('allows correcting the configured link while a slow preview is pending',async()=>{
 setup();let release;const addon=row('Demo',{id:'org.demo',bundled:false,configuration:{configurable:true}});
 const view=renderAddonDetails({addon,registry:{configurationUrl:()=> 'https://addon.test/configure',inspect:()=>new Promise(resolve=>{release=resolve;}),install:async()=>{}}});
 const input=view.querySelector('[data-configured-url]');input.value='https://addon.test/old/manifest.json';click(view,'معاينة رابط الإعداد');
 input.value='https://addon.test/new/manifest.json';input.dispatchEvent(new document.defaultView.Event('input'));
 expect([...view.querySelectorAll('button')].find(b=>b.textContent==='معاينة رابط الإعداد').disabled).toBe(false);
 release({manifest:{id:'org.demo',name:'Old'}});await tick();expect(view.textContent).not.toContain('Old');
});

it('reviews another host explicitly before replacing the configured addon without a duplicate',async()=>{
 setup();const {createAddonRegistry}=await import('../addons/registry.js');const {createStore}=await import('../pwa/cache/store.js');
 const manifest={id:'org.demo',name:'Demo',version:'1.0.0',types:['movie'],resources:['subtitles'],catalogs:[],behaviorHints:{configurable:true}};
 const registry=createAddonRegistry({store:createStore({indexedDB:null}),transport:{json:async()=>manifest}});await registry.ready;
 const addon=await registry.install(await registry.inspect('https://addon.test/manifest.json')),view=renderAddonDetails({addon,registry});
 view.querySelector('[data-configured-url]').value='https://other.test/manifest.json';click(view,'معاينة رابط الإعداد');await tick();
 expect(view.textContent).toContain('مضيف الإضافة');expect(view.textContent).toContain('other.test');expect(registry.list()).toHaveLength(1);
 expect(registry.connection(addon.key).manifestUrl).toBe('https://addon.test/manifest.json');
 click(view,'حفظ الإعداد');await tick();expect(registry.list()).toHaveLength(1);
 expect(registry.connection(addon.key).manifestUrl).toBe('https://other.test/manifest.json');
});


it("on the phone, Install inside the configure page installs the configured addon here instead of opening Stremio", async () => {
  setup();
  const link = document.createElement("a");
  link.textContent = "إعداد الإضافة";
  document.body.append(link);
  const configured = "https://subdl.strem.top/KEY/manifest.json";
  const preview = { manifest: { name: "SubDL" } };
  const registry = {
    inspect: vi.fn(async (url) => (url === configured ? preview : null)),
    install: vi.fn(async (p) => ({ manifest: { key: "subdl", name: p.manifest.name } })),
  };
  const events = [];
  document.body.addEventListener("addon-configured", (e) => events.push(e.detail));
  const plugin = { configure: vi.fn(async () => ({ url: configured })) };
  await configureInApp(link, plugin, "https://subdl.strem.top/configure", registry);
  expect(plugin.configure).toHaveBeenCalledWith({ url: "https://subdl.strem.top/configure" });
  expect(registry.install).toHaveBeenCalledWith(preview);
  expect(link.textContent).toBe("تم تثبيت SubDL بإعداداتك");
  expect(events).toEqual([{ key: "subdl" }]);
  // إغلاق الصفحة بلا Install لا يثبّت شيئًا
  registry.install.mockClear();
  await configureInApp(link, { configure: async () => ({ cancelled: true }) }, "https://subdl.strem.top/configure", registry);
  expect(registry.install).not.toHaveBeenCalled();
  expect(link.textContent).toBe("إعداد الإضافة");
});


it('keeps retry, update and actual reinstall distinct and prevents duplicate reinstall clicks', async () => {
  setup(); let release; const reinstall = vi.fn(() => new Promise(resolve => { release = resolve; }));
  const stage = vi.fn(), reset = vi.fn(), onCheck = vi.fn(async () => ({ checks: [] })), onBack = vi.fn();
  const addon = row('External', { bundled: false });
  const view = renderAddonDetails({ addon, registry: { reinstall, stage, health: { reset } }, onCheck, onBack });
  click(view, 'إعادة المحاولة'); await tick();
  expect(reset).toHaveBeenCalledWith(addon.key); expect(onCheck).toHaveBeenCalledOnce(); expect(reinstall).not.toHaveBeenCalled();
  click(view, 'فحص تحديث الإضافة'); await tick(); expect(stage).toHaveBeenCalledWith(addon.key);
  onBack.mockClear();
  click(view, 'إعادة تثبيت الإضافة'); click(view, 'إعادة تثبيت الإضافة');
  expect(reinstall).toHaveBeenCalledOnce(); expect(onBack).not.toHaveBeenCalled();
  expect(reinstall.mock.calls[0][0]).toBe(addon.key);
  release(); await tick(); expect(onBack).toHaveBeenCalledOnce();
});


it('keeps the installed detail visible and sanitizes a failed reinstall endpoint', async () => {
  setup(); const onBack = vi.fn();
  const view = renderAddonDetails({ addon: row('Torrentio', { bundled: false }), registry: { reinstall: async () => { throw new Error('failed https://addon.test/private-config/manifest.json?token=private'); } }, onBack });
  click(view, 'إعادة تثبيت الإضافة'); await tick();
  expect(onBack).not.toHaveBeenCalled();
  expect(view.textContent).toContain('[رابط الخدمة]');
  expect(view.textContent).not.toContain('private-config');
  expect([...view.querySelectorAll('button')].find(b => b.textContent === 'إعادة تثبيت الإضافة').disabled).toBe(false);
});


it('cancels a pending reinstall when details close and ignores late navigation', async () => {
  setup(); let release, signal; const onBack = vi.fn();
  const view = renderAddonDetails({ addon: row('Torrentio', { bundled: false }), registry: { reinstall: (_key, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); } }, onBack });
  click(view, 'إعادة تثبيت الإضافة'); view.close();
  expect(signal.aborted).toBe(true); release(); await tick();
  expect(onBack).not.toHaveBeenCalled();
});


it('shows disabled before configuration when both apply to an installed addon', () => {
  setup();
  const view = renderAddonDetails({ addon: row('Disabled', { bundled: false, enabled: false, configuration: { required: true, configured: false } }), registry: {} });
  expect(view.querySelector('.addon-health').textContent).toBe('معطلة');
});


it("V7 starts with real stores only, three tabs, and no sample repositories", async () => {
  setup();
  const view=renderAddons({registry:{list:()=>[]}});
  await tick();
  expect(view.querySelectorAll(".v7-tab").length).toBe(3);
  expect(view.textContent).toContain("ابدأ بإضافة مصدر لك");
  expect(view.textContent).not.toContain("استكشاف");
  expect(view.textContent).not.toContain("MIHON");
  expect(view.querySelector(".addon-grid")).toBeNull();
  expect(view.back()).toBe(false);
});
it("V7 reads existing installed addons without clearing their registry", async () => {
  setup();
  const saved=[row("مصدري", {capabilities:["catalog","search"],contentTypes:["anime"]})];
  const list=vi.fn(()=>saved);
  const view=renderAddons({registry:{list,runtimeName:"pwa"}});
  await tick();
  expect(list).toHaveBeenCalled();
  view.querySelectorAll(".v7-tab")[1].click();
  expect(view.textContent).toContain("مصدري");
  expect(saved).toHaveLength(1);
  expect(view.querySelector(".v7-status-slot")).not.toBeNull();
});
it("V7 opens addon details from the entire row and respects nested back", async () => {
  setup();
  const view=renderAddons({registry:{list:()=>[row("Original", {capabilities:["catalog"]})]}});
  await tick();
  view.querySelectorAll(".v7-tab")[1].click();
  view.querySelector(".v7-row").click();
  expect(view.querySelector(".v7-layer").hidden).toBe(false);
  expect(view.textContent).toContain("Original");
  expect(view.back()).toBe(true);
  expect(view.querySelector(".v7-layer").hidden).toBe(true);
  expect(view.back()).toBe(false);
});
it("V7 plus button in add dialog invokes the file input, not a fake import", async () => {
  setup();
  const view=renderAddons({registry:{list:()=>[]}});
  click(view,"أضف");
  const file=view.querySelector('[data-import-file]');
  expect(file).not.toBeNull();
  const open=vi.fn();
  file.click=open;
  view.querySelector(".v7-upload").click();
  expect(open).toHaveBeenCalledTimes(1);
  expect(file.accept).toContain(".json");
});
it("V7 preserves native repositories and reads their sources through the real store", async () => {
  setup();
  const entry={pkg:"net.demo.source",name:"Original Mihon Source",lang:"en",installed:true,version:"1"};
  const repos={kind:"manga",list:vi.fn(async()=>({repos:[{name:"My repo",url:"https://repo.test/repo.json"}]})),extensions:vi.fn(async()=>[entry])};
  const view=renderAddons({registry:{list:()=>[]},repositories:repos});
  await tick();await tick();
  expect(view.textContent).toContain("My repo");
  click(view,"استعراض");
  await tick();
  expect(view.textContent).toContain("Original Mihon Source");
  expect(repos.extensions).toHaveBeenCalled();
  expect(entry.installed).toBe(true);
});
it("V7 asks for explicit red delete confirmation; cancel never touches installed addon", async () => {
  setup();
  const saved=[row("Keep my addon",{bundled:false,key:"keep",capabilities:["catalog"]})];
  const remove=vi.fn(async()=>saved.pop());
  const view=renderAddons({registry:{list:()=>saved,remove}});
  await tick();
  view.querySelectorAll(".v7-tab")[1].click();
  view.querySelector(".v7-trash").click();
  expect(view.querySelector(".v7-dialog .danger")).not.toBeNull();
  expect(remove).not.toHaveBeenCalled();
  click(view,"رجوع");
  expect(remove).not.toHaveBeenCalled();
  expect(saved).toHaveLength(1);
});
it("V7 imports inspected JSON with explicit preview selection only", async () => {
  setup();
  const saved=[],install=vi.fn(async p=>saved.push(p.manifest));
  const registry={list:()=>saved,inspectData:async()=>[{name:"Good",preview:{manifest:row("Good")}}, {name:"Bad",error:Error("Invalid") }],install};
  const view=renderAddons({registry});
  click(view,"أضف");
  const file=view.querySelector('[data-import-file]');
  Object.defineProperty(file,"files",{configurable:true,value:[{name:"one.json",size:30,text:async()=> "[]"}]});
  file.dispatchEvent(new document.defaultView.Event("change"));
  await tick();await tick();
  const checks=view.querySelectorAll('.v7-dialog input[type="checkbox"]');
  expect(checks).toHaveLength(2);
  expect(checks[1].disabled).toBe(true);
  expect(install).not.toHaveBeenCalled();
  click(view,"تثبيت المحدد");
  await tick();await tick();
  expect(install).toHaveBeenCalledTimes(1);
  expect(saved[0].name).toBe("Good");
});
