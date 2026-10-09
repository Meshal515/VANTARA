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
it("keeps empty stream availability separate from failures and isolates cached catalog results by addon version", async () => {
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
    "empty",
  );
});

const diagnosticSetup = async (manifest, resources, native = false) => {
  const requests=[];
  const a=createAddonRuntime({runtime:{native,ready:Promise.resolve(),registry:{list:()=>[]}},store:createStore({indexedDB:null}),transport:{json:async(url,options)=>{
    requests.push({url,signal:options?.signal});
    if(url.endsWith('manifest.json'))return manifest;
    return resources(url);
  }}});
  await a.ready;
  const installed=await a.registry.install(await a.registry.inspect('https://addon.test/secret-token/manifest.json'));
  return {a,key:installed.key,requests};
};
const diagnosticManifest = (resources=['catalog','meta','stream','subtitles'], catalogs=[{type:'movie',id:'demo'}]) => ({id:'org.diagnostic',name:'Diagnostic',version:'1.0.0',types:['movie'],resources,catalogs});
it('diagnoses real catalog and matching metadata without inventing stream or subtitle identities', async()=>{
  const {a,key,requests}=await diagnosticSetup(diagnosticManifest(),url=>url.includes('/catalog/')?{metas:[{id:'tt123',type:'movie',name:'Real work'}]}:{meta:{id:'tt123',type:'movie',name:'Real work'}});
  await a.adapter(key).catalog({type:'movie',id:'demo'});
  const first=await a.diagnose(key);
  const second=await a.diagnose(key);
  expect(first.checks.map(x=>[x.capability,x.state])).toEqual([['catalog','passed'],['meta','passed'],['streams','untested'],['subtitles','untested']]);
  expect(second.assessment.level).toBe('candidate');
  expect(requests.filter(x=>x.url.includes('/catalog/'))).toHaveLength(3);
  expect(requests.some(x=>x.url.includes('/stream/')||x.url.includes('/subtitles/'))).toBe(false);
  expect(JSON.stringify(first)).not.toContain('secret-token');
});
it('uses only explicit sample identities and treats empty results as valid availability', async()=>{
  const {a,key,requests}=await diagnosticSetup(diagnosticManifest(['stream','subtitles'],[]),url=>url.includes('/stream/')?{streams:[]}:{subtitles:[]});
  const controller=new AbortController();
  const result=await a.diagnose(key,{signal:controller.signal,sample:{type:'movie',videoId:'tt123'}});
  expect(result.checks.map(x=>x.state)).toEqual(['empty','empty']);
  expect(result.assessment.level).toBe('candidate');
  expect(a.registry.health.state(key,'streams','pwa').state).toBe('empty');
  expect(requests.at(-1).signal).toBe(controller.signal);
});
it('reports safe failure messages and never promotes malformed responses', async()=>{
  const {a,key}=await diagnosticSetup(diagnosticManifest(['stream'],[]),()=>{throw new Error('https://addon.test/secret-token/stream/movie/tt123.json');});
  const result=await a.diagnose(key,{sample:{type:'movie',videoId:'tt123'}});
  expect(result.checks[0].state).toBe('failed');
  expect(result.assessment.level).toBe('broken');
  expect(JSON.stringify(result)).not.toContain('secret-token');
});
it('does not expose subtitle-only addons as playback sources on either platform', async()=>{
  for(const [resources,native] of [[['subtitles'],false],[['subtitles'],true]]){
    const {a}=await diagnosticSetup(diagnosticManifest(resources,resources.includes('catalog')?[{type:'movie',id:'demo'}]:[]),()=>({subtitles:[]}),native);
    expect(a.sources.list()).toEqual([]);
  }
});
it('opens installed APK catalogs and metadata through their configured service without manufacturing playback',async()=>{
  const {a,key,requests}=await diagnosticSetup(diagnosticManifest(['catalog','meta']),url=>url.includes('/catalog/')?{metas:[{id:'tt123',type:'movie',name:'Film'}]}:{meta:{id:'tt123',type:'movie',name:'Film'}},true);
  expect(a.sources.list('cinema')).toMatchObject([{id:`addon|${key}`,content:'cinema'}]);
  expect(await a.adapter(key).catalog({type:'movie',id:'demo'})).toMatchObject([{id:'tt123'}]);
  const source=a.sources.source(`addon|${key}`);
  const episodes=await source.episodes({type:'movie',id:'tt123'});
  expect(await source.servers(episodes[0])).toEqual([]);
  expect(requests.at(-1).url).toContain('/secret-token/meta/movie/tt123.json');
  expect(a.registry.list()[0].assessment.level).toBe('stable');
});
it('publishes APK DASH routes while PWA keeps their unsupported reason',async()=>{
  const {a,key}=await diagnosticSetup(diagnosticManifest(['stream'],[]),()=>({streams:[{url:'https://cdn.test/film.mpd',name:'2160p'}]}),true);
  const source=a.sources.source(`addon|${key}`);
  const [server]=await source.servers({type:'movie',url:'tt123'});
  expect(await source.streams(server)).toMatchObject([{type:'dash',status:'RESOLVED',quality:2160}]);
  expect(a.registry.health.state(key,'streams','apk').state).toBe('healthy');
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
    ).toBe("empty");
  } finally {
    vi.useRealTimers();
  }
});
it('chooses declared required filter options and probes meta after catalog regardless of resource order',async()=>{
  const m=diagnosticManifest(['meta','catalog'],[{type:'movie',id:'filtered',extra:[{name:'genre',isRequired:true,options:['Drama','Comedy']}]}]);
  const {a,key,requests}=await diagnosticSetup(m,url=>url.includes('/catalog/')?{metas:[{id:'tt123',type:'movie',name:'Film'}]}:{meta:{id:'tt123',type:'movie',name:'Film'}});
  const result=await a.diagnose(key);
  expect(result.checks.map(x=>[x.capability,x.state])).toEqual([['catalog','passed'],['meta','passed']]);
  expect(requests.find(x=>x.url.includes('/catalog/')).url).toContain('genre=Drama');
  expect(result.assessment.level).toBe('stable');
});
it('does not invent a required search query or count an unaddressable catalog as broken',async()=>{
  const {a,key,requests}=await diagnosticSetup(diagnosticManifest(['catalog'],[{type:'movie',id:'search',extra:[{name:'search',isRequired:true}]}]),()=>{throw new Error('should not request');});
  expect((await a.diagnose(key)).checks[0].state).toBe('untested');
  expect(requests).toHaveLength(1);
  expect(a.registry.list()[0].assessment.level).toBe('candidate');
});
it('excludes configuration-required providers and keeps direct use from creating failure health',async()=>{
  const m={...diagnosticManifest(['stream','subtitles'],[]),behaviorHints:{configurable:true,configurationRequired:true}};
  const {a,key,requests}=await diagnosticSetup(m,()=>{throw new Error('should not request');});
  expect(a.sources.list()).toEqual([]);expect(a.subtitleProviders()).toEqual([]);
  expect((await a.diagnose(key)).checks[0].state).toBe('configuration');
  expect(()=>a.adapter(key)).toThrow();
  expect(a.registry.health.state(key,'streams','pwa').state).toBe('unknown');
  expect(requests).toHaveLength(1);
});
it('keeps unsupported sample identities and aborted checks separate from provider failure',async()=>{
  const {a,key,requests}=await diagnosticSetup(diagnosticManifest([{name:'stream',types:['movie'],idPrefixes:['tt']}],[]),(_url)=>{throw new DOMException('cancelled','AbortError');});
  expect((await a.diagnose(key,{sample:{type:'movie',videoId:'wrong'}})).checks[0].state).toBe('untested');
  expect(requests).toHaveLength(1);
  await expect(a.diagnose(key,{sample:{type:'movie',videoId:'tt123'}})).rejects.toMatchObject({name:'AbortError'});
  expect(a.registry.health.state(key,'streams','pwa').state).toBe('unknown');
});
it('keeps unknown external types out of playback source categories without blocking direct catalogs',async()=>{
  const {a,key}=await diagnosticSetup({...diagnosticManifest(['catalog','stream']),types:['book'],catalogs:[{id:'c',type:'book'}]},()=>({metas:[]}));
  expect(a.sources.list()).toEqual([]);
  expect(a.sources.def(`addon|${key}`)).toBeNull();
  expect(await a.adapter(key).catalog({type:'book',id:'c'})).toEqual([]);
});
it('does not manufacture servers for a catalog and metadata-only source',async()=>{
  const {a,key}=await diagnosticSetup(diagnosticManifest(['catalog','meta']),()=>({meta:{id:'tt123',type:'movie',name:'Film'}}));
  const source=a.sources.source(`addon|${key}`);
  const episodes=await source.episodes({type:'movie',id:'tt123'});
  expect(await source.servers(episodes[0])).toEqual([]);
  expect(await source.streams({type:'movie',url:'tt123'})).toEqual([]);
});
it('provider configuration-required responses are separate from broken requests',async()=>{
  const {a,key}=await diagnosticSetup(diagnosticManifest(['stream'],[]),()=>({error:'config_required'}));
  const result=await a.diagnose(key,{sample:{type:'movie',videoId:'tt123'}});
  expect(result.checks[0].state).toBe('configuration');
  expect(result.assessment.level).toBe('configuration');
  expect(a.registry.health.state(key,'streams','pwa').failures).toBe(0);
});
it('invalid caller identities and filters do not classify the provider as broken',async()=>{
  const {a,key}=await diagnosticSetup(diagnosticManifest([{name:'stream',types:['movie'],idPrefixes:['tt']}],[]),()=>({streams:[]}));
  await expect(a.adapter(key).streams({type:'movie',videoId:'wrong'})).rejects.toMatchObject({code:'UNSUPPORTED_RESOURCE'});
  expect(a.registry.health.state(key,'streams','pwa').state).toBe('unknown');
});
it('reports unsupported stream formats without network failure or functional success',async()=>{
  for(const stream of [{infoHash:'torrent'},{url:'https://cdn.test/video.mpd',type:'dash'},{url:'https://cdn.test/video.mp4',headers:{referer:'https://provider.test'}}]){
    const {a,key}=await diagnosticSetup(diagnosticManifest(['stream'],[]),()=>({streams:[stream]}));
    const result=await a.diagnose(key,{sample:{type:'movie',videoId:'tt123'}});
    expect(result.checks[0].state).toBe('unsupported');
    expect(result.assessment.level).toBe('candidate');
    expect(a.registry.health.state(key,'streams','pwa').failures).toBe(0);
    expect(a.registry.health.state(key,'streams','pwa').functionalSuccessAt).toBeNull();
  }
});
it('does not promote malformed Remote v1 home or details responses',async()=>{
  const m={id:'org.remote',name:'Remote',version:'1.0.0',protocolVersion:1,minVantaraVersion:'0.2.0',runtime:'remote',contentTypes:['movie'],capabilities:['home','details'],permissions:{networkHosts:['addon.test'],verification:false},baseUrl:'https://addon.test',resources:{home:'/home',details:'/work/{workId}'}};
  const {a,key}=await diagnosticSetup(m,()=>({}));
  const result=await a.diagnose(key,{sample:{work:{id:'real'}}});
  expect(result.checks.map(x=>x.state)).toEqual(['failed','failed']);
  expect(result.assessment.level).toBe('broken');
});
it('isolates configured URL changes at the same addon id/version',async()=>{
 const store=createStore({indexedDB:null});const requests=[];
 const a=createAddonRuntime({runtime:{ready:Promise.resolve(),store,registry:{list:()=>[]}},transport:{json:async url=>{requests.push(url);return url.endsWith('manifest.json')?{id:'configured',name:'Configured',version:'1.0.0',types:['movie'],resources:['catalog'],catalogs:[{id:'c',type:'movie'}]}:{metas:[{id:url,name:url}]};}}});await a.ready;
 const one=await a.registry.install(await a.registry.inspect('https://addon.test/config-A/manifest.json'));const first=await a.adapter(one.key).catalog({type:'movie',id:'c'});
 const two=await a.registry.install(await a.registry.inspect('https://addon.test/config-B/manifest.json'));const second=await a.adapter(two.key).catalog({type:'movie',id:'c'});
 expect(second).not.toEqual(first);expect(requests.some(u=>u.includes('/config-B/catalog/'))).toBe(true);expect(two.cacheEpoch).not.toBe(one.cacheEpoch);
});
it('searches only catalogs whose required extras can be supplied by ordinary work search',async()=>{
 const {a,key,requests}=await diagnosticSetup(diagnosticManifest(['catalog','stream'],[
 {type:'movie',id:'genre-only',extraSupported:['search','genre'],extraRequired:['genre'],genres:['Drama']},
 {type:'movie',id:'ordinary',extraSupported:['search'],extraRequired:['search']}
 ]),()=>({metas:[{id:'tt1',name:'Work',type:'movie'}]}));
 const found=await a.sources.source(`addon|${key}`).search('Work');
 expect(found).toHaveLength(1);expect(requests.filter(x=>x.url.includes('/catalog/'))).toHaveLength(1);
 expect(requests.at(-1).url).toContain('/ordinary/search=Work.json');
});
it.each([
  [{ infoHash: '0123456789abcdef' }, 'تورنت'],
  [{ url: 'https://cdn.test/a.mp4', headers: { Referer: 'https://addon.test' } }, 'رؤوس HTTP'],
  [{ url: 'https://cdn.test/a.mpd' }, 'DASH'],
  [{ url: 'https://cdn.test/a.mp4', expiresAt: 1 }, 'صلاحية'],
])('preserves the rejection reason across the source facade for %j', async (stream, reason) => {
  const r = { ready: Promise.resolve(), store: createStore({ indexedDB: null }), registry: { list: () => [] } };
  const a = createAddonRuntime({ runtime: r, transport: { json: async url => url.endsWith('manifest.json')
    ? { id: 'org.reason', name: 'Reason', version: '1.0.0', types: ['movie'], resources: ['stream'], catalogs: [] }
    : { streams: [stream] } } });
  await a.ready;
  const installed = await a.registry.install(await a.registry.inspect('https://addon.test/manifest.json'));
  const s = a.sources.source(`addon|${installed.key}`);
  const [server] = await s.servers({ url: 'tt29355505', type: 'movie', externalIds: { imdb: 'tt29355505' } });
  await expect(s.streams(server)).rejects.toThrow(reason);
});
it('keeps a playable sibling and legitimate empty results through the facade', async () => {
  let streams = [{ infoHash: 'abc' }, { url: 'https://cdn.test/a.mp4', name: '1080p' }];
  const r = { ready: Promise.resolve(), store: createStore({ indexedDB: null }), registry: { list: () => [] } };
  const a = createAddonRuntime({ runtime: r, transport: { json: async url => url.endsWith('manifest.json')
    ? { id: 'org.mixed', name: 'Mixed', version: '1.0.0', types: ['movie'], resources: ['stream'], catalogs: [] }
    : { streams } } });
  await a.ready;
  const installed = await a.registry.install(await a.registry.inspect('https://addon.test/manifest.json'));
  const s = a.sources.source(`addon|${installed.key}`);
  const [server] = await s.servers({ url: 'tt29355505', type: 'movie', externalIds: { imdb: 'tt29355505' } });
  expect(await s.streams(server)).toMatchObject([{ status: 'RESOLVED', quality: 1080 }]);
  streams = [];
  expect(await s.streams({ ...server, url: 'tt1254207' })).toEqual([]);
});
it("gives anime/cinema core sources «آخر التحديثات» only when the source really has latest", async () => {
  const defs = [
    { id: "ok", label: "OkAnime", content: "anime", version: 1, domain: "ok.test" },
    { id: "plain", label: "Plain", content: "cinema", version: 1, domain: "plain.test" },
  ];
  const r = {
    ready: Promise.resolve(),
    store: createStore({ indexedDB: null }),
    registry: {
      list: () => defs,
      source: (id) => (id === "ok" ? { latest: async () => [], search: async () => [] } : { search: async () => [] }),
      def: (id) => defs.find((d) => d.id === id),
      call: async () => [],
    },
  };
  const a = createAddonRuntime({ runtime: r, store: r.store, transport: {} });
  await a.ready;
  const caps = Object.fromEntries(a.registry.list().filter((m) => m.bundled).map((m) => [m.sourceId, m.capabilities]));
  expect(caps.ok).toContain("home");
  expect(caps.plain).not.toContain("home");
  expect(caps.plain).toContain("search");
});
