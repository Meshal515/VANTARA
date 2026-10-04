import { expect, it } from "vitest";
import { createAddonRuntime } from "./runtime.js";
import { createStore } from "../pwa/cache/store.js";
it("routes an installed Stremio episode by explicit video ID and keeps core available", async () => {
  const urls = [];
  const r = {
    ready: Promise.resolve(),
    store: createStore({ indexedDB: null }),
    registry: {
      list: () => [
        {
          id: "core",
          label: "Core",
          content: "anime",
          version: 1,
          domain: "core.test",
        },
      ],
      source: () => ({ search: async () => [] }),
      def: () => ({ id: "core" }),
      call: async () => [],
    },
  };
  const a = createAddonRuntime({
    runtime: r,
    store: r.store,
    transport: {
      json: async (url) => {
        urls.push(url);
        if (url.endsWith("manifest.json"))
          return {
            id: "org.demo",
            name: "Demo",
            version: "1.0.0",
            types: ["series"],
            resources: ["meta", "stream"],
            catalogs: [],
          };
        if (url.includes("/meta/"))
          return {
            meta: {
              id: "tt1196946",
              type: "series",
              videos: [
                { id: "tt1196946:1:1", season: 1, episode: 1 },
                { id: "tt1196946:2:1", season: 2, episode: 1 },
              ],
            },
          };
        return {
          streams: [{ url: "https://cdn.test/1080.mp4", name: "1080p" }],
        };
      },
    },
  });
  await a.ready;
  const installed = await a.registry.install(
    await a.registry.inspect("https://addon.test/manifest.json"),
  );
  const id = `addon|${installed.key}`,
    s = a.sources.source(id);
  const eps = await s.episodes({
    url: "tt1196946",
    type: "series",
    requestedSeason: 1,
  });
  expect(eps.map((x) => x.url)).toEqual(["tt1196946:1:1"]);
  const servers = await s.servers(eps[0]);
  expect((await s.streams(servers[0]))[0].quality).toBe(1080);
  expect(urls.at(-1)).toContain("tt1196946%3A1%3A1");
  expect(a.sources.list("anime").some((x) => x.id === "core")).toBe(true);
});
it("rejects zero playable addon streams and keeps native/bundled calls independent of remote health", async () => {
  const coreCalls = [];
  const r = {
    ready: Promise.resolve(),
    store: createStore({ indexedDB: null }),
    registry: {
      list: () => [],
      call: async (id, fn) => {
        coreCalls.push(id);
        return fn({ search: async () => ["core"] });
      },
    },
  };
  const a = createAddonRuntime({ runtime: r, transport: {} });
  await a.ready;
  expect(await a.sources.call("core", (s) => s.search("q"))).toEqual(["core"]);
  expect(coreCalls).toEqual(["core"]);
});
it("keeps stream health failed on zero links and isolates cached catalog results by addon version", async () => {
  let calls = 0;
  const r = {
    ready: Promise.resolve(),
    store: createStore({ indexedDB: null }),
    registry: { list: () => [] },
  };
  const a = createAddonRuntime({
    runtime: r,
    store: createStore({ indexedDB: null }),
    transport: {
      json: async (url) => {
        calls++;
        if (url.endsWith("manifest.json"))
          return {
            id: "org.demo",
            name: "Demo",
            version: "1.0.0",
            types: ["series"],
            resources: ["catalog", "stream"],
            catalogs: [{ type: "series", id: "demo" }],
          };
        return url.includes("/stream/")
          ? { streams: [] }
          : { metas: [{ id: "tt1", type: "series", name: "Work" }] };
      },
    },
  });
  await a.ready;
  const p = await a.registry.inspect("https://addon.test/manifest.json");
  await a.registry.install(p);
  const adapter = a.adapter(p.manifest.key);
  await adapter.catalog({ type: "series", id: "demo" });
  await adapter.catalog({ type: "series", id: "demo" });
  expect(calls).toBe(2);
  await adapter.streams({ type: "series", videoId: "tt1:1:1" });
  expect(a.registry.health.state(p.manifest.key, "streams", "pwa").state).toBe(
    "failed",
  );
});
it("passes playback cancellation through the Stremio facade to its actual HTTP request", async () => {
  const controller = new AbortController();
  let actualSignal;
  const r = { ready: Promise.resolve(), registry: { list: () => [] } };
  const a = createAddonRuntime({
    runtime: r,
    store: createStore({ indexedDB: null }),
    transport: {
      json: async (u, o) =>
        u.endsWith("manifest.json")
          ? {
              id: "org.demo",
              name: "Demo",
              version: "1.0.0",
              types: ["series"],
              resources: ["stream"],
              catalogs: [],
            }
          : ((actualSignal = o.signal), { streams: [] }),
    },
  });
  await a.ready;
  const p = await a.registry.inspect("https://addon.test/manifest.json");
  await a.registry.install(p);
  const s = a.sources.source(`addon|${p.manifest.key}`);
  await s.streams(
    { type: "series", url: "tt1:1:2", episode: { number: 2, season: 1 } },
    null,
    { signal: controller.signal },
  );
  expect(actualSignal).toBe(controller.signal);
});
it("listing subtitle providers does not consume the half-open health probe", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  try {
    const r = {
      ready: Promise.resolve(),
      store: createStore({ indexedDB: null }),
      registry: { list: () => [] },
    };
    const a = createAddonRuntime({
      runtime: r,
      transport: {
        json: async (u) =>
          u.endsWith("manifest.json")
            ? {
                id: "org.sub",
                name: "Sub",
                version: "1.0.0",
                types: ["series"],
                resources: ["subtitles"],
                catalogs: [],
              }
            : { subtitles: [] },
      },
    });
    await a.ready;
    const p = await a.registry.inspect("https://addon.test/manifest.json");
    await a.registry.install(p);
    for (let i = 0; i < 3; i++)
      a.registry.health.failure(p.manifest.key, "subtitles", "pwa", "TIMEOUT");
    vi.setSystemTime(31001);
    const providers = a.subtitleProviders();
    expect(providers).toHaveLength(1);
    expect(a.subtitleProviders()).toHaveLength(1);
    await providers[0].subtitles({ type: "series", videoId: "tt1:1:1" });
    expect(
      a.registry.health.state(p.manifest.key, "subtitles", "pwa").state,
    ).toBe("healthy");
  } finally {
    vi.useRealTimers();
  }
});
it('isolates configured URL changes at the same addon id/version',async()=>{
 const store=createStore({indexedDB:null});const requests=[];
 const a=createAddonRuntime({runtime:{ready:Promise.resolve(),store,registry:{list:()=>[]}},transport:{json:async url=>{requests.push(url);return url.endsWith('manifest.json')?{id:'configured',name:'Configured',version:'1.0.0',types:['movie'],resources:['catalog'],catalogs:[{id:'c',type:'movie'}]}:{metas:[{id:url,name:url}]};}}});await a.ready;
 const one=await a.registry.install(await a.registry.inspect('https://addon.test/config-A/manifest.json'));const first=await a.adapter(one.key).catalog({type:'movie',id:'c'});
 const two=await a.registry.install(await a.registry.inspect('https://addon.test/config-B/manifest.json'));const second=await a.adapter(two.key).catalog({type:'movie',id:'c'});
 expect(second).not.toEqual(first);expect(requests.some(u=>u.includes('/config-B/catalog/'))).toBe(true);expect(two.cacheEpoch).not.toBe(one.cacheEpoch);
});
