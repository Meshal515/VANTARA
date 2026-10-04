import { expect, it } from "vitest";
import { createAddonRegistry } from "./registry.js";
import { createStore } from "../pwa/cache/store.js";
const raw = (version = "1.0.0") => ({
  id: "org.demo",
  name: "Demo",
  version,
  types: ["series"],
  resources: ["stream"],
  catalogs: [],
});
const setup = () => {
  let version = "1.0.0";
  return {
    set: (v) => (version = v),
    registry: createAddonRegistry({
      store: createStore({ indexedDB: null }),
      transport: { json: async () => raw(version) },
    }),
  };
};
it("inspect does not install; explicit install survives reload with no credential URL in list", async () => {
  const { registry: r } = setup();
  await r.ready;
  const p = await r.inspect("https://addon.test/secret/manifest.json?key=abc");
  expect(r.list()).toHaveLength(0);
  await r.install(p);
  expect(r.list()).toHaveLength(1);
  expect(JSON.stringify(r.list())).not.toContain("secret");
  expect(r.list()[0].health?.streams).not.toBe("healthy");
  await r.enable(p.manifest.key, false);
  expect(r.list()[0].enabled).toBe(false);
});
it("stages updates until sessions release and supports compatible rollback", async () => {
  const { registry: r, set } = setup();
  await r.ready;
  const p = await r.inspect("https://addon.test/manifest.json");
  await r.install(p);
  const session = r.snapshot();
  set("2.0.0");
  await r.stage(p.manifest.key);
  expect(await r.activateStaged(p.manifest.key)).toBe(false);
  expect(session.addons[0].version).toBe("1.0.0");
  session.release();
  expect(await r.activateStaged(p.manifest.key)).toBe(true);
  expect(r.list()[0].version).toBe("2.0.0");
  await r.rollback(p.manifest.key);
  expect(r.list()[0].version).toBe("1.0.0");
});
it("protects bundled sources and allows core with no external addons", async () => {
  const r = createAddonRegistry({
    store: createStore({ indexedDB: null }),
    transport: {},
    coreAdapters: [{ key: "core|s", name: "Core", capabilities: ["search"] }],
  });
  await r.ready;
  await expect(r.remove("core|s")).rejects.toThrow();
  expect(r.snapshot().addons[0].key).toBe("core|s");
});
it("reopens the same store with addons still enabled and staged data isolated", async () => {
  const store = createStore({ indexedDB: null }),
    transport = { json: async () => raw() };
  const r = createAddonRegistry({ store, transport });
  await r.ready;
  await r.install(await r.inspect("https://addon.test/token/manifest.json"));
  const again = createAddonRegistry({ store, transport });
  await again.ready;
  expect(again.list()[0].enabled).toBe(true);
  expect(JSON.stringify(again.list())).not.toContain("/token/");
});
it("ignores a corrupt stored addon instead of taking down all core sources", async () => {
  const store = createStore({ indexedDB: null });
  await store.set("state", "addons.v1", [{ url: "bad-url" }, null]);
  const r = createAddonRegistry({
    store,
    transport: {},
    coreAdapters: [{ key: "core|s", name: "Core", capabilities: ["search"] }],
  });
  await expect(r.ready).resolves.toBeUndefined();
  expect(r.list()[0].key).toBe("core|s");
});
it("accepts a Stremio install link but persists an HTTPS request", async () => {
  let requested;
  const r = createAddonRegistry({
    store: createStore({ indexedDB: null }),
    transport: {
      json: async (u) => {
        requested = u;
        return raw();
      },
    },
  });
  await r.ready;
  await r.inspect("stremio://addon.test/manifest.json");
  expect(requested).toBe("https://addon.test/manifest.json");
});
it("persists per-capability health without making a successful manifest mean healthy playback", async () => {
  const store = createStore({ indexedDB: null }),
    transport = { json: async () => raw() };
  const r = createAddonRegistry({ store, transport });
  await r.ready;
  const p = await r.inspect("https://addon.test/manifest.json");
  await r.install(p);
  r.health.failure(p.manifest.key, "streams", "pwa", "RESOLVER_EMPTY");
  await r.flushHealth();
  const next = createAddonRegistry({ store, transport });
  await next.ready;
  expect(next.health.state(p.manifest.key, "streams", "pwa").state).toBe(
    "failed",
  );
  expect(next.health.state(p.manifest.key, "subtitles", "pwa").state).toBe(
    "unknown",
  );
});
it("shows staged permission changes before explicit activation and persists pin order", async () => {
  let manifest = raw();
  const store = createStore({ indexedDB: null }),
    r = createAddonRegistry({
      store,
      transport: { json: async () => manifest },
    });
  await r.ready;
  const p = await r.inspect("https://addon.test/manifest.json");
  await r.install(p);
  await r.pin(p.manifest.key, true);
  manifest = { ...raw("2.0.0"), resources: ["stream", "subtitles"] };
  await r.stage(p.manifest.key);
  expect(r.list()[0].stagedCapabilities).toContain("subtitles");
  expect(r.list()[0].pinned).toBe(true);
});
it("keeps pinned order scoped to a local profile and never changes another profiles pin", async () => {
  const { registry: r } = setup();
  await r.ready;
  const p = await r.inspect("https://addon.test/manifest.json");
  await r.install(p);
  r.setProfile("owner-a");
  await r.pin(p.manifest.key, true);
  expect(r.list()[0].pinned).toBe(true);
  r.setProfile("owner-b");
  expect(r.list()[0].pinned).toBe(false);
  r.setProfile("owner-a");
  expect(r.list()[0].pinned).toBe(true);
});
it('repeated exact install is a no-op during sessions and preserves disabled state/epoch/pin/health',async()=>{
 const {registry:r}=setup();await r.ready;
 const url='https://addon.test/token/manifest.json?key=private';
 const first=await r.install(await r.inspect(url));await r.enable(first.key,false);await r.pin(first.key,true);
 r.health.failure(first.key,'streams','pwa','TIMEOUT');const before=r.list()[0];const session=r.snapshot();
 const again=await r.install(await r.inspect(url));expect(again).toEqual(before);expect(r.list()[0]).toEqual(before);
 session.release();
});
it('changed configuration or raw manifest is still blocked by active sessions',async()=>{
 const {registry:r,set}=setup();await r.ready;const url='https://addon.test/A/manifest.json';
 const first=await r.install(await r.inspect(url));const session=r.snapshot();
 await expect(r.install(await r.inspect('https://addon.test/B/manifest.json'))).rejects.toThrow('انتهاء الجلسة');
 set('2.0.0');await expect(r.install(await r.inspect(url))).rejects.toThrow('انتهاء الجلسة');
 expect(r.list()[0].cacheEpoch).toBe(first.cacheEpoch);session.release();
});
it('does not trust mutated public preview and can retry failed persistence',async()=>{
 const store=createStore({indexedDB:null});let fail=false;const r=createAddonRegistry({store:{get:store.get,set:async(...args)=>fail?false:store.set(...args)},transport:{json:async()=>raw()}});await r.ready;
 const p=await r.inspect('https://addon.test/manifest.json');p.manifest.name='Tampered';p.manifest.permissions.networkHosts.push('evil.test');
 fail=true;await expect(r.install(p)).rejects.toThrow('حفظ');expect(r.list()).toEqual([]);
 fail=false;const installed=await r.install(p);expect(installed.name).toBe('Demo');expect(installed.permissions.networkHosts).toEqual(['addon.test']);
});
it('previews a bundle without installing and permits valid choices despite invalid siblings',async()=>{
 const {registry:r}=setup();await r.ready;
 const rows=await r.inspectData(JSON.stringify({addons:['https://addon.test/manifest.json','javascript:bad',{manifest:raw(),url:'https://second.test/manifest.json'}]}));
 expect(rows).toHaveLength(3);expect(rows[1].error).toBeTruthy();expect(r.list()).toHaveLength(0);
 await r.install(rows[2].preview);expect(r.list()[0].key).toBe('https://second.test|org.demo');
});
it('canonical raw field ordering does not replace an identical installed manifest',async()=>{
 let reverse=false;const r=createAddonRegistry({store:createStore({indexedDB:null}),transport:{json:async()=>Object.fromEntries(Object.entries(raw()).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)))}});await r.ready;
 const first=await r.install(await r.inspect('https://addon.test/manifest.json'));reverse=true;const session=r.snapshot();
 expect((await r.install(await r.inspect('https://addon.test/manifest.json'))).cacheEpoch).toBe(first.cacheEpoch);session.release();
});
it('serializes double installs and resets stale health only for a real activated version',async()=>{
 const {registry:r,set}=setup();await r.ready;const u='https://addon.test/manifest.json';
 const p1=await r.inspect(u),p2=await r.inspect(u);const [one,two]=await Promise.all([r.install(p1),r.install(p2)]);expect(one.cacheEpoch).toBe(two.cacheEpoch);expect(r.list()).toHaveLength(1);
 r.health.success(one.key,'streams','pwa',1);set('2.0.0');await r.stage(one.key);expect(r.list()[0].health.streams.state).toBe('healthy');await r.activateStaged(one.key);expect(r.list()[0].health.streams.state).toBe('unknown');
});
it('keeps lifecycle mutations in memory consistent when storage rejects them',async()=>{
 const store=createStore({indexedDB:null});let fail=false;const r=createAddonRegistry({store:{get:store.get,set:async(...args)=>fail?false:store.set(...args)},transport:{json:async()=>raw()}});await r.ready;
 const one=await r.install(await r.inspect('https://addon.test/manifest.json'));fail=true;
 await expect(r.enable(one.key,false)).rejects.toThrow();expect(r.list()[0].enabled).toBe(true);
 await expect(r.pin(one.key,true)).rejects.toThrow();expect(r.list()[0].pinned).toBe(false);
 await expect(r.remove(one.key)).rejects.toThrow();expect(r.list()).toHaveLength(1);
});
